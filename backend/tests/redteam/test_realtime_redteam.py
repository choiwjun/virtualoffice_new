"""
WebSocket 실시간 게이트웨이 레드팀 테스트 (G001, P4-R1-T2)

목적: 정상 경로 확인이 아니라 게이트웨이를 "깨뜨리는" 것.
악의적/기형/경계값 입력에 대해 서버가 크래시하거나 상태가 오염되지 않는지 검증한다.

참조:
- backend/app/api/realtime.py (RealtimeSessionManager, /ws 핸들러)
- backend/tests/contract/test_realtime_api_stubs.py (정상 경로 계약 테스트, 패턴 참고)
"""

from __future__ import annotations

import concurrent.futures
import json
import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.realtime import manager
from app.config import settings
from app.core.security import create_access_token
from app.main import app

# WebSocketTestSession.receive_json() blocks forever if no message is ever sent
# (no native timeout). Several adversarial cases here specifically probe for a
# "silently never sends a message" state-corruption bug, so we must be able to
# detect "never arrives" without hanging the whole suite.
_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=8)


def _recv_or_timeout(ws, timeout: float = 3.0):
    """receive_json() with a wall-clock timeout. Returns None on timeout."""
    fut = _EXECUTOR.submit(ws.receive_json)
    try:
        return fut.result(timeout=timeout)
    except concurrent.futures.TimeoutError:
        return None


def _drain_until(ws, want_type: str, max_msgs: int = 20):
    """Read messages until one of type `want_type` shows up (tolerates noise)."""
    for _ in range(max_msgs):
        msg = ws.receive_json()
        if msg.get("type") == want_type:
            return msg
    raise AssertionError(f"did not observe a {want_type!r} message within {max_msgs} messages")


def _token(sub: str, role: str = "employee") -> str:
    return create_access_token({"sub": sub, "role": role}, expires_delta=timedelta(hours=8))


@pytest.fixture(autouse=True)
def _reset_manager():
    """각 테스트 전/후 실시간 세션 매니저 상태 초기화."""
    manager.reset()
    yield
    manager.reset()


# ============================================================================
# 1) hello 페이로드가 dict가 아님(JSON 배열) → 4002
# ============================================================================


def test_hello_non_dict_json_array_closes_4002():
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps([1, 2, 3]))
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 4002


# ============================================================================
# 2) hello에 protocol_version 누락 → unsupported로 처리(크래시 아님)
# ============================================================================


def test_hello_missing_protocol_version_rejected_not_crashed():
    token = _token("1")
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "hello", "jwt": token})
            resp = ws.receive_json()
            assert resp["type"] == "reject"
            assert resp["reason"] == "unsupported_protocol_version"
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 1000


# ============================================================================
# 3) avatar_move에 x/y/facing 누락 → 크래시 없이 처리, 발신자 연결 생존
# ============================================================================


def test_avatar_move_missing_fields_survives():
    token1, token2 = _token("1"), _token("2")
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws1:
            ws1.send_json({"type": "hello", "protocol_version": 3, "jwt": token1})
            ws1.receive_json()  # ready

            with client.websocket_connect("/ws") as ws2:
                ws2.send_json({"type": "hello", "protocol_version": 3, "jwt": token2})
                ws2.receive_json()  # ready
                ws1.receive_json()  # presence_update(online) for user 2

                ws1.send_json({"type": "avatar_move"})  # x/y/facing 전부 누락
                moved = ws2.receive_json()
                assert moved["type"] == "avatar_move"
                assert moved["user_id"] == 1
                assert moved["x"] is None
                assert moved["y"] is None
                assert moved["facing"] is None

                # 발신자(ws1) 연결이 살아있어야 후속 메시지도 처리된다.
                ws1.send_json({"type": "presence_update", "status": "focus"})
                follow_up = ws2.receive_json()
                assert follow_up["type"] == "presence_update"
                assert follow_up["user_id"] == 1
                assert follow_up["status"] == "focus"


# ============================================================================
# 4) presence_update 상태값 'hacker' → 비-종료 error, 연결 계속 사용 가능
# ============================================================================


def test_presence_update_invalid_status_non_closing():
    token = _token("1")
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "hello", "protocol_version": 3, "jwt": token})
            ws.receive_json()  # ready

            ws.send_json({"type": "presence_update", "status": "hacker"})
            err = ws.receive_json()
            assert err["type"] == "error"
            assert err["code"] == "invalid_message_format"

            # 연결이 종료되지 않았는지 직접 응답이 오는 메시지로 확인한다.
            ws.send_json({"type": "meeting_enter", "meeting_id": "m-after-bad-status", "room_id": "r1"})
            resp = ws.receive_json()
            assert resp["type"] == "meeting_enter"
            assert resp["meeting_id"] == "m-after-bad-status"


