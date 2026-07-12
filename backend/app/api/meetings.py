"""
meetings API — G002 Lane B

POST   /api/meetings                        — 회의 예약
GET    /api/meetings                        — 회의 목록 (scheduled_at 범위 필터)
GET    /api/meetings/{meeting_id}           — 회의 상세
POST   /api/meetings/{meeting_id}/join      — 참석 등록 (upsert)
GET    /api/meetings/{meeting_id}/participants — 참석자 목록

D23: 동일 room + 시간 겹침 → 409
D19: UTC 저장
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from livekit import api as livekit_api
from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import (
    Meeting,
    MeetingParticipant,
    MeetingParticipantRole,
    MeetingStatus,
    Room,
)
from app.services.audit import record_audit

router = APIRouter(prefix="/api", tags=["meetings"])


# ---------------------------------------------------------------------------
# 스키마
# ---------------------------------------------------------------------------


class MeetingCreate(BaseModel):
    room_id: str
    title: str
    description: Optional[str] = None
    scheduled_at: datetime          # UTC ISO8601
    host_user_id: Optional[int] = None  # None → current_user
    livekit_room: Optional[str] = None


class MeetingOut(BaseModel):
    id: str
    room_id: str
    title: str
    description: Optional[str]
    scheduled_at: str
    started_at: Optional[str]
    ended_at: Optional[str]
    status: str
    host_user_id: int
    livekit_room: Optional[str]
    recording_url: Optional[str]
    created_at: str
    updated_at: str


class MeetingParticipantOut(BaseModel):
    id: str
    meeting_id: str
    user_id: int
    invited_at: str
    joined_at: Optional[str]
    left_at: Optional[str]
    role: str
    created_at: str


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------


def _meeting_out(m: Meeting) -> MeetingOut:
    return MeetingOut(
        id=str(m.id),
        room_id=str(m.room_id),
        title=m.title,
        description=m.description,
        scheduled_at=m.scheduled_at.isoformat(),
        started_at=m.started_at.isoformat() if m.started_at else None,
        ended_at=m.ended_at.isoformat() if m.ended_at else None,
        status=m.status.value,
        host_user_id=m.host_user_id,
        livekit_room=m.livekit_room,
        recording_url=m.recording_url,
        created_at=m.created_at.isoformat(),
        updated_at=m.updated_at.isoformat(),
    )


def _participant_out(p: MeetingParticipant) -> MeetingParticipantOut:
    return MeetingParticipantOut(
        id=str(p.id),
        meeting_id=str(p.meeting_id),
        user_id=p.user_id,
        invited_at=p.invited_at.isoformat(),
        joined_at=p.joined_at.isoformat() if p.joined_at else None,
        left_at=p.left_at.isoformat() if p.left_at else None,
        role=p.role.value,
        created_at=p.created_at.isoformat(),
    )


async def _get_meeting_or_404(
    meeting_id: str, db: AsyncSession
) -> Meeting:
    try:
        mid = UUID(meeting_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid meeting_id",
        )
    result = await db.execute(select(Meeting).where(Meeting.id == mid))
    meeting = result.scalar_one_or_none()
    if meeting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="meeting_not_found",
        )
    return meeting


# ---------------------------------------------------------------------------
# 엔드포인트
# ---------------------------------------------------------------------------


@router.post(
    "/meetings",
    response_model=MeetingOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_meeting(
    body: MeetingCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingOut:
    """POST /api/meetings — 회의 예약 (D23: room 시간겹침 409)."""
    try:
        room_uuid = UUID(body.room_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid room_id",
        )

    # room 존재 확인
    room_result = await db.execute(select(Room).where(Room.id == room_uuid))
    if room_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="room_not_found",
        )

    host_user_id = body.host_user_id if body.host_user_id is not None else current_user.user_id

    # scheduled_at UTC 보장
    scheduled_at = body.scheduled_at
    if scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)

    # D23: 동일 room 시간겹침 검사 (취소된 회의 제외)
    # 겹침 조건: existing.scheduled_at < new (we treat each meeting as instantaneous point;
    # for safety check ±0 overlap — any other non-cancelled meeting at same time or
    # strictly overlapping [started_at, ended_at] window)
    overlap_q = select(Meeting).where(
        and_(
            Meeting.room_id == room_uuid,
            Meeting.status != MeetingStatus.CANCELLED,
            # ended_at이 없으면 scheduled_at을 종료 시점으로 가정
            # 새 회의 scheduled_at이 기존 회의 [scheduled_at, ended_at or scheduled_at] 안에 들면 겹침
            or_(
                and_(
                    Meeting.ended_at.is_(None),
                    Meeting.scheduled_at == scheduled_at,
                ),
                and_(
                    Meeting.ended_at.isnot(None),
                    Meeting.scheduled_at <= scheduled_at,
                    Meeting.ended_at > scheduled_at,
                ),
                and_(
                    Meeting.ended_at.is_(None),
                    Meeting.scheduled_at > scheduled_at,
                    # 이 회의가 새 회의보다 나중에 시작하지만 아직 끝나지 않은 겹침은 없음
                    # 정확한 겹침: 새 meeting도 예상 종료 없으므로 시작 시각 동일만 체크
                ),
            ),
        )
    )
    overlap_result = await db.execute(overlap_q)
    if overlap_result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="room_time_conflict",
        )

    meeting = Meeting(
        id=uuid4(),
        room_id=room_uuid,
        title=body.title,
        description=body.description,
        scheduled_at=scheduled_at,
        host_user_id=host_user_id,
        status=MeetingStatus.SCHEDULED,
        livekit_room=body.livekit_room,
    )
    db.add(meeting)
    await db.flush()
    await db.commit()
    await db.refresh(meeting)
    return _meeting_out(meeting)


@router.get("/meetings", response_model=list[MeetingOut])
async def list_meetings(
    scheduled_from: Optional[str] = Query(None, description="ISO8601 UTC 시작"),
    scheduled_to: Optional[str] = Query(None, description="ISO8601 UTC 종료"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MeetingOut]:
    """GET /api/meetings — 회의 목록 (scheduled_at 범위 캘린더 필터)."""
    q = select(Meeting)
    if scheduled_from:
        try:
            dt_from = datetime.fromisoformat(scheduled_from.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid scheduled_from",
            )
        q = q.where(Meeting.scheduled_at >= dt_from)
    if scheduled_to:
        try:
            dt_to = datetime.fromisoformat(scheduled_to.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid scheduled_to",
            )
        q = q.where(Meeting.scheduled_at <= dt_to)

    q = q.order_by(Meeting.scheduled_at)
    result = await db.execute(q)
    meetings = result.scalars().all()
    return [_meeting_out(m) for m in meetings]


@router.get("/meetings/{meeting_id}", response_model=MeetingOut)
async def get_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingOut:
    """GET /api/meetings/{meeting_id} — 회의 상세."""
    meeting = await _get_meeting_or_404(meeting_id, db)
    return _meeting_out(meeting)


@router.post(
    "/meetings/{meeting_id}/join",
    response_model=MeetingParticipantOut,
    status_code=status.HTTP_200_OK,
)
async def join_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingParticipantOut:
    """POST /api/meetings/{meeting_id}/join — 참석 등록 (upsert joined_at)."""
    meeting = await _get_meeting_or_404(meeting_id, db)

    now = datetime.now(timezone.utc)

    # upsert: 이미 participant 행이 있으면 joined_at만 갱신
    existing_q = await db.execute(
        select(MeetingParticipant).where(
            and_(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.user_id == current_user.user_id,
            )
        )
    )
    participant = existing_q.scalar_one_or_none()

    if participant is None:
        participant = MeetingParticipant(
            id=uuid4(),
            meeting_id=meeting.id,
            user_id=current_user.user_id,
            invited_at=now,
            joined_at=now,
            role=MeetingParticipantRole.PARTICIPANT,
        )
        db.add(participant)
    else:
        participant.joined_at = now

    await db.flush()
    await db.commit()
    await db.refresh(participant)
    return _participant_out(participant)


class LivekitTokenOut(BaseModel):
    token: str
    url: str
    room: str


@router.post("/meetings/{meeting_id}/livekit-token", response_model=LivekitTokenOut)
async def meeting_livekit_token(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LivekitTokenOut:
    """
    POST /api/meetings/{id}/livekit-token — 참석자에게 LiveKit 룸 접속 토큰 발급 (C3, D24, G004).

    정본 경로(WA 제거로 신설, 구 /api/wa/livekit-token 대체). 참석 등록(join)된 사용자만 발급.
    서버가 발급 주체 → 클라이언트가 room_name/identity를 위조할 수 없다.
    """
    meeting = await _get_meeting_or_404(meeting_id, db)

    q = await db.execute(
        select(MeetingParticipant).where(
            and_(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.user_id == current_user.user_id,
            )
        )
    )
    if q.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="not a participant — join the meeting first",
        )

    room_name = meeting.livekit_room or f"meeting-{meeting.id}"
    token = (
        livekit_api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(str(current_user.user_id))
        .with_name(current_user.email or str(current_user.user_id))
        .with_grants(
            livekit_api.VideoGrants(
                room_join=True, room=room_name, can_publish=True, can_subscribe=True
            )
        )
        .with_ttl(timedelta(seconds=settings.livekit_token_expiry_seconds))
        .to_jwt()
    )
    return LivekitTokenOut(token=token, url=settings.livekit_url, room=room_name)


@router.get(
    "/meetings/{meeting_id}/participants",
    response_model=list[MeetingParticipantOut],
)
async def list_participants(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MeetingParticipantOut]:
    """GET /api/meetings/{meeting_id}/participants — 참석자 목록."""
    meeting = await _get_meeting_or_404(meeting_id, db)
    result = await db.execute(
        select(MeetingParticipant)
        .where(MeetingParticipant.meeting_id == meeting.id)
        .order_by(MeetingParticipant.joined_at)
    )
    participants = result.scalars().all()
    return [_participant_out(p) for p in participants]


# ---------------------------------------------------------------------------
# 회의 수정/취소 (관리자·리더) — management-api.yaml
# ---------------------------------------------------------------------------

_MTG_ADMIN = ("admin", "super_admin", "leader")


class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    room_id: Optional[str] = None


@router.put("/meetings/{meeting_id}", response_model=MeetingOut)
async def update_meeting(
    meeting_id: str,
    body: MeetingUpdate,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_MTG_ADMIN)),
) -> MeetingOut:
    """PUT /api/meetings/{id} — 회의 수정 (D23 시간겹침 재검증, 취소된 회의 제외·자기 자신 제외)."""
    meeting = await _get_meeting_or_404(meeting_id, db)
    if meeting.status == MeetingStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="meeting_cancelled")

    new_room = meeting.room_id
    if body.room_id is not None:
        try:
            new_room = UUID(body.room_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid room_id")
    new_time = meeting.scheduled_at
    if body.scheduled_at is not None:
        new_time = body.scheduled_at
        if new_time.tzinfo is None:
            new_time = new_time.replace(tzinfo=timezone.utc)

    # D23: 동일 room·동일 시각 다른 회의 겹침 재검증 (자기 자신 제외)
    if body.room_id is not None or body.scheduled_at is not None:
        clash = (
            await db.execute(
                select(Meeting).where(
                    and_(
                        Meeting.room_id == new_room,
                        Meeting.id != meeting.id,
                        Meeting.status != MeetingStatus.CANCELLED,
                        Meeting.scheduled_at == new_time,
                    )
                )
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="room_time_conflict")

    if body.title is not None:
        meeting.title = body.title
    if body.description is not None:
        meeting.description = body.description
    meeting.room_id = new_room
    meeting.scheduled_at = new_time
    meeting.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(meeting)
    await record_audit(db, user_id=user.user_id, action="meeting_updated", entity_type="meeting", entity_id=str(meeting.id), new_value={"title": meeting.title, "scheduled_at": meeting.scheduled_at.isoformat()})
    return _meeting_out(meeting)


@router.delete("/meetings/{meeting_id}", response_model=MeetingOut)
async def cancel_meeting(
    meeting_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_MTG_ADMIN)),
) -> MeetingOut:
    """DELETE /api/meetings/{id} — 회의 취소 (soft, status=cancelled)."""
    meeting = await _get_meeting_or_404(meeting_id, db)
    meeting.status = MeetingStatus.CANCELLED
    meeting.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(meeting)
    await record_audit(db, user_id=user.user_id, action="meeting_cancelled", entity_type="meeting", entity_id=str(meeting.id))
    return _meeting_out(meeting)
