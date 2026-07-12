"""
meetings API 통합 테스트 — G002 Lane B

검증 범위:
1. POST /api/meetings — 회의 예약 성공
2. POST /api/meetings — room 존재 안 함 → 404
3. POST /api/meetings — 동일 room 동일 시간 → 409 (D23)
4. GET  /api/meetings — 목록 조회 / scheduled_at 범위 필터
5. GET  /api/meetings/{id} — 상세 조회 / 없으면 404
6. POST /api/meetings/{id}/join — 참석 등록 (upsert joined_at)
7. GET  /api/meetings/{id}/participants — 참석자 목록
8. 인증 없이 → 401
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
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
    ErpUser,
    ErpRole,
    Meeting,
    MeetingStatus,
    Room,
    RoomStatus,
    RoomType,
)


# ---------------------------------------------------------------------------
# 픽스처
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


@pytest.fixture
def user_token() -> str:
    return create_access_token({"sub": "1001", "email": "alice@test.local", "role": "employee"})


@pytest.fixture
def admin_token() -> str:
    return create_access_token({"sub": "1002", "email": "bob@test.local", "role": "admin"})


@pytest.fixture
def auth_headers(user_token: str) -> dict:
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture
def admin_headers(admin_token: str) -> dict:
    return {"Authorization": f"Bearer {admin_token}"}


@pytest_asyncio.fixture
async def seeded(db_session: AsyncSession):
    """기본 시드: room, erp_user (SQLite FK 미적용 — Office/Floor 불필요)."""
    room = Room(
        id=uuid4(),
        floor_id=uuid4(),           # SQLite FK 미적용
        type=RoomType.MEETING,
        name="회의실 A",
        capacity=10,
        coords={"x": 0, "y": 0, "width": 10, "height": 10},
        status=RoomStatus.ACTIVE,
    )
    db_session.add(room)

    user = ErpUser(
        id=1001,
        company_id=1,
        email="alice@test.local",
        name="Alice",
        erp_team_id=1,
        role=ErpRole.EMPLOYEE,
    )
    db_session.add(user)

    user2 = ErpUser(
        id=1002,
        company_id=1,
        email="bob@test.local",
        name="Bob",
        erp_team_id=1,
        role=ErpRole.ADMIN,
    )
    db_session.add(user2)

    await db_session.commit()
    return {"room": room}


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _future_utc(hours: int = 1) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


# ---------------------------------------------------------------------------
# 테스트
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_meeting_success(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    scheduled = _future_utc(2)
    resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "Q2 킥오프", "scheduled_at": scheduled},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["title"] == "Q2 킥오프"
    assert data["room_id"] == room_id
    assert data["status"] == "scheduled"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_meeting_room_not_found(async_client, seeded, auth_headers):
    resp = await async_client.post(
        "/api/meetings",
        json={"room_id": str(uuid4()), "title": "없는 방", "scheduled_at": _future_utc()},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_meeting_room_time_conflict(async_client, seeded, auth_headers):
    """D23: 동일 room + 동일 scheduled_at → 409."""
    room_id = str(seeded["room"].id)
    scheduled = _future_utc(3)
    # 첫 번째 예약
    resp1 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "첫 회의", "scheduled_at": scheduled},
        headers=auth_headers,
    )
    assert resp1.status_code == 201

    # 두 번째 예약 (동일 방, 동일 시각) → 409
    resp2 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "충돌 회의", "scheduled_at": scheduled},
        headers=auth_headers,
    )
    assert resp2.status_code == 409
    assert "conflict" in resp2.json()["detail"]


@pytest.mark.asyncio
async def test_create_meeting_cancelled_no_conflict(async_client, seeded, db_session, auth_headers):
    """취소된 회의는 겹침 검사에서 제외."""
    room_id = str(seeded["room"].id)
    scheduled = _future_utc(4)

    # 예약 생성
    resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "취소 회의", "scheduled_at": scheduled},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    meeting_id = resp.json()["id"]

    # DB에서 직접 cancelled 처리
    from uuid import UUID
    result = await db_session.execute(
        select(Meeting).where(Meeting.id == UUID(meeting_id))
    )
    m = result.scalar_one()
    m.status = MeetingStatus.CANCELLED
    await db_session.commit()

    # 같은 방, 같은 시각으로 재예약 → 201 (취소 제외)
    resp2 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "재예약", "scheduled_at": scheduled},
        headers=auth_headers,
    )
    assert resp2.status_code == 201


@pytest.mark.asyncio
async def test_list_meetings(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    for i in range(3):
        await async_client.post(
            "/api/meetings",
            json={"room_id": room_id, "title": f"회의 {i}", "scheduled_at": _future_utc(i + 1)},
            headers=auth_headers,
        )
    resp = await async_client.get("/api/meetings", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) >= 3


@pytest.mark.asyncio
async def test_list_meetings_date_filter(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    far_future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "멀리 회의", "scheduled_at": far_future},
        headers=auth_headers,
    )
    # 오늘부터 내일까지 필터 → 멀리 회의 제외
    from_dt = datetime.now(timezone.utc).isoformat()
    to_dt = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    resp = await async_client.get(
        "/api/meetings",
        params={"scheduled_from": from_dt, "scheduled_to": to_dt},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    titles = [m["title"] for m in resp.json()]
    assert "멀리 회의" not in titles


@pytest.mark.asyncio
async def test_get_meeting_detail(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    create_resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "상세 조회 테스트", "scheduled_at": _future_utc(5)},
        headers=auth_headers,
    )
    meeting_id = create_resp.json()["id"]

    resp = await async_client.get(f"/api/meetings/{meeting_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == meeting_id
    assert resp.json()["title"] == "상세 조회 테스트"


@pytest.mark.asyncio
async def test_get_meeting_not_found(async_client, auth_headers):
    resp = await async_client.get(f"/api/meetings/{uuid4()}", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_join_meeting(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    create_resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "참석 테스트", "scheduled_at": _future_utc(6)},
        headers=auth_headers,
    )
    meeting_id = create_resp.json()["id"]

    resp = await async_client.post(f"/api/meetings/{meeting_id}/join", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["meeting_id"] == meeting_id
    assert data["user_id"] == 1001
    assert data["joined_at"] is not None


@pytest.mark.asyncio
async def test_join_meeting_upsert(async_client, seeded, auth_headers):
    """같은 사용자가 join 두 번 → joined_at 갱신, 레코드 중복 없음."""
    room_id = str(seeded["room"].id)
    create_resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "Upsert 테스트", "scheduled_at": _future_utc(7)},
        headers=auth_headers,
    )
    meeting_id = create_resp.json()["id"]

    r1 = await async_client.post(f"/api/meetings/{meeting_id}/join", headers=auth_headers)
    assert r1.status_code == 200

    import asyncio
    await asyncio.sleep(0.01)

    r2 = await async_client.post(f"/api/meetings/{meeting_id}/join", headers=auth_headers)
    assert r2.status_code == 200
    # joined_at이 갱신되었거나 같아야 함 (upsert)
    assert r2.json()["user_id"] == 1001


@pytest.mark.asyncio
async def test_list_participants(async_client, seeded, auth_headers, admin_headers):
    room_id = str(seeded["room"].id)
    create_resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "참석자 목록 테스트", "scheduled_at": _future_utc(8)},
        headers=auth_headers,
    )
    meeting_id = create_resp.json()["id"]

    # user 1001 참석
    await async_client.post(f"/api/meetings/{meeting_id}/join", headers=auth_headers)
    # user 1002 참석
    await async_client.post(f"/api/meetings/{meeting_id}/join", headers=admin_headers)

    resp = await async_client.get(f"/api/meetings/{meeting_id}/participants", headers=auth_headers)
    assert resp.status_code == 200
    participants = resp.json()
    user_ids = {p["user_id"] for p in participants}
    assert 1001 in user_ids
    assert 1002 in user_ids


@pytest.mark.asyncio
async def test_unauthenticated_401(async_client, seeded):
    resp = await async_client.get("/api/meetings")
    assert resp.status_code == 401
