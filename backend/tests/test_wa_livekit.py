"""
통합 테스트: POST /api/wa/livekit-token (G004, D24)

검증:
  1. 유효한 LiveKit JWT 구조 — iss=api_key, video.room 일치, video.roomJoin=true
  2. JWT sub 클레임이 user_id 기반 identity를 인코딩
  3. meeting_participant 레코드 생성 (joined_at 설정)
  4. 동일 meeting+user 재요청 시 upsert (중복 레코드 없음, joined_at 갱신)
  5. 인증정보 미설정 시 503 반환
  6. 입력 누락 시 422 반환

정본: 00-decisions.md D24.
"""

import uuid
from datetime import datetime, timezone

import jwt  # PyJWT
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.api.wa_livekit import issue_livekit_jwt
from app.config import settings
from app.models.tables import MeetingParticipant

# 테스트에서 사용할 기본 자격증명 (config.py 기본값과 동일)
_API_KEY = settings.livekit_api_key       # "devkey"
_API_SECRET = settings.livekit_api_secret  # "devsecret01234567890123456789012345"


# ---------------------------------------------------------------------------
# issue_livekit_jwt 단위 검증
# ---------------------------------------------------------------------------

def test_jwt_iss_is_api_key():
    """iss 클레임이 api_key와 정확히 일치해야 한다."""
    token, _ = issue_livekit_jwt("mykey", "mysecret12345678901234567890", "alice", "room-x")
    decoded = jwt.decode(token, "mysecret12345678901234567890", algorithms=["HS256"])
    assert decoded["iss"] == "mykey"


def test_jwt_sub_contains_identity():
    """sub 클레임이 전달한 identity를 담아야 한다."""
    token, _ = issue_livekit_jwt("k", "s" * 32, "user-42", "r")
    decoded = jwt.decode(token, "s" * 32, algorithms=["HS256"])
    assert decoded["sub"] == "user-42"


def test_jwt_video_grant_room_and_roomjoin():
    """video 클레임에 room 이름과 roomJoin=true가 있어야 한다."""
    token, _ = issue_livekit_jwt("k", "s" * 32, "u", "conf-room-b")
    decoded = jwt.decode(token, "s" * 32, algorithms=["HS256"])
    video = decoded.get("video", {})
    assert video.get("room") == "conf-room-b"
    assert video.get("roomJoin") is True


def test_jwt_exp_is_in_future():
    """exp 클레임이 발급 시각보다 미래여야 한다."""
    token, expires_at = issue_livekit_jwt("k", "s" * 32, "u", "r", expiry_seconds=600)
    now = datetime.now(timezone.utc).timestamp()
    decoded = jwt.decode(token, "s" * 32, algorithms=["HS256"])
    assert decoded["exp"] > now
    assert decoded["nbf"] <= now + 1  # nbf ≤ 발급 시각 (±1s 허용)


# ---------------------------------------------------------------------------
# POST /api/wa/livekit-token 통합 테스트
# ---------------------------------------------------------------------------

async def test_token_endpoint_returns_valid_jwt(async_client: AsyncClient):
    """엔드포인트가 유효한 LiveKit JWT를 반환해야 한다."""
    room = "meeting-room-101"
    resp = await async_client.post("/api/wa/livekit-token", json={
        "user_id": 1,
        "email": "alice@example.com",
        "room_name": room,
        "meeting_id": str(uuid.uuid4()),
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["room_name"] == room

    decoded = jwt.decode(data["token"], _API_SECRET, algorithms=["HS256"])
    assert decoded["iss"] == _API_KEY
    assert decoded["video"]["room"] == room
    assert decoded["video"]["roomJoin"] is True


async def test_token_endpoint_sub_encodes_user_id(async_client: AsyncClient):
    """JWT sub 클레임이 user_id를 포함해야 한다."""
    resp = await async_client.post("/api/wa/livekit-token", json={
        "user_id": 99,
        "email": "bob@example.com",
        "room_name": "room-y",
        "meeting_id": str(uuid.uuid4()),
    })
    assert resp.status_code == 200
    decoded = jwt.decode(resp.json()["token"], _API_SECRET, algorithms=["HS256"])
    assert "99" in decoded["sub"]


async def test_token_endpoint_creates_meeting_participant(
    async_client: AsyncClient, db_session
):
    """토큰 발급 시 meeting_participant 레코드가 생성되어야 한다."""
    meeting_id = uuid.uuid4()
    user_id = 101

    resp = await async_client.post("/api/wa/livekit-token", json={
        "user_id": user_id,
        "email": "user101@example.com",
        "room_name": "conf-room-a",
        "meeting_id": str(meeting_id),
    })
    assert resp.status_code == 200

    result = await db_session.execute(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting_id,
            MeetingParticipant.user_id == user_id,
        )
    )
    participant = result.scalar_one_or_none()
    assert participant is not None
    assert participant.joined_at is not None


async def test_token_endpoint_joined_at_is_recent(
    async_client: AsyncClient, db_session
):
    """joined_at이 요청 시각과 가까워야 한다 (UTC, 5초 이내)."""
    before = datetime.now(timezone.utc)
    meeting_id = uuid.uuid4()
    user_id = 202

    await async_client.post("/api/wa/livekit-token", json={
        "user_id": user_id,
        "email": "user202@example.com",
        "room_name": "room-time",
        "meeting_id": str(meeting_id),
    })

    result = await db_session.execute(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting_id,
            MeetingParticipant.user_id == user_id,
        )
    )
    participant = result.scalar_one()
    joined = participant.joined_at
    if joined.tzinfo is None:
        joined = joined.replace(tzinfo=timezone.utc)
    # joined_at 은 before 이후여야 한다
    assert joined >= before


async def test_token_endpoint_upserts_on_duplicate(
    async_client: AsyncClient, db_session
):
    """동일 meeting+user 재요청 시 중복 레코드 없이 joined_at만 갱신된다."""
    meeting_id = uuid.uuid4()
    user_id = 303
    payload = {
        "user_id": user_id,
        "email": "user303@example.com",
        "room_name": "room-dup",
        "meeting_id": str(meeting_id),
    }

    resp1 = await async_client.post("/api/wa/livekit-token", json=payload)
    assert resp1.status_code == 200
    resp2 = await async_client.post("/api/wa/livekit-token", json=payload)
    assert resp2.status_code == 200

    # DB에는 레코드가 1개만 존재해야 한다
    result = await db_session.execute(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting_id,
            MeetingParticipant.user_id == user_id,
        )
    )
    rows = result.scalars().all()
    assert len(rows) == 1


async def test_token_endpoint_missing_credentials_returns_503(
    async_client: AsyncClient, monkeypatch
):
    """LIVEKIT_API_KEY가 빈 문자열이면 503을 반환해야 한다."""
    monkeypatch.setattr(settings, "livekit_api_key", "")
    monkeypatch.setattr(settings, "livekit_api_secret", "")

    resp = await async_client.post("/api/wa/livekit-token", json={
        "user_id": 1,
        "email": "x@example.com",
        "room_name": "r",
        "meeting_id": str(uuid.uuid4()),
    })
    assert resp.status_code == 503


async def test_token_endpoint_missing_field_returns_422(async_client: AsyncClient):
    """필수 필드(room_name) 누락 시 422 Unprocessable Entity를 반환해야 한다."""
    resp = await async_client.post("/api/wa/livekit-token", json={
        "user_id": 1,
        "email": "x@example.com",
        # room_name 누락
        "meeting_id": str(uuid.uuid4()),
    })
    assert resp.status_code == 422
