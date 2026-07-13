"""
배치 스케줄러 (APScheduler) — KPI 자동계산 + ERP 정기 동기화.

D17: KPI 매일 18:00/21:00 KST 자동계산
D18: ERP 매시간+00:00 KST 증분 동기화

수동 트리거는 기존 API 유지 (POST /api/kpi-results/compute, POST /api/erp/sync).
"""

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from app.db import SessionLocal
from app.erp.reader import get_erp_reader
from app.erp.sync import ErpSyncService
from app.models.tables import ErpSyncLog, ErpUser, Presence
from app.services.kpi_engine import compute_and_upsert_kpi

if TYPE_CHECKING:
    pass

DEFAULT_COMPANY_ID = 1

# ──────────────────────────────────────────────────────────────────────────────
# 배치 작업 함수
# ──────────────────────────────────────────────────────────────────────────────


async def _kpi_batch_job() -> None:
    """KPI 자동계산: 전체 active 직원 대상 daily/quarterly (D16).

    period_type은 정본상 daily/quarterly 2종만 존재(D16: weekly/monthly 폐기).
    각 period_key는 KST 기준 현재값으로 계산해 넘긴다(배치 경계=KST, D19):
      - daily     → 'YYYY-MM-DD' (KST 오늘)
      - quarterly → 'YYYY-Q#'    (KST 현재 분기)
    """
    print("[Scheduler] KPI batch started")

    # 배치 경계는 KST(D19). 현재 KST 기준 daily/quarterly period_key 산출.
    kst_now = datetime.now(timezone(timedelta(hours=9)))
    daily_key = kst_now.date().isoformat()
    quarter_key = f"{kst_now.year}-Q{(kst_now.month - 1) // 3 + 1}"

    async with SessionLocal() as db:
        try:
            # 활성 직원 전체
            users = (
                await db.execute(
                    select(ErpUser).where(
                        ErpUser.company_id == DEFAULT_COMPANY_ID,
                        ErpUser.is_active.is_(True),
                    )
                )
            ).scalars().all()

            for user in users:
                # daily/quarterly 각각 계산 (D16 — weekly/monthly 폐기)
                for period_type, period_key in (
                    ("daily", daily_key),
                    ("quarterly", quarter_key),
                ):
                    await compute_and_upsert_kpi(
                        db=db,
                        user_id=user.id,
                        period_type=period_type,
                        period_key=period_key,
                    )
            await db.commit()
            print(f"[Scheduler] KPI batch completed: {len(users)} users")
        except Exception as exc:
            await db.rollback()
            print(f"[Scheduler] KPI batch failed: {exc}")


async def _erp_sync_batch_job() -> None:
    """ERP 동기화: 매시간 증분 + 00:00 전체 대사."""
    print("[Scheduler] ERP sync batch started")
    async with SessionLocal() as db:
        started = datetime.now(timezone.utc)
        log = ErpSyncLog(started_at=started, trigger="scheduled")
        db.add(log)
        try:
            reader = get_erp_reader()
            try:
                svc = ErpSyncService(db)
                result = await svc.sync_users(reader, DEFAULT_COMPANY_ID)
                log.created = result.created
                log.updated = result.updated
                log.deactivated = result.deactivated
                log.status = "success"
                log.finished_at = datetime.now(timezone.utc)
                await db.commit()
                print(f"[Scheduler] ERP sync completed: +{result.created} ⟳{result.updated} −{result.deactivated}")
            finally:
                await reader.aclose()
        except Exception as exc:
            await db.rollback()
            db.add(
                ErpSyncLog(
                    started_at=started,
                    trigger="scheduled",
                    status="failed",
                    error=str(exc)[:1000],
                    finished_at=datetime.now(timezone.utc),
                )
            )
            await db.commit()
            print(f"[Scheduler] ERP sync failed: {exc}")


async def _eod_push_job() -> None:
    """REQ-008/D18/D17: EOD ERP 전송.

    D17: 주말 스킵(공휴일은 달력 소스 미확보 — 외부 의존, TODO), 배치가 당일 push row
    자동 생성(ensure_eod_rows) 후 pending(+failed<MAX_RETRY)을 전송.
    """
    from app.services.eod_push import ensure_eod_rows, run_eod_push

    kst_now = datetime.now(timezone(timedelta(hours=9)))
    if kst_now.weekday() >= 5:  # 토(5)·일(6) — D17 주말 스킵
        print("[Scheduler] EOD push skipped (weekend, D17)")
        return

    print("[Scheduler] EOD push started")
    async with SessionLocal() as db:
        try:
            created = await ensure_eod_rows(db, kst_now.date())
            summary = await run_eod_push(db)
            await db.commit()
            print(
                f"[Scheduler] EOD push completed: auto_created={created} sent={summary['sent']} "
                f"failed={summary['failed']} total={summary['total']} run_id={summary['run_id']}"
            )
        except Exception as exc:
            await db.rollback()
            print(f"[Scheduler] EOD push failed: {exc}")


