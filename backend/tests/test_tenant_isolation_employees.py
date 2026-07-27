"""직원 디렉터리·유저 CRUD 교차 테넌트 격리 — E3 (22 T0-1 IDOR 차단).

E3 이전에는 `/api/employees`가 `DEFAULT_COMPANY_ID = 1` 하드코딩이라 **신규 회사의
admin이 1번 회사 직원명부를 그대로 봤다**. 그 회귀를 막는 스위트.

- company-1 호출자가 company-2 유저를 GET/PATCH/DELETE/activate → 404 (존재 은닉)
- 목록은 자기 회사만
- 생성 시 company_id는 서버가 주입 (클라가 타사로 위조 불가)
- 마지막 관리자·seat_limit 판정이 자기 회사 안에서만 집계된다
"""

from __future__ import annotations

from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db import Base, get_db
from app.main import app
from app.models.tables import USER_SOURCE_ERP, Company, ErpRole, ErpUser

C1_ADMIN = 11
C2_ADMIN = 22
C2_EMPLOYEE = 23


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


@pytest.fixture
def c1_admin_headers() -> dict:
    token = create_access_token(
        {"sub": str(C1_ADMIN), "email": "c1admin@test.local", "role": "admin", "company_id": 1}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def c2_admin_headers() -> dict:
    token = create_access_token(
        {"sub": str(C2_ADMIN), "email": "c2admin@test.local", "role": "admin", "company_id": 2}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def seeded(db_session: AsyncSession) -> None:
    db_session.add_all([
        Company(id=1, name="회사1", slug="c1"),
        Company(id=2, name="회사2", slug="c2"),
        ErpUser(id=C1_ADMIN, company_id=1, email="c1admin@test.local", name="C1Admin",
                erp_team_id=1, role=ErpRole.ADMIN, is_active=True, source=USER_SOURCE_ERP),
        ErpUser(id=C2_ADMIN, company_id=2, email="c2admin@test.local", name="C2Admin",
                erp_team_id=1, role=ErpRole.ADMIN, is_active=True, source=USER_SOURCE_ERP),
        ErpUser(id=C2_EMPLOYEE, company_id=2, email="c2emp@test.local", name="C2Emp",
                erp_team_id=1, role=ErpRole.EMPLOYEE, is_active=True, source=USER_SOURCE_ERP),
    ])
    await db_session.commit()


# ── 조회 격리 ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_list_excludes_other_tenant(async_client, seeded, c1_admin_headers):
    r = await async_client.get("/api/employees", headers=c1_admin_headers)
    assert r.status_code == 200, r.text
    ids = {e["id"] for e in r.json()}
    assert C1_ADMIN in ids
    assert C2_ADMIN not in ids and C2_EMPLOYEE not in ids


@pytest.mark.asyncio
async def test_list_include_inactive_still_scoped(async_client, seeded, c1_admin_headers):
    r = await async_client.get("/api/employees?include_inactive=true", headers=c1_admin_headers)
    assert r.status_code == 200, r.text
    assert {e["id"] for e in r.json()} == {C1_ADMIN}


@pytest.mark.asyncio
async def test_get_cross_tenant_is_404(async_client, seeded, c1_admin_headers):
    r = await async_client.get(f"/api/employees/{C2_EMPLOYEE}", headers=c1_admin_headers)
    assert r.status_code == 404, r.text


# ── 변조 격리 ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_patch_cross_tenant_is_404(async_client, seeded, c1_admin_headers, db_session):
    r = await async_client.patch(
        f"/api/employees/{C2_EMPLOYEE}", json={"role": "admin"}, headers=c1_admin_headers
    )
    assert r.status_code == 404, r.text

    row = (await db_session.execute(select(ErpUser).where(ErpUser.id == C2_EMPLOYEE))).scalar_one()
    assert row.role == ErpRole.EMPLOYEE  # 변조 전에 차단됨


@pytest.mark.asyncio
async def test_delete_cross_tenant_is_404(async_client, seeded, c1_admin_headers, db_session):
    r = await async_client.delete(f"/api/employees/{C2_EMPLOYEE}", headers=c1_admin_headers)
    assert r.status_code == 404, r.text

    row = (await db_session.execute(select(ErpUser).where(ErpUser.id == C2_EMPLOYEE))).scalar_one()
    assert row.is_active is True


@pytest.mark.asyncio
async def test_activate_cross_tenant_is_404(async_client, seeded, c1_admin_headers, db_session):
    row = (await db_session.execute(select(ErpUser).where(ErpUser.id == C2_EMPLOYEE))).scalar_one()
    row.is_active = False
    await db_session.commit()

    r = await async_client.post(f"/api/employees/{C2_EMPLOYEE}/activate", headers=c1_admin_headers)
    assert r.status_code == 404, r.text

    await db_session.refresh(row)
    assert row.is_active is False


# ── 생성 스코프 ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_create_injects_caller_company(async_client, seeded, c2_admin_headers, db_session):
    """클라가 company_id를 보내도 무시 — 서버가 호출자 회사로 강제한다."""
    r = await async_client.post(
        "/api/employees",
        json={"email": "new@c2.local", "name": "신규", "company_id": 1},
        headers=c2_admin_headers,
    )
    assert r.status_code == 201, r.text
    row = (await db_session.execute(select(ErpUser).where(ErpUser.id == r.json()["id"]))).scalar_one()
    assert row.company_id == 2

    # 회사 1 목록에 나타나지 않는다.
    listed = await async_client.get("/api/employees", headers=c2_admin_headers)
    assert row.id in {e["id"] for e in listed.json()}


@pytest.mark.asyncio
async def test_last_admin_check_is_per_company(async_client, seeded, c2_admin_headers):
    """회사 1에 관리자가 있어도, 회사 2의 마지막 관리자 강등은 막혀야 한다
    (관리자 집계가 전역이면 이 테스트가 200으로 새어나간다)."""
    r = await async_client.patch(
        f"/api/employees/{C2_ADMIN}", json={"role": "employee"}, headers=c2_admin_headers
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "last_admin"


@pytest.mark.asyncio
async def test_seat_limit_counts_only_own_company(async_client, seeded, c2_admin_headers, db_session):
    """좌석 카운트가 전역이면 타사 인원 때문에 자사 생성이 막힌다 — 회사별 집계 확인."""
    company2 = (await db_session.execute(select(Company).where(Company.id == 2))).scalar_one()
    company2.seat_limit = 3  # 회사2 활성 2명 → 1명 여유 (회사1 인원은 무관)
    await db_session.commit()

    r = await async_client.post(
        "/api/employees", json={"email": "fits@c2.local", "name": "여유"}, headers=c2_admin_headers
    )
    assert r.status_code == 201, r.text

    r_over = await async_client.post(
        "/api/employees", json={"email": "over@c2.local", "name": "초과"}, headers=c2_admin_headers
    )
    assert r_over.status_code == 409, r_over.text
    assert r_over.json()["detail"] == "seat_limit_exceeded"


@pytest.mark.asyncio
async def test_email_unique_across_tenants(async_client, seeded, c2_admin_headers):
    """로그인은 email로 조회하므로 회사가 달라도 이메일 중복은 409 (계정 탈취 경로 차단)."""
    r = await async_client.post(
        "/api/employees",
        json={"email": "c1admin@test.local", "name": "타사이메일"},
        headers=c2_admin_headers,
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "email_taken"
