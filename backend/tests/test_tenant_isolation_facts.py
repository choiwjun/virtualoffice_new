"""멀티테넌시 쿼리 스코프 — fact 테이블 교차 테넌트 격리 (Phase 1c · 22 T0-1 IDOR + T1-3).

work_log·kpi_result·report·notice·chat_message·presence: UUID/식별자를 안다고 해도 타사
데이터는 GET/PATCH/DELETE가 404여야 하고(존재 은닉), 목록에서 제외돼야 한다. 자사 데이터는
정상 동작해야 한다.

시나리오:
- Company(1)·Company(2) + 각 회사 사용자(11=c1 admin, 22=c2 admin).
- 각 회사의 work_log/kpi_result/report/notice/chat_message/presence(company_id=1|2) 시드.
- company-1 authed 호출자(admin)가 company-2 리소스에 접근 → 404 또는 목록 제외.
- company-1 자사 리소스는 정상 동작.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import AsyncGenerator
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db import Base, get_db
from app.main import app
from app.models.tables import (
    ChatMessage,
    Company,
    ErpRole,
    ErpUser,
    KpiObjectionStatus,
    KpiPeriodType,
    KpiResult,
    KpiSource,
    Notice,
    NoticeCategory,
    Presence,
    PresenceStatus,
    Report,
    ReportStatus,
    ReportType,
    WorkLog,
    WorkLogStatus,
)


# ---------------------------------------------------------------------------
# 픽스처 (표준 인메모리 SQLite + get_db 오버라이드)
# ---------------------------------------------------------------------------


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


# company-1 admin (user 11). company_id=1·team_id=1 클레임 명시.
@pytest.fixture
def company1_admin_headers() -> dict:
    token = create_access_token(
        {"sub": "11", "email": "c1admin@test.local", "role": "admin", "company_id": 1, "team_id": 1}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def seeded(db_session: AsyncSession) -> dict:
    """회사 1·2의 Company/User + 6개 fact 테이블 레코드 시드."""
    now = datetime.now(timezone.utc)
    today = date.today()

    db_session.add(Company(id=1, name="회사1", slug="c1", created_at=now, updated_at=now))
    db_session.add(Company(id=2, name="회사2", slug="c2", created_at=now, updated_at=now))

    db_session.add(ErpUser(id=11, company_id=1, email="c1admin@test.local", name="C1Admin", erp_team_id=1, role=ErpRole.ADMIN))
    db_session.add(ErpUser(id=22, company_id=2, email="c2admin@test.local", name="C2Admin", erp_team_id=1, role=ErpRole.ADMIN))

    # work_log
    wl1 = WorkLog(id=uuid4(), company_id=1, user_id=11, work_date=today, title="c1 업무", status=WorkLogStatus.STARTED)
    wl2 = WorkLog(id=uuid4(), company_id=2, user_id=22, work_date=today, title="c2 업무", status=WorkLogStatus.STARTED)

    # kpi_result
    k1 = KpiResult(id=uuid4(), company_id=1, user_id=11, period_type=KpiPeriodType.DAILY, period_key=today.isoformat(),
                   metric="work_completed_count", value=Decimal("1.00"), source=KpiSource.VIRTUAL_OFFICE,
                   objection_status=KpiObjectionStatus.NONE)
    k2 = KpiResult(id=uuid4(), company_id=2, user_id=22, period_type=KpiPeriodType.DAILY, period_key=today.isoformat(),
                   metric="work_completed_count", value=Decimal("2.00"), source=KpiSource.VIRTUAL_OFFICE,
                   objection_status=KpiObjectionStatus.NONE)

    # report
    r1 = Report(id=uuid4(), company_id=1, user_id=11, report_type=ReportType.DAILY, report_date=today,
                title="c1 보고", content="본문", status=ReportStatus.DRAFT)
    r2 = Report(id=uuid4(), company_id=2, user_id=22, report_type=ReportType.DAILY, report_date=today,
                title="c2 보고", content="본문", status=ReportStatus.DRAFT)

    # notice (author=plain String, company_id로 스코프)
    n1 = Notice(id=uuid4(), company_id=1, title="c1 공지", author="c1", category=NoticeCategory.NOTICE,
                published_at=now, created_by=11)
    n2 = Notice(id=uuid4(), company_id=2, title="c2 공지", author="c2", category=NoticeCategory.NOTICE,
                published_at=now, created_by=22)

    # chat_message (general 채널 — 회사별 격리 검증)
    cm1 = ChatMessage(id=uuid4(), company_id=1, channel="general", user_id=11, content="c1 안녕", created_at=now)
    cm2 = ChatMessage(id=uuid4(), company_id=2, channel="general", user_id=22, content="c2 안녕", created_at=now)

    # presence
    p1 = Presence(user_id=11, company_id=1, status=PresenceStatus.ONLINE, updated_at=now)
    p2 = Presence(user_id=22, company_id=2, status=PresenceStatus.ONLINE, updated_at=now)

    db_session.add_all([wl1, wl2, k1, k2, r1, r2, n1, n2, cm1, cm2, p1, p2])
    await db_session.commit()
    return {
        "wl1": wl1, "wl2": wl2, "k1": k1, "k2": k2, "r1": r1, "r2": r2,
        "n1": n1, "n2": n2, "cm1": cm1, "cm2": cm2, "p1": p1, "p2": p2,
    }


# ---------------------------------------------------------------------------
# work_log 교차 테넌트 격리
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_work_log_cross_tenant_get_is_404(async_client, seeded, company1_admin_headers):
    r = await async_client.get(f"/api/work-logs/{seeded['wl2'].id}", headers=company1_admin_headers)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_work_log_cross_tenant_patch_is_404(async_client, seeded, company1_admin_headers):
    r = await async_client.patch(
        f"/api/work-logs/{seeded['wl2'].id}", json={"title": "탈취"}, headers=company1_admin_headers
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_work_log_cross_tenant_delete_is_404(async_client, seeded, company1_admin_headers):
    r = await async_client.delete(f"/api/work-logs/{seeded['wl2'].id}", headers=company1_admin_headers)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_work_log_list_excludes_other_tenant(async_client, seeded, company1_admin_headers):
    r = await async_client.get("/api/work-logs", headers=company1_admin_headers)
    assert r.status_code == 200, r.text
    ids = {w["id"] for w in r.json()}
    assert str(seeded["wl1"].id) in ids
    assert str(seeded["wl2"].id) not in ids


@pytest.mark.asyncio
async def test_work_log_own_tenant_ops_ok(async_client, seeded, company1_admin_headers):
    wid = seeded["wl1"].id
    assert (await async_client.get(f"/api/work-logs/{wid}", headers=company1_admin_headers)).status_code == 200
    r = await async_client.patch(f"/api/work-logs/{wid}", json={"title": "갱신"}, headers=company1_admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "갱신"


# ---------------------------------------------------------------------------
# kpi_result 교차 테넌트 격리
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_kpi_cross_tenant_get_is_404(async_client, seeded, company1_admin_headers):
    r = await async_client.get(f"/api/kpi-results/{seeded['k2'].id}", headers=company1_admin_headers)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_kpi_cross_tenant_adjust_is_404(async_client, seeded, company1_admin_headers):
    r = await async_client.post(
        f"/api/kpi-results/{seeded['k2'].id}/adjust",
        json={"admin_adjusted_score": 2.0, "admin_note": "x" * 40},
        headers=company1_admin_headers,
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_kpi_list_excludes_other_tenant(async_client, seeded, company1_admin_headers):
    # user_id=22 (company 2) 롤업을 company-1 admin이 요청 → 자사 필터로 빈 목록.
    r = await async_client.get("/api/kpi-results?user_id=22", headers=company1_admin_headers)
    assert r.status_code == 200, r.text
    ids = {k["id"] for k in r.json()}
    assert str(seeded["k2"].id) not in ids


@pytest.mark.asyncio
async def test_kpi_own_tenant_ops_ok(async_client, seeded, company1_admin_headers):
    r = await async_client.get(f"/api/kpi-results/{seeded['k1'].id}", headers=company1_admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == str(seeded["k1"].id)


# ---------------------------------------------------------------------------
# report 교차 테넌트 격리
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_report_cross_tenant_get_is_404(async_client, seeded, company1_admin_headers):
    r = await async_client.get(f"/api/reports/{seeded['r2'].id}", headers=company1_admin_headers)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_report_cross_tenant_delete_is_404(async_client, seeded, company1_admin_headers):
    r = await async_client.delete(f"/api/reports/{seeded['r2'].id}", headers=company1_admin_headers)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_report_list_excludes_other_tenant(async_client, seeded, company1_admin_headers):
    r = await async_client.get("/api/reports", headers=company1_admin_headers)
    assert r.status_code == 200, r.text
    ids = {x["id"] for x in r.json()}
    assert str(seeded["r1"].id) in ids
    assert str(seeded["r2"].id) not in ids


@pytest.mark.asyncio
async def test_report_own_tenant_ops_ok(async_client, seeded, company1_admin_headers):
    r = await async_client.get(f"/api/reports/{seeded['r1'].id}", headers=company1_admin_headers)
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# notice 교차 테넌트 격리
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_notice_cross_tenant_patch_is_404(async_client, seeded, company1_admin_headers):
    r = await async_client.patch(
        f"/api/notices/{seeded['n2'].id}", json={"title": "탈취"}, headers=company1_admin_headers
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_notice_cross_tenant_delete_is_404(async_client, seeded, company1_admin_headers):
    r = await async_client.delete(f"/api/notices/{seeded['n2'].id}", headers=company1_admin_headers)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_notice_list_excludes_other_tenant(async_client, seeded, company1_admin_headers):
    r = await async_client.get("/api/notices", headers=company1_admin_headers)
    assert r.status_code == 200, r.text
    ids = {x["id"] for x in r.json()["items"]}
    assert str(seeded["n1"].id) in ids
    assert str(seeded["n2"].id) not in ids


@pytest.mark.asyncio
async def test_notice_own_tenant_patch_ok(async_client, seeded, company1_admin_headers):
    r = await async_client.patch(
        f"/api/notices/{seeded['n1'].id}", json={"title": "갱신"}, headers=company1_admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "갱신"


# ---------------------------------------------------------------------------
# chat_message 교차 테넌트 격리
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_general_excludes_other_tenant(async_client, seeded, company1_admin_headers):
    # 같은 'general' 채널이라도 회사별 격리 — c2 메시지가 c1 조회에 안 보인다.
    r = await async_client.get("/api/chat/messages?channel=general", headers=company1_admin_headers)
    assert r.status_code == 200, r.text
    contents = {m["content"] for m in r.json()}
    assert "c1 안녕" in contents
    assert "c2 안녕" not in contents


@pytest.mark.asyncio
async def test_chat_create_and_read_own_tenant_ok(async_client, seeded, company1_admin_headers):
    r = await async_client.post(
        "/api/chat/messages", json={"channel": "general", "content": "새 메시지"}, headers=company1_admin_headers
    )
    assert r.status_code == 201, r.text
    r2 = await async_client.get("/api/chat/messages?channel=general", headers=company1_admin_headers)
    contents = {m["content"] for m in r2.json()}
    assert "새 메시지" in contents
    assert "c2 안녕" not in contents


# ---------------------------------------------------------------------------
# presence 교차 테넌트 격리 (내부 write 경로 회사 파생)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_presence_internal_write_derives_company(db_session, seeded):
    """내부 write(upsert_presence)는 JWT 없이 user_id에서 company_id를 파생한다."""
    from app.services.presence_store import upsert_presence

    # c2 사용자(22)의 프레즌스를 갱신 → company_id=2로 파생되어야 함.
    rec = await upsert_presence(db_session, user_id=22, status=PresenceStatus.WORKING)
    assert rec.company_id == 2
    # c1 사용자(11) → company_id=1
    rec1 = await upsert_presence(db_session, user_id=11, status=PresenceStatus.WORKING)
    assert rec1.company_id == 1
