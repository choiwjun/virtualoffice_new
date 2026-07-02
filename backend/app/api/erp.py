"""
ERP 기반 리소스 API (리소스 지향, 화면 비종속).

- GET  /api/employees          동기화된 직원 디렉터리 (우리 erp_user)
- GET  /api/employees/{id}     직원 단건
- POST /api/erp/sync           ERP→우리 사용자 동기화 트리거 (admin)
- GET  /api/attendances        근태 read-through (ERP 원본, 미저장)

단일 조직(company_id=1) 전제 — 멀티테넌트는 "완성 이후"(Won't, 이번 버전).
"""

from datetime import date, datetime
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.erp.reader import ErpReader, get_erp_reader
from app.erp.sync import ErpSyncService
from app.models.tables import ErpUser

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
    svc = ErpSyncService(db)
    result = await svc.sync_users(reader, DEFAULT_COMPANY_ID)
    await db.commit()
    return SyncResultOut(
        created=result.created, updated=result.updated, deactivated=result.deactivated
    )


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
