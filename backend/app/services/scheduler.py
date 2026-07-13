"""
배치 스케줄러 (APScheduler) — KPI 자동계산 + ERP 정기 동기화.

D17 (08 §4.1 정본): EOD daily_reports push = 18:00 KST / KPI(정량+AI 초안) = 21:00 KST 야간 배치
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

    D17: 주말·공휴일 스킵(공휴일 = settings.eod_holidays 운영자 유지 목록 — 외부 캘린더
    API 연동 전 잠정), 배치가 당일 push row 자동 생성(ensure_eod_rows) 후
    pending(+failed<MAX_RETRY)을 전송.
    """
    from app.config import settings
    from app.services.eod_push import ensure_eod_rows, run_eod_push

    kst_now = datetime.now(timezone(timedelta(hours=9)))
    holidays = {s.strip() for s in settings.eod_holidays.split(",") if s.strip()}
    if kst_now.date().isoformat() in holidays:
        print(f"[Scheduler] EOD push skipped: holiday {kst_now.date().isoformat()} (D17)")
        return
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


async def _seat_auto_release_job() -> None:
    """06 §3.11: 자율좌석(free) 자동 반납 — 퇴근(offline) 또는 장기 미활동 사용자의 점유 해제.

    대상: type=free & occupied 좌석 중, 점유자의 presence가 offline이거나
    updated_at이 12시간 초과. seat 반납 + 열린 history의 unassigned_at 기록.
    """
    print("[Scheduler] seat auto-release started")
    from app.models.tables import (
        Presence,
        PresenceStatus,
        Seat,
        SeatAssignmentHistory,
        SeatStatus,
        SeatType,
    )

    now = datetime.now(timezone.utc)
    stale_cutoff = now - timedelta(hours=12)

    async with SessionLocal() as db:
        try:
            seats = (
                await db.execute(
                    select(Seat).where(
                        Seat.type == SeatType.FREE,
                        Seat.status == SeatStatus.OCCUPIED,
                        Seat.assigned_user_id.isnot(None),
                    )
                )
            ).scalars().all()

            released = 0
            for seat in seats:
                presence = (
                    await db.execute(select(Presence).where(Presence.user_id == seat.assigned_user_id))
                ).scalar_one_or_none()
                p_updated = presence.updated_at if presence else None
                if p_updated is not None and p_updated.tzinfo is None:
                    p_updated = p_updated.replace(tzinfo=timezone.utc)
                should_release = (
                    presence is None
                    or presence.status == PresenceStatus.OFFLINE
                    or (p_updated is not None and p_updated < stale_cutoff)
                )
                if not should_release:
                    continue

                seat.assigned_user_id = None
                seat.status = SeatStatus.AVAILABLE
                hist = (
                    await db.execute(
                        select(SeatAssignmentHistory)
                        .where(
                            SeatAssignmentHistory.seat_id == seat.id,
                            SeatAssignmentHistory.unassigned_at.is_(None),
                        )
                        .order_by(SeatAssignmentHistory.assigned_at.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if hist is not None:
                    hist.unassigned_at = now
                released += 1

            await db.commit()
            print(f"[Scheduler] seat auto-release completed: {released} seats released")
        except Exception as exc:
            await db.rollback()
            print(f"[Scheduler] seat auto-release failed: {exc}")


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

async def _audit_retention_purge_job() -> None:
    """D20-e: audit_log 5년 보존 후 파기 (08 §7.3) — services/audit.purge_expired_audit_logs 위임."""
    print("[Scheduler] audit retention purge started")
    from app.services.audit import purge_expired_audit_logs

    async with SessionLocal() as db:
        try:
            deleted = await purge_expired_audit_logs(db)
            await db.commit()
            print(f"[Scheduler] audit retention purge completed: {deleted} rows deleted")
        except Exception as exc:
            await db.rollback()
            print(f"[Scheduler] audit retention purge failed: {exc}")

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
    
    # D17·08 §4.1 정본: KPI(정량 계산 + AI 서술 초안) = 매일 21:00 KST 야간 배치 단일.
    # 종전 18:00 KPI 잡은 정본에 없는 드리프트라 제거 — 18:00은 EOD daily_reports push 전용.
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

    # REQ-008/D17: EOD ERP 전송 — 매일 18:00 KST (D17 정본. 18:00 이후 활동은 익일 귀속)
    _scheduler.add_job(
        _eod_push_job,
        CronTrigger(hour=18, minute=0, timezone="Asia/Seoul"),
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


    # D20-e: audit_log 5년 보존 파기 — 매일 03:30 KST (presence purge 직후)
    _scheduler.add_job(
        _audit_retention_purge_job,
        CronTrigger(hour=3, minute=30, timezone="Asia/Seoul"),
        id="audit_retention_purge",
        name="Audit log 5y retention purge",
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

    # 06 §3.11: 자율좌석 자동 반납 — 매시간 :30 KST (퇴근/장기 미활동)
    _scheduler.add_job(
        _seat_auto_release_job,
        CronTrigger(minute=30, timezone="Asia/Seoul"),
        id="seat_auto_release",
        name="Free-seat auto release",
        replace_existing=True,
    )

    _scheduler.start()
    print("[Scheduler] Started: KPI 21:00, ERP hourly:00, EOD push 18:00, presence purge 03:00, audit purge 03:30, KPI auto-finalize 09:00, seat release :30")


def stop_scheduler() -> None:
    """스케줄러 종료 (FastAPI lifespan에서 호출)."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=True)
        _scheduler = None
        print("[Scheduler] Stopped")
