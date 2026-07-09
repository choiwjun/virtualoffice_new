"""
meeting_minutes API — G002 Lane B

POST   /api/meeting-minutes                      — 회의록 생성
GET    /api/meeting-minutes                      — 회의록 목록 (meeting_id 필터)
GET    /api/meeting-minutes/{minute_id}          — 회의록 상세
PATCH  /api/meeting-minutes/{minute_id}          — 회의록 수정
POST   /api/meeting-minutes/{minute_id}/finalize — 확정 (draft→finalized)
POST   /api/meeting-minutes/{minute_id}/stt-draft — 501 Not Implemented (D5 후속)

action_item 하위 CRUD:
POST   /api/meeting-minutes/{minute_id}/action-items
GET    /api/meeting-minutes/{minute_id}/action-items
PATCH  /api/meeting-minutes/{minute_id}/action-items/{item_id}

04 §2.4 정합. D19: UTC 저장.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import (
    ActionItem,
    ActionItemPriority,
    ActionItemStatus,
    Meeting,
    MeetingMinute,
    MeetingMinuteStatus,
    MeetingParticipant,
    RecordingConsent,
    RecordingConsentType,
)

router = APIRouter(prefix="/api", tags=["meeting-minutes"])


# ---------------------------------------------------------------------------
# 스키마
# ---------------------------------------------------------------------------


class MeetingMinuteCreate(BaseModel):
    meeting_id: str
    title: Optional[str] = None
    summary: Optional[str] = None
    decisions: str
    action_items_summary: Optional[str] = None
    notes: Optional[str] = None


class MeetingMinutePatch(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    decisions: Optional[str] = None
    action_items_summary: Optional[str] = None
    notes: Optional[str] = None


class MeetingMinuteOut(BaseModel):
    id: str
    meeting_id: str
    title: Optional[str]
    summary: Optional[str]
    decisions: str
    action_items_summary: Optional[str]
    notes: Optional[str]
    stt_draft: Optional[str]
    ai_summary: Optional[str]
    created_by: int
    reviewed_by: Optional[int]
    status: str
    created_at: str
    updated_at: str


class ActionItemCreate(BaseModel):
    title: str
    description: Optional[str] = None
    assignee_user_id: int
    due_date: str           # YYYY-MM-DD
    priority: Optional[str] = "medium"


class ActionItemPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    assignee_user_id: Optional[int] = None
    due_date: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    related_ref: Optional[str] = None
    completed_evidence_url: Optional[str] = None


class ActionItemOut(BaseModel):
    id: str
    meeting_id: str
    title: str
    description: Optional[str]
    assignee_user_id: int
    due_date: str
    priority: str
    status: str
    related_ref: Optional[str]
    completed_at: Optional[str]
    completed_evidence_url: Optional[str]
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------


def _minute_out(m: MeetingMinute) -> MeetingMinuteOut:
    return MeetingMinuteOut(
        id=str(m.id),
        meeting_id=str(m.meeting_id),
        title=m.title,
        summary=m.summary,
        decisions=m.decisions,
        action_items_summary=m.action_items_summary,
        notes=m.notes,
        stt_draft=m.stt_draft,
        ai_summary=m.ai_summary,
        created_by=m.created_by,
        reviewed_by=m.reviewed_by,
        status=m.status.value,
        created_at=m.created_at.isoformat(),
        updated_at=m.updated_at.isoformat(),
    )


def _action_item_out(a: ActionItem) -> ActionItemOut:
    return ActionItemOut(
        id=str(a.id),
        meeting_id=str(a.meeting_id),
        title=a.title,
        description=a.description,
        assignee_user_id=a.assignee_user_id,
        due_date=a.due_date.isoformat(),
        priority=a.priority.value,
        status=a.status.value,
        related_ref=a.related_ref,
        completed_at=a.completed_at.isoformat() if a.completed_at else None,
        completed_evidence_url=a.completed_evidence_url,
        created_at=a.created_at.isoformat(),
        updated_at=a.updated_at.isoformat(),
    )


async def _get_minute_or_404(
    minute_id: str, db: AsyncSession
) -> MeetingMinute:
    try:
        mid = UUID(minute_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid minute_id",
        )
    result = await db.execute(select(MeetingMinute).where(MeetingMinute.id == mid))
    minute = result.scalar_one_or_none()
    if minute is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="minute_not_found",
        )
    return minute


# ---------------------------------------------------------------------------
# 회의록 엔드포인트
# ---------------------------------------------------------------------------


@router.post(
    "/meeting-minutes",
    response_model=MeetingMinuteOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_minute(
    body: MeetingMinuteCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingMinuteOut:
    """POST /api/meeting-minutes — 회의록 생성 (created_by=current_user)."""
    try:
        meeting_uuid = UUID(body.meeting_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid meeting_id",
        )

    # meeting 존재 확인
    meeting_result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_uuid)
    )
    if meeting_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="meeting_not_found",
        )

    # 동일 meeting의 회의록 중복 확인 (UNIQUE meeting_id)
    dup_result = await db.execute(
        select(MeetingMinute).where(MeetingMinute.meeting_id == meeting_uuid)
    )
    if dup_result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="minute_already_exists_for_meeting",
        )

    minute = MeetingMinute(
        id=uuid4(),
        meeting_id=meeting_uuid,
        title=body.title,
        summary=body.summary,
        decisions=body.decisions,
        action_items_summary=body.action_items_summary,
        notes=body.notes,
        created_by=current_user.user_id,
        status=MeetingMinuteStatus.DRAFT,
    )
    db.add(minute)
    await db.flush()
    await db.commit()
    await db.refresh(minute)
    return _minute_out(minute)


@router.get("/meeting-minutes", response_model=list[MeetingMinuteOut])
async def list_minutes(
    meeting_id: Optional[str] = Query(None, description="meeting UUID 필터"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MeetingMinuteOut]:
    """GET /api/meeting-minutes — 회의록 목록 (meeting_id 필터)."""
    q = select(MeetingMinute)
    if meeting_id:
        try:
            meeting_uuid = UUID(meeting_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid meeting_id",
            )
        q = q.where(MeetingMinute.meeting_id == meeting_uuid)
    q = q.order_by(MeetingMinute.created_at.desc())
    result = await db.execute(q)
    minutes = result.scalars().all()
    return [_minute_out(m) for m in minutes]


@router.get("/meeting-minutes/{minute_id}", response_model=MeetingMinuteOut)
async def get_minute(
    minute_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingMinuteOut:
    """GET /api/meeting-minutes/{minute_id} — 회의록 상세."""
    minute = await _get_minute_or_404(minute_id, db)
    return _minute_out(minute)


@router.patch("/meeting-minutes/{minute_id}", response_model=MeetingMinuteOut)
async def patch_minute(
    minute_id: str,
    body: MeetingMinutePatch,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingMinuteOut:
    """PATCH /api/meeting-minutes/{minute_id} — 회의록 수정 (draft 상태에서만)."""
    minute = await _get_minute_or_404(minute_id, db)

    if minute.status == MeetingMinuteStatus.FINALIZED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="cannot_edit_finalized_minute",
        )

    # 기록자 또는 관리자만 수정 가능
    if (
        minute.created_by != current_user.user_id
        and current_user.role not in ("admin", "leader")
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient_permissions",
        )

    if body.title is not None:
        minute.title = body.title
    if body.summary is not None:
        minute.summary = body.summary
    if body.decisions is not None:
        minute.decisions = body.decisions
    if body.action_items_summary is not None:
        minute.action_items_summary = body.action_items_summary
    if body.notes is not None:
        minute.notes = body.notes

    await db.flush()
    await db.commit()
    await db.refresh(minute)
    return _minute_out(minute)


@router.post(
    "/meeting-minutes/{minute_id}/finalize",
    response_model=MeetingMinuteOut,
)
async def finalize_minute(
    minute_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingMinuteOut:
    """POST /api/meeting-minutes/{minute_id}/finalize — 확정 (draft→finalized)."""
    minute = await _get_minute_or_404(minute_id, db)

    if minute.status == MeetingMinuteStatus.FINALIZED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already_finalized",
        )

    # 관리자, 리더, 또는 기록자만 확정 가능
    if (
        current_user.role not in ("admin", "leader")
        and minute.created_by != current_user.user_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient_permissions",
        )

    minute.status = MeetingMinuteStatus.FINALIZED
    minute.reviewed_by = current_user.user_id

    await db.flush()
    await db.commit()
    await db.refresh(minute)
    return _minute_out(minute)


@router.post(
    "/meeting-minutes/{minute_id}/stt-draft",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def stt_draft(
    minute_id: str,
    _current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    POST /api/meeting-minutes/{minute_id}/stt-draft — STT 자동 초안 생성.

    Not Implemented: D5(STT 스파이크 선행 필요). Phase 2+ 후속 구현 예정.
    """
    minute = await _get_minute_or_404(minute_id, db)
    participants_result = await db.execute(
        select(MeetingParticipant.user_id).where(
            MeetingParticipant.meeting_id == minute.meeting_id
        )
    )
    participant_ids = set(participants_result.scalars().all())
    if participant_ids:
        consent_result = await db.execute(
            select(RecordingConsent.user_id).where(
                RecordingConsent.meeting_id == minute.meeting_id,
                RecordingConsent.consent_type == RecordingConsentType.STT,
                RecordingConsent.granted.is_(True),
                RecordingConsent.user_id.in_(participant_ids),
            )
        )
        granted_user_ids = set(consent_result.scalars().all())
        if participant_ids - granted_user_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="consent_required",
            )

    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="stt_not_implemented",
    )


