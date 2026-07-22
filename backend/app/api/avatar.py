"""
아바타 커스터마이징 엔드포인트 (C4 + D35 배지).

GET    /api/avatar        — 내 아바타 설정 조회 (미설정 시 404 → 클라 기본값)
PUT    /api/avatar        — 내 아바타 설정 upsert (정체성 색 + 이름표; preset/bottom은 레거시 보존)
POST   /api/avatar/photo  — 내 프로필 사진 업로드 (png/jpeg/webp ≤ 2MB → /media/avatars/)
DELETE /api/avatar/photo  — 내 프로필 사진 삭제 (배지는 이니셜 폴백)

정본: 06-screens.md §3.9 + 00-decisions §P(D35: 아바타 = 사진 배지).
user_avatar 테이블(user_id PK, 1:1). D4: 본인 것만 수정(user_id = 토큰 sub).
"""

from __future__ import annotations

import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import UserAvatar

router = APIRouter(prefix="/api", tags=["avatar"])

_HEX = r"^#[0-9A-Fa-f]{6}$"

# 프로필 사진 업로드 제약 — 클라가 256px로 다운스케일해 보내지만 서버도 독립 방어.
_PHOTO_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
_PHOTO_MAX_BYTES = 2 * 1024 * 1024


def _avatars_dir() -> Path:
    d = Path(settings.media_root) / "avatars"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _delete_photo_files(user_id: int) -> None:
    """해당 사용자의 사진 파일 전부 삭제(파일명 = {user_id}_{ts}.{ext}, 재업로드 시 교체)."""
    for p in _avatars_dir().glob(f"{user_id}_*"):
        try:
            p.unlink()
        except OSError:
            pass  # 서빙 중 잠금 등 — 잔여 파일은 다음 교체 때 재시도


class AvatarOut(BaseModel):
    user_id: int
    preset_id: str
    top_color: str
    bottom_color: str
    show_nameplate: bool
    photo_url: str | None = None


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
        photo_url=row.photo_url,
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


@router.get("/avatars", response_model=list[AvatarOut])
async def list_avatars(
    user_ids: str = Query(..., description="쉼표 구분 user_id 목록 (뷰포트 로스터 반영용)"),
    _: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AvatarOut]:
    """여러 사용자의 아바타 외형(공개 표시용) 일괄 조회.

    아바타 외형은 민감정보가 아니므로 인증된 사용자는 타인 것도 조회 가능(D4 인증 요구).
    미설정 사용자는 결과에서 생략(클라가 기본값으로 렌더). 최대 200건.
    """
    ids = [int(x) for x in user_ids.split(",") if x.strip().lstrip("-").isdigit()][:200]
    if not ids:
        return []
    rows = (
        await db.execute(select(UserAvatar).where(UserAvatar.user_id.in_(ids)))
    ).scalars().all()
    return [_to_out(r) for r in rows]


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


@router.post("/avatar/photo", response_model=AvatarOut)
async def upload_my_photo(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AvatarOut:
    """POST /api/avatar/photo — 내 프로필 사진 업로드(교체). D35 배지 아바타의 사진 소스."""
    ext = _PHOTO_TYPES.get((file.content_type or "").lower())
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="unsupported_image_type",  # png/jpeg/webp만 허용
        )
    data = await file.read(_PHOTO_MAX_BYTES + 1)
    if len(data) > _PHOTO_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="image_too_large",  # 2MB 초과
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="empty_file",
        )

    row = await db.get(UserAvatar, current_user.user_id)
    if row is None:
        row = UserAvatar(user_id=current_user.user_id)
        db.add(row)

    # 파일명에 타임스탬프를 넣어 교체 시 URL이 바뀌게(브라우저 캐시 무효화) 하고 이전 파일은 삭제.
    _delete_photo_files(current_user.user_id)
    fname = f"{current_user.user_id}_{int(time.time())}{ext}"
    (_avatars_dir() / fname).write_bytes(data)
    row.photo_url = f"/media/avatars/{fname}"
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.delete("/avatar/photo", response_model=AvatarOut)
async def delete_my_photo(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AvatarOut:
    """DELETE /api/avatar/photo — 내 프로필 사진 삭제(배지는 이니셜 폴백)."""
    row = await db.get(UserAvatar, current_user.user_id)
    if row is None or not row.photo_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="photo not set",
        )
    _delete_photo_files(current_user.user_id)
    row.photo_url = None
    await db.commit()
    await db.refresh(row)
    return _to_out(row)
