"""
배치 스케줄러 (D17) — 잡 함수 + 멱등 upsert + APScheduler 스캐폴딩.

정본: docs/planning/00-decisions.md D17(배치 스케줄러), 08-kpi-logic.md.

@SPEC 배치:
- daily_reports_push:        매일(평일 mon-fri, D17) 18:00 KST — 일일 리포트 ERP 푸시 로그(daily_status_push) 적재
- kpi_ai_draft_generation:   매일 21:00 KST — KPI 결과 AI 서술 초안 생성(결정론 placeholder)
- erp_incremental_sync:      매시간(KST)  — ErpSyncService.sync_users 증분 동기화
- erp_full_reconciliation:   매일 00:00 KST — ErpSyncService.sync_users 전체 대사(soft-delete 감지)

환경차단(G011 durable blocker로 리더가 등록):
- 실제 APScheduler 프로세스 상시 실행, 실 18:00/21:00/매시/00:00 KST cron 발화,
  PostgreSQL pg_advisory_lock 동시성 검증, 실 ERP 라이브 DB push는 이 환경(Windows 로컬,
  단발성 pytest 실행)에서 검증 불가 — 이 모듈은 잡 함수 로직 + 멱등 upsert +
  스케줄러 등록 스캐폴딩 + 단위테스트까지만 구현한다. 실 배포에서의 상시 기동/동시성 가드
  검증은 G011에서 수행한다.

동시성 노트(advisory_lock): PostgreSQL 배포에서는 pg_advisory_lock/unlock으로 다중 인스턴스
동시 실행을 막는다. 이 프로젝트는 D21(1인 운영, 단일 인스턴스 온프렘) 전제라 SQLite(테스트)
및 그 외 비-PostgreSQL 백엔드에서는 no-op으로 통과시킨다 — 실 동시성 가드는 Postgres
배포에서만 유효하며 검증은 환경차단(G011).
"""

from __future__ import annotations

import logging

from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from typing import AsyncIterator
from uuid import uuid4
from zlib import crc32
from zoneinfo import ZoneInfo

from sqlalchemy import JSON, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.erp.reader import ErpReader
from app.erp.sync import ErpSyncService, SyncResult
from app.models.tables import (
    DailyStatusPush,
    DailyStatusPushStatus,
    DailyStatusPushTarget,
    KpiPeriodType,
    KpiResult,
    WorkLog,
    WorkLogStatus,
)
from app.services.holidays import VARIABLE_COVERED_YEARS, is_kr_holiday

logger = logging.getLogger(__name__)

KST_TZ_NAME = "Asia/Seoul"
DEFAULT_COMPANY_ID = 1


# code LOW-MED(G010 architect): 잡 advisory 키는 프로세스 재시작 간·다중 인스턴스 간
# 동일해야 하므로 파이썬 내장 hash()가 아니라 crc32(결정론, PYTHONHASHSEED 영향 없음)로
# 생성한다. hash()는 문자열에 대해 프로세스별 랜덤 salt(PYTHONHASHSEED)가 적용되어 같은
# 잡 이름이라도 인스턴스마다 다른 값을 반환할 수 있다 — 다중 인스턴스 상호배제 전제가 깨진다.
def _stable_job_key(name: str) -> int:
    """잡 이름을 결정론적 32bit advisory key로 변환한다(crc32, PYTHONHASHSEED 비의존)."""
    return crc32(name.encode("utf-8")) & 0x7FFFFFFF

# ============================================================================
# 동시성 헬퍼 — advisory lock (PostgreSQL만 유효, 그 외는 no-op)
# ============================================================================
@asynccontextmanager
async def advisory_lock(db: AsyncSession, key: int) -> AsyncIterator[None]:
    """PostgreSQL이면 pg_advisory_lock/unlock으로 배치 중복 실행을 막는다.

    SQLite 등 비-PostgreSQL 백엔드에서는 no-op(단일 인스턴스 온프렘 전제, D21).
    실 동시성 가드 검증은 Postgres 배포에서만 가능 — 환경차단(G011).
    """
    dialect_name = db.bind.dialect.name if db.bind is not None else ""
    is_postgres = dialect_name == "postgresql"
    if is_postgres:
        await db.execute(text("SELECT pg_advisory_lock(:key)"), {"key": key})
    try:
        yield
    finally:
        if is_postgres:
            await db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})


