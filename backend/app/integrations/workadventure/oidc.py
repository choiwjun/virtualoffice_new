"""
FastAPI OIDC Provider Bridge — WorkAdventure 로그인 연동.

[아키텍처: D4 자체 JWT vs OIDC ID Token 공존]

■ D4 자체 JWT (내부 관리 API 전용)
  - 알고리즘  : HS256 (대칭 HMAC — 비밀키 절대 외부 공개 금지)
  - 발급 주체 : /auth/token 엔드포인트
  - 용도      : FastAPI 관리 REST API 보호 (ERP 동기화, KPI, 좌석 배치 등)
  - 수명      : 24h (D4)
  - 유지 정책 : WorkAdventure 전환 후에도 폐기하지 않음 — 관리 콘솔 API는 D4 그대로

■ OIDC ID Token (WorkAdventure 연동 전용)
  - 알고리즘  : RS256 (비대칭 — 개인키로 서명, WorkAdventure가 공개키로 검증)
  - 발급 주체 : 본 모듈 /oidc/token 엔드포인트
  - 용도      : WorkAdventure OIDC Relying Party(RP)가 사용자 신원 확인
  - 수명      : Authorization Code 5분(1회용), ID Token 1h
  - WorkAdventure가 /oidc/jwks 에서 공개키 세트 조회 → 독립 검증

■ 공존 원칙
  1. 사용자가 WA에서 로그인 시도 → WA가 /oidc/authorize 로 리디렉션
  2. FastAPI /oidc/authorize 가 로그인 폼 제공 → 자격증명 검증 (ERP 사용자 조회)
  3. 검증 성공 → Authorization Code 발급 → 사용자 브라우저를 WA redirect_uri로 전송
  4. WA가 /oidc/token 호출 → RS256 ID Token + Access Token 교환
  5. sub 클레임 = employee_id(int) 문자열 — D4 JWT sub와 동일 규칙 → 두 토큰 크로스-참조 가능
  6. tags 클레임으로 WorkAdventure RBAC 제어 (admin → WA 지도 편집 권한)

■ WorkAdventure docker-compose.yml 주입 환경변수 (→ Lane B 참조)
  OIDC_CLIENT_ID      = wa-client            (settings.wa_oidc_client_id)
  OIDC_CLIENT_SECRET  = <secret>             (settings.wa_oidc_client_secret)
  OIDC_DISCOVERY_URL  = https://<api>/oidc   (자동 suffix: /.well-known/openid-configuration)
  OIDC_SCOPE          = openid profile email

참조:
  - 00-decisions.md: D4(자체 JWT HS256), D26(WorkAdventure self-host), D3(FastAPI 경유 단일화)
  - WorkAdventure OIDC: https://docs.workadventu.re/map-building/authentication/openid/
  - RFC 6749 (OAuth 2.0), RFC 7519 (JWT), OpenID Connect Core 1.0
"""

import hashlib
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt  # PyJWT — RS256은 cryptography 백엔드 필요
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import APIRouter, Form, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.config import settings

# ---------------------------------------------------------------------------
# RSA 키 쌍 (OIDC ID Token RS256 서명용)
# ---------------------------------------------------------------------------
# 운영 환경: settings.oidc_rsa_private_key_pem 에서 PEM 로드 (미구현 시 자동 생성).
# 개발/테스트: 매 기동마다 임시 생성 (재기동 시 기존 ID Token 무효화 — 허용).
# HS256(D4 내부 JWT)와 키 재료를 절대 공유하지 않는다.

def _generate_rsa_key() -> rsa.RSAPrivateKey:
    """2048-bit RSA 키 생성. 운영에서는 파일/환경변수에서 로드해야 함."""
    return rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )


_rsa_private_key: rsa.RSAPrivateKey = _generate_rsa_key()
_rsa_public_key = _rsa_private_key.public_key()

# 키 식별자 (JWKS kid 필드)
_KEY_ID: str = secrets.token_hex(8)

# ---------------------------------------------------------------------------
# In-memory Authorization Code Store
# ---------------------------------------------------------------------------
# 단일 인스턴스용 메모리 저장소. 운영 다중 인스턴스에서는 Redis로 교체 필요.
# key = code (str), value = AuthCode

@dataclass
class AuthCode:
    """Authorization Code 내용물 (1회용, 5분 유효)."""
    code: str
    client_id: str
    redirect_uri: str
    employee_id: int
    email: str
    name: str
    role: str            # employee | leader | admin
    issued_at: float = field(default_factory=time.time)
    expires_in: int = 300  # 5분

    def is_expired(self) -> bool:
        return time.time() > self.issued_at + self.expires_in


_code_store: dict[str, AuthCode] = {}

