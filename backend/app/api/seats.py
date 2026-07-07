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

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import Floor, Seat, SeatAssignmentHistory, SeatStatus, SeatType
from app.services.audit import record_audit

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


# ---------------------------------------------------------------------------
# 좌석 CRUD (관리자) — management-api.yaml /seats
# ---------------------------------------------------------------------------

_ADMIN = ("admin", "super_admin", "leader")

class ReassignRequest(BaseModel):
    user_id: int
    reason: Optional[str] = None


@router.put("/seat-assignments/{seat_id}", response_model=SeatAssignmentOut)
async def reassign_seat(
    seat_id: str,
    body: ReassignRequest,
    current_user: CurrentUser = Depends(require_role(*_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> SeatAssignmentOut:
    """PUT /api/seat-assignments/{seat_id} — 배정 수정(관리자): 좌석을 다른 사원에게 재배정.

    현재 열린 history를 닫고(unassigned_at) 새 배정 history를 연다. seat.assigned_user_id 갱신.
    """
    try:
        seat_uuid = UUID(seat_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid seat_id")
    seat = (await db.execute(select(Seat).where(Seat.id == seat_uuid))).scalar_one_or_none()
    if seat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="seat_not_found")
    if seat.status == SeatStatus.DISABLED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="seat_disabled")

    now = datetime.now(timezone.utc)
    # 기존 열린 history 닫기
    prev = (await db.execute(
        select(SeatAssignmentHistory)
        .where(SeatAssignmentHistory.seat_id == seat_uuid, SeatAssignmentHistory.unassigned_at.is_(None))
        .order_by(SeatAssignmentHistory.assigned_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if prev is not None:
        prev.unassigned_at = now

    seat.assigned_user_id = body.user_id
    seat.status = SeatStatus.OCCUPIED
    db.add(SeatAssignmentHistory(
        seat_id=seat_uuid, user_id=body.user_id, assigned_at=now,
        assigned_by=current_user.user_id, reason=body.reason or "reassigned",
    ))
    await db.flush()
    await db.commit()
    return SeatAssignmentOut(
        seat_id=str(seat.id), user_id=body.user_id, assigned_at=now.isoformat(), status=seat.status.value,
    )


def _seat_out(s: Seat) -> SeatOut:
    return SeatOut(
        id=str(s.id),
        floor_id=str(s.floor_id),
        type=s.type.value if hasattr(s.type, "value") else s.type,
        status=s.status.value if hasattr(s.status, "value") else s.status,
        assigned_user_id=s.assigned_user_id,
        seat_number=s.seat_number,
        coords=s.coords,
    )


class SeatCreate(BaseModel):
    floor_id: str
    type: str = "free"
    coords: dict = {"x": 0, "y": 0}
    seat_number: Optional[str] = None
    status: Optional[str] = None


class SeatUpdate(BaseModel):
    type: Optional[str] = None
    coords: Optional[dict] = None
    seat_number: Optional[str] = None
    status: Optional[str] = None


class FloorOut(BaseModel):
    id: str
    office_id: str
    level: int
    name: Optional[str] = None


@router.get("/floors", response_model=list[FloorOut])
async def list_floors(
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> list[FloorOut]:
    """GET /api/floors — 층 목록 (좌석 편집기 floor 선택용)."""
    rows = (await db.execute(select(Floor).order_by(Floor.level))).scalars().all()
    return [FloorOut(id=str(f.id), office_id=str(f.office_id), level=f.level, name=getattr(f, "name", None)) for f in rows]


@router.post("/seats", response_model=SeatOut, status_code=status.HTTP_201_CREATED)
async def create_seat(
    body: SeatCreate,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
) -> SeatOut:
    """POST /api/seats — 좌석 생성 (관리자). D10: 배정정보 미포함."""
    try:
        fid = UUID(body.floor_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid floor_id")
    try:
        seat_type = SeatType(body.type)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="invalid seat type")
    seat_status = SeatStatus(body.status) if body.status else SeatStatus.AVAILABLE
    seat = Seat(floor_id=fid, type=seat_type, coords=body.coords, seat_number=body.seat_number, status=seat_status)
    db.add(seat)
    await db.flush()
    await db.commit()
    await db.refresh(seat)
    await record_audit(db, user_id=user.user_id, action="seat_created", entity_type="seat", entity_id=str(seat.id), new_value={"floor_id": str(fid), "type": seat.type.value})
    return _seat_out(seat)


async def _get_seat_or_404(seat_id: str, db: AsyncSession) -> Seat:
    try:
        sid = UUID(seat_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid seat_id")
    seat = (await db.execute(select(Seat).where(Seat.id == sid))).scalar_one_or_none()
    if seat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="seat_not_found")
    return seat


@router.put("/seats/{seat_id}", response_model=SeatOut)
async def update_seat(
    seat_id: str,
    body: SeatUpdate,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
) -> SeatOut:
    """PUT /api/seats/{seat_id} — 좌석 수정 (관리자). 좌표 드래그 저장 포함."""
    seat = await _get_seat_or_404(seat_id, db)
    if body.type is not None:
        try:
            seat.type = SeatType(body.type)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="invalid seat type")
    if body.coords is not None:
        seat.coords = body.coords
    if body.seat_number is not None:
        seat.seat_number = body.seat_number
    if body.status is not None:
        try:
            seat.status = SeatStatus(body.status)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="invalid seat status")
    seat.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(seat)
    await record_audit(db, user_id=user.user_id, action="seat_updated", entity_type="seat", entity_id=str(seat.id), new_value={"coords": seat.coords, "status": seat.status.value})
    return _seat_out(seat)


@router.delete("/seats/{seat_id}", response_model=SeatOut)
async def delete_seat(
    seat_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
) -> SeatOut:
    """DELETE /api/seats/{seat_id} — 좌석 비활성화 (soft, status=disabled). 배정 해제."""
    seat = await _get_seat_or_404(seat_id, db)
    seat.status = SeatStatus.DISABLED
    seat.assigned_user_id = None
    seat.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(seat)
    await record_audit(db, user_id=user.user_id, action="seat_deleted", entity_type="seat", entity_id=str(seat.id))
    return _seat_out(seat)
# ── 배정 이력 조회 (관리자) ───────────────────────────────────────────────────

class SeatAssignmentHistoryOut(BaseModel):
    id: str
    seat_id: str
    user_id: int
    assigned_at: str
    unassigned_at: Optional[str] = None
    assigned_by_id: Optional[int] = None
    unassigned_by_id: Optional[int] = None
    reason: Optional[str] = None


@router.get("/seat-assignments", response_model=list[SeatAssignmentHistoryOut])
async def list_seat_assignments(
    seat_id: Optional[str] = Query(None, description="좌석 ID 필터"),
    user_id: Optional[int] = Query(None, description="사용자 ID 필터"),
    limit: int = Query(100, le=500, description="최대 결과 수"),
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role(*_ADMIN)),
) -> list[SeatAssignmentHistoryOut]:
    """GET /api/seat-assignments — 좌석 배정 이력 조회 (관리자, management-api)."""
    query = select(SeatAssignmentHistory).order_by(SeatAssignmentHistory.assigned_at.desc())
    
    if seat_id:
        try:
            query = query.where(SeatAssignmentHistory.seat_id == UUID(seat_id))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_seat_id")
    
    if user_id:
        query = query.where(SeatAssignmentHistory.user_id == user_id)
    
    query = query.limit(limit)
    rows = (await db.execute(query)).scalars().all()
    
    def _iso(dt):
        if dt is None:
            return None
        if dt.tzinfo is None:
            from datetime import timezone
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    
    return [
        SeatAssignmentHistoryOut(
            id=str(r.id),
            seat_id=str(r.seat_id),
            user_id=r.user_id,
            assigned_at=_iso(r.assigned_at),
            unassigned_at=_iso(r.unassigned_at),
            assigned_by_id=r.assigned_by,
            unassigned_by_id=None,
            reason=r.reason,
        )
        for r in rows
    ]
