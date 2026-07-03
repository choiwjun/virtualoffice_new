"""
좌석 API (배정 정보는 DB 소유, layout JSON과 분리 — D10).

- GET    /seats                     좌석 목록 조회 (필터: floor_id, type, status)
- POST   /seats                     좌석 생성 (admin)
- GET    /seats/available           사용 가능(available) 좌석 조회
- POST   /seats/{seat_number}/assign     좌석 배정 (admin)
- DELETE /seats/{seat_number}/assign     좌석 배정 해제 (admin)
- POST   /seats/{seat_number}/occupy     자율석 점유 (self-service)
- DELETE /seats/{seat_number}/occupy     자율석 반납 (self-service)

@SPEC 00-decisions.md D10, docs/planning/04-data-model.md §2.3

경로/응답 규약(의도적, 계약 테스트 기준): 좌석 엔드포인트는 root(/seats*, prefix 없음)이고
목록 응답은 {seats}/{available_seats} 키를 쓴다(계약 스텁 정합). 외부 공개 시 Caddy가
/api/* → /* 로 라우팅한다(D21-r). erp.py의 /api·{items,total}과 다른 것은 이 계약 차이 때문.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import ErpUser, Seat, SeatAssignmentHistory, SeatStatus, SeatType
from app.services.audit_service import record_audit

router = APIRouter(tags=["seats"])


# ── 스키마 ────────────────────────────────────────────────
class CoordsSchema(BaseModel):
    x: float
    y: float
    facing: Optional[float] = None


class SeatCreate(BaseModel):
    floor_id: UUID
    seat_number: Optional[str] = None
    type: str
    coords: CoordsSchema
    team_zone_id: Optional[UUID] = None


class SeatAssignIn(BaseModel):
    user_id: int


class SeatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    seat_number: Optional[str] = None
    floor_id: UUID
    type: str
    status: str
    assigned_user_id: Optional[int] = None
    coords: dict


def _seat_out(seat: Seat) -> dict:
    return SeatOut.model_validate(seat).model_dump(mode="json")


# ── 조회 헬퍼 ─────────────────────────────────────────────
async def _get_seat_by_number(db: AsyncSession, seat_number: str) -> Seat:
    seat = (
        await db.execute(
            select(Seat)
            .where(Seat.seat_number == seat_number)
            .order_by(Seat.floor_id, Seat.id)
        )
    ).scalars().first()
    if seat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="seat_not_found")
    return seat


async def _get_active_assignment(
    db: AsyncSession, seat_id: UUID
) -> Optional[SeatAssignmentHistory]:
    return (
        await db.execute(
            select(SeatAssignmentHistory).where(
                SeatAssignmentHistory.seat_id == seat_id,
                SeatAssignmentHistory.unassigned_at.is_(None),
            )
        )
    ).scalar_one_or_none()


# ── 목록/생성 ─────────────────────────────────────────────
@router.get("/seats")
async def list_seats(
    floor_id: Optional[UUID] = Query(None),
    type: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    stmt = select(Seat)
    if floor_id is not None:
        stmt = stmt.where(Seat.floor_id == floor_id)
    if type is not None:
        stmt = stmt.where(Seat.type == type)
    if status_filter is not None:
        stmt = stmt.where(Seat.status == status_filter)
    rows = (await db.execute(stmt.order_by(Seat.seat_number))).scalars().all()
    return {"seats": [_seat_out(r) for r in rows]}


@router.post("/seats", status_code=status.HTTP_201_CREATED)
async def create_seat(
    payload: SeatCreate,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    try:
        seat_type = SeatType(payload.type)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_seat_type")

    seat = Seat(
        floor_id=payload.floor_id,
        team_zone_id=payload.team_zone_id,
        type=seat_type,
        coords=payload.coords.model_dump(),
        seat_number=payload.seat_number,
    )
    db.add(seat)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="seat_number_conflict"
        )
    await db.refresh(seat)
    return _seat_out(seat)


@router.get("/seats/available")
async def list_available_seats(
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    rows = (
        await db.execute(select(Seat).where(Seat.status == SeatStatus.AVAILABLE))
    ).scalars().all()
    return {"available_seats": [_seat_out(r) for r in rows]}


# ── 배정 (admin) ──────────────────────────────────────────
@router.post("/seats/{seat_number}/assign")
async def assign_seat(
    seat_number: str,
    payload: SeatAssignIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    seat = await _get_seat_by_number(db, seat_number)
    active = await _get_active_assignment(db, seat.id)
    if seat.assigned_user_id is not None or active is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="seat_already_assigned")

    user_exists = (
        await db.execute(select(ErpUser.id).where(ErpUser.id == payload.user_id))
    ).scalar_one_or_none()
    if user_exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")

    now = datetime.now(timezone.utc)
    db.add(
        SeatAssignmentHistory(
            seat_id=seat.id,
            user_id=payload.user_id,
            assigned_at=now,
            unassigned_at=None,
            assigned_by=current.user_id,
        )
    )
    seat.assigned_user_id = payload.user_id
    seat.status = SeatStatus.OCCUPIED
    record_audit(
        db,
        action="seat_assigned",
        entity_type="seat",
        entity_id=seat.id,
        user_id=current.user_id,
        old_value={"assigned_user_id": None},
        new_value={"assigned_user_id": payload.user_id, "seat_number": seat_number},
        request=request,
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="seat_already_assigned")
    await db.refresh(seat)
    return _seat_out(seat)


@router.delete("/seats/{seat_number}/assign")
async def unassign_seat(
    seat_number: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    seat = await _get_seat_by_number(db, seat_number)
    active = await _get_active_assignment(db, seat.id)
    if active is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="seat_not_assigned")

    prev_user_id = seat.assigned_user_id
    active.unassigned_at = datetime.now(timezone.utc)
    seat.assigned_user_id = None
    seat.status = SeatStatus.AVAILABLE
    record_audit(
        db,
        action="seat_unassigned",
        entity_type="seat",
        entity_id=seat.id,
        user_id=current.user_id,
        old_value={"assigned_user_id": prev_user_id},
        new_value={"assigned_user_id": None},
        request=request,
    )
    await db.commit()
    await db.refresh(seat)
    return _seat_out(seat)


# ── 자율석 점유/반납 (self-service) ──────────────────────
@router.post("/seats/{seat_number}/occupy")
async def occupy_seat(
    seat_number: str,
    db: AsyncSession = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> dict:
    seat = await _get_seat_by_number(db, seat_number)
    if seat.type != SeatType.FREE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="seat_not_flexible")

    active = await _get_active_assignment(db, seat.id)
    if seat.status != SeatStatus.AVAILABLE or seat.assigned_user_id is not None or active is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="seat_already_occupied")

    now = datetime.now(timezone.utc)
    db.add(
        SeatAssignmentHistory(
            seat_id=seat.id,
            user_id=current.user_id,
            assigned_at=now,
            unassigned_at=None,
            assigned_by=current.user_id,
            reason="self_occupy",
        )
    )
    seat.assigned_user_id = current.user_id
    seat.status = SeatStatus.OCCUPIED
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="seat_already_occupied")
    await db.refresh(seat)
    return _seat_out(seat)


@router.delete("/seats/{seat_number}/occupy")
async def release_seat(
    seat_number: str,
    db: AsyncSession = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> dict:
    seat = await _get_seat_by_number(db, seat_number)
    active = await _get_active_assignment(db, seat.id)
    if active is None or active.user_id != current.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="seat_not_occupied_by_user")

    active.unassigned_at = datetime.now(timezone.utc)
    seat.assigned_user_id = None
    seat.status = SeatStatus.AVAILABLE
    await db.commit()
    await db.refresh(seat)
    return _seat_out(seat)
