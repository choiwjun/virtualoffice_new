"""
ERP 기반 리소스 API (리소스 지향, 화면 비종속).

- GET  /api/employees          동기화된 직원 디렉터리 (우리 erp_user)
- GET  /api/employees/{id}     직원 단건
- POST /api/erp/sync           ERP→우리 사용자 동기화 트리거 (admin)
- GET  /api/attendances        근태 read-through (ERP 원본, 미저장)

단일 조직(company_id=1) 전제 — 멀티테넌트는 "완성 이후"(Won't, 이번 버전).
"""

from datetime import date, datetime, timezone
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.erp.reader import ErpReader, get_erp_reader
from app.erp.sync import ErpSyncService
from app.models.tables import ErpSyncLog, ErpUser

router = APIRouter(prefix="/api", tags=["erp"])

DEFAULT_COMPANY_ID = 1


async def get_reader() -> AsyncGenerator[ErpReader, None]:
    reader = get_erp_reader()
    try:
        yield reader
    finally:
        await reader.aclose()


# ── 스키마 ────────────────────────────────────────────────
class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    erp_team_id: int
    role: str
    position: Optional[str] = None
    position_id: Optional[int] = None
    manager_id: Optional[int] = None
    work_type: Optional[str] = None
    is_active: bool


class SyncResultOut(BaseModel):
    created: int
    updated: int
    deactivated: int


class AttendanceOut(BaseModel):
    user_id: int
    attendance_date: date
    check_in_at: Optional[datetime] = None
    check_out_at: Optional[datetime] = None
    work_type: str


# ── 직원 디렉터리 (동기화된 데이터) ───────────────────────
@router.get("/employees", response_model=list[EmployeeOut])
async def list_employees(
    db=Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(ErpUser)
            .where(ErpUser.company_id == DEFAULT_COMPANY_ID, ErpUser.is_active.is_(True))
            .order_by(ErpUser.id)
        )
    ).scalars().all()
    return rows


@router.get("/employees/{employee_id}", response_model=EmployeeOut)
async def get_employee(
    employee_id: int,
    db=Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
):
    row = (
        await db.execute(
            select(ErpUser).where(
                ErpUser.id == employee_id,
                ErpUser.company_id == DEFAULT_COMPANY_ID,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="employee_not_found")
    return row


# ── 동기화 트리거 (admin) ─────────────────────────────────
@router.post("/erp/sync", response_model=SyncResultOut)
async def trigger_erp_sync(
    db=Depends(get_db),
    reader: ErpReader = Depends(get_reader),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
):
    started = datetime.now(timezone.utc)
    log = ErpSyncLog(started_at=started, trigger="manual")
    db.add(log)
    try:
        svc = ErpSyncService(db)
        result = await svc.sync_users(reader, DEFAULT_COMPANY_ID)
        log.created = result.created
        log.updated = result.updated
        log.deactivated = result.deactivated
        log.status = "success"
        log.finished_at = datetime.now(timezone.utc)
        await db.commit()
        return SyncResultOut(
            created=result.created, updated=result.updated, deactivated=result.deactivated
        )
    except Exception as exc:  # noqa: BLE001 - 실패도 로그에 기록
        await db.rollback()
        db.add(ErpSyncLog(started_at=started, trigger="manual", status="failed", error=str(exc)[:1000], finished_at=datetime.now(timezone.utc)))
        await db.commit()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="erp_sync_failed")


# ── 동기화 로그 조회 (관리자) — management-api /erp-sync/* ────
class SyncLogOut(BaseModel):
    id: str
    started_at: str
    finished_at: Optional[str] = None
    created: int
    updated: int
    deactivated: int
    status: str
    trigger: str
    error: Optional[str] = None


class SyncStatusOut(BaseModel):
    last_run: Optional[SyncLogOut] = None
    total_runs: int
    failure_count: int


def _log_out(l: ErpSyncLog) -> "SyncLogOut":
    def _iso(dt):
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    return SyncLogOut(
        id=str(l.id), started_at=_iso(l.started_at), finished_at=_iso(l.finished_at),
        created=l.created, updated=l.updated, deactivated=l.deactivated,
        status=l.status, trigger=l.trigger, error=l.error,
    )


@router.get("/erp-sync/status", response_model=SyncStatusOut)
async def erp_sync_status(
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> SyncStatusOut:
    last = (await db.execute(select(ErpSyncLog).order_by(ErpSyncLog.started_at.desc()).limit(1))).scalar_one_or_none()
    total = (await db.execute(select(func.count()).select_from(ErpSyncLog))).scalar_one()
    fails = (await db.execute(select(func.count()).select_from(ErpSyncLog).where(ErpSyncLog.status == "failed"))).scalar_one()
    return SyncStatusOut(last_run=_log_out(last) if last else None, total_runs=total, failure_count=fails)


@router.get("/erp-sync/failures", response_model=list[SyncLogOut])
async def erp_sync_failures(
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> list[SyncLogOut]:
    rows = (await db.execute(select(ErpSyncLog).where(ErpSyncLog.status == "failed").order_by(ErpSyncLog.started_at.desc()).limit(50))).scalars().all()
    return [_log_out(r) for r in rows]


# ── 근태 read-through ─────────────────────────────────────
@router.get("/attendances", response_model=list[AttendanceOut])
async def list_attendances(
    start: date = Query(..., description="조회 시작일"),
    end: date = Query(..., description="조회 종료일"),
    reader: ErpReader = Depends(get_reader),
    _: CurrentUser = Depends(get_current_user),
):
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_date_range")
    dtos = await reader.fetch_attendances(DEFAULT_COMPANY_ID, start, end)
    return [AttendanceOut(**vars(d)) for d in dtos]
# ── EOD Push 조회 (관리자) ──────────────────────────────────────

class DailyStatusPushOut(BaseModel):
    id: str
    user_id: int
    push_date: str
    target: str
    payload: dict
    status: str
    pushed_at: Optional[str] = None
    run_id: Optional[str] = None
    error: Optional[str] = None


@router.get("/daily-status-push", response_model=list[DailyStatusPushOut])
async def list_daily_status_push(
    user_id: Optional[int] = Query(None, description="사용자 ID 필터"),
    status_filter: Optional[str] = Query(None, alias="status", description="상태 필터 (pending/sent/failed)"),
    limit: int = Query(100, le=500, description="최대 결과 수"),
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> list[DailyStatusPushOut]:
    """GET /api/daily-status-push — ERP 전송 큐 조회 (관리자, REQ-008)."""
    from app.models.tables import DailyStatusPush
    
    query = select(DailyStatusPush).order_by(DailyStatusPush.created_at.desc())
    
    if user_id:
        query = query.where(DailyStatusPush.user_id == user_id)
    
    if status_filter:
        from app.models.tables import DailyStatusPushStatus
        try:
            status_enum = DailyStatusPushStatus(status_filter)
            query = query.where(DailyStatusPush.status == status_enum)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_status")
    
    query = query.limit(limit)
    rows = (await db.execute(query)).scalars().all()
    
    def _iso(dt):
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    
    return [
        DailyStatusPushOut(
            id=str(r.id),
            user_id=r.user_id,
            push_date=r.push_date.isoformat(),
            target=r.target.value,
            payload=r.payload,
            status=r.status.value,
            pushed_at=_iso(r.pushed_at),
            run_id=str(r.run_id) if r.run_id else None,
            error=r.error_message,
        )
        for r in rows
    ]
