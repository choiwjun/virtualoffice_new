"""오피스 레이아웃 버전 관리 API (management-api.yaml /office-layouts, D12).

draft → validated → deployed / archived(롤백). 검증은 서버 단일(D12):
office_layout_validator.validate_office_layout 재사용, ERROR 0건일 때만 validated.
배포는 validated에서만 가능([무시하고 배포] 없음 — D12).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import OfficeLayout, OfficeLayoutStatus
from app.services.audit import record_audit
from app.services.office_layout_validator import validate_office_layout

router = APIRouter(prefix="/api/office-layouts", tags=["office-layouts"])

_ADMIN = ("admin", "super_admin")


class LayoutCreate(BaseModel):
    office_id: str
    floor_id: str
    json: dict[str, Any]


class LayoutUpdate(BaseModel):
    json: dict[str, Any]


class LayoutOut(BaseModel):
    id: str
    office_id: str
    floor_id: str
    version: int
    status: str
    deployed_at: Optional[str] = None
    created_at: str


class ValidateOut(BaseModel):
    layout_id: str
    status: str
    error_count: int
    warning_count: int
    errors: list[dict]
    warnings: list[dict]


def _out(layout: OfficeLayout) -> LayoutOut:
    return LayoutOut(
        id=str(layout.id),
        office_id=str(layout.office_id),
        floor_id=str(layout.floor_id),
        version=layout.version,
        status=layout.status.value if hasattr(layout.status, "value") else layout.status,
        deployed_at=layout.deployed_at.isoformat() if layout.deployed_at else None,
        created_at=layout.created_at.isoformat() if layout.created_at else "",
    )


async def _get_or_404(layout_id: str, db: AsyncSession) -> OfficeLayout:
    try:
        lid = UUID(layout_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid layout_id")
    row = (await db.execute(select(OfficeLayout).where(OfficeLayout.id == lid))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="layout_not_found")
    return row


@router.post("", response_model=LayoutOut, status_code=status.HTTP_201_CREATED)
async def create_layout(
    body: LayoutCreate,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
) -> LayoutOut:
    """POST /api/office-layouts — draft 생성 (version 자동 증분)."""
    try:
        office_uuid = UUID(body.office_id)
        floor_uuid = UUID(body.floor_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid office_id/floor_id")
    max_v = (await db.execute(select(func.max(OfficeLayout.version)).where(OfficeLayout.floor_id == floor_uuid))).scalar_one()
    layout = OfficeLayout(
        office_id=office_uuid,
        floor_id=floor_uuid,
        version=(max_v or 0) + 1,
        status=OfficeLayoutStatus.DRAFT,
        json=body.json,
        created_by=user.user_id,
    )
    db.add(layout)
    await db.flush()
    await db.commit()
    await db.refresh(layout)
    return _out(layout)


@router.get("", response_model=list[LayoutOut])
async def list_layouts(
    status_filter: Optional[str] = Query(None, alias="status"),
    floor_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role(*_ADMIN)),
) -> list[LayoutOut]:
    q = select(OfficeLayout)
    if status_filter:
        q = q.where(OfficeLayout.status == OfficeLayoutStatus(status_filter))
    if floor_id:
        q = q.where(OfficeLayout.floor_id == UUID(floor_id))
    rows = (await db.execute(q.order_by(OfficeLayout.version.desc()))).scalars().all()
    return [_out(r) for r in rows]


def _sf(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def map_structure(j: dict) -> dict:
    """office_layout JSON → 뷰포트용 구조(방/구역/벽, 미터). 좌표는 top_left 미터 원본 그대로 —
    정규화(÷scene)는 프론트가 좌석과 동일 metersToNorm으로 수행해 정렬을 보장한다."""
    dims = j.get("dimensions") or {}
    rooms = []
    for r in j.get("rooms") or []:
        c = r.get("coords") or {}
        rooms.append({
            "id": r.get("room_id", ""),
            "label": r.get("name") or r.get("room_id", ""),
            "type": r.get("type", "meeting"),
            "x": _sf(c.get("x")), "y": _sf(c.get("y")),
            "w": _sf(c.get("width")), "h": _sf(c.get("height")),
        })
    zones = []
    for z in j.get("zones") or []:
        poly = [{"x": _sf(p.get("x")), "y": _sf(p.get("y"))} for p in (z.get("polygon") or [])]
        zones.append({
            "id": z.get("zone_id", ""),
            "label": z.get("label") or "",
            "color": z.get("color") or "#3498db",
            "polygon": poly,
        })
    walls = []
    for c in j.get("colliders") or []:
        if c.get("shape") == "box":
            b = c.get("box") or {}
            walls.append({"x": _sf(b.get("x")), "y": _sf(b.get("y")), "w": _sf(b.get("width")), "h": _sf(b.get("height"))})
    return {
        "deployed": True,
        "dimensions": {"width_m": _sf(dims.get("width_m"), 20.0), "height_m": _sf(dims.get("height_m"), 11.256)},
        "rooms": rooms,
        "zones": zones,
        "walls": walls,
    }


@router.get("/deployed/structure")
async def deployed_structure(
    floor_id: Optional[str] = Query(None, description="층 UUID — 미지정 시 최신 배포본"),
    _: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """GET /api/office-layouts/deployed/structure — 현재 배포(DEPLOYED)된 레이아웃의 구조를
    미터 좌표로 반환. 뷰포트가 '좌석배치대로 가상사무실'을 렌더하는 데 사용(방/벽/구역 반영).
    인증된 모든 사용자 접근(사내 오피스 표시). 배포본 없으면 deployed=false."""
    q = select(OfficeLayout).where(OfficeLayout.status == OfficeLayoutStatus.DEPLOYED)
    if floor_id:
        try:
            q = q.where(OfficeLayout.floor_id == UUID(floor_id))
        except (ValueError, TypeError):
            return {"deployed": False, "rooms": [], "zones": [], "walls": []}
    row = (await db.execute(q.order_by(OfficeLayout.version.desc()))).scalars().first()
    if row is None:
        return {"deployed": False, "rooms": [], "zones": [], "walls": []}
    return map_structure(row.json)


@router.get("/{layout_id}", response_model=LayoutOut)
async def get_layout(layout_id: str, db: AsyncSession = Depends(get_db), _: CurrentUser = Depends(require_role(*_ADMIN))) -> LayoutOut:
    return _out(await _get_or_404(layout_id, db))


@router.put("/{layout_id}", response_model=LayoutOut)
async def update_layout(
    layout_id: str,
    body: LayoutUpdate,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role(*_ADMIN)),
) -> LayoutOut:
    """PUT /api/office-layouts/{id} — draft 상태에서만 json 수정. 수정 시 validated→draft 복귀."""
    layout = await _get_or_404(layout_id, db)
    cur = layout.status.value if hasattr(layout.status, "value") else layout.status
    if cur == "deployed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="cannot_edit_deployed")
    layout.json = body.json
    layout.status = OfficeLayoutStatus.DRAFT
    layout.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(layout)
    return _out(layout)


@router.post("/{layout_id}/validate", response_model=ValidateOut)
async def validate_layout(
    layout_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
) -> ValidateOut:
    """POST /api/office-layouts/{id}/validate — D12 서버 검증. ERROR 0건 → draft→validated."""
    layout = await _get_or_404(layout_id, db)
    result = validate_office_layout(layout.json or {})
    errors = [i.as_dict() for i in result.errors]
    warnings = [i.as_dict() for i in result.warnings]
    if len(errors) == 0:
        layout.status = OfficeLayoutStatus.VALIDATED
        layout.validated_by = user.user_id
        layout.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(layout)
    new_status = layout.status.value if hasattr(layout.status, "value") else layout.status
    return ValidateOut(
        layout_id=str(layout.id), status=new_status,
        error_count=len(errors), warning_count=len(warnings), errors=errors, warnings=warnings,
    )


@router.post("/{layout_id}/deploy", response_model=LayoutOut)
async def deploy_layout(
    layout_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
) -> LayoutOut:
    """POST /api/office-layouts/{id}/deploy — validated→deployed. D12: validated 아니면 차단."""
    layout = await _get_or_404(layout_id, db)
    cur = layout.status.value if hasattr(layout.status, "value") else layout.status
    if cur != "validated":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="must_validate_before_deploy")
    # 기존 deployed(같은 floor) → archived
    others = (await db.execute(select(OfficeLayout).where(OfficeLayout.floor_id == layout.floor_id, OfficeLayout.status == OfficeLayoutStatus.DEPLOYED))).scalars().all()
    for o in others:
        o.status = OfficeLayoutStatus.ARCHIVED
    now = datetime.now(timezone.utc)
    layout.status = OfficeLayoutStatus.DEPLOYED
    layout.deployed_at = now
    layout.updated_at = now
    await db.commit()
    await db.refresh(layout)
    await record_audit(db, user_id=user.user_id, action="office_layout_deployed", entity_type="office_layout", entity_id=str(layout.id), new_value={"version": layout.version})
    return _out(layout)


@router.post("/{layout_id}/rollback", response_model=LayoutOut)
async def rollback_layout(
    layout_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
) -> LayoutOut:
    """POST /api/office-layouts/{id}/rollback — 현재 deployed를 archived로, 직전 archived 버전을 deployed로 복원."""
    layout = await _get_or_404(layout_id, db)
    cur = layout.status.value if hasattr(layout.status, "value") else layout.status
    if cur != "deployed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="only_deployed_can_rollback")
    prev = (
        await db.execute(
            select(OfficeLayout)
            .where(OfficeLayout.floor_id == layout.floor_id, OfficeLayout.status == OfficeLayoutStatus.ARCHIVED, OfficeLayout.id != layout.id)
            .order_by(OfficeLayout.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if prev is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="no_previous_version")
    now = datetime.now(timezone.utc)
    layout.status = OfficeLayoutStatus.ARCHIVED
    prev.status = OfficeLayoutStatus.DEPLOYED
    prev.deployed_at = now
    layout.updated_at = now
    prev.updated_at = now
    await db.commit()
    await db.refresh(prev)
    await record_audit(db, user_id=user.user_id, action="office_layout_deployed", entity_type="office_layout", entity_id=str(prev.id), new_value={"version": prev.version, "rollback_from": str(layout.id)})
    return _out(prev)
