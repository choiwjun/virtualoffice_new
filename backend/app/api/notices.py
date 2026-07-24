"""사내 공지사항 API (14-virtual-office-spec §2.8, 04-data-model §2.7).

- GET  /api/notices        전 직원 열람 (활성·게시·미만료 공지, pinned 우선·최신순)
- POST /api/notices        admin 작성 (분류·게시/만료 시각 지정 가능)
- PATCH /api/notices/{id}  admin 수정 (06 §3.14.2)
- DELETE /api/notices/{id} admin soft-delete (is_active=False)

감사: 게시/수정/삭제 시 audit_log 기록 (06 §3.14.2 announcement_published/updated/deleted).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from app.core.deps import (
    CurrentUser,
    assert_same_company,
    company_scope,
    get_current_user,
    require_role,
)
from app.db import get_db
from app.models.tables import Notice, NoticeCategory
from app.services.audit import record_audit

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
    category: str
    pinned: bool
    published_at: str
    expires_at: Optional[str] = None
    created_at: str


class NoticeListOut(BaseModel):
    items: list[NoticeOut]
    total: int


class NoticeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: Optional[str] = None
    author: str = Field(default="공지", max_length=100)
    category: NoticeCategory = NoticeCategory.NOTICE
    pinned: bool = False
    # 미지정 시 즉시 게시 / 만료 없음.
    published_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


def _out(n: Notice) -> NoticeOut:
    return NoticeOut(
        id=str(n.id),
        title=n.title,
        body=n.body,
        author=n.author,
        category=n.category.value if hasattr(n.category, "value") else str(n.category),
        pinned=n.pinned,
        published_at=_iso(n.published_at),
        expires_at=_iso(n.expires_at) if n.expires_at else None,
        created_at=_iso(n.created_at),
    )


@router.get("/notices", response_model=NoticeListOut)
async def list_notices(
    limit: int = Query(20, ge=1, le=100),
    db=Depends(get_db),
    cid: int = Depends(company_scope),
    _: CurrentUser = Depends(get_current_user),
) -> NoticeListOut:
    """활성·게시·미만료 공지 목록 (테넌트 스코프). pinned 상단 고정 후 게시 최신순."""
    now = datetime.now(timezone.utc)
    stmt = (
        select(Notice)
        .where(
            Notice.company_id == cid,
            Notice.is_active.is_(True),
            Notice.published_at <= now,
            or_(Notice.expires_at.is_(None), Notice.expires_at > now),
        )
        .order_by(Notice.pinned.desc(), Notice.published_at.desc())
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
    cid: int = Depends(company_scope),
) -> NoticeOut:
    """공지 작성 (admin). company_id=작성자 테넌트(클라이언트 미신뢰, Phase 1c · 22 T0-1)."""
    if payload.expires_at is not None:
        published = payload.published_at or datetime.now(timezone.utc)
        if payload.expires_at <= published:
            raise HTTPException(status_code=422, detail="expires_at_before_published_at")
    notice = Notice(
        company_id=cid,
        title=payload.title,
        body=payload.body,
        author=payload.author,
        category=payload.category,
        pinned=payload.pinned,
        published_at=payload.published_at or datetime.now(timezone.utc),
        expires_at=payload.expires_at,
        created_by=user.user_id,
    )
    db.add(notice)
    await db.commit()
    await db.refresh(notice)
    await record_audit(
        db, user_id=user.user_id, action="announcement_published",
        entity_type="notice", entity_id=str(notice.id),
        new_value={"title": notice.title, "category": _out(notice).category, "pinned": notice.pinned},
    )
    return _out(notice)


class NoticeUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    body: Optional[str] = None
    author: Optional[str] = Field(None, max_length=100)
    category: Optional[NoticeCategory] = None
    pinned: Optional[bool] = None
    published_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


@router.patch("/notices/{notice_id}", response_model=NoticeOut)
async def update_notice(
    notice_id: UUID,
    payload: NoticeUpdate,
    db=Depends(get_db),
    user: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> NoticeOut:
    """공지 수정 (admin, 06 §3.14.2)."""
    notice = (
        await db.execute(select(Notice).where(Notice.id == notice_id))
    ).scalar_one_or_none()
    if notice is None or not notice.is_active:
        raise HTTPException(status_code=404, detail="notice_not_found")
    # 타사 공지는 404(존재 은닉, Phase 1c · 22 T0-1 IDOR 차단)
    assert_same_company(user, notice.company_id)

    old_value = {"title": notice.title, "pinned": notice.pinned}
    update_data = payload.model_dump(exclude_unset=True)
    for field, val in update_data.items():
        setattr(notice, field, val)

    if notice.expires_at is not None and notice.expires_at <= notice.published_at:
        raise HTTPException(status_code=422, detail="expires_at_before_published_at")

    await db.commit()
    await db.refresh(notice)
    await record_audit(
        db, user_id=user.user_id, action="announcement_updated",
        entity_type="notice", entity_id=str(notice.id),
        old_value=old_value,
        new_value={"title": notice.title, "pinned": notice.pinned},
    )
    return _out(notice)


@router.delete("/notices/{notice_id}", status_code=204)
async def delete_notice(
    notice_id: UUID,
    db=Depends(get_db),
    user: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> None:
    """공지 soft-delete (admin). is_active=False 로 비활성화."""
    notice = (
        await db.execute(select(Notice).where(Notice.id == notice_id))
    ).scalar_one_or_none()
    if notice is None or not notice.is_active:
        raise HTTPException(status_code=404, detail="notice_not_found")
    # 타사 공지는 404(존재 은닉, Phase 1c · 22 T0-1 IDOR 차단)
    assert_same_company(user, notice.company_id)
    notice.is_active = False
    await db.commit()
    await record_audit(
        db, user_id=user.user_id, action="announcement_deleted",
        entity_type="notice", entity_id=str(notice.id),
        old_value={"title": notice.title},
    )
    return None
