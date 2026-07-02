"""
인증/보안 유틸: JWT 발급·검증 + 비밀번호 해시.

정본: 00-decisions.md D4 — JWT **HS256 + 자체 시크릿**(ERP와 미공유),
python-jose 폐기(CVE·유지보수 중단) → **PyJWT** 사용. 게임서버는 검증만.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
import jwt  # PyJWT

from app.config import settings

# bcrypt는 72바이트 초과 입력을 거부(5.x) → 표준 상한으로 절단.
# passlib은 유지보수 중단(1.7.4)이라 bcrypt를 직접 사용.
_BCRYPT_MAX_BYTES = 72


def _prepare(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


# ── 비밀번호 ──────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prepare(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(plain_password), hashed_password.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ── JWT (HS256, 자체 시크릿) ──────────────────────────────
def create_access_token(
    data: dict[str, Any],
    expires_delta: Optional[timedelta] = None,
) -> str:
    """액세스 토큰 발급. 기본 만료 24h(D4)."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta
        or timedelta(hours=settings.jwt_access_token_expire_hours)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(
        to_encode,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str) -> dict[str, Any]:
    """토큰 검증·디코드. 실패 시 jwt.PyJWTError 계열 예외 발생(호출측 처리)."""
    return jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
    )
