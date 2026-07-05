"""
LiveKit 회의 입장 토큰 발급 (D24, B-03 슬라이스).

단일 진입점 `issue_join_token`: LiveKit이 설정되면(`settings.livekit_enabled`) livekit-api SDK로
실 AccessToken(VideoGrants room_join)을 발급하고, 미설정이면 기존 결정적 stub 토큰(FastAPI 자체
JWT)을 반환한다(하위호환 — 계약 테스트의 토큰/room_name 형식 유지).

범위: 실 LiveKit 서버 룸 생성·화상·Egress·STT·AI 요약은 서버/엔진 부재로 범위 밖(B-03 환경차단).
설정만 채우면(운영 배포에서 LIVEKIT_API_KEY/SECRET) 코드 변경 없이 실 토큰으로 전환된다.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Optional

from app.config import settings
from app.core.security import create_access_token

# 입장 토큰 TTL — 회의 세션 진입용(넉넉히 6h). 실 LiveKit 서버는 자체적으로 TTL/grant를 검증한다.
_JOIN_TOKEN_TTL = timedelta(hours=6)


def issue_join_token(room: str, identity: str, name: Optional[str] = None) -> str:
    """회의 입장 토큰 발급.

    - LiveKit 설정 시: 실 LiveKit AccessToken(iss=api_key, sub=identity, video.roomJoin=true, room=room).
    - 미설정 시: 기존 결정적 stub 토큰(FastAPI 자체 JWT, {sub, room, video:"join"}) — 하위호환.
    """
    if settings.livekit_enabled:
        from livekit import api  # 지연 임포트: LiveKit 미사용 환경의 임포트 비용 회피

        access = (
            api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
            .with_identity(identity)
            .with_grants(api.VideoGrants(room_join=True, room=room))
            .with_ttl(_JOIN_TOKEN_TTL)
        )
        if name:
            access = access.with_name(name)
        return access.to_jwt()

    # 미설정 fallback: 기존 stub과 동일 형식(계약 무회귀).
    return create_access_token({"sub": identity, "room": room, "video": "join"})


async def create_room(room: str, *, max_participants: int = 0) -> dict:
    """LiveKit 룸 생성(FastAPI 경유 단일화, D24). 미설정 시 결정적 stub 반환(런타임 B-03).

    반환: {room, created: bool, live: bool} — live=True면 실 LiveKit 서버에 생성됨.
    """
    if settings.livekit_enabled and settings.livekit_url:
        from livekit import api  # 지연 임포트

        lkapi = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
        try:
            await lkapi.room.create_room(
                api.CreateRoomRequest(name=room, max_participants=max_participants or 0)
            )
        finally:
            await lkapi.aclose()
        return {"room": room, "created": True, "live": True}
    return {"room": room, "created": True, "live": False}


async def delete_room(room: str) -> dict:
    """LiveKit 룸 삭제(회의 종료 시). 미설정 시 결정적 stub."""
    if settings.livekit_enabled and settings.livekit_url:
        from livekit import api

        lkapi = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
        try:
            await lkapi.room.delete_room(api.DeleteRoomRequest(room=room))
        finally:
            await lkapi.aclose()
        return {"room": room, "deleted": True, "live": True}
    return {"room": room, "deleted": True, "live": False}
