# @TASK P4-R1-T2 - 실시간 WSS 게이트웨이
# @SPEC docs/api/realtime-server-api.yaml
# @SPEC docs/planning/09-realtime-collaboration.md
"""
WebSocket(WSS) 실시간 게이트웨이 (G001).

참조:
- 00-decisions.md: D1(WSS), D4(JWT + protocol_version 협상), D13(프레즌스 7종),
  D22(동시성 설계 100명, 서버 tick 20Hz), D24(회의 명시적 입장)
- docs/api/realtime-server-api.yaml: AsyncAPI 3.0 계약(정본)

핸드셰이크:
- 접속 → accept() → 첫 메시지(hello, 타임아웃 settings.realtime_handshake_timeout_seconds)
- protocol_version/jwt 검증 → 성공 시 ready + snapshot, 실패 시 reject + close

메시지 루프:
- avatar_move / presence_update / meeting_enter / meeting_exit / chat /
  action_notify / resume 디스패치. 미지원 타입은 error(비-종료).

근접(<5m) 채팅/메뉴 참고:
- 실제 <5m 근접 필터링은 클라이언트/서버 좌표 기반 거리 계산이 필요하나,
  이번 슬라이스는 전 연결 브로드캐스트로 단순화한다(문서화된 의도적 단순화).
  좌표는 last_state에 저장되어 있어 후속 슬라이스에서 거리 필터를 추가할 수 있다.
"""

from __future__ import annotations

import asyncio
import json
from collections import deque
from datetime import datetime, timezone
from typing import Any, Optional

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.core.security import decode_access_token
from app.models.tables import PresenceStatus
from app.services.livekit_service import issue_join_token

router = APIRouter()

_VALID_PRESENCE_STATUSES = {s.value for s in PresenceStatus}


class RealtimeSessionManager:
    """접속 세션·시퀀스·재전송 버퍼를 관리하는 인메모리 싱글턴(D1/D22).

    단일 프로세스 게이트웨이를 가정한다(수평 확장은 범위 밖).
    """

    REPLAY_MAXLEN = 512

    def __init__(self) -> None:
        self.connections: dict[int, WebSocket] = {}
        self.server_seq: int = 0
        self.replay_buffer: deque[tuple[int, dict]] = deque(maxlen=self.REPLAY_MAXLEN)
        self.tick: int = 0
        # user_id -> 마지막 알려진 상태(아바타 위치·프레즌스)
        self.last_state: dict[int, dict[str, Any]] = {}

    def next_seq(self) -> int:
        self.server_seq += 1
        return self.server_seq

    async def broadcast(self, message: dict, exclude: Optional[int] = None) -> None:
        if "server_seq" in message:
            self.server_seq = message["server_seq"]
        else:
            message["server_seq"] = self.next_seq()
        self.replay_buffer.append((message["server_seq"], message))
        for user_id, ws in list(self.connections.items()):
            if user_id == exclude:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                # 전송 실패(끊긴 연결 등)는 상위 수신 루프의 disconnect 처리에 위임한다.
                pass

    def snapshot(self) -> list[dict]:
        """현재 접속자 + 마지막 알려진 상태 목록."""
        result = []
        for user_id in self.connections:
            state = self.last_state.get(user_id, {})
            result.append({"user_id": user_id, **state})
        return result

    def replay_since(self, seq: int) -> list[dict]:
        return [msg for (s, msg) in self.replay_buffer if s > seq]

    def build_tick_payload(self) -> dict:
        entities = [
            {
                "user_id": user_id,
                "x": state.get("x"),
                "y": state.get("y"),
                "facing": state.get("facing"),
            }
            for user_id, state in self.last_state.items()
            if user_id in self.connections
        ]
        return {
            "type": "server_tick",
            "tick": self.tick,
            "server_time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
            "entities": entities,
        }

    def reset(self) -> None:
        """테스트 전용: 전체 상태 초기화."""
        self.connections.clear()
        self.server_seq = 0
        self.replay_buffer.clear()
        self.tick = 0
        self.last_state.clear()


manager = RealtimeSessionManager()


def _decode_jwt_or_none(token: str) -> Optional[int]:
    payload = decode_access_token(token)
    sub = payload.get("sub")
    if sub is None:
        return None
    try:
        return int(sub)
    except (TypeError, ValueError):
        return None


class _NonTextFrame(Exception):
    """텍스트가 아닌 WS 프레임(바이너리 등) 수신 표시(프로토콜 오류로 처리)."""


async def _receive_text(websocket: WebSocket) -> str:
    """텍스트 프레임만 허용. starlette receive_text()는 바이너리 프레임에서
    KeyError('text')를 던지므로 receive()로 직접 받아 프레임 종류를 검사한다.
    disconnect는 WebSocketDisconnect, 비텍스트는 _NonTextFrame으로 정규화한다.
    """
    message = await websocket.receive()
    if message.get("type") == "websocket.disconnect":
        raise WebSocketDisconnect(message.get("code", 1000))
    text = message.get("text")
    if text is None:
        raise _NonTextFrame()
    return text


