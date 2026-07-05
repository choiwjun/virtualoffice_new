"""
회의 API (root, prefix 없음 — seats.py/layouts.py와 동일 계약 규약).

- POST   /meetings                       회의 생성 (예약, D23)
- GET    /meetings                       회의 목록 (필터: room_id, status, 기간)
- GET    /meetings/{meeting_id}          개별 회의 조회
- POST   /meetings/{meeting_id}/join     회의 입장 (명시적 확인, D24)
- POST   /meetings/{meeting_id}/leave    회의 퇴장
- DELETE /meetings/{meeting_id}          회의 취소 (호스트만)
- GET    /meetings/{meeting_id}/participants   참석자 목록

@SPEC 00-decisions.md D23(회의실 예약제 + 즉석 FCFS 병행, 충돌 검증),
      D24(회의 입장=명시적 확인, LiveKit 룸 생성/토큰은 FastAPI 경유 단일화)
@SPEC docs/planning/04-data-model.md §2.4

경로 규약(의도적, 계약 테스트 기준): 회의 엔드포인트는 root(/meetings*, prefix 없음).
seats.py/layouts.py와 동일 이탈 근거 — 외부 공개 시 Caddy가 /api/* → /* 로 라우팅한다(D21-r).

LiveKit 토큰(D24 "LiveKit 룸 생성/토큰은 FastAPI 경유 단일화"): 입장 토큰은
app/services/livekit_service.issue_join_token 단일 진입점으로 발급한다. LiveKit 설정 시
(LIVEKIT_API_KEY/SECRET) 실 LiveKit AccessToken(VideoGrants room_join)을, 미설정 시 결정적 stub
토큰(자체 JWT)을 반환한다(B-03 슬라이스). 실 LiveKit 서버 룸 생성·미디어·Egress·STT는 서버/엔진
부재로 범위 밖(B-03 환경차단) — 설정만 채우면 코드 변경 없이 실 토큰으로 전환된다.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.services.livekit_service import issue_join_token
from app.db import get_db
from app.config import settings
from app.models.tables import (
    Meeting,
    MeetingMinute,
    MeetingMinuteStatus,
    MeetingParticipant,
    MeetingParticipantRole,
    MeetingStatus,
    Room,
)
from app.services.audit_service import record_audit

router = APIRouter(tags=["meetings"])


# ── 스키마 ────────────────────────────────────────────────
def _ensure_utc(value: datetime) -> datetime:
    """tz-naive datetime은 UTC로 간주(계약: ISO 문자열에 tz 정보가 없을 수 있음)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class MeetingCreate(BaseModel):
    title: str
    room_id: UUID
    start_time: datetime
    end_time: datetime
    description: Optional[str] = None

    @field_validator("start_time", "end_time")
    @classmethod
    def _tz_aware(cls, v: datetime) -> datetime:
        return _ensure_utc(v)


class MeetingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    meeting_id: UUID
    room_id: UUID
    host_user_id: int
    title: str
    description: Optional[str]
    scheduled_at: datetime
    scheduled_end: Optional[datetime]
    status: MeetingStatus


def _meeting_out(meeting: Meeting) -> dict:
    return MeetingOut(
        meeting_id=meeting.id,
        room_id=meeting.room_id,
        host_user_id=meeting.host_user_id,
        title=meeting.title,
        description=meeting.description,
        scheduled_at=meeting.scheduled_at,
        scheduled_end=meeting.scheduled_end,
        status=meeting.status,
    ).model_dump(mode="json")


def _parse_meeting_id(meeting_id: str) -> UUID:
    """수동 UUID 파싱: FastAPI 경로 파라미터 타입 검증(422) 대신 404로 통일(계약)."""
    try:
        return UUID(meeting_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="meeting_not_found")


async def _get_meeting(db: AsyncSession, meeting_id: str) -> Meeting:
    parsed = _parse_meeting_id(meeting_id)
    meeting = await db.get(Meeting, parsed)
    if meeting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="meeting_not_found")
    return meeting


