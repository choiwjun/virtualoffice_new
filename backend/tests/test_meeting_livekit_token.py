"""
LiveKit 토큰 엔드포인트 테스트 (C3, D24 — 정본 /api/meetings/{id}/livekit-token).

검증:
1. 미인증 → 401/403
2. 참석자 아님 → 403
3. 참석자 → 200 + 올바른 클레임(identity=user_id, video.room=livekit_room)의 서명 토큰
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import jwt
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.tables import Meeting, MeetingParticipant, MeetingParticipantRole


async def _seed_meeting(db: AsyncSession, livekit_room: str = "room-abc", participant_uid: int | None = 1):
    mid = uuid4()
    now = datetime.now(timezone.utc)
    db.add(
        Meeting(
            id=mid, room_id=uuid4(), host_user_id=1, title="T",
            scheduled_at=now, livekit_room=livekit_room,
        )
    )
    if participant_uid is not None:
        db.add(
            MeetingParticipant(
                id=uuid4(), meeting_id=mid, user_id=participant_uid,
                invited_at=now, joined_at=now, role=MeetingParticipantRole.PARTICIPANT,
            )
        )
    await db.commit()
    return mid


class TestLivekitToken:
    async def test_requires_auth(self, async_client: AsyncClient):
        r = await async_client.post(f"/api/meetings/{uuid4()}/livekit-token")
        assert r.status_code in (401, 403)

    async def test_non_participant_403(
        self, async_client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ):
        mid = await _seed_meeting(db_session, participant_uid=None)
        r = await async_client.post(f"/api/meetings/{mid}/livekit-token", headers=auth_headers)
        assert r.status_code == 403

    async def test_participant_gets_signed_token(
        self, async_client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ):
        mid = await _seed_meeting(db_session, livekit_room="room-abc", participant_uid=1)
        r = await async_client.post(f"/api/meetings/{mid}/livekit-token", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["room"] == "room-abc"
        assert data["url"] == settings.livekit_url

        # LiveKit 토큰은 livekit_api_secret로 HS256 서명 → 복호+클레임 검증
        claims = jwt.decode(data["token"], settings.livekit_api_secret, algorithms=["HS256"])
        assert claims["sub"] == "1"  # identity = 로그인 user_id(=employee_token sub)
        assert "video" in claims
        assert claims["video"]["room"] == "room-abc"
        assert claims["video"].get("roomJoin") is True

    async def test_defaults_room_when_unset(
        self, async_client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ):
        mid = await _seed_meeting(db_session, livekit_room=None, participant_uid=1)
        r = await async_client.post(f"/api/meetings/{mid}/livekit-token", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["room"] == f"meeting-{mid}"
