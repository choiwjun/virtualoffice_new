"""
웹콘솔 인증 라우터.

정본: 00-decisions.md D4 — JWT HS256 자체 시크릿, ERP와 미공유.
평문 비밀번호는 절대 로깅 금지.
엔드포인트: POST /api/auth/login, POST /api/auth/refresh, GET /api/auth/me.
"""

from datetime import timedelta
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentUser, get_current_user
from app.core.security import (
    create_access_token,
    decode_access_token,
    verify_password,
)
from app.db import get_db
from app.models.tables import ErpUser

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── 요청/응답 스키마 ────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str  # 절대 로깅 금지


class RefreshRequest(BaseModel):
    refresh_token: str


class UserInfo(BaseModel):
    id: int
    email: str
    name: str
    role: str
    team_id: Optional[int] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # 초 단위
    user: UserInfo


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


# ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

def _credentials_exc() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="invalid_credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _build_token(user: ErpUser) -> tuple[str, int]:
    """(access_token, expires_in_seconds) 반환."""
    expires_hours = settings.jwt_access_token_expire_hours
    token = create_access_token(
        {
            "sub": str(user.id),
            "email": user.email,
            "role": user.role.value,
            "team_id": user.erp_team_id,
        },
        expires_delta=timedelta(hours=expires_hours),
    )
    return token, expires_hours * 3600


def _user_info(user: ErpUser) -> UserInfo:
    return UserInfo(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
        team_id=user.erp_team_id,
    )


# ── 엔드포인트 ───────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse, status_code=200)
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """
    POST /api/auth/login — 이메일+비밀번호 → JWT 발급.

    ErpUser.password_hash(bcrypt)로 검증. 실패 시 401.
    평문 비밀번호 로깅 금지(D4).
    """
    result = await db.execute(
        select(ErpUser).where(
            ErpUser.email == payload.email,
            ErpUser.is_active == True,  # noqa: E712
        )
    )
    user = result.scalar_one_or_none()

    # 사용자 미존재 또는 password_hash 미설정(ERP 전용 계정) 또는 비밀번호 불일치 → 401
    if (
        user is None
        or user.password_hash is None
        or not verify_password(payload.password, user.password_hash)
    ):
        raise _credentials_exc()

    token, expires_in = _build_token(user)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=expires_in,
        user=_user_info(user),
    )


@router.post("/refresh", response_model=RefreshResponse, status_code=200)
async def refresh(
    payload: RefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> RefreshResponse:
    """
    POST /api/auth/refresh — 유효한 토큰 → 새 토큰 재발급.

    단일 HS256 토큰 스킴(D4). refresh_token도 동일 시크릿으로 서명된 JWT.
    검증 실패 시 401.
    """
    try:
        decoded = decode_access_token(payload.refresh_token)
    except jwt.PyJWTError:
        raise _credentials_exc()

    sub = decoded.get("sub")
    if sub is None:
        raise _credentials_exc()

    result = await db.execute(
        select(ErpUser).where(
            ErpUser.id == int(sub),
            ErpUser.is_active == True,  # noqa: E712
        )
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise _credentials_exc()

    token, expires_in = _build_token(user)
    return RefreshResponse(
        access_token=token,
        token_type="bearer",
        expires_in=expires_in,
    )


@router.get("/me", response_model=UserInfo)
async def me(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserInfo:
    """
    GET /api/auth/me — Bearer 토큰으로 현재 사용자 조회.

    get_current_user 의존성(JWT 클레임 검증) 통과 후 DB에서 최신 정보 반환.
    """
    result = await db.execute(
        select(ErpUser).where(
            ErpUser.id == current_user.user_id,
            ErpUser.is_active == True,  # noqa: E712
        )
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user_not_found",
        )
    return _user_info(user)
