"""admin 유저 CRUD — E3 (24-spec Phase 3 · 23 E3).

ERP 없는 회사가 사람을 채울 수 있어야 한다. 그 경로의 계약과 가드를 고정한다:
- 생성/수정/비활성/재활성이 admin 전용이고 company 스코프에 갇힌다.
- 권한 상승(admin이 super_admin 발급) 차단.
- 회사 잠금 방지: 마지막 활성 관리자 강등·비활성 409. 본인 비활성 409.
- seat_limit 초과 생성 409 (NULL이면 무제한 — 기존 회사 무영향).
- native 유저는 ERP 전체 대사가 비활성화하지 않는다(source 격리).
"""

from __future__ import annotations

from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token, hash_password
from app.db import Base, get_db
from app.main import app
from app.models.tables import (
    USER_SOURCE_ERP,
    USER_SOURCE_NATIVE,
    Company,
    ErpRole,
    ErpUser,
)

C1 = 1  # 시드 회사
ADMIN_ID = 101
EMPLOYEE_ID = 102


# ── 픽스처 ────────────────────────────────────────────────
@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def async_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def _override() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def _headers(user_id: int, role: str, company_id: int = C1) -> dict:
    token = create_access_token(
        {"sub": str(user_id), "email": f"u{user_id}@test.local", "role": role, "company_id": company_id}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_headers() -> dict:
    return _headers(ADMIN_ID, "admin")


@pytest.fixture
def employee_headers() -> dict:
    return _headers(EMPLOYEE_ID, "employee")


@pytest_asyncio.fixture
async def seeded(db_session: AsyncSession) -> dict:
    """회사 1 + admin 1명 + 일반직원 1명 (둘 다 source='erp' = 기존 데이터 모사)."""
    db_session.add(Company(id=C1, name="회사1", slug="c1"))
    admin = ErpUser(
        id=ADMIN_ID, company_id=C1, email="admin@c1.local", name="관리자",
        erp_team_id=1, role=ErpRole.ADMIN, password_hash=hash_password("password123"),
        is_active=True, source=USER_SOURCE_ERP,
    )
    emp = ErpUser(
        id=EMPLOYEE_ID, company_id=C1, email="emp@c1.local", name="직원",
        erp_team_id=1, role=ErpRole.EMPLOYEE, is_active=True, source=USER_SOURCE_ERP,
    )
    db_session.add_all([admin, emp])
    await db_session.commit()
    return {"admin": admin, "employee": emp}


# ── 생성 ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_create_employee_as_admin(async_client, seeded, admin_headers, db_session):
    """admin이 native 유저 생성 → 201, source='native', company_id는 서버가 주입."""
    r = await async_client.post(
        "/api/employees",
        json={"email": "New.Hire@C1.local", "name": "신입", "role": "employee",
              "erp_team_id": 3, "position": "사원", "initial_password": "welcome1234"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["email"] == "new.hire@c1.local"  # 정규화(소문자)
    assert body["source"] == USER_SOURCE_NATIVE
    assert body["has_login"] is True
    assert body["is_active"] is True
    assert body["id"] >= 1_000_000_000  # ERP 조인키 대역과 격리

    row = (await db_session.execute(select(ErpUser).where(ErpUser.id == body["id"]))).scalar_one()
    assert row.company_id == C1
    assert row.password_hash is not None


@pytest.mark.asyncio
async def test_created_employee_can_login(async_client, seeded, admin_headers):
    """initial_password를 준 유저는 즉시 로그인 가능 (E4 초대 없이도 팀을 채울 수 있다)."""
    await async_client.post(
        "/api/employees",
        json={"email": "loginable@c1.local", "name": "로그인", "initial_password": "welcome1234"},
        headers=admin_headers,
    )
    r = await async_client.post(
        "/api/auth/login", json={"email": "loginable@c1.local", "password": "welcome1234"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["company_id"] == C1


@pytest.mark.asyncio
async def test_create_without_password_has_no_login(async_client, seeded, admin_headers):
    """비번 없이 생성 → 디렉터리 등재만. 로그인 불가(초대 대기 상태)."""
    r = await async_client.post(
        "/api/employees",
        json={"email": "pending@c1.local", "name": "초대대기"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["has_login"] is False
    r_login = await async_client.post(
        "/api/auth/login", json={"email": "pending@c1.local", "password": "anything123"}
    )
    assert r_login.status_code == 401


@pytest.mark.asyncio
async def test_create_duplicate_email_409(async_client, seeded, admin_headers):
    r = await async_client.post(
        "/api/employees",
        json={"email": "emp@c1.local", "name": "중복"},
        headers=admin_headers,
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "email_taken"


@pytest.mark.asyncio
async def test_create_requires_admin(async_client, seeded, employee_headers):
    r = await async_client.post(
        "/api/employees", json={"email": "x@c1.local", "name": "무권한"}, headers=employee_headers
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_admin_cannot_grant_super_admin(async_client, seeded, admin_headers):
    """권한 상승 차단 — admin은 super_admin을 만들 수 없다."""
    r = await async_client.post(
        "/api/employees",
        json={"email": "escalate@c1.local", "name": "상승", "role": "super_admin"},
        headers=admin_headers,
    )
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "cannot_grant_super_admin"


@pytest.mark.asyncio
async def test_super_admin_can_grant_super_admin(async_client, seeded):
    r = await async_client.post(
        "/api/employees",
        json={"email": "sa@c1.local", "name": "슈퍼", "role": "super_admin"},
        headers=_headers(ADMIN_ID, "super_admin"),
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "super_admin"


@pytest.mark.asyncio
async def test_create_invalid_role_400(async_client, seeded, admin_headers):
    r = await async_client.post(
        "/api/employees",
        json={"email": "bad@c1.local", "name": "잘못된역할", "role": "ceo"},
        headers=admin_headers,
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "invalid_role"


@pytest.mark.asyncio
async def test_create_invalid_email_422(async_client, seeded, admin_headers):
    r = await async_client.post(
        "/api/employees", json={"email": "not-an-email", "name": "x"}, headers=admin_headers
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_seat_limit_blocks_creation(async_client, seeded, admin_headers, db_session):
    """seat_limit 도달 시 409 (업그레이드 유도). NULL이면 게이트 없음."""
    company = (await db_session.execute(select(Company).where(Company.id == C1))).scalar_one()
    company.seat_limit = 2  # 이미 활성 2명(admin+employee)
    await db_session.commit()

    r = await async_client.post(
        "/api/employees", json={"email": "over@c1.local", "name": "초과"}, headers=admin_headers
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "seat_limit_exceeded"

    company.seat_limit = 3
    await db_session.commit()
    r_ok = await async_client.post(
        "/api/employees", json={"email": "fits@c1.local", "name": "여유"}, headers=admin_headers
    )
    assert r_ok.status_code == 201, r_ok.text


# ── 수정 ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_patch_role_and_team(async_client, seeded, admin_headers):
    r = await async_client.patch(
        f"/api/employees/{EMPLOYEE_ID}",
        json={"role": "leader", "erp_team_id": 7, "position": "팀장"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "leader"
    assert body["erp_team_id"] == 7
    assert body["position"] == "팀장"


@pytest.mark.asyncio
async def test_patch_requires_admin(async_client, seeded, employee_headers):
    r = await async_client.patch(
        f"/api/employees/{EMPLOYEE_ID}", json={"role": "admin"}, headers=employee_headers
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_patch_cannot_escalate_to_super_admin(async_client, seeded, admin_headers):
    r = await async_client.patch(
        f"/api/employees/{EMPLOYEE_ID}", json={"role": "super_admin"}, headers=admin_headers
    )
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "cannot_grant_super_admin"


@pytest.mark.asyncio
async def test_demoting_last_admin_409(async_client, seeded, admin_headers):
    """마지막 활성 관리자를 강등하면 회사가 잠긴다 → 409."""
    r = await async_client.patch(
        f"/api/employees/{ADMIN_ID}", json={"role": "employee"}, headers=admin_headers
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "last_admin"


@pytest.mark.asyncio
async def test_demoting_admin_ok_when_another_exists(async_client, seeded, admin_headers):
    """다른 관리자가 있으면 강등 허용."""
    r_new = await async_client.post(
        "/api/employees",
        json={"email": "admin2@c1.local", "name": "관리자2", "role": "admin"},
        headers=admin_headers,
    )
    assert r_new.status_code == 201, r_new.text
    r = await async_client.patch(
        f"/api/employees/{ADMIN_ID}", json={"role": "employee"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "employee"


# ── 비활성 / 재활성 ────────────────────────────────────────
@pytest.mark.asyncio
async def test_deactivate_is_soft(async_client, seeded, admin_headers, db_session):
    """물리 삭제 금지(D18) — 행은 남고 is_active만 false."""
    r = await async_client.delete(f"/api/employees/{EMPLOYEE_ID}", headers=admin_headers)
    assert r.status_code == 204, r.text

    row = (await db_session.execute(select(ErpUser).where(ErpUser.id == EMPLOYEE_ID))).scalar_one()
    assert row.is_active is False

    # 기본 목록에서 사라지고, include_inactive=true(admin)에서는 보인다.
    listed = await async_client.get("/api/employees", headers=admin_headers)
    assert EMPLOYEE_ID not in {e["id"] for e in listed.json()}
    listed_all = await async_client.get("/api/employees?include_inactive=true", headers=admin_headers)
    assert EMPLOYEE_ID in {e["id"] for e in listed_all.json()}


@pytest.mark.asyncio
async def test_cannot_deactivate_self(async_client, seeded, admin_headers):
    r = await async_client.delete(f"/api/employees/{ADMIN_ID}", headers=admin_headers)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "cannot_deactivate_self"


@pytest.mark.asyncio
async def test_cannot_deactivate_last_admin(async_client, seeded, admin_headers, db_session):
    """본인이 아닌 다른 관리자라도, 그가 마지막 활성 관리자면 비활성 금지."""
    other_admin = ErpUser(
        id=103, company_id=C1, email="admin3@c1.local", name="관리자3",
        erp_team_id=1, role=ErpRole.ADMIN, is_active=True, source=USER_SOURCE_ERP,
    )
    db_session.add(other_admin)
    await db_session.commit()

    # 호출자(ADMIN_ID)를 먼저 비활성 → other_admin이 유일한 활성 관리자
    caller = (await db_session.execute(select(ErpUser).where(ErpUser.id == ADMIN_ID))).scalar_one()
    caller.is_active = False
    await db_session.commit()

    r = await async_client.delete("/api/employees/103", headers=admin_headers)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "last_admin"


@pytest.mark.asyncio
async def test_activate_restores(async_client, seeded, admin_headers):
    await async_client.delete(f"/api/employees/{EMPLOYEE_ID}", headers=admin_headers)
    r = await async_client.post(f"/api/employees/{EMPLOYEE_ID}/activate", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is True


@pytest.mark.asyncio
async def test_activate_respects_seat_limit(async_client, seeded, admin_headers, db_session):
    await async_client.delete(f"/api/employees/{EMPLOYEE_ID}", headers=admin_headers)
    company = (await db_session.execute(select(Company).where(Company.id == C1))).scalar_one()
    company.seat_limit = 1  # 활성 = admin 1명뿐
    await db_session.commit()

    r = await async_client.post(f"/api/employees/{EMPLOYEE_ID}/activate", headers=admin_headers)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "seat_limit_exceeded"


@pytest.mark.asyncio
async def test_deactivate_requires_admin(async_client, seeded, employee_headers):
    r = await async_client.delete(f"/api/employees/{ADMIN_ID}", headers=employee_headers)
    assert r.status_code == 403, r.text


# ── 조회 ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_list_include_inactive_ignored_for_non_admin(async_client, seeded, admin_headers, employee_headers):
    """일반 직원은 include_inactive=true를 줘도 활성 명부만 본다."""
    await async_client.delete(f"/api/employees/{EMPLOYEE_ID}", headers=admin_headers)
    r = await async_client.get("/api/employees?include_inactive=true", headers=employee_headers)
    assert r.status_code == 200, r.text
    assert EMPLOYEE_ID not in {e["id"] for e in r.json()}


@pytest.mark.asyncio
async def test_get_employee_exposes_source(async_client, seeded, admin_headers):
    r = await async_client.get(f"/api/employees/{EMPLOYEE_ID}", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["source"] == USER_SOURCE_ERP


@pytest.mark.asyncio
async def test_get_unknown_employee_404(async_client, seeded, admin_headers):
    r = await async_client.get("/api/employees/999999", headers=admin_headers)
    assert r.status_code == 404, r.text
