"""audit MED 항목 테스트: PUT 배정 수정, presence 30일 파기."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.tables import (
    Floor,
    Presence,
    PresenceStatus,
    Seat,
    SeatAssignmentHistory,
    SeatStatus,
    SeatType,
)


# ── PUT /seat-assignments/{seat_id} (배정 수정) ──────────────────────────

@pytest.mark.asyncio
async def test_reassign_seat(async_client, admin_auth_headers, db_session):
    floor = Floor(id=uuid.uuid4(), office_id=uuid.uuid4(), level=1, name="1F")
    seat = Seat(id=uuid.uuid4(), floor_id=floor.id, type=SeatType.FIXED, status=SeatStatus.OCCUPIED,
                coords={"x": 1, "y": 1}, assigned_user_id=1002, seat_number="A-1")
    hist = SeatAssignmentHistory(id=uuid.uuid4(), seat_id=seat.id, user_id=1002,
                                 assigned_at=datetime.now(timezone.utc), assigned_by=1001)
    db_session.add_all([floor, seat, hist])
    await db_session.commit()

    r = await async_client.put(f"/api/seat-assignments/{seat.id}", headers=admin_auth_headers,
                               json={"user_id": 1003, "reason": "팀 재구성"})
    assert r.status_code == 200, r.text
    assert r.json()["user_id"] == 1003
    assert r.json()["status"] == "occupied"


@pytest.mark.asyncio
async def test_reassign_seat_requires_admin(async_client, auth_headers, db_session):
    floor = Floor(id=uuid.uuid4(), office_id=uuid.uuid4(), level=1, name="1F")
    seat = Seat(id=uuid.uuid4(), floor_id=floor.id, type=SeatType.FREE, status=SeatStatus.AVAILABLE,
                coords={"x": 2, "y": 2}, seat_number="A-2")
    db_session.add_all([floor, seat])
    await db_session.commit()
    r = await async_client.put(f"/api/seat-assignments/{seat.id}", headers=auth_headers, json={"user_id": 1003})
    assert r.status_code == 403


# ── presence 30일 파기 배치 (_presence_purge_job) ─────────────────────────

@pytest.mark.asyncio
async def test_presence_purge_nulls_old_coords(db_session, monkeypatch):
    import app.services.scheduler as sched
    old = Presence(user_id=1002, status=PresenceStatus.OFFLINE, x=10.0, y=20.0, z=0.0,
                   updated_at=datetime.now(timezone.utc) - timedelta(days=40))
    fresh = Presence(user_id=1003, status=PresenceStatus.ONLINE, x=5.0, y=6.0, z=0.0,
                     updated_at=datetime.now(timezone.utc))
    db_session.add_all([old, fresh])
    await db_session.commit()

    # 스케줄러 잡은 SessionLocal을 사용 → 테스트 db_session 팩토리로 패치
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def _fake_session():
        yield db_session

    monkeypatch.setattr(sched, "SessionLocal", _fake_session)
    await sched._presence_purge_job()

    await db_session.refresh(old)
    await db_session.refresh(fresh)
    assert old.x is None and old.y is None and old.z is None  # 40일 → 파기
    assert fresh.x == 5.0  # 최근 → 보존
