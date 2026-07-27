"""직원(유저) 디렉터리 + admin 직접 관리 API — E3 (24-spec Phase 3 · 23 E3/E12).

- GET    /api/employees              직원 목록 (자기 회사, 전 역할 조회)
- GET    /api/employees/{id}         직원 단건 (자기 회사 — 타사는 404 존재 은닉)
- POST   /api/employees              유저 직접 생성 (admin, source='native')
- PATCH  /api/employees/{id}         역할·팀·직책·근무형태·이름 수정 (admin)
- DELETE /api/employees/{id}         비활성 (admin, soft — 물리삭제 금지 D18)
- POST   /api/employees/{id}/activate 재활성 (admin)

## 이중 경로 (23 E12)
- **ERP有**: `POST /api/erp/sync`가 정본. 동기화된 유저는 `source='erp'`, ERP가 덮어쓴다.
- **ERP無**: admin이 여기서 직접 생성. `source='native'` — ERP 전체 대사가 건드리지 않는다.

## 스코프 (22 T0-1)
모든 경로가 `company_scope` 의존성으로 호출자의 회사에 갇힌다. 생성 시 company_id는
서버가 주입한다(클라 입력 금지 — 위조 방지). 타사 유저 단건 조회/변조는 404.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, constr, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    ADMIN_ROLES,
    CurrentUser,
    assert_same_company,
    company_scope,
    get_current_user,
    require_role,
)
from app.core.security import hash_password
from app.core.users import (
    UNASSIGNED_TEAM_ID,
    next_native_user_id,
    normalize_email,
)
from app.db import get_db
from app.models.tables import (
    USER_SOURCE_ERP,
    USER_SOURCE_NATIVE,
    AuthTokenPurpose,
    Company,
    ErpRole,
    ErpUser,
    Presence,
    Seat,
)
from app.services.audit import record_audit
from app.services.tokens import issue_token, revoke_pending_for_user, set_password_url

router = APIRouter(prefix="/api", tags=["employees"])

# 회사 잠금 방지: 마지막 활성 관리자는 강등·비활성 불가 (24-spec Phase 3 §마이그레이션 주의).
_ADMIN_ROLE_VALUES = (ErpRole.ADMIN, ErpRole.SUPER_ADMIN)


# ── 스키마 ────────────────────────────────────────────────
class EmployeeOut(BaseModel):
    id: int
    email: str
    name: str
    erp_team_id: int
    role: str
    position: Optional[str] = None
    position_id: Optional[int] = None
    manager_id: Optional[int] = None
    work_type: Optional[str] = None
    is_active: bool
    source: str = USER_SOURCE_ERP
    """'erp' = ERP 동기화 정본(콘솔 편집은 다음 동기화에 덮어써짐) / 'native' = 직접 관리."""
    has_login: bool = False
    """비밀번호가 설정돼 실제 로그인 가능한 계정인지 (초대 전 native 유저는 false)."""
    presence_status: Optional[str] = None
    seat_number: Optional[str] = None


class EmployeeCreate(BaseModel):
    email: str
    name: constr(strip_whitespace=True, min_length=1, max_length=255)
    role: str = ErpRole.EMPLOYEE.value
    erp_team_id: int = UNASSIGNED_TEAM_ID
    position: Optional[constr(strip_whitespace=True, max_length=255)] = None
    work_type: Optional[constr(strip_whitespace=True, max_length=50)] = None
    initial_password: Optional[constr(min_length=8, max_length=128)] = None
    """지정 시 즉시 로그인 가능. 생략하면 디렉터리에만 등재(로그인 불가) —
    이메일 초대(E4)로 본인이 비번을 설정하는 경로를 남긴다."""

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        return normalize_email(v)


class EmployeePatch(BaseModel):
    name: Optional[constr(strip_whitespace=True, min_length=1, max_length=255)] = None
    role: Optional[str] = None
    erp_team_id: Optional[int] = None
    position: Optional[constr(strip_whitespace=True, max_length=255)] = None
    work_type: Optional[constr(strip_whitespace=True, max_length=50)] = None
    # email은 로그인 키 → 변경 경로는 계정 설정/검증 흐름(Phase 6)에서 다룬다.


# ── 내부 헬퍼 ─────────────────────────────────────────────
def _s(v) -> Optional[str]:
    return v.value if hasattr(v, "value") else v


def _out(row: ErpUser, *, presence: Optional[str] = None, seat: Optional[str] = None) -> EmployeeOut:
    return EmployeeOut(
        id=row.id, email=row.email, name=row.name, erp_team_id=row.erp_team_id,
        role=_s(row.role), position=row.position, position_id=row.position_id,
        manager_id=row.manager_id, work_type=_s(row.work_type), is_active=row.is_active,
        source=row.source or USER_SOURCE_ERP, has_login=row.password_hash is not None,
        presence_status=presence, seat_number=seat,
    )


def _parse_role(raw: str) -> ErpRole:
    try:
        return ErpRole(raw)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_role")


def _assert_can_assign_role(actor: CurrentUser, role: ErpRole) -> None:
    """권한 상승 차단: super_admin 부여는 super_admin만. (admin이 자기보다 높은 권한을
    만들어 회사 최상위를 탈취하는 경로를 막는다.)"""
    if role == ErpRole.SUPER_ADMIN and actor.role != ErpRole.SUPER_ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="cannot_grant_super_admin"
        )


async def _load_scoped(db: AsyncSession, user: CurrentUser, employee_id: int) -> ErpUser:
    """단건 로드 + 테넌트 검사. 타사/미존재는 동일하게 404(존재 은닉, 22 T0-1)."""
    row = (
        await db.execute(select(ErpUser).where(ErpUser.id == employee_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="employee_not_found")
    assert_same_company(user, row.company_id)  # 변조 전에 검사 (권한 경계 우선)
    return row


async def _active_admin_count(db: AsyncSession, cid: int, *, exclude_user_id: Optional[int] = None) -> int:
    stmt = (
        select(func.count())
        .select_from(ErpUser)
        .where(
            ErpUser.company_id == cid,
            ErpUser.is_active.is_(True),
            ErpUser.role.in_(_ADMIN_ROLE_VALUES),
        )
    )
    if exclude_user_id is not None:
        stmt = stmt.where(ErpUser.id != exclude_user_id)
    return (await db.execute(stmt)).scalar_one()


async def _assert_not_last_admin(db: AsyncSession, row: ErpUser, cid: int) -> None:
    """대상이 현재 활성 관리자라면, 그를 뺀 활성 관리자가 최소 1명 남아야 한다."""
    if not row.is_active or row.role not in _ADMIN_ROLE_VALUES:
        return
    if await _active_admin_count(db, cid, exclude_user_id=row.id) == 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="last_admin")


async def _assert_seat_capacity(db: AsyncSession, cid: int) -> None:
    """company.seat_limit 게이트 (24-spec Phase 2/3). NULL=무제한 → 기존 회사 무영향."""
    company = (
        await db.execute(select(Company).where(Company.id == cid))
    ).scalar_one_or_none()
    if company is None or company.seat_limit is None:
        return
    active = (
        await db.execute(
            select(func.count())
            .select_from(ErpUser)
            .where(ErpUser.company_id == cid, ErpUser.is_active.is_(True))
        )
    ).scalar_one()
    if active >= company.seat_limit:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="seat_limit_exceeded")


async def _enrich(db: AsyncSession, rows: list[ErpUser]) -> list[EmployeeOut]:
    """목록 응답에 presence.status·seat.seat_number 조인."""
    ids = [r.id for r in rows]
    presence_map: dict[int, str] = {}
    seat_map: dict[int, Optional[str]] = {}
    if ids:
        for p in (await db.execute(select(Presence).where(Presence.user_id.in_(ids)))).scalars().all():
            presence_map[p.user_id] = _s(p.status)
        for s in (await db.execute(select(Seat).where(Seat.assigned_user_id.in_(ids)))).scalars().all():
            if s.assigned_user_id is not None:
                seat_map[s.assigned_user_id] = s.seat_number
    return [_out(r, presence=presence_map.get(r.id), seat=seat_map.get(r.id)) for r in rows]


# ── 조회 ──────────────────────────────────────────────────
@router.get("/employees", response_model=list[EmployeeOut])
async def list_employees(
    include_inactive: bool = Query(False, description="비활성 직원 포함 (관리자만 유효)"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[EmployeeOut]:
    """자기 회사 직원 목록. 기본은 활성만 — 비활성 포함은 관리 화면(admin) 전용."""
    stmt = select(ErpUser).where(ErpUser.company_id == user.company_id)
    if not (include_inactive and user.role in ADMIN_ROLES):
        stmt = stmt.where(ErpUser.is_active.is_(True))
    rows = (await db.execute(stmt.order_by(ErpUser.id))).scalars().all()
    return await _enrich(db, list(rows))


@router.get("/employees/{employee_id}", response_model=EmployeeOut)
async def get_employee(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> EmployeeOut:
    return _out(await _load_scoped(db, user, employee_id))


# ── 직접 관리 (admin, ERP無 경로) ─────────────────────────
@router.post("/employees", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
async def create_employee(
    body: EmployeeCreate,
    db: AsyncSession = Depends(get_db),
    actor: CurrentUser = Depends(require_role(*ADMIN_ROLES)),
    cid: int = Depends(company_scope),
) -> EmployeeOut:
    """유저 직접 생성 (source='native'). ERP 없는 회사가 팀을 채우는 경로 (23 E3).

    - company_id·id·source는 서버가 강제 (클라 입력 금지).
    - 이메일은 전 테넌트 유일 — 로그인이 email로 조회하므로(auth.login) 회사별 중복 불가.
    - initial_password 생략 시 password_hash=None → 디렉터리 등재만(로그인 불가, 초대 대기).
    """
    role = _parse_role(body.role)
    _assert_can_assign_role(actor, role)
    await _assert_seat_capacity(db, cid)

    dup = await db.execute(select(ErpUser.id).where(ErpUser.email == body.email))
    if dup.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email_taken")

    row = ErpUser(
        id=await next_native_user_id(db),
        company_id=cid,
        email=body.email,
        name=body.name,
        erp_team_id=body.erp_team_id,
        role=role,
        position=body.position,
        work_type=body.work_type,
        password_hash=hash_password(body.initial_password) if body.initial_password else None,
        is_active=True,
        source=USER_SOURCE_NATIVE,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    await record_audit(
        db, company_id=cid, user_id=actor.user_id, action="user_created", entity_type="erp_user",
        entity_id=str(row.id),
        new_value={"email": row.email, "role": _s(row.role), "company_id": cid},
    )
    return _out(row)


@router.patch("/employees/{employee_id}", response_model=EmployeeOut)
async def update_employee(
    employee_id: int,
    body: EmployeePatch,
    db: AsyncSession = Depends(get_db),
    actor: CurrentUser = Depends(require_role(*ADMIN_ROLES)),
    cid: int = Depends(company_scope),
) -> EmployeeOut:
    """역할·팀·직책·근무형태·이름 수정.

    source='erp' 유저도 수정 가능하지만 ERP 필드는 다음 동기화가 정본으로 덮어쓴다
    (23 E12 — UI가 "ERP에서 관리됨"으로 안내). 마지막 관리자 강등은 409.
    """
    row = await _load_scoped(db, actor, employee_id)
    old = {"role": _s(row.role), "erp_team_id": row.erp_team_id, "is_active": row.is_active}

    if body.role is not None:
        new_role = _parse_role(body.role)
        _assert_can_assign_role(actor, new_role)
        if new_role not in _ADMIN_ROLE_VALUES:
            await _assert_not_last_admin(db, row, cid)  # 강등으로 회사가 잠기는 것 방지
        row.role = new_role
    if body.name is not None:
        row.name = body.name
    if body.erp_team_id is not None:
        row.erp_team_id = body.erp_team_id
    if body.position is not None:
        row.position = body.position or None
    if body.work_type is not None:
        row.work_type = body.work_type or None

    await db.commit()
    await db.refresh(row)
    await record_audit(
        db, company_id=cid, user_id=actor.user_id, action="user_updated", entity_type="erp_user",
        entity_id=str(row.id), old_value=old,
        new_value={"role": _s(row.role), "erp_team_id": row.erp_team_id},
    )
    return _out(row)


@router.delete("/employees/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_employee(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    actor: CurrentUser = Depends(require_role(*ADMIN_ROLES)),
    cid: int = Depends(company_scope),
) -> None:
    """비활성 (soft). 물리 삭제 금지 — 평가·감사 기록 영구성(D18).

    본인 계정 비활성(자기 발등 찍기)과 마지막 관리자 비활성(회사 잠금)은 차단.
    """
    row = await _load_scoped(db, actor, employee_id)
    if row.id == actor.user_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="cannot_deactivate_self")
    await _assert_not_last_admin(db, row, cid)

    if row.is_active:
        row.is_active = False
        await db.commit()
        await record_audit(
            db, company_id=cid, user_id=actor.user_id, action="user_deactivated", entity_type="erp_user",
            entity_id=str(row.id), old_value={"is_active": True}, new_value={"is_active": False},
        )


class AccessLinkOut(BaseModel):
    """발급된 1회용 링크. `url`은 이 응답에서만 볼 수 있다(서버는 해시만 보관)."""
    url: str
    purpose: str
    expires_at: str
    employee_id: int
    employee_name: str
    employee_email: str


@router.post("/employees/{employee_id}/access-link", response_model=AccessLinkOut, status_code=status.HTTP_201_CREATED)
async def issue_access_link(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    actor: CurrentUser = Depends(require_role(*ADMIN_ROLES)),
    cid: int = Depends(company_scope),
) -> AccessLinkOut:
    """비밀번호 설정 링크 발급 (E4 — 초대 / 재설정 공용).

    메일 발송 없이 링크를 관리자에게 돌려준다. 관리자가 쓰던 채널(슬랙·카카오워크 등)로
    전달하면 된다 — 메일 인프라(SPF/DKIM·스팸함·바운스) 없이 "관리자가 남의 비밀번호를
    아는" 문제를 없앤다. 메일 발송은 나중에 이 위에 얹는다.

    - 아직 로그인해 본 적 없는 계정(`password_hash` 없음) → 초대(7일)
    - 이미 쓰던 계정 → 재설정(24시간)
    발급하면 그 유저의 이전 링크는 즉시 무효가 된다(항상 1개만 유효).
    """
    row = await _load_scoped(db, actor, employee_id)
    if not row.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="employee_inactive")

    purpose = (
        AuthTokenPurpose.INVITATION if row.password_hash is None
        else AuthTokenPurpose.PASSWORD_RESET
    )
    raw, token = await issue_token(
        db, company_id=cid, user_id=row.id, purpose=purpose, created_by=actor.user_id
    )
    await db.commit()
    await db.refresh(token)

    await record_audit(
        db, company_id=cid, user_id=actor.user_id, action="user_access_link_issued", entity_type="erp_user",
        entity_id=str(row.id), new_value={"purpose": purpose.value},  # 토큰 자체는 절대 기록 금지
    )
    return AccessLinkOut(
        url=set_password_url(raw),
        purpose=purpose.value,
        expires_at=token.expires_at.isoformat(),
        employee_id=row.id,
        employee_name=row.name,
        employee_email=row.email,
    )


@router.delete("/employees/{employee_id}/access-link", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_access_link(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    actor: CurrentUser = Depends(require_role(*ADMIN_ROLES)),
    cid: int = Depends(company_scope),
) -> None:
    """발급한 링크 회수 (잘못 보냈을 때). 미사용 토큰 전량 무효화."""
    row = await _load_scoped(db, actor, employee_id)
    revoked = await revoke_pending_for_user(db, user_id=row.id)
    await db.commit()
    if revoked:
        await record_audit(
            db, company_id=cid, user_id=actor.user_id, action="user_access_link_revoked", entity_type="erp_user",
            entity_id=str(row.id), new_value={"revoked": revoked},
        )


@router.post("/employees/{employee_id}/activate", response_model=EmployeeOut)
async def activate_employee(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    actor: CurrentUser = Depends(require_role(*ADMIN_ROLES)),
    cid: int = Depends(company_scope),
) -> EmployeeOut:
    """비활성 유저 복구. 좌석(seat_limit) 게이트를 다시 통과해야 한다."""
    row = await _load_scoped(db, actor, employee_id)
    if not row.is_active:
        await _assert_seat_capacity(db, cid)
        row.is_active = True
        await db.commit()
        await db.refresh(row)
        await record_audit(
            db, company_id=cid, user_id=actor.user_id, action="user_activated", entity_type="erp_user",
            entity_id=str(row.id), old_value={"is_active": False}, new_value={"is_active": True},
        )
    return _out(row)
