"""
test_retention_and_holidays.py — D20-e 감사로그 5년 파기 + D17 EOD 공휴일 스킵.

(spec-impl-gap-audit-2026-07-13 §3 잔여 — 운영 배치 2종)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import AuditLog
from app.services.audit import AUDIT_RETENTION_DAYS, purge_expired_audit_logs


@pytest.mark.asyncio
async def test_purge_expired_audit_logs(db_session: AsyncSession):
    """5년(1826일) 초과 행만 파기, 이내 행은 보존 (D20-e, 08 §7.3)."""
    now = datetime.now(timezone.utc)
    old_row = AuditLog(
        action="kpi_adjusted", entity_type="kpi_result", entity_id="x",
        created_at=now - timedelta(days=AUDIT_RETENTION_DAYS + 10),
    )
    fresh_row = AuditLog(
        action="kpi_finalized", entity_type="kpi_result", entity_id="y",
        created_at=now - timedelta(days=30),
    )
    boundary_row = AuditLog(
        action="seat_assigned", entity_type="seat", entity_id="z",
        created_at=now - timedelta(days=AUDIT_RETENTION_DAYS - 1),
    )
    db_session.add_all([old_row, fresh_row, boundary_row])
    await db_session.flush()

    deleted = await purge_expired_audit_logs(db_session, now=now)
    assert deleted == 1

    remaining = (await db_session.execute(select(func.count()).select_from(AuditLog))).scalar()
    assert remaining == 2
    actions = set((await db_session.execute(select(AuditLog.action))).scalars())
    assert actions == {"kpi_finalized", "seat_assigned"}


@pytest.mark.asyncio
async def test_eod_job_skips_holiday(monkeypatch):
    """settings.eod_holidays에 오늘(KST)이 있으면 EOD 배치가 DB 접근 전에 스킵 (D17)."""
    from app.config import settings
    from app.services import scheduler as sched

    kst_today = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
    monkeypatch.setattr(settings, "eod_holidays", f"2000-01-01, {kst_today}")

    # DB에 닿으면 실패하도록 SessionLocal을 폭탄으로 대체 — 스킵 경로 검증
    def _boom():
        raise AssertionError("holiday인데 DB에 접근함 — 스킵 미동작")

    monkeypatch.setattr(sched, "SessionLocal", _boom)
    await sched._eod_push_job()  # 예외 없이 return이면 스킵 성공
