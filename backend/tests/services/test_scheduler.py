"""
G010 배치 스케줄러 단위 테스트 — 잡 로직 멱등성 + build_scheduler 등록 트리거 검증.

정본: docs/planning/00-decisions.md D17(배치 스케줄러), 08-kpi-logic.md.

환경차단(G011로 리더 등록 대상): 실제 APScheduler 상시 실행, 실 18:00/21:00/매시/00:00 KST
cron 발화, PostgreSQL pg_advisory_lock 동시성은 이 환경(단발성 pytest, SQLite)에서 검증할 수
없다. 이 테스트는 (1) 잡 함수 로직의 결정론/멱등성, (2) advisory_lock의 SQLite no-op 통과,
(3) build_scheduler가 5개 잡을 올바른 트리거로 등록하는지(start() 없이), (4) scheduler_enabled
기본값(False)에서 main이 스케줄러를 기동하지 않는지만 검증한다.
"""

from datetime import date

import pytest
from apscheduler.triggers.cron import CronTrigger

from app.config import settings
from app.erp.mock_reader import MockErpReader
from app.models.tables import (
    DailyStatusPushTarget,
    ErpRole,
    ErpUser,
    KpiPeriodType,
    KpiResult,
    KpiSource,
    WorkLog,
    WorkLogStatus,
)
from app.services import scheduler as scheduler_module
from app.services.scheduler import (
    _stable_job_key,
    advisory_lock,
    build_scheduler,
    daily_reports_push,
    erp_full_reconciliation,
    erp_incremental_sync,
    kpi_ai_draft_generation,
)


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


async def _seed_work_log(db_session, user_id: int, work_date: date, status=WorkLogStatus.COMPLETED):
    wl = WorkLog(
        user_id=user_id,
        work_date=work_date,
        title="테스트 업무",
        status=status,
    )
    db_session.add(wl)
    await db_session.flush()
    return wl


# ============================================================================
# 1) daily_reports_push — 멱등(2회 호출 시 중복 없음)
# ============================================================================
@pytest.mark.asyncio
async def test_daily_reports_push_creates_one_row_per_user(db_session):
    await _seed_user(db_session, 1)
    run_date = date(2026, 7, 3)
    await _seed_work_log(db_session, 1, run_date)

    created = await daily_reports_push(db_session, run_date)
    await db_session.commit()

    assert created == 1


@pytest.mark.asyncio
async def test_daily_reports_push_is_idempotent_on_second_call(db_session):
    await _seed_user(db_session, 1)
    run_date = date(2026, 7, 3)
    await _seed_work_log(db_session, 1, run_date)

    first = await daily_reports_push(db_session, run_date)
    await db_session.commit()
    second = await daily_reports_push(db_session, run_date)
    await db_session.commit()

    assert first == 1
    assert second == 0  # 재실행해도 중복 생성 없음

    from sqlalchemy import select

    from app.models.tables import DailyStatusPush

    rows = (
        await db_session.execute(
            select(DailyStatusPush).where(
                DailyStatusPush.user_id == 1,
                DailyStatusPush.push_date == run_date,
                DailyStatusPush.target == DailyStatusPushTarget.ERP_DAILY_REPORTS,
            )
        )
    ).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_daily_reports_push_no_work_logs_creates_nothing(db_session):
    run_date = date(2026, 7, 3)
    created = await daily_reports_push(db_session, run_date)
    assert created == 0


# ============================================================================
# 2) kpi_ai_draft_generation — 멱등(이미 채워진 ai_draft는 건드리지 않음)
# ============================================================================
async def _seed_kpi_result(db_session, user_id: int, period_key: str, ai_draft=None):
    kr = KpiResult(
        user_id=user_id,
        period_type=KpiPeriodType.DAILY,
        period_key=period_key,
        metric="work_completed_count",
        value=3,
        unit="count",
        source=KpiSource.VIRTUAL_OFFICE,
        ai_draft=ai_draft,
    )
    db_session.add(kr)
    await db_session.flush()
    return kr


@pytest.mark.asyncio
async def test_kpi_ai_draft_generation_fills_placeholder_deterministically(db_session):
    await _seed_user(db_session, 1)
    kr = await _seed_kpi_result(db_session, 1, "2026-07-03")

    updated = await kpi_ai_draft_generation(db_session, KpiPeriodType.DAILY, "2026-07-03")
    await db_session.commit()

    assert updated == 1
    await db_session.refresh(kr)
    assert kr.ai_draft is not None
    assert kr.ai_draft["note"] == "ai_draft_fallback"
    assert kr.ai_draft_generated_at is not None


