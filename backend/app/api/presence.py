"""
직원 실시간 상태·위치(Presence) API (G002).

@TASK P4-R3-T1 - 현위치/상태 동기화 API
@TASK P4-R3-T3 - 좌표 파기(D20-a)는 app.services.scheduler.presence_coordinate_purge 참고
@SPEC docs/planning/00-decisions.md D13(상태 7종), D20-a(좌표 30일 파기)
@SPEC docs/planning/04-data-model.md §2.4

경로(계약 정합, root prefix 없음 — seats.py/worklogs.py와 동일 근거, 외부 공개 시 Caddy
/api/*→/*, D21-r):
- PUT   /presence                     본인 상태·위치 upsert (Godot 클라이언트 → 서버, 실시간 동기화)
- PATCH /presence/{user_id}/status    상태만 전환 (본인/관리자)
- GET   /presence/{user_id}           단건 조회 (RBAC: employee 본인 / leader 팀 / admin 전체)
- GET   /presence                     목록 조회 (필터: office_id, floor_id, status, team_id)

Presence는 사용자당 1행(현재 상태) — insert 없으면 생성, 있으면 제자리 갱신(upsert).
"""

import math
from typing import Optional
from uuid import UUID

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import ErpUser, Presence, PresenceStatus

router = APIRouter(tags=["presence"])

_ADMIN_ROLES = ("admin", "super_admin")


# ── 스키마 ────────────────────────────────────────────────
class PresenceUpsertIn(BaseModel):
    office_id: UUID
    floor_id: UUID
    x: float
    y: float
    z: float
    status: str


class PresenceStatusIn(BaseModel):
    status: str


def _validate_status(raw_status: str) -> PresenceStatus:
    """상태 문자열을 PresenceStatus(7종)로 검증. 유효하지 않으면 400(계약: pydantic enum 422 대신 통일)."""
    try:
        return PresenceStatus(raw_status)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_status")


_INT64_MAX = 9223372036854775807


def _guard_user_id(user_id: int) -> None:
    """erp_user.id는 int64(BigInteger) — 범위 밖 정수는 존재 불가 → 404(DB 오버플로 500 방지)."""
    if not (1 <= user_id <= _INT64_MAX):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="presence_not_found")


def _validate_finite_coords(x: float, y: float, z: float) -> None:
    """좌표는 유한값만 허용(NaN/Infinity 거부 → 400, DB NOT NULL/무결성 500 방지)."""
    if not all(math.isfinite(v) for v in (x, y, z)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_coords")


def _presence_out(p: Presence) -> dict:
    return {
        "user_id": p.user_id,
        "office_id": str(p.office_id),
        "floor_id": str(p.floor_id),
        "x": p.x,
        "y": p.y,
        "z": p.z,
        "status": p.status.value,
        "last_activity_at": p.last_activity_at.isoformat() if p.last_activity_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


# ── 조회 헬퍼 ─────────────────────────────────────────────
async def _team_user_ids(db: AsyncSession, team_id: Optional[int]) -> list[int]:
    if team_id is None:
        return []
    rows = (
        await db.execute(select(ErpUser.id).where(ErpUser.erp_team_id == team_id))
    ).scalars().all()
    return list(rows)


async def _authorize_read(db: AsyncSession, p: Presence, current_user: CurrentUser) -> None:
    """조회 RBAC: employee 본인 / leader 팀 / admin 전체. 위반 시 404(존재 미노출, kpi.py와 동일 근거)."""
    if current_user.role in _ADMIN_ROLES:
        return
    if p.user_id == current_user.user_id:
        return
    if current_user.role == "leader":
        team_ids = await _team_user_ids(db, current_user.team_id)
        if p.user_id in team_ids:
            return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="presence_not_found")


# ── 본인 상태·위치 upsert ──────────────────────────────────
@router.put("/presence")
async def upsert_presence(
    body: PresenceUpsertIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    status_enum = _validate_status(body.status)
    _validate_finite_coords(body.x, body.y, body.z)
    now = datetime.now(timezone.utc)

    presence = await db.get(Presence, current_user.user_id)
    if presence is None:
        presence = Presence(
            user_id=current_user.user_id,
            office_id=body.office_id,
            floor_id=body.floor_id,
            x=body.x,
            y=body.y,
            z=body.z,
            status=status_enum,
            last_activity_at=now,
        )
        db.add(presence)
    else:
        presence.office_id = body.office_id
        presence.floor_id = body.floor_id
        presence.x = body.x
        presence.y = body.y
        presence.z = body.z
        presence.status = status_enum
        presence.last_activity_at = now

    await db.commit()
    await db.refresh(presence)
    return _presence_out(presence)


# ── 상태 전환 ─────────────────────────────────────────────
@router.patch("/presence/{user_id}/status")
async def update_presence_status(
    user_id: int,
    body: PresenceStatusIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user_id != current_user.user_id and current_user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")

    status_enum = _validate_status(body.status)

    _guard_user_id(user_id)
    presence = await db.get(Presence, user_id)
    if presence is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="presence_not_found")

    presence.status = status_enum
    presence.last_activity_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(presence)
    return _presence_out(presence)


# ── 조회 ──────────────────────────────────────────────────
@router.get("/presence/{user_id}")
async def get_presence(
    user_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    _guard_user_id(user_id)
    presence = await db.get(Presence, user_id)
    if presence is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="presence_not_found")
    await _authorize_read(db, presence, current_user)
    return _presence_out(presence)


@router.get("/presence")
async def list_presence(
    office_id: Optional[UUID] = Query(default=None),
    floor_id: Optional[UUID] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    team_id: Optional[int] = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    is_admin = current_user.role in _ADMIN_ROLES
    is_leader = current_user.role == "leader"

    stmt = select(Presence)
    if team_id is not None:
        if not is_admin and not (is_leader and team_id == current_user.team_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
        stmt = stmt.where(Presence.user_id.in_(await _team_user_ids(db, team_id) or [-1]))
    elif is_admin:
        pass  # 전체 조회 허용
    elif is_leader:
        team_ids = await _team_user_ids(db, current_user.team_id)
        stmt = stmt.where(Presence.user_id.in_(team_ids or [-1]))
    else:
        stmt = stmt.where(Presence.user_id == current_user.user_id)

    if office_id is not None:
        stmt = stmt.where(Presence.office_id == office_id)
    if floor_id is not None:
        stmt = stmt.where(Presence.floor_id == floor_id)
    if status_filter is not None:
        stmt = stmt.where(Presence.status == _validate_status(status_filter))

    rows = (await db.execute(stmt)).scalars().all()
    return {"presence": [_presence_out(p) for p in rows], "total": len(rows)}
