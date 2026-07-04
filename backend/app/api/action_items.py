# @TASK T12c - 액션아이템 CRUD + KPI 인입 경로
# @SPEC docs/planning/04-data-model.md §2.4
# @SPEC 00-decisions.md D16 (KPI action_items_completed/ontime_rate 인입)

"""
액션아이템 API (root, prefix 없음 — meetings.py/worklogs.py와 동일 계약 규약).

- POST   /action-items                액션아이템 생성 (회의 호스트/참석자/관리자)
- GET    /action-items                 목록 (RBAC 스코프: employee 본인/leader 팀/admin 전체)
- GET    /action-items/{action_item_id}  개별 조회 (RBAC 위반 시 404 — 존재 미노출)
- PATCH  /action-items/{action_item_id}  필드/상태 전이 갱신 (담당자 본인/관리자)
- DELETE /action-items/{action_item_id}  삭제 (관리자/회의 호스트만)

여기서 생성된 ActionItem 행은 app.services.kpi_scoring.aggregate_user_period가
assignee_user_id + due_date 범위로 그대로 집계한다(계산 로직 변경 없음 — 데이터 인입 경로만 신설).
"""

from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import (
    ActionItem,
    ActionItemPriority,
    ActionItemStatus,
    ErpUser,
    Meeting,
    MeetingParticipant,
)

router = APIRouter(tags=["action-items"])

_ADMIN_ROLES = ("admin", "super_admin")

# 상태 전이표 (D16 계약): open→{in_progress,completed,cancelled}, in_progress→{completed,cancelled}.
# completed/cancelled는 종결 상태(더 이상 전이 불가).
_ALLOWED_TRANSITIONS: dict[ActionItemStatus, frozenset[ActionItemStatus]] = {
    ActionItemStatus.OPEN: frozenset(
        {ActionItemStatus.IN_PROGRESS, ActionItemStatus.COMPLETED, ActionItemStatus.CANCELLED}
    ),
    ActionItemStatus.IN_PROGRESS: frozenset(
        {ActionItemStatus.COMPLETED, ActionItemStatus.CANCELLED}
    ),
    ActionItemStatus.COMPLETED: frozenset(),
    ActionItemStatus.CANCELLED: frozenset(),
}


# ── 스키마 ────────────────────────────────────────────────
class ActionItemCreate(BaseModel):
    meeting_id: UUID
    title: str
    assignee_user_id: int = Field(ge=1, le=9223372036854775807)
    due_date: date
    priority: Optional[ActionItemPriority] = None
    description: Optional[str] = None
    related_ref: Optional[str] = None


class ActionItemUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[ActionItemPriority] = None
    due_date: Optional[date] = None
    related_ref: Optional[str] = None
    completed_evidence_url: Optional[str] = None
    status: Optional[str] = None


def _action_item_out(item: ActionItem) -> dict:
    return {
        "id": str(item.id),
        "meeting_id": str(item.meeting_id),
        "title": item.title,
        "description": item.description,
        "assignee_user_id": item.assignee_user_id,
        "due_date": item.due_date.isoformat(),
        "priority": item.priority.value,
        "status": item.status.value,
        "related_ref": item.related_ref,
        "completed_at": item.completed_at.isoformat() if item.completed_at else None,
        "completed_evidence_url": item.completed_evidence_url,
    }


def _parse_action_item_id(action_item_id: str) -> UUID:
    """수동 UUID 파싱: 타입검증 422 대신 404로 통일(계약, meetings.py/worklogs.py와 동일)."""
    try:
        return UUID(action_item_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="action_item_not_found")


async def _get_action_item(db: AsyncSession, action_item_id: str) -> ActionItem:
    parsed = _parse_action_item_id(action_item_id)
    item = await db.get(ActionItem, parsed)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="action_item_not_found")
    return item


async def _is_meeting_participant(db: AsyncSession, meeting_id: UUID, user_id: int) -> bool:
    stmt = select(MeetingParticipant.id).where(
        MeetingParticipant.meeting_id == meeting_id,
        MeetingParticipant.user_id == user_id,
    )
    return (await db.execute(stmt)).first() is not None


async def _team_user_ids(db: AsyncSession, team_id: Optional[int]) -> list[int]:
    if team_id is None:
        return []
    rows = (
        await db.execute(select(ErpUser.id).where(ErpUser.erp_team_id == team_id))
    ).scalars().all()
    return list(rows)


async def _can_view(db: AsyncSession, item: ActionItem, current_user: CurrentUser) -> bool:
    """조회 RBAC: 담당자 본인 / 관리자 / 소속 회의 호스트·참석자."""
    if current_user.role in _ADMIN_ROLES:
        return True
    if item.assignee_user_id == current_user.user_id:
        return True
    meeting = await db.get(Meeting, item.meeting_id)
    if meeting is None:
        return False
    if meeting.host_user_id == current_user.user_id:
        return True
    return await _is_meeting_participant(db, meeting.id, current_user.user_id)