@pytest.mark.asyncio
async def test_kpi_ai_draft_generation_is_idempotent_and_does_not_overwrite(db_session):
    await _seed_user(db_session, 1)
    kr = await _seed_kpi_result(db_session, 1, "2026-07-03")

    first = await kpi_ai_draft_generation(db_session, KpiPeriodType.DAILY, "2026-07-03")
    await db_session.commit()
    first_generated_at = kr.ai_draft_generated_at

    second = await kpi_ai_draft_generation(db_session, KpiPeriodType.DAILY, "2026-07-03")
    await db_session.commit()

    assert first == 1
    assert second == 0  # 이미 ai_draft가 채워진 행은 재생성/덮어쓰기 없음
    await db_session.refresh(kr)
    # SQLite round-trip은 tzinfo를 보존하지 않을 수 있어 naive/aware 무관하게 값만 비교한다.
    assert kr.ai_draft_generated_at.replace(tzinfo=None) == first_generated_at.replace(tzinfo=None)


@pytest.mark.asyncio
async def test_kpi_ai_draft_generation_skips_already_drafted_rows(db_session):
    await _seed_user(db_session, 1)
    await _seed_kpi_result(
        db_session, 1, "2026-07-03", ai_draft={"note": "already_done"}
    )

    updated = await kpi_ai_draft_generation(db_session, KpiPeriodType.DAILY, "2026-07-03")
    assert updated == 0


# ============================================================================
# 3) advisory_lock — SQLite(비-PostgreSQL)에서 예외 없이 no-op 통과
# ============================================================================
@pytest.mark.asyncio
async def test_advisory_lock_is_noop_on_sqlite(db_session):
    entered = False
    async with advisory_lock(db_session, key=12345):
        entered = True
    assert entered


@pytest.mark.asyncio
async def test_advisory_lock_reraises_body_exceptions(db_session):
    with pytest.raises(ValueError):
        async with advisory_lock(db_session, key=1):
            raise ValueError("boom")


# ============================================================================
# 3-1) advisory key — crc32 기반 결정론 키(hash()의 PYTHONHASHSEED salt 문제 회피)
# ============================================================================
def test_stable_job_key_is_deterministic_across_calls():
    first = _stable_job_key("daily_reports_push")
    second = _stable_job_key("daily_reports_push")
    assert first == second
    assert 0 <= first <= 0x7FFFFFFF
    # 서로 다른 잡 이름은 (실질적으로) 서로 다른 키를 가져야 한다.
    assert _stable_job_key("kpi_ai_draft_generation") != first


# ============================================================================
# 4) ERP 동기화 잡 — 기존 ErpSyncService 재사용 확인
# ============================================================================
@pytest.mark.asyncio
async def test_erp_incremental_sync_creates_users(db_session):
    reader = MockErpReader()
    result = await erp_incremental_sync(db_session, reader, company_id=1)
    assert result.created == 5  # MockErpReader 기본 5명


@pytest.mark.asyncio
async def test_erp_full_reconciliation_detects_soft_delete(db_session):
    reader = MockErpReader()
    await erp_incremental_sync(db_session, reader, company_id=1)

    class _ShrunkReader(MockErpReader):
        async def fetch_users(self, company_id: int):
            users = await super().fetch_users(company_id)
            return users[:-1]  # 마지막 사용자 하나가 ERP에서 사라진 것처럼 시뮬레이션

    result = await erp_full_reconciliation(db_session, _ShrunkReader(), company_id=1)
    assert result.deactivated == 1


