"""테넌트 브랜딩(화이트라벨) API — E5 (24-spec Phase 4 · 23 E5/A7/A1).

- GET    /api/branding          현재 회사 브랜딩 (인증 — 셸·설정이 소비)
- GET    /api/branding/public   로그인 화면용 (미인증 공개, slug로 조회)
- PUT    /api/branding          브랜드명·색 수정 (admin)
- POST   /api/branding/logo     로고 업로드 (admin, multipart)
- DELETE /api/branding/logo     로고 삭제 (admin)

## 화이트라벨 경계
테넌트가 바꾸는 것은 **브랜드명·로고·primary/accent 색뿐**이다. 다크 서피스·텍스트 색은
고정이라 어떤 색을 넣어도 본문 대비(WCAG, 23 A11)가 무너지지 않는다. primary는 버튼·액센트
표면에만 쓰인다.

## 공개 엔드포인트가 흘리는 것
`/api/branding/public`은 미인증이다. slug로 조회되므로 "그 slug의 회사가 존재하는가"와
브랜드 표시 정보(이름·로고·색)까지만 노출한다 — 회사 목록을 열거할 수단은 주지 않는다
(전체 목록 API 없음, 존재하지 않으면 기본 브랜딩을 그대로 반환).
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import ADMIN_ROLES, CurrentUser, company_scope, get_current_user, require_role
from app.core.images import EXTENSIONS, sniff_image_type
from app.db import get_db
from app.models.tables import Company

router = APIRouter(prefix="/api", tags=["branding"])

_HEX = r"^#[0-9A-Fa-f]{6}$"
# 수정 입력용: 빈 문자열은 "기본값으로 되돌리기"를 뜻하므로 허용한다.
# (None = 건드리지 않음 / "" = 초기화 — 두 의미를 구분하려면 빈 값이 유효해야 한다.)
_HEX_OR_EMPTY = r"^(#[0-9A-Fa-f]{6})?$"

# 로고 업로드 제약 — 아바타(2MB)보다 넉넉하되 상한은 둔다.
_LOGO_MAX_BYTES = 2 * 1024 * 1024


def _branding_dir(company_id: int) -> Path:
    """회사별 네임스페이스 — 경로 열거로 타사 로고를 훑지 못하게 분리한다."""
    d = Path(settings.media_root) / "branding" / str(company_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _delete_logo_files(company_id: int) -> None:
    for p in _branding_dir(company_id).glob("logo_*"):
        try:
            p.unlink()
        except OSError:
            pass  # 서빙 중 잠금 등 — 다음 교체 때 재시도


# ── 스키마 ────────────────────────────────────────────────
class BrandingOut(BaseModel):
    company_id: int
    company_name: str
    brand_name: str
    """표시용 — brand_name이 비면 company_name으로 채워 내려간다(프론트 폴백 불필요)."""
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    accent_color: Optional[str] = None


class PublicBrandingOut(BaseModel):
    """로그인 전 화면용 최소 정보. 회사 존재 여부 외에는 아무것도 흘리지 않는다."""
    brand_name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None


class BrandingUpdate(BaseModel):
    """미지정(None) = 건드리지 않음 / 빈 문자열("") = 기본값으로 되돌리기."""
    brand_name: Optional[str] = Field(None, max_length=255)
    primary_color: Optional[str] = Field(None, pattern=_HEX_OR_EMPTY)
    accent_color: Optional[str] = Field(None, pattern=_HEX_OR_EMPTY)


def _out(c: Company) -> BrandingOut:
    return BrandingOut(
        company_id=c.id,
        company_name=c.name,
        brand_name=c.brand_name or c.name,
        logo_url=c.logo_url,
        primary_color=c.primary_color,
        accent_color=c.accent_color,
    )


async def _load_company(db: AsyncSession, cid: int) -> Company:
    c = (await db.execute(select(Company).where(Company.id == cid))).scalar_one_or_none()
    if c is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="company_not_found")
    return c


# ── 조회 ──────────────────────────────────────────────────
@router.get("/branding", response_model=BrandingOut)
async def get_branding(
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
    cid: int = Depends(company_scope),
) -> BrandingOut:
    """내 회사 브랜딩. 셸이 마운트 시 호출해 CSS 변수를 덮어쓴다."""
    return _out(await _load_company(db, cid))


@router.get("/branding/public", response_model=PublicBrandingOut)
async def get_public_branding(
    slug: str = Query(..., min_length=1, max_length=63, description="회사 slug"),
    db: AsyncSession = Depends(get_db),
) -> PublicBrandingOut:
    """로그인 화면 브랜딩 (미인증 공개).

    존재하지 않는 slug도 200 + 빈 브랜딩으로 답한다 — 404로 갈리면 slug 존재 여부를
    훑는 열거 수단이 된다.
    """
    c = (
        await db.execute(select(Company).where(Company.slug == slug.strip().lower()))
    ).scalar_one_or_none()
    if c is None:
        return PublicBrandingOut()
    return PublicBrandingOut(
        brand_name=c.brand_name or c.name,
        logo_url=c.logo_url,
        primary_color=c.primary_color,
    )


# ── 수정 (admin) ──────────────────────────────────────────
@router.put("/branding", response_model=BrandingOut)
async def update_branding(
    body: BrandingUpdate,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role(*ADMIN_ROLES)),
    cid: int = Depends(company_scope),
) -> BrandingOut:
    """브랜드명·색 수정. 빈 문자열은 "기본값으로 되돌리기"(NULL)로 해석한다.

    미지정(None) 필드는 건드리지 않는다 — 색만 바꿀 때 브랜드명이 날아가지 않게.
    """
    c = await _load_company(db, cid)
    if body.brand_name is not None:
        c.brand_name = body.brand_name.strip() or None
    if body.primary_color is not None:
        c.primary_color = body.primary_color or None
    if body.accent_color is not None:
        c.accent_color = body.accent_color or None
    await db.commit()
    await db.refresh(c)
    return _out(c)


@router.post("/branding/logo", response_model=BrandingOut)
async def upload_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role(*ADMIN_ROLES)),
    cid: int = Depends(company_scope),
) -> BrandingOut:
    """로고 업로드(교체). **content_type이 아니라 실제 바이트 시그니처로 판정**한다 (22 T1-12).

    HTML/JS를 image/png라고 주장해 올리면 /media 정적 서빙에서 실행돼 저장형 XSS가 된다.
    """
    data = await file.read(_LOGO_MAX_BYTES + 1)
    if not data:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="empty_file")
    if len(data) > _LOGO_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="image_too_large"
        )

    mime = sniff_image_type(data)
    if mime is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="unsupported_image_type",  # png/jpeg/webp 실바이트만 허용 (svg 불가)
        )

    c = await _load_company(db, cid)
    # 파일명에 타임스탬프 → 교체 시 URL이 바뀌어 브라우저 캐시가 무효화된다.
    _delete_logo_files(cid)
    fname = f"logo_{int(time.time())}{EXTENSIONS[mime]}"
    (_branding_dir(cid) / fname).write_bytes(data)
    c.logo_url = f"/media/branding/{cid}/{fname}"
    await db.commit()
    await db.refresh(c)
    return _out(c)


@router.delete("/branding/logo", response_model=BrandingOut)
async def delete_logo(
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_role(*ADMIN_ROLES)),
    cid: int = Depends(company_scope),
) -> BrandingOut:
    """로고 삭제 — 이니셜 배지로 폴백."""
    c = await _load_company(db, cid)
    _delete_logo_files(cid)
    c.logo_url = None
    await db.commit()
    await db.refresh(c)
    return _out(c)
