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
    presence_status: Optional[str] = None
    seat_number: Optional[str] = None


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
    from app.models.tables import Presence, Seat

    ids = [r.id for r in rows]
    presence_map: dict[int, str] = {}
    seat_map: dict[int, Optional[str]] = {}
    if ids:
        for p in (await db.execute(select(Presence).where(Presence.user_id.in_(ids)))).scalars().all():
            presence_map[p.user_id] = p.status.value if hasattr(p.status, "value") else str(p.status)
        for s in (await db.execute(select(Seat).where(Seat.assigned_user_id.in_(ids)))).scalars().all():
            if s.assigned_user_id is not None:
                seat_map[s.assigned_user_id] = s.seat_number

    def _s(v):
        return v.value if hasattr(v, "value") else v

    return [
        EmployeeOut(
            id=r.id, email=r.email, name=r.name, erp_team_id=r.erp_team_id,
            role=_s(r.role), position=r.position, position_id=r.position_id,
            manager_id=r.manager_id, work_type=_s(r.work_type), is_active=r.is_active,
            presence_status=presence_map.get(r.id),
            seat_number=seat_map.get(r.id),
        )
        for r in rows
    ]


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


def _log_out(entry: ErpSyncLog) -> "SyncLogOut":
    def _iso(dt):
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    return SyncLogOut(
        id=str(entry.id), started_at=_iso(entry.started_at), finished_at=_iso(entry.finished_at),
        created=entry.created, updated=entry.updated, deactivated=entry.deactivated,
        status=entry.status, trigger=entry.trigger, error=entry.error,
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
    user: CurrentUser = Depends(get_current_user),
):
    """GET /api/attendances — 근태 조회.

    06 §3.12: 전 직원 근태는 관리자 전용. 일반 직원은 본인 것만 필터해 반환.
    """
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_date_range")
    dtos = await reader.fetch_attendances(DEFAULT_COMPANY_ID, start, end)
    # 06 §3.10 매트릭스: 전체 근태는 admin/super_admin만 (leader ✗) — 그 외 본인 것만
    if user.role not in ("admin", "super_admin"):
        dtos = [d for d in dtos if d.user_id == user.user_id]
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
    user: CurrentUser = Depends(get_current_user),
) -> list[DailyStatusPushOut]:
    """GET /api/daily-status-push — ERP 전송 큐 조회.

    관리자(admin/super_admin)=전체, 일반 직원=본인 것만 (06 §3.6 'ERP 동기화 확인').
    """
    from app.models.tables import DailyStatusPush

    if user.role not in ("admin", "super_admin"):
        if user_id is not None and user_id != user.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_permissions")
        user_id = user.user_id

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

# ── EOD Push 생성 (일일 상태 리포트, 본인) ──────────────────────────────

class DailyStatusPushCreate(BaseModel):
    today_plan: str = ""
    in_progress: str = ""
    blockers: str = ""
    tomorrow_plan: str = ""
    push_date: Optional[str] = None
    target: Optional[str] = None
    payload: Optional[dict] = None
    user_id: Optional[int] = None


@router.post("/daily-status-push", response_model=DailyStatusPushOut, status_code=status.HTTP_201_CREATED)
async def create_daily_status_push(
    body: DailyStatusPushCreate,
    db=Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> DailyStatusPushOut:
    """POST /api/daily-status-push — 일일 상태 리포트 큐잉 (본인, REQ-008/D18)."""
    import uuid as _uuid
    from datetime import date as _date
    from app.models.tables import (
        DailyStatusPush,
        DailyStatusPushStatus,
        DailyStatusPushTarget,
    )

    # 타인 명의 큐잉 차단 — user_id 지정은 관리자만 (QA 2026-07-13 P0)
    if body.user_id is not None and body.user_id != user.user_id:
        if user.role not in ("admin", "super_admin"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_permissions")

    pd = _date.fromisoformat(body.push_date) if body.push_date else _date.today()
    try:
        target = DailyStatusPushTarget(body.target) if body.target else DailyStatusPushTarget.ERP_DAILY_REPORTS
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_target")
    payload = body.payload if body.payload is not None else {
        "today_plan": body.today_plan,
        "in_progress": body.in_progress,
        "blockers": body.blockers,
        "tomorrow_plan": body.tomorrow_plan,
    }
    row = DailyStatusPush(
        id=_uuid.uuid4(),
        user_id=body.user_id or user.user_id,
        push_date=pd,
        target=target,
        payload=payload,
        status=DailyStatusPushStatus.PENDING,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return DailyStatusPushOut(
        id=str(row.id),
        user_id=row.user_id,
        push_date=row.push_date.isoformat(),
        target=row.target.value,
        payload=row.payload,
        status=row.status.value,
        pushed_at=None,
        run_id=None,
        error=None,
    )


# ── EOD Push 재시도 (실패 → pending, 관리자) ────────────────────────────

@router.post("/daily-status-push/{push_id}/retry", response_model=DailyStatusPushOut)
async def retry_daily_status_push(
    push_id: str,
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> DailyStatusPushOut:
    """POST /api/daily-status-push/{id}/retry — 실패한 전송을 pending으로 재큐잉 (관리자, REQ-008).

    D17-7: 재시도 상한 MAX_RETRY(3) 초과 시 409.
    """
    import uuid as _uuid
    from app.models.tables import DailyStatusPush, DailyStatusPushStatus
    from app.services.eod_push import MAX_RETRY

    try:
        pid = _uuid.UUID(push_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_id")
    row = (await db.execute(select(DailyStatusPush).where(DailyStatusPush.id == pid))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="push_not_found")
    if row.status != DailyStatusPushStatus.FAILED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="only_failed_can_retry")
    if (row.retry_count or 0) >= MAX_RETRY:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="retry_limit_exceeded")
    row.status = DailyStatusPushStatus.PENDING
    row.retry_count = (row.retry_count or 0) + 1
    row.error_message = None
    await db.commit()
    await db.refresh(row)
    return DailyStatusPushOut(
        id=str(row.id), user_id=row.user_id, push_date=row.push_date.isoformat(),
        target=row.target.value, payload=row.payload, status=row.status.value,
        pushed_at=None, run_id=str(row.run_id) if row.run_id else None, error=row.error_message,
    )


# ── EOD Push 수동 트리거 (배치 즉시 실행, 관리자) ────────────────────────────

class EodPushRunOut(BaseModel):
    run_id: str
    sent: int
    failed: int
    total: int


@router.post("/daily-status-push/run", response_model=EodPushRunOut)
async def run_daily_status_push(
    push_date: Optional[date] = Query(None, description="대상 날짜(KST). 미지정 시 전체 pending"),
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> EodPushRunOut:
    """POST /api/daily-status-push/run — pending 큐를 ERP로 즉시 전송 (관리자, REQ-008/D18).

    스케줄러 EOD 배치(18:05 KST)와 동일 로직. pending→sent 전이, 멱등(sent 재전송 안 함).
    """
    from app.services.eod_push import run_eod_push

    summary = await run_eod_push(db, push_date=push_date)
    await db.commit()
    return EodPushRunOut(**{k: summary[k] for k in ("run_id", "sent", "failed", "total")})
