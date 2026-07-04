"""
WebSocket 실시간 API 계약 테스트 (G001, P4-R1-T2)

참조:
- docs/api/realtime-server-api.yaml: WebSocket 명세
- 00-decisions.md: D1(WSS), D4(JWT protocol_version), D13(프레즌스 7종), D22(성능)
- 09-realtime-collaboration.md: 메시지 프로토콜, 상태 전이
- test-strategy.md: 테스트 전략

구성:
- WebSocket 핸드셰이크, 재접속, 주요 메시지 타입, 에러 코드
- TestClient(starlette)의 동기 websocket_connect로 실제 app.api.realtime 라우터를 구동한다.
  (httpx AsyncClient는 WebSocket을 지원하지 않으므로 fastapi.testclient 사용)

테스트 케이스 수: ~17개
- 핸드셰이크: 4개
- 재접속: 3개(1개는 실제 클럭 필요로 skip 유지)
- 메시지: 6개
- 에러: 4개
"""

import pytest
import json
from datetime import timedelta

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.api.realtime import manager
from app.config import settings
from app.core.security import create_access_token


@pytest.fixture(autouse=True)
def _reset_manager():
    """각 테스트 전 실시간 세션 매니저 상태 초기화(접속/시퀀스/재전송 버퍼)."""
    manager.reset()
    yield
    manager.reset()


def _second_token() -> str:
    return create_access_token({"sub": "2", "role": "employee"})


# ============================================================================
# WebSocket 핸드셰이크 & 인증
# ============================================================================

class TestWebSocketHandshake:
    """
    WSS 연결 및 protocol_version 협상

    명세:
    - 클라이언트: hello 메시지 (protocol_version, jwt)
    - 서버: ready 응답 (성공) 또는 reject (미지원 버전)
    - 타임아웃: 설정된 초 내 hello 없으면 종료

    참조: D1(WSS), D4(protocol_version 협상)
    """

    def test_websocket_handshake_success(self, employee_token):
        """
        정상 핸드셰이크 → ready 응답

        @TEST T2.1.1 - WSS 핸드셰이크 성공
        """
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                response = ws.receive_json()
                assert response["type"] == "ready"
                assert response["user_id"] == 1
                assert response["protocol_version"] == 3
                assert "snapshot" in response

    def test_websocket_handshake_unsupported_version(self, employee_token):
        """
        미지원 프로토콜 버전 → reject

        @TEST T2.1.2 - 미지원 프로토콜 버전
        """
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"type": "hello", "protocol_version": 1, "jwt": employee_token})
                response = ws.receive_json()
                assert response["type"] == "reject"
                assert response["reason"] == "unsupported_protocol_version"
                with pytest.raises(WebSocketDisconnect):
                    ws.receive_json()

    def test_websocket_handshake_invalid_jwt(self):
        """
        무효한 JWT → reject

        @TEST T2.1.3 - 무효 JWT
        """
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"type": "hello", "protocol_version": 3, "jwt": "invalid_jwt_string"})
                response = ws.receive_json()
                assert response["type"] == "reject"
                assert response["reason"] == "invalid_jwt"

    def test_websocket_handshake_missing_hello(self):
        """
        hello가 아닌(또는 형식이 다른) 첫 메시지 → 프로토콜 오류(4002)로 종료

        @TEST T2.1.4 - 핸드셰이크 프로토콜 오류
        """
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"type": "not_hello"})
                with pytest.raises(WebSocketDisconnect) as exc_info:
                    ws.receive_json()
                assert exc_info.value.code == 4002


# ============================================================================
# WebSocket 재접속 & 스냅샷
# ============================================================================

