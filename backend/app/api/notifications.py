"""
알림 조회 API (P7-R3-T3) — 관리자 콘솔 알림.

- GET  /notifications            알림 목록 (admin, 필터: category, unread, limit)
- PUT  /notifications/{id}/read  읽음 처리 (admin)
- POST /notifications/read-all   전체 읽음 (admin)

경로 규약: root prefix 없음(계약 규약, Caddy /api/*→/*, D21-r). 알림은 시스템 생성(실패 훅) —
생성 엔드포인트는 노출하지 않는다.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, require_role
from app.db import get_db
from app.models.tables import Notification

router = APIRouter(tags=["notifications"])


def _out(n: Notification) -> dict:
    return {
        "notification_id": str(n.id),
        "category": n.category,
        "severity": n.severity,
        "title": n.title,
        "message": n.message,
        "context": n.context,
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


def _parse_id(notification_id: str) -> UUID:
    try:
        return UUID(notification_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="notification_not_found")


@router.get("/notifications")
async def list_notifications(
    category: Optional[str] = Query(default=None),
    unread: Optional[bool] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    stmt = select(Notification)
    count_stmt = select(func.count()).select_from(Notification).where(Notification.is_read.is_(False))
    if category is not None:
        stmt = stmt.where(Notification.category == category)
    if unread:
        stmt = stmt.where(Notification.is_read.is_(False))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    unread_total = (await db.execute(count_stmt)).scalar_one()
    return {"items": [_out(r) for r in rows], "unread_total": unread_total}


@router.put("/notifications/{notification_id}/read")
async def mark_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    parsed = _parse_id(notification_id)
    n = await db.get(Notification, parsed)
    if n is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="notification_not_found")
    n.is_read = True
    await db.commit()
    await db.refresh(n)
    return _out(n)


@router.post("/notifications/read-all")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    result = await db.execute(
        update(Notification).where(Notification.is_read.is_(False)).values(is_read=True)
    )
    await db.commit()
    return {"marked": result.rowcount or 0}
