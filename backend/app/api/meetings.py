"""
meetings API — G002 Lane B

POST   /api/meetings                        — 회의 예약 (duration_minutes 포함)
GET    /api/meetings                        — 회의 목록 (scheduled_at 범위·status 필터)
GET    /api/meetings/{meeting_id}           — 회의 상세
POST   /api/meetings/{meeting_id}/start     — 시작 (scheduled → in_progress, 호스트/관리자)
POST   /api/meetings/{meeting_id}/end       — 종료 (in_progress → completed, 호스트/관리자)
POST   /api/meetings/{meeting_id}/join      — 참석 등록 (upsert, 상태·정원 검사)
POST   /api/meetings/{meeting_id}/leave     — 퇴장 (left_at 기록)
GET    /api/meetings/{meeting_id}/participants — 참석자 목록
GET    /api/rooms                           — 회의 가능한 방 목록 (예약 피커용)

D23: 동일 room + 시간대 [scheduled_at, +duration) 겹침 → 409
D19: UTC 저장
상태 전이 (06 §3.5.1): scheduled → in_progress → completed | scheduled → cancelled
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from livekit import api as livekit_api
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import (
    ErpUser,
    InviteStatus,
    Meeting,
    MeetingParticipant,
    MeetingParticipantRole,
    MeetingStatus,
    Room,
    RoomStatus,
    RoomType,
)
from app.services.audit import record_audit

router = APIRouter(prefix="/api", tags=["meetings"])


# ---------------------------------------------------------------------------
# 스키마
# ---------------------------------------------------------------------------


MAX_DURATION_MINUTES = 480


class MeetingCreate(BaseModel):
    room_id: str
    title: str
    description: Optional[str] = None
    scheduled_at: datetime          # UTC ISO8601
    duration_minutes: int = Field(60, ge=15, le=MAX_DURATION_MINUTES, description="계획 소요시간(분)")
    host_user_id: Optional[int] = None  # None → current_user
    livekit_room: Optional[str] = None


class MeetingOut(BaseModel):
    id: str
    room_id: str
    title: str
    description: Optional[str]
    scheduled_at: str
    duration_minutes: int
    started_at: Optional[str]
    ended_at: Optional[str]
    status: str
    host_user_id: int
    livekit_room: Optional[str]
    recording_url: Optional[str]
    participant_count: int = 0
    created_at: str
    updated_at: str


class RoomOut(BaseModel):
    id: str
    name: str
    type: str
    capacity: int
    floor_id: str


class MeetingParticipantOut(BaseModel):
    id: str
    meeting_id: str
    user_id: int
    user_name: Optional[str] = None
    invited_at: str
    joined_at: Optional[str]
    left_at: Optional[str]
    role: str
    invite_status: str = "invited"
    created_at: str


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------


def _meeting_out(m: Meeting, participant_count: int = 0) -> MeetingOut:
    return MeetingOut(
        id=str(m.id),
        room_id=str(m.room_id),
        title=m.title,
        description=m.description,
        scheduled_at=m.scheduled_at.isoformat(),
        duration_minutes=m.duration_minutes or 60,
        started_at=m.started_at.isoformat() if m.started_at else None,
        ended_at=m.ended_at.isoformat() if m.ended_at else None,
        status=m.status.value,
        host_user_id=m.host_user_id,
        livekit_room=m.livekit_room,
        recording_url=m.recording_url,
        participant_count=participant_count,
        created_at=m.created_at.isoformat(),
        updated_at=m.updated_at.isoformat(),
    )


def _as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


async def _participant_counts(db: AsyncSession, meeting_ids: list) -> dict:
    """meeting_id → 참석자 수 (participant 행 기준)."""
    if not meeting_ids:
        return {}
    rows = (
        await db.execute(
            select(MeetingParticipant.meeting_id, func.count(MeetingParticipant.id))
            .where(MeetingParticipant.meeting_id.in_(meeting_ids))
            .group_by(MeetingParticipant.meeting_id)
        )
    ).all()
    return {mid: cnt for mid, cnt in rows}


async def _check_room_conflict(
    db: AsyncSession,
    room_uuid: UUID,
    new_start: datetime,
    new_duration_min: int,
    exclude_meeting_id: Optional[UUID] = None,
) -> None:
    """D23: 동일 room 시간대 겹침 검사 — [start, start+duration) 창 기준.

    SQLite/PG 양쪽 호환을 위해 후보(±최대 회의시간 창)를 조회 후 Python에서 겹침 판정.
    """
    new_end = new_start + timedelta(minutes=new_duration_min)
    window_lo = new_start - timedelta(minutes=MAX_DURATION_MINUTES)
    q = select(Meeting).where(
        and_(
            Meeting.room_id == room_uuid,
            Meeting.status != MeetingStatus.CANCELLED,
            Meeting.scheduled_at >= window_lo,
            Meeting.scheduled_at < new_end,
        )
    )
    if exclude_meeting_id is not None:
        q = q.where(Meeting.id != exclude_meeting_id)
    candidates = (await db.execute(q)).scalars().all()
    for m in candidates:
        m_start = _as_utc(m.scheduled_at)
        m_end = m_start + timedelta(minutes=m.duration_minutes or 60)
        if m_start < new_end and new_start < m_end:  # 반개구간 겹침
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="room_time_conflict",
            )


def _participant_out(p: MeetingParticipant, user_name: Optional[str] = None) -> MeetingParticipantOut:
    return MeetingParticipantOut(
        id=str(p.id),
        meeting_id=str(p.meeting_id),
        user_id=p.user_id,
        user_name=user_name,
        invited_at=p.invited_at.isoformat(),
        joined_at=p.joined_at.isoformat() if p.joined_at else None,
        left_at=p.left_at.isoformat() if p.left_at else None,
        role=p.role.value,
        invite_status=p.invite_status.value if hasattr(p.invite_status, "value") else (p.invite_status or "invited"),
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
    scheduled_at = _as_utc(body.scheduled_at)

    # D23: 동일 room 시간대 겹침 검사 ([start, start+duration) 반개구간)
    await _check_room_conflict(db, room_uuid, scheduled_at, body.duration_minutes)

    now = datetime.now(timezone.utc)
    meeting = Meeting(
        id=uuid4(),
        room_id=room_uuid,
        title=body.title,
        description=body.description,
        scheduled_at=scheduled_at,
        duration_minutes=body.duration_minutes,
        host_user_id=host_user_id,
        status=MeetingStatus.SCHEDULED,
        livekit_room=body.livekit_room,
    )
    db.add(meeting)
    # 호스트를 organizer 참석자로 자동 등록 (06 §3.5.1) — 본인이므로 수락 상태
    db.add(MeetingParticipant(
        id=uuid4(),
        meeting_id=meeting.id,
        user_id=host_user_id,
        invited_at=now,
        role=MeetingParticipantRole.ORGANIZER,
        invite_status=InviteStatus.ACCEPTED,
    ))
    await db.flush()
    await db.commit()
    await db.refresh(meeting)
    return _meeting_out(meeting, participant_count=1)


@router.get("/rooms", response_model=list[RoomOut])
async def list_rooms(
    room_type: Optional[str] = Query(None, alias="type", description="meeting_room 등 RoomType 필터"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[RoomOut]:
    """GET /api/rooms — 예약 가능한 방 목록 (06 §3.5.1 회의실 선택 피커)."""
    q = select(Room).where(Room.status == RoomStatus.ACTIVE)
    if room_type:
        try:
            rt = RoomType(room_type)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_room_type")
        q = q.where(Room.type == rt)
    rooms = (await db.execute(q.order_by(Room.name))).scalars().all()
    return [
        RoomOut(id=str(r.id), name=r.name, type=r.type.value, capacity=r.capacity, floor_id=str(r.floor_id))
        for r in rooms
    ]


@router.get("/meetings", response_model=list[MeetingOut])
async def list_meetings(
    scheduled_from: Optional[str] = Query(None, description="ISO8601 UTC 시작"),
    scheduled_to: Optional[str] = Query(None, description="ISO8601 UTC 종료"),
    status_filter: Optional[str] = Query(None, alias="status", description="scheduled|in_progress|completed|cancelled"),
    limit: int = Query(200, ge=1, le=500),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MeetingOut]:
    """GET /api/meetings — 회의 목록 (scheduled_at 범위·status 필터, participant_count 포함)."""
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
    if status_filter:
        try:
            st = MeetingStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid status: must be scheduled|in_progress|completed|cancelled",
            )
        q = q.where(Meeting.status == st)

    q = q.order_by(Meeting.scheduled_at).limit(limit)
    result = await db.execute(q)
    meetings = result.scalars().all()
    counts = await _participant_counts(db, [m.id for m in meetings])
    return [_meeting_out(m, counts.get(m.id, 0)) for m in meetings]


@router.get("/meetings/{meeting_id}", response_model=MeetingOut)
async def get_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingOut:
    """GET /api/meetings/{meeting_id} — 회의 상세."""
    meeting = await _get_meeting_or_404(meeting_id, db)
    counts = await _participant_counts(db, [meeting.id])
    return _meeting_out(meeting, counts.get(meeting.id, 0))


@router.post("/meetings/{meeting_id}/start", response_model=MeetingOut)
async def start_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingOut:
    """POST /api/meetings/{id}/start — scheduled → in_progress (호스트 또는 관리자, 06 §3.5.1)."""
    meeting = await _get_meeting_or_404(meeting_id, db)
    if meeting.host_user_id != current_user.user_id and current_user.role not in _MTG_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="host_or_admin_required")
    if meeting.status != MeetingStatus.SCHEDULED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="invalid_status_transition")

    now = datetime.now(timezone.utc)
    meeting.status = MeetingStatus.IN_PROGRESS
    meeting.started_at = now
    meeting.updated_at = now
    await db.commit()
    await db.refresh(meeting)
    await record_audit(db, user_id=current_user.user_id, action="meeting_started",
                       entity_type="meeting", entity_id=str(meeting.id))
    counts = await _participant_counts(db, [meeting.id])
    return _meeting_out(meeting, counts.get(meeting.id, 0))


@router.post("/meetings/{meeting_id}/end", response_model=MeetingOut)
async def end_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingOut:
    """POST /api/meetings/{id}/end — in_progress → completed (호스트 또는 관리자)."""
    meeting = await _get_meeting_or_404(meeting_id, db)
    if meeting.host_user_id != current_user.user_id and current_user.role not in _MTG_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="host_or_admin_required")
    if meeting.status != MeetingStatus.IN_PROGRESS:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="invalid_status_transition")

    now = datetime.now(timezone.utc)
    meeting.status = MeetingStatus.COMPLETED
    meeting.ended_at = now
    meeting.updated_at = now
    # 아직 나가지 않은 참석자 left_at 일괄 기록
    open_participants = (
        await db.execute(
            select(MeetingParticipant).where(
                and_(
                    MeetingParticipant.meeting_id == meeting.id,
                    MeetingParticipant.joined_at.isnot(None),
                    MeetingParticipant.left_at.is_(None),
                )
            )
        )
    ).scalars().all()
    for p in open_participants:
        p.left_at = now
    await db.commit()
    await db.refresh(meeting)
    await record_audit(db, user_id=current_user.user_id, action="meeting_ended",
                       entity_type="meeting", entity_id=str(meeting.id))
    counts = await _participant_counts(db, [meeting.id])
    return _meeting_out(meeting, counts.get(meeting.id, 0))


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
    """POST /api/meetings/{meeting_id}/join — 참석 등록 (upsert joined_at).

    06 §5.2: 취소/종료된 회의 입장 409, 방 정원 초과 409.
    """
    meeting = await _get_meeting_or_404(meeting_id, db)

    if meeting.status in (MeetingStatus.CANCELLED, MeetingStatus.COMPLETED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="meeting_not_joinable")

    now = datetime.now(timezone.utc)

    # 방 정원 검사 (현재 입장 중 = joined_at 있고 left_at 없음)
    room = (await db.execute(select(Room).where(Room.id == meeting.room_id))).scalar_one_or_none()
    if room is not None:
        active_count = (
            await db.execute(
                select(func.count(MeetingParticipant.id)).where(
                    and_(
                        MeetingParticipant.meeting_id == meeting.id,
                        MeetingParticipant.joined_at.isnot(None),
                        MeetingParticipant.left_at.is_(None),
                        MeetingParticipant.user_id != current_user.user_id,
                    )
                )
            )
        ).scalar_one()
        if active_count >= room.capacity:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="room_capacity_exceeded")

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
            invite_status=InviteStatus.ACCEPTED,  # self-join = 수락
        )
        db.add(participant)
    else:
        participant.joined_at = now
        participant.invite_status = InviteStatus.ACCEPTED  # 입장 = 수락 확정

    await db.flush()
    await db.commit()
    await db.refresh(participant)
    return _participant_out(participant)


@router.post(
    "/meetings/{meeting_id}/leave",
    response_model=MeetingParticipantOut,
)
async def leave_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingParticipantOut:
    """POST /api/meetings/{meeting_id}/leave — 퇴장 (left_at 기록, 06 §3.5 Data Req)."""
    meeting = await _get_meeting_or_404(meeting_id, db)
    q = await db.execute(
        select(MeetingParticipant).where(
            and_(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.user_id == current_user.user_id,
            )
        )
    )
    participant = q.scalar_one_or_none()
    if participant is None or participant.joined_at is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="participant_not_joined")

    participant.left_at = datetime.now(timezone.utc)
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
    """GET /api/meetings/{meeting_id}/participants — 참석자 목록 (이름·응답 상태 포함)."""
    meeting = await _get_meeting_or_404(meeting_id, db)
    rows = (
        await db.execute(
            select(MeetingParticipant, ErpUser.name)
            .outerjoin(ErpUser, MeetingParticipant.user_id == ErpUser.id)
            .where(MeetingParticipant.meeting_id == meeting.id)
            .order_by(MeetingParticipant.invited_at)
        )
    ).all()
    return [_participant_out(p, name) for p, name in rows]


class InviteRequest(BaseModel):
    user_ids: list[int] = Field(..., min_length=1, max_length=50, description="초대할 직원 id 목록")


@router.post(
    "/meetings/{meeting_id}/participants",
    response_model=list[MeetingParticipantOut],
    status_code=status.HTTP_201_CREATED,
)
async def invite_participants(
    meeting_id: str,
    body: InviteRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MeetingParticipantOut]:
    """POST /api/meetings/{id}/participants — 참석자 초대 (호스트/관리자, 06 §3.5.1).

    이미 등록된 사용자는 스킵(멱등). invite_status=invited로 생성.
    """
    meeting = await _get_meeting_or_404(meeting_id, db)
    if meeting.host_user_id != current_user.user_id and current_user.role not in _MTG_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="host_or_admin_required")
    if meeting.status in (MeetingStatus.CANCELLED, MeetingStatus.COMPLETED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="meeting_not_joinable")

    existing_ids = set(
        (
            await db.execute(
                select(MeetingParticipant.user_id).where(MeetingParticipant.meeting_id == meeting.id)
            )
        ).scalars().all()
    )
    valid_users = set(
        (
            await db.execute(select(ErpUser.id).where(ErpUser.id.in_(body.user_ids), ErpUser.is_active.is_(True)))
        ).scalars().all()
    )

    now = datetime.now(timezone.utc)
    created: list[MeetingParticipant] = []
    for uid in body.user_ids:
        if uid in existing_ids or uid not in valid_users:
            continue
        p = MeetingParticipant(
            id=uuid4(),
            meeting_id=meeting.id,
            user_id=uid,
            invited_at=now,
            role=MeetingParticipantRole.PARTICIPANT,
            invite_status=InviteStatus.INVITED,
        )
        db.add(p)
        created.append(p)
        existing_ids.add(uid)

    await db.flush()
    await db.commit()
    for p in created:
        await db.refresh(p)
    names = {
        uid: name
        for uid, name in (
            await db.execute(select(ErpUser.id, ErpUser.name).where(ErpUser.id.in_([p.user_id for p in created])))
        ).all()
    } if created else {}
    return [_participant_out(p, names.get(p.user_id)) for p in created]


class InviteResponseRequest(BaseModel):
    status: str = Field(..., description="'accepted' | 'declined'")


@router.patch(
    "/meetings/{meeting_id}/participants/me",
    response_model=MeetingParticipantOut,
)
async def respond_to_invite(
    meeting_id: str,
    body: InviteResponseRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingParticipantOut:
    """PATCH /api/meetings/{id}/participants/me — 초대 응답 (수락/거절, 06 §3.5.1)."""
    if body.status not in ("accepted", "declined"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="status must be 'accepted' or 'declined'",
        )
    meeting = await _get_meeting_or_404(meeting_id, db)
    participant = (
        await db.execute(
            select(MeetingParticipant).where(
                and_(
                    MeetingParticipant.meeting_id == meeting.id,
                    MeetingParticipant.user_id == current_user.user_id,
                )
            )
        )
    ).scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_invited")

    participant.invite_status = InviteStatus(body.status)
    await db.commit()
    await db.refresh(participant)
    return _participant_out(participant)


# ---------------------------------------------------------------------------
# 회의 수정/취소 (관리자·리더) — management-api.yaml
# ---------------------------------------------------------------------------

_MTG_ADMIN = ("admin", "super_admin", "leader")


class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = Field(None, ge=15, le=MAX_DURATION_MINUTES)
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
        new_time = _as_utc(body.scheduled_at)
    new_duration = body.duration_minutes if body.duration_minutes is not None else (meeting.duration_minutes or 60)

    # D23: 동일 room 시간대 겹침 재검증 (자기 자신 제외)
    if body.room_id is not None or body.scheduled_at is not None or body.duration_minutes is not None:
        await _check_room_conflict(db, new_room, _as_utc(new_time), new_duration, exclude_meeting_id=meeting.id)

    if body.title is not None:
        meeting.title = body.title
    if body.description is not None:
        meeting.description = body.description
    meeting.room_id = new_room
    meeting.scheduled_at = new_time
    meeting.duration_minutes = new_duration
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
