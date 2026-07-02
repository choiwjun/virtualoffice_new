"""
공용 의존성 (인증). 헌법(auth): 단일 인증 의존성 사용.

D4: JWT HS256 자체 시크릿 검증. role 기반 접근은 require_role로 확장.
"""

from dataclasses import dataclass
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=True)


@dataclass
class CurrentUser:
    """토큰에서 복원한 인증 주체 (DB 조회 없이 클레임 기반)."""

    user_id: int
    email: Optional[str]
    role: str
    team_id: Optional[int] = None


async def get_current_user(token: str = Depends(oauth2_scheme)) -> CurrentUser:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="invalid_credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        raise credentials_exc

    sub = payload.get("sub")
    role = payload.get("role")
    if sub is None or role is None:
        raise credentials_exc

    return CurrentUser(
        user_id=int(sub),
        email=payload.get("email"),
        role=role,
        team_id=payload.get("team_id"),
    )


def require_role(*allowed_roles: str):
    """역할 기반 접근 제어 의존성 팩토리. 예: Depends(require_role('admin'))."""

    async def _checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="insufficient_permissions",
            )
        return user

    return _checker
