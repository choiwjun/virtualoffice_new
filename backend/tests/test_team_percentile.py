"""
test_team_percentile.py — 팀 벤치마크 백분위 (08 §5.4, D14-e).

- 모수: 평가 기간 실소속 팀(user_team_history)의 활성 직원 quarterly_total 분포
- 모수 < 5 → 부서(org_group/team_zone) 폴백 → 그래도 < 5 → None
- 산식: (아래 + 0.5×동률) / n × 100
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import ErpUser, KpiPeriodType, KpiResult, KpiSource, UserTeamHistory
from app.services.kpi_engine import compute_team_percentile

Q = "2026-Q3"
Q_START = datetime(2026, 7, 1, tzinfo=timezone.utc)


def _user(uid: int, team: int, active: bool = True) -> ErpUser:
    return ErpUser(
        id=uid, company_id=1, email=f"u{uid}@x.com", name=f"U{uid}",
        erp_team_id=team, role="employee", is_active=active,
    )


def _qt(uid: int, value: float) -> KpiResult:
    return KpiResult(
        user_id=uid, period_type=KpiPeriodType.QUARTERLY, period_key=Q,
        metric="quarterly_total", value=Decimal(str(value)), source=KpiSource.VIRTUAL_OFFICE,
    )


@pytest.mark.asyncio
async def test_percentile_basic_team_of_five(db_session: AsyncSession):
    """5명 팀: 값 [10,20,30,40,50] → 30의 백분위 = (2+0.5)/5×100 = 50.0"""
    for i, v in enumerate([10, 20, 30, 40, 50], start=1):
        db_session.add(_user(i, team=7))
        db_session.add(_qt(i, v))
    await db_session.flush()

    pct = await compute_team_percentile(db_session, 3, "quarterly", Q)
    assert pct == 50.0
    top = await compute_team_percentile(db_session, 5, "quarterly", Q)
    assert top == 90.0  # (4+0.5)/5×100


@pytest.mark.asyncio
async def test_percentile_daily_returns_none(db_session: AsyncSession):
    """daily에는 백분위 없음 — 분기 벤치마크 전용."""
    assert await compute_team_percentile(db_session, 1, "daily", "2026-07-01") is None


@pytest.mark.asyncio
async def test_percentile_uses_period_team_history(db_session: AsyncSession):
    """분기 중 팀 이동자: 평가 기간 소속팀(이력) 모수로 계산 — 현재 팀 아님 (08 §5.4)."""
    # 팀 7에 5명 (이력 없음 → 현재 소속 폴백)
    for i, v in enumerate([10, 20, 30, 40, 50], start=1):
        db_session.add(_user(i, team=7))
        db_session.add(_qt(i, v))
    # user 9: 현재 팀 99이지만 분기 내내 팀 7 소속 이력
    db_session.add(_user(9, team=99))
    db_session.add(UserTeamHistory(
        user_id=9, erp_team_id=7,
        valid_from=datetime(2026, 1, 1, tzinfo=timezone.utc),
        valid_to=None,
    ))
    db_session.add(_qt(9, 60))
    await db_session.flush()

    # user 9는 팀 7 모수(6명)에서 최고값 → (5+0.5)/6×100 ≈ 91.7
    pct = await compute_team_percentile(db_session, 9, "quarterly", Q)
    assert pct == round((5 + 0.5) / 6 * 100, 1)


@pytest.mark.asyncio
async def test_percentile_small_pool_returns_none_without_org(db_session: AsyncSession):
    """모수 < 5 & 부서 매핑(team_zone) 없음 → None (과대 해석 방지)."""
    for i, v in enumerate([10, 20, 30], start=1):
        db_session.add(_user(i, team=8))
        db_session.add(_qt(i, v))
    await db_session.flush()

    assert await compute_team_percentile(db_session, 2, "quarterly", Q) is None


@pytest.mark.asyncio
async def test_percentile_inactive_excluded(db_session: AsyncSession):
    """비활성 직원은 모수 제외."""
    for i, v in enumerate([10, 20, 30, 40, 50], start=1):
        db_session.add(_user(i, team=7))
        db_session.add(_qt(i, v))
    db_session.add(_user(6, team=7, active=False))
    db_session.add(_qt(6, 99))
    await db_session.flush()

    # 비활성 6번 제외 → 모수 5, user 5가 최고
    assert await compute_team_percentile(db_session, 5, "quarterly", Q) == 90.0