# ── 목록/생성 ─────────────────────────────────────────────
@router.post("/meetings", status_code=status.HTTP_201_CREATED)
async def create_meeting(
    body: MeetingCreate,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if body.end_time <= body.start_time:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_time_range")

    room = await db.get(Room, body.room_id)
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="room_not_found")

    # 예약 충돌 검증 (D23): 같은 room에 활성(SCHEDULED/IN_PROGRESS) 회의와
    # [start, end) 구간이 겹치면 409. 반개구간 겹침: a.start < b.end AND a.end > b.start.
    # scheduled_end IS NULL(open-ended) 회의는 [scheduled_at, ∞) 상시점유로 간주 →
    # a.end 조건을 항상 참으로 취급해 신규 예약을 차단한다(방이 영구히 열린 채 방치되는 갭 방지).
    # TOCTOU 주의: SELECT(충돌검사)→INSERT 는 단일 배타 잠금이 아니다. 온프렘 단일 인스턴스
    # 배포(D21) 전제라 동시 충돌 위험은 낮음. 다중 인스턴스 확장 시 DB 배타 제약
    # (예: PostgreSQL EXCLUDE + tstzrange)으로 승격 필요 → 설계 백로그 후속(환경차단 아님, G011 레지스트리 대상 아님).
    conflict_stmt = select(Meeting).where(
        Meeting.room_id == body.room_id,
        Meeting.status.in_([MeetingStatus.SCHEDULED, MeetingStatus.IN_PROGRESS]),
        Meeting.scheduled_at < body.end_time,
        or_(
            Meeting.scheduled_end.is_(None),
            Meeting.scheduled_end > body.start_time,
        ),
    )
    conflict = (await db.execute(conflict_stmt)).scalars().first()
    if conflict is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="room_conflict")

    meeting = Meeting(
        room_id=body.room_id,
        host_user_id=current_user.user_id,
        title=body.title,
        description=body.description,
        scheduled_at=body.start_time,
        scheduled_end=body.end_time,
        status=MeetingStatus.SCHEDULED,
    )
    db.add(meeting)
    await db.flush()
    record_audit(
        db,
        action="meeting_created",
        entity_type="meeting",
        entity_id=meeting.id,
        user_id=current_user.user_id,
        new_value={
            "room_id": str(meeting.room_id),
            "title": meeting.title,
            "scheduled_at": meeting.scheduled_at.isoformat() if meeting.scheduled_at else None,
            "scheduled_end": meeting.scheduled_end.isoformat() if meeting.scheduled_end else None,
        },
        request=request,
    )
    await db.commit()
    await db.refresh(meeting)
    return _meeting_out(meeting)


@router.get("/meetings")
async def list_meetings(
    room_id: Optional[UUID] = Query(default=None),
    status_filter: Optional[MeetingStatus] = Query(default=None, alias="status"),
    start_after: Optional[datetime] = Query(default=None),
    end_before: Optional[datetime] = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Meeting)
    if room_id is not None:
        stmt = stmt.where(Meeting.room_id == room_id)
    if status_filter is not None:
        stmt = stmt.where(Meeting.status == status_filter)
    if start_after is not None:
        stmt = stmt.where(Meeting.scheduled_at >= _ensure_utc(start_after))
    if end_before is not None:
        stmt = stmt.where(Meeting.scheduled_at <= _ensure_utc(end_before))
    rows = (await db.execute(stmt)).scalars().all()
    return {"meetings": [_meeting_out(m) for m in rows]}


@router.get("/meetings/{meeting_id}")
async def get_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    meeting = await _get_meeting(db, meeting_id)
    return _meeting_out(meeting)