# ---------------------------------------------------------------------------
# 액션아이템 하위 CRUD
# ---------------------------------------------------------------------------


@router.post(
    "/meeting-minutes/{minute_id}/action-items",
    response_model=ActionItemOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_action_item(
    minute_id: str,
    body: ActionItemCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ActionItemOut:
    """POST /api/meeting-minutes/{minute_id}/action-items — 액션아이템 생성."""
    minute = await _get_minute_or_404(minute_id, db)

    # due_date 파싱
    from datetime import date as date_type
    try:
        due_date = date_type.fromisoformat(body.due_date)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid due_date format (YYYY-MM-DD)",
        )

    # priority 파싱
    try:
        priority = ActionItemPriority(body.priority or "medium")
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"invalid priority: {body.priority}",
        )

    action_item = ActionItem(
        id=uuid4(),
        meeting_id=minute.meeting_id,
        title=body.title,
        description=body.description,
        assignee_user_id=body.assignee_user_id,
        due_date=due_date,
        priority=priority,
        status=ActionItemStatus.OPEN,
    )
    db.add(action_item)
    await db.flush()
    await db.commit()
    await db.refresh(action_item)
    return _action_item_out(action_item)


@router.get(
    "/meeting-minutes/{minute_id}/action-items",
    response_model=list[ActionItemOut],
)
async def list_action_items(
    minute_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ActionItemOut]:
    """GET /api/meeting-minutes/{minute_id}/action-items — 액션아이템 목록."""
    minute = await _get_minute_or_404(minute_id, db)
    result = await db.execute(
        select(ActionItem)
        .where(ActionItem.meeting_id == minute.meeting_id)
        .order_by(ActionItem.created_at)
    )
    items = result.scalars().all()
    return [_action_item_out(a) for a in items]