# ============================================================================
# 잡 1 — 일일 리포트 ERP 푸시 로그 (18:00 KST)
# ============================================================================
async def daily_reports_push(db: AsyncSession, run_date: date) -> int:
    """run_date(KST 업무일) 기준 사용자별 daily_status_push(ERP_DAILY_REPORTS) 멱등 적재.

    이미 해당 user_id+push_date+target 행이 있으면 재생성하지 않는다(멱등).
    반환값: 신규 생성된 행 수.
    """
    # D17/B-18: 공휴일 정적 테이블 커버 범위 밖이면 음력/대체공휴일이 누락될 수 있으므로 WARN(운영 촉구).
    if run_date.year not in VARIABLE_COVERED_YEARS:
        logger.warning(
            "daily_reports_push: %d년은 공휴일 정적 테이블 커버 범위(%s) 밖 — 음력/대체공휴일이 "
            "누락될 수 있습니다. app/services/holidays.py _VARIABLE_HOLIDAYS를 관보 확정치로 갱신하세요.",
            run_date.year,
            sorted(VARIABLE_COVERED_YEARS),
        )
    # 공휴일이면 일일 리포트 푸시 스킵(주말은 cron day_of_week=mon-fri가 이미 스킵,
    # 공휴일은 평일에도 발생하므로 앱레벨에서 정적 공휴일 소스로 스킵한다).
    if is_kr_holiday(run_date):
        return 0
    user_ids = (
        await db.execute(
            select(WorkLog.user_id).where(WorkLog.work_date == run_date).distinct()
        )
    ).scalars().all()
    if not user_ids:
        return 0

    existing_user_ids = set(
        (
            await db.execute(
                select(DailyStatusPush.user_id).where(
                    DailyStatusPush.push_date == run_date,
                    DailyStatusPush.target == DailyStatusPushTarget.ERP_DAILY_REPORTS,
                )
            )
        ).scalars().all()
    )

    run_id = uuid4()
    created = 0
    for user_id in user_ids:
        if user_id in existing_user_ids:
            continue  # 멱등: 이미 적재된 사용자는 건너뛴다.

        logs = (
            await db.execute(
                select(WorkLog).where(
                    WorkLog.user_id == user_id, WorkLog.work_date == run_date
                )
            )
        ).scalars().all()
        payload = {
            "user_id": user_id,
            "work_date": run_date.isoformat(),
            "work_log_count": len(logs),
            "completed_count": sum(
                1 for w in logs if w.status == WorkLogStatus.COMPLETED
            ),
            "titles": [w.title for w in logs],
        }
        db.add(
            DailyStatusPush(
                user_id=user_id,
                push_date=run_date,
                target=DailyStatusPushTarget.ERP_DAILY_REPORTS,
                payload=payload,
                status=DailyStatusPushStatus.PENDING,
                run_id=run_id,
            )
        )
        created += 1

    await db.flush()
    return created


# ============================================================================
# 잡 2 — KPI AI 서술 초안 생성 (21:00 KST)
# ============================================================================
def _ai_draft_placeholder(kr: KpiResult) -> dict:
    """실 AI 호출은 환경차단(G011) — 정량 값 기반 결정론 placeholder만 생성한다."""
    return {
        "strength": f"{kr.metric} 지표 값 {kr.value} 기반 초안 대기",
        "improvement": "AI 서술 생성 대기 중(라이브 모델 호출은 G011 환경차단)",
        "note": "ai_draft_pending",
    }


async def kpi_ai_draft_generation(
    db: AsyncSession, period_type: KpiPeriodType, period_key: str
) -> int:
    """대상 kpi_result(ai_draft가 아직 없는 행)에 결정론 placeholder를 채운다(멱등).

    이미 ai_draft가 채워진 행은 건드리지 않는다 — 재실행해도 중복/덮어쓰기 없음.
    반환값: 갱신된 행 수.
    """
    rows = (
        await db.execute(
            select(KpiResult).where(
                KpiResult.period_type == period_type,
                KpiResult.period_key == period_key,
                # 주의: 이 모델의 JSONB 타입(SQLite JSON 변형)은 Python None을 SQL NULL이
                # 아닌 JSON 'null' 리터럴로 저장한다(JSON.none_as_null 기본값 False) — is_(None)은
                # 매칭되지 않으므로 JSON.NULL 센티널로 비교한다.
                KpiResult.ai_draft.is_(JSON.NULL),
            )
        )
    ).scalars().all()
    if not rows:
        return 0

    now = datetime.now(timezone.utc)
    for kr in rows:
        kr.ai_draft = _ai_draft_placeholder(kr)
        kr.ai_draft_generated_at = now

    await db.flush()
    return len(rows)


# ============================================================================
# 잡 3/4 — ERP 동기화 (증분: 매시간 / 전체 대사: 00:00 KST)
# ============================================================================
async def erp_incremental_sync(
    db: AsyncSession, reader: ErpReader, company_id: int = DEFAULT_COMPANY_ID
) -> SyncResult:
    """매시간 증분 동기화. ErpSyncService.sync_users 재사용(G009)."""
    result = await ErpSyncService(db).sync_users(reader, company_id)
    await db.commit()
    return result