# ── 생성 ──────────────────────────────────────────────────
@router.post("/action-items", status_code=status.HTTP_201_CREATED)
async def create_action_item(
    body: ActionItemCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    meeting = await db.get(Meeting, body.meeting_id)
    if meeting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="meeting_not_found")

    assignee = await db.get(ErpUser, body.assignee_user_id)
    if assignee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="assignee_not_found")

    is_admin = current_user.role in _ADMIN_ROLES
    is_host = meeting.host_user_id == current_user.user_id
    if not (
        is_admin
        or is_host
        or await _is_meeting_participant(db, meeting.id, current_user.user_id)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="action_item_create_forbidden")

    item = ActionItem(
        meeting_id=meeting.id,
        title=body.title,
        description=body.description,
        assignee_user_id=body.assignee_user_id,
        due_date=body.due_date,
        priority=body.priority or ActionItemPriority.MEDIUM,
        status=ActionItemStatus.OPEN,
        related_ref=body.related_ref,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _action_item_out(item)


# ── 목록 ──────────────────────────────────────────────────
@router.get("/action-items")
async def list_action_items(
    meeting_id: Optional[UUID] = Query(default=None),
    assignee_user_id: Optional[int] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    is_admin = current_user.role in _ADMIN_ROLES
    is_leader = current_user.role == "leader"

    parsed_status: Optional[ActionItemStatus] = None
    if status_filter is not None:
        try:
            parsed_status = ActionItemStatus(status_filter)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_status")

    if assignee_user_id is not None and assignee_user_id != current_user.user_id and not is_admin:
        if not (is_leader and assignee_user_id in await _team_user_ids(db, current_user.team_id)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")

    stmt = select(ActionItem)
    if assignee_user_id is not None:
        stmt = stmt.where(ActionItem.assignee_user_id == assignee_user_id)
    elif is_admin:
        pass  # 전체 조회 허용
    elif is_leader:
        team_ids = await _team_user_ids(db, current_user.team_id)
        stmt = stmt.where(ActionItem.assignee_user_id.in_(team_ids or [-1]))
    else:
        stmt = stmt.where(ActionItem.assignee_user_id == current_user.user_id)

    if meeting_id is not None:
        stmt = stmt.where(ActionItem.meeting_id == meeting_id)
    if parsed_status is not None:
        stmt = stmt.where(ActionItem.status == parsed_status)

    rows = (await db.execute(stmt)).scalars().all()
    return {"items": [_action_item_out(item) for item in rows], "total": len(rows)}


# ── 조회 ──────────────────────────────────────────────────
@router.get("/action-items/{action_item_id}")
async def get_action_item(
    action_item_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    item = await _get_action_item(db, action_item_id)
    if not await _can_view(db, item, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="action_item_not_found")
    return _action_item_out(item)


# ── 수정 (필드 + 상태 전이) ──────────────────────────────
@router.patch("/action-items/{action_item_id}")
async def update_action_item(
    action_item_id: str,
    body: ActionItemUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    item = await _get_action_item(db, action_item_id)

    is_admin = current_user.role in _ADMIN_ROLES
    if not (is_admin or item.assignee_user_id == current_user.user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="action_item_update_forbidden")

    if body.status is not None:
        try:
            new_status = ActionItemStatus(body.status)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_status")

        allowed = _ALLOWED_TRANSITIONS.get(item.status, frozenset())
        if new_status not in allowed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_transition")

        item.status = new_status
        if new_status == ActionItemStatus.COMPLETED:
            item.completed_at = datetime.now(timezone.utc)

    if body.title is not None:
        item.title = body.title
    if body.description is not None:
        item.description = body.description
    if body.priority is not None:
        item.priority = body.priority
    if body.due_date is not None:
        item.due_date = body.due_date
    if body.related_ref is not None:
        item.related_ref = body.related_ref
    if body.completed_evidence_url is not None:
        item.completed_evidence_url = body.completed_evidence_url

    await db.commit()
    await db.refresh(item)
    return _action_item_out(item)


# ── 삭제 ──────────────────────────────────────────────────
@router.delete("/action-items/{action_item_id}")
async def delete_action_item(
    action_item_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    item = await _get_action_item(db, action_item_id)

    is_admin = current_user.role in _ADMIN_ROLES
    meeting = await db.get(Meeting, item.meeting_id)
    is_host = meeting is not None and meeting.host_user_id == current_user.user_id
    if not (is_admin or is_host):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="action_item_delete_forbidden")

    await db.delete(item)
    await db.commit()
    return {"status": "deleted"}
