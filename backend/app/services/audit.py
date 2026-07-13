"""감사 로그 기록 헬퍼 (D20-e, 04-data-model §2.6).

중요 엔티티 변경(seat/meeting/kpi/office_layout)을 audit_log에 남긴다.
호출자의 주 트랜잭션과 분리된 별도 commit으로 안전하게 적재한다(주 작업 실패 시 감사 미기록).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import AuditLog


async def record_audit(
    db: AsyncSession,
    *,
    user_id: Optional[int],
    action: str,
    entity_type: str,
    entity_id: str,
    old_value: Optional[dict[str, Any]] = None,
    new_value: Optional[dict[str, Any]] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    """감사 로그 1건 적재. 실패해도 주 작업을 롤백시키지 않도록 예외를 삼킨다."""
    try:
        db.add(
            AuditLog(
                user_id=user_id,
                action=action,
                entity_type=entity_type,
                entity_id=str(entity_id),
                old_value=old_value,
                new_value=new_value,
                ip_address=ip_address,
                user_agent=user_agent,
            )
        )
        await db.commit()
    except Exception:  # pragma: no cover - 감사 실패가 기능을 막지 않음
        await db.rollback()


AUDIT_RETENTION_DAYS = 1826  # 5년 + 윤년 여유 1일 (D20-e, 08 §7.3)


async def purge_expired_audit_logs(db: AsyncSession, *, now: Optional[datetime] = None) -> int:
    """D20-e: 보존 기한(5년) 초과 audit_log 파기. 삭제 행 수 반환 (commit은 호출측)."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=AUDIT_RETENTION_DAYS)
    res = await db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
    return res.rowcount or 0
