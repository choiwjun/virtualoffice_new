"""
조직 그룹(OrgGroup) 관리 API — 로컬 관리 계층형 조직도.

ERP는 계층이 없는 flat teams만 제공한다(app/erp/reader.py `fetch_teams` → ErpTeamDTO:
id/company_id/name/color/leader_name, department/division DTO 없음). 본부/부서/파트 3단
계층은 ERP에 존재하지 않으므로 이 API가 로컬로 CRUD 관리하는 정본이다. 여기서 말하는
"ERP 동기화"는 계층 동기화가 아니라 "ERP team마다 리프(PART) org_group이 최소 하나
존재함을 보장"하는 것으로 정의한다(POST /org-groups/sync-teams, idempotent).

- POST   /org-groups              생성 (admin)
- GET    /org-groups/tree         전체 계층 트리 조회 (인증 사용자 누구나)
- PUT    /org-groups/{id}         수정 (admin)
- DELETE /org-groups/{id}         삭제 (admin) — 자식은 FK ondelete=SET NULL로 자동 루트화
- POST   /org-groups/sync-teams   ERP team별 리프(PART) org_group 보장 (admin, idempotent)

GET /org-groups(목록)는 이미 erp.py가 /api/org-groups로 제공한다(중복 방지). 이 라우터는
prefix가 달라(/org-groups, /api 없음) 경로가 겹치지 않는다.

company_id 정합성: OrgGroup.company_id는 모델상 UUID인 반면 ErpUser.company_id/erp.py의
DEFAULT_COMPANY_ID는 int(1) — 기존에 이미 존재하는 불일치이며 이 스토리에서 새로 만든
것은 아니다. 단일 조직(company_id=1) 전제와 정합되도록, 요청 바디에 company_id가
없으면 고정 상수 DEFAULT_COMPANY_UUID(namespace uuid5)를 기본값으로 사용한다. 필요 시
호출자가 body.company_id로 명시적인 UUID를 지정할 수 있다.

@TASK P2-R1-T3 - org_group 계층 CRUD + ERP team 리프 동기화
@SPEC docs/planning/04-data-model.md §2.2
"""

from typing import AsyncGenerator, Optional
from uuid import NAMESPACE_DNS, UUID, uuid4, uuid5

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.erp.reader import ErpReader, get_erp_reader
from app.models.tables import OrgGroup, OrgGroupType

router = APIRouter(prefix="/org-groups", tags=["org-groups"])

# 단일 조직 전제(erp.py DEFAULT_COMPANY_ID=1과 동일 전제) 하의 고정 기본 company_id.
# OrgGroup.company_id가 UUID 컬럼이라 int(1)을 그대로 쓸 수 없어 uuid5로 결정론적으로 파생한다.
DEFAULT_COMPANY_UUID = uuid5(NAMESPACE_DNS, "vituraloffice.default-company")

# erp.py의 DEFAULT_COMPANY_ID(=1)와 동일한 전제. 순환 임포트를 피하기 위해 리터럴로 중복 정의한다.
DEFAULT_ERP_COMPANY_ID = 1


async def get_reader() -> AsyncGenerator[ErpReader, None]:
    reader = get_erp_reader()
    try:
        yield reader
    finally:
        await reader.aclose()


# ── 스키마 ────────────────────────────────────────────────
class OrgGroupCreate(BaseModel):
    name: str
    type: str
    parent_id: Optional[UUID] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None
    company_id: Optional[UUID] = None


class OrgGroupUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    parent_id: Optional[UUID] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class OrgGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    company_id: UUID
    name: str
    type: str
    parent_id: Optional[UUID] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class SyncTeamsResultOut(BaseModel):
    created: int
    existing: int


def _org_group_out(row: OrgGroup) -> dict:
    return OrgGroupOut.model_validate(row).model_dump(mode="json")


def _parse_type(value: str) -> OrgGroupType:
    try:
        return OrgGroupType(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_org_group_type"
        )


async def _get_or_404(db, org_group_id: UUID) -> OrgGroup:
    row = await db.get(OrgGroup, org_group_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="org_group_not_found"
        )
    return row


