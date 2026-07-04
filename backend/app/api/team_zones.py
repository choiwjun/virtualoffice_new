"""
팀↔구역 매핑(TeamZone) API — ERP team을 org_group + 3D 오피스 구역에 배치.

- POST   /team-zones            생성 (admin)
- GET    /team-zones            목록 (필터: org_group_id, office_id, floor_id, erp_team_id)
- GET    /team-zones/{id}       단건
- DELETE /team-zones/{id}       삭제 (admin)

(erp_team_id, office_id, floor_id) 조합은 유일해야 한다(models/tables.py
uq_team_zone_unique) — 중복 생성 시 409.

@TASK P2-R2-T1 - team_zone 매핑 CRUD
@SPEC docs/planning/04-data-model.md §2.2
"""

import json
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import Floor, Office, OrgGroup, TeamZone

router = APIRouter(prefix="/team-zones", tags=["team-zones"])


_MAX_POLYGON_DEPTH = 6
_MAX_POLYGON_BYTES = 1_048_576  # 1MB — 좌표 배열 상한(과도 중첩/대용량 페이로드 방어)


def _exceeds_depth(obj, limit: int, _d: int = 0) -> bool:
    if _d > limit:
        return True
    if isinstance(obj, dict):
        return any(_exceeds_depth(v, limit, _d + 1) for v in obj.values())
    if isinstance(obj, list):
        return any(_exceeds_depth(v, limit, _d + 1) for v in obj)
    return False


def _validate_polygon(polygon) -> None:
    """polygon은 2D 좌표 데이터 — 과도 중첩(pydantic 직렬화 재귀 500 방지)·대용량 거부."""
    if polygon is None:
        return
    if _exceeds_depth(polygon, _MAX_POLYGON_DEPTH):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="polygon_too_deep")
    try:
        size = len(json.dumps(polygon))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_polygon")
    if size > _MAX_POLYGON_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="polygon_too_large"
        )


# ── 스키마 ────────────────────────────────────────────────
class TeamZoneCreate(BaseModel):
    erp_team_id: int
    org_group_id: UUID
    office_id: UUID
    floor_id: UUID
    zone_label: str
    color: Optional[str] = None
    polygon: Optional[dict] = None


class TeamZoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    erp_team_id: int
    org_group_id: UUID
    office_id: UUID
    floor_id: UUID
    zone_label: str
    color: Optional[str] = None
    polygon: Optional[dict] = None


def _team_zone_out(row: TeamZone) -> dict:
    return TeamZoneOut.model_validate(row).model_dump(mode="json")


async def _get_or_404(db, model, entity_id: UUID, detail: str):
    row = await db.get(model, entity_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return row


# ── 생성 ──────────────────────────────────────────────────
@router.post("", status_code=status.HTTP_201_CREATED)
async def create_team_zone(
    body: TeamZoneCreate,
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    _validate_polygon(body.polygon)
    await _get_or_404(db, OrgGroup, body.org_group_id, "org_group_not_found")
    await _get_or_404(db, Office, body.office_id, "office_not_found")
    await _get_or_404(db, Floor, body.floor_id, "floor_not_found")

    row = TeamZone(
        id=uuid4(),
        erp_team_id=body.erp_team_id,
        org_group_id=body.org_group_id,
        office_id=body.office_id,
        floor_id=body.floor_id,
        zone_label=body.zone_label,
        color=body.color,
        polygon=body.polygon,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="team_zone_already_exists"
        )
    await db.refresh(row)
    return _team_zone_out(row)


# ── 목록 ──────────────────────────────────────────────────
@router.get("")
async def list_team_zones(
    org_group_id: Optional[UUID] = Query(None),
    office_id: Optional[UUID] = Query(None),
    floor_id: Optional[UUID] = Query(None),
    erp_team_id: Optional[int] = Query(None),
    db=Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    stmt = select(TeamZone)
    if org_group_id is not None:
        stmt = stmt.where(TeamZone.org_group_id == org_group_id)
    if office_id is not None:
        stmt = stmt.where(TeamZone.office_id == office_id)
    if floor_id is not None:
        stmt = stmt.where(TeamZone.floor_id == floor_id)
    if erp_team_id is not None:
        stmt = stmt.where(TeamZone.erp_team_id == erp_team_id)
    rows = (await db.execute(stmt)).scalars().all()
    items = [_team_zone_out(r) for r in rows]
    return {"items": items, "total": len(items)}


# ── 단건 ──────────────────────────────────────────────────
@router.get("/{team_zone_id}")
async def get_team_zone(
    team_zone_id: UUID,
    db=Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    row = await _get_or_404(db, TeamZone, team_zone_id, "team_zone_not_found")
    return _team_zone_out(row)


# ── 삭제 ──────────────────────────────────────────────────
@router.delete("/{team_zone_id}")
async def delete_team_zone(
    team_zone_id: UUID,
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    row = await _get_or_404(db, TeamZone, team_zone_id, "team_zone_not_found")
    await db.delete(row)
    await db.commit()
    return {"deleted": True}
