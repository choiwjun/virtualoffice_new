"""
OIDC 브리지 단위 테스트 — backend/app/integrations/workadventure/oidc.py

범위:
  - OIDC Discovery 문서 구조 검증
  - JWKS 공개키 세트 구조 검증
  - RS256 ID Token 서명·검증 (공개키 사용)
  - Authorization Code 발급·소비·만료 흐름
  - Token Endpoint 응답 구조
  - D4 자체 JWT(HS256)와 OIDC ID Token(RS256) 알고리즘 분리 확인

참조: 00-decisions.md D4, D26
"""

import time
from datetime import timedelta

import jwt  # PyJWT
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.security import create_access_token, decode_access_token
from app.integrations.workadventure.oidc import (
    AuthCode,
    _KEY_ID,
    _SUPPORTED_SCOPES,
    _build_jwks,
    _code_store,
    _sign_id_token,
    get_public_key_pem,
    issue_code_for_test,
    router as oidc_router,
)


# ---------------------------------------------------------------------------
# 픽스처: OIDC 라우터만 포함한 테스트 앱
# ---------------------------------------------------------------------------

@pytest.fixture
def oidc_app() -> FastAPI:
    app = FastAPI()
    app.include_router(oidc_router)
    return app


@pytest.fixture
async def oidc_client(oidc_app: FastAPI) -> AsyncClient:
    async with AsyncClient(
        transport=ASGITransport(app=oidc_app),
        base_url="http://test",
    ) as client:
        yield client


@pytest.fixture(autouse=True)
def clear_code_store():
    """각 테스트 전후 code store 초기화."""
    _code_store.clear()
    yield
    _code_store.clear()


# ---------------------------------------------------------------------------
# OIDC Discovery Document
# ---------------------------------------------------------------------------

class TestOidcDiscovery:
    async def test_discovery_returns_200(self, oidc_client: AsyncClient):
        resp = await oidc_client.get("/oidc/.well-known/openid-configuration")
        assert resp.status_code == 200

    async def test_discovery_required_fields(self, oidc_client: AsyncClient):
        body = (await oidc_client.get("/oidc/.well-known/openid-configuration")).json()
        required = {
            "issuer",
            "authorization_endpoint",
            "token_endpoint",
            "userinfo_endpoint",
            "jwks_uri",
            "scopes_supported",
            "response_types_supported",
            "grant_types_supported",
            "id_token_signing_alg_values_supported",
        }
        assert required.issubset(body.keys())

    async def test_discovery_scopes(self, oidc_client: AsyncClient):
        body = (await oidc_client.get("/oidc/.well-known/openid-configuration")).json()
        assert "openid" in body["scopes_supported"]
        assert "email" in body["scopes_supported"]

    async def test_discovery_rs256_advertised(self, oidc_client: AsyncClient):
        body = (await oidc_client.get("/oidc/.well-known/openid-configuration")).json()
        assert "RS256" in body["id_token_signing_alg_values_supported"]

    async def test_discovery_endpoints_contain_oidc_prefix(self, oidc_client: AsyncClient):
        body = (await oidc_client.get("/oidc/.well-known/openid-configuration")).json()
        assert "/oidc/authorize" in body["authorization_endpoint"]
        assert "/oidc/token" in body["token_endpoint"]
        assert "/oidc/jwks" in body["jwks_uri"]


# ---------------------------------------------------------------------------
# JWKS 공개키 세트
# ---------------------------------------------------------------------------

class TestJwks:
    async def test_jwks_returns_200(self, oidc_client: AsyncClient):
        resp = await oidc_client.get("/oidc/jwks")
        assert resp.status_code == 200

    async def test_jwks_has_keys_array(self, oidc_client: AsyncClient):
        body = (await oidc_client.get("/oidc/jwks")).json()
        assert "keys" in body
        assert isinstance(body["keys"], list)
        assert len(body["keys"]) >= 1

    async def test_jwks_key_fields(self, oidc_client: AsyncClient):
        body = (await oidc_client.get("/oidc/jwks")).json()
        key = body["keys"][0]
        assert key["kty"] == "RSA"
        assert key["alg"] == "RS256"
        assert key["use"] == "sig"
        assert "n" in key and "e" in key
        assert "kid" in key

    def test_build_jwks_returns_rsa_key(self):
        jwks = _build_jwks()
        assert len(jwks["keys"]) == 1
        key = jwks["keys"][0]
        assert key["kty"] == "RSA"
        assert key["kid"] == _KEY_ID


# ---------------------------------------------------------------------------
# RS256 ID Token 서명·검증
# ---------------------------------------------------------------------------