# ---------------------------------------------------------------------------
# 설정 상수 (settings에 없는 값은 여기서 기본값)
# ---------------------------------------------------------------------------
_ISSUER: str = "https://api.virtualoffice.internal/oidc"  # 운영 시 settings 로드
_ID_TOKEN_EXPIRE_HOURS: int = 1
_SUPPORTED_SCOPES: list[str] = ["openid", "profile", "email"]
_RESPONSE_TYPES: list[str] = ["code"]
_GRANT_TYPES: list[str] = ["authorization_code"]

# ---------------------------------------------------------------------------
# FastAPI Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/oidc", tags=["oidc"])


# ── OIDC Discovery Document ────────────────────────────────────────────────

@router.get("/.well-known/openid-configuration")
async def openid_configuration(request: Request) -> JSONResponse:
    """
    OIDC Discovery Document (RFC 8414).
    WorkAdventure가 OIDC_DISCOVERY_URL 에서 이 문서를 조회한다.
    """
    base = str(request.base_url).rstrip("/") + "/oidc"
    return JSONResponse({
        "issuer": base,
        "authorization_endpoint": f"{base}/authorize",
        "token_endpoint": f"{base}/token",
        "userinfo_endpoint": f"{base}/userinfo",
        "jwks_uri": f"{base}/jwks",
        "scopes_supported": _SUPPORTED_SCOPES,
        "response_types_supported": _RESPONSE_TYPES,
        "grant_types_supported": _GRANT_TYPES,
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "claims_supported": ["sub", "iss", "aud", "exp", "iat", "email", "name", "tags"],
        "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
    })


# ── JWKS (공개키 세트) ─────────────────────────────────────────────────────

def _build_jwks() -> dict:
    """RSA 공개키를 JWK 형태로 직렬화."""
    pub_numbers = _rsa_public_key.public_numbers()
    import base64

    def _b64url(n: int, byte_len: int) -> str:
        return base64.urlsafe_b64encode(
            n.to_bytes(byte_len, "big")
        ).rstrip(b"=").decode()

    return {
        "keys": [
            {
                "kty": "RSA",
                "use": "sig",
                "alg": "RS256",
                "kid": _KEY_ID,
                "n": _b64url(pub_numbers.n, 256),
                "e": _b64url(pub_numbers.e, 3),
            }
        ]
    }


@router.get("/jwks")
async def jwks() -> JSONResponse:
    """JSON Web Key Set — WorkAdventure가 ID Token 서명 검증에 사용."""
    return JSONResponse(_build_jwks())


# ── Authorization Endpoint ────────────────────────────────────────────────

@router.get("/authorize")
async def authorize(
    response_type: str = Query(...),
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    scope: str = Query(default="openid"),
    state: Optional[str] = Query(default=None),
    nonce: Optional[str] = Query(default=None),
) -> HTMLResponse:
    """
    OIDC Authorization Endpoint (Authorization Code Flow).

    GET 요청: 로그인 HTML 폼 반환.
    POST 요청: 자격증명 검증 → Authorization Code 발급 → redirect_uri로 전송.

    스켈레톤: HTML 폼은 최소 구현. 운영 시 Next.js 로그인 페이지로 교체 권장.
    """
    if response_type != "code":
        raise HTTPException(status_code=400, detail="unsupported_response_type")

    # 로그인 폼 렌더링 (스켈레톤 — 운영 시 실제 UI로 교체)
    form_html = f"""
    <!DOCTYPE html>
    <html lang="ko">
    <head><meta charset="utf-8"><title>가상오피스 로그인</title></head>
    <body>
      <h2>가상오피스 로그인</h2>
      <form method="POST" action="/oidc/authorize/submit">
        <input type="hidden" name="client_id" value="{client_id}">
        <input type="hidden" name="redirect_uri" value="{redirect_uri}">
        <input type="hidden" name="state" value="{state or ''}">
        <input type="hidden" name="nonce" value="{nonce or ''}">
        <label>이메일: <input type="email" name="email"></label><br>
        <label>비밀번호: <input type="password" name="password"></label><br>
        <button type="submit">로그인</button>
      </form>
    </body>
    </html>
    """
    return HTMLResponse(form_html)


@router.post("/authorize/submit")
async def authorize_submit(
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    state: str = Form(default=""),
    nonce: str = Form(default=""),
    email: str = Form(...),
    password: str = Form(...),
) -> RedirectResponse:
    """
    Authorization Code 발급 (폼 제출 처리).

    스켈레톤: 사용자 조회는 실제 DB 쿼리로 교체 필요.
    현재는 FastAPI get_db 의존성이 없어 DB 접근 불가 → 운영 시 Depends(get_db) 주입.
    """
    # TODO(Phase 2): DB에서 email 로 ErpUser 조회 후 비밀번호 검증
    # from app.models.tables import ErpUser
    # from app.core.security import verify_password
    # user = await db.execute(select(ErpUser).where(ErpUser.email == email))
    # if not user or not verify_password(password, user.password_hash): ...

    # 스켈레톤: 항상 실패 처리 (실제 구현 전 placeholder)
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="DB 사용자 조회 미구현 — get_db Depends 주입 후 활성화",
    )


