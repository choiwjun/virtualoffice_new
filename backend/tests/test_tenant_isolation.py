"""멀티테넌시 쿼리 스코프 — 교차 테넌트 격리 테스트 (Phase 1b · 22 T0-1 IDOR 차단).

meetings·seats의 UUID를 안다고 해도 타사 데이터는 GET/PATCH/DELETE가 404여야 한다
(존재 은닉). 자사 데이터는 정상 동작(200/201)해야 한다.

시나리오:
- Company(id=2) + 그 회사의 Office/Floor/Room + Meeting/Seat(company_id=2) 시드.
- Company(id=1)의 Meeting/Seat(company_id=1)도 시드.
- company-1 authed 호출자가:
    * company-2 meeting/seat GET·PATCH·DELETE → 404
    * company-1 자사 meeting/seat GET·PATCH·DELETE → 200
"""

from __future__ import annotations

from datetime import datetime, timezone
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
    Company,
    ErpUser,
    ErpRole,
    Floor,
    Meeting,
    MeetingStatus,
    Office,
    Room,
    RoomStatus,
    RoomType,
    Seat,
    SeatStatus,
    SeatType,
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


# admin 권한 = 회사 1 소속 (PATCH/DELETE는 admin 필요). company_id=1 클레임 명시.
@pytest.fixture
def company1_admin_headers() -> dict:
    token = create_access_token(
        {"sub": "11", "email": "c1admin@test.local", "role": "admin", "company_id": 1}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def seeded(db_session: AsyncSession) -> dict:
    """회사 1·2의 Company/Office/Floor/Room + Meeting/Seat 시드."""
    now = datetime.now(timezone.utc)

    # Company id=2 (id=1은 create_all 후 별도 시드 — FK 충족용으로 둘 다 명시)
    db_session.add(Company(id=1, name="회사1", slug="c1", created_at=now, updated_at=now))
    db_session.add(Company(id=2, name="회사2", slug="c2", created_at=now, updated_at=now))

    # 회사별 사용자
    db_session.add(ErpUser(id=11, company_id=1, email="c1admin@test.local", name="C1Admin", erp_team_id=1, role=ErpRole.ADMIN))
    db_session.add(ErpUser(id=22, company_id=2, email="c2user@test.local", name="C2User", erp_team_id=1, role=ErpRole.ADMIN))

    # 회사별 Office/Floor/Room (Room은 두 회사 공통 층 없이 각자)
    room1 = Room(id=uuid4(), floor_id=uuid4(), type=RoomType.MEETING, name="회사1 회의실",
                 capacity=10, coords={"x": 0, "y": 0, "width": 5, "height": 5}, status=RoomStatus.ACTIVE)
    room2 = Room(id=uuid4(), floor_id=uuid4(), type=RoomType.MEETING, name="회사2 회의실",
                 capacity=10, coords={"x": 0, "y": 0, "width": 5, "height": 5}, status=RoomStatus.ACTIVE)
    db_session.add_all([room1, room2])

    # 회사 1 회의/좌석 (company_id=1)
    m1 = Meeting(id=uuid4(), company_id=1, room_id=room1.id, host_user_id=11,
                 title="회사1 회의", scheduled_at=now, duration_minutes=60, status=MeetingStatus.SCHEDULED)
    s1 = Seat(id=uuid4(), company_id=1, floor_id=uuid4(), type=SeatType.FREE,
              status=SeatStatus.AVAILABLE, coords={"x": 1.0, "y": 1.0})
    # 회사 2 회의/좌석 (company_id=2 — 타사)
    m2 = Meeting(id=uuid4(), company_id=2, room_id=room2.id, host_user_id=22,
                 title="회사2 회의", scheduled_at=now, duration_minutes=60, status=MeetingStatus.SCHEDULED)
    s2 = Seat(id=uuid4(), company_id=2, floor_id=uuid4(), type=SeatType.FREE,
              status=SeatStatus.OCCUPIED, assigned_user_id=22, coords={"x": 2.0, "y": 2.0})
    db_session.add_all([m1, s1, m2, s2])

    await db_session.commit()
    return {"m1": m1, "s1": s1, "m2": m2, "s2": s2}


# ---------------------------------------------------------------------------
# 회의(meeting) 교차 테넌트 격리
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_meeting_cross_tenant_get_is_404(async_client, seeded, company1_admin_headers):
    """company-1 호출자가 company-2 회의 상세 조회 → 404."""
    r = await async_client.get(f"/api/meetings/{seeded['m2'].id}", headers=company1_admin_headers)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_meeting_cross_tenant_patch_is_404(async_client, seeded, company1_admin_headers):
    """company-1 admin이 company-2 회의 수정(PUT) → 404 (변조 차단)."""
    r = await async_client.put(
        f"/api/meetings/{seeded['m2'].id}",
        json={"title": "탈취 시도"},
        headers=company1_admin_headers,
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_meeting_cross_tenant_delete_is_404(async_client, seeded, company1_admin_headers):
    """company-1 admin이 company-2 회의 취소(DELETE) → 404."""
    r = await async_client.delete(f"/api/meetings/{seeded['m2'].id}", headers=company1_admin_headers)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_meeting_cross_tenant_action_is_404(async_client, seeded, company1_admin_headers):
    """company-1 admin이 company-2 회의 join/start → 404 (액션 경로도 격리)."""
    r_join = await async_client.post(f"/api/meetings/{seeded['m2'].id}/join", headers=company1_admin_headers)
    assert r_join.status_code == 404, r_join.text
    r_start = await async_client.post(f"/api/meetings/{seeded['m2'].id}/start", headers=company1_admin_headers)
    assert r_start.status_code == 404, r_start.text


@pytest.mark.asyncio
async def test_meeting_list_excludes_other_tenant(async_client, seeded, company1_admin_headers):
    """company-1 목록엔 company-2 회의가 없다 (스코프 필터)."""
    r = await async_client.get("/api/meetings", headers=company1_admin_headers)
    assert r.status_code == 200, r.text
    ids = {m["id"] for m in r.json()}
    assert str(seeded["m1"].id) in ids
    assert str(seeded["m2"].id) not in ids


@pytest.mark.asyncio
async def test_meeting_own_tenant_ops_ok(async_client, seeded, company1_admin_headers):
    """company-1 자사 회의는 GET·PATCH·DELETE 정상."""
    mid = seeded["m1"].id
    assert (await async_client.get(f"/api/meetings/{mid}", headers=company1_admin_headers)).status_code == 200
    r_patch = await async_client.put(
        f"/api/meetings/{mid}", json={"title": "제목 갱신"}, headers=company1_admin_headers
    )
    assert r_patch.status_code == 200, r_patch.text
    assert r_patch.json()["title"] == "제목 갱신"
    r_del = await async_client.delete(f"/api/meetings/{mid}", headers=company1_admin_headers)
    assert r_del.status_code == 200, r_del.text
    assert r_del.json()["status"] == "cancelled"


# ---------------------------------------------------------------------------
# 좌석(seat) 교차 테넌트 격리
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_seat_cross_tenant_assign_is_404(async_client, seeded, company1_admin_headers):
    """company-1 호출자가 company-2 좌석 점유 시도 → 404 (변조 차단)."""
    r = await async_client.post(
        "/api/seat-assignments",
        json={"seat_id": str(seeded["s2"].id)},
        headers=company1_admin_headers,
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_seat_cross_tenant_release_is_404(async_client, seeded, company1_admin_headers):
    """company-1 호출자가 company-2 좌석 반납 시도 → 404."""
    r = await async_client.post(
        f"/api/seat-assignments/{seeded['s2'].id}/release",
        headers=company1_admin_headers,
    )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_seat_cross_tenant_update_and_delete_is_404(async_client, seeded, company1_admin_headers):
    """company-1 admin이 company-2 좌석 PATCH(PUT)/DELETE → 404 (관리 경로도 격리)."""
    r_put = await async_client.put(
        f"/api/seats/{seeded['s2'].id}",
        json={"coords": {"x": 9.0, "y": 9.0}},
        headers=company1_admin_headers,
    )
    assert r_put.status_code == 404, r_put.text
    r_del = await async_client.delete(f"/api/seats/{seeded['s2'].id}", headers=company1_admin_headers)
    assert r_del.status_code == 404, r_del.text


@pytest.mark.asyncio
async def test_seat_list_excludes_other_tenant(async_client, seeded, company1_admin_headers):
    """company-1 좌석 목록엔 company-2 좌석이 없다 (스코프 필터)."""
    r = await async_client.get("/api/seats", headers=company1_admin_headers)
    assert r.status_code == 200, r.text
    ids = {s["id"] for s in r.json()}
    assert str(seeded["s1"].id) in ids
    assert str(seeded["s2"].id) not in ids


@pytest.mark.asyncio
async def test_seat_own_tenant_ops_ok(async_client, seeded, company1_admin_headers):
    """company-1 자사 좌석은 점유·수정 정상."""
    sid = seeded["s1"].id
    r_assign = await async_client.post(
        "/api/seat-assignments", json={"seat_id": str(sid)}, headers=company1_admin_headers
    )
    assert r_assign.status_code == 201, r_assign.text
    r_put = await async_client.put(
        f"/api/seats/{sid}", json={"coords": {"x": 3.0, "y": 3.0}}, headers=company1_admin_headers
    )
    assert r_put.status_code == 200, r_put.text