# ============================================================================
# 5) build_scheduler — 5개 잡, 올바른 cron 트리거(KST) 등록. start() 없음.
# ============================================================================
def test_build_scheduler_registers_five_jobs_with_expected_cron_triggers():
    scheduler = build_scheduler()
    try:
        jobs = {job.id: job for job in scheduler.get_jobs()}
        assert set(jobs.keys()) == {
            "daily_reports_push",
            "kpi_ai_draft_generation",
            "erp_incremental_sync",
            "erp_full_reconciliation",
            "presence_coordinate_purge",
        }


        def _field(trigger: CronTrigger, name: str) -> str:
            return str(next(f for f in trigger.fields if f.name == name))

        daily = jobs["daily_reports_push"].trigger
        assert isinstance(daily, CronTrigger)
        assert str(daily.timezone) == "Asia/Seoul"
        assert _field(daily, "hour") == "18"
        assert _field(daily, "minute") == "0"
        # product D17(G010 architect): 평일(mon-fri)만 발화 — 주말 스킵.
        assert _field(daily, "day_of_week") == "mon-fri"

        kpi_draft = jobs["kpi_ai_draft_generation"].trigger
        assert str(kpi_draft.timezone) == "Asia/Seoul"
        assert _field(kpi_draft, "hour") == "21"
        assert _field(kpi_draft, "minute") == "0"

        erp_incr = jobs["erp_incremental_sync"].trigger
        assert str(erp_incr.timezone) == "Asia/Seoul"
        assert _field(erp_incr, "minute") == "0"
        assert _field(erp_incr, "hour") == "*"  # 매시간

        erp_full = jobs["erp_full_reconciliation"].trigger
        assert str(erp_full.timezone) == "Asia/Seoul"
        assert _field(erp_full, "hour") == "0"
        assert _field(erp_full, "minute") == "0"


        purge = jobs["presence_coordinate_purge"].trigger
        assert str(purge.timezone) == "Asia/Seoul"
        assert _field(purge, "hour") == "3"
        assert _field(purge, "minute") == "0"

        # 스케줄러는 생성만 되고 시작되지 않아야 한다(기본/테스트는 미기동).
        assert scheduler.running is False
    finally:
        # 이 테스트는 start() 없이 등록만 검증하므로 스케줄러는 실행 중이 아니다(shutdown 불필요).
        pass

# ============================================================================
# 5-1) 잡 래퍼 — run_date/period_key는 UTC가 아닌 KST 업무일 기준(D19 저장은 UTC 유지)
# ============================================================================
@pytest.mark.asyncio
async def test_job_wrappers_use_kst_business_date_not_utc_date(monkeypatch):
    class _FixedDatetime(scheduler_module.datetime):
        @classmethod
        def now(cls, tz=None):
            # UTC 2026-07-03 23:30 == KST(UTC+9) 2026-07-04 08:30 — 자정 경계를 넘긴다.
            base = scheduler_module.datetime(
                2026, 7, 3, 23, 30, tzinfo=scheduler_module.timezone.utc
            )
            return base.astimezone(tz) if tz is not None else base

    monkeypatch.setattr(scheduler_module, "datetime", _FixedDatetime)

    captured: dict = {}

    async def _fake_daily_reports_push(db, run_date):
        captured["run_date"] = run_date
        return 0

    async def _fake_kpi_ai_draft_generation(db, period_type, period_key):
        captured["period_key"] = period_key
        return 0

    monkeypatch.setattr(scheduler_module, "daily_reports_push", _fake_daily_reports_push)
    monkeypatch.setattr(
        scheduler_module, "kpi_ai_draft_generation", _fake_kpi_ai_draft_generation
    )

    class _FakeSession:
        bind = None

        async def commit(self):
            pass

    class _FakeSessionFactory:
        def __call__(self):
            return self

        async def __aenter__(self):
            return _FakeSession()

        async def __aexit__(self, *exc):
            return False

    scheduler = build_scheduler(
        session_factory=_FakeSessionFactory(), reader_factory=lambda: None
    )
    try:
        await scheduler.get_job("daily_reports_push").func()
        await scheduler.get_job("kpi_ai_draft_generation").func()
    finally:
        pass

    assert captured["run_date"] == date(2026, 7, 4)
    assert captured["period_key"] == "2026-07-04"


# ============================================================================
# 6) scheduler_enabled=False 기본 — main 기동 시 스케줄러 미기동
# ============================================================================
def test_scheduler_enabled_defaults_to_false():
    assert settings.scheduler_enabled is False


@pytest.mark.asyncio
async def test_lifespan_does_not_start_scheduler_when_disabled(monkeypatch):
    from app.main import app as fastapi_app

    called = {"build_scheduler": False}

    def _fail_if_called():
        called["build_scheduler"] = True
        raise AssertionError("build_scheduler must not be called when scheduler_enabled=False")

    monkeypatch.setattr(
        "app.services.scheduler.build_scheduler", _fail_if_called, raising=False
    )
    assert settings.scheduler_enabled is False

    async with fastapi_app.router.lifespan_context(fastapi_app):
        pass

    assert called["build_scheduler"] is False
