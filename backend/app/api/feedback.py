"""
도그푸딩 피드백 API (P7-R3-T4).

- POST /feedback            피드백 제출 (인증 사용자 누구나)
- GET  /feedback           피드백 목록 (admin, 필터: status, type)
- PUT  /feedback/{id}       상태 변경 (admin)

경로 규약: root prefix 없음(meetings.py/kpi.py 등과 동일 계약, Caddy /api/*→/*, D21-r).
리소스 지향 — 화면 비종속(FastAPI api-design 헌법).
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import Feedback

router = APIRouter(tags=["feedback"])

_VALID_TYPES = {"bug", "feature", "general"}
_VALID_STATUS = {"open", "reviewing", "resolved"}


class FeedbackCreate(BaseModel):
    type: str = "general"
    title: str
    description: Optional[str] = None
    screenshot_url: Optional[str] = None


class FeedbackStatusUpdate(BaseModel):
    status: str


def _out(f: Feedback) -> dict:
    return {
        "feedback_id": str(f.id),
        "user_id": f.user_id,
        "type": f.type,
        "title": f.title,
        "description": f.description,
        "screenshot_url": f.screenshot_url,
        "status": f.status,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


def _parse_id(feedback_id: str) -> UUID:
    try:
        return UUID(feedback_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="feedback_not_found")


@router.post("/feedback", status_code=status.HTTP_201_CREATED)
async def create_feedback(
    body: FeedbackCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if body.type not in _VALID_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_feedback_type")
    if not body.title.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="title_required")
    f = Feedback(
        user_id=current_user.user_id,
        type=body.type,
        title=body.title,
        description=body.description,
        screenshot_url=body.screenshot_url,
        status="open",
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _out(f)


@router.get("/feedback")
async def list_feedback(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    type_filter: Optional[str] = Query(default=None, alias="type"),
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    stmt = select(Feedback)
    if status_filter is not None:
        stmt = stmt.where(Feedback.status == status_filter)
    if type_filter is not None:
        stmt = stmt.where(Feedback.type == type_filter)
    stmt = stmt.order_by(Feedback.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return {"items": [_out(r) for r in rows], "total": len(rows)}


@router.put("/feedback/{feedback_id}")
async def update_feedback_status(
    feedback_id: str,
    body: FeedbackStatusUpdate,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    if body.status not in _VALID_STATUS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_status")
    parsed = _parse_id(feedback_id)
    f = await db.get(Feedback, parsed)
    if f is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="feedback_not_found")
    f.status = body.status
    await db.commit()
    await db.refresh(f)
    return _out(f)
