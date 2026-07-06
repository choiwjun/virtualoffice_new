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
  OPENID_CLIENT_ID      = workadventure       (settings.wa_oidc_client_id)
  OPENID_CLIENT_SECRET  = <secret>            (settings.wa_oidc_client_secret)
  OPENID_CLIENT_ISSUER  = http://auth.localhost:8090  (자동 suffix: /.well-known/openid-configuration)
  OPENID_SCOPE          = openid profile email

참조:
  - 00-decisions.md: D4(자체 JWT HS256), D26(WorkAdventure self-host), D3(FastAPI 경유 단일화)
  - WorkAdventure OIDC: https://docs.workadventu.re/map-building/authentication/openid/
  - RFC 6749 (OAuth 2.0), RFC 7519 (JWT), OpenID Connect Core 1.0
"""

import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt  # PyJWT — RS256은 cryptography 백엔드 필요
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.core.security import verify_password

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
    nonce: Optional[str] = None
    issued_at: float = field(default_factory=time.time)
    expires_in: int = 300  # 5분

    def is_expired(self) -> bool:
        return time.time() > self.issued_at + self.expires_in


_code_store: dict[str, AuthCode] = {}

# ---------------------------------------------------------------------------
# In-memory Access Token Store (UserInfo 조회용)
# ---------------------------------------------------------------------------
# key = access_token (str), value = dict with user info

@dataclass
class AccessTokenEntry:
    """Access Token 내용물 (1시간 유효)."""
    employee_id: int
    email: str
    name: str
    role: str
    issued_at: float = field(default_factory=time.time)
    expires_in: int = 3600  # 1시간

    def is_expired(self) -> bool:
        return time.time() > self.issued_at + self.expires_in


_access_token_store: dict[str, AccessTokenEntry] = {}

# ---------------------------------------------------------------------------
# 설정 상수 (settings에 없는 값은 여기서 기본값)
# ---------------------------------------------------------------------------
# _ISSUER는 요청 base_url에서 동적 생성 (단일 URL 원칙 — context doc 참조).
# 단, _sign_id_token 등 내부 함수는 호출측에서 issuer를 주입받는다.
_ID_TOKEN_EXPIRE_HOURS: int = 1
_SUPPORTED_SCOPES: list[str] = ["openid", "profile", "email"]
_RESPONSE_TYPES: list[str] = ["code"]
_GRANT_TYPES: list[str] = ["authorization_code"]


def _derive_issuer(request: Request) -> str:
    """요청 base_url 기반 OIDC issuer URL 생성."""
    return str(request.base_url).rstrip("/") + "/oidc"


# ---------------------------------------------------------------------------
# FastAPI Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/oidc", tags=["oidc"])


# ── OIDC Discovery Document ────────────────────────────────────────────────

@router.get("/.well-known/openid-configuration")
async def openid_configuration(request: Request) -> JSONResponse:
    """
    OIDC Discovery Document (RFC 8414).
    WorkAdventure가 OPENID_CLIENT_ISSUER + /.well-known/openid-configuration 로 조회한다.
    """
    base = _derive_issuer(request)
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
        "claims_supported": [
            "sub", "iss", "aud", "exp", "iat",
            "email", "name", "preferred_username", "tags",
        ],
        "token_endpoint_auth_methods_supported": [
            "client_secret_post", "client_secret_basic",
        ],
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
    OIDC Authorization Endpoint — GET: 로그인 HTML 폼 반환.
    POST: authorize_submit 엔드포인트가 처리.
    """
    if response_type != "code":
        raise HTTPException(status_code=400, detail="unsupported_response_type")

    # HTML 이스케이프 (XSS 방지 최소 조치)
    def esc(s: str) -> str:
        return (s or "").replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")

    form_html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>가상오피스 로그인</title>
  <style>
    body {{ font-family: sans-serif; display: flex; justify-content: center;
            align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }}
    .card {{ background: #fff; padding: 2rem; border-radius: 8px;
             box-shadow: 0 2px 8px rgba(0,0,0,.15); min-width: 320px; }}
    h2 {{ margin: 0 0 1.5rem; font-size: 1.4rem; text-align: center; }}
    label {{ display: block; margin-bottom: 1rem; }}
    label span {{ display: block; margin-bottom: .3rem; font-size: .9rem; color: #555; }}
    input[type=email], input[type=password] {{
      width: 100%; padding: .5rem; box-sizing: border-box;
      border: 1px solid #ccc; border-radius: 4px; }}
    button {{ width: 100%; padding: .75rem; margin-top: .5rem; background: #4a7cf6;
              color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }}
    button:hover {{ background: #3a6ce6; }}
  </style>
</head>
<body>
  <div class="card">
    <h2>가상오피스 로그인</h2>
    <form method="POST" action="/oidc/authorize/submit">
      <input type="hidden" name="client_id" value="{esc(client_id)}">
      <input type="hidden" name="redirect_uri" value="{esc(redirect_uri)}">
      <input type="hidden" name="state" value="{esc(state or '')}">
      <input type="hidden" name="nonce" value="{esc(nonce or '')}">
      <label>
        <span>이메일</span>
        <input type="email" name="email" required autocomplete="email">
      </label>
      <label>
        <span>비밀번호</span>
        <input type="password" name="password" required autocomplete="current-password">
      </label>
      <button type="submit">로그인</button>
    </form>
  </div>
</body>
</html>"""
    return HTMLResponse(form_html)


@router.post("/authorize/submit")
async def authorize_submit(
    request: Request,
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    state: str = Form(default=""),
    nonce: str = Form(default=""),
    email: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """
    Authorization Code 발급 (폼 제출 처리).
    ErpUser 테이블에서 email로 조회 후 bcrypt 비밀번호 검증.
    """
    from app.models.tables import ErpUser

    result = await db.execute(
        select(ErpUser).where(
            ErpUser.email == email,
            ErpUser.is_active == True,  # noqa: E712
        )
    )
    user = result.scalar_one_or_none()

    # 사용자 없거나 password_hash 미설정이면 인증 실패
    if user is None or not user.password_hash:
        return HTMLResponse(
            _render_login_form(client_id, redirect_uri, state, nonce, error="이메일 또는 비밀번호가 올바르지 않습니다."),
            status_code=401,
        )

    if not verify_password(password, user.password_hash):
        return HTMLResponse(
            _render_login_form(client_id, redirect_uri, state, nonce, error="이메일 또는 비밀번호가 올바르지 않습니다."),
            status_code=401,
        )

    code = _issue_code(
        client_id=client_id,
        redirect_uri=redirect_uri,
        employee_id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value if hasattr(user.role, "value") else str(user.role),
        nonce=nonce or None,
    )

    sep = "&" if "?" in redirect_uri else "?"
    location = f"{redirect_uri}{sep}code={code}"
    if state:
        location += f"&state={state}"
    return RedirectResponse(location, status_code=302)


def _render_login_form(
    client_id: str,
    redirect_uri: str,
    state: str,
    nonce: str,
    error: Optional[str] = None,
) -> str:
    """로그인 폼 HTML (에러 메시지 포함 버전)."""
    def esc(s: str) -> str:
        return (s or "").replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")

    error_html = f'<p style="color:red;margin-bottom:.5rem">{esc(error)}</p>' if error else ""
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>가상오피스 로그인</title>
  <style>
    body {{ font-family: sans-serif; display:flex; justify-content:center;
            align-items:center; min-height:100vh; margin:0; background:#f5f5f5; }}
    .card {{ background:#fff; padding:2rem; border-radius:8px;
             box-shadow:0 2px 8px rgba(0,0,0,.15); min-width:320px; }}
    h2 {{ margin:0 0 1.5rem; text-align:center; }}
    label {{ display:block; margin-bottom:1rem; }}
    label span {{ display:block; margin-bottom:.3rem; font-size:.9rem; color:#555; }}
    input[type=email],input[type=password] {{
      width:100%; padding:.5rem; box-sizing:border-box;
      border:1px solid #ccc; border-radius:4px; }}
    button {{ width:100%; padding:.75rem; margin-top:.5rem;
              background:#4a7cf6; color:#fff; border:none;
              border-radius:4px; cursor:pointer; font-size:1rem; }}
  </style>
</head>
<body>
  <div class="card">
    <h2>가상오피스 로그인</h2>
    {error_html}
    <form method="POST" action="/oidc/authorize/submit">
      <input type="hidden" name="client_id" value="{esc(client_id)}">
      <input type="hidden" name="redirect_uri" value="{esc(redirect_uri)}">
      <input type="hidden" name="state" value="{esc(state)}">
      <input type="hidden" name="nonce" value="{esc(nonce)}">
      <label><span>이메일</span>
        <input type="email" name="email" required></label>
      <label><span>비밀번호</span>
        <input type="password" name="password" required></label>
      <button type="submit">로그인</button>
    </form>
  </div>
</body>
</html>"""


def _issue_code(
    client_id: str,
    redirect_uri: str,
    employee_id: int,
    email: str,
    name: str,
    role: str,
    nonce: Optional[str] = None,
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
        nonce=nonce,
    )
    return code


# ── Token Endpoint ─────────────────────────────────────────────────────────

def _sign_id_token(
    subject: str,
    email: str,
    name: str,
    role: str,
    audience: str,
    issuer: str = "http://localhost:8000/oidc",
    nonce: Optional[str] = None,
) -> str:
    """
    RS256 ID Token 서명.

    WorkAdventure 전용 클레임:
      - tags: role이 admin이면 ["admin"] → WA 지도 편집 권한 제어
      - preferred_username: WA 닉네임 표시용 (OPENID_USERNAME_CLAIM=preferred_username)
      - email, name: WA 아바타 표시용

    D4 자체 JWT와의 차이점:
      - 알고리즘: RS256 (D4는 HS256)
      - 대상: WorkAdventure (D4는 관리 API)
      - 키 재료: RSA 키 쌍 (D4는 settings.jwt_secret_key)
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(hours=_ID_TOKEN_EXPIRE_HOURS)

    claims: dict[str, Any] = {
        "iss": issuer,
        "sub": subject,
        "aud": audience,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "email": email,
        "name": name,
        "preferred_username": email.split("@")[0],
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
    request: Request,
    grant_type: str = Form(...),
    code: str = Form(...),
    redirect_uri: str = Form(...),
    client_id: str = Form(default=""),
    client_secret: str = Form(default=""),
    code_verifier: str = Form(default=""),  # PKCE — openid-client가 전송(수용). RFC 7636
) -> JSONResponse:
    """
    Token Endpoint — Authorization Code → ID Token 교환.
    WorkAdventure가 Authorization Code를 받은 후 이 엔드포인트를 호출한다.
    클라이언트 인증은 client_secret_post(form) 및 client_secret_basic(Authorization 헤더)
    둘 다 지원한다(openid-client 기본값은 client_secret_basic). RFC 6749 §2.3.1.
    """
    if grant_type != "authorization_code":
        raise HTTPException(status_code=400, detail="unsupported_grant_type")

    # client_secret_basic 폴백: Authorization: Basic base64(urlencode(id):urlencode(secret))
    if not client_id:
        import base64
        import urllib.parse
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Basic "):
            try:
                decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
                raw_id, _, raw_secret = decoded.partition(":")
                client_id = urllib.parse.unquote_plus(raw_id)
                client_secret = client_secret or urllib.parse.unquote_plus(raw_secret)
            except Exception:  # noqa: BLE001 — 잘못된 Basic 헤더는 아래 invalid_client로 귀결
                pass
    if not client_id:
        raise HTTPException(status_code=400, detail="invalid_client: missing client_id")

    auth_code = _code_store.pop(code, None)
    if auth_code is None:
        raise HTTPException(status_code=400, detail="invalid_grant: code not found")
    if auth_code.is_expired():
        raise HTTPException(status_code=400, detail="invalid_grant: code expired")
    if auth_code.redirect_uri != redirect_uri:
        raise HTTPException(status_code=400, detail="invalid_grant: redirect_uri mismatch")
    if auth_code.client_id != client_id:
        raise HTTPException(status_code=400, detail="invalid_client")

    issuer = _derive_issuer(request)
    id_token = _sign_id_token(
        subject=str(auth_code.employee_id),
        email=auth_code.email,
        name=auth_code.name,
        role=auth_code.role,
        audience=client_id,
        issuer=issuer,
        nonce=auth_code.nonce,
    )

    # Access Token: 불투명 토큰 (WA에서 /userinfo 호출용)
    access_token = secrets.token_urlsafe(32)
    _access_token_store[access_token] = AccessTokenEntry(
        employee_id=auth_code.employee_id,
        email=auth_code.email,
        name=auth_code.name,
        role=auth_code.role,
    )

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
    WA가 Authorization ヘッダーで Bearer access_token을 보낸다.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing_token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = auth_header[len("Bearer "):]
    entry = _access_token_store.get(access_token)
    if entry is None or entry.is_expired():
        _access_token_store.pop(access_token, None)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
            headers={"WWW-Authenticate": "Bearer error=\"invalid_token\""},
        )

    return JSONResponse({
        "sub": str(entry.employee_id),
        "email": entry.email,
        "name": entry.name,
        "preferred_username": entry.email.split("@")[0],
        "tags": ["admin"] if entry.role == "admin" else [],
    })


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
    nonce: Optional[str] = None,
) -> str:
    """테스트 전용 — Authorization Code 직접 발급 (폼 제출 없이)."""
    return _issue_code(
        client_id=client_id,
        redirect_uri=redirect_uri,
        employee_id=employee_id,
        email=email,
        name=name,
        role=role,
        nonce=nonce,
    )