class TestIdTokenSigning:
    def test_id_token_is_jwt(self):
        token = _sign_id_token(
            subject="42",
            email="alice@example.com",
            name="Alice",
            role="employee",
            audience="test-client",
        )
        assert isinstance(token, str)
        # JWT는 점 2개로 구분된 3개 파트
        assert token.count(".") == 2

    def test_id_token_algorithm_is_rs256(self):
        token = _sign_id_token("1", "a@b.com", "A", "employee", "aud")
        header = jwt.get_unverified_header(token)
        assert header["alg"] == "RS256"

    def test_id_token_verifiable_with_public_key(self):
        token = _sign_id_token("99", "bob@company.com", "Bob", "leader", "wa-client")
        pub_pem = get_public_key_pem()
        decoded = jwt.decode(token, pub_pem, algorithms=["RS256"], audience="wa-client")
        assert decoded["sub"] == "99"
        assert decoded["email"] == "bob@company.com"
        assert decoded["name"] == "Bob"

    def test_id_token_claims_present(self):
        token = _sign_id_token("5", "x@y.com", "X", "admin", "aud")
        pub_pem = get_public_key_pem()
        decoded = jwt.decode(token, pub_pem, algorithms=["RS256"], audience="aud")
        assert "iss" in decoded
        assert "sub" in decoded
        assert "exp" in decoded
        assert "iat" in decoded
        assert "email" in decoded
        assert "tags" in decoded

    def test_admin_gets_admin_tag(self):
        token = _sign_id_token("3", "admin@co.com", "Admin", "admin", "aud")
        pub_pem = get_public_key_pem()
        decoded = jwt.decode(token, pub_pem, algorithms=["RS256"], audience="aud")
        assert "admin" in decoded["tags"]

    def test_employee_has_empty_tags(self):
        token = _sign_id_token("7", "emp@co.com", "Emp", "employee", "aud")
        pub_pem = get_public_key_pem()
        decoded = jwt.decode(token, pub_pem, algorithms=["RS256"], audience="aud")
        assert decoded["tags"] == []

    def test_nonce_included_when_provided(self):
        token = _sign_id_token("1", "a@b.com", "A", "employee", "aud", nonce="abc123")
        header = jwt.get_unverified_header(token)
        pub_pem = get_public_key_pem()
        decoded = jwt.decode(token, pub_pem, algorithms=["RS256"], audience="aud")
        assert decoded.get("nonce") == "abc123"

    def test_id_token_uses_rsa_not_hmac(self):
        """D4 HS256 시크릿으로 OIDC ID Token을 검증 시도하면 실패해야 함."""
        from app.config import settings
        token = _sign_id_token("1", "a@b.com", "A", "employee", "aud")
        with pytest.raises(Exception):
            jwt.decode(token, settings.jwt_secret_key, algorithms=["HS256"])


# ---------------------------------------------------------------------------
# D4 자체 JWT vs OIDC ID Token 분리 검증
# ---------------------------------------------------------------------------

class TestJwtSeparation:
    def test_d4_jwt_is_hs256(self):
        """D4 내부 JWT는 HS256을 사용해야 함."""
        token = create_access_token({"sub": "1", "role": "employee", "email": "a@b.com"})
        header = jwt.get_unverified_header(token)
        assert header["alg"] == "HS256"

    def test_oidc_id_token_is_rs256(self):
        """OIDC ID Token은 RS256을 사용해야 함."""
        token = _sign_id_token("1", "a@b.com", "A", "employee", "aud")
        header = jwt.get_unverified_header(token)
        assert header["alg"] == "RS256"

    def test_d4_jwt_not_verifiable_as_oidc(self):
        """D4 JWT를 RSA 공개키로 검증하면 실패해야 함."""
        d4_token = create_access_token({"sub": "1", "role": "employee", "email": "a@b.com"})
        pub_pem = get_public_key_pem()
        with pytest.raises(Exception):
            jwt.decode(d4_token, pub_pem, algorithms=["RS256"])

    def test_sub_claim_format_consistent(self):
        """두 토큰의 sub = employee_id 문자열 (정수 ID를 str로) 규칙 일치."""
        employee_id = 42
        d4_token = create_access_token({"sub": str(employee_id), "role": "employee", "email": "a@b.com"})
        oidc_token = _sign_id_token(str(employee_id), "a@b.com", "Alice", "employee", "aud")

        d4_decoded = decode_access_token(d4_token)
        pub_pem = get_public_key_pem()
        oidc_decoded = jwt.decode(oidc_token, pub_pem, algorithms=["RS256"], audience="aud")

        assert d4_decoded["sub"] == oidc_decoded["sub"] == str(employee_id)


# ---------------------------------------------------------------------------
# Authorization Code 흐름
# ---------------------------------------------------------------------------

