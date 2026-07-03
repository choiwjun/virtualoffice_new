"""
G002 디렉터리 API(GET /api/employees, /api/teams, /api/org-groups) 적대적(red-team) e2e 테스트.

목적: RBAC 필터(employee=본인/leader=팀/admin=전체)와 입력 경계(limit/offset,
쿼리 인젝션, 위조/만료 JWT)를 깨뜨리려는 시도가 전부 안전하게 거부/차단되는지 검증한다.
정상 플로우 검증은 backend/tests/test_erp_api.py 담당 — 여기는 공격 시나리오 전용.

시드: ErpUser id 1-4, erp_team_id 1/1/1/2 (id4만 팀2). company_id=1 고정.
실제 앱(app.main:app)을 httpx AsyncClient로 그대로 호출한다(ASGITransport,
conftest.async_client/db_session 재사용). mock ERP reader 활성(erp_database_url 빈값)
— GET /api/teams는 개발팀(id1)/디자인팀(id2) 2건을 반환한다.
"""

from datetime import timedelta

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import create_access_token
from app.models.tables import ErpRole, ErpUser


# ============================================================================
# 시드 헬퍼 / 토큰 팩토리
# ============================================================================

async def _seed_directory_users(db_session: AsyncSession) -> None:
    """id 1-4, erp_team_id 1/1/1/2 시드 (RBAC 경계 검증용, 타 테스트와 격리된 함수스코프 DB)."""
    users = [
        ErpUser(
            id=1, company_id=1, email="u1@example.com", name="U1",
            erp_team_id=1, role=ErpRole.EMPLOYEE, is_active=True,
        ),
        ErpUser(
            id=2, company_id=1, email="u2@example.com", name="U2",
            erp_team_id=1, role=ErpRole.LEADER, is_active=True,
        ),
        ErpUser(
            id=3, company_id=1, email="u3@example.com", name="U3",
            erp_team_id=1, role=ErpRole.ADMIN, is_active=True,
        ),
        ErpUser(
            id=4, company_id=1, email="u4@example.com", name="U4",
            erp_team_id=2, role=ErpRole.EMPLOYEE, is_active=True,
        ),
    ]
    db_session.add_all(users)
    await db_session.commit()


def _token(sub, role: str, team_id: int | None = None, expires_delta=None) -> str:
    claims: dict = {"sub": str(sub), "email": f"u{sub}@example.com", "role": role}
    if team_id is not None:
        claims["team_id"] = team_id
    return create_access_token(claims, expires_delta=expires_delta or timedelta(hours=1))


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# 1) employee(sub=1) → GET /api/employees: 본인(id=1)만, 타 직원 누출 없음
# ============================================================================
@pytest.mark.asyncio
async def test_employee_sees_only_self(async_client: AsyncClient, db_session: AsyncSession):
    await _seed_directory_users(db_session)
    resp = await async_client.get(
        "/api/employees", headers=_bearer(_token(1, "employee", team_id=1))
    )
    assert resp.status_code == 200
    body = resp.json()
    ids = [row["id"] for row in body["items"]]
    assert ids == [1]


# ============================================================================
# 2) leader(team_id=1) → 팀1(id 1,2,3)만, 팀2(id4) 미노출
# ============================================================================
@pytest.mark.asyncio
async def test_leader_sees_only_own_team(async_client: AsyncClient, db_session: AsyncSession):
    await _seed_directory_users(db_session)
    resp = await async_client.get(
        "/api/employees", headers=_bearer(_token(2, "leader", team_id=1))
    )
    assert resp.status_code == 200
    ids = sorted(row["id"] for row in resp.json()["items"])
    assert ids == [1, 2, 3]
    assert 4 not in ids


# ============================================================================
# 3) admin → 전체 4명
# ============================================================================
@pytest.mark.asyncio
async def test_admin_sees_all_employees(async_client: AsyncClient, db_session: AsyncSession):
    await _seed_directory_users(db_session)
    resp = await async_client.get(
        "/api/employees", headers=_bearer(_token(3, "admin"))
    )
    assert resp.status_code == 200
    ids = sorted(row["id"] for row in resp.json()["items"])
    assert ids == [1, 2, 3, 4]


# ============================================================================
# 4) 미인증 → /api/employees, /api/teams, /api/org-groups 각각 401
# ============================================================================
@pytest.mark.asyncio
async def test_unauthenticated_rejected_on_all_directory_endpoints(
    async_client: AsyncClient, db_session: AsyncSession
):
    await _seed_directory_users(db_session)
    for path in ("/api/employees", "/api/teams", "/api/org-groups"):
        resp = await async_client.get(path)
        assert resp.status_code == 401, f"{path} expected 401, got {resp.status_code}"