@router.patch(
    "/meeting-minutes/{minute_id}/action-items/{item_id}",
    response_model=ActionItemOut,
)
async def patch_action_item(
    minute_id: str,
    item_id: str,
    body: ActionItemPatch,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ActionItemOut:
    """PATCH /api/meeting-minutes/{minute_id}/action-items/{item_id} — 액션아이템 수정."""
    minute = await _get_minute_or_404(minute_id, db)

    try:
        iid = UUID(item_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid item_id",
        )

    result = await db.execute(
        select(ActionItem).where(
            and_(
                ActionItem.id == iid,
                ActionItem.meeting_id == minute.meeting_id,
            )
        )
    )
    action_item = result.scalar_one_or_none()
    if action_item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="action_item_not_found",
        )

    if body.title is not None:
        action_item.title = body.title
    if body.description is not None:
        action_item.description = body.description
    if body.assignee_user_id is not None:
        action_item.assignee_user_id = body.assignee_user_id
    if body.due_date is not None:
        from datetime import date as date_type
        try:
            action_item.due_date = date_type.fromisoformat(body.due_date)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid due_date format",
            )
    if body.priority is not None:
        try:
            action_item.priority = ActionItemPriority(body.priority)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"invalid priority: {body.priority}",
            )
    if body.status is not None:
        try:
            new_status = ActionItemStatus(body.status)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"invalid status: {body.status}",
            )
        # completed 전이 시 completed_at 설정
        if (
            new_status == ActionItemStatus.COMPLETED
            and action_item.status != ActionItemStatus.COMPLETED
        ):
            action_item.completed_at = datetime.now(timezone.utc)
        action_item.status = new_status
    if body.related_ref is not None:
        action_item.related_ref = body.related_ref
    if body.completed_evidence_url is not None:
        action_item.completed_evidence_url = body.completed_evidence_url

    await db.flush()
    await db.commit()
    await db.refresh(action_item)
    return _action_item_out(action_item)