class TestAuthorizationCode:
    def test_issue_code_returns_string(self):
        code = issue_code_for_test(
            employee_id=1,
            email="alice@example.com",
            name="Alice",
            role="employee",
        )
        assert isinstance(code, str)
        assert len(code) > 10

    def test_issued_code_stored(self):
        code = issue_code_for_test(1, "a@b.com", "A", "employee")
        assert code in _code_store

    def test_auth_code_fields(self):
        code = issue_code_for_test(
            employee_id=7,
            email="charlie@co.com",
            name="Charlie",
            role="leader",
            client_id="wa-client",
            redirect_uri="https://wa.example.com/callback",
        )
        ac = _code_store[code]
        assert ac.employee_id == 7
        assert ac.email == "charlie@co.com"
        assert ac.role == "leader"
        assert not ac.is_expired()

    def test_code_expires(self):
        code = issue_code_for_test(1, "a@b.com", "A", "employee")
        ac = _code_store[code]
        # 수동으로 만료 시간 앞당기기
        object.__setattr__(ac, "issued_at", time.time() - 400)
        assert ac.is_expired()

    def test_different_employees_get_unique_codes(self):
        code1 = issue_code_for_test(1, "a@b.com", "A", "employee")
        code2 = issue_code_for_test(2, "b@b.com", "B", "employee")
        assert code1 != code2


# ---------------------------------------------------------------------------
# Token Endpoint (HTTP)
# ---------------------------------------------------------------------------

class TestTokenEndpoint:
    async def test_token_exchange_success(self, oidc_client: AsyncClient):
        """유효한 code → 200 + id_token 포함."""
        code = issue_code_for_test(
            employee_id=5,
            email="dave@corp.com",
            name="Dave",
            role="employee",
            client_id="wa-client",
            redirect_uri="https://wa.example.com/cb",
        )
        resp = await oidc_client.post(
            "/oidc/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": "https://wa.example.com/cb",
                "client_id": "wa-client",
                "client_secret": "secret",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "id_token" in body
        assert "access_token" in body
        assert body["token_type"] == "Bearer"

    async def test_token_id_token_verifiable(self, oidc_client: AsyncClient):
        """Token Endpoint가 반환하는 id_token을 RSA 공개키로 검증 가능."""
        code = issue_code_for_test(5, "dave@corp.com", "Dave", "employee", "wa-client", "https://wa.example.com/cb")
        resp = await oidc_client.post(
            "/oidc/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": "https://wa.example.com/cb",
                "client_id": "wa-client",
                "client_secret": "secret",
            },
        )
        id_token = resp.json()["id_token"]
        pub_pem = get_public_key_pem()
        decoded = jwt.decode(id_token, pub_pem, algorithms=["RS256"], audience="wa-client")
        assert decoded["sub"] == "5"
        assert decoded["email"] == "dave@corp.com"

    async def test_token_code_consumed(self, oidc_client: AsyncClient):
        """code는 1회만 사용 가능 — 재사용 시 400."""
        code = issue_code_for_test(5, "dave@corp.com", "Dave", "employee", "wa-client", "https://cb")
        params = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": "https://cb",
            "client_id": "wa-client",
            "client_secret": "s",
        }
        resp1 = await oidc_client.post("/oidc/token", data=params)
        assert resp1.status_code == 200
        resp2 = await oidc_client.post("/oidc/token", data=params)
        assert resp2.status_code == 400

    async def test_token_invalid_code(self, oidc_client: AsyncClient):
        resp = await oidc_client.post(
            "/oidc/token",
            data={
                "grant_type": "authorization_code",
                "code": "invalid-nonexistent",
                "redirect_uri": "https://cb",
                "client_id": "wa-client",
                "client_secret": "s",
            },
        )
        assert resp.status_code == 400

    async def test_token_unsupported_grant_type(self, oidc_client: AsyncClient):
        resp = await oidc_client.post(
            "/oidc/token",
            data={
                "grant_type": "implicit",
                "code": "x",
                "redirect_uri": "https://cb",
                "client_id": "wa-client",
                "client_secret": "s",
            },
        )
        assert resp.status_code == 400

    async def test_token_redirect_uri_mismatch(self, oidc_client: AsyncClient):
        code = issue_code_for_test(5, "dave@corp.com", "Dave", "employee", "wa-client", "https://correct-uri")
        resp = await oidc_client.post(
            "/oidc/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": "https://wrong-uri",
                "client_id": "wa-client",
                "client_secret": "s",
            },
        )
        assert resp.status_code == 400

    async def test_authorize_returns_html_form(self, oidc_client: AsyncClient):
        resp = await oidc_client.get(
            "/oidc/authorize",
            params={
                "response_type": "code",
                "client_id": "wa-client",
                "redirect_uri": "https://wa.example.com/cb",
                "scope": "openid email",
            },
        )
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]
        assert "로그인" in resp.text