class TestWebSocketReconnection:
    """
    재접속 및 sequence_num 기반 스냅샷 복구

    명세:
    - 정상 연결 중 disconnection → 클라이언트 재연결 시도
    - 서버: 마지막 sequence_num 이후 메시지 재전송
    - 타임아웃: 60초 내 미재접속 → 세션 삭제

    참조: D1(재접속 sequence_num)
    """

    def test_reconnection_snapshot_recovery(self, employee_token):
        """
        재접속 후 스냅샷 복구

        동작:
        1. 연결 → ready에서 snapshot 수신
        2. 연결 종료
        3. 재연결 → 다시 ready + snapshot 수신 성공

        @TEST T2.2.1 - 재접속 스냅샷
        """
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                first = ws.receive_json()
                assert first["type"] == "ready"

            with client.websocket_connect("/ws") as ws2:
                ws2.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                second = ws2.receive_json()
                assert second["type"] == "ready"
                assert second["user_id"] == 1

    def test_reconnection_message_replay(self, employee_token):
        """
        재접속 시 낙선된 메시지 재전송(resume)

        1번 클라이언트 접속 유지, 2번 클라이언트가 avatar_move 전송 →
        1번이 resume(last_server_seq=0) 요청 시 해당 메시지를 재전송받는다.

        @TEST T2.2.2 - 메시지 재전송
        """
        second_token = _second_token()
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws1:
                ws1.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                ws1.receive_json()  # ready

                with client.websocket_connect("/ws") as ws2:
                    ws2.send_json({"type": "hello", "protocol_version": 3, "jwt": second_token})
                    ws2.receive_json()  # ready
                    ws1.receive_json()  # presence_update(online) for user 2

                    ws2.send_json(
                        {"type": "avatar_move", "x": 1.0, "y": 2.0, "facing": 90, "velocity": 1.0, "sequence_num": 1}
                    )
                    moved = ws1.receive_json()
                    assert moved["type"] == "avatar_move"
                    assert moved["user_id"] == 2

                ws1.receive_json()  # presence_update(offline) for user 2

                ws1.send_json({"type": "resume", "last_server_seq": 0})
                replayed = [ws1.receive_json() for _ in range(3)]
                types = [m["type"] for m in replayed]
                assert "avatar_move" in types

    @pytest.mark.skip(reason="실시간 60초 벽시계 타임아웃 검증은 실 클럭 대기가 필요해 단위 테스트 범위 밖(수동/통합 검증)")
    async def test_reconnection_timeout(self, event_loop):
        """
        60초 내 미재접속 → 세션 삭제

        @TEST T2.2.3 - 재접속 타임아웃
        """
        pass


# ============================================================================
# WebSocket 주요 메시지 타입
# ============================================================================

