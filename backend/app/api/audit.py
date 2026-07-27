"""감사 로그 조회 API (management-api.yaml: /audit-logs). admin 전용.

D20-e: audit_log 5년 보존. action/entity_type/기간 필터 + 페이지네이션.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select

from app.core.deps import CurrentUser, company_scope, require_role
from app.db import get_db
from app.models.tables import AuditLog

router = APIRouter(prefix="/api", tags=["audit"])


class AuditLogOut(BaseModel):
    id: str
    user_id: Optional[int]
    action: str
    entity_type: str
    entity_id: str
    old_value: Optional[dict] = None
    new_value: Optional[dict] = None
    created_at: str


class AuditLogListOut(BaseModel):
    items: list[AuditLogOut]
    total: int


@router.get("/audit-logs", response_model=AuditLogListOut)
async def list_audit_logs(
    action: Optional[str] = Query(None, description="액션 필터"),
    entity_type: Optional[str] = Query(None, description="엔티티 타입 필터"),
    start: Optional[str] = Query(None, description="ISO8601 시작(포함)"),
    end: Optional[str] = Query(None, description="ISO8601 종료(포함)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
    cid: int = Depends(company_scope),
) -> AuditLogListOut:
    # Phase 1d: 자기 회사 기록만. 이전에는 전 테넌트의 권한 변경·KPI 조정 이력이 노출됐다.
    stmt = select(AuditLog).where(AuditLog.company_id == cid)
    count_stmt = select(func.count()).select_from(AuditLog).where(AuditLog.company_id == cid)
    if action:
        stmt = stmt.where(AuditLog.action == action)
        count_stmt = count_stmt.where(AuditLog.action == action)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
        count_stmt = count_stmt.where(AuditLog.entity_type == entity_type)
    if start:
        dt = datetime.fromisoformat(start)
        stmt = stmt.where(AuditLog.created_at >= dt)
        count_stmt = count_stmt.where(AuditLog.created_at >= dt)
    if end:
        dt = datetime.fromisoformat(end)
        stmt = stmt.where(AuditLog.created_at <= dt)
        count_stmt = count_stmt.where(AuditLog.created_at <= dt)

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        await db.execute(stmt.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset))
    ).scalars().all()

    def _iso(dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()

    items = [
        AuditLogOut(
            id=str(r.id),
            user_id=r.user_id,
            action=r.action,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            old_value=r.old_value,
            new_value=r.new_value,
            created_at=_iso(r.created_at),
        )
        for r in rows
    ]
    return AuditLogListOut(items=items, total=total)
