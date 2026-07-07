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
    from sqlalchemy.ext.asyncio import AsyncSession

DEFAULT_COMPANY_ID = 1

# ──────────────────────────────────────────────────────────────────────────────
# 배치 작업 함수
# ──────────────────────────────────────────────────────────────────────────────


async def _kpi_batch_job() -> None:
    """KPI 자동계산: 전체 active 직원 대상 daily/weekly/monthly."""
    print("[Scheduler] KPI batch started")
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
                # daily/weekly/monthly 각각 계산 (D17)
                for period_type in ["daily", "weekly", "monthly"]:
                    await compute_and_upsert_kpi(
                        db=db,
                        user_id=user.id,
                        period_type=period_type,
                        period_key=None,  # None = 가장 최근 기간
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

    # D20-a: presence 좌표 30일 파기 — 매일 03:00 KST
    _scheduler.add_job(
        _presence_purge_job,
        CronTrigger(hour=3, minute=0, timezone="Asia/Seoul"),
        id="presence_purge",
        name="Presence 30d coord purge",
        replace_existing=True,
    )
    
    _scheduler.start()
    print("[Scheduler] Started: KPI 18:00/21:00, ERP hourly:00, presence purge 03:00")


def stop_scheduler() -> None:
    """스케줄러 종료 (FastAPI lifespan에서 호출)."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=True)
        _scheduler = None
        print("[Scheduler] Stopped")
