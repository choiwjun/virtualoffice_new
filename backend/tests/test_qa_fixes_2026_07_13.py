"""QA 감사(2026-07-13) 수리분 서비스 레벨 테스트.

- D17: EOD 배치 push row 자동 생성 (ensure_eod_rows)
- 08 §3.3: 무이의 7일 자동확정 (auto_finalize_expired)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.tables import (
    DailyStatusPush,
    DailyStatusPushStatus,
    DailyStatusPushTarget,
    ErpRole,
    ErpUser,
    KpiObjectionStatus,
    KpiPeriodType,
    KpiResult,
    KpiSource,
    WorkLog,
    WorkLogStatus,
)
from app.services.eod_push import ensure_eod_rows
from app.services.kpi_engine import auto_finalize_expired


@pytest.mark.asyncio
async def test_ensure_eod_rows_auto_creates_from_work_logs(db_session):
    """당일 work_log 보유 활성 직원에 auto_generated pending row 생성, 수동 제출자는 스킵."""
    d = date(2026, 7, 13)
    db_session.add_all([
        ErpUser(id=1, company_id=1, email="a@x.com", name="A", erp_team_id=1, role=ErpRole.EMPLOYEE),
        ErpUser(id=2, company_id=1, email="b@x.com", name="B", erp_team_id=1, role=ErpRole.EMPLOYEE),
        WorkLog(user_id=1, work_date=d, title="완료 업무", status=WorkLogStatus.COMPLETED),
        WorkLog(user_id=1, work_date=d, title="진행 업무", status=WorkLogStatus.STARTED),
        WorkLog(user_id=2, work_date=d, title="수동 제출자 업무", status=WorkLogStatus.COMPLETED),
        # user 2는 이미 수동 제출 → 자동 생성 스킵
        DailyStatusPush(
            user_id=2, push_date=d, target=DailyStatusPushTarget.ERP_DAILY_REPORTS,
            payload={"today_plan": "수동"}, status=DailyStatusPushStatus.PENDING,
        ),
    ])
    await db_session.flush()

    created = await ensure_eod_rows(db_session, d)
    assert created == 1

    rows = (
        await db_session.execute(
            select(DailyStatusPush).where(DailyStatusPush.push_date == d, DailyStatusPush.user_id == 1)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].payload["auto_generated"] is True
    assert rows[0].payload["completed"] == ["완료 업무"]
    assert rows[0].payload["in_progress"] == ["진행 업무"]

    # 멱등: 재실행 시 중복 생성 없음
    created2 = await ensure_eod_rows(db_session, d)
    assert created2 == 0


@pytest.mark.asyncio
async def test_auto_finalize_expired_after_7_days(db_session):
    """공개 7일 경과 & 무이의 → 자동확정 + push 적재. 창 내/이의 진행 중은 미확정."""
    old = datetime.now(timezone.utc) - timedelta(days=8)
    recent = datetime.now(timezone.utc) - timedelta(days=1)

    expired = KpiResult(
        user_id=1, period_type=KpiPeriodType.DAILY, period_key="2026-07-05",
        metric="collaboration_score", value=Decimal("50.0"), unit="score",
        source=KpiSource.VIRTUAL_OFFICE, objection_status=KpiObjectionStatus.NONE,
        created_at=old, updated_at=old,
    )
    within_window = KpiResult(
        user_id=1, period_type=KpiPeriodType.DAILY, period_key="2026-07-12",
        metric="collaboration_score", value=Decimal("60.0"), unit="score",
        source=KpiSource.VIRTUAL_OFFICE, objection_status=KpiObjectionStatus.NONE,
        created_at=recent, updated_at=recent,
    )
    objecting = KpiResult(
        user_id=2, period_type=KpiPeriodType.DAILY, period_key="2026-07-05",
        metric="collaboration_score", value=Decimal("70.0"), unit="score",
        source=KpiSource.VIRTUAL_OFFICE, objection_status=KpiObjectionStatus.SUBMITTED,
        created_at=old, updated_at=old,
    )
    db_session.add_all([expired, within_window, objecting])
    await db_session.flush()

    count = await auto_finalize_expired(db_session)
    assert count == 1

    assert expired.finalized_at is not None
    assert float(expired.final_score) == 50.0
    assert within_window.finalized_at is None
    assert objecting.finalized_at is None

    push = (
        await db_session.execute(
            select(DailyStatusPush).where(DailyStatusPush.target == DailyStatusPushTarget.ERP_KPI_RESULTS)
        )
    ).scalar_one()
    assert push.payload["auto_finalized"] is True
    assert push.payload["kpi_result_id"] == str(expired.id)
