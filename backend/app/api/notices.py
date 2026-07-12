"""사내 공지사항 API (14-virtual-office-spec §2.8).

- GET  /api/notices        전 직원 열람 (활성 공지, pinned 우선·최신순)
- POST /api/notices        admin 작성
- DELETE /api/notices/{id} admin soft-delete (is_active=False)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import Notice

router = APIRouter(prefix="/api", tags=["notices"])


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


class NoticeOut(BaseModel):
    id: str
    title: str
    body: Optional[str] = None
    author: str
    pinned: bool
    created_at: str


class NoticeListOut(BaseModel):
    items: list[NoticeOut]
    total: int


class NoticeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: Optional[str] = None
    author: str = Field(default="공지", max_length=100)
    pinned: bool = False


def _out(n: Notice) -> NoticeOut:
    return NoticeOut(
        id=str(n.id),
        title=n.title,
        body=n.body,
        author=n.author,
        pinned=n.pinned,
        created_at=_iso(n.created_at),
    )


@router.get("/notices", response_model=NoticeListOut)
async def list_notices(
    limit: int = Query(20, ge=1, le=100),
    db=Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> NoticeListOut:
    """활성 공지 목록. pinned 상단 고정 후 최신순."""
    stmt = (
        select(Notice)
        .where(Notice.is_active.is_(True))
        .order_by(Notice.pinned.desc(), Notice.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    items = [_out(r) for r in rows]
    return NoticeListOut(items=items, total=len(items))


@router.post("/notices", response_model=NoticeOut, status_code=201)
async def create_notice(
    payload: NoticeCreate,
    db=Depends(get_db),
    user: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> NoticeOut:
    """공지 작성 (admin)."""
    notice = Notice(
        title=payload.title,
        body=payload.body,
        author=payload.author,
        pinned=payload.pinned,
        created_by=user.user_id,
    )
    db.add(notice)
    await db.commit()
    await db.refresh(notice)
    return _out(notice)


@router.delete("/notices/{notice_id}", status_code=204)
async def delete_notice(
    notice_id: UUID,
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> None:
    """공지 soft-delete (admin). is_active=False 로 비활성화."""
    notice = (
        await db.execute(select(Notice).where(Notice.id == notice_id))
    ).scalar_one_or_none()
    if notice is None or not notice.is_active:
        raise HTTPException(status_code=404, detail="notice_not_found")
    notice.is_active = False
    await db.commit()
    return None
