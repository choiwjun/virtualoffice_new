"""
인증 API (로그인/토큰갱신/현재사용자).

정본: 00-decisions.md D4(JWT HS256 자체 시크릿, ERP 미공유),
docs/api/management-api.yaml (/auth/*).

- 비밀번호는 로컬 크리덴셜 저장소(auth_credential)로 검증한다. ERP 미러(erp_user)는
  read-only(D18)라 비밀번호를 담지 않으며, 로컬 검증으로 계정 잠금/rate-limit(C2)을
  ERP 왕복 없이 수행한다. 라이브 ERP 비밀번호 검증은 OQ10 확보 시 어댑터로 연결(G011 blocker).
- 경로는 계약 테스트 기준 prefix 없음(/auth/...). 외부 공개 시 Caddy가 /api/* → /* 로
  라우팅한다(D21-r). management-api.yaml servers.url 의 /api 는 리버스 프록시 base.
"""

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.config import settings
from app.core.deps import CurrentUser, get_current_user
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.db import get_db
from app.models.tables import AuthCredential, ErpUser

router = APIRouter(tags=["auth"])

_REFRESH_EXPIRE_DAYS = 7
# code MEDIUM(G010 architect): 계정 미존재(user/cred miss) 경로에서 bcrypt verify를 건너뛰면
# 존재 계정(cred 조회 후 verify 실행) 대비 응답시간이 짧아져 계정 존재 여부가 타이밍으로
# 새어나간다(계정 열거 오라클). miss 경로에서도 고정 더미 해시에 대해 verify_password를
# 1회 실행해 시간을 맞춘다 — 결과는 버리고 항상 401 invalid_credentials로 조기 반환한다.
# 카운터 증가·잠금 로직은 여전히 cred가 실재할 때만 수행된다(C2 유지).
_DUMMY_PASSWORD_HASH = hash_password("timing-normalization-dummy-constant")


def _ensure_utc(dt: datetime) -> datetime:
    """SQLite는 DateTime(timezone=True) 컬럼도 naive datetime을 반환할 수 있어 UTC로 정규화한다."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ── 스키마 ────────────────────────────────────────────────
class LoginRequest(BaseModel):
    # 필수 필드 누락 시 스펙상 400(BadRequest) — FastAPI 기본 422 대신 명시 검증.
    email: str | None = None
    password: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str


def _access_expires_in() -> int:
    return settings.jwt_access_token_expire_hours * 3600


def _issue_tokens(claims: dict) -> dict:
    token = create_access_token(claims)
    refresh = create_access_token(
        {**claims, "type": "refresh"},
        expires_delta=timedelta(days=_REFRESH_EXPIRE_DAYS),
    )
    return {"token": token, "refresh_token": refresh, "expires_in": _access_expires_in()}


# ── 로그인 ────────────────────────────────────────────────
@router.post("/auth/login", status_code=status.HTTP_201_CREATED)
async def login(payload: LoginRequest, db=Depends(get_db)) -> dict:
    if not payload.email or not payload.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="missing_required_field"
        )

    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials"
    )
    locked = HTTPException(
        status_code=status.HTTP_423_LOCKED, detail="account_locked"
    )

    user = (
        await db.execute(
            select(ErpUser).where(
                ErpUser.email == payload.email, ErpUser.is_active.is_(True)
            )
        )
    ).scalar_one_or_none()
    if user is None:
        # code MEDIUM: 계정 미존재도 존재 계정과 동일하게 bcrypt 1회를 소모해 응답시간을 맞춘다.
        verify_password(payload.password, _DUMMY_PASSWORD_HASH)
        raise invalid

    cred = (
        await db.execute(
            select(AuthCredential).where(AuthCredential.user_id == user.id)
        )
    ).scalar_one_or_none()
    if cred is None:
        # code MEDIUM: cred 미존재도 동일 사유로 더미 verify를 실행한다.
        verify_password(payload.password, _DUMMY_PASSWORD_HASH)
        raise invalid

    # C2: 계정 존재가 확인된 이후에만 잠금/rate-limit을 적용한다(비존재 계정은 항상 401 invalid_credentials
    # 로 조기 반환되어 카운터 상태를 노출하지 않는다).
    now = datetime.now(timezone.utc)
    if cred.locked_until is not None and now < _ensure_utc(cred.locked_until):
        raise locked

    if not verify_password(payload.password, cred.password_hash):
        cred.failed_attempts += 1
        just_locked = cred.failed_attempts >= settings.login_max_attempts
        if just_locked:
            cred.locked_until = now + timedelta(minutes=settings.login_lockout_minutes)
        await db.commit()
        raise locked if just_locked else invalid

    cred.failed_attempts = 0
    cred.locked_until = None
    await db.commit()

    claims = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role.value,
        "team_id": user.erp_team_id,
    }
    tokens = _issue_tokens(claims)
    return {
        **tokens,
        "user": UserOut(
            id=user.id, email=user.email, name=user.name, role=user.role.value
        ).model_dump(),
    }


# ── 토큰 갱신 ──────────────────────────────────────────────
@router.post("/auth/refresh")
async def refresh(payload: RefreshRequest) -> dict:
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token"
    )
    if not payload.refresh_token:
        raise invalid
    try:
        claims = decode_access_token(payload.refresh_token)
    except jwt.PyJWTError:
        raise invalid

    sub = claims.get("sub")
    role = claims.get("role")
    if sub is None or role is None:
        raise invalid

    if claims.get("type") != "refresh":
        raise invalid
    return _issue_tokens(
        {
            "sub": sub,
            "email": claims.get("email"),
            "role": role,
            "team_id": claims.get("team_id"),
        }
    )


# ── 현재 사용자 ────────────────────────────────────────────
@router.get("/auth/me")
async def me(user: CurrentUser = Depends(get_current_user)) -> dict:
    return {
        "id": user.user_id,
        "email": user.email,
        "role": user.role,
        "team_id": user.team_id,
    }