# ── 생성 ──────────────────────────────────────────────────
@router.post("", status_code=status.HTTP_201_CREATED)
async def create_org_group(
    body: OrgGroupCreate,
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    org_type = _parse_type(body.type)
    if body.parent_id is not None:
        await _get_or_404(db, body.parent_id)
    row = OrgGroup(
        id=uuid4(),
        company_id=body.company_id or DEFAULT_COMPANY_UUID,
        name=body.name,
        type=org_type,
        parent_id=body.parent_id,
        color=body.color,
        sort_order=body.sort_order,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _org_group_out(row)


# ── 트리 조회 ─────────────────────────────────────────────
@router.get("/tree")
async def get_org_group_tree(
    db=Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    rows = (
        await db.execute(select(OrgGroup).order_by(OrgGroup.sort_order, OrgGroup.name))
    ).scalars().all()
    by_id = {r.id: {**_org_group_out(r), "children": []} for r in rows}
    roots = []
    for r in rows:
        node = by_id[r.id]
        if r.parent_id is not None and r.parent_id in by_id:
            by_id[r.parent_id]["children"].append(node)
        else:
            roots.append(node)
    return {"items": roots}


# ── 수정 ──────────────────────────────────────────────────
@router.put("/{org_group_id}")
async def update_org_group(
    org_group_id: UUID,
    body: OrgGroupUpdate,
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    row = await _get_or_404(db, org_group_id)
    if body.parent_id is not None:
        if body.parent_id == org_group_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="self_parent_not_allowed"
            )
        parent = await _get_or_404(db, body.parent_id)
        # 자손-사이클 방지: 새 parent가 org_group_id의 자손이면 거부(순환 계층 방지).
        all_rows = (await db.execute(select(OrgGroup))).scalars().all()
        by_id = {r.id: r for r in all_rows}
        cursor: Optional[OrgGroup] = parent
        while cursor is not None and cursor.parent_id is not None:
            if cursor.parent_id == org_group_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="descendant_cycle_not_allowed",
                )
            cursor = by_id.get(cursor.parent_id)
        row.parent_id = body.parent_id
    if body.name is not None:
        row.name = body.name
    if body.type is not None:
        row.type = _parse_type(body.type)
    if body.color is not None:
        row.color = body.color
    if body.sort_order is not None:
        row.sort_order = body.sort_order
    await db.commit()
    await db.refresh(row)
    return _org_group_out(row)


# ── 삭제 ──────────────────────────────────────────────────
@router.delete("/{org_group_id}")
async def delete_org_group(
    org_group_id: UUID,
    db=Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    row = await _get_or_404(db, org_group_id)
    # 자식의 parent_id는 FK ondelete=SET NULL로 DB가 자동으로 NULL화한다(자식은 루트로 승격,
    # 데이터 손실 없음). team_zone.org_group_id는 ondelete=RESTRICT이므로 매핑된 team_zone이
    # 있으면 IntegrityError → 409(운영 Postgres에서 미처리 500 방지, architect HIGH).
    await db.delete(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="org_group_in_use"
        )
    return {"deleted": True}


# ── ERP team 리프 동기화 (honest sync) ───────────────────
@router.post("/sync-teams", response_model=SyncTeamsResultOut)
async def sync_teams(
    db=Depends(get_db),
    reader: ErpReader = Depends(get_reader),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> SyncTeamsResultOut:
    """ERP team마다 리프(PART) org_group이 존재함을 보장한다(idempotent).

    ERP에는 계층이 없으므로 "동기화"는 계층 생성이 아니라 팀명을 가진 PART 타입
    org_group의 존재를 보장하는 것으로 정의한다. 매칭 키는 (type=PART, name=team.name)
    — 이미 존재하면 스킵(existing 카운트), 없으면 루트 PART로 생성(created 카운트).
    """
    teams = await reader.fetch_teams(DEFAULT_ERP_COMPANY_ID)
    existing_rows = (
        await db.execute(select(OrgGroup).where(OrgGroup.type == OrgGroupType.PART))
    ).scalars().all()
    existing_names = {r.name for r in existing_rows}
    created = 0
    existing = 0
    for team in teams:
        if team.name in existing_names:
            existing += 1
            continue
        db.add(
            OrgGroup(
                id=uuid4(),
                company_id=DEFAULT_COMPANY_UUID,
                name=team.name,
                type=OrgGroupType.PART,
                color=team.color,
            )
        )
        existing_names.add(team.name)
        created += 1
    await db.commit()
    return SyncTeamsResultOut(created=created, existing=existing)
