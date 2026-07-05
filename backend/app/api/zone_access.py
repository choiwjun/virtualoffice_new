"""
구역별 접근 권한 API (P7-R1-T2).

- GET    /zones/{zone_id}/access-control   구역 권한 규칙 목록
- POST   /zones/{zone_id}/access-control   규칙 추가 (admin)
- DELETE /zone-access/{rule_id}            규칙 삭제 (admin)
- GET    /zones/{zone_id}/can-enter        현재 사용자 진입 가능 여부

규칙 없는 구역은 기본 개방(모두 enter). 규칙이 있으면 role 또는 user_id가 매칭되고
permission이 enter|manage 인 경우에만 진입 허용(deny-by-rule). 진입 검증(Phase4 room enter)은
user_can_enter_zone() 헬퍼를 참조한다.
경로 규약: root prefix 없음(계약 규약, Caddy /api/*→/*, D21-r).
"""

from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import TeamZone, ZoneAccess

router = APIRouter(tags=["zone-access"])

_PERMISSIONS = {"view", "enter", "manage"}
_ENTER_PERMISSIONS = {"enter", "manage"}


class ZoneAccessCreate(BaseModel):
    permission: str = "enter"
    role: Optional[str] = None
    user_id: Optional[int] = None


def _out(z: ZoneAccess) -> dict:
    return {
        "rule_id": str(z.id),
        "zone_id": str(z.zone_id),
        "role": z.role,
        "user_id": z.user_id,
        "permission": z.permission,
    }


async def _zone_or_404(db: AsyncSession, zone_id: UUID) -> TeamZone:
    z = await db.get(TeamZone, zone_id)
    if z is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="zone_not_found")
    return z


async def user_can_enter_zone(db: AsyncSession, zone_id: UUID, user: CurrentUser) -> bool:
    """구역 진입 가능 여부. 규칙 없으면 개방; 있으면 role/user_id 매칭 + enter|manage만 허용."""
    if user.role in ("admin", "super_admin"):
        return True
    rules = (
        await db.execute(select(ZoneAccess).where(ZoneAccess.zone_id == zone_id))
    ).scalars().all()
    if not rules:
        return True  # 규칙 없는 구역은 개방
    for r in rules:
        if r.permission not in _ENTER_PERMISSIONS:
            continue
        if r.user_id is not None and r.user_id == user.user_id:
            return True
        if r.role is not None and r.role == user.role:
            return True
    return False


@router.get("/zones/{zone_id}/access-control")
async def list_zone_access(
    zone_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    await _zone_or_404(db, zone_id)
    rows = (
        await db.execute(select(ZoneAccess).where(ZoneAccess.zone_id == zone_id))
    ).scalars().all()
    return {"rules": [_out(r) for r in rows]}


@router.post("/zones/{zone_id}/access-control", status_code=status.HTTP_201_CREATED)
async def create_zone_access(
    zone_id: UUID,
    body: ZoneAccessCreate,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> dict:
    await _zone_or_404(db, zone_id)
    if body.permission not in _PERMISSIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_permission")
    if body.role is None and body.user_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role_or_user_required")
    rule = ZoneAccess(
        id=uuid4(), zone_id=zone_id, role=body.role, user_id=body.user_id, permission=body.permission
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _out(rule)


@router.delete("/zone-access/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_zone_access(
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role("admin", "super_admin")),
) -> None:
    try:
        parsed = UUID(rule_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="rule_not_found")
    rule = await db.get(ZoneAccess, parsed)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="rule_not_found")
    await db.delete(rule)
    await db.commit()


@router.get("/zones/{zone_id}/can-enter")
async def check_can_enter(
    zone_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _zone_or_404(db, zone_id)
    allowed = await user_can_enter_zone(db, zone_id, current_user)
    return {"zone_id": str(zone_id), "user_id": current_user.user_id, "can_enter": allowed}
