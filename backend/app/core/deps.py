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
from app.models.tables import DEFAULT_COMPANY_ID

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
    role: str
    company_id: int = DEFAULT_COMPANY_ID  # Phase 1a: 테넌트 스코프 (22 T0-1)
    email: Optional[str] = None
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

    # 구 토큰(company_id 클레임 없음)은 기본 테넌트(1)로 매핑 — 하위호환(비파괴).
    # 신규 로그인 토큰은 auth._build_token이 실제 company_id를 넣는다.
    company_id = payload.get("company_id")
    return CurrentUser(
        user_id=int(sub),
        role=role,
        company_id=int(company_id) if company_id is not None else DEFAULT_COMPANY_ID,
        email=payload.get("email"),
        team_id=payload.get("team_id"),
    )


async def company_scope(user: "CurrentUser" = Depends(get_current_user)) -> int:
    """호출자의 company_id를 반환하는 얇은 의존성 (Phase 1b 쿼리 스코프의 단일 정본).

    라우터는 이 값으로 `.where(Model.company_id == cid)`를 강제한다.
    사용 예: `cid: int = Depends(company_scope)`.
    """
    return user.company_id


def assert_same_company(user: "CurrentUser", obj_company_id: int) -> None:
    """단건 조회 시 obj의 company_id ≠ user.company_id 면 404(존재 은닉). IDOR(22 T0-1) 차단.

    Phase 1b에서 라우터 단건 조회에 삽입될 헬퍼 — 여기서 정본으로 노출한다.
    """
    if obj_company_id != user.company_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="not_found",
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
