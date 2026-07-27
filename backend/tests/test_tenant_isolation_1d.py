"""Phase 1d 잔여 스코프 격리 — audit_log · room · floor · org_group · team · consent.

Phase 1b/1c가 meeting·seat·fact를 닫은 뒤에도 다음이 전 테넌트 공용으로 남아 있었다:

- `GET /api/audit-logs`  : 타사의 권한 변경·KPI 조정 이력이 그대로 조회됐다.
- `GET /api/rooms`       : 회의실 피커에 타사 방이 나오고, 그 방을 예약할 수 있었다.
- `GET /api/floors`      : 좌석 편집기 층 선택에 타사 층이 나왔다.
- `GET /api/teams`       : `DEFAULT_COMPANY_ID = 1` 하드코딩 → 신규 회사가 1번 회사 팀을 봤다.
- org_group CRUD          : 목록은 무필터, 단건 수정·삭제는 소유 검사가 아예 없었다.
- 녹화 동의(consent)      : 타사 회의의 참석자 동의 상태를 읽고 쓸 수 있었다.

이 스위트가 그 회귀를 막는다.
"""

from __future__ import annotations

from datetime import datetime, timezone
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
    AuditLog,
    Company,
    ErpRole,
    ErpUser,
    Floor,
    Meeting,
    MeetingStatus,
    Office,
    OrgGroup,
    OrgGroupType,
    Room,
    RoomStatus,
    RoomType,
)

C1, C2 = 1, 2
C1_ADMIN, C2_ADMIN = 301, 302


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
def c1_headers() -> dict:
    return _headers(C1_ADMIN, C1)


@pytest.fixture
def c2_headers() -> dict:
    return _headers(C2_ADMIN, C2)


@pytest_asyncio.fixture
async def seeded(db_session: AsyncSession) -> dict:
    """회사 1·2 각각 office/floor/room + org_group + audit_log + 회의."""
    now = datetime.now(timezone.utc)
    db_session.add_all([
        Company(id=C1, name="회사1", slug="c1"),
        Company(id=C2, name="회사2", slug="c2"),
        ErpUser(id=C1_ADMIN, company_id=C1, email="c1@t.local", name="C1관리자",
                erp_team_id=11, role=ErpRole.ADMIN, is_active=True),
        ErpUser(id=C2_ADMIN, company_id=C2, email="c2@t.local", name="C2관리자",
                erp_team_id=22, role=ErpRole.ADMIN, is_active=True),
    ])

    o1 = Office(id=uuid4(), company_id=C1, name="회사1 본사")
    o2 = Office(id=uuid4(), company_id=C2, name="회사2 본사")
    f1 = Floor(id=uuid4(), company_id=C1, office_id=o1.id, level=1, name="C1-1F")
    f2 = Floor(id=uuid4(), company_id=C2, office_id=o2.id, level=1, name="C2-1F")
    r1 = Room(id=uuid4(), company_id=C1, floor_id=f1.id, type=RoomType.MEETING, name="C1 회의실",
              capacity=10, coords={"x": 0, "y": 0, "width": 5, "height": 5}, status=RoomStatus.ACTIVE)
    r2 = Room(id=uuid4(), company_id=C2, floor_id=f2.id, type=RoomType.MEETING, name="C2 회의실",
              capacity=10, coords={"x": 0, "y": 0, "width": 5, "height": 5}, status=RoomStatus.ACTIVE)
    g1 = OrgGroup(id=uuid4(), company_id=C1, name="C1 본부", type=OrgGroupType.DIVISION)
    g2 = OrgGroup(id=uuid4(), company_id=C2, name="C2 본부", type=OrgGroupType.DIVISION)
    m2 = Meeting(id=uuid4(), company_id=C2, room_id=r2.id, host_user_id=C2_ADMIN,
                 title="C2 회의", scheduled_at=now, duration_minutes=60, status=MeetingStatus.SCHEDULED)
    a1 = AuditLog(id=uuid4(), company_id=C1, user_id=C1_ADMIN, action="kpi_adjusted",
                  entity_type="kpi_result", entity_id="c1-entity", created_at=now)
    a2 = AuditLog(id=uuid4(), company_id=C2, user_id=C2_ADMIN, action="kpi_adjusted",
                  entity_type="kpi_result", entity_id="c2-secret", created_at=now)
    db_session.add_all([o1, o2, f1, f2, r1, r2, g1, g2, m2, a1, a2])
    await db_session.commit()
    return {"r1": r1, "r2": r2, "f1": f1, "f2": f2, "g1": g1, "g2": g2, "m2": m2, "a1": a1, "a2": a2}


