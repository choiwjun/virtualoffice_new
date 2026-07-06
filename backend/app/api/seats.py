"""
좌석 점유/반납 엔드포인트 (management-api 계약).

GET  /api/seats                         — 층별 좌석 목록
POST /api/seat-assignments              — 좌석 점유 (D10, §3.11)
POST /api/seat-assignments/{seat_id}/release — 좌석 반납

D10: 좌석 배정은 DB가 소유(layout JSON 불포함). 배정 변경 시 레이아웃 재배포 불필요.
§3.11: free(AVAILABLE) 좌석 점유 → assigned_user_id + status=occupied + history INSERT(assigned_at).
       이미 OCCUPIED 또는 fixed 좌석에 타인 배정 → 409.
       반납 → assigned_user_id=NULL + status=available + history.unassigned_at 갱신.
D19: UTC 저장.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import Seat, SeatAssignmentHistory, SeatStatus, SeatType

router = APIRouter(prefix="/api", tags=["seats"])


# ---------------------------------------------------------------------------
# 스키마
# ---------------------------------------------------------------------------

class SeatOut(BaseModel):
    id: str
    floor_id: str
    type: str
    status: str
    assigned_user_id: Optional[int] = None
    seat_number: Optional[str] = None
    coords: dict


class AssignRequest(BaseModel):
    seat_id: str
    user_id: Optional[int] = None   # None → 현재 로그인 사용자
    reason: Optional[str] = None


class SeatAssignmentOut(BaseModel):
    seat_id: str
    user_id: int
    assigned_at: str
    status: str


# ---------------------------------------------------------------------------
# 엔드포인트
# ---------------------------------------------------------------------------

@router.get("/seats", response_model=list[SeatOut])
async def list_seats(
    floor_id: Optional[str] = Query(None, description="층 UUID — 미지정 시 전체"),
    db: AsyncSession = Depends(get_db),
) -> list[SeatOut]:
    """GET /api/seats — 층별 좌석 목록 (D10)."""
    q = select(Seat)
    if floor_id is not None:
        try:
            fid = UUID(floor_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid floor_id",
            )
        q = q.where(Seat.floor_id == fid)

    result = await db.execute(q)
    seats = result.scalars().all()
    return [
        SeatOut(
            id=str(s.id),
            floor_id=str(s.floor_id),
            type=s.type.value,
            status=s.status.value,
            assigned_user_id=s.assigned_user_id,
            seat_number=s.seat_number,
            coords=s.coords,
        )
        for s in seats
    ]


@router.post(
    "/seat-assignments",
    response_model=SeatAssignmentOut,
    status_code=status.HTTP_201_CREATED,
)
async def assign_seat(
    body: AssignRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SeatAssignmentOut:
    """
    POST /api/seat-assignments — 좌석 점유 (D10, §3.11).

    - 대상 좌석이 AVAILABLE(비어있음)이어야 함.
    - fixed 좌석이고 이미 다른 사람이 배정됐으면 409.
    - 이미 OCCUPIED면 409.
    - history INSERT(assigned_at UTC).
    """
    try:
        seat_uuid = UUID(body.seat_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid seat_id",
        )

    result = await db.execute(select(Seat).where(Seat.id == seat_uuid))
    seat = result.scalar_one_or_none()
    if seat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="seat_not_found",
        )

    target_user_id = body.user_id if body.user_id is not None else current_user.user_id

    # 이미 점유된 경우 (§3.11)
    if seat.status == SeatStatus.OCCUPIED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="seat_already_occupied",
        )

    # fixed 좌석이고 타인 배정된 경우 (§3.11)
    if (
        seat.type == SeatType.FIXED
        and seat.assigned_user_id is not None
        and seat.assigned_user_id != target_user_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="seat_fixed_to_other_user",
        )

    now = datetime.now(timezone.utc)

    seat.assigned_user_id = target_user_id
    seat.status = SeatStatus.OCCUPIED

    history = SeatAssignmentHistory(
        seat_id=seat_uuid,
        user_id=target_user_id,
        assigned_at=now,
        assigned_by=current_user.user_id,
        reason=body.reason,
    )
    db.add(history)
    await db.flush()
    await db.commit()

    return SeatAssignmentOut(
        seat_id=str(seat.id),
        user_id=target_user_id,
        assigned_at=now.isoformat(),
        status=seat.status.value,
    )


@router.post(
    "/seat-assignments/{seat_id}/release",
    response_model=SeatAssignmentOut,
)
async def release_seat(
    seat_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SeatAssignmentOut:
    """
    POST /api/seat-assignments/{seat_id}/release — 좌석 반납 (§3.11).

    - assigned_user_id → NULL
    - status → available
    - 최근 열린(unassigned_at=NULL) history 레코드의 unassigned_at 갱신.
    """
    try:
        seat_uuid = UUID(seat_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid seat_id",
        )

    result = await db.execute(select(Seat).where(Seat.id == seat_uuid))
    seat = result.scalar_one_or_none()
    if seat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="seat_not_found",
        )

    if seat.status != SeatStatus.OCCUPIED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="seat_not_occupied",
        )

    released_user_id = seat.assigned_user_id
    now = datetime.now(timezone.utc)

    seat.assigned_user_id = None
    seat.status = SeatStatus.AVAILABLE

    # 최근 열린 history 레코드 unassigned_at 갱신
    hist_result = await db.execute(
        select(SeatAssignmentHistory)
        .where(
            SeatAssignmentHistory.seat_id == seat_uuid,
            SeatAssignmentHistory.unassigned_at.is_(None),
        )
        .order_by(SeatAssignmentHistory.assigned_at.desc())
        .limit(1)
    )
    history_rec = hist_result.scalar_one_or_none()
    if history_rec is not None:
        history_rec.unassigned_at = now

    await db.flush()
    await db.commit()

    return SeatAssignmentOut(
        seat_id=str(seat.id),
        user_id=released_user_id if released_user_id is not None else current_user.user_id,
        assigned_at=(
            history_rec.assigned_at.isoformat()
            if history_rec is not None
            else now.isoformat()
        ),
        status=seat.status.value,
    )