# ============================================================================
# 5) 동일 user_id(sub='1')로 중복 접속 → 매니저 크래시 없음.
#    connections 무결성 및 disconnect cleanup이 상태를 오염시키지 않는지 검증.
# ============================================================================


def test_duplicate_user_id_connections_state_integrity():
    token1, token3 = _token("1"), _token("3")
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as wsA:
            wsA.send_json({"type": "hello", "protocol_version": 3, "jwt": token1})
            wsA.receive_json()  # ready for A (user_id=1)

            with client.websocket_connect("/ws") as wsB:
                # 동일한 sub=1로 두 번째 접속 — 매니저가 크래시해서는 안 된다.
                wsB.send_json({"type": "hello", "protocol_version": 3, "jwt": token1})
                wsB.receive_json()  # ready for B (also user_id=1)

                assert 1 in manager.connections
                assert len(manager.connections) == 1

                # A를 닫는다. B는 여전히 열려 있는 실제 연결이다.
                wsA.close()
                time.sleep(0.2)  # 서버 측 finally 블록이 실행될 시간을 준다.

                # A의 disconnect cleanup이 user_id 키를 통째로 지워서 여전히 열려
                # 있는 B의 등록까지 지워버리면 안 된다(상태 오염).
                if 1 in manager.connections:
                    assert manager.connections[1] is not None
                else:
                    pytest.fail(
                        "BUG: manager.connections lost key 1 entirely after closing the "
                        "*first* of two same-user_id connections, even though the second "
                        "connection (B) is still open. `finally: manager.connections.pop(user_id, None)` "
                        "pops by user_id, not by identity, so it deletes B's live registration too."
                    )

                # 기능적으로도 확인: B가 여전히 브로드캐스트를 수신해야 한다.
                with client.websocket_connect("/ws") as wsC:
                    wsC.send_json({"type": "hello", "protocol_version": 3, "jwt": token3})
                    wsC.receive_json()  # ready for C

                    wsC.send_json({"type": "chat", "message": "ping-for-b"})
                    # C 접속 시 B는 presence_update(online)를 먼저 받으므로 chat을
                    # 찾을 때까지 드레인한다(핵심 검증: B가 C의 chat을 수신함).
                    chat_msg = None
                    for _ in range(5):
                        msg = _recv_or_timeout(wsB, timeout=3.0)
                        if msg is None:
                            break
                        if msg.get("type") == "chat":
                            chat_msg = msg
                            break
                    assert chat_msg is not None, (
                        "BUG: connection B (still open, same user_id=1 as the now-closed A) never "
                        "received the chat broadcast sent by C. A's disconnect handler must not "
                        "remove B's live registration (identity-based cleanup)."
                    )
                    assert chat_msg["message"] == "ping-for-b"


# ============================================================================
# 6) resume에 거대/음수 last_server_seq → 크래시 없음, 안전한 부분집합/빈 결과
# ============================================================================


def test_resume_with_huge_last_server_seq_no_crash():
    token = _token("1")
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "hello", "protocol_version": 3, "jwt": token})
            ws.receive_json()

            ws.send_json({"type": "resume", "last_server_seq": 999_999_999_999})
            # replay_since(huge) must yield nothing; connection must remain usable.
            ws.send_json({"type": "meeting_enter", "meeting_id": "m-huge", "room_id": "r-huge"})
            resp = _drain_until(ws, "meeting_enter")
            assert resp["meeting_id"] == "m-huge"


def test_resume_with_negative_last_server_seq_no_crash():
    token = _token("1")
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "hello", "protocol_version": 3, "jwt": token})
            ws.receive_json()

            ws.send_json({"type": "resume", "last_server_seq": -999_999_999})
            # replay_since(negative) returns the whole buffer (safe subset), not a crash.
            ws.send_json({"type": "meeting_enter", "meeting_id": "m-neg", "room_id": "r-neg"})
            resp = _drain_until(ws, "meeting_enter")
            assert resp["meeting_id"] == "m-neg"


# ============================================================================
# 7) 대용량 chat 메시지(10만자) → 크래시 없이 브로드캐스트
# ============================================================================


def test_oversized_chat_message_broadcasts_without_crash():
    token1, token2 = _token("1"), _token("2")
    huge_message = "A" * 100_000
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws1:
            ws1.send_json({"type": "hello", "protocol_version": 3, "jwt": token1})
            ws1.receive_json()

            with client.websocket_connect("/ws") as ws2:
                ws2.send_json({"type": "hello", "protocol_version": 3, "jwt": token2})
                ws2.receive_json()
                ws1.receive_json()  # presence_update(online) for user 2

                ws1.send_json({"type": "chat", "message": huge_message})
                msg = ws2.receive_json()
                assert msg["type"] == "chat"
                assert len(msg["message"]) == 100_000


