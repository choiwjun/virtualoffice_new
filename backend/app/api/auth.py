"""
웹콘솔 인증 라우터.

정본: 00-decisions.md D4 — JWT HS256 자체 시크릿, ERP와 미공유.
평문 비밀번호는 절대 로깅 금지.
엔드포인트: POST /api/auth/login, GET /api/auth/me.
(/auth/refresh는 2026-07-13 제거 — D4 단일 세션: 만료 시 재로그인. 발급 경로 없는 죽은 코드였고 access 토큰 무한 갱신 통로였음.)
"""

import re
from datetime import timedelta, datetime, timezone
from typing import Dict, Optional, Tuple

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, constr, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentUser, get_current_user
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.core.users import (
    UNASSIGNED_TEAM_ID,
    next_native_user_id as _next_native_user_id,
    normalize_email,
)
from app.db import get_db
from app.models.tables import USER_SOURCE_NATIVE, Company, ErpRole, ErpUser
from app.services.tokens import (
    MIN_PASSWORD_LENGTH,
    InvalidToken,
    consume,
    load_valid_token,
    revoke_pending_for_user,
)

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


# ── 셀프서브 가입 (24-spec Phase 2 · 22 T0-4 · 23 E2) ────────────────────────
# 공개 라우트. 계약은 프론트와 고정 — company_id/role/id는 클라가 지정 불가.

# 경량 이메일 검증(RFC 완전판 아님)·native id 대역은 core.users가 정본 —
# admin 유저 CRUD(api/employees, Phase 3)와 같은 규칙을 공유한다.


