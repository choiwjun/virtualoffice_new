"""
Group B 결정 반영 검증 (B-15 레거시 sync deprecation+로깅 통일, B-17 단일 인스턴스 max_instances,
B-18 정적 공휴일 daily_reports 스킵).

@SPEC docs/planning/loop/blocked-work-registry.md B-15/B-17/B-18, 00-decisions D17/D18/D21
"""

from datetime import date
import logging

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import (
    ErpRole,
    ErpSyncLog,
    ErpSyncStatus,
    ErpUser,
    WorkLog,
    WorkLogStatus,
)
from app.services.holidays import VARIABLE_COVERED_YEARS, is_kr_holiday
from app.services.scheduler import build_scheduler, daily_reports_push

# asyncio_mode=auto (pytest.ini) — async 테스트는 마크 없이 실행. 이 파일은 sync/async 혼합이라
# 모듈 pytestmark를 두지 않는다(sync 테스트에 asyncio 마크가 붙는 경고 방지).


# ── B-18: 정적 공휴일 소스 ────────────────────────────────
def test_holiday_fixed_solar_applies_every_year():
    # 양력 고정 공휴일은 연도 무관
    assert is_kr_holiday(date(2026, 1, 1))    # 신정
    assert is_kr_holiday(date(2027, 1, 1))
    assert is_kr_holiday(date(2029, 5, 5))    # 어린이날(커버 범위 밖 연도도 고정은 적용)
    assert is_kr_holiday(date(2026, 12, 25))  # 성탄절
    # 제헌절(7/17): 2008년 제외 → 법률 제21338호(2026-05-11 시행) 재지정, 2026년부터 고정 공휴일.
    assert is_kr_holiday(date(2026, 7, 17))   # 제헌절(금) 재지정
    assert is_kr_holiday(date(2027, 7, 17))   # 제헌절(토) — 당일도 공휴일


def test_holiday_variable_lunar_and_substitutes():
    # 2026 음력/대체
    assert is_kr_holiday(date(2026, 2, 17))   # 설날
    assert is_kr_holiday(date(2026, 9, 25))   # 추석
    assert is_kr_holiday(date(2026, 5, 25))   # 부처님오신날 대체
    assert is_kr_holiday(date(2026, 3, 2))    # 삼일절 대체
    # 2027 음력
    assert is_kr_holiday(date(2027, 2, 8))    # 설날 연휴
    assert is_kr_holiday(date(2027, 9, 15))   # 추석
    assert is_kr_holiday(date(2027, 5, 13))   # 부처님오신날
    assert is_kr_holiday(date(2027, 7, 19))   # 제헌절 대체(7/17 토 → 월)


def test_non_holiday_returns_false():
    assert not is_kr_holiday(date(2026, 7, 3))    # 평일, 비공휴일
    assert not is_kr_holiday(date(2026, 3, 3))    # 삼일절 아님
    assert not is_kr_holiday(date(2026, 9, 28))   # 추석 이후 평일
    assert 2026 in VARIABLE_COVERED_YEARS and 2027 in VARIABLE_COVERED_YEARS


async def _seed_user(db_session: AsyncSession, user_id: int = 1) -> None:
    db_session.add(
        ErpUser(id=user_id, company_id=1, email=f"gb{user_id}@example.com", name=f"GB {user_id}",
                erp_team_id=1, role=ErpRole.EMPLOYEE, is_active=True)
    )
    await db_session.flush()


async def _seed_work_log(db_session: AsyncSession, user_id: int, d: date) -> None:
    db_session.add(
        WorkLog(user_id=user_id, work_date=d, title="업무", status=WorkLogStatus.COMPLETED)
    )
    await db_session.commit()


async def test_daily_reports_push_skips_holiday(db_session):
    """공휴일에는 work_log가 있어도 daily_reports 푸시를 생성하지 않는다(B-18)."""
    await _seed_user(db_session, 1)
    holiday = date(2026, 1, 1)  # 신정(평일 목요일, 주말 아님)
    await _seed_work_log(db_session, 1, holiday)

    created = await daily_reports_push(db_session, holiday)
    assert created == 0, "공휴일에 daily_reports 푸시가 생성됨"


async def test_daily_reports_push_runs_on_business_day(db_session):
    """비공휴일 평일에는 정상 생성(스킵 로직이 과잉 차단하지 않음)."""
    await _seed_user(db_session, 1)
    workday = date(2026, 7, 3)  # 비공휴일
    await _seed_work_log(db_session, 1, workday)

    created = await daily_reports_push(db_session, workday)
    assert created == 1