async def _kpi_auto_finalize_job() -> None:
    """08 §3.3: 공개 후 7일 경과 & 무이의 kpi_result 자동확정 + ERP push 적재."""
    print("[Scheduler] KPI auto-finalize started")
    from app.services.kpi_engine import auto_finalize_expired

    async with SessionLocal() as db:
        try:
            count = await auto_finalize_expired(db)
            await db.commit()
            print(f"[Scheduler] KPI auto-finalize completed: {count} results finalized")
        except Exception as exc:
            await db.rollback()
            print(f"[Scheduler] KPI auto-finalize failed: {exc}")


async def _presence_purge_job() -> None:
    """D20-a: presence 좌표 30일 파기 — updated_at 30일 초과 행의 x/y/z를 NULL 처리."""
    print("[Scheduler] presence purge started")
    from sqlalchemy import update as _update

    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    async with SessionLocal() as db:
        try:
            res = await db.execute(
                _update(Presence)
                .where(Presence.updated_at < cutoff, Presence.x.isnot(None))
                .values(x=None, y=None, z=None)
            )
            await db.commit()
            print(f"[Scheduler] presence purge completed: {res.rowcount} rows anonymized")
        except Exception as exc:
            await db.rollback()
            print(f"[Scheduler] presence purge failed: {exc}")

# ──────────────────────────────────────────────────────────────────────────────
# 스케줄러 초기화
# ──────────────────────────────────────────────────────────────────────────────

_scheduler: AsyncIOScheduler | None = None


def start_scheduler() -> None:
    """스케줄러 시작 (FastAPI lifespan에서 호출)."""
    global _scheduler
    if _scheduler is not None:
        return  # 이미 시작됨
    
    _scheduler = AsyncIOScheduler(timezone="Asia/Seoul")
    
    # D17: KPI 매일 18:00, 21:00 KST
    _scheduler.add_job(
        _kpi_batch_job,
        CronTrigger(hour=18, minute=0, timezone="Asia/Seoul"),
        id="kpi_18",
        name="KPI 18:00 batch",
        replace_existing=True,
    )
    _scheduler.add_job(
        _kpi_batch_job,
        CronTrigger(hour=21, minute=0, timezone="Asia/Seoul"),
        id="kpi_21",
        name="KPI 21:00 batch",
        replace_existing=True,
    )
    
    # D18: ERP 매시간 정각 KST
    _scheduler.add_job(
        _erp_sync_batch_job,
        CronTrigger(minute=0, timezone="Asia/Seoul"),
        id="erp_hourly",
        name="ERP hourly sync",
        replace_existing=True,
    )

    # REQ-008/D18: EOD ERP 전송 — 매일 18:05 KST (KPI 18:00 배치 직후)
    _scheduler.add_job(
        _eod_push_job,
        CronTrigger(hour=18, minute=5, timezone="Asia/Seoul"),
        id="eod_push",
        name="EOD ERP push",
        replace_existing=True,
    )

    # D20-a: presence 좌표 30일 파기 — 매일 03:00 KST
    _scheduler.add_job(
        _presence_purge_job,
        CronTrigger(hour=3, minute=0, timezone="Asia/Seoul"),
        id="presence_purge",
        name="Presence 30d coord purge",
        replace_existing=True,
    )

    # 08 §3.3: 무이의 7일 자동확정 — 매일 09:00 KST
    _scheduler.add_job(
        _kpi_auto_finalize_job,
        CronTrigger(hour=9, minute=0, timezone="Asia/Seoul"),
        id="kpi_auto_finalize",
        name="KPI 7d auto-finalize",
        replace_existing=True,
    )

    _scheduler.start()
    print("[Scheduler] Started: KPI 18:00/21:00, ERP hourly:00, EOD push 18:05, presence purge 03:00, KPI auto-finalize 09:00")


def stop_scheduler() -> None:
    """스케줄러 종료 (FastAPI lifespan에서 호출)."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=True)
        _scheduler = None
        print("[Scheduler] Stopped")
