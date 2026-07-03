"""
KPI 분기 집계 엔드포인트(POST /kpi/aggregate) 적대적(red-team) 테스트.

목적: 관리자 동기 집계 트리거의 RBAC·입력 검증·멱등·기간 스코프를 깨뜨리는 것을 목표로 한다.
특히 잘못된 분기 키(2026-Q9 등)가 period_key_to_range ValueError로 500 누출되지 않고 400으로
방어되는지, 재집계가 uq_kpi_result_metric 위반 없이 멱등인지 검증한다.

@SPEC backend/app/api/kpi.py trigger_kpi_aggregate, 00-decisions.md D14-e/D16/D17
"""

from datetime import date
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import (
    ErpRole,
    ErpUser,
    KpiPeriodType,
    KpiResult,
    WorkLog,
    WorkLogStatus,
)

pytestmark = pytest.mark.asyncio


async def _seed_user(db_session: AsyncSession, user_id: int) -> None:
    db_session.add(
        ErpUser(
            id=user_id,
            company_id=1,
            email=f"agg{user_id}@example.com",
            name=f"Agg User {user_id}",
            erp_team_id=1,
            role=ErpRole.EMPLOYEE,
            is_active=True,
        )
    )
    await db_session.commit()


async def _seed_completed_worklog(db_session: AsyncSession, user_id: int, work_date: date) -> None:
    db_session.add(
        WorkLog(
            user_id=user_id,
            work_date=work_date,
            title="완료 업무",
            status=WorkLogStatus.COMPLETED,
            goal="목표",
            result_url="https://x/1",
            next_action="후속",
        )
    )
    await db_session.commit()


async def _q3_rows(db_session: AsyncSession, user_id: int):
    return (
        await db_session.execute(
            select(KpiResult).where(
                KpiResult.user_id == user_id,
                KpiResult.period_type == KpiPeriodType.QUARTERLY,
                KpiResult.period_key == "2026-Q3",
            )
        )
    ).scalars().all()


# ── RBAC ──────────────────────────────────────────────────
async def test_aggregate_forbidden_for_employee(async_client: AsyncClient, auth_headers):
    r = await async_client.post("/kpi/aggregate?period=2026-Q3", headers=auth_headers)
    assert r.status_code == 403, r.text


async def test_aggregate_forbidden_for_leader(async_client: AsyncClient, leader_token):
    r = await async_client.post(
        "/kpi/aggregate?period=2026-Q3", headers={"Authorization": f"Bearer {leader_token}"}
    )
    assert r.status_code == 403, r.text


async def test_aggregate_unauthenticated(async_client: AsyncClient):
    r = await async_client.post("/kpi/aggregate?period=2026-Q3")
    assert r.status_code == 401, r.text


# ── 입력 검증 (500 누출 방지) ─────────────────────────────
async def test_aggregate_missing_period_400(async_client: AsyncClient, admin_auth_headers):
    r = await async_client.post("/kpi/aggregate", headers=admin_auth_headers)
    assert r.status_code == 400, r.text


@pytest.mark.parametrize("bad_period", ["2026-Q9", "2026-Q0", "2026-Q", "abc", "2026-13-01", "2026-QQ"])
async def test_aggregate_invalid_period_returns_400_not_500(
    async_client: AsyncClient, admin_auth_headers, bad_period
):
    r = await async_client.post(f"/kpi/aggregate?period={bad_period}", headers=admin_auth_headers)
    assert r.status_code == 400, f"{bad_period} → {r.status_code} {r.text}"


async def test_aggregate_daily_period_rejected(async_client: AsyncClient, admin_auth_headers):
    r = await async_client.post("/kpi/aggregate?period=2026-07-15", headers=admin_auth_headers)
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "quarterly_period_required"


# ── 집계 동작 / 멱등 / 스코프 ─────────────────────────────
async def test_aggregate_idempotent_no_duplicate_rows(
    async_client: AsyncClient, db_session, admin_auth_headers
):
    await _seed_user(db_session, 300)
    await _seed_completed_worklog(db_session, 300, date(2026, 7, 10))

    r1 = await async_client.post("/kpi/aggregate?period=2026-Q3", headers=admin_auth_headers)
    assert r1.status_code == 200, r1.text
    n1 = len(await _q3_rows(db_session, 300))
    assert n1 >= 1

    # 재집계 3회 → 행 수 불변(멱등, uq_kpi_result_metric)
    for _ in range(3):
        rn = await async_client.post("/kpi/aggregate?period=2026-Q3", headers=admin_auth_headers)
        assert rn.status_code == 200, rn.text
    n2 = len(await _q3_rows(db_session, 300))
    assert n2 == n1, "재집계 시 중복 행 생성됨(멱등 위반)"


async def test_aggregate_excludes_users_without_period_signal(
    async_client: AsyncClient, db_session, admin_auth_headers
):
    # user 301: Q2(기간 밖)에만 데이터 → Q3 집계 대상 아님
    await _seed_user(db_session, 301)
    await _seed_completed_worklog(db_session, 301, date(2026, 5, 10))

    r = await async_client.post("/kpi/aggregate?period=2026-Q3", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    assert await _q3_rows(db_session, 301) == [], "기간 밖 신호만 있는 사용자가 집계됨"


async def test_aggregate_empty_period_no_rows(
    async_client: AsyncClient, db_session, admin_auth_headers
):
    r = await async_client.post("/kpi/aggregate?period=2027-Q1", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["aggregated_users"] == 0
    assert body["aggregated_metrics"] == 0


async def test_aggregate_values_are_nonnegative(
    async_client: AsyncClient, db_session, admin_auth_headers
):
    await _seed_user(db_session, 302)
    await _seed_completed_worklog(db_session, 302, date(2026, 8, 1))

    r = await async_client.post("/kpi/aggregate?period=2026-Q3", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    rows = await _q3_rows(db_session, 302)
    assert rows, "집계 행이 없음"
    assert all(row.value >= Decimal("0") for row in rows), "음수 metric 값(ck_kpi_value_nonnegative 위반 위험)"

async def test_aggregate_does_not_overwrite_finalized_row(
    async_client: AsyncClient, db_session, admin_auth_headers
):
    """확정(finalized)된 KpiResult 행은 재집계가 value를 덮어쓰지 않는다(D15 값 잠금)."""
    from datetime import datetime, timezone

    from app.models.tables import KpiSource

    await _seed_user(db_session, 303)
    await _seed_completed_worklog(db_session, 303, date(2026, 7, 5))
    await _seed_completed_worklog(db_session, 303, date(2026, 7, 6))
    # 사전에 확정된 work_completed_count 행(값 99) — 재집계 시 실제 계산값(2)과 다름
    db_session.add(
        KpiResult(
            user_id=303,
            period_type=KpiPeriodType.QUARTERLY,
            period_key="2026-Q3",
            metric="work_completed_count",
            value=Decimal("99"),
            source=KpiSource.VIRTUAL_OFFICE,
            final_score=Decimal("99"),
            finalized_at=datetime.now(timezone.utc),
        )
    )
    await db_session.commit()

    r = await async_client.post("/kpi/aggregate?period=2026-Q3", headers=admin_auth_headers)
    assert r.status_code == 200, r.text

    rows = await _q3_rows(db_session, 303)
    wcc = next(x for x in rows if x.metric == "work_completed_count")
    await db_session.refresh(wcc)
    assert wcc.value == Decimal("99"), f"확정 행 value가 재집계로 덮어써짐: {wcc.value}"