# ── 감사 로그 ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_audit_logs_scoped(async_client, seeded, c1_headers):
    r = await async_client.get("/api/audit-logs", headers=c1_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    ids = {x["entity_id"] for x in body["items"]}
    assert "c1-entity" in ids
    assert "c2-secret" not in ids, "타사 감사 기록이 노출됐다"
    assert body["total"] == 1, f"total도 스코프돼야 한다: {body['total']}"


@pytest.mark.asyncio
async def test_audit_write_carries_company(async_client, seeded, c2_headers, db_session):
    """새로 쌓이는 기록도 호출자 회사로 찍혀야 한다 (회의 취소 → meeting_cancelled)."""
    r = await async_client.delete(f"/api/meetings/{seeded['m2'].id}", headers=c2_headers)
    assert r.status_code == 200, r.text

    rows = (
        await db_session.execute(select(AuditLog).where(AuditLog.action == "meeting_cancelled"))
    ).scalars().all()
    assert rows and all(x.company_id == C2 for x in rows), [x.company_id for x in rows]


# ── 방 · 층 ────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_rooms_scoped(async_client, seeded, c1_headers):
    r = await async_client.get("/api/rooms", headers=c1_headers)
    assert r.status_code == 200, r.text
    ids = {x["id"] for x in r.json()}
    assert str(seeded["r1"].id) in ids
    assert str(seeded["r2"].id) not in ids


@pytest.mark.asyncio
async def test_cannot_book_other_tenant_room(async_client, seeded, c1_headers):
    """타사 방을 예약하면 남의 회의실이 이중예약된다 → 404."""
    r = await async_client.post(
        "/api/meetings",
        json={
            "room_id": str(seeded["r2"].id),
            "title": "남의 방 예약",
            "scheduled_at": "2026-08-01T02:00:00+00:00",
            "duration_minutes": 30,
        },
        headers=c1_headers,
    )
    assert r.status_code == 404, r.text
    assert r.json()["detail"] == "room_not_found"


@pytest.mark.asyncio
async def test_can_book_own_room(async_client, seeded, c1_headers):
    r = await async_client.post(
        "/api/meetings",
        json={
            "room_id": str(seeded["r1"].id),
            "title": "자사 방 예약",
            "scheduled_at": "2026-08-01T02:00:00+00:00",
            "duration_minutes": 30,
        },
        headers=c1_headers,
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_floors_scoped(async_client, seeded, c1_headers):
    r = await async_client.get("/api/floors", headers=c1_headers)
    assert r.status_code == 200, r.text
    ids = {x["id"] for x in r.json()}
    assert str(seeded["f1"].id) in ids
    assert str(seeded["f2"].id) not in ids


# ── 팀 · 조직도 ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_teams_scoped(async_client, seeded, c2_headers):
    """신규 회사가 1번 회사 팀 집계를 보면 안 된다 (DEFAULT_COMPANY_ID 하드코딩 회귀)."""
    r = await async_client.get("/api/teams", headers=c2_headers)
    assert r.status_code == 200, r.text
    team_ids = {t["team_id"] for t in r.json()["items"]}
    assert team_ids == {22}, team_ids


@pytest.mark.asyncio
async def test_org_groups_list_scoped(async_client, seeded, c1_headers):
    r = await async_client.get("/api/org-groups", headers=c1_headers)
    assert r.status_code == 200, r.text
    names = {g["name"] for g in r.json()["items"]}
    assert names == {"C1 본부"}, names


@pytest.mark.asyncio
async def test_org_group_cross_tenant_update_is_404(async_client, seeded, c1_headers, db_session):
    r = await async_client.put(
        f"/api/org-groups/{seeded['g2'].id}", json={"name": "탈취"}, headers=c1_headers
    )
    assert r.status_code == 404, r.text

    row = (await db_session.execute(select(OrgGroup).where(OrgGroup.id == seeded["g2"].id))).scalar_one()
    assert row.name == "C2 본부", "변조 전에 차단돼야 한다"


@pytest.mark.asyncio
async def test_org_group_cross_tenant_delete_is_404(async_client, seeded, c1_headers, db_session):
    r = await async_client.delete(f"/api/org-groups/{seeded['g2'].id}", headers=c1_headers)
    assert r.status_code == 404, r.text
    assert (
        await db_session.execute(select(OrgGroup).where(OrgGroup.id == seeded["g2"].id))
    ).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_org_group_create_injects_caller_company(async_client, seeded, c2_headers, db_session):
    r = await async_client.post(
        "/api/org-groups", json={"name": "C2 신규부서", "type": "department"}, headers=c2_headers
    )
    assert r.status_code == 201, r.text
    row = (
        await db_session.execute(select(OrgGroup).where(OrgGroup.name == "C2 신규부서"))
    ).scalar_one()
    assert row.company_id == C2


@pytest.mark.asyncio
async def test_org_group_cannot_parent_to_other_tenant(async_client, seeded, c1_headers):
    """타사 그룹을 부모로 지정하면 조직도가 테넌트를 가로질러 이어진다."""
    r = await async_client.post(
        "/api/org-groups",
        json={"name": "잘못된 자식", "type": "department", "parent_id": str(seeded["g2"].id)},
        headers=c1_headers,
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_org_validate_only_sees_own_company(async_client, seeded, c1_headers, db_session):
    """타사 조직도가 깨져 있어도 내 배포를 막으면 안 된다."""
    broken = OrgGroup(id=uuid4(), company_id=C2, name="C2 고아", type=OrgGroupType.PART,
                      parent_id=uuid4())  # 존재하지 않는 부모
    db_session.add(broken)
    await db_session.commit()

    r = await async_client.post("/api/org-groups/deploy", headers=c1_headers)
    assert r.status_code == 200, r.text
    assert r.json()["valid"] is True


# ── 녹화 동의 ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_consent_read_cross_tenant_is_404(async_client, seeded, c1_headers):
    r = await async_client.get(f"/api/meetings/{seeded['m2'].id}/consent", headers=c1_headers)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_consent_write_cross_tenant_is_404(async_client, seeded, c1_headers):
    r = await async_client.post(
        f"/api/meetings/{seeded['m2'].id}/consent",
        json={"consent_type": "recording", "granted": True},
        headers=c1_headers,
    )
    assert r.status_code == 404, r.text
