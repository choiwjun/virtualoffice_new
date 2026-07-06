"""G002 — 좌석 CRUD + 회의 수정/취소 테스트 (management-api.yaml)."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import Meeting, MeetingStatus, Seat, SeatStatus, SeatType

FLOOR_ID = uuid4()
ROOM_ID = uuid4()


# ── 좌석 CRUD ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_seat_create_admin(async_client: AsyncClient, admin_auth_headers):
    r = await async_client.post("/api/seats", headers=admin_auth_headers, json={"floor_id": str(FLOOR_ID), "type": "free", "coords": {"x": 5, "y": 6}, "seat_number": "A-01"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["floor_id"] == str(FLOOR_ID) and body["seat_number"] == "A-01" and body["status"] == "available"
    # GET reflects it
    g = await async_client.get("/api/seats", headers=admin_auth_headers)
    assert any(s["id"] == body["id"] for s in g.json())


@pytest.mark.asyncio
async def test_seat_create_forbidden_employee(async_client: AsyncClient, auth_headers):
    r = await async_client.post("/api/seats", headers=auth_headers, json={"floor_id": str(FLOOR_ID), "type": "free", "coords": {"x": 0, "y": 0}})
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_seat_update_and_delete(async_client: AsyncClient, admin_auth_headers, db_session: AsyncSession):
    seat = Seat(floor_id=FLOOR_ID, type=SeatType.FREE, coords={"x": 1, "y": 1}, status=SeatStatus.AVAILABLE)
    db_session.add(seat)
    await db_session.flush()
    sid = str(seat.id)
    # PUT coords (드래그 저장)
    r = await async_client.put(f"/api/seats/{sid}", headers=admin_auth_headers, json={"coords": {"x": 99, "y": 42}})
    assert r.status_code == 200, r.text
    assert r.json()["coords"] == {"x": 99, "y": 42}
    # DELETE (soft disable)
    d = await async_client.delete(f"/api/seats/{sid}", headers=admin_auth_headers)
    assert d.status_code == 200, d.text
    assert d.json()["status"] == "disabled"


# ── 회의 수정/취소 ────────────────────────────────────────
@pytest_asyncio.fixture
async def a_meeting(db_session: AsyncSession):
    m = Meeting(room_id=ROOM_ID, host_user_id=3, title="주간회의", scheduled_at=datetime(2026, 7, 10, 3, 0, tzinfo=timezone.utc), status=MeetingStatus.SCHEDULED)
    db_session.add(m)
    await db_session.flush()
    return m


@pytest.mark.asyncio
async def test_meeting_update(async_client: AsyncClient, admin_auth_headers, a_meeting):
    r = await async_client.put(f"/api/meetings/{a_meeting.id}", headers=admin_auth_headers, json={"title": "수정된 회의"})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "수정된 회의"


@pytest.mark.asyncio
async def test_meeting_update_forbidden_employee(async_client: AsyncClient, auth_headers, a_meeting):
    r = await async_client.put(f"/api/meetings/{a_meeting.id}", headers=auth_headers, json={"title": "x"})
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_meeting_update_time_conflict(async_client: AsyncClient, admin_auth_headers, db_session: AsyncSession):
    t1 = datetime(2026, 7, 11, 1, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 7, 11, 2, 0, tzinfo=timezone.utc)
    m1 = Meeting(room_id=ROOM_ID, host_user_id=3, title="M1", scheduled_at=t1, status=MeetingStatus.SCHEDULED)
    m2 = Meeting(room_id=ROOM_ID, host_user_id=3, title="M2", scheduled_at=t2, status=MeetingStatus.SCHEDULED)
    db_session.add_all([m1, m2])
    await db_session.flush()
    # m2를 m1 시각으로 이동 → 동일 room·시각 충돌 409
    r = await async_client.put(f"/api/meetings/{m2.id}", headers=admin_auth_headers, json={"scheduled_at": t1.isoformat()})
    assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_meeting_cancel(async_client: AsyncClient, admin_auth_headers, a_meeting):
    r = await async_client.delete(f"/api/meetings/{a_meeting.id}", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_floors_endpoint(async_client: AsyncClient, admin_auth_headers):
    r = await async_client.get("/api/floors", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)
