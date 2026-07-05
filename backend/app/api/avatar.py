"""
아바타 시작 위치 API (P2-R3-T1).

- GET /api/users/{user_id}/avatar-spawn-location   배정 좌석 → 3D 스폰 좌표(미배정 시 로비 폴백)

RBAC: 본인 또는 admin/leader. 좌표계 2D top_left 미터(D25).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.services.avatar_spawner import get_spawn_location

router = APIRouter(prefix="/api", tags=["avatar"])

_ADMIN_ROLES = ("admin", "super_admin")


@router.get("/users/{user_id}/avatar-spawn-location")
async def avatar_spawn_location(
    user_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user_id != current_user.user_id and current_user.role not in _ADMIN_ROLES and current_user.role != "leader":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
    loc = await get_spawn_location(db, user_id)
    return {"user_id": user_id, **loc}