class TestWebSocketMessages:
    """
    아바타 동기화, 상태 전이, 회의실 점유, 상호작용

    명세 (09-realtime-collaboration.md):
    - avatar_move: 좌표, 회전, 속도
    - presence_update: 상태 전이 (online/working/meeting/away 등)
    - meeting_enter: 회의실 입장 + 좌석 점유
    - meeting_exit: 회의실 퇴장
    - chat: 근접 채팅 (< 5m, 이번 슬라이스는 단순화하여 전체 브로드캐스트)
    - action_notify: 근접 메뉴 (상호작용 가능)

    참조: D13(프레즌스 7종), D22(성능 tick 20Hz)
    """

    def test_message_avatar_move(self, employee_token):
        """
        아바타 이동 메시지 브로드캐스트

        @TEST T2.3.1 - 아바타 이동
        """
        second_token = _second_token()
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws1:
                ws1.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                ws1.receive_json()

                with client.websocket_connect("/ws") as ws2:
                    ws2.send_json({"type": "hello", "protocol_version": 3, "jwt": second_token})
                    ws2.receive_json()
                    ws1.receive_json()  # presence_update online for user 2

                    ws1.send_json(
                        {"type": "avatar_move", "x": 15.2, "y": 10.5, "facing": 45, "velocity": 2.0, "sequence_num": 123}
                    )
                    message = ws2.receive_json()
                    assert message["type"] == "avatar_move"
                    assert message["user_id"] == 1
                    assert message["x"] == 15.2
                    assert message["facing"] == 45

    def test_message_presence_update(self, employee_token):
        """
        프레즌스 상태 변이

        @TEST T2.3.2 - 프레즌스 상태
        """
        second_token = _second_token()
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws1:
                ws1.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                ws1.receive_json()

                with client.websocket_connect("/ws") as ws2:
                    ws2.send_json({"type": "hello", "protocol_version": 3, "jwt": second_token})
                    ws2.receive_json()
                    ws1.receive_json()  # presence_update online for user 2

                    ws1.send_json({"type": "presence_update", "status": "focus"})
                    message = ws2.receive_json()
                    assert message["type"] == "presence_update"
                    assert message["user_id"] == 1
                    assert message["status"] == "focus"

    def test_message_meeting_enter(self, employee_token):
        """
        회의실 입장 메시지

        @TEST T2.3.3 - 회의실 입장
        """
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                ws.receive_json()

                ws.send_json({"type": "meeting_enter", "meeting_id": "meeting-001", "room_id": "1F-MR01"})
                response = ws.receive_json()
                assert response["type"] == "meeting_enter"
                assert response["user_id"] == 1
                assert response["meeting_id"] == "meeting-001"
                assert response["room_id"] == "1F-MR01"
                assert response["livekit_room_name"] == "meeting-001"
                assert response["livekit_token"]

    def test_message_chat_proximity(self, employee_token):
        """
        근접 채팅 (< 5m, 단순화: 현재 구현은 전체 브로드캐스트)

        @TEST T2.3.4 - 근접 채팅
        """
        second_token = _second_token()
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws1:
                ws1.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                ws1.receive_json()

                with client.websocket_connect("/ws") as ws2:
                    ws2.send_json({"type": "hello", "protocol_version": 3, "jwt": second_token})
                    ws2.receive_json()
                    ws1.receive_json()  # presence_update online for user 2

                    ws1.send_json({"type": "chat", "message": "안녕하세요", "range": 5})
                    message = ws2.receive_json()
                    assert message["type"] == "chat"
                    assert message["user_id"] == 1
                    assert message["message"] == "안녕하세요"
                    assert message["range"] == 5

    def test_message_action_notify(self, employee_token):
        """
        근접 메뉴 (상호작용 가능)

        @TEST T2.3.5 - 근접 메뉴
        """
        second_token = _second_token()
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws1:
                ws1.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                ws1.receive_json()

                with client.websocket_connect("/ws") as ws2:
                    ws2.send_json({"type": "hello", "protocol_version": 3, "jwt": second_token})
                    ws2.receive_json()
                    ws1.receive_json()  # presence_update online for user 2

                    ws1.send_json(
                        {"type": "action_notify", "action": "knock_door", "target_type": "room", "target_id": "1F-MR01"}
                    )
                    message = ws2.receive_json()
                    assert message["type"] == "action_notify"
                    assert message["user_id"] == 1
                    assert message["action"] == "knock_door"
                    assert message["target_type"] == "room"
                    assert message["target_id"] == "1F-MR01"

    def test_message_server_tick(self, employee_token):
        """
        서버 tick 페이로드 형태 검증

        20Hz 브로드캐스트 루프 자체는 외부(스케줄러)에서 구동되므로,
        여기서는 manager.build_tick_payload()의 계약 형태만 검증한다.

        @TEST T2.3.6 - 서버 Tick
        """
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                ws.receive_json()

                ws.send_json({"type": "avatar_move", "x": 15.2, "y": 10.5, "facing": 45, "velocity": 2.0, "sequence_num": 1})

                # avatar_move는 서버가 비동기로 처리하므로 last_state 반영을 폴링으로 동기화한다.
                import time as _t
                for _ in range(200):
                    if manager.last_state.get(1, {}).get("x") is not None:
                        break
                    _t.sleep(0.01)

                manager.tick = 1000
                payload = manager.build_tick_payload()
                assert payload["type"] == "server_tick"
                assert payload["tick"] == 1000
                assert payload["server_time"].endswith("Z")
                assert payload["entities"] == [{"user_id": 1, "x": 15.2, "y": 10.5, "facing": 45}]


# ============================================================================
# WebSocket 에러 처리
# ============================================================================

