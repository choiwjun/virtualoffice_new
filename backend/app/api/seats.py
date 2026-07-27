"""
좌석 점유/반납 엔드포인트 (management-api 계약).

GET  /api/seats                         — 층별 좌석 목록
POST /api/seat-assignments              — 좌석 점유 (D10, §3.11)
PUT  /api/seat-assignments/{seat_id}    — 자리 주인 지정/해제 (관리자, user_id=null → 해제)
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

from app.core.deps import (
    ADMIN_ROLES,
    CurrentUser,
    assert_same_company,
    company_scope,
    get_current_user,
    require_role,
)
from app.db import get_db
from app.models.tables import (
    ErpUser,
    Floor,
    Seat,
    SeatAssignmentHistory,
    SeatStatus,
    SeatType,
)
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
    user_id: Optional[int] = None
    """None = 주인 없는 자리 (PUT /seat-assignments/{id} 에 user_id=null 로 해제한 결과)."""
    assigned_at: str
    status: str


# ---------------------------------------------------------------------------
# 엔드포인트
# ---------------------------------------------------------------------------

@router.get("/seats", response_model=list[SeatOut])
async def list_seats(
    floor_id: Optional[str] = Query(None, description="층 UUID — 미지정 시 전체"),
    current_user: CurrentUser = Depends(get_current_user),
    cid: int = Depends(company_scope),
    db: AsyncSession = Depends(get_db),
) -> list[SeatOut]:
    """GET /api/seats — 층별 좌석 목록 (D10, 테넌트 스코프). HG-SEC: 인증 필수(사내 좌석 배치 비공개)."""
    q = select(Seat).where(Seat.company_id == cid)
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
    cid: int = Depends(company_scope),
    db: AsyncSession = Depends(get_db),
) -> SeatAssignmentOut:
    """
    POST /api/seat-assignments — 좌석 점유 (D10, §3.11, 테넌트 스코프).

    - 대상 좌석이 AVAILABLE(비어있음)이어야 함.
    - fixed 좌석이고 이미 다른 사람이 배정됐으면 409.
    - 이미 OCCUPIED면 409.
    - history INSERT(assigned_at UTC).
    - 타사 좌석은 404(존재 은닉, 22 T0-1 IDOR 차단).
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
    assert_same_company(current_user, seat.company_id)

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
    assert_same_company(current_user, seat.company_id)

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

# rbac.yaml: 좌석 배치 편집기 = admin 전용 (leader deny) — office_layouts.py와 동일 집합.
# leader 포함이던 종전 집합은 정본 위반 (spec-impl-gap-audit-2026-07-13 §1-3).
_ADMIN = ADMIN_ROLES

class ReassignRequest(BaseModel):
    # None = 주인 없애기. 관리자 배정/해제를 한 엔드포인트로 묶어 부분 실패를 없앤다
    # (좌표 저장 + 배정을 프론트에서 2회 호출로 엮으면 "배정됐는데 밤사이 사라지는" 상태가 생긴다).
    user_id: Optional[int] = None
    reason: Optional[str] = None