def _issue_code(
    client_id: str,
    redirect_uri: str,
    employee_id: int,
    email: str,
    name: str,
    role: str,
) -> str:
    """Authorization Code 생성 및 저장소 등록."""
    code = secrets.token_urlsafe(32)
    _code_store[code] = AuthCode(
        code=code,
        client_id=client_id,
        redirect_uri=redirect_uri,
        employee_id=employee_id,
        email=email,
        name=name,
        role=role,
    )
    return code


# ── Token Endpoint ─────────────────────────────────────────────────────────

def _sign_id_token(
    subject: str,
    email: str,
    name: str,
    role: str,
    audience: str,
    nonce: Optional[str] = None,
) -> str:
    """
    RS256 ID Token 서명.

    WorkAdventure 전용 클레임:
      - tags: role이 admin이면 ["admin"] → WA 지도 편집 권한 제어
      - email, name: WA 닉네임/아바타 표시용

    D4 자체 JWT와의 차이점:
      - 알고리즘: RS256 (D4는 HS256)
      - 대상: WorkAdventure (D4는 관리 API)
      - 키 재료: RSA 키 쌍 (D4는 settings.jwt_secret_key)
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(hours=_ID_TOKEN_EXPIRE_HOURS)

    claims: dict[str, Any] = {
        "iss": _ISSUER,
        "sub": subject,
        "aud": audience,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "email": email,
        "name": name,
        "tags": ["admin"] if role == "admin" else [],
    }
    if nonce:
        claims["nonce"] = nonce

    private_pem = _rsa_private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(
        claims,
        private_pem,
        algorithm="RS256",
        headers={"kid": _KEY_ID},
    )


@router.post("/token")
async def token(
    grant_type: str = Form(...),
    code: str = Form(...),
    redirect_uri: str = Form(...),
    client_id: str = Form(...),
    client_secret: str = Form(default=""),
) -> JSONResponse:
    """
    Token Endpoint — Authorization Code → ID Token 교환.
    WorkAdventure가 Authorization Code를 받은 후 이 엔드포인트를 호출한다.
    """
    if grant_type != "authorization_code":
        raise HTTPException(status_code=400, detail="unsupported_grant_type")

    auth_code = _code_store.pop(code, None)
    if auth_code is None:
        raise HTTPException(status_code=400, detail="invalid_grant: code not found")
    if auth_code.is_expired():
        raise HTTPException(status_code=400, detail="invalid_grant: code expired")
    if auth_code.redirect_uri != redirect_uri:
        raise HTTPException(status_code=400, detail="invalid_grant: redirect_uri mismatch")
    if auth_code.client_id != client_id:
        raise HTTPException(status_code=400, detail="invalid_client")

    id_token = _sign_id_token(
        subject=str(auth_code.employee_id),
        email=auth_code.email,
        name=auth_code.name,
        role=auth_code.role,
        audience=client_id,
    )

    # Access Token: 불투명 토큰 (WA에서 /userinfo 호출용)
    access_token = secrets.token_urlsafe(32)
    # TODO: access_token을 Redis 등에 저장하여 /userinfo 에서 검증

    return JSONResponse({
        "token_type": "Bearer",
        "expires_in": _ID_TOKEN_EXPIRE_HOURS * 3600,
        "access_token": access_token,
        "id_token": id_token,
    })


# ── UserInfo Endpoint ──────────────────────────────────────────────────────

@router.get("/userinfo")
async def userinfo(request: Request) -> JSONResponse:
    """
    UserInfo Endpoint — Access Token으로 사용자 정보 반환.
    스켈레톤: access_token → 사용자 조회 미구현 (Redis/DB 연동 필요).
    """
    # TODO: Authorization 헤더에서 access_token 추출 → Redis 조회 → 사용자 정보 반환
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="userinfo 조회 미구현 — access_token 저장소 연동 필요",
    )


# ---------------------------------------------------------------------------
# 공개 헬퍼 (테스트 및 Lane B docker-compose 설정 생성에서 사용)
# ---------------------------------------------------------------------------

def get_public_key_pem() -> bytes:
    """RSA 공개키 PEM (JWKS 구성, 테스트 검증용)."""
    return _rsa_public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def issue_code_for_test(
    employee_id: int,
    email: str,
    name: str,
    role: str,
    client_id: str = "test-client",
    redirect_uri: str = "https://example.com/callback",
) -> str:
    """테스트 전용 — Authorization Code 직접 발급 (폼 제출 없이)."""
    return _issue_code(
        client_id=client_id,
        redirect_uri=redirect_uri,
        employee_id=employee_id,
        email=email,
        name=name,
        role=role,
    )