class RegisterRequest(BaseModel):
    company_name: constr(strip_whitespace=True, min_length=1, max_length=255)
    admin_name: constr(strip_whitespace=True, min_length=1, max_length=255)
    admin_email: str
    admin_password: constr(min_length=MIN_PASSWORD_LENGTH, max_length=128)

    @field_validator("admin_email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        return normalize_email(v)


class CompanyInfo(BaseModel):
    id: int
    name: str
    slug: str


class RegisterResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # 초 단위
    user: UserInfo
    company: CompanyInfo


# slug 예약어 (서브도메인/라우트 충돌 방지 — 24-spec §Phase2 마이그레이션 주의).
_RESERVED_SLUGS = {"admin", "api", "www", "app", "default", "static", "media"}


def _slugify(name: str) -> str:
    """회사명 → 소문자·영숫자·하이픈 slug. 비-ASCII/공백은 하이픈, 축약."""
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    s = re.sub(r"-{2,}", "-", s)
    if not s:
        s = "company"
    return s[:50].strip("-") or "company"


async def _unique_slug(db: AsyncSession, base: str) -> str:
    """base slug 충돌 시 -2, -3 … 접미사로 유니크 확보. 예약어는 -1부터 시작."""
    candidate = base
    suffix = 1
    if candidate in _RESERVED_SLUGS:
        suffix = 2
        candidate = f"{base}-{suffix}"
    while True:
        exists = await db.execute(select(Company.id).where(Company.slug == candidate))
        if exists.scalar_one_or_none() is None:
            return candidate
        suffix += 1
        candidate = f"{base}-{suffix}"


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


@router.post("/register", response_model=RegisterResponse, status_code=200)
async def register(
    payload: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> RegisterResponse:
    """
    POST /api/auth/register — 공개 셀프서브 테넌트 프로비저닝 (24-spec Phase 2 · 22 T0-4).

    새 Company + 첫 admin ErpUser 생성 후 즉시 로그인 토큰 발급(마찰 최소, PLG 진입로).
    - 미인증 공개. LoginRateLimitMiddleware가 IP 기준 rate-limit (login과 동일 예산).
    - company_id/role/id는 클라가 지정 불가 — 서버가 새 회사·admin·안전한 native id로 강제.
    - 이메일 중복(any company) → 409 email_taken. 검증 실패(빈 회사명·잘못된 이메일·짧은
      비번<8) → 422(pydantic). 평문 비밀번호 로깅 금지(D4).
    한 트랜잭션: Company → 첫 admin(role=admin) → commit.
    """
    email = payload.admin_email  # 이미 소문자 정규화됨

    # 이메일 선점 검사 (전 테넌트 통틀어 유일 — 로그인 경로가 email로 조회하므로).
    dup = await db.execute(select(ErpUser.id).where(ErpUser.email == email))
    if dup.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email_taken")

    # 1) 회사 생성 (유니크 slug 확보)
    slug = await _unique_slug(db, _slugify(payload.company_name))
    company = Company(name=payload.company_name, slug=slug)
    db.add(company)
    await db.flush()  # company.id 확보

    # 2) 첫 admin (안전한 native id, company_id=신규, bcrypt 해시)
    user = ErpUser(
        id=await _next_native_user_id(db),
        company_id=company.id,
        email=email,
        name=payload.admin_name,
        erp_team_id=UNASSIGNED_TEAM_ID,  # native(ERP無) 유저 — ERP teams 미매핑.
        role=ErpRole.ADMIN,
        password_hash=hash_password(payload.admin_password),
        is_active=True,
        source=USER_SOURCE_NATIVE,  # ERP 대사(sync)가 첫 admin을 비활성화하지 않게 (Phase 3)
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    await db.refresh(company)

    token, expires_in = _build_token(user)
    return RegisterResponse(
        access_token=token,
        token_type="bearer",
        expires_in=expires_in,
        user=_user_info(user),
        company=CompanyInfo(id=company.id, name=company.name, slug=company.slug),
    )


# ── 비밀번호 설정 / 변경 (E4 — 24-spec Phase 3 초대 + Phase 6 리셋) ──────────────

class SetPasswordCheckOut(BaseModel):
    """링크 유효성 사전 확인 결과. 유효할 때만 대상 정보를 노출한다."""
    valid: bool
    purpose: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None
    company_name: Optional[str] = None


class SetPasswordRequest(BaseModel):
    token: str
    password: constr(min_length=MIN_PASSWORD_LENGTH, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: constr(min_length=MIN_PASSWORD_LENGTH, max_length=128)


def _expired_token_exc() -> HTTPException:
    """만료·사용됨·회수됨·미존재를 동일 응답으로 — 토큰 추측에 단서를 주지 않는다."""
    return HTTPException(status_code=status.HTTP_410_GONE, detail="invalid_or_expired_token")


@router.get("/set-password", response_model=SetPasswordCheckOut)
async def check_set_password_token(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> SetPasswordCheckOut:
    """GET /api/auth/set-password?token=… — 공개. 링크가 살아 있는지 화면 진입 시 확인.

    무효하면 200 + valid=false로 답한다(폼을 그릴지 안내를 그릴지 프론트가 판단).
    """
    try:
        row = await load_valid_token(db, token)
    except InvalidToken:
        return SetPasswordCheckOut(valid=False)

    user = (await db.execute(select(ErpUser).where(ErpUser.id == row.user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        return SetPasswordCheckOut(valid=False)
    company = (await db.execute(select(Company).where(Company.id == row.company_id))).scalar_one_or_none()

    return SetPasswordCheckOut(
        valid=True,
        purpose=row.purpose.value if hasattr(row.purpose, "value") else str(row.purpose),
        email=user.email,
        name=user.name,
        company_name=company.name if company else None,
    )


@router.post("/set-password", response_model=TokenResponse)
async def set_password(
    payload: SetPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """POST /api/auth/set-password — 공개. 1회용 토큰으로 비밀번호 설정 후 즉시 로그인.

    초대(최초 설정)와 재설정이 같은 경로다. 토큰은 여기서 소비되며(단회성),
    그 유저의 다른 미사용 토큰도 함께 회수한다.
    평문 비밀번호 로깅 금지(D4).
    """
    try:
        row = await load_valid_token(db, payload.token)
    except InvalidToken:
        raise _expired_token_exc()

    user = (await db.execute(select(ErpUser).where(ErpUser.id == row.user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        # 발급 후 비활성된 계정 — 링크를 살려두면 퇴사자가 다시 들어온다.
        raise _expired_token_exc()

    user.password_hash = hash_password(payload.password)
    consume(row)
    await revoke_pending_for_user(db, user_id=user.id)  # 남은 링크 동시 무효화
    await db.commit()
    await db.refresh(user)

    # 비번이 바뀌었으니 로그인 백오프 카운터도 초기화 (잠긴 상태로 새 비번을 못 쓰는 일 방지).
    _clear_login_attempts(user.email)

    token, expires_in = _build_token(user)
    return TokenResponse(
        access_token=token, token_type="bearer", expires_in=expires_in, user=_user_info(user)
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """POST /api/auth/change-password — 인증. 현재 비밀번호 확인 후 변경 (23 E7/C11).

    현재 비밀번호 불일치는 401. 평문 로깅 금지(D4).
    """
    user = (
        await db.execute(
            select(ErpUser).where(ErpUser.id == current_user.user_id, ErpUser.is_active == True)  # noqa: E712
        )
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user_not_found")
    if user.password_hash is None or not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_current_password")

    user.password_hash = hash_password(payload.new_password)
    # 본인이 비번을 바꿨다면 발급돼 있던 재설정 링크는 더 이상 유효해선 안 된다.
    await revoke_pending_for_user(db, user_id=user.id)
    await db.commit()


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
