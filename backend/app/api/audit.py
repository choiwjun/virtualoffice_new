"""
감사 로그 조회 API (읽기 전용, root, prefix 없음 — meetings.py/layouts.py/sync.py와 동일 계약 규약).

- GET /audit-logs            감사 로그 목록 (admin, 필터: action, user_id, days, from_date, to_date,
                              페이지네이션: limit, offset)
- GET /audit-logs/{log_id}   개별 감사 로그 조회 (admin)

@SPEC 04-data-model.md §2.6 (AuditLog)
@SPEC 00-decisions.md D20-e (컴플라이언스: 5년 보존 후 파기/익명화)

경로 규약(의도적, 계약 테스트 기준): 감사 로그 엔드포인트는 root(/audit-logs*, prefix 없음).
meetings.py/layouts.py/sync.py와 동일 이탈 근거 — 외부 공개 시 Caddy가 /api/* → /* 로
라우팅한다(D21-r).

응답 매핑: AuditLog.created_at → timestamp, entity_type → resource_type,
entity_id → resource_id, {old_value, new_value} → changes:{old, new}.

페이지네이션(G009 architect COMMENT MEDIUM 정정): limit(기본 100, 최대 500 cap), offset(기본 0)
쿼리 추가. 응답에 {logs, total, limit, offset}을 포함한다 — total은 필터 적용 후 전체 건수(페이지
분리 전)이다. from_date/to_date(ISO date)는 지정 시 days보다 우선하여 created_at 범위 필터로
적용된다(둘 다 없으면 days, 둘 다 없으면 무제한).

생산자 훅 노트(G009 architect COMMENT LOW): 감사 로그 생산자 훅(app.services.audit_service,
P7-R3-T1)이 seats/layouts/meetings 등 도메인 API에 아직 연결되지 않았다. 훅이 랜딩하기 전까지
/audit-logs는 (테스트에서 직접 시드하지 않는 한) 비어있다 — 실제 훅 구현은 별도 후속이며
본 스토리(G009) 범위 밖이다. 리더가 G011 후속 레지스트리에 등록한다.

보존 정책(D20-e, 5년 보존 후 파기/익명화)은 Phase 2 구현 대상이며
TestAuditLogAPI.test_audit_log_retention_5years는 skip 유지한다.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, require_role
from app.db import get_db
from app.models.tables import AuditLog

router = APIRouter(tags=["audit"])


# ── 헬퍼 ──────────────────────────────────────────────────
def _parse_log_id(log_id: str) -> UUID:
    """수동 UUID 파싱: 타입검증 422 대신 404로 통일(work_log_id/layout_id 계약과 동일 패턴)."""
    try:
        return UUID(log_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="audit_log_not_found")


def _audit_log_out(log: AuditLog) -> dict:
    return {
        "id": str(log.id),
        "timestamp": log.created_at.isoformat(),
        "user_id": log.user_id,
        "action": log.action,
        "resource_type": log.entity_type,
        "resource_id": log.entity_id,
        "changes": {"old": log.old_value, "new": log.new_value},
        "ip_address": log.ip_address,
    }


# ── 목록 조회 ─────────────────────────────────────────────
@router.get("/audit-logs")
async def list_audit_logs(
    action: Optional[str] = Query(default=None),
    user_id: Optional[int] = Query(default=None),
    days: Optional[int] = Query(default=None, ge=1),
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    conditions = []
    if action is not None:
        conditions.append(AuditLog.action == action)
    if user_id is not None:
        conditions.append(AuditLog.user_id == user_id)
    if from_date is not None or to_date is not None:
        # from_date/to_date가 지정되면 days보다 우선한다(정정 항목 1, 명시적 우선순위).
        if from_date is not None:
            start = datetime.combine(from_date, datetime.min.time(), tzinfo=timezone.utc)
            conditions.append(AuditLog.created_at >= start)
        if to_date is not None:
            end = datetime.combine(to_date, datetime.max.time(), tzinfo=timezone.utc)
            conditions.append(AuditLog.created_at <= end)
    elif days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        conditions.append(AuditLog.created_at >= cutoff)

    stmt = select(AuditLog)
    count_stmt = select(func.count()).select_from(AuditLog)
    for condition in conditions:
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = (await db.execute(count_stmt)).scalar_one()
    stmt = stmt.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    logs = [_audit_log_out(row) for row in rows]
    return {"logs": logs, "total": total, "limit": limit, "offset": offset}


# ── 단건 조회 ─────────────────────────────────────────────
@router.get("/audit-logs/{log_id}")
async def get_audit_log(
    log_id: str,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    parsed = _parse_log_id(log_id)
    row = (
        await db.execute(select(AuditLog).where(AuditLog.id == parsed))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="audit_log_not_found")
    return _audit_log_out(row)
