"""
오피스 레이아웃 API (D12: 서버 단일 정밀 검증, 04-data-model.md §2.3, 05-office-layout-schema.md).

- GET    /layouts                       레이아웃 버전 목록 (필터: office_id, floor_id, status)
- POST   /layouts                       레이아웃 생성 (admin, DRAFT, 버전=office/floor 최대+1)
- GET    /layouts/current               현재 배포(DEPLOYED)된 레이아웃 조회
- POST   /layouts/validate              레이아웃 JSON 정밀 검증 (admin, 저장 없음)
- GET    /layouts/{layout_id}           개별 레이아웃 조회
- PUT    /layouts/{layout_id}           레이아웃 수정 (admin, DRAFT일 때만)
- POST   /layouts/{layout_id}/deploy    배포 (admin) — 검증 통과(ERROR=0)해야 배포 가능(D12)
- POST   /layouts/{layout_id}/rollback  롤백 (admin) — 지정 버전을 재배포, 기존 배포는 archived
- GET    /layouts/{layout_id}/history   같은 office/floor의 전체 버전 이력

경로/응답 규약(의도적, 계약 테스트 기준): 레이아웃 엔드포인트는 root(/layouts*, prefix 없음)이고
seats.py와 동일하게 목록 응답은 {layouts} 키를 쓴다(계약 스텁 정합). 외부 공개 시 Caddy가
/api/* → /* 로 라우팅한다(D21-r).

계약 테스트 스텁(backend/tests/contract/test_management_api_stubs.py)의 layout_id는 원래
문자열 리터럴('layout-001')이었으나 실제 PK는 UUID이므로, layout_id path 파라미터는 UUID
타입이 아닌 str로 선언하고 수동으로 UUID를 파싱한다: 존재하지 않는 UUID뿐 아니라 UUID 형식이
아닌 값('nonexistent')도 422(FastAPI 자동 검증)가 아닌 404로 응답해야 하기 때문이다.

@SPEC docs/planning/00-decisions.md#D12
@SPEC docs/planning/05-office-layout-schema.md
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import OfficeLayout, OfficeLayoutStatus
from app.services.office_layout_validator import build_context_from_db, validate_office_layout
from app.services.audit_service import record_audit

router = APIRouter(tags=["layouts"])


# ── 스키마 ────────────────────────────────────────────────
class LayoutCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    office_id: UUID
    floor_id: UUID
    layout_json: dict = Field(alias="json")
    deployment_notes: Optional[str] = None


class LayoutUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    layout_json: dict = Field(alias="json")
    deployment_notes: Optional[str] = None


def _layout_out(layout: OfficeLayout) -> dict:
    return {
        "layout_id": str(layout.id),
        "office_id": str(layout.office_id),
        "floor_id": str(layout.floor_id),
        "version": layout.version,
        "status": layout.status.value if hasattr(layout.status, "value") else layout.status,
        "json": layout.json,
        "deployed_at": layout.deployed_at.isoformat() if layout.deployed_at else None,
    }


# ── 조회 헬퍼 ─────────────────────────────────────────────
def _parse_uuid(value: str) -> Optional[UUID]:
    try:
        return UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None


async def _get_layout_or_404(db: AsyncSession, layout_id: str) -> OfficeLayout:
    uid = _parse_uuid(layout_id)
    if uid is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="layout_not_found")
    layout = await db.get(OfficeLayout, uid)
    if layout is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="layout_not_found")
    return layout


async def _archive_current_deployed(
    db: AsyncSession, office_id: UUID, floor_id: UUID
) -> None:
    """같은 (office_id, floor_id)의 기존 DEPLOYED 레이아웃을 ARCHIVED로 전이."""
    rows = (
        await db.execute(
            select(OfficeLayout).where(
                OfficeLayout.office_id == office_id,
                OfficeLayout.floor_id == floor_id,
                OfficeLayout.status == OfficeLayoutStatus.DEPLOYED,
            )
        )
    ).scalars().all()
    for row in rows:
        row.status = OfficeLayoutStatus.ARCHIVED


# ── 목록/생성 ─────────────────────────────────────────────
@router.get("/layouts")
async def list_layouts(
    office_id: Optional[UUID] = Query(None),
    floor_id: Optional[UUID] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    stmt = select(OfficeLayout)
    if office_id is not None:
        stmt = stmt.where(OfficeLayout.office_id == office_id)
    if floor_id is not None:
        stmt = stmt.where(OfficeLayout.floor_id == floor_id)
    if status_filter is not None:
        try:
            status_enum = OfficeLayoutStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_status"
            )
        stmt = stmt.where(OfficeLayout.status == status_enum)
    rows = (
        await db.execute(
            stmt.order_by(
                OfficeLayout.office_id, OfficeLayout.floor_id, OfficeLayout.version.desc()
            )
        )
    ).scalars().all()
    return {"layouts": [_layout_out(r) for r in rows]}


@router.post("/layouts", status_code=status.HTTP_201_CREATED)
async def create_layout(
    payload: LayoutCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    # D12: draft 저장은 미검증(검증 게이트 없음) — 검증은 /layouts/validate·/deploy에서 수행.
    max_version = (
        await db.execute(
            select(func.max(OfficeLayout.version)).where(
                OfficeLayout.office_id == payload.office_id,
                OfficeLayout.floor_id == payload.floor_id,
            )
        )
    ).scalar()
    layout = OfficeLayout(
        office_id=payload.office_id,
        floor_id=payload.floor_id,
        version=(max_version or 0) + 1,
        status=OfficeLayoutStatus.DRAFT,
        json=payload.layout_json,
        created_by=current.user_id,
        deployment_notes=payload.deployment_notes,
    )
    db.add(layout)
    await db.commit()
    await db.refresh(layout)
    return _layout_out(layout)


# ── 현재 배포 레이아웃 ────────────────────────────────────
@router.get("/layouts/current")
async def get_current_layout(
    office_id: Optional[UUID] = Query(None),
    floor_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    stmt = select(OfficeLayout).where(OfficeLayout.status == OfficeLayoutStatus.DEPLOYED)
    if office_id is not None:
        stmt = stmt.where(OfficeLayout.office_id == office_id)
    if floor_id is not None:
        stmt = stmt.where(OfficeLayout.floor_id == floor_id)
    layout = (
        await db.execute(stmt.order_by(OfficeLayout.deployed_at.desc()))
    ).scalars().first()
    if layout is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no_deployed_layout"
        )
    out = _layout_out(layout)
    out["layout_json"] = out.pop("json")
    return out


# ── 검증 (저장 없음) ──────────────────────────────────────
@router.post("/layouts/validate")
async def validate_layout(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> JSONResponse:
    ctx = await build_context_from_db(db, payload)
    result = validate_office_layout(payload, ctx)
    data = result.as_dict()
    return JSONResponse(
        status_code=status.HTTP_200_OK if result.is_deployable else status.HTTP_400_BAD_REQUEST,
        content=data,
    )


# ── 개별 조회/수정 ────────────────────────────────────────
@router.get("/layouts/{layout_id}")
async def get_layout(
    layout_id: str,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    layout = await _get_layout_or_404(db, layout_id)
    return _layout_out(layout)


@router.put("/layouts/{layout_id}")
async def update_layout(
    layout_id: str,
    payload: LayoutUpdate,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    layout = await _get_layout_or_404(db, layout_id)
    if layout.status != OfficeLayoutStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="layout_not_draft"
        )
    layout.json = payload.layout_json
    if payload.deployment_notes is not None:
        layout.deployment_notes = payload.deployment_notes
    await db.commit()
    await db.refresh(layout)
    return _layout_out(layout)


# ── 배포/롤백 (admin) ─────────────────────────────────────
@router.post("/layouts/{layout_id}/deploy")
async def deploy_layout(
    layout_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> JSONResponse:
    layout = await _get_layout_or_404(db, layout_id)
    ctx = await build_context_from_db(db, layout.json)
    result = validate_office_layout(layout.json, ctx)
    if not result.is_deployable:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST, content=result.as_dict()
        )

    await _archive_current_deployed(db, layout.office_id, layout.floor_id)
    layout.status = OfficeLayoutStatus.DEPLOYED
    layout.deployed_at = datetime.now(timezone.utc)
    layout.validated_by = current.user_id
    record_audit(
        db,
        action="office_layout_deployed",
        entity_type="office_layout",
        entity_id=layout.id,
        user_id=current.user_id,
        new_value={
            "version": layout.version,
            "office_id": str(layout.office_id),
            "floor_id": str(layout.floor_id),
        },
        request=request,
    )
    await db.commit()
    await db.refresh(layout)
    return JSONResponse(status_code=status.HTTP_200_OK, content=_layout_out(layout))


@router.post("/layouts/{layout_id}/rollback")
async def rollback_layout(
    layout_id: str,
    request: Request,
    version: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    layout = await _get_layout_or_404(db, layout_id)
    target = (
        await db.execute(
            select(OfficeLayout).where(
                OfficeLayout.office_id == layout.office_id,
                OfficeLayout.floor_id == layout.floor_id,
                OfficeLayout.version == version,
            )
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="target_version_not_found"
        )

    await _archive_current_deployed(db, layout.office_id, layout.floor_id)
    target.status = OfficeLayoutStatus.DEPLOYED
    target.deployed_at = datetime.now(timezone.utc)
    target.validated_by = current.user_id
    record_audit(
        db,
        action="office_layout_deployed",
        entity_type="office_layout",
        entity_id=target.id,
        user_id=current.user_id,
        new_value={
            "version": target.version,
            "office_id": str(target.office_id),
            "floor_id": str(target.floor_id),
            "via": "rollback",
        },
        request=request,
    )
    await db.commit()
    await db.refresh(target)
    return _layout_out(target)


# ── 버전 이력 ─────────────────────────────────────────────
@router.get("/layouts/{layout_id}/history")
async def layout_history(
    layout_id: str,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    layout = await _get_layout_or_404(db, layout_id)
    rows = (
        await db.execute(
            select(OfficeLayout)
            .where(
                OfficeLayout.office_id == layout.office_id,
                OfficeLayout.floor_id == layout.floor_id,
            )
            .order_by(OfficeLayout.version.desc())
        )
    ).scalars().all()
    return {"versions": [_layout_out(r) for r in rows]}
