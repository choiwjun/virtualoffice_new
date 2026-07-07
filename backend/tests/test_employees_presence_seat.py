"""employees 응답의 presence.status·seat.seat_number 조인 테스트 (spec 정합)."""

import uuid
from datetime import datetime, timezone

import pytest

from app.core.security import hash_password
from app.models.tables import (
    ErpRole,
    ErpUser,
    Floor,
    Presence,
    PresenceStatus,
    Seat,
    SeatStatus,
    SeatType,
)


@pytest.mark.asyncio
async def test_employees_include_presence_and_seat(async_client, admin_auth_headers, db_session):
    u = ErpUser(
        id=2001, company_id=1, email="dave@virtualoffice.local", name="데이브",
        erp_team_id=1, role=ErpRole.EMPLOYEE, position="개발자",
        password_hash=hash_password("password123"), is_active=True,
    )
    floor = Floor(id=uuid.uuid4(), office_id=uuid.uuid4(), level=1, name="1F")
    seat = Seat(
        id=uuid.uuid4(), floor_id=floor.id, type=SeatType.FREE, status=SeatStatus.OCCUPIED,
        coords={"x": 1, "y": 1}, assigned_user_id=2001, seat_number="1-A-07",
    )
    pres = Presence(user_id=2001, status=PresenceStatus.MEETING, updated_at=datetime.now(timezone.utc))
    db_session.add_all([u, floor, seat, pres])
    await db_session.commit()

    r = await async_client.get("/api/employees", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    row = next((e for e in r.json() if e["id"] == 2001), None)
    assert row is not None
    assert row["presence_status"] == "meeting"
    assert row["seat_number"] == "1-A-07"


@pytest.mark.asyncio
async def test_employees_presence_seat_null_when_absent(async_client, admin_auth_headers, db_session):
    u = ErpUser(
        id=2002, company_id=1, email="erin@virtualoffice.local", name="에린",
        erp_team_id=2, role=ErpRole.EMPLOYEE,
        password_hash=hash_password("password123"), is_active=True,
    )
    db_session.add(u)
    await db_session.commit()
    r = await async_client.get("/api/employees", headers=admin_auth_headers)
    row = next((e for e in r.json() if e["id"] == 2002), None)
    assert row is not None
    assert row["presence_status"] is None
    assert row["seat_number"] is None
