"""
WorkAdventure LiveKit 토큰 발급 라우터.

D24: 회의실 zone 진입 시 자동 연결 금지 — 명시적 입장 확인 다이얼로그 →
     이 엔드포인트 호출 → LiveKit JWT 발급 + meeting_participant 기록.

LiveKit JWT 규약 (https://docs.livekit.io/home/server/generating-tokens/):
  - iss = API key
  - sub = participant identity (user-{user_id})
  - exp = 만료 (기본 1h)
  - nbf = not-before (발급 시각)
  - video = {"room": room_name, "roomJoin": true, "canPublish": true,
             "canSubscribe": true, "canPublishData": true}
  - 서명: HMAC-SHA256(api_secret)

정본: 00-decisions.md D24, 11-tech-stack.md (PyJWT HS256).
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt  # PyJWT
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models.tables import MeetingParticipant, MeetingParticipantRole

router = APIRouter(prefix="/api/wa", tags=["workadventure"])


# ---------------------------------------------------------------------------
# Request / Response 스키마
# ---------------------------------------------------------------------------

class LiveKitTokenRequest(BaseModel):
    """LiveKit 토큰 요청 페이로드."""
    user_id: int           # erp_user.id (meeting_participant FK)
    email: str             # 표시용; JWT 에는 sub(user-{id}) 사용
    room_name: str         # LiveKit room 이름 (= WA 회의실 zone 식별자)
    meeting_id: uuid.UUID  # meeting.id (meeting_participant FK)


class LiveKitTokenResponse(BaseModel):
    """LiveKit 토큰 응답."""
    token: str             # LiveKit JWT (WA 또는 LiveKit SDK에 직접 전달)
    room_name: str
    participant_id: str    # JWT sub (LiveKit identity)
    expires_at: datetime   # 만료 시각 (UTC)


# ---------------------------------------------------------------------------
# JWT 발급 헬퍼
# ---------------------------------------------------------------------------

def issue_livekit_jwt(
    api_key: str,
    api_secret: str,
    identity: str,
    room_name: str,
    expiry_seconds: int = 3600,
) -> tuple[str, datetime]:
    """
    LiveKit 규약에 맞는 JWT를 PyJWT HS256으로 발급한다.

    반환: (jwt_string, expires_at_utc)
    """
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=expiry_seconds)

    payload: dict = {
        "iss": api_key,                       # LiveKit: 발급자 = API key
        "sub": identity,                      # LiveKit: participant identity
        "exp": int(expires_at.timestamp()),
        "nbf": int(now.timestamp()),
        "video": {
            "room": room_name,
            "roomJoin": True,                 # 룸 입장 권한
            "canPublish": True,               # 오디오/비디오 송출
            "canSubscribe": True,             # 수신
            "canPublishData": True,           # 데이터 채널
        },
    }

    token: str = jwt.encode(payload, api_secret, algorithm="HS256")
    return token, expires_at


# ---------------------------------------------------------------------------
# 엔드포인트
# ---------------------------------------------------------------------------

@router.post("/livekit-token", response_model=LiveKitTokenResponse)
async def issue_livekit_token(
    body: LiveKitTokenRequest,
    db: AsyncSession = Depends(get_db),
) -> LiveKitTokenResponse:
    """
    POST /api/wa/livekit-token — LiveKit 토큰 발급 + 입장 기록.

    D24 명시적 입장 흐름:
      1. WA scripting API onEnterZone → 팝업 표시 (자동 연결 금지)
      2. 사용자가 "입장" 클릭 → 이 엔드포인트 호출
      3. LiveKit JWT 발급 → WA/클라이언트가 LiveKit 룸 연결
      4. meeting_participant 레코드 upsert (joined_at 기록)

    Phase 2+: LiveKit Server API로 룸 존재 확인 및 사전 생성 가능.
    """
    if not settings.livekit_api_key or not settings.livekit_api_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit API 자격증명이 설정되지 않았습니다.",
        )

    identity = f"user-{body.user_id}"
    token, expires_at = issue_livekit_jwt(
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
        identity=identity,
        room_name=body.room_name,
        expiry_seconds=settings.livekit_token_expiry_seconds,
    )

    # meeting_participant upsert:
    #   동일 (meeting_id, user_id) 가 이미 존재하면 joined_at 갱신,
    #   없으면 신규 생성. (D23 FCFS + D24 명시 입장 기록)
    now = datetime.now(timezone.utc)

    stmt = select(MeetingParticipant).where(
        MeetingParticipant.meeting_id == body.meeting_id,
        MeetingParticipant.user_id == body.user_id,
    )
    result = await db.execute(stmt)
    participant = result.scalar_one_or_none()

    if participant is None:
        participant = MeetingParticipant(
            meeting_id=body.meeting_id,
            user_id=body.user_id,
            invited_at=now,   # D23 FCFS: 토큰 요청 시각 = 초대 시각으로 처리
            joined_at=now,    # D24: 명시 입장 시각
            role=MeetingParticipantRole.PARTICIPANT,
        )
        db.add(participant)
    else:
        participant.joined_at = now  # 재입장: 최신 joined_at 갱신

    await db.commit()

    return LiveKitTokenResponse(
        token=token,
        room_name=body.room_name,
        participant_id=identity,
        expires_at=expires_at,
    )
