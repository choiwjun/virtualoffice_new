"""직원·팀·조직 디렉터리 조회 API (management-api.yaml: /teams, /org-groups).

- GET /api/teams       — erp_user.erp_team_id 집계(팀별 인원)
- GET /api/org-groups  — org_group 계층(본부/부서/파트)

단일 조직(company_id=1) 전제. 인증 필요(전 역할 조회 허용).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import ErpUser, OrgGroup, OrgGroupType

router = APIRouter(prefix="/api", tags=["directory"])

DEFAULT_COMPANY_ID = 1


# ── 스키마 ────────────────────────────────────────────────
class TeamMember(BaseModel):
    id: int
    name: str
    role: str
    position: Optional[str] = None


class TeamOut(BaseModel):
    team_id: int
    member_count: int
    leader: Optional[TeamMember] = None
    members: list[TeamMember]


class TeamListOut(BaseModel):
    items: list[TeamOut]
    total: int


class OrgGroupOut(BaseModel):
    id: str
    name: str
    type: str
    parent_id: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class OrgGroupListOut(BaseModel):
    items: list[OrgGroupOut]
    total: int


# ── 엔드포인트 ────────────────────────────────────────────
@router.get("/teams", response_model=TeamListOut)
async def list_teams(
    db=Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> TeamListOut:
    """팀 목록: 활성 erp_user를 erp_team_id로 집계. (전용 team 테이블 부재 → 파생)"""
    rows = (
        await db.execute(
            select(ErpUser)
            .where(ErpUser.company_id == DEFAULT_COMPANY_ID, ErpUser.is_active.is_(True))
            .order_by(ErpUser.erp_team_id, ErpUser.id)
        )
    ).scalars().all()

    teams: dict[int, list[ErpUser]] = {}
    for u in rows:
        teams.setdefault(u.erp_team_id, []).append(u)

    def _member(u: ErpUser) -> TeamMember:
        return TeamMember(id=u.id, name=u.name, role=u.role.value if hasattr(u.role, "value") else u.role, position=u.position)

    items: list[TeamOut] = []
    for team_id in sorted(teams.keys()):
        members = teams[team_id]
        leader = next((m for m in members if (m.role.value if hasattr(m.role, "value") else m.role) == "leader"), None)
        items.append(
            TeamOut(
                team_id=team_id,
                member_count=len(members),
                leader=_member(leader) if leader else None,
                members=[_member(m) for m in members],
            )
        )
    return TeamListOut(items=items, total=len(items))


@router.get("/org-groups", response_model=OrgGroupListOut)
async def list_org_groups(
    db=Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> OrgGroupListOut:
    """조직 그룹 계층(parent_id). 프론트에서 트리 구성."""
    rows = (
        await db.execute(select(OrgGroup).order_by(OrgGroup.sort_order, OrgGroup.name))
    ).scalars().all()
    items = [
        OrgGroupOut(
            id=str(g.id),
            name=g.name,
            type=g.type.value if hasattr(g.type, "value") else g.type,
            parent_id=str(g.parent_id) if g.parent_id else None,
            color=g.color,
            sort_order=g.sort_order,
        )
        for g in rows
    ]
    return OrgGroupListOut(items=items, total=len(items))


# ── org_group CRUD · 검증 · 배포 (관리자, REQ-011) ──────────────────────
import uuid as _uuid

_ADMIN = ("admin", "super_admin")


class OrgGroupCreate(BaseModel):
    name: str
    type: str = "department"
    parent_id: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class OrgGroupPatch(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    parent_id: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class OrgValidateOut(BaseModel):
    valid: bool
    errors: list[dict]
    warnings: list[dict]


async def _company_id(db) -> "_uuid.UUID":
    """기존 org_group의 company_id 재사용, 없으면 결정론적 기본값."""
    row = (await db.execute(select(OrgGroup).limit(1))).scalar_one_or_none()
    if row is not None:
        return row.company_id
    return _uuid.uuid5(_uuid.NAMESPACE_DNS, "virtualoffice-default-company")


def _org_type(v: str) -> OrgGroupType:
    try:
        return OrgGroupType(v)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_type")


@router.post("/org-groups", response_model=OrgGroupOut, status_code=status.HTTP_201_CREATED)
async def create_org_group(body: OrgGroupCreate, db=Depends(get_db), _: CurrentUser = Depends(require_role(*_ADMIN))) -> OrgGroupOut:
    parent = None
    if body.parent_id:
        try:
            parent = _uuid.UUID(body.parent_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_parent_id")
    g = OrgGroup(
        id=_uuid.uuid4(), company_id=await _company_id(db), name=body.name,
        type=_org_type(body.type), parent_id=parent, color=body.color, sort_order=body.sort_order,
    )
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return OrgGroupOut(id=str(g.id), name=g.name, type=g.type.value, parent_id=str(g.parent_id) if g.parent_id else None, color=g.color, sort_order=g.sort_order)


@router.put("/org-groups/{group_id}", response_model=OrgGroupOut)
async def update_org_group(group_id: str, body: OrgGroupPatch, db=Depends(get_db), _: CurrentUser = Depends(require_role(*_ADMIN))) -> OrgGroupOut:
    try:
        gid = _uuid.UUID(group_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_id")
    g = (await db.execute(select(OrgGroup).where(OrgGroup.id == gid))).scalar_one_or_none()
    if g is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="org_group_not_found")
    if body.name is not None:
        g.name = body.name
    if body.type is not None:
        g.type = _org_type(body.type)
    if body.parent_id is not None:
        if body.parent_id == "":
            g.parent_id = None
        else:
            try:
                pid = _uuid.UUID(body.parent_id)
            except ValueError:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_parent_id")
            if pid == gid:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="self_parent")
            g.parent_id = pid
    if body.color is not None:
        g.color = body.color
    if body.sort_order is not None:
        g.sort_order = body.sort_order
    await db.commit()
    await db.refresh(g)
    return OrgGroupOut(id=str(g.id), name=g.name, type=g.type.value, parent_id=str(g.parent_id) if g.parent_id else None, color=g.color, sort_order=g.sort_order)


@router.delete("/org-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org_group(group_id: str, db=Depends(get_db), _: CurrentUser = Depends(require_role(*_ADMIN))) -> None:
    try:
        gid = _uuid.UUID(group_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_id")
    g = (await db.execute(select(OrgGroup).where(OrgGroup.id == gid))).scalar_one_or_none()
    if g is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="org_group_not_found")
    children = (await db.execute(select(OrgGroup).where(OrgGroup.parent_id == gid))).scalars().all()
    if children:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="has_children")
    await db.delete(g)
    await db.commit()


async def _validate_org(db) -> OrgValidateOut:
    groups = (await db.execute(select(OrgGroup))).scalars().all()
    by_id = {g.id: g for g in groups}
    errors: list[dict] = []
    warnings: list[dict] = []
    # 순환참조 검사
    for g in groups:
        seen = set()
        cur = g
        while cur is not None and cur.parent_id is not None:
            if cur.parent_id in seen or cur.parent_id == g.id:
                errors.append({"code": "CYCLE", "group": g.name, "message": f"순환참조: {g.name}"})
                break
            seen.add(cur.parent_id)
            cur = by_id.get(cur.parent_id)
    # 미매핑 부모 검사
    for g in groups:
        if g.parent_id is not None and g.parent_id not in by_id:
            errors.append({"code": "ORPHAN_PARENT", "group": g.name, "message": f"부모 미존재: {g.name}"})
    # 미매핑 팀(경고): erp_team_id가 org_group에 매핑되지 않은 활성 사용자 팀
    return OrgValidateOut(valid=len(errors) == 0, errors=errors, warnings=warnings)


@router.post("/org-groups/validate", response_model=OrgValidateOut)
async def validate_org_groups(db=Depends(get_db), _: CurrentUser = Depends(require_role(*_ADMIN))) -> OrgValidateOut:
    return await _validate_org(db)


@router.post("/org-groups/deploy", response_model=OrgValidateOut)
async def deploy_org_groups(db=Depends(get_db), _: CurrentUser = Depends(require_role(*_ADMIN))) -> OrgValidateOut:
    """검증 통과 시 배포(현재는 검증 게이트만; ERROR 존재 시 409)."""
    result = await _validate_org(db)
    if not result.valid:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="validation_failed")
    return result