async def erp_full_reconciliation(
    db: AsyncSession, reader: ErpReader, company_id: int = DEFAULT_COMPANY_ID
) -> SyncResult:
    """00:00 KST 전체 대사. sync_users는 매 실행마다 company 스코프 전체 행을 대조해
    soft-delete까지 감지하므로 증분과 동일 로직을 재사용한다(D18) — 배치 트리거 주기만 다르다.
    """
    result = await ErpSyncService(db).sync_users(reader, company_id)
    await db.commit()
    return result


# ============================================================================
# 스케줄러 등록 (D17: cron, timezone=Asia/Seoul) — 기본 미기동
# ============================================================================
def build_scheduler(session_factory=None, reader_factory=None):
    """AsyncIOScheduler에 4개 배치 잡을 KST cron으로 등록한다.

    - daily_reports:  18:00 KST 평일(mon-fri, D17), 공휴일(정적 소스 is_kr_holiday) 스킵
    - kpi_ai_draft:   21:00 KST 매일
    - erp_incremental: 매시간(0분) KST
    - erp_full_reconciliation: 00:00 KST 매일

    session_factory/reader_factory 미지정 시 app.db.SessionLocal / app.erp.reader.get_erp_reader를
    지연 임포트로 사용한다(순환 임포트 방지, 테스트에서 오버라이드 가능).
    이 함수는 스케줄러를 생성만 하고 start()하지 않는다 — 기동 여부는 main.lifespan이
    settings.scheduler_enabled로 게이트한다. 실제 상시 실행·cron 발화 검증은 G011(환경차단).
    """
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.cron import CronTrigger

    if session_factory is None:
        from app.db import SessionLocal as session_factory  # noqa: N813

    if reader_factory is None:
        from app.erp.reader import get_erp_reader as reader_factory  # noqa: N813

    scheduler = AsyncIOScheduler(timezone=KST_TZ_NAME)

    async def _run_daily_reports_push() -> None:
        async with session_factory() as db:
            async with advisory_lock(db, key=_stable_job_key("daily_reports_push")):
                # code LOW(G010 architect): D19 저장은 UTC지만 잡은 KST cron으로 발화하므로
                # 귀속 업무일도 KST 기준으로 산출한다(UTC date를 쓰면 자정 부근 경계에서
                # 하루 어긋날 수 있다).
                run_date = datetime.now(ZoneInfo(KST_TZ_NAME)).date()
                await daily_reports_push(db, run_date)
                await db.commit()

    async def _run_kpi_ai_draft_generation() -> None:
        async with session_factory() as db:
            async with advisory_lock(db, key=_stable_job_key("kpi_ai_draft_generation")):
                # code LOW(G010 architect): period_key도 KST 업무일 기준으로 산출한다.
                today = datetime.now(ZoneInfo(KST_TZ_NAME)).date()
                await kpi_ai_draft_generation(db, KpiPeriodType.DAILY, today.isoformat())
                await db.commit()

    async def _run_erp_incremental_sync() -> None:
        async with session_factory() as db:
            reader = reader_factory()
            try:
                async with advisory_lock(db, key=_stable_job_key("erp_incremental_sync")):
                    await erp_incremental_sync(db, reader)
            finally:
                await reader.aclose()

    async def _run_erp_full_reconciliation() -> None:
        async with session_factory() as db:
            reader = reader_factory()
            try:
                async with advisory_lock(db, key=_stable_job_key("erp_full_reconciliation")):
                    await erp_full_reconciliation(db, reader)
            finally:
                await reader.aclose()

    scheduler.add_job(
        _run_daily_reports_push,
        # product D17(G010 architect): 평일(mon-fri)만 발화 — 주말 업무 요약 푸시 스킵.
        # 공휴일은 평일에도 발생하므로 daily_reports_push가 정적 공휴일 소스(is_kr_holiday)로 스킵한다(B-18).
        CronTrigger(hour=18, minute=0, day_of_week="mon-fri", timezone=KST_TZ_NAME),
        id="daily_reports_push",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        _run_kpi_ai_draft_generation,
        CronTrigger(hour=21, minute=0, timezone=KST_TZ_NAME),
        id="kpi_ai_draft_generation",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        _run_erp_incremental_sync,
        CronTrigger(minute=0, timezone=KST_TZ_NAME),
        id="erp_incremental_sync",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        _run_erp_full_reconciliation,
        CronTrigger(hour=0, minute=0, timezone=KST_TZ_NAME),
        id="erp_full_reconciliation",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    return scheduler