# ============================================================================
# 8) 바이너리 프레임 / 빈 문자열 프레임 → 500 없이 처리되어야 함
# ============================================================================


def test_empty_string_frame_in_loop_closes_cleanly_4002():
    """루프 중 빈 문자열(JSON 파싱 불가) → close(4002), 크래시 아님."""
    token = _token("1")
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "hello", "protocol_version": 3, "jwt": token})
            ws.receive_json()

            ws.send_text("")
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 4002


def test_binary_frame_in_loop_does_not_crash_server():
    """
    루프 중 텍스트가 아닌 바이너리 프레임 수신 → 서버는 크래시하지 말고
    최소한 연결을 정상적으로 종료(예: 4002)해야 한다.

    실제로는 `websocket.receive_text()`가 바이너리 프레임을 받으면
    starlette 내부에서 `message["text"]`에 대한 KeyError를 던지고,
    /ws 핸들러가 이를 전혀 캐치하지 않아 처리되지 않은 예외가 ASGI 앱
    태스크 밖으로 전파된다(연결이 비정상 종료되고 서버 로그에 스택트레이스가
    남는 500 상당의 크래시).
    """
    token = _token("1")
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "hello", "protocol_version": 3, "jwt": token})
            ws.receive_json()

            ws.send_bytes(b"\x00\x01binary-not-json")
            try:
                with pytest.raises(WebSocketDisconnect) as exc:
                    ws.receive_json()
                assert exc.value.code == 4002
            except KeyError as e:
                pytest.fail(
                    "BUG: a binary websocket frame during the message loop crashes the "
                    f"gateway with an unhandled KeyError({e!r}) instead of being closed "
                    "gracefully. Root cause: the /ws handler calls "
                    "`await websocket.receive_text()` unconditionally; when the client "
                    "sends a binary frame, starlette's WebSocket.receive_text() does "
                    "`message['text']` on an ASGI message that only has a 'bytes' key, "
                    "raising KeyError which is not caught anywhere in the handler."
                )


# ============================================================================
# 9) capacity 경계: realtime_max_connections=2 → 3번째 거부(4003) → 하나 닫으면 회복
# ============================================================================


def test_capacity_boundary_rejects_and_recovers(monkeypatch):
    monkeypatch.setattr(settings, "realtime_max_connections", 2)
    token1, token2, token3, token4 = _token("1"), _token("2"), _token("3"), _token("4")

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws1:
            ws1.send_json({"type": "hello", "protocol_version": 3, "jwt": token1})
            ws1.receive_json()

            with client.websocket_connect("/ws") as ws2:
                ws2.send_json({"type": "hello", "protocol_version": 3, "jwt": token2})
                ws2.receive_json()
                ws1.receive_json()  # presence_update(online) for user 2 reaches user 1

                # 3번째 접속(용량 초과) → 거부 + 4003
                with client.websocket_connect("/ws") as ws3:
                    ws3.send_json({"type": "hello", "protocol_version": 3, "jwt": token3})
                    reject = ws3.receive_json()
                    assert reject["type"] == "reject"
                    assert reject["reason"] == "capacity_exceeded"
                    with pytest.raises(WebSocketDisconnect) as exc:
                        ws3.receive_json()
                    assert exc.value.code == 4003

            # ws2가 닫혀 용량이 회복됨 → 신규 접속이 성공해야 한다.
            with client.websocket_connect("/ws") as ws4:
                ws4.send_json({"type": "hello", "protocol_version": 3, "jwt": token4})
                ready = ws4.receive_json()
                assert ready["type"] == "ready"
                assert ready["user_id"] == 4


# ============================================================================
# 10) 알 수 없는 메시지 타입 → 비-종료 error, 연결 계속 사용 가능
# ============================================================================


def test_unknown_message_type_non_closing():
    token = _token("1")
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "hello", "protocol_version": 3, "jwt": token})
            ws.receive_json()

            ws.send_json({"type": "totally_bogus_type", "foo": "bar"})
            err = ws.receive_json()
            assert err["type"] == "error"
            assert err["code"] == "invalid_message_format"
            assert err["detail"] == "unknown_type"

            # 연결이 종료되지 않았는지 직접 응답 메시지로 확인한다.
            ws.send_json({"type": "meeting_enter", "meeting_id": "m-after-unknown", "room_id": "r1"})
            resp = ws.receive_json()
            assert resp["type"] == "meeting_enter"
            assert resp["meeting_id"] == "m-after-unknown"