class TestWebSocketErrorHandling:
    """
    WebSocket 에러 코드 및 복구 전략

    명세:
    - 1000: 정상 종료 (close)
    - 4001: 인증 실패 (invalid_jwt, expired_jwt)
    - 4002: 프로토콜 오류 (invalid_message_format)
    - 4003: 서버 상태 초과 (capacity_exceeded)
    """

    def test_error_invalid_jwt(self):
        """
        인증 실패 (잘못된 JWT) → reject + 4001

        @TEST T2.4.1 - JWT 인증 실패
        """
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"type": "hello", "protocol_version": 3, "jwt": "garbage"})
                response = ws.receive_json()
                assert response["type"] == "reject"
                assert response["reason"] == "invalid_jwt"
                with pytest.raises(WebSocketDisconnect) as exc_info:
                    ws.receive_json()
                assert exc_info.value.code == 4001

    def test_error_expired_jwt(self):
        """
        만료된 JWT → reject expired_jwt + 4001

        @TEST T2.4.2 - JWT 만료
        """
        expired_token = create_access_token({"sub": "1", "role": "employee"}, expires_delta=timedelta(seconds=-1))
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"type": "hello", "protocol_version": 3, "jwt": expired_token})
                response = ws.receive_json()
                assert response["type"] == "reject"
                assert response["reason"] == "expired_jwt"
                with pytest.raises(WebSocketDisconnect) as exc_info:
                    ws.receive_json()
                assert exc_info.value.code == 4001

    def test_error_invalid_message_format(self, employee_token):
        """
        프로토콜 오류 (잘못된 JSON) → 4002

        @TEST T2.4.3 - 프로토콜 오류
        """
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                ws.receive_json()

                ws.send_text("not-json{{")
                with pytest.raises(WebSocketDisconnect) as exc_info:
                    ws.receive_json()
                assert exc_info.value.code == 4002

    def test_error_capacity_exceeded(self, employee_token, monkeypatch):
        """
        서버 용량 초과 → capacity_exceeded + 4003

        @TEST T2.4.4 - 서버 용량 초과
        """
        monkeypatch.setattr(settings, "realtime_max_connections", 1)
        second_token = _second_token()
        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws1:
                ws1.send_json({"type": "hello", "protocol_version": 3, "jwt": employee_token})
                ws1.receive_json()

                with client.websocket_connect("/ws") as ws2:
                    ws2.send_json({"type": "hello", "protocol_version": 3, "jwt": second_token})
                    response = ws2.receive_json()
                    assert response["type"] == "reject"
                    assert response["reason"] == "capacity_exceeded"
                    with pytest.raises(WebSocketDisconnect) as exc_info:
                        ws2.receive_json()
                    assert exc_info.value.code == 4003


# ============================================================================
# WebSocket 성능 테스트 (Phase 2+)
# ============================================================================

class TestWebSocketPerformance:
    """
    WebSocket 성능 검증 (D22)

    메트릭:
    - E2E 지연: p95 < 500ms (입력 → 원격 표시)
    - 서버 tick: 20Hz (50ms)
    - 근접 메뉴: < 200ms
    - 메모리: 20명 시뮬레이션 (S3 스파이크)
    """

    @pytest.mark.skip(reason="requires Godot headless load harness / multi-process — story G008/부하")
    async def test_performance_e2e_latency(self, event_loop):
        """
        E2E 지연 측정 (p95 < 500ms)

        @TEST T2.5+ - E2E 지연
        """
        pass

    @pytest.mark.skip(reason="requires Godot headless load harness / multi-process — story G008/부하")
    async def test_performance_headless_load(self, event_loop):
        """
        헤드리스 서버 부하 (20명)

        @TEST T2.6+ - 헤드리스 부하
        """
        pass

    @pytest.mark.skip(reason="requires Godot headless load harness / multi-process — story G008/부하")
    async def test_performance_tick_rate(self, event_loop):
        """
        서버 tick 일정성 (20Hz ±5%)

        @TEST T2.7+ - Tick 일정성
        """
        pass


# ============================================================================
# WebSocket 통합 시나리오 (Phase 2+)
# ============================================================================

class TestWebSocketIntegration:
    """
    다중 클라이언트 상호작용 (Phase 2+)

    시나리오:
    1. 3명 동시 로그인
    2. 좌석 점유 → presence 동기화
    3. A가 회의실 입장 → B/C 감지
    4. 회의 진행 → 채팅 + 근접 메뉴
    5. 회의 퇴장 → presence 업데이트
    """

    @pytest.mark.skip(reason="requires Godot headless load harness / multi-process — story G008/부하")
    async def test_integration_multi_client_synchronization(self, event_loop):
        """
        다중 클라이언트 동기화

        @TEST T2.8+ - 다중 클라이언트 동기화
        """
        pass

    @pytest.mark.skip(reason="requires Godot headless load harness / multi-process — story G008/부하")
    async def test_integration_presence_broadcast(self, event_loop):
        """
        프레즌스 브로드캐스트

        @TEST T2.9+ - 프레즌스 브로드캐스트
        """
        pass

    @pytest.mark.skip(reason="requires Godot headless load harness / multi-process — story G008/부하")
    async def test_integration_meeting_full_flow(self, event_loop):
        """
        회의 풀 플로우 (입장 → 채팅 → 퇴장)

        @TEST T2.10+ - 회의 플로우
        """
        pass
