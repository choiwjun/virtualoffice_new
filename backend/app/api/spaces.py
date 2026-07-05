"""
사무실/층/회의실 관리 API (P3-R1-T1).

- POST /offices                     사무실 생성 (admin)
- GET  /offices                     사무실 목록
- GET  /offices/{office_id}/floors  층 목록
- POST /floors                      층 생성 (admin)
- GET  /floors/{floor_id}/rooms     회의실 목록
- POST /rooms                       회의실 생성 (admin)
- GET  /rooms                       회의실 목록 (필터: floor_id)

경로 규약: root prefix 없음(계약 규약, Caddy /api/*→/*, D21-r). 리소스 지향(화면 비종속).
단일 조직 전제(company_id) — office.company_id는 UUID 컬럼이라 결정론 파생값 사용.
"""

from typing import Optional
from uuid import UUID, uuid4, uuid5, NAMESPACE_DNS

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import Floor, Office, Room, RoomType, RoomStatus

router = APIRouter(tags=["spaces"])

DEFAULT_COMPANY_UUID = uuid5(NAMESPACE_DNS, "vituraloffice.default-company")


# ── 스키마 ────────────────────────────────────────────────
class OfficeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    address: Optional[str] = None


class FloorCreate(BaseModel):
    office_id: UUID
    level: int
    name: str


class RoomCreate(BaseModel):
    floor_id: UUID
    type: str
    name: str
    capacity: int
    coords: dict


def _office_out(o: Office) -> dict:
    return {"office_id": str(o.id), "name": o.name, "description": o.description, "address": o.address}


def _floor_out(f: Floor) -> dict:
    return {"floor_id": str(f.id), "office_id": str(f.office_id), "level": f.level, "name": f.name}


def _room_out(r: Room) -> dict:
    return {
        "room_id": str(r.id),
        "floor_id": str(r.floor_id),
        "type": r.type.value if hasattr(r.type, "value") else r.type,
        "name": r.name,
        "capacity": r.capacity,
        "coords": r.coords,
        "status": r.status.value if hasattr(r.status, "value") else r.status,
    }


async def _get_or_404(db: AsyncSession, model, pk: UUID, detail: str):
    row = await db.get(model, pk)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return row


# ── 사무실 ────────────────────────────────────────────────
@router.post("/offices", status_code=status.HTTP_201_CREATED)
async def create_office(
    body: OfficeCreate,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    o = Office(id=uuid4(), company_id=DEFAULT_COMPANY_UUID, name=body.name, description=body.description, address=body.address)
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return _office_out(o)


@router.get("/offices")
async def list_offices(
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    rows = (await db.execute(select(Office).order_by(Office.name))).scalars().all()
    return {"offices": [_office_out(o) for o in rows]}


@router.get("/offices/{office_id}/floors")
async def list_floors(
    office_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    rows = (
        await db.execute(select(Floor).where(Floor.office_id == office_id).order_by(Floor.level))
    ).scalars().all()
    return {"floors": [_floor_out(f) for f in rows]}


# ── 층 ────────────────────────────────────────────────────
@router.post("/floors", status_code=status.HTTP_201_CREATED)
async def create_floor(
    body: FloorCreate,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    await _get_or_404(db, Office, body.office_id, "office_not_found")
    f = Floor(id=uuid4(), office_id=body.office_id, level=body.level, name=body.name)
    db.add(f)
    try:
        await db.commit()
    except IntegrityError:
        # (office_id, level) 유니크 위반 → 500 대신 409(seats.py 패턴과 동일).
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="floor_level_conflict")
    await db.refresh(f)
    return _floor_out(f)


@router.get("/floors/{floor_id}/rooms")
async def list_floor_rooms(
    floor_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    rows = (
        await db.execute(select(Room).where(Room.floor_id == floor_id).order_by(Room.name))
    ).scalars().all()
    return {"rooms": [_room_out(r) for r in rows]}


# ── 회의실 ────────────────────────────────────────────────
@router.post("/rooms", status_code=status.HTTP_201_CREATED)
async def create_room(
    body: RoomCreate,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    await _get_or_404(db, Floor, body.floor_id, "floor_not_found")
    try:
        room_type = RoomType(body.type)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_room_type")
    r = Room(
        id=uuid4(),
        floor_id=body.floor_id,
        type=room_type,
        name=body.name,
        capacity=body.capacity,
        coords=body.coords,
        status=RoomStatus.ACTIVE,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return _room_out(r)


@router.get("/rooms")
async def list_rooms(
    floor_id: Optional[UUID] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    stmt = select(Room)
    if floor_id is not None:
        stmt = stmt.where(Room.floor_id == floor_id)
    rows = (await db.execute(stmt.order_by(Room.name))).scalars().all()
    return {"rooms": [_room_out(r) for r in rows]}