# ── 입장/퇴장 (D24: 명시적 확인) ──────────────────────────
@router.post("/meetings/{meeting_id}/join")
async def join_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    meeting = await _get_meeting(db, meeting_id)

    # CANCELLED/COMPLETED 회의는 입장 불가 (red-team 8b, architect MEDIUM):
    # 종료/취소된 회의에 LiveKit 토큰을 발급하면 안 됨 → 409.
    if meeting.status in (MeetingStatus.CANCELLED, MeetingStatus.COMPLETED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="meeting_not_joinable")
    now = datetime.now(timezone.utc)

    # 최초 입장 시 회의 진행 상태로 전환
    if meeting.status == MeetingStatus.SCHEDULED:
        meeting.status = MeetingStatus.IN_PROGRESS
        meeting.started_at = now

    # LiveKit 룸 이름: 실제 LiveKit 연동은 G011 blocker → 결정적 room_name만 생성/저장.
    if not meeting.livekit_room:
        meeting.livekit_room = f"meeting-{meeting.id}"

    participant_stmt = select(MeetingParticipant).where(
        MeetingParticipant.meeting_id == meeting.id,
        MeetingParticipant.user_id == current_user.user_id,
    )
    participant = (await db.execute(participant_stmt)).scalars().first()
    if participant is None:
        participant = MeetingParticipant(
            meeting_id=meeting.id,
            user_id=current_user.user_id,
            invited_at=now,
            joined_at=now,
            role=MeetingParticipantRole.PARTICIPANT,
        )
        db.add(participant)
    else:
        participant.joined_at = now
        participant.left_at = None

    await db.commit()

    # 입장 토큰: LiveKit 설정 시 실 AccessToken, 미설정 시 결정적 stub(issue_join_token 단일 진입점).
    # 실 LiveKit 서버 룸 생성/미디어/Egress/STT는 범위 밖(B-03 환경차단).
    livekit_token = issue_join_token(meeting.livekit_room, str(current_user.user_id))
    return {
        "livekit_token": livekit_token,
        "room_name": meeting.livekit_room,
        "livekit_url": settings.livekit_url,
    }


@router.post("/meetings/{meeting_id}/leave")
async def leave_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    meeting = await _get_meeting(db, meeting_id)

    participant_stmt = select(MeetingParticipant).where(
        MeetingParticipant.meeting_id == meeting.id,
        MeetingParticipant.user_id == current_user.user_id,
    )
    participant = (await db.execute(participant_stmt)).scalars().first()
    if participant is not None:
        participant.left_at = datetime.now(timezone.utc)
        await db.commit()

    # participant 미존재도 idempotent 200 (계약 스텁 기대)
    return {"status": "left"}


