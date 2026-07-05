"""
ERP 동기화 모니터링 API (root, prefix 없음 — meetings.py/layouts.py/seats.py와 동일 계약 규약).

- POST /sync/erp           ERP 수동 동기화 트리거 (admin, 동기 실행 후 즉시 결과 기록)
- GET  /sync/status        동기화 작업 상태 조회 (admin, job_id)
- GET  /sync/errors        동기화 실패 이력 조회 (admin, limit)

@SPEC 00-decisions.md D18(증분+전체 대사), D20(컴플라이언스)
@SPEC docs/planning/04-data-model.md §2.6

경로 규약(의도적, 계약 테스트 기준): 동기화 엔드포인트는 root(/sync/*, prefix 없음).
meetings.py/layouts.py/seats.py와 동일 이탈 근거 — 외부 공개 시 Caddy가 /api/* → /* 로
라우팅한다(D21-r). erp.py의 /api/erp/sync(레거시, 동기화 트리거 중복)와는 별개 엔드포인트로,
본 라우터가 G009 계약(POST /sync/erp, GET /sync/status, GET /sync/errors)의 정본이다.

동기 실행 노트: 실제 비동기 작업 큐/스케줄러(APScheduler)는 G010에서 구현된다. 여기서는
POST 요청 처리 중 ErpSyncService.sync_users를 동기 실행하고 그 결과를 ErpSyncLog에 즉시
기록한다 — 응답의 sync_job_id로 상태/오류를 조회할 수 있다(D18: 증분+전체 대사는 G010 배치
스케줄러 구현 시 별도 적용, TestSyncAPI.test_sync_incremental_plus_daily_full은 skip 유지).
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, require_role
from app.db import get_db
from app.erp.reader import ErpReader
from app.erp.sync import ErpSyncService
from app.api.erp import DEFAULT_COMPANY_ID, get_reader
from app.models.tables import ErpSyncLog, ErpSyncStatus
from app.services.notification_service import record_notification

router = APIRouter(tags=["sync"])


# ── 스키마 ────────────────────────────────────────────────
class SyncTriggerOut(BaseModel):
    sync_job_id: str
    run_id: str
    status: str


# ── 헬퍼 ──────────────────────────────────────────────────
def _parse_job_id(job_id: str) -> UUID:
    """수동 UUID 파싱: 타입검증 422 대신 404로 통일(work_log_id/layout_id 계약과 동일 패턴)."""
    try:
        return UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sync_job_not_found")


def _status_out(log: ErpSyncLog) -> dict:
    return {
        "status": log.status.value,
        "synced_at": log.finished_at.isoformat() if log.finished_at else None,
        "next_scheduled": log.next_scheduled_at.isoformat() if log.next_scheduled_at else None,
        "error_count": log.error_count,
        "created_count": log.created_count,
        "updated_count": log.updated_count,
        "deactivated_count": log.deactivated_count,
    }


# ── 동기화 트리거 ──────────────────────────────────────────
@router.post("/sync/erp", status_code=status.HTTP_202_ACCEPTED, response_model=SyncTriggerOut)
async def trigger_erp_sync(
    db: AsyncSession = Depends(get_db),
    reader: ErpReader = Depends(get_reader),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    log = ErpSyncLog(status=ErpSyncStatus.RUNNING)
    db.add(log)
    await db.flush()

    try:
        svc = ErpSyncService(db)
        result = await svc.sync_users(reader, DEFAULT_COMPANY_ID)
        # G005: 동일 트리거에서 teams/positions 미러도 채운다(런타임 populate 경로 보장).
        # 로그 카운트는 users 기준 유지(기존 계약 호환) — 팀/직급은 부수효과로 동기화.
        await svc.sync_teams(reader, DEFAULT_COMPANY_ID)
        await svc.sync_positions(reader, DEFAULT_COMPANY_ID)
    except Exception as exc:  # noqa: BLE001 — 동기화 실패는 감시 대상, 응답 자체는 202 유지
        # 정정(G009 architect COMMENT LOW): flush 단계 예외(예: DB 제약 위반)는 세션을
        # PendingRollbackError 상태로 만들어 동일 세션에서 log 갱신·commit이 실패할 수
        # 있다. 롤백 후 새 트랜잭션에서 FAILED 레코드를 별도로 기록해 유실을 방지한다.
        job_id = log.id
        run_id = log.run_id
        started_at = log.started_at
        await db.rollback()
        failure_log = ErpSyncLog(
            id=job_id,
            run_id=run_id,
            status=ErpSyncStatus.FAILED,
            started_at=started_at,
            error_count=1,
            error_message=str(exc),
            finished_at=datetime.now(timezone.utc),
        )
        db.add(failure_log)
        # P7-R3-T3: 동기화 실패 시 관리자 콘솔 알림 적재(+웹훅 설정 시 병행 전송). 실패 로그와
        # 동일 트랜잭션으로 커밋된다(원자성).
        await record_notification(
            db,
            category="sync_failure",
            severity="error",
            title="ERP 동기화 실패",
            message=str(exc),
            context={"sync_job_id": str(failure_log.id), "run_id": str(failure_log.run_id)},
        )
        await db.commit()
        return {
            "sync_job_id": str(failure_log.id),
            "run_id": str(failure_log.run_id),
            "status": failure_log.status.value,
        }

    log.status = ErpSyncStatus.SUCCESS
    log.created_count = result.created
    log.updated_count = result.updated
    log.deactivated_count = result.deactivated
    log.finished_at = datetime.now(timezone.utc)
    await db.commit()
    return {"sync_job_id": str(log.id), "run_id": str(log.run_id), "status": log.status.value}


# ── 상태 조회 ─────────────────────────────────────────────
@router.get("/sync/status")
async def get_sync_status(
    job_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    parsed = _parse_job_id(job_id)
    log = (
        await db.execute(select(ErpSyncLog).where(ErpSyncLog.id == parsed))
    ).scalar_one_or_none()
    if log is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sync_job_not_found")
    return _status_out(log)


# ── 실패 이력 조회 ─────────────────────────────────────────
@router.get("/sync/errors")
async def get_sync_errors(
    limit: int = Query(default=10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    rows = (
        await db.execute(
            select(ErpSyncLog)
            .where(ErpSyncLog.status == ErpSyncStatus.FAILED)
            .order_by(ErpSyncLog.started_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return {
        "errors": [
            {
                "sync_job_id": str(row.id),
                "error_message": row.error_message,
                "error_count": row.error_count,
                "attempted_at": row.started_at.isoformat(),
            }
            for row in rows
        ]
    }
