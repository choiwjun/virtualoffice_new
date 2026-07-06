"""
인증 엔드포인트 테스트.

정본: 00-decisions.md D4 (JWT HS256 자체 시크릿, ERP 미공유).
커버리지:
- POST /api/auth/login: 성공(alice/password123) → 토큰 발급
- POST /api/auth/login: 오답 비밀번호 → 401
- POST /api/auth/login: 존재하지 않는 이메일 → 401
- GET /api/auth/me: 유효 토큰 → 사용자 정보
- GET /api/auth/me: 잘못된 토큰 → 401
- GET /api/auth/me: 토큰 없음 → 401
- POST /api/auth/refresh: 유효 토큰 → 새 토큰 재발급
- POST /api/auth/refresh: 잘못된 토큰 → 401
- POST /api/auth/login: is_active=False 계정 → 401
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password
from app.models.tables import ErpRole, ErpUser


# ── 픽스처: 테스트 DB에 시드 사용자 삽입 ──────────────────────────────────────

@pytest.fixture
async def seed_users(db_session: AsyncSession):
    """
    테스트 사용자 3명 삽입 (seed_dev.py와 동일한 id/email/password).
    conftest의 db_session(인메모리, 테스트별 격리)에 삽입.
    """
    users = [
        ErpUser(
            id=1001,
            company_id=1,
            email="alice@virtualoffice.local",
            name="김앨리스",
            erp_team_id=1,
            role=ErpRole.ADMIN,
            position="CTO",
            password_hash=hash_password("password123"),
            is_active=True,
        ),
        ErpUser(
            id=1002,
            company_id=1,
            email="bob@virtualoffice.local",
            name="이밥",
            erp_team_id=1,
            role=ErpRole.LEADER,
            position="개발팀장",
            password_hash=hash_password("password123"),
            is_active=True,
        ),
        ErpUser(
            id=1003,
            company_id=1,
            email="charlie@virtualoffice.local",
            name="박찰리",
            erp_team_id=2,
            role=ErpRole.EMPLOYEE,
            position="디자이너",
            password_hash=hash_password("password123"),
            is_active=True,
        ),
    ]
    for u in users:
        db_session.add(u)
    await db_session.commit()
    return users


# ── POST /api/auth/login ──────────────────────────────────────────────────────

async def test_login_success_returns_token(async_client, seed_users):
    """alice/password123 로그인 → access_token 발급, 200."""
    resp = await async_client.post(
        "/api/auth/login",
        json={"email": "alice@virtualoffice.local", "password": "password123"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0
    assert body["user"]["email"] == "alice@virtualoffice.local"
    assert body["user"]["role"] == "admin"
    assert body["user"]["id"] == 1001


async def test_login_wrong_password_returns_401(async_client, seed_users):
    """잘못된 비밀번호 → 401."""
    resp = await async_client.post(
        "/api/auth/login",
        json={"email": "alice@virtualoffice.local", "password": "WRONG"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "invalid_credentials"


async def test_login_unknown_email_returns_401(async_client, seed_users):
    """존재하지 않는 이메일 → 401."""
    resp = await async_client.post(
        "/api/auth/login",
        json={"email": "nobody@virtualoffice.local", "password": "password123"},
    )
    assert resp.status_code == 401


async def test_login_inactive_user_returns_401(async_client, db_session, seed_users):
    """is_active=False 계정 → 401 (soft-delete D18)."""
    # alice 비활성화
    alice = seed_users[0]
    alice.is_active = False
    await db_session.commit()

    resp = await async_client.post(
        "/api/auth/login",
        json={"email": "alice@virtualoffice.local", "password": "password123"},
    )
    assert resp.status_code == 401


async def test_login_no_password_hash_returns_401(async_client, db_session, seed_users):
    """password_hash 미설정 계정(ERP 전용) → 401."""
    alice = seed_users[0]
    alice.password_hash = None
    await db_session.commit()

    resp = await async_client.post(
        "/api/auth/login",
        json={"email": "alice@virtualoffice.local", "password": "password123"},
    )
    assert resp.status_code == 401


# ── GET /api/auth/me ─────────────────────────────────────────────────────────

async def test_me_with_valid_token(async_client, seed_users):
    """유효 토큰으로 /me 조회 → 사용자 정보 반환."""
    # 먼저 로그인하여 실제 토큰 획득
    resp = await async_client.post(
        "/api/auth/login",
        json={"email": "alice@virtualoffice.local", "password": "password123"},
    )
    token = resp.json()["access_token"]

    me_resp = await async_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_resp.status_code == 200, me_resp.text
    body = me_resp.json()
    assert body["email"] == "alice@virtualoffice.local"
    assert body["name"] == "김앨리스"
    assert body["role"] == "admin"
    assert body["id"] == 1001


async def test_me_without_token_returns_401(async_client, seed_users):
    """토큰 없음 → 401."""
    resp = await async_client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_me_with_invalid_token_returns_401(async_client, seed_users):
    """잘못된 토큰 → 401."""
    resp = await async_client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer totally.invalid.token"},
    )
    assert resp.status_code == 401


async def test_me_with_tampered_token_returns_401(async_client, seed_users):
    """변조된 토큰 → 401."""
    token = create_access_token({"sub": "1001", "role": "admin", "email": "alice@virtualoffice.local"})
    tampered = token + "X"
    resp = await async_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {tampered}"},
    )
    assert resp.status_code == 401


# ── POST /api/auth/refresh ────────────────────────────────────────────────────

async def test_refresh_with_valid_token(async_client, seed_users):
    """유효 토큰 → 새 토큰 재발급."""
    # 로그인 먼저
    login_resp = await async_client.post(
        "/api/auth/login",
        json={"email": "alice@virtualoffice.local", "password": "password123"},
    )
    token = login_resp.json()["access_token"]

    refresh_resp = await async_client.post(
        "/api/auth/refresh",
        json={"refresh_token": token},
    )
    assert refresh_resp.status_code == 200, refresh_resp.text
    body = refresh_resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0
    # 새 토큰이 유효한지 /me로 확인
    me_resp = await async_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert me_resp.status_code == 200


async def test_refresh_with_invalid_token_returns_401(async_client, seed_users):
    """잘못된 refresh 토큰 → 401."""
    resp = await async_client.post(
        "/api/auth/refresh",
        json={"refresh_token": "bad.token.here"},
    )
    assert resp.status_code == 401


async def test_refresh_for_inactive_user_returns_401(async_client, db_session, seed_users):
    """유효 토큰이지만 사용자 비활성화(soft-delete) → 401."""
    # 토큰 먼저 발급
    login_resp = await async_client.post(
        "/api/auth/login",
        json={"email": "alice@virtualoffice.local", "password": "password123"},
    )
    token = login_resp.json()["access_token"]

    # 사용자 비활성화
    alice = seed_users[0]
    alice.is_active = False
    await db_session.commit()

    resp = await async_client.post(
        "/api/auth/refresh",
        json={"refresh_token": token},
    )
    assert resp.status_code == 401
