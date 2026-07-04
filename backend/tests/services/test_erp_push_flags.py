"""
ERP 푸시 피처 플래그(D17) 단위 테스트 — daily_reports / kpi_result backfill.

@TASK P6-R3-T3a - daily_reports 실 푸시 배선(피처 플래그)
@TASK P6-R3-T3c - KPI ERP push 피처 플래그 + backfill
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.config import settings as app_settings
from app.models.tables import (
    DailyStatusPushStatus,
    DailyStatusPushTarget,
    ErpRole,
    ErpUser,
    KpiPeriodType,
    KpiResult,
    KpiSource,
    WorkLog,
    WorkLogStatus,
)
from app.services.kpi_push import push_confirmed_kpi_to_erp
from app.services.scheduler import daily_reports_erp_push, daily_reports_push


async def _seed_user(db_session, user_id: int = 1) -> None:
    db_session.add(
        ErpUser(
            id=user_id,
            company_id=1,
            email=f"user{user_id}@example.com",
            name=f"User {user_id}",
            erp_team_id=1,
            role=ErpRole.EMPLOYEE,
            is_active=True,
        )
    )
    await db_session.flush()


class _FakeResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code


class _FakeAsyncClient:
    """post()가 미리 정한 status_code 시퀀스를 순서대로 반환하는 가짜 클라이언트(실 네트워크 없음)."""

    def __init__(self, status_codes):
        self._status_codes = list(status_codes)
        self.calls = []

    async def post(self, url, json=None):
        self.calls.append((url, json))
        code = self._status_codes.pop(0) if self._status_codes else 200
        return _FakeResponse(code)


# ============================================================================
# daily_reports_erp_push — 플래그 OFF/ON
# ============================================================================
@pytest.mark.asyncio
async def test_daily_reports_erp_push_noop_when_flag_off(db_session, monkeypatch):
    monkeypatch.setattr(app_settings, "daily_reports_erp_push_enabled", False)

    await _seed_user(db_session, 1)
    run_date = date(2026, 7, 3)
    db_session.add(
        WorkLog(
            user_id=1,
            work_date=run_date,
            title="t",
            status=WorkLogStatus.COMPLETED,
        )
    )
    await db_session.flush()
    await daily_reports_push(db_session, run_date)
    await db_session.commit()

    result = await daily_reports_erp_push(db_session, run_date)

    assert result == {"pushed": 0, "failed": 0, "skipped": "flag_off"}


@pytest.mark.asyncio
async def test_daily_reports_erp_push_marks_sent_and_failed(db_session, monkeypatch):
    monkeypatch.setattr(app_settings, "daily_reports_erp_push_enabled", True)
    monkeypatch.setattr(app_settings, "erp_push_base_url", "https://erp.local")

    await _seed_user(db_session, 1)
    await _seed_user(db_session, 2)
    run_date = date(2026, 7, 3)
    for uid in (1, 2):
        db_session.add(
            WorkLog(
                user_id=uid,
                work_date=run_date,
                title="t",
                status=WorkLogStatus.COMPLETED,
            )
        )
    await db_session.flush()
    created = await daily_reports_push(db_session, run_date)
    await db_session.commit()
    assert created == 2

    fake_client = _FakeAsyncClient(status_codes=[200, 500])
    result = await daily_reports_erp_push(db_session, run_date, client=fake_client)
    await db_session.commit()

    assert result["pushed"] == 1
    assert result["failed"] == 1
    assert len(fake_client.calls) == 2

    from sqlalchemy import select

    from app.models.tables import DailyStatusPush

    rows = (
        (
            await db_session.execute(
                select(DailyStatusPush)
                .where(DailyStatusPush.target == DailyStatusPushTarget.ERP_DAILY_REPORTS)
                .order_by(DailyStatusPush.user_id)
            )
        )
        .scalars()
        .all()
    )
    statuses = {row.user_id: row.status for row in rows}
    assert statuses[1] == DailyStatusPushStatus.SENT
    assert statuses[2] == DailyStatusPushStatus.FAILED


@pytest.mark.asyncio
async def test_daily_reports_erp_push_leaves_rows_pending_when_flag_off(db_session, monkeypatch):
    monkeypatch.setattr(app_settings, "daily_reports_erp_push_enabled", False)

    await _seed_user(db_session, 1)
    run_date = date(2026, 7, 3)
    db_session.add(
        WorkLog(user_id=1, work_date=run_date, title="t", status=WorkLogStatus.COMPLETED)
    )
    await db_session.flush()
    await daily_reports_push(db_session, run_date)
    await db_session.commit()

    await daily_reports_erp_push(db_session, run_date)
    await db_session.commit()

    from sqlalchemy import select

    from app.models.tables import DailyStatusPush

    row = (
        await db_session.execute(select(DailyStatusPush).where(DailyStatusPush.user_id == 1))
    ).scalar_one()
    assert row.status == DailyStatusPushStatus.PENDING


# ============================================================================
# push_confirmed_kpi_to_erp — 플래그 OFF/ON + 멱등
# ============================================================================
async def _seed_confirmed_kpi(db_session, user_id: int) -> KpiResult:
    kr = KpiResult(
        user_id=user_id,
        period_type=KpiPeriodType.DAILY,
        period_key="2026-07-03",
        metric="work_completed_count",
        value=Decimal("3"),
        unit="count",
        source=KpiSource.VIRTUAL_OFFICE,
        final_score=Decimal("3"),
        finalized_at=datetime.now(timezone.utc),
        pushed_to_erp=False,
    )
    db_session.add(kr)
    await db_session.flush()
    return kr


@pytest.mark.asyncio
async def test_push_confirmed_kpi_noop_when_flag_off(db_session, monkeypatch):
    monkeypatch.setattr(app_settings, "kpi_erp_push_enabled", False)
    await _seed_user(db_session, 1)
    kr = await _seed_confirmed_kpi(db_session, 1)
    await db_session.commit()

    result = await push_confirmed_kpi_to_erp(db_session)

    assert result == {"pushed": 0, "failed": 0, "skipped": "flag_off"}
    await db_session.refresh(kr)
    assert kr.pushed_to_erp is False


@pytest.mark.asyncio
async def test_push_confirmed_kpi_marks_pushed_and_is_idempotent(db_session, monkeypatch):
    monkeypatch.setattr(app_settings, "kpi_erp_push_enabled", True)
    monkeypatch.setattr(app_settings, "erp_push_base_url", "https://erp.local")

    await _seed_user(db_session, 1)
    kr = await _seed_confirmed_kpi(db_session, 1)
    await db_session.commit()

    fake_client = _FakeAsyncClient(status_codes=[200])
    result = await push_confirmed_kpi_to_erp(db_session, client=fake_client)
    await db_session.commit()

    assert result == {"pushed": 1, "failed": 0}
    await db_session.refresh(kr)
    assert kr.pushed_to_erp is True
    assert kr.pushed_at is not None

    # 멱등: 이미 푸시된 행은 다시 대상이 되지 않는다(2회차 0건).
    fake_client_2 = _FakeAsyncClient(status_codes=[200])
    second = await push_confirmed_kpi_to_erp(db_session, client=fake_client_2)

    assert second["pushed"] == 0
    assert len(fake_client_2.calls) == 0
