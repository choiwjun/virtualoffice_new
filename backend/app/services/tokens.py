"""비밀번호 설정 토큰 서브시스템 (E4 — 24-spec Phase 3 초대 + Phase 6 리셋 공용 정본).

초대(최초 비밀번호 설정)와 재설정은 "1회용 링크 → 본인이 비밀번호 설정 → 즉시 로그인"으로
동일한 흐름이다. 발급·검증·소비를 여기 한 곳에 두고 두 경로가 같은 코드를 쓴다.

## 규율
- **평문 미저장**: 원문 토큰은 발급 응답에서 한 번만 노출하고 DB에는 sha256만 남긴다.
- **단회성**: 소비 시 `used_at`을 찍는다. 재사용은 410.
- **단일 유효**: 새로 발급하면 같은 유저의 기존 pending 토큰을 회수한다.
- **상태 파생**: 만료는 조회 시점에 `expires_at`으로 판정한다(배치 불필요, 스테일 없음).
- **오류 동일화**: 만료·사용됨·회수됨·존재하지 않음을 전부 같은 예외로 처리해 토큰 추측에
  정보를 주지 않는다.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.tables import AuthToken, AuthTokenPurpose

# 링크 만료 정책. 초대는 사람이 며칠 뒤 확인하는 걸 감안해 길게,
# 재설정은 계정 탈취 창을 좁히기 위해 짧게.
INVITATION_TTL = timedelta(days=7)
PASSWORD_RESET_TTL = timedelta(hours=24)

# 비밀번호 최소 길이 — 가입·초대·재설정·변경 공통 상수 (24-spec Phase 6 §비번 정책).
# 기존 셀프가입(RegisterRequest)이 8자를 쓰고 있어 그 값을 정본으로 통일한다.
MIN_PASSWORD_LENGTH = 8

# URL-safe 32바이트 = 256비트 엔트로피. 추측 불가.
_TOKEN_BYTES = 32


class InvalidToken(Exception):
    """토큰이 없거나·만료·사용됨·회수됨. 호출측은 전부 동일하게 410으로 응답한다."""


def hash_token(raw: str) -> str:
    """링크에 실리는 원문 토큰 → 저장용 sha256 hex(64자)."""
    return hashlib.sha256(raw.encode()).hexdigest()


def ttl_for(purpose: AuthTokenPurpose) -> timedelta:
    return INVITATION_TTL if purpose == AuthTokenPurpose.INVITATION else PASSWORD_RESET_TTL


def set_password_url(raw: str) -> str:
    """관리자가 복사해 전달할 링크. 프론트 공개 라우트 `/set-password`가 받는다.

    메일 발송을 붙일 때도 이 함수가 그대로 링크 본문이 된다(발송 채널만 추가).
    """
    return f"{settings.public_app_url.rstrip('/')}/set-password?token={raw}"


async def issue_token(
    db: AsyncSession,
    *,
    company_id: int,
    user_id: int,
    purpose: AuthTokenPurpose,
    created_by: Optional[int] = None,
    now: Optional[datetime] = None,
) -> tuple[str, AuthToken]:
    """새 토큰 발급 → (평문 토큰, 행). 같은 유저의 기존 pending 토큰은 회수된다.

    commit은 호출측 책임 — 유저 생성 같은 다른 쓰기와 한 트랜잭션으로 묶을 수 있게.
    """
    now = now or datetime.now(timezone.utc)

    # 이전 링크 무효화: 재발급 후에도 옛 링크가 살아 있으면 회수가 의미를 잃는다.
    await db.execute(
        update(AuthToken)
        .where(
            AuthToken.user_id == user_id,
            AuthToken.used_at.is_(None),
            AuthToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )

    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    row = AuthToken(
        company_id=company_id,
        user_id=user_id,
        purpose=purpose,
        token_hash=hash_token(raw),
        expires_at=now + ttl_for(purpose),
        created_by=created_by,
        created_at=now,
    )
    db.add(row)
    return raw, row


async def load_valid_token(
    db: AsyncSession, raw: str, *, now: Optional[datetime] = None
) -> AuthToken:
    """원문 토큰 → 유효한 행. 무효 사유는 구분하지 않고 InvalidToken으로 통일한다."""
    now = now or datetime.now(timezone.utc)
    row = (
        await db.execute(select(AuthToken).where(AuthToken.token_hash == hash_token(raw)))
    ).scalar_one_or_none()
    if row is None or row.used_at is not None or row.revoked_at is not None:
        raise InvalidToken()
    # SQLite는 tz-naive로 돌려주므로 UTC로 간주해 비교한다(저장은 UTC 정본).
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= now:
        raise InvalidToken()
    return row


def consume(row: AuthToken, *, now: Optional[datetime] = None) -> None:
    """토큰 소비 표시(단회성). commit은 호출측."""
    row.used_at = now or datetime.now(timezone.utc)


async def revoke_pending_for_user(
    db: AsyncSession, *, user_id: int, now: Optional[datetime] = None
) -> int:
    """해당 유저의 미사용 토큰 전량 회수. 반환 = 회수 건수."""
    now = now or datetime.now(timezone.utc)
    res = await db.execute(
        update(AuthToken)
        .where(
            AuthToken.user_id == user_id,
            AuthToken.used_at.is_(None),
            AuthToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    return res.rowcount or 0
