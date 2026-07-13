"""
업무 보고서 API (06-screens 좌내비 '보고서').

POST   /api/reports           — 작성 (draft 또는 즉시 제출)
GET    /api/reports           — 목록 (본인 또는 관리자, 필터 지원)
GET    /api/reports/{id}      — 단건
PATCH  /api/reports/{id}      — 수정 (draft만) / 제출 전이
DELETE /api/reports/{id}      — 삭제 (draft만, 본인)

정책:
- draft에서만 수정·삭제. submitted 전환 시 submitted_at 기록 후 불변 (평가 근거 보존, D18 준용).
- 권한: 본인 CRUD, 관리자(leader/admin/super_admin) 타인 조회.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import Report, ReportStatus, ReportType

router = APIRouter(prefix="/api", tags=["reports"])

ADMIN_ROLES = {"admin", "super_admin", "leader"}


# ---------------------------------------------------------------------------
# Pydantic 스키마
# ---------------------------------------------------------------------------

class ReportCreate(BaseModel):
    report_type: ReportType
    report_date: date
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1)
    status: ReportStatus = ReportStatus.DRAFT


class ReportUpdate(BaseModel):
    report_type: Optional[ReportType] = None
    report_date: Optional[date] = None
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    content: Optional[str] = Field(None, min_length=1)
    status: Optional[ReportStatus] = None


class ReportOut(BaseModel):
    id: str
    user_id: int
    report_type: str
    report_date: date
    title: str
    content: str
    status: str
    submitted_at: Optional[str]
    created_at: str
    updated_at: str

    @classmethod
    def from_orm_report(cls, r: Report) -> "ReportOut":
        return cls(
            id=str(r.id),
            user_id=r.user_id,
            report_type=r.report_type.value,
            report_date=r.report_date,
            title=r.title,
            content=r.content,
            status=r.status.value,
            submitted_at=r.submitted_at.isoformat() if r.submitted_at else None,
            created_at=r.created_at.isoformat(),
            updated_at=r.updated_at.isoformat(),
        )


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

async def _get_or_404(db: AsyncSession, report_id: str) -> Report:
    try:
        uid = UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid report_id")
    result = await db.execute(select(Report).where(Report.id == uid))
    rp = result.scalar_one_or_none()
    if rp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="report_not_found")
    return rp


def _check_read_permission(current_user: CurrentUser, rp: Report) -> None:
    if rp.user_id != current_user.user_id and current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_permissions")


# ---------------------------------------------------------------------------
# 엔드포인트
# ---------------------------------------------------------------------------

@router.post(
    "/reports",
    response_model=ReportOut,
    status_code=status.HTTP_201_CREATED,
    summary="보고서 작성",
)
async def create_report(
    body: ReportCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReportOut:
    """POST /api/reports — 본인 명의 보고서 작성. status=submitted면 즉시 제출."""
    now = datetime.now(timezone.utc)
    rp = Report(
        user_id=current_user.user_id,
        report_type=body.report_type,
        report_date=body.report_date,
        title=body.title,
        content=body.content,
        status=body.status,
        submitted_at=now if body.status == ReportStatus.SUBMITTED else None,
    )
    db.add(rp)
    await db.flush()
    await db.commit()
    await db.refresh(rp)
    return ReportOut.from_orm_report(rp)


@router.get(
    "/reports",
    response_model=list[ReportOut],
    summary="보고서 목록",
)
async def list_reports(
    report_type: Optional[str] = Query(None, description="daily | weekly | monthly"),
    status_filter: Optional[str] = Query(None, alias="status", description="draft | submitted"),
    start_date: Optional[date] = Query(None, description="report_date 시작"),
    end_date: Optional[date] = Query(None, description="report_date 끝"),
    user_id: Optional[int] = Query(None, description="관리자만 타인 조회 가능"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ReportOut]:
    """GET /api/reports — 비관리자는 본인 것만, 관리자는 전체(user_id 필터 가능)."""
    if current_user.role not in ADMIN_ROLES:
        if user_id is not None and user_id != current_user.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_permissions")
        target_uid: Optional[int] = current_user.user_id
    else:
        target_uid = user_id

    q = select(Report)
    if target_uid is not None:
        q = q.where(Report.user_id == target_uid)
    if report_type:
        try:
            rt = ReportType(report_type)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid report_type: must be daily|weekly|monthly",
            )
        q = q.where(Report.report_type == rt)
    if status_filter:
        try:
            s = ReportStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid status: must be draft|submitted",
            )
        q = q.where(Report.status == s)
    if start_date:
        q = q.where(Report.report_date >= start_date)
    if end_date:
        q = q.where(Report.report_date <= end_date)

    q = q.order_by(Report.report_date.desc(), Report.created_at.desc())
    result = await db.execute(q)
    return [ReportOut.from_orm_report(r) for r in result.scalars().all()]


@router.get(
    "/reports/{report_id}",
    response_model=ReportOut,
    summary="보고서 단건 조회",
)
async def get_report(
    report_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReportOut:
    rp = await _get_or_404(db, report_id)
    _check_read_permission(current_user, rp)
    return ReportOut.from_orm_report(rp)


@router.patch(
    "/reports/{report_id}",
    response_model=ReportOut,
    summary="보고서 수정/제출",
)
async def update_report(
    report_id: str,
    body: ReportUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReportOut:
    """PATCH /api/reports/{id} — draft만 수정 가능. status=submitted 전이 시 제출 처리.

    submitted 보고서 수정/역전이 시도는 409.
    """
    rp = await _get_or_404(db, report_id)
    if rp.user_id != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="only_owner_can_edit")

    update_data = body.model_dump(exclude_unset=True)
    new_status: Optional[ReportStatus] = update_data.pop("status", None)

    if rp.status == ReportStatus.SUBMITTED:
        # 제출본 불변 — 어떤 수정/역전이도 불가
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="report_already_submitted")

    for field, val in update_data.items():
        setattr(rp, field, val)

    if new_status == ReportStatus.SUBMITTED:
        rp.status = ReportStatus.SUBMITTED
        rp.submitted_at = datetime.now(timezone.utc)

    await db.flush()
    await db.commit()
    await db.refresh(rp)
    return ReportOut.from_orm_report(rp)


@router.delete(
    "/reports/{report_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="보고서 삭제",
)
async def delete_report(
    report_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """DELETE /api/reports/{id} — 본인의 draft만 삭제 가능. 제출본은 보존 (409)."""
    rp = await _get_or_404(db, report_id)
    if rp.user_id != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="only_owner_can_delete")
    if rp.status == ReportStatus.SUBMITTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="cannot_delete_submitted_report")
    await db.delete(rp)
    await db.commit()
