"""
아바타 커스터마이징 엔드포인트 (C4).

GET /api/avatar  — 내 아바타 설정 조회 (미설정 시 404 → 클라 기본값)
PUT /api/avatar  — 내 아바타 설정 upsert (프리셋 + 상/하의 색상 + 이름표)

정본: 06-screens.md §3.9. user_avatar 테이블(user_id PK, 1:1).
D4: 항상 로그인 사용자 본인의 아바타만 조회/수정 (user_id = 토큰 sub).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import UserAvatar

router = APIRouter(prefix="/api", tags=["avatar"])

_HEX = r"^#[0-9A-Fa-f]{6}$"


class AvatarOut(BaseModel):
    user_id: int
    preset_id: str
    top_color: str
    bottom_color: str
    show_nameplate: bool


class AvatarUpdate(BaseModel):
    preset_id: str = Field(..., min_length=1, max_length=32)
    top_color: str = Field(..., pattern=_HEX)
    bottom_color: str = Field(..., pattern=_HEX)
    show_nameplate: bool = True


def _to_out(row: UserAvatar) -> AvatarOut:
    return AvatarOut(
        user_id=row.user_id,
        preset_id=row.preset_id,
        top_color=row.top_color,
        bottom_color=row.bottom_color,
        show_nameplate=row.show_nameplate,
    )


@router.get("/avatar", response_model=AvatarOut)
async def get_my_avatar(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AvatarOut:
    """GET /api/avatar — 내 아바타 설정. 미설정이면 404(클라가 기본값 사용)."""
    row = await db.get(UserAvatar, current_user.user_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="avatar not set",
        )
    return _to_out(row)


@router.put("/avatar", response_model=AvatarOut)
async def upsert_my_avatar(
    body: AvatarUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AvatarOut:
    """PUT /api/avatar — 내 아바타 설정 upsert(없으면 생성, 있으면 갱신)."""
    row = await db.get(UserAvatar, current_user.user_id)
    if row is None:
        row = UserAvatar(user_id=current_user.user_id)
        db.add(row)
    row.preset_id = body.preset_id
    row.top_color = body.top_color
    row.bottom_color = body.bottom_color
    row.show_nameplate = body.show_nameplate
    await db.commit()
    await db.refresh(row)
    return _to_out(row)
