"""
G001 인증 API 적대적(red-team) e2e 테스트.

목적: 정상 플로우가 아니라 '깨뜨리려는' 시도가 전부 안전하게 거부/처리되는지 검증한다.
contract/ 가 아니므로 skip 대상이 아니며, 실제 앱(app.main:app)을 httpx AsyncClient로
그대로 호출한다(ASGITransport, conftest.async_client 재사용).

정본: docs/planning/00-decisions.md D4 (JWT HS256 자체시크릿).
대상: POST /auth/login, POST /auth/refresh, GET /auth/me.
"""

from datetime import timedelta

import jwt
import pytest
from httpx import AsyncClient

from app.config import settings
from app.core.security import create_access_token


# ============================================================================
# 1) 변조된 JWT (서명 조작) → /auth/me 401
# ============================================================================
@pytest.mark.asyncio
async def test_tampered_signature_rejected(async_client: AsyncClient, employee_token: str):
    # 유효 토큰의 마지막 서명 세그먼트를 훼손한다.
    header, payload, signature = employee_token.split(".")
    tampered_signature = ("a" if signature[0] != "a" else "b") + signature[1:]
    tampered = f"{header}.{payload}.{tampered_signature}"

    resp = await async_client.get(
        "/auth/me", headers={"Authorization": f"Bearer {tampered}"}
    )
    assert resp.status_code == 401


# ============================================================================
# 2) 만료된 access token → /auth/me 401
# ============================================================================
@pytest.mark.asyncio
async def test_expired_token_rejected(async_client: AsyncClient):
    expired = create_access_token(
        {"sub": "1", "email": "employee@example.com", "role": "employee"},
        expires_delta=timedelta(seconds=-1),
    )
    resp = await async_client.get(
        "/auth/me", headers={"Authorization": f"Bearer {expired}"}
    )
    assert resp.status_code == 401


