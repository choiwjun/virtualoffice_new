"""
G010 계정 잠금/rate-limit(C2) 적대적(red-team) e2e 테스트.

정본: docs/planning/00-decisions.md C2(brute-force 방어).
대상: POST /auth/login — 연속 실패 임계값 도달 시 423 잠금, 잠금 윈도우 동안 유지,
성공 시 카운터 리셋, 미존재 계정은 잠금 상태를 노출하지 않는다(항상 401).

실제 앱(app.main:app)을 httpx AsyncClient로 그대로 호출한다(conftest.async_client 재사용).
"""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.models.tables import AuthCredential


async def _login(client: AsyncClient, email: str, password: str):
    return await client.post("/auth/login", json={"email": email, "password": password})


async def _cred(db_session, user_id: int = 1) -> AuthCredential:
    return (
        await db_session.execute(
            select(AuthCredential).where(AuthCredential.user_id == user_id)
        )
    ).scalar_one()


# ============================================================================
# 1) 연속 실패 → login_max_attempts(기본 5)회 실패 후 즉시 잠금(423)
# ============================================================================
@pytest.mark.asyncio
async def test_lockout_after_max_attempts(async_client: AsyncClient, test_user: dict, db_session):
    email = test_user["email"]
    max_attempts = settings.login_max_attempts

    for i in range(max_attempts - 1):
        resp = await _login(async_client, email, "WrongPassword!")
        assert resp.status_code == 401, f"attempt {i + 1} should still be 401"

    # 임계값에 도달하는 마지막 실패 시도 → 그 순간 423으로 전환
    resp = await _login(async_client, email, "WrongPassword!")
    assert resp.status_code == 423
    assert resp.json().get("detail") == "account_locked"

    cred = await _cred(db_session)
    assert cred.failed_attempts == max_attempts
    assert cred.locked_until is not None


@pytest.mark.asyncio
async def test_lockout_persists_on_next_attempt_even_with_correct_password(
    async_client: AsyncClient, test_user: dict
):
    email = test_user["email"]
    for _ in range(settings.login_max_attempts):
        await _login(async_client, email, "WrongPassword!")

    # 잠금 중에는 올바른 비밀번호를 넣어도 423 — 비밀번호 검증 전에 잠금을 체크한다.
    resp = await _login(async_client, email, "TestPass123!")
    assert resp.status_code == 423
    assert resp.json().get("detail") == "account_locked"


# ============================================================================
# 2) 성공 로그인 → 실패 카운터/잠금 리셋
# ============================================================================
@pytest.mark.asyncio
async def test_successful_login_resets_failure_counter(
    async_client: AsyncClient, test_user: dict, db_session
):
    email = test_user["email"]
    # 임계값 미만으로 실패시킨 뒤 성공 로그인.
    for _ in range(settings.login_max_attempts - 1):
        resp = await _login(async_client, email, "WrongPassword!")
        assert resp.status_code == 401

    resp = await _login(async_client, email, "TestPass123!")
    assert resp.status_code == 201

    cred = await _cred(db_session)
    assert cred.failed_attempts == 0
    assert cred.locked_until is None

    # 리셋 이후 다시 임계값 -1 만큼 실패해도 아직 잠기지 않아야 한다.
    for _ in range(settings.login_max_attempts - 1):
        resp = await _login(async_client, email, "WrongPassword!")
        assert resp.status_code == 401


# ============================================================================
# 3) 미존재 계정 → 카운터/잠금 상태 비노출, 항상 401
# ============================================================================
@pytest.mark.asyncio
async def test_nonexistent_account_never_locks_or_leaks_state(async_client: AsyncClient):
    email = "ghost-user@example.com"
    for _ in range(settings.login_max_attempts + 3):
        resp = await _login(async_client, email, "AnyPassword!")
        assert resp.status_code == 401
        assert resp.json().get("detail") == "invalid_credentials"


@pytest.mark.asyncio
async def test_locked_account_and_nonexistent_account_responses_are_distinguishable_only_by_intent(
    async_client: AsyncClient, test_user: dict
):
    # 잠금된 실제 계정은 423, 존재하지 않는 계정은 401 — 상태 자체는 다르지만
    # 미존재 계정 쪽에서 카운터/잠금 관련 필드가 노출되지 않아야 한다.
    email = test_user["email"]
    for _ in range(settings.login_max_attempts):
        await _login(async_client, email, "WrongPassword!")

    locked_resp = await _login(async_client, email, "WrongPassword!")
    ghost_resp = await _login(async_client, "ghost-user@example.com", "WrongPassword!")

    assert locked_resp.status_code == 423
    assert ghost_resp.status_code == 401
    for body in (locked_resp.json(), ghost_resp.json()):
        assert set(body.keys()) <= {"detail"}


# ============================================================================
# 4) 잠금 윈도우 경계 — 만료 후에는 다시 로그인 가능
# ============================================================================
@pytest.mark.asyncio
async def test_lockout_expires_after_window(
    async_client: AsyncClient, test_user: dict, db_session
):
    email = test_user["email"]
    for _ in range(settings.login_max_attempts):
        await _login(async_client, email, "WrongPassword!")

    cred = await _cred(db_session)
    assert cred.locked_until is not None

    # 잠금 윈도우가 이미 지난 것처럼 만료 시각을 과거로 앞당긴다(경계 통과 시뮬레이션).
    cred.locked_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()

    resp = await _login(async_client, email, "TestPass123!")
    assert resp.status_code == 201

    cred = await _cred(db_session)
    assert cred.failed_attempts == 0
    assert cred.locked_until is None


@pytest.mark.asyncio
async def test_lockout_boundary_still_locked_one_second_before_expiry(
    async_client: AsyncClient, test_user: dict, db_session
):
    email = test_user["email"]
    for _ in range(settings.login_max_attempts):
        await _login(async_client, email, "WrongPassword!")

    cred = await _cred(db_session)
    # 잠금 해제 1초 전으로 맞춘다 — 여전히 잠금 상태여야 한다.
    cred.locked_until = datetime.now(timezone.utc) + timedelta(seconds=1)
    await db_session.commit()

    resp = await _login(async_client, email, "TestPass123!")
    assert resp.status_code == 423
