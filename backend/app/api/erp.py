"""
ERP 기반 리소스 API (리소스 지향, 화면 비종속).

- GET  /api/employees          동기화된 직원 디렉터리 (우리 erp_user)
- GET  /api/employees/{id}     직원 단건
- POST /api/erp/sync           ERP→우리 사용자 동기화 트리거 (admin)
- GET  /api/attendances        근태 read-through (ERP 원본, 미저장)

단일 조직(company_id=1) 전제 — 멀티테넌트는 "완성 이후"(Won't, 이번 버전).
"""

from datetime import date, datetime, timezone
from uuid import UUID
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.erp.reader import ErpReader, get_erp_reader
from app.erp.sync import ErpSyncService
from app.models.tables import ErpSyncLog, ErpSyncStatus, ErpUser, OrgGroup

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


class TeamOut(BaseModel):
    id: int
    name: str
    color: str
    leader_name: Optional[str] = None


class OrgGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    type: str
    parent_id: Optional[UUID] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


# ── 직원 디렉터리 (동기화된 데이터) ───────────────────────
@router.get("/employees")
async def list_employees(
    db=Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    # RBAC(management-api.yaml /users): admin=전체, leader=소속 팀, 그 외(employee/미지 role)=본인(fail-safe).
    stmt = select(ErpUser).where(
        ErpUser.company_id == DEFAULT_COMPANY_ID, ErpUser.is_active.is_(True)
    )
    if user.role in ("admin", "super_admin"):
        pass  # 전체
    elif user.role == "leader":
        stmt = stmt.where(ErpUser.erp_team_id == user.team_id)
    else:
        stmt = stmt.where(ErpUser.id == user.user_id)
    rows = (await db.execute(stmt.order_by(ErpUser.id))).scalars().all()
    items = [EmployeeOut.model_validate(r).model_dump() for r in rows]
    return {"items": items, "total": len(items)}


@router.get("/employees/{employee_id}", response_model=EmployeeOut)
async def get_employee(
    employee_id: int,
    db=Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    row = (
        await db.execute(
            select(ErpUser).where(
                ErpUser.id == employee_id,
                ErpUser.company_id == DEFAULT_COMPANY_ID,
            )
        )
    ).scalar_one_or_none()
    not_found = HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="employee_not_found"
    )
    if row is None:
        raise not_found
    # RBAC(목록과 동일): admin=전체, leader=소속 팀, 그 외=본인. 위반은 404(존재 미노출).
    if user.role in ("admin", "super_admin"):
        pass
    elif user.role == "leader":
        if row.erp_team_id != user.team_id:
            raise not_found
    elif row.id != user.user_id:
        raise not_found
    return row


@router.get("/teams")
async def list_teams(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    reader: ErpReader = Depends(get_reader),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    # ERP teams read-through(미러 테이블 없음, /attendances 패턴). 라이브 DB 없으면 mock.
    teams = await reader.fetch_teams(DEFAULT_COMPANY_ID)
    page = teams[offset : offset + limit]
    return {
        "items": [
            TeamOut(
                id=t.id, name=t.name, color=t.color, leader_name=t.leader_name
            ).model_dump()
            for t in page
        ],
        "total": len(teams),
    }


@router.get("/org-groups")
async def list_org_groups(
    db=Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    rows = (
        await db.execute(
            select(OrgGroup).order_by(OrgGroup.sort_order, OrgGroup.name)
        )
    ).scalars().all()
    items = [OrgGroupOut.model_validate(r).model_dump(mode="json") for r in rows]
    return {"items": items, "total": len(items)}

# ── 동기화 트리거 (admin, DEPRECATED — 정본: POST /sync/erp) ─────────────
@router.post("/erp/sync", response_model=SyncResultOut, deprecated=True)
async def trigger_erp_sync(
    response: Response,
    db=Depends(get_db),
    reader: ErpReader = Depends(get_reader),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
):
    """[DEPRECATED] 레거시 ERP 동기화 트리거 (B-15).

    정본은 `POST /sync/erp`(sync.py) — ErpSyncLog 기록 + sync_job_id 반환으로 /sync/status·/sync/errors
    모니터링이 가능하다. 이 레거시 엔드포인트는 하위호환(SyncResultOut 응답)을 유지하되, 여기서도
    ErpSyncLog를 기록해 **모니터링 사각(이중 트리거 중 한쪽만 미기록)**을 제거한다. 신규 통합/자동화는
    `/sync/erp`를 사용한다. RFC 8594 Deprecation 헤더 + 후속 버전 Link를 응답에 부여한다.
    """
    response.headers["Deprecation"] = "true"
    response.headers["Link"] = '</sync/erp>; rel="successor-version"'

    log = ErpSyncLog(status=ErpSyncStatus.RUNNING)
    db.add(log)
    await db.flush()
    try:
        result = await ErpSyncService(db).sync_users(reader, DEFAULT_COMPANY_ID)
    except Exception as exc:  # noqa: BLE001 — 실패도 감시 대상: FAILED 로그로 모니터링 사각 제거(정본 sync.py 패턴)
        job_id, run_id_, started = log.id, log.run_id, log.started_at
        await db.rollback()
        db.add(
            ErpSyncLog(
                id=job_id,
                run_id=run_id_,
                status=ErpSyncStatus.FAILED,
                started_at=started,
                error_count=1,
                error_message=str(exc),
                finished_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="erp_sync_failed"
        )
    log.status = ErpSyncStatus.SUCCESS
    log.created_count = result.created
    log.updated_count = result.updated
    log.deactivated_count = result.deactivated
    log.finished_at = datetime.now(timezone.utc)
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
