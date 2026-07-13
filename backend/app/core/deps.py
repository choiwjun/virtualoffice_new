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

# 역할 집합 단일 정의 (qa-audit #17 — 모듈별 중복 정의 대신 이 상수를 사용할 것)
ADMIN_ROLES = ("admin", "super_admin")
"""관리 기능 (rbac.yaml: 편집기·확정·동기화 콘솔 등 admin 전용)."""
MANAGER_ROLES = ("admin", "super_admin", "leader")
"""팀 단위 관리 기능 (leader=자기 팀 한정 — 스코프 검사는 호출측 책임)."""


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
    """역할 기반 접근 제어 의존성 팩토리. 예: Depends(require_role('admin')).

    rbac.yaml §12: super_admin은 admin 상위 호환 — 'admin' 허용 시 자동 포함
    (신규 엔드포인트에서 require_role('admin')만 써도 super_admin이 차단되지 않도록).
    """
    roles = set(allowed_roles)
    if "admin" in roles:
        roles.add("super_admin")

    async def _checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="insufficient_permissions",
            )
        return user

    return _checker
