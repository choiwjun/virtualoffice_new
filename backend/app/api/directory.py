"""직원·팀·조직 디렉터리 조회 API (management-api.yaml: /teams, /org-groups).

- GET /api/teams       — erp_user.erp_team_id 집계(팀별 인원)
- GET /api/org-groups  — org_group 계층(본부/부서/파트) + CRUD·검증·배포(admin)

테넌트 스코프(Phase 1d · 22 T0-1): 모든 조회·변조가 호출자의 company_id에 갇힌다.
이전에는 `DEFAULT_COMPANY_ID = 1` 하드코딩이라 신규 회사가 1번 회사의 팀·조직도를 봤고,
org_group 단건 수정/삭제에는 소유 검사가 아예 없었다.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.deps import (
    ADMIN_ROLES,
    CurrentUser,
    assert_same_company,
    company_scope,
    get_current_user,
    require_role,
)
from app.db import get_db
from app.models.tables import ErpUser, OrgGroup, OrgGroupType

router = APIRouter(prefix="/api", tags=["directory"])


# ── 스키마 ────────────────────────────────────────────────
class TeamMember(BaseModel):
    id: int
    name: str
    role: str
    position: Optional[str] = None


class TeamOut(BaseModel):
    team_id: int
    name: Optional[str] = None
    """org_group에 연결된 이름. 아직 안 이었으면 None — 화면이 "팀 12"로 폴백한다.

    빈 문자열이나 "팀 12"를 서버가 지어내지 않는다. 그러면 화면이 "이름이 없다"와
    "이름이 정말 그렇다"를 구별하지 못해 연결 안내를 띄울 수 없다.
    """
    color: Optional[str] = None
    org_group_id: Optional[str] = None
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
    erp_team_id: Optional[int] = None
    """이 그룹이 대표하는 ERP 팀. NULL = 팀이 아닌 계층(본부·파트 등)."""


class OrgGroupListOut(BaseModel):
    items: list[OrgGroupOut]
    total: int


# ── 엔드포인트 ────────────────────────────────────────────
@router.get("/teams", response_model=TeamListOut)
async def list_teams(
    db=Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
    cid: int = Depends(company_scope),
) -> TeamListOut:
    """팀 목록: 활성 erp_user를 erp_team_id로 집계 + org_group에서 이름을 얹는다.

    인원은 erp_user가, 이름·색은 org_group이 정본이다. 팀 자체가 별도 테이블이 아니라
    "같은 erp_team_id를 가진 사람들"이므로, 사람이 하나도 없는 팀은 목록에 없다 —
    조직도에 이름만 이어 두고 아직 아무도 배정하지 않은 그룹은 팀으로 뜨지 않는다.
    """
    rows = (
        await db.execute(
            select(ErpUser)
            .where(ErpUser.company_id == cid, ErpUser.is_active.is_(True))
            .order_by(ErpUser.erp_team_id, ErpUser.id)
        )
    ).scalars().all()

    groups = (
        await db.execute(
            select(OrgGroup).where(
                OrgGroup.company_id == cid, OrgGroup.erp_team_id.is_not(None)
            )
        )
    ).scalars().all()
    by_team = {g.erp_team_id: g for g in groups}

    teams: dict[int, list[ErpUser]] = {}
    for u in rows:
        teams.setdefault(u.erp_team_id, []).append(u)

    def _member(u: ErpUser) -> TeamMember:
        return TeamMember(id=u.id, name=u.name, role=u.role.value if hasattr(u.role, "value") else u.role, position=u.position)

    items: list[TeamOut] = []
    for team_id in sorted(teams.keys()):
        members = teams[team_id]
        leader = next((m for m in members if (m.role.value if hasattr(m.role, "value") else m.role) == "leader"), None)
        g = by_team.get(team_id)
        items.append(
            TeamOut(
                team_id=team_id,
                name=g.name if g else None,
                color=g.color if g else None,
                org_group_id=str(g.id) if g else None,
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
    cid: int = Depends(company_scope),
) -> OrgGroupListOut:
    """조직 그룹 계층(parent_id). 프론트에서 트리 구성."""
    rows = (
        await db.execute(
            select(OrgGroup)
            .where(OrgGroup.company_id == cid)
            .order_by(OrgGroup.sort_order, OrgGroup.name)
        )
    ).scalars().all()
    items = [_group_out(g) for g in rows]
    return OrgGroupListOut(items=items, total=len(items))


# ── org_group CRUD · 검증 · 배포 (관리자, REQ-011) ──────────────────────
import uuid as _uuid  # noqa: E402

_ADMIN = ADMIN_ROLES  # deps 단일 정의 (qa#17)


class OrgGroupCreate(BaseModel):
    name: str
    type: str = "department"
    parent_id: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None
    erp_team_id: Optional[int] = None


class OrgGroupPatch(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    parent_id: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None
    erp_team_id: Optional[int] = None
    """연결 해제는 -1을 보낸다.

    None은 "이 필드를 안 건드림"이라 해제와 구별되지 않는다(다른 필드도 같은 규약).
    음수 팀 번호는 존재하지 않으므로 센티넬로 안전하다.
    """


def _group_out(g: OrgGroup) -> OrgGroupOut:
    return OrgGroupOut(
        id=str(g.id),
        name=g.name,
        type=g.type.value if hasattr(g.type, "value") else g.type,
        parent_id=str(g.parent_id) if g.parent_id else None,
        color=g.color,
        sort_order=g.sort_order,
        erp_team_id=g.erp_team_id,
    )


def _team_field(raw: Optional[int]) -> Optional[int]:
    """요청의 erp_team_id를 저장값으로 바꾼다. 음수(-1) = 연결 해제 → None.

    0은 거부한다 — E3 유저 생성이 "팀 미배정"에 쓰는 센티널이라(직원명부도 0을 "미배정"으로
    읽는다) 그룹이 0을 맡으면 소속 없는 사람 전원이 그 그룹 이름으로 뭉쳐 보인다.
    """
    if raw is None or raw < 0:
        return None
    if raw == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "team_zero_reserved",
                    "message": "팀 0은 '미배정' 센티널입니다. 1 이상을 쓰세요."},
        )
    return raw


async def _assert_team_free(db, cid: int, team_id: Optional[int], exclude_id=None) -> None:
    """같은 회사에서 그 팀을 이미 쓰는 그룹이 있으면 409.

    DB 유니크가 최종 방어선이지만 거기서 터지면 IntegrityError가 500으로 나간다.
    관리자에게는 "이미 ○○이 쓰고 있다"가 필요하다 — 어느 그룹인지까지 돌려준다.
    """
    if team_id is None:
        return
    stmt = select(OrgGroup).where(
        OrgGroup.company_id == cid, OrgGroup.erp_team_id == team_id
    )
    if exclude_id is not None:
        stmt = stmt.where(OrgGroup.id != exclude_id)
    other = (await db.execute(stmt)).scalars().first()
    if other is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "team_already_mapped", "group_name": other.name},
        )


class OrgValidateOut(BaseModel):
    valid: bool
    errors: list[dict]
    warnings: list[dict]


def _org_type(v: str) -> OrgGroupType:
    try:
        return OrgGroupType(v)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_type")


async def _load_scoped_group(db, user: CurrentUser, group_id: str) -> OrgGroup:
    """단건 로드 + 테넌트 검사. 타사/미존재는 동일하게 404(존재 은닉, 22 T0-1)."""
    try:
        gid = _uuid.UUID(group_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_id")
    g = (await db.execute(select(OrgGroup).where(OrgGroup.id == gid))).scalar_one_or_none()
    if g is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="org_group_not_found")
    assert_same_company(user, g.company_id)  # 변조 전에 검사
    return g


@router.post("/org-groups", response_model=OrgGroupOut, status_code=status.HTTP_201_CREATED)
async def create_org_group(
    body: OrgGroupCreate,
    db=Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
    cid: int = Depends(company_scope),
) -> OrgGroupOut:
    parent = None
    if body.parent_id:
        try:
            parent = _uuid.UUID(body.parent_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_parent_id")
        # 타사 그룹을 부모로 지정하면 조직도가 테넌트를 가로질러 이어진다.
        await _load_scoped_group(db, user, str(parent))
    team_id = _team_field(body.erp_team_id)
    await _assert_team_free(db, cid, team_id)
    g = OrgGroup(
        id=_uuid.uuid4(), company_id=cid, name=body.name,
        type=_org_type(body.type), parent_id=parent, color=body.color, sort_order=body.sort_order,
        erp_team_id=team_id,
    )
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return _group_out(g)


@router.put("/org-groups/{group_id}", response_model=OrgGroupOut)
async def update_org_group(
    group_id: str,
    body: OrgGroupPatch,
    db=Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
) -> OrgGroupOut:
    g = await _load_scoped_group(db, user, group_id)
    gid = g.id
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
            await _load_scoped_group(db, user, str(pid))  # 타사 그룹을 부모로 붙이지 못하게
            g.parent_id = pid
    if body.color is not None:
        g.color = body.color
    if body.sort_order is not None:
        g.sort_order = body.sort_order
    if body.erp_team_id is not None:
        team_id = _team_field(body.erp_team_id)
        await _assert_team_free(db, g.company_id, team_id, exclude_id=gid)
        g.erp_team_id = team_id
    await db.commit()
    await db.refresh(g)
    return _group_out(g)


@router.delete("/org-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org_group(
    group_id: str,
    db=Depends(get_db),
    user: CurrentUser = Depends(require_role(*_ADMIN)),
) -> None:
    g = await _load_scoped_group(db, user, group_id)
    children = (await db.execute(select(OrgGroup).where(OrgGroup.parent_id == g.id))).scalars().all()
    if children:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="has_children")
    await db.delete(g)
    await db.commit()


async def _validate_org(db, cid: int) -> OrgValidateOut:
    """자기 회사 조직도만 검증한다 — 전역 조회면 타사 순환/고아가 내 배포를 막는다."""
    groups = (await db.execute(select(OrgGroup).where(OrgGroup.company_id == cid))).scalars().all()
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
    # 미매핑 팀(경고): 사람은 있는데 이름을 이어 준 그룹이 없는 팀.
    # 오류가 아니라 경고다 — 이름 없이도 제품은 돌아간다(화면이 "팀 12"로 폴백). 다만
    # 그 숫자가 사용자에게 그대로 보이므로 관리자가 알고는 있어야 한다.
    mapped = {g.erp_team_id for g in groups if g.erp_team_id is not None}
    used = set(
        (
            await db.execute(
                select(ErpUser.erp_team_id)
                .where(
                    ErpUser.company_id == cid,
                    ErpUser.is_active.is_(True),
                    ErpUser.erp_team_id != 0,  # 0 = 미배정 센티널, 이름 붙일 팀이 아니다
                )
                .distinct()
            )
        ).scalars().all()
    )
    for team_id in sorted(used - mapped):
        warnings.append({
            "code": "UNMAPPED_TEAM",
            "team_id": team_id,
            "message": f"팀 {team_id}에 연결된 조직 그룹이 없습니다 — 화면에 \"팀 {team_id}\"로 표시됩니다.",
        })
    return OrgValidateOut(valid=len(errors) == 0, errors=errors, warnings=warnings)


@router.post("/org-groups/validate", response_model=OrgValidateOut)
async def validate_org_groups(
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role(*_ADMIN)),
    cid: int = Depends(company_scope),
) -> OrgValidateOut:
    return await _validate_org(db, cid)


@router.post("/org-groups/deploy", response_model=OrgValidateOut)
async def deploy_org_groups(
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role(*_ADMIN)),
    cid: int = Depends(company_scope),
) -> OrgValidateOut:
    """검증 통과 시 배포(현재는 검증 게이트만; ERROR 존재 시 409)."""
    result = await _validate_org(db, cid)
    if not result.valid:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="validation_failed")
    return result
