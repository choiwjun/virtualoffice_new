"""
출장 신청·승인 API (06-screens 좌내비 '출장관리').

POST   /api/trips             — 출장 신청 (본인)
GET    /api/trips             — 목록 (본인 또는 관리자, 필터 지원)
GET    /api/trips/{id}        — 단건
PATCH  /api/trips/{id}        — 수정/상태 전이
DELETE /api/trips/{id}        — 삭제 (requested만, 본인)

상태 전이:
- requested → approved/rejected : leader/admin/super_admin (approver_id·decided_at 기록)
- requested/approved → cancelled : 본인
- approved → completed : 본인 (결과 보고 report 필수)
- 그 외 전이 → 409

권한: 본인 CRUD, 관리자(leader/admin/super_admin) 전체 조회·승인/반려.
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
from app.models.tables import BusinessTrip, TripStatus

router = APIRouter(prefix="/api", tags=["trips"])

ADMIN_ROLES = {"admin", "super_admin", "leader"}


# ---------------------------------------------------------------------------
# Pydantic 스키마
# ---------------------------------------------------------------------------

class TripCreate(BaseModel):
    destination: str = Field(min_length=1, max_length=255)
    purpose: str = Field(min_length=1, max_length=500)
    start_date: date
    end_date: date
    note: Optional[str] = None


class TripUpdate(BaseModel):
    destination: Optional[str] = Field(None, min_length=1, max_length=255)
    purpose: Optional[str] = Field(None, min_length=1, max_length=500)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    note: Optional[str] = None
    status: Optional[TripStatus] = None
    report: Optional[str] = None
    reject_reason: Optional[str] = Field(None, max_length=500)


class TripOut(BaseModel):
    id: str
    user_id: int
    destination: str
    purpose: str
    start_date: date
    end_date: date
    status: str
    note: Optional[str]
    report: Optional[str]
    approver_id: Optional[int]
    decided_at: Optional[str]
    reject_reason: Optional[str]
    created_at: str
    updated_at: str

    @classmethod
    def from_orm_trip(cls, t: BusinessTrip) -> "TripOut":
        return cls(
            id=str(t.id),
            user_id=t.user_id,
            destination=t.destination,
            purpose=t.purpose,
            start_date=t.start_date,
            end_date=t.end_date,
            status=t.status.value,
            note=t.note,
            report=t.report,
            approver_id=t.approver_id,
            decided_at=t.decided_at.isoformat() if t.decided_at else None,
            reject_reason=t.reject_reason,
            created_at=t.created_at.isoformat(),
            updated_at=t.updated_at.isoformat(),
        )


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

async def _get_or_404(db: AsyncSession, trip_id: str) -> BusinessTrip:
    try:
        uid = UUID(trip_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid trip_id")
    result = await db.execute(select(BusinessTrip).where(BusinessTrip.id == uid))
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="trip_not_found")
    return trip


def _check_read_permission(current_user: CurrentUser, trip: BusinessTrip) -> None:
    if trip.user_id != current_user.user_id and current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_permissions")


def _validate_dates(start: date, end: date) -> None:
    if end < start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_date_before_start_date",
        )


# ---------------------------------------------------------------------------
# 엔드포인트
# ---------------------------------------------------------------------------

@router.post(
    "/trips",
    response_model=TripOut,
    status_code=status.HTTP_201_CREATED,
    summary="출장 신청",
)
async def create_trip(
    body: TripCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TripOut:
    """POST /api/trips — 본인 명의 출장 신청 (status=requested)."""
    _validate_dates(body.start_date, body.end_date)
    trip = BusinessTrip(
        user_id=current_user.user_id,
        destination=body.destination,
        purpose=body.purpose,
        start_date=body.start_date,
        end_date=body.end_date,
        note=body.note,
        status=TripStatus.REQUESTED,
    )
    db.add(trip)
    await db.flush()
    await db.commit()
    await db.refresh(trip)
    return TripOut.from_orm_trip(trip)


@router.get(
    "/trips",
    response_model=list[TripOut],
    summary="출장 목록",
)
async def list_trips(
    status_filter: Optional[str] = Query(None, alias="status"),
    start_date: Optional[date] = Query(None, description="이 날짜 이후 시작"),
    end_date: Optional[date] = Query(None, description="이 날짜 이전 시작"),
    user_id: Optional[int] = Query(None, description="관리자만 타인 조회 가능"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TripOut]:
    """GET /api/trips — 비관리자는 본인 것만, 관리자는 전체(user_id 필터 가능)."""
    if current_user.role not in ADMIN_ROLES:
        if user_id is not None and user_id != current_user.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_permissions")
        target_uid: Optional[int] = current_user.user_id
    else:
        target_uid = user_id

    q = select(BusinessTrip)
    if target_uid is not None:
        q = q.where(BusinessTrip.user_id == target_uid)
    if status_filter:
        try:
            s = TripStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid status: must be requested|approved|rejected|cancelled|completed",
            )
        q = q.where(BusinessTrip.status == s)
    if start_date:
        q = q.where(BusinessTrip.start_date >= start_date)
    if end_date:
        q = q.where(BusinessTrip.start_date <= end_date)

    q = q.order_by(BusinessTrip.start_date.desc(), BusinessTrip.created_at.desc())
    result = await db.execute(q)
    return [TripOut.from_orm_trip(t) for t in result.scalars().all()]


@router.get(
    "/trips/{trip_id}",
    response_model=TripOut,
    summary="출장 단건 조회",
)
async def get_trip(
    trip_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TripOut:
    trip = await _get_or_404(db, trip_id)
    _check_read_permission(current_user, trip)
    return TripOut.from_orm_trip(trip)


@router.patch(
    "/trips/{trip_id}",
    response_model=TripOut,
    summary="출장 수정/상태 전이",
)
async def update_trip(
    trip_id: str,
    body: TripUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TripOut:
    """PATCH /api/trips/{id} — 필드 수정(본인, requested만) + 상태 전이.

    전이 규칙은 모듈 docstring 참조. 허용되지 않은 전이는 409.
    """
    trip = await _get_or_404(db, trip_id)
    is_owner = trip.user_id == current_user.user_id
    is_admin = current_user.role in ADMIN_ROLES
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_permissions")

    update_data = body.model_dump(exclude_unset=True)
    new_status: Optional[TripStatus] = update_data.pop("status", None)
    reject_reason = update_data.pop("reject_reason", None)
    report = update_data.pop("report", None)

    # 일반 필드 수정 — 본인, requested 상태에서만
    if update_data:
        if not is_owner:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="only_owner_can_edit")
        if trip.status != TripStatus.REQUESTED:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="trip_not_editable")
        for field, val in update_data.items():
            setattr(trip, field, val)
        _validate_dates(trip.start_date, trip.end_date)

    # 상태 전이
    if new_status is not None and new_status != trip.status:
        if new_status in (TripStatus.APPROVED, TripStatus.REJECTED):
            # 승인/반려 — 관리자 전용, requested에서만
            if not is_admin:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_permissions")
            if trip.status != TripStatus.REQUESTED:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="invalid_status_transition")
            trip.status = new_status
            trip.approver_id = current_user.user_id
            trip.decided_at = datetime.now(timezone.utc)
            if new_status == TripStatus.REJECTED:
                trip.reject_reason = reject_reason
        elif new_status == TripStatus.CANCELLED:
            # 취소 — 본인, requested/approved에서만
            if not is_owner:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="only_owner_can_cancel")
            if trip.status not in (TripStatus.REQUESTED, TripStatus.APPROVED):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="invalid_status_transition")
            trip.status = new_status
        elif new_status == TripStatus.COMPLETED:
            # 완료 — 본인, approved에서만, 결과 보고 필수
            if not is_owner:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="only_owner_can_complete")
            if trip.status != TripStatus.APPROVED:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="invalid_status_transition")
            if not (report and report.strip()):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="report_required")
            trip.status = new_status
            trip.report = report
        else:
            # requested로 역전이 등은 불허
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="invalid_status_transition")
    elif report is not None:
        # 상태 전이 없이 보고만 갱신 — completed 본인 것만 (오탈자 수정 용도)
        if not is_owner:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="only_owner_can_edit")
        if trip.status != TripStatus.COMPLETED:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="trip_not_completed")
        trip.report = report

    await db.flush()
    await db.commit()
    await db.refresh(trip)
    return TripOut.from_orm_trip(trip)


@router.delete(
    "/trips/{trip_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="출장 삭제",
)
async def delete_trip(
    trip_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """DELETE /api/trips/{id} — 본인의 requested 신청만 삭제 가능.

    승인/반려/완료/취소된 기록은 근태 이력으로 보존 (409).
    """
    trip = await _get_or_404(db, trip_id)
    if trip.user_id != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="only_owner_can_delete")
    if trip.status != TripStatus.REQUESTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="cannot_delete_processed_trip")
    await db.delete(trip)
    await db.commit()