@router.websocket("/ws")
async def realtime_gateway(websocket: WebSocket) -> None:
    await websocket.accept()

    # ── 핸드셰이크 ──────────────────────────────────────
    try:
        raw = await asyncio.wait_for(
            _receive_text(websocket), timeout=settings.realtime_handshake_timeout_seconds
        )
    except asyncio.TimeoutError:
        await websocket.close(code=1000)
        return
    except _NonTextFrame:
        await websocket.close(code=4002)
        return
    except WebSocketDisconnect:
        return

    try:
        hello = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        await websocket.close(code=4002)
        return

    if not isinstance(hello, dict) or hello.get("type") != "hello":
        await websocket.close(code=4002)
        return

    protocol_version = hello.get("protocol_version")
    if protocol_version != settings.realtime_protocol_version:
        await websocket.send_json(
            {
                "type": "reject",
                "reason": "unsupported_protocol_version",
                "min": settings.realtime_protocol_version,
                "max": settings.realtime_protocol_version,
                "message": "클라이언트를 최신 버전으로 업데이트하세요",
            }
        )
        await websocket.close(code=1000)
        return

    token = hello.get("jwt")
    try:
        user_id = _decode_jwt_or_none(token) if token else None
        if user_id is None:
            raise jwt.InvalidTokenError("missing or non-int sub")
    except jwt.ExpiredSignatureError:
        await websocket.send_json({"type": "reject", "reason": "expired_jwt"})
        await websocket.close(code=4001)
        return
    except jwt.PyJWTError:
        await websocket.send_json({"type": "reject", "reason": "invalid_jwt"})
        await websocket.close(code=4001)
        return

    if len(manager.connections) >= settings.realtime_max_connections:
        await websocket.send_json({"type": "reject", "reason": "capacity_exceeded"})
        await websocket.close(code=4003)
        return

    manager.connections[user_id] = websocket
    manager.last_state.setdefault(user_id, {})["status"] = "online"
    await websocket.send_json(
        {
            "type": "ready",
            "user_id": user_id,
            "protocol_version": settings.realtime_protocol_version,
            "server_seq": manager.server_seq,
            "snapshot": manager.snapshot(),
        }
    )
    await manager.broadcast({"type": "presence_update", "user_id": user_id, "status": "online"}, exclude=user_id)

    # ── 메시지 루프 ──────────────────────────────────────
    try:
        while True:
            try:
                text = await _receive_text(websocket)
            except WebSocketDisconnect:
                break
            except _NonTextFrame:
                await websocket.close(code=4002)
                break

            try:
                msg = json.loads(text)
            except (json.JSONDecodeError, TypeError):
                await websocket.close(code=4002)
                break

            if not isinstance(msg, dict):
                await websocket.close(code=4002)
                break

            msg_type = msg.get("type")

            if msg_type == "avatar_move":
                x, y, facing = msg.get("x"), msg.get("y"), msg.get("facing")
                manager.last_state.setdefault(user_id, {}).update({"x": x, "y": y, "facing": facing})
                seq = manager.next_seq()
                await manager.broadcast(
                    {
                        "type": "avatar_move",
                        "user_id": user_id,
                        "x": x,
                        "y": y,
                        "facing": facing,
                        "velocity": msg.get("velocity"),
                        "sequence_num": msg.get("sequence_num"),
                        "server_seq": seq,
                    },
                    exclude=user_id,
                )

            elif msg_type == "presence_update":
                status = msg.get("status")
                if status not in _VALID_PRESENCE_STATUSES:
                    await websocket.send_json(
                        {"type": "error", "code": "invalid_message_format", "detail": "unknown_status"}
                    )
                else:
                    manager.last_state.setdefault(user_id, {})["status"] = status
                    payload = {"type": "presence_update", "user_id": user_id, "status": status}
                    if msg.get("room_id") is not None:
                        payload["room_id"] = msg["room_id"]
                    await manager.broadcast(payload, exclude=user_id)

            elif msg_type == "meeting_enter":
                meeting_id = msg.get("meeting_id")
                room_id = msg.get("room_id")
                token_str = issue_join_token(room=meeting_id, identity=str(user_id))
                seq = manager.next_seq()
                await websocket.send_json(
                    {
                        "type": "meeting_enter",
                        "user_id": user_id,
                        "meeting_id": meeting_id,
                        "room_id": room_id,
                        "livekit_room_name": meeting_id,
                        "livekit_token": token_str,
                        "server_seq": seq,
                    }
                )
                manager.last_state.setdefault(user_id, {})["status"] = "meeting"
                await manager.broadcast(
                    {"type": "presence_update", "user_id": user_id, "status": "meeting", "room_id": room_id},
                    exclude=user_id,
                )

            elif msg_type == "meeting_exit":
                manager.last_state.setdefault(user_id, {})["status"] = "online"
                await manager.broadcast(
                    {"type": "presence_update", "user_id": user_id, "status": "online"}, exclude=user_id
                )

            elif msg_type == "chat":
                await manager.broadcast(
                    {
                        "type": "chat",
                        "user_id": user_id,
                        "message": msg.get("message"),
                        "range": msg.get("range", 5),
                    },
                    exclude=user_id,
                )

            elif msg_type == "action_notify":
                await manager.broadcast(
                    {
                        "type": "action_notify",
                        "user_id": user_id,
                        "action": msg.get("action"),
                        "target_type": msg.get("target_type"),
                        "target_id": msg.get("target_id"),
                    },
                    exclude=user_id,
                )

            elif msg_type == "resume":
                try:
                    last_server_seq = int(msg.get("last_server_seq", 0))
                except (TypeError, ValueError):
                    last_server_seq = 0
                for entry in manager.replay_since(last_server_seq):
                    await websocket.send_json(entry)

            else:
                await websocket.send_json(
                    {"type": "error", "code": "invalid_message_format", "detail": "unknown_type"}
                )
    finally:
        # 동일 user_id 빠른 재접속 시 새 연결을 지우지 않도록 소켓 정체성으로 정리.
        if manager.connections.get(user_id) is websocket:
            manager.connections.pop(user_id, None)
            manager.last_state.pop(user_id, None)
            await manager.broadcast(
                {"type": "presence_update", "user_id": user_id, "status": "offline"}
            )