# ── B-17: 단일 인스턴스 — 모든 잡 max_instances=1, coalesce=True ──
def test_scheduler_jobs_are_single_instance_and_coalesced():
    scheduler = build_scheduler()
    try:
        jobs = scheduler.get_jobs()
        assert len(jobs) == 4
        for job in jobs:
            assert job.max_instances == 1, f"{job.id} max_instances != 1 (단일 인스턴스 중복 실행 방지)"
            assert job.coalesce is True, f"{job.id} coalesce != True (미스파이어 누적 방지)"
    finally:
        # build_scheduler는 start()하지 않으므로 shutdown 불필요, 방어적으로 정리
        if scheduler.running:
            scheduler.shutdown(wait=False)


# ── B-15: 레거시 /api/erp/sync deprecate + ErpSyncLog 기록 통일 ──
async def test_legacy_erp_sync_records_synclog_and_marks_deprecated(
    async_client: AsyncClient, db_session, admin_auth_headers
):
    """레거시 /api/erp/sync: 하위호환 SyncResultOut 유지 + Deprecation 헤더 + ErpSyncLog 기록(모니터링 사각 제거)."""
    resp = await async_client.post("/api/erp/sync", headers=admin_auth_headers)
    assert resp.status_code == 200, resp.text

    # 하위호환 응답 shape 유지(MockErpReader 기본 5명)
    body = resp.json()
    assert body == {"created": 5, "updated": 0, "deactivated": 0}

    # RFC 8594 Deprecation 헤더 + 후속 버전 Link
    assert resp.headers.get("deprecation") == "true"
    assert "/sync/erp" in resp.headers.get("link", "")

    # 모니터링 사각 제거: 레거시 경로도 ErpSyncLog(SUCCESS) 기록
    logs = (await db_session.execute(select(ErpSyncLog))).scalars().all()
    assert len(logs) == 1
    assert logs[0].status == ErpSyncStatus.SUCCESS
    assert logs[0].created_count == 5


async def test_legacy_erp_sync_still_admin_only(async_client: AsyncClient, auth_headers):
    """deprecate 후에도 RBAC(admin 전용) 유지 — employee 403."""
    resp = await async_client.post("/api/erp/sync", headers=auth_headers)
    assert resp.status_code == 403, resp.text


async def test_daily_reports_push_skips_constitution_day(db_session):
    """제헌절(2026-07-17 금, 재지정)에도 daily_reports 푸시를 생성하지 않는다(B-18 BLOCK 회귀 가드)."""
    await _seed_user(db_session, 1)
    jeheonjeol = date(2026, 7, 17)
    await _seed_work_log(db_session, 1, jeheonjeol)

    created = await daily_reports_push(db_session, jeheonjeol)
    assert created == 0, "제헌절에 daily_reports 푸시가 생성됨(재지정 공휴일 누락)"


async def test_daily_reports_warns_for_uncovered_year(db_session, caplog):
    """커버 범위 밖 연도(2029)는 음력/대체공휴일 누락 가능 → WARN 로그로 갱신 촉구."""
    await _seed_user(db_session, 1)
    uncovered = date(2029, 3, 5)  # 비공휴일 평일, VARIABLE_COVERED_YEARS 밖
    with caplog.at_level(logging.WARNING):
        await daily_reports_push(db_session, uncovered)
    assert any("커버 범위" in r.message or "2029" in str(r.args) for r in caplog.records), \
        "미커버 연도 WARN 미발생"


async def test_legacy_erp_sync_records_failed_log_on_failure(
    async_client: AsyncClient, db_session, admin_auth_headers, monkeypatch
):
    """레거시 /api/erp/sync 실패 시 FAILED ErpSyncLog 기록(정본 sync.py와 동일, 실패 모니터링 사각 제거)."""

    async def _boom(self, reader, company_id):
        raise RuntimeError("erp unreachable")

    monkeypatch.setattr("app.api.erp.ErpSyncService.sync_users", _boom)

    resp = await async_client.post("/api/erp/sync", headers=admin_auth_headers)
    assert resp.status_code == 500, resp.text

    logs = (await db_session.execute(select(ErpSyncLog))).scalars().all()
    assert len(logs) == 1
    assert logs[0].status == ErpSyncStatus.FAILED
    assert logs[0].error_count == 1
    assert "erp unreachable" in (logs[0].error_message or "")