# ============================================================================
# 3) alg=none / 다른 시크릿 서명 토큰 → /auth/me 401
# ============================================================================
@pytest.mark.asyncio
async def test_alg_none_token_rejected(async_client: AsyncClient):
    claims = {"sub": "1", "email": "employee@example.com", "role": "employee"}
    # PyJWT는 alg=none 인코딩을 허용하지 않을 수 있으므로 raw 세그먼트를 직접 구성한다.
    import base64
    import json

    def _b64url(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    header = _b64url(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    body = _b64url(json.dumps(claims).encode())
    none_token = f"{header}.{body}."

    resp = await async_client.get(
        "/auth/me", headers={"Authorization": f"Bearer {none_token}"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_wrong_secret_token_rejected(async_client: AsyncClient):
    forged = jwt.encode(
        {"sub": "1", "email": "employee@example.com", "role": "employee"},
        "attacker-controlled-secret-not-ours",
        algorithm=settings.jwt_algorithm,
    )
    resp = await async_client.get(
        "/auth/me", headers={"Authorization": f"Bearer {forged}"}
    )
    assert resp.status_code == 401


# ============================================================================
# 4) Authorization 헤더 누락 → /auth/me 401
# ============================================================================
@pytest.mark.asyncio
async def test_missing_authorization_header_rejected(async_client: AsyncClient):
    resp = await async_client.get("/auth/me")
    assert resp.status_code == 401


# ============================================================================
# 5) SQL 인젝션 시도 → 401, 예외/500 없음
# ============================================================================
@pytest.mark.asyncio
async def test_sql_injection_login_rejected_safely(
    async_client: AsyncClient, test_user: dict
):
    resp = await async_client.post(
        "/auth/login",
        json={"email": "' OR '1'='1", "password": "' OR '1'='1"},
    )
    assert resp.status_code == 401
    assert resp.json().get("detail") == "invalid_credentials"


@pytest.mark.asyncio
async def test_sql_injection_does_not_bypass_with_valid_looking_password(
    async_client: AsyncClient, test_user: dict
):
    # 시드 사용자 이메일 뒤에 인젝션 페이로드를 덧붙여도 우회되지 않아야 한다.
    resp = await async_client.post(
        "/auth/login",
        json={
            "email": "testuser@example.com' -- ",
            "password": "anything",
        },
    )
    assert resp.status_code == 401
    assert resp.json().get("detail") == "invalid_credentials"


# ============================================================================
# 6) 틀린 비밀번호 / 존재하지 않는 이메일 → 401, 계정 존재여부 미노출
# ============================================================================
@pytest.mark.asyncio
async def test_correct_email_wrong_password_rejected(
    async_client: AsyncClient, test_user: dict
):
    resp = await async_client.post(
        "/auth/login",
        json={"email": "testuser@example.com", "password": "WrongPass999!"},
    )
    assert resp.status_code == 401
    assert resp.json().get("detail") == "invalid_credentials"


@pytest.mark.asyncio
async def test_nonexistent_email_rejected_with_same_message(
    async_client: AsyncClient, test_user: dict
):
    resp = await async_client.post(
        "/auth/login",
        json={"email": "nobody-such-user@example.com", "password": "WhoCares123!"},
    )
    assert resp.status_code == 401
    assert resp.json().get("detail") == "invalid_credentials"


@pytest.mark.asyncio
async def test_wrong_password_and_nonexistent_email_share_identical_response(
    async_client: AsyncClient, test_user: dict
):
    # 사용자 존재 여부를 응답으로 구분할 수 없어야 한다(사용자 열거 공격 방지).
    resp_wrong_pw = await async_client.post(
        "/auth/login",
        json={"email": "testuser@example.com", "password": "WrongPass999!"},
    )
    resp_no_user = await async_client.post(
        "/auth/login",
        json={"email": "nobody-such-user@example.com", "password": "WhoCares123!"},
    )
    assert resp_wrong_pw.status_code == resp_no_user.status_code == 401
    assert resp_wrong_pw.json() == resp_no_user.json()


@pytest.mark.asyncio
async def test_nonexistent_account_repeated_login_attempts_stay_401_with_dummy_verify(
    async_client: AsyncClient,
):
    # code MEDIUM(G010 architect): miss 경로(계정 미존재)에서도 더미 bcrypt verify를 실행해
    # 타이밍을 평준화한다 — 더미 verify 실행 경로가 예외 없이 매번 401을 반환하는지 확인한다.
    for _ in range(3):
        resp = await async_client.post(
            "/auth/login",
            json={"email": "ghost-timing-probe@example.com", "password": "WhoCares123!"},
        )
        assert resp.status_code == 401
        assert resp.json().get("detail") == "invalid_credentials"


# ============================================================================
# 7) 필수 필드 누락/공백 → 400
# ============================================================================
@pytest.mark.asyncio
async def test_empty_password_rejected_400(async_client: AsyncClient, test_user: dict):
    resp = await async_client.post(
        "/auth/login", json={"email": "testuser@example.com", "password": ""}
    )
    assert resp.status_code == 400
    assert resp.json().get("detail") == "missing_required_field"


@pytest.mark.asyncio
async def test_whitespace_password_treated_as_missing_or_rejected(
    async_client: AsyncClient, test_user: dict
):
    # 공백만 있는 비밀번호는 (a) 400 missing_required_field 이거나
    # (b) 자격증명 검증에 실패해 401 이어야 한다 — 어느 쪽이든 로그인은 성사되면 안 된다.
    resp = await async_client.post(
        "/auth/login", json={"email": "testuser@example.com", "password": "   "}
    )
    assert resp.status_code in (400, 401)


@pytest.mark.asyncio
async def test_missing_email_field_rejected_400(async_client: AsyncClient):
    resp = await async_client.post("/auth/login", json={"password": "TestPass123!"})
    assert resp.status_code == 400
    assert resp.json().get("detail") == "missing_required_field"


@pytest.mark.asyncio
async def test_missing_password_field_rejected_400(async_client: AsyncClient):
    resp = await async_client.post(
        "/auth/login", json={"email": "testuser@example.com"}
    )
    assert resp.status_code == 400
    assert resp.json().get("detail") == "missing_required_field"


# ============================================================================
# 8) refresh: 무효 문자열/빈값 → 401, 유효 토큰 → 200 & 새 토큰
# ============================================================================
@pytest.mark.asyncio
async def test_refresh_with_garbage_string_rejected(async_client: AsyncClient):
    resp = await async_client.post(
        "/auth/refresh", json={"refresh_token": "not-a-real-jwt-at-all"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_with_empty_token_rejected(async_client: AsyncClient):
    resp = await async_client.post("/auth/refresh", json={"refresh_token": ""})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_missing_field_rejected(async_client: AsyncClient):
    resp = await async_client.post("/auth/refresh", json={})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_with_valid_token_issues_new_tokens(async_client: AsyncClient):
    refresh_token = create_access_token(
        {
            "sub": "1",
            "email": "employee@example.com",
            "role": "employee",
            "type": "refresh",
        },
        expires_delta=timedelta(days=7),
    )
    resp = await async_client.post(
        "/auth/refresh", json={"refresh_token": refresh_token}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "token" in body and body["token"]
    assert "refresh_token" in body and body["refresh_token"]
    assert body["expires_in"] > 0


@pytest.mark.asyncio
async def test_refresh_with_expired_refresh_token_rejected(async_client: AsyncClient):
    expired_refresh = create_access_token(
        {
            "sub": "1",
            "email": "employee@example.com",
            "role": "employee",
            "type": "refresh",
        },
        expires_delta=timedelta(seconds=-1),
    )
    resp = await async_client.post(
        "/auth/refresh", json={"refresh_token": expired_refresh}
    )
    assert resp.status_code == 401


# ============================================================================
# 9) 로그인 성공 응답에 민감 필드(password_hash 등) 미노출
# ============================================================================
@pytest.mark.asyncio
async def test_login_success_does_not_leak_sensitive_fields(
    async_client: AsyncClient, test_user: dict
):
    resp = await async_client.post(
        "/auth/login",
        json={"email": "testuser@example.com", "password": "TestPass123!"},
    )
    assert resp.status_code == 201
    body = resp.json()
    user = body.get("user", {})
    assert set(user.keys()) == {"id", "email", "name", "role"}
    for forbidden_key in ("password", "password_hash", "hashed_password"):
        assert forbidden_key not in user
        assert forbidden_key not in body
    # 응답 원문 전체에도 해시 흔적이 없어야 한다(직렬화 우회 누출 방지).
    raw_text = resp.text
    assert "$2b$" not in raw_text  # bcrypt 해시 프리픽스
