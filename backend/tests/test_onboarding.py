"""첫실행 온보딩 — Phase 5 / E6 (24-spec Phase 5 · 23 E6).

체크리스트는 **저장하지 않고 실측 파생**한다. 그 규율이 지켜지는지(데이터를 지우면 항목도
풀리는지), 이미 셋업된 회사는 저절로 숨는지, dismiss·tour가 각각 회사/유저 단위로
영속하는지를 고정한다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db import Base, get_db
from app.main import app
from app.models.tables import (
    AuthToken,
    AuthTokenPurpose,
    Company,
    ErpRole,
    ErpUser,
    Notice,
    Seat,
    SeatStatus,
    SeatType,
)

C1, C2 = 1, 2
ADMIN, EMPLOYEE, C2_ADMIN = 501, 502, 503


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


def _headers(user_id: int, company_id: int, role: str = "admin") -> dict:
    token = create_access_token(
        {"sub": str(user_id), "email": f"u{user_id}@t.local", "role": role, "company_id": company_id}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_headers() -> dict:
    return _headers(ADMIN, C1)


@pytest.fixture
def employee_headers() -> dict:
    return _headers(EMPLOYEE, C1, "employee")


@pytest_asyncio.fixture
async def fresh_company(db_session: AsyncSession) -> None:
    """갓 만든 회사 — admin 1명뿐, 좌석·공지·초대 없음(= 체크리스트 전부 미완)."""
    db_session.add_all([
        Company(id=C1, name="새회사", slug="c1"),
        Company(id=C2, name="타사", slug="c2"),
        ErpUser(id=ADMIN, company_id=C1, email="a@t.local", name="관리자", erp_team_id=0,
                role=ErpRole.ADMIN, is_active=True),
        ErpUser(id=C2_ADMIN, company_id=C2, email="b@t.local", name="타사관리자", erp_team_id=0,
                role=ErpRole.ADMIN, is_active=True),
    ])
    await db_session.commit()


# ── 실측 파생 ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_fresh_company_has_nothing_done(async_client, fresh_company, admin_headers):
    r = await async_client.get("/api/onboarding", headers=admin_headers)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["checklist"] == {"seat_placed": False, "notice_posted": False, "team_invited": False}
    assert b["completed"] is False
    assert b["dismissed"] is False
    assert b["can_manage"] is True


@pytest.mark.asyncio
async def test_seat_placement_is_detected(async_client, fresh_company, admin_headers, db_session):
    db_session.add(Seat(id=uuid4(), company_id=C1, floor_id=uuid4(), type=SeatType.FREE,
                        status=SeatStatus.AVAILABLE, coords={"x": 1.0, "y": 1.0}))
    await db_session.commit()

    b = (await async_client.get("/api/onboarding", headers=admin_headers)).json()
    assert b["checklist"]["seat_placed"] is True


@pytest.mark.asyncio
async def test_notice_is_detected(async_client, fresh_company, admin_headers, db_session):
    db_session.add(Notice(id=uuid4(), company_id=C1, title="첫 공지", body="환영합니다",
                          created_by=ADMIN, published_at=datetime.now(timezone.utc)))
    await db_session.commit()

    b = (await async_client.get("/api/onboarding", headers=admin_headers)).json()
    assert b["checklist"]["notice_posted"] is True


@pytest.mark.asyncio
async def test_second_member_counts_as_invited(async_client, fresh_company, admin_headers, db_session):
    db_session.add(ErpUser(id=EMPLOYEE, company_id=C1, email="e@t.local", name="직원",
                           erp_team_id=0, role=ErpRole.EMPLOYEE, is_active=True))
    await db_session.commit()

    b = (await async_client.get("/api/onboarding", headers=admin_headers)).json()
    assert b["checklist"]["team_invited"] is True


@pytest.mark.asyncio
async def test_issued_invite_counts_even_before_acceptance(
    async_client, fresh_company, admin_headers, db_session
):
    """수락 전이어도 초대 링크를 발급했으면 '사람을 부른 행위'는 끝났다."""
    db_session.add(AuthToken(
        id=uuid4(), company_id=C1, user_id=ADMIN, purpose=AuthTokenPurpose.INVITATION,
        token_hash="x" * 64, expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    ))
    await db_session.commit()

    b = (await async_client.get("/api/onboarding", headers=admin_headers)).json()
    assert b["checklist"]["team_invited"] is True


@pytest.mark.asyncio
async def test_checklist_unsets_when_data_removed(async_client, fresh_company, admin_headers, db_session):
    """저장 플래그가 아니라 실측이므로, 좌석을 지우면 항목도 풀려야 한다."""
    seat = Seat(id=uuid4(), company_id=C1, floor_id=uuid4(), type=SeatType.FREE,
                status=SeatStatus.AVAILABLE, coords={"x": 1.0, "y": 1.0})
    db_session.add(seat)
    await db_session.commit()
    assert (await async_client.get("/api/onboarding", headers=admin_headers)).json()["checklist"]["seat_placed"] is True

    await db_session.delete(seat)
    await db_session.commit()
    assert (await async_client.get("/api/onboarding", headers=admin_headers)).json()["checklist"]["seat_placed"] is False


@pytest.mark.asyncio
async def test_soft_deleted_notice_does_not_count(async_client, fresh_company, admin_headers, db_session):
    """공지 삭제는 soft-delete(D18) — 행은 남지만 체크리스트는 다시 풀려야 한다.

    (전체 행을 세면 '지웠는데도 완료'로 남아 실측 파생의 의미가 사라진다.)
    """
    notice = Notice(id=uuid4(), company_id=C1, title="환영", body="본문", created_by=ADMIN,
                    published_at=datetime.now(timezone.utc))
    db_session.add(notice)
    await db_session.commit()
    assert (await async_client.get("/api/onboarding", headers=admin_headers)).json()["checklist"]["notice_posted"] is True

    notice.is_active = False
    await db_session.commit()
    assert (await async_client.get("/api/onboarding", headers=admin_headers)).json()["checklist"]["notice_posted"] is False


@pytest.mark.asyncio
async def test_completed_when_all_three(async_client, fresh_company, admin_headers, db_session):
    db_session.add_all([
        Seat(id=uuid4(), company_id=C1, floor_id=uuid4(), type=SeatType.FREE,
             status=SeatStatus.AVAILABLE, coords={"x": 1.0, "y": 1.0}),
        Notice(id=uuid4(), company_id=C1, title="공지", body="본문", created_by=ADMIN,
               published_at=datetime.now(timezone.utc)),
        ErpUser(id=EMPLOYEE, company_id=C1, email="e@t.local", name="직원", erp_team_id=0,
                role=ErpRole.EMPLOYEE, is_active=True),
    ])
    await db_session.commit()

    b = (await async_client.get("/api/onboarding", headers=admin_headers)).json()
    assert b["completed"] is True


# ── 테넌트 격리 ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_other_company_data_does_not_complete_my_checklist(
    async_client, fresh_company, admin_headers, db_session
):
    """타사 좌석·공지가 내 체크리스트를 채우면 안 된다(집계가 전역이면 새어나간다)."""
    db_session.add_all([
        Seat(id=uuid4(), company_id=C2, floor_id=uuid4(), type=SeatType.FREE,
             status=SeatStatus.AVAILABLE, coords={"x": 1.0, "y": 1.0}),
        Notice(id=uuid4(), company_id=C2, title="타사 공지", body="본문", created_by=C2_ADMIN,
               published_at=datetime.now(timezone.utc)),
        ErpUser(id=999, company_id=C2, email="x@t.local", name="타사직원", erp_team_id=0,
                role=ErpRole.EMPLOYEE, is_active=True),
    ])
    await db_session.commit()

    b = (await async_client.get("/api/onboarding", headers=admin_headers)).json()
    assert b["checklist"] == {"seat_placed": False, "notice_posted": False, "team_invited": False}


@pytest.mark.asyncio
async def test_dismiss_does_not_leak_across_tenants(async_client, fresh_company, admin_headers, db_session):
    await async_client.patch("/api/onboarding", json={"dismissed": True}, headers=admin_headers)
    other = (await db_session.execute(select(Company).where(Company.id == C2))).scalar_one()
    assert other.onboarding_dismissed is False


# ── dismiss (회사 단위, admin) ─────────────────────────────
@pytest.mark.asyncio
async def test_dismiss_persists(async_client, fresh_company, admin_headers):
    r = await async_client.patch("/api/onboarding", json={"dismissed": True}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["dismissed"] is True
    assert (await async_client.get("/api/onboarding", headers=admin_headers)).json()["dismissed"] is True


@pytest.mark.asyncio
async def test_dismiss_is_shared_by_admins(async_client, fresh_company, admin_headers, db_session):
    """회사 단위 상태 — 다른 admin에게도 접힌 채로 보인다."""
    db_session.add(ErpUser(id=504, company_id=C1, email="a2@t.local", name="관리자2",
                           erp_team_id=0, role=ErpRole.ADMIN, is_active=True))
    await db_session.commit()
    await async_client.patch("/api/onboarding", json={"dismissed": True}, headers=admin_headers)

    other_admin = _headers(504, C1)
    assert (await async_client.get("/api/onboarding", headers=other_admin)).json()["dismissed"] is True


@pytest.mark.asyncio
async def test_employee_cannot_dismiss(async_client, fresh_company, admin_headers, db_session):
    db_session.add(ErpUser(id=EMPLOYEE, company_id=C1, email="e@t.local", name="직원",
                           erp_team_id=0, role=ErpRole.EMPLOYEE, is_active=True))
    await db_session.commit()

    r = await async_client.patch(
        "/api/onboarding", json={"dismissed": True}, headers=_headers(EMPLOYEE, C1, "employee")
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_employee_sees_can_manage_false(async_client, fresh_company, employee_headers, db_session):
    db_session.add(ErpUser(id=EMPLOYEE, company_id=C1, email="e@t.local", name="직원",
                           erp_team_id=0, role=ErpRole.EMPLOYEE, is_active=True))
    await db_session.commit()

    b = (await async_client.get("/api/onboarding", headers=employee_headers)).json()
    assert b["can_manage"] is False


# ── tour (유저 단위, 전 역할) ───────────────────────────────
@pytest.mark.asyncio
async def test_tour_is_per_user(async_client, fresh_company, admin_headers, db_session):
    db_session.add(ErpUser(id=EMPLOYEE, company_id=C1, email="e@t.local", name="직원",
                           erp_team_id=0, role=ErpRole.EMPLOYEE, is_active=True))
    await db_session.commit()

    r = await async_client.patch("/api/onboarding", json={"tour_done": True}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["tour_done"] is True

    # 다른 사람은 아직 안 봤다
    emp = (await async_client.get("/api/onboarding", headers=_headers(EMPLOYEE, C1, "employee"))).json()
    assert emp["tour_done"] is False


@pytest.mark.asyncio
async def test_employee_can_mark_own_tour(async_client, fresh_company, db_session):
    db_session.add(ErpUser(id=EMPLOYEE, company_id=C1, email="e@t.local", name="직원",
                           erp_team_id=0, role=ErpRole.EMPLOYEE, is_active=True))
    await db_session.commit()

    r = await async_client.patch(
        "/api/onboarding", json={"tour_done": True}, headers=_headers(EMPLOYEE, C1, "employee")
    )
    assert r.status_code == 200, r.text
    assert r.json()["tour_done"] is True


@pytest.mark.asyncio
async def test_requires_auth(async_client, fresh_company):
    assert (await async_client.get("/api/onboarding")).status_code == 401
    assert (await async_client.patch("/api/onboarding", json={"tour_done": True})).status_code == 401