async def _close_open_history(db: AsyncSession, seat_uuid: UUID, now: datetime) -> None:
    """해당 좌석의 열린 배정 이력(unassigned_at IS NULL)을 닫는다.

    `uk_current_seat`(부분 unique)가 좌석당 열린 이력을 1건으로 강제하므로,
    새 이력을 넣기 전에 반드시 먼저 닫아야 한다.
    """
    prev = (await db.execute(
        select(SeatAssignmentHistory)
        .where(SeatAssignmentHistory.seat_id == seat_uuid, SeatAssignmentHistory.unassigned_at.is_(None))
        .order_by(SeatAssignmentHistory.assigned_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if prev is not None:
        prev.unassigned_at = now


@router.put("/seat-assignments/{seat_id}", response_model=SeatAssignmentOut)
async def reassign_seat(
    seat_id: str,
    body: ReassignRequest,
    current_user: CurrentUser = Depends(require_role(*_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> SeatAssignmentOut:
    """PUT /api/seat-assignments/{seat_id} — 자리 주인 지정/해제 (관리자).

    - `user_id` = 사원 → 그 사원을 이 자리 주인으로. 열린 history를 닫고 새 history를 연다.
    - `user_id` = null → **주인 없애기**. history만 닫고 새로 열지 않는다
      (`seat_assignment_history.user_id`가 NOT NULL이라 "주인 없음" 이력은 애초에 표현할 수 없다).
    - 대상 사원은 **같은 회사의 활성 사원**이어야 한다. 아니면 404(존재 은닉, 22 T0-1).
    - 이미 같은 사원이면 아무것도 바꾸지 않는다 — 편집기에서 저장을 반복해도 이력이 불어나지 않게.
    - 그 사원이 **다른 자리**를 갖고 있으면 그 자리를 비운다(한 사람 = 한 자리).
      `employees.seat_number`가 단수라 두 자리를 허용하면 어느 쪽이 보일지가 순서에 좌우된다.
    """
    try:
        seat_uuid = UUID(seat_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid seat_id")
    seat = (await db.execute(select(Seat).where(Seat.id == seat_uuid))).scalar_one_or_none()
    if seat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="seat_not_found")
    assert_same_company(current_user, seat.company_id)
    if seat.status == SeatStatus.DISABLED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="seat_disabled")

    now = datetime.now(timezone.utc)
    prev_user_id = seat.assigned_user_id

    # ── 주인 없애기 ────────────────────────────────────────────────────
    if body.user_id is None:
        if prev_user_id is None:
            # 이미 빈 자리 — 성공으로 답한다(멱등). 편집기의 [주인 없애기]가 두 번 눌려도 실패하지 않게.
            return SeatAssignmentOut(
                seat_id=str(seat.id), user_id=None, assigned_at=now.isoformat(), status=seat.status.value,
            )
        await _close_open_history(db, seat_uuid, now)
        seat.assigned_user_id = None
        seat.status = SeatStatus.AVAILABLE
        await record_audit(
            db, company_id=current_user.company_id, user_id=current_user.user_id,
            action="seat_unassigned", entity_type="seat", entity_id=str(seat.id),
            old_value={"assigned_user_id": prev_user_id},
            new_value={"assigned_user_id": None, "reason": body.reason},
        )
        await db.flush()
        await db.commit()
        return SeatAssignmentOut(
            seat_id=str(seat.id), user_id=None, assigned_at=now.isoformat(), status=seat.status.value,
        )

    # ── 주인 지정 ──────────────────────────────────────────────────────
    # 타사·퇴사 사원에게 자리를 넘기면 그 자리는 아무도 쓸 수 없는 유령 자리가 된다.
    target = (await db.execute(
        select(ErpUser).where(
            ErpUser.id == body.user_id,
            ErpUser.company_id == seat.company_id,
            ErpUser.is_active.is_(True),
        )
    )).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")

    if prev_user_id == body.user_id:
        # 변화 없음 — 이력·감사 로그를 남기지 않는다.
        return SeatAssignmentOut(
            seat_id=str(seat.id), user_id=body.user_id, assigned_at=now.isoformat(), status=seat.status.value,
        )

    # 한 사람 = 한 자리: 이 사원이 갖고 있던 다른 자리를 먼저 비운다.
    vacated = (await db.execute(
        select(Seat).where(
            Seat.assigned_user_id == body.user_id,
            Seat.company_id == seat.company_id,
            Seat.id != seat_uuid,
        )
    )).scalars().all()
    for other in vacated:
        await _close_open_history(db, other.id, now)
        other.assigned_user_id = None
        other.status = SeatStatus.AVAILABLE

    await _close_open_history(db, seat_uuid, now)
    seat.assigned_user_id = body.user_id
    seat.status = SeatStatus.OCCUPIED
    db.add(SeatAssignmentHistory(
        seat_id=seat_uuid, user_id=body.user_id, assigned_at=now,
        assigned_by=current_user.user_id, reason=body.reason or "reassigned",
    ))
    await record_audit(
        db, company_id=current_user.company_id, user_id=current_user.user_id,
        action="seat_assigned", entity_type="seat", entity_id=str(seat.id),
        old_value={"assigned_user_id": prev_user_id},
        new_value={
            "assigned_user_id": body.user_id,
            "reason": body.reason,
            "vacated_seat_ids": [str(s.id) for s in vacated],
        },
    )
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
    cid: int = Depends(company_scope),
) -> list[FloorOut]:
    """GET /api/floors — 층 목록 (좌석 편집기 floor 선택용, 테넌트 스코프)."""
    rows = (
        await db.execute(
            select(Floor).where(Floor.company_id == cid).order_by(Floor.level)
        )
    ).scalars().all()
    return [FloorOut(id=str(f.id), office_id=str(f.office_id), level=f.level, name=getattr(f, "name", None)) for f in rows]


@router.post("/seats", response_model=SeatOut, status_code=status.HTTP_201_CREATED)
async def create_seat(
    body: SeatCreate,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
    cid: int = Depends(company_scope),
) -> SeatOut:
    """POST /api/seats — 좌석 생성 (관리자). D10: 배정정보 미포함. company_id=호출자 테넌트."""
    try:
        fid = UUID(body.floor_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid floor_id")
    try:
        seat_type = SeatType(body.type)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="invalid seat type")
    seat_status = SeatStatus(body.status) if body.status else SeatStatus.AVAILABLE
    seat = Seat(company_id=cid, floor_id=fid, type=seat_type, coords=body.coords, seat_number=body.seat_number, status=seat_status)
    db.add(seat)
    await db.flush()
    await db.commit()
    await db.refresh(seat)
    await record_audit(db, company_id=user.company_id, user_id=user.user_id, action="seat_created", entity_type="seat", entity_id=str(seat.id), new_value={"floor_id": str(fid), "type": seat.type.value})
    return _seat_out(seat)


async def _get_seat_or_404(seat_id: str, db: AsyncSession, user: CurrentUser) -> Seat:
    """seat 단건 로드 + 테넌트 스코프 검사 (Phase 1b · 22 T0-1). 타사 좌석은 404(존재 은닉)."""
    try:
        sid = UUID(seat_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid seat_id")
    seat = (await db.execute(select(Seat).where(Seat.id == sid))).scalar_one_or_none()
    if seat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="seat_not_found")
    assert_same_company(user, seat.company_id)
    return seat


@router.put("/seats/{seat_id}", response_model=SeatOut)
async def update_seat(
    seat_id: str,
    body: SeatUpdate,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
) -> SeatOut:
    """PUT /api/seats/{seat_id} — 좌석 수정 (관리자). 좌표 드래그 저장 포함."""
    seat = await _get_seat_or_404(seat_id, db, user)
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
    await record_audit(db, company_id=user.company_id, user_id=user.user_id, action="seat_updated", entity_type="seat", entity_id=str(seat.id), new_value={"coords": seat.coords, "status": seat.status.value})
    return _seat_out(seat)


@router.delete("/seats/{seat_id}", response_model=SeatOut)
async def delete_seat(
    seat_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
) -> SeatOut:
    """DELETE /api/seats/{seat_id} — 좌석 비활성화 (soft, status=disabled). 배정 해제."""
    seat = await _get_seat_or_404(seat_id, db, user)
    seat.status = SeatStatus.DISABLED
    seat.assigned_user_id = None
    seat.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(seat)
    await record_audit(db, company_id=user.company_id, user_id=user.user_id, action="seat_deleted", entity_type="seat", entity_id=str(seat.id))
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
    cid: int = Depends(company_scope),
) -> list[SeatAssignmentHistoryOut]:
    """GET /api/seat-assignments — 좌석 배정 이력 조회 (관리자, management-api).

    seat_assignment_history에는 company_id가 없다 → 부모(seat) 경유로 스코프한다(22 T0-1 레시피 4).
    스코프가 없으면 어느 회사 관리자든 남의 회사 좌석 이력을 통째로 읽는다.
    """
    query = (
        select(SeatAssignmentHistory)
        .join(Seat, Seat.id == SeatAssignmentHistory.seat_id)
        .where(Seat.company_id == cid)
        .order_by(SeatAssignmentHistory.assigned_at.desc())
    )

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
