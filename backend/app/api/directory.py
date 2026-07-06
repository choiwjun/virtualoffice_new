"""직원·팀·조직 디렉터리 조회 API (management-api.yaml: /teams, /org-groups).

- GET /api/teams       — erp_user.erp_team_id 집계(팀별 인원)
- GET /api/org-groups  — org_group 계층(본부/부서/파트)

단일 조직(company_id=1) 전제. 인증 필요(전 역할 조회 허용).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import ErpUser, OrgGroup

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