@router.delete("/meetings/{meeting_id}")
async def cancel_meeting(
    meeting_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    meeting = await _get_meeting(db, meeting_id)
    if meeting.host_user_id != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not_host")

    prev_status = meeting.status.value
    meeting.status = MeetingStatus.CANCELLED
    record_audit(
        db,
        action="meeting_cancelled",
        entity_type="meeting",
        entity_id=meeting.id,
        user_id=current_user.user_id,
        old_value={"status": prev_status},
        new_value={"status": MeetingStatus.CANCELLED.value},
        request=request,
    )
    await db.commit()
    return {"status": "cancelled"}


@router.get("/meetings/{meeting_id}/participants")
async def get_participants(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    meeting = await _get_meeting(db, meeting_id)
    stmt = select(MeetingParticipant).where(MeetingParticipant.meeting_id == meeting.id)
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "participants": [
            {
                "user_id": p.user_id,
                "role": p.role.value,
                "joined_at": p.joined_at.isoformat() if p.joined_at else None,
                "left_at": p.left_at.isoformat() if p.left_at else None,
            }
            for p in rows
        ]
    }


# ── 회의록 (D5: STT 자동 생성, 수동 폴백) ─────────────────
# 실제 STT 파이프라인(LiveKit Egress→음성추출→화자분리→AI 요약)은 환경차단(G011).
# 여기서는 저장된 stt_draft/요약/결정사항의 조회·수정·확정 계약만 구현하고,
# stt_draft는 외부 파이프라인이 채우기 전까지 NULL일 수 있다.
class MinuteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    decisions: Optional[list[str]] = None
    action_items: Optional[list[dict]] = None


def _format_action_items(items: list[dict]) -> str:
    lines = []
    for it in items:
        owner = it.get("owner_id")
        task = it.get("task", "")
        due = it.get("due_date", "")
        lines.append(f"- {task} (owner={owner}, due={due})")
    return "\n".join(lines)


def _minute_out(minute: MeetingMinute) -> dict:
    return {
        "meeting_id": str(minute.meeting_id),
        "minute_id": str(minute.id),
        "title": minute.title,
        "summary": minute.summary,
        "decisions": minute.decisions,
        "action_items_summary": minute.action_items_summary,
        "stt_draft": minute.stt_draft,
        "ai_summary": minute.ai_summary,
        "status": minute.status.value,
    }


async def _get_minute(db: AsyncSession, meeting: Meeting) -> Optional[MeetingMinute]:
    stmt = select(MeetingMinute).where(MeetingMinute.meeting_id == meeting.id)
    return (await db.execute(stmt)).scalars().first()


_MINUTE_ADMIN_ROLES = ("admin", "super_admin")


async def _is_meeting_participant(db: AsyncSession, meeting_id: UUID, user_id: int) -> bool:
    stmt = select(MeetingParticipant.id).where(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.user_id == user_id,
    )
    return (await db.execute(stmt)).first() is not None


@router.get("/meetings/{meeting_id}/minutes")
async def get_meeting_minutes(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    meeting = await _get_meeting(db, meeting_id)
    minute = await _get_minute(db, meeting)
    if minute is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="minute_not_found")
    return _minute_out(minute)


@router.get("/meetings/{meeting_id}/minutes/stt-draft")
async def get_meeting_minute_stt_draft(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    meeting = await _get_meeting(db, meeting_id)
    minute = await _get_minute(db, meeting)
    if minute is None:
        # STT 초안이 아직 없음(파이프라인 미실행/미저장) → 404. 실 파이프라인은 G011 환경차단.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="stt_draft_not_found")
    return {
        "meeting_id": str(meeting.id),
        "stt_draft": minute.stt_draft,
        "status": minute.status.value,
    }


@router.put("/meetings/{meeting_id}/minutes")
async def update_meeting_minutes(
    meeting_id: str,
    body: MinuteUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    meeting = await _get_meeting(db, meeting_id)

    # 수정 권한(D5 참석자/호스트 검토): 호스트·참석자·관리자만. 그 외 403.
    is_admin = current_user.role in _MINUTE_ADMIN_ROLES
    is_host = current_user.user_id == meeting.host_user_id
    if not (is_admin or is_host or await _is_meeting_participant(db, meeting.id, current_user.user_id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="minute_edit_forbidden")
    minute = await _get_minute(db, meeting)

    # 확정(FINALIZED)된 회의록은 불변 → 수정 차단.
    if minute is not None and minute.status == MeetingMinuteStatus.FINALIZED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="minute_finalized")

    decisions_text = "\n".join(body.decisions) if body.decisions is not None else None
    action_items_text = _format_action_items(body.action_items) if body.action_items is not None else None

    if minute is None:
        # 최초 수정 시 초안 생성(수동 폴백 경로). decisions는 NOT NULL → 빈 문자열 기본.
        minute = MeetingMinute(
            meeting_id=meeting.id,
            created_by=current_user.user_id,
            title=body.title,
            summary=body.content,
            decisions=decisions_text or "",
            action_items_summary=action_items_text,
            status=MeetingMinuteStatus.DRAFT,
        )
        db.add(minute)
    else:
        if body.title is not None:
            minute.title = body.title
        if body.content is not None:
            minute.summary = body.content
        if decisions_text is not None:
            minute.decisions = decisions_text
        if action_items_text is not None:
            minute.action_items_summary = action_items_text
    # 구조적 액션아이템 인입 (T12c, KPI 집계 데이터 소스): title+owner_id(int)+due_date(ISO
    # date str) 3종을 모두 갖춘 dict만 ActionItem 행으로 영속화. 누락된 dict는 기존처럼
    # 텍스트 요약에만 반영되고 구조적 행은 생성하지 않는다(계약 유지, 회귀 방지).
    # idempotent: (meeting_id, title, assignee_user_id) 동일 조합이 이미 있으면 스킵.
    if body.action_items:
        from datetime import date as _date

        from app.models.tables import ActionItem, ActionItemPriority, ErpUser

        for raw_item in body.action_items:
            title = raw_item.get("title")
            owner_id = raw_item.get("owner_id")
            due_date_raw = raw_item.get("due_date")
            # owner_id: bool 제외 + int64 범위(BigInteger)만 허용 — 범위 밖은 DB 바인딩
            # OverflowError(500) 방지 위해 malformed로 취급하고 스킵.
            if (
                not title
                or isinstance(owner_id, bool)
                or not isinstance(owner_id, int)
                or not (0 < owner_id <= 9223372036854775807)
                or not due_date_raw
            ):
                continue
            try:
                parsed_due = _date.fromisoformat(due_date_raw)
            except (ValueError, TypeError):
                continue

            existing_stmt = select(ActionItem).where(
                ActionItem.meeting_id == meeting.id,
                ActionItem.title == title,
                ActionItem.assignee_user_id == owner_id,
            )
            if (await db.execute(existing_stmt)).scalars().first() is not None:
                continue

            assignee = await db.get(ErpUser, owner_id)
            if assignee is None:
                continue

            priority_raw = raw_item.get("priority")
            try:
                priority = ActionItemPriority(priority_raw) if priority_raw else ActionItemPriority.MEDIUM
            except ValueError:
                priority = ActionItemPriority.MEDIUM

            db.add(
                ActionItem(
                    meeting_id=meeting.id,
                    title=title,
                    assignee_user_id=owner_id,
                    due_date=parsed_due,
                    priority=priority,
                )
            )


    await db.commit()
    await db.refresh(minute)
    return _minute_out(minute)


@router.post("/meetings/{meeting_id}/minutes/confirm")
async def confirm_meeting_minutes(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # 확정 권한(D5): 회의 호스트 또는 관리자(admin/super_admin). 그 외 403.
    meeting = await _get_meeting(db, meeting_id)
    is_admin = current_user.role in _MINUTE_ADMIN_ROLES
    is_host = current_user.user_id == meeting.host_user_id
    if not (is_admin or is_host):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="minute_confirm_forbidden")
    minute = await _get_minute(db, meeting)
    if minute is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="minute_not_found")
    minute.status = MeetingMinuteStatus.FINALIZED
    minute.reviewed_by = current_user.user_id
    await db.commit()
    await db.refresh(minute)
    return {"status": "finalized", **_minute_out(minute)}


@router.post("/meetings/{meeting_id}/minutes/summarize")
async def summarize_meeting_minutes(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """회의록 AI 요약 생성(P7-R1-T3). minute.ai_summary에 저장. 호스트/참석자/관리자만."""
    from app.services.meeting_ai_summarizer import minute_to_text, summarize_minute

    meeting = await _get_meeting(db, meeting_id)
    is_admin = current_user.role in _MINUTE_ADMIN_ROLES
    is_host = current_user.user_id == meeting.host_user_id
    if not (is_admin or is_host or await _is_meeting_participant(db, meeting.id, current_user.user_id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="minute_summarize_forbidden")
    minute = await _get_minute(db, meeting)
    if minute is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="minute_not_found")

    text = minute_to_text(minute.title, minute.summary, minute.decisions, minute.action_items_summary)
    result = await summarize_minute(text)
    minute.ai_summary = result["summary"]
    await db.commit()
    await db.refresh(minute)
    return {"ai_summary": minute.ai_summary, "model": result["model"], **_minute_out(minute)}
