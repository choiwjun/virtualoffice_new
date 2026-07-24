"""
웹콘솔 인증 라우터.

정본: 00-decisions.md D4 — JWT HS256 자체 시크릿, ERP와 미공유.
평문 비밀번호는 절대 로깅 금지.
엔드포인트: POST /api/auth/login, GET /api/auth/me.
(/auth/refresh는 2026-07-13 제거 — D4 단일 세션: 만료 시 재로그인. 발급 경로 없는 죽은 코드였고 access 토큰 무한 갱신 통로였음.)
"""

from datetime import timedelta, datetime, timezone
from typing import Dict, Optional, Tuple

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
# ── 로그인 백오프 (HG-AUTH: 5회 실패 시 5분 잠금) ──────────────────────
_login_attempts: Dict[str, Tuple[int, datetime]] = {}  # email -> (fail_count, locked_until)

def _check_login_backoff(email: str) -> None:
    """로그인 백오프 체크 — 5회 실패 시 HTTPException 발생."""
    if email in _login_attempts:
        fail_count, locked_until = _login_attempts[email]
        now = datetime.now(timezone.utc)
        if fail_count >= 5 and now < locked_until:
            remaining = int((locked_until - now).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed login attempts. Try again in {remaining} seconds.",
            )

def _record_login_failure(email: str) -> None:
    """로그인 실패 기록 — 5회 누적 시 5분 잠금."""
    now = datetime.now(timezone.utc)
    if email in _login_attempts:
        fail_count, locked_until = _login_attempts[email]
        # 잠금 만료 후 첫 실패 → 카운트 리셋
        if fail_count >= 5 and now >= locked_until:
            _login_attempts[email] = (1, now)
        else:
            new_count = fail_count + 1
            if new_count >= 5:
                # 5회 실패 → 5분 잠금
                _login_attempts[email] = (new_count, now + timedelta(minutes=5))
            else:
                _login_attempts[email] = (new_count, locked_until)
    else:
        _login_attempts[email] = (1, now)

def _clear_login_attempts(email: str) -> None:
    """로그인 성공 시 백오프 카운터 초기화."""
    if email in _login_attempts:
        del _login_attempts[email]



# ── 요청/응답 스키마 ────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str  # 절대 로깅 금지


class UserInfo(BaseModel):
    id: int
    email: str
    name: str
    role: str
    team_id: Optional[int] = None
    company_id: int  # Phase 1a: 테넌트 스코프 (22 T0-1) — 프론트 브랜딩/첫실행 fetch가 소비


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # 초 단위
    user: UserInfo


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
            "company_id": user.company_id,  # Phase 1a: 테넌트 스코프 클레임 (22 T0-1)
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
        company_id=user.company_id,
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
    HG-AUTH: 5회 실패 시 5분 잠금.
    """
    # 백오프 체크 (5회 실패 시 429)
    _check_login_backoff(payload.email)
    
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
        _record_login_failure(payload.email)
        raise _credentials_exc()

    # 성공 → 백오프 카운터 초기화
    _clear_login_attempts(payload.email)
    
    token, expires_in = _build_token(user)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=expires_in,
        user=_user_info(user),
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