# ============================================================================
# 5) 변조/만료 JWT로 /api/employees → 401 (타 리소스로 우회 불가)
# ============================================================================
@pytest.mark.asyncio
async def test_tampered_signature_rejected(async_client: AsyncClient, db_session: AsyncSession):
    await _seed_directory_users(db_session)
    valid = _token(1, "employee", team_id=1)
    header, payload, signature = valid.split(".")
    tampered_signature = ("a" if signature[0] != "a" else "b") + signature[1:]
    tampered = f"{header}.{payload}.{tampered_signature}"
    resp = await async_client.get("/api/employees", headers=_bearer(tampered))
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_expired_token_rejected(async_client: AsyncClient, db_session: AsyncSession):
    await _seed_directory_users(db_session)
    expired = _token(1, "employee", team_id=1, expires_delta=timedelta(seconds=-1))
    resp = await async_client.get("/api/employees", headers=_bearer(expired))
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_forged_secret_token_rejected(async_client: AsyncClient, db_session: AsyncSession):
    await _seed_directory_users(db_session)
    forged = jwt.encode(
        {"sub": "3", "email": "attacker@example.com", "role": "admin"},
        "attacker-controlled-secret-not-ours",
        algorithm=settings.jwt_algorithm,
    )
    resp = await async_client.get("/api/employees", headers=_bearer(forged))
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_role_claim_tampering_via_forged_secret_does_not_grant_admin(
    async_client: AsyncClient, db_session: AsyncSession
):
    # 공격자가 role=admin 클레임을 자체 서명해도 검증 단계에서 거부되어야 한다.
    await _seed_directory_users(db_session)
    forged_admin = jwt.encode(
        {"sub": "1", "email": "u1@example.com", "role": "admin"},
        "not-our-secret",
        algorithm=settings.jwt_algorithm,
    )
    resp = await async_client.get("/api/employees", headers=_bearer(forged_admin))
    assert resp.status_code == 401


# ============================================================================
# 6) /api/teams 경계값: limit=0/99999, offset=-1 → 422; offset>total → 빈 items
# ============================================================================
@pytest.mark.asyncio
async def test_teams_limit_zero_rejected_422(async_client: AsyncClient, db_session: AsyncSession):
    resp = await async_client.get(
        "/api/teams", params={"limit": 0}, headers=_bearer(_token(3, "admin"))
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_teams_limit_over_max_rejected_422(async_client: AsyncClient, db_session: AsyncSession):
    resp = await async_client.get(
        "/api/teams", params={"limit": 99999}, headers=_bearer(_token(3, "admin"))
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_teams_negative_offset_rejected_422(async_client: AsyncClient, db_session: AsyncSession):
    resp = await async_client.get(
        "/api/teams", params={"offset": -1}, headers=_bearer(_token(3, "admin"))
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_teams_offset_beyond_total_returns_empty_items_not_error(
    async_client: AsyncClient, db_session: AsyncSession
):
    resp = await async_client.get(
        "/api/teams", params={"offset": 10_000}, headers=_bearer(_token(3, "admin"))
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["total"] >= 0


# ============================================================================
# 7) /api/org-groups 쿼리 파라미터 인젝션/이상문자 → 500 없이 안전(200, 무시)
# ============================================================================
@pytest.mark.asyncio
async def test_org_groups_query_injection_does_not_500(
    async_client: AsyncClient, db_session: AsyncSession
):
    resp = await async_client.get(
        "/api/org-groups",
        params={"name": "'; DROP TABLE org_group; --", "type": "<script>alert(1)</script>"},
        headers=_bearer(_token(3, "admin")),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body and "total" in body


@pytest.mark.asyncio
async def test_org_groups_oversized_query_value_does_not_500(
    async_client: AsyncClient, db_session: AsyncSession
):
    resp = await async_client.get(
        "/api/org-groups",
        params={"junk": "A" * 10_000},
        headers=_bearer(_token(3, "admin")),
    )
    assert resp.status_code == 200


# ============================================================================
# 8) employee의 자기 자신 id가 시드되지 않은 경우 → 빈 리스트(타인 노출 아님)
# ============================================================================
@pytest.mark.asyncio
async def test_employee_with_unseeded_id_gets_empty_list_not_others(
    async_client: AsyncClient, db_session: AsyncSession
):
    await _seed_directory_users(db_session)
    resp = await async_client.get(
        "/api/employees", headers=_bearer(_token(999, "employee", team_id=1))
    )
    assert resp.status_code == 200
    assert resp.json()["items"] == []
