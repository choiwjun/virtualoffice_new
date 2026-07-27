"""audit MED 항목 테스트: PUT 자리 주인 지정/해제, presence 30일 파기."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.tables import (
    ErpRole,
    ErpUser,
    Floor,
    Presence,
    PresenceStatus,
    Seat,
    SeatAssignmentHistory,
    SeatStatus,
    SeatType,
)


# ── PUT /seat-assignments/{seat_id} (자리 주인 지정/해제) ────────────────

def _user(uid: int, *, company_id: int = 1, active: bool = True) -> ErpUser:
    return ErpUser(id=uid, company_id=company_id, email=f"u{uid}@test.local", name=f"사원{uid}",
                   erp_team_id=1, role=ErpRole.EMPLOYEE, is_active=active)


def _seat(*, floor_id, number: str, owner: int | None = None) -> Seat:
    return Seat(
        id=uuid.uuid4(), company_id=1, floor_id=floor_id, type=SeatType.FIXED,
        status=SeatStatus.OCCUPIED if owner else SeatStatus.AVAILABLE,
        coords={"x": 1, "y": 1}, assigned_user_id=owner, seat_number=number,
    )


async def _open_history(db_session, seat_uuid, user_id: int) -> None:
    db_session.add(SeatAssignmentHistory(id=uuid.uuid4(), seat_id=seat_uuid, user_id=user_id,
                                         assigned_at=datetime.now(timezone.utc), assigned_by=1001))


async def _histories(db_session, seat_uuid) -> list[SeatAssignmentHistory]:
    rows = await db_session.execute(
        select(SeatAssignmentHistory).where(SeatAssignmentHistory.seat_id == seat_uuid)
    )
    return list(rows.scalars().all())


@pytest.mark.asyncio
async def test_reassign_seat(async_client, admin_auth_headers, db_session):
    floor = Floor(id=uuid.uuid4(), office_id=uuid.uuid4(), level=1, name="1F")
    seat = _seat(floor_id=floor.id, number="A-1", owner=1002)
    db_session.add_all([floor, _user(1002), _user(1003), seat])
    await _open_history(db_session, seat.id, 1002)
    await db_session.commit()

    r = await async_client.put(f"/api/seat-assignments/{seat.id}", headers=admin_auth_headers,
                               json={"user_id": 1003, "reason": "팀 재구성"})
    assert r.status_code == 200, r.text
    assert r.json()["user_id"] == 1003
    assert r.json()["status"] == "occupied"

    # 이전 이력은 닫히고, 새 이력 1건만 열려 있어야 한다 (uk_current_seat: 좌석당 열린 이력 1건).
    hist = await _histories(db_session, seat.id)
    assert len(hist) == 2
    still_open = [h for h in hist if h.unassigned_at is None]
    assert [h.user_id for h in still_open] == [1003]


@pytest.mark.asyncio
async def test_unassign_seat_clears_owner(async_client, admin_auth_headers, db_session):
    """user_id=null → 주인 없애기. history.user_id가 NOT NULL이라 새 이력은 열지 않는다."""
    floor = Floor(id=uuid.uuid4(), office_id=uuid.uuid4(), level=1, name="1F")
    seat = _seat(floor_id=floor.id, number="A-1", owner=1002)
    db_session.add_all([floor, _user(1002), seat])
    await _open_history(db_session, seat.id, 1002)
    await db_session.commit()

    r = await async_client.put(f"/api/seat-assignments/{seat.id}", headers=admin_auth_headers,
                               json={"user_id": None, "reason": "퇴사"})
    assert r.status_code == 200, r.text
    assert r.json()["user_id"] is None
    assert r.json()["status"] == "available"

    await db_session.refresh(seat)
    assert seat.assigned_user_id is None
    assert seat.status == SeatStatus.AVAILABLE
    hist = await _histories(db_session, seat.id)
    assert len(hist) == 1 and hist[0].unassigned_at is not None


@pytest.mark.asyncio
async def test_unassign_empty_seat_is_idempotent(async_client, admin_auth_headers, db_session):
    """이미 빈 자리를 또 해제해도 성공 — 편집기에서 두 번 눌러도 실패로 보이지 않게."""
    floor = Floor(id=uuid.uuid4(), office_id=uuid.uuid4(), level=1, name="1F")
    seat = _seat(floor_id=floor.id, number="A-9")
    db_session.add_all([floor, seat])
    await db_session.commit()

    r = await async_client.put(f"/api/seat-assignments/{seat.id}", headers=admin_auth_headers,
                               json={"user_id": None})
    assert r.status_code == 200, r.text
    assert r.json()["user_id"] is None
    assert await _histories(db_session, seat.id) == []


@pytest.mark.asyncio
async def test_reassign_to_unknown_user_is_404(async_client, admin_auth_headers, db_session):
    """없는 사원에게 넘기면 아무도 못 쓰는 유령 자리가 된다 → 404."""
    floor = Floor(id=uuid.uuid4(), office_id=uuid.uuid4(), level=1, name="1F")
    seat = _seat(floor_id=floor.id, number="A-3")
    db_session.add_all([floor, seat])
    await db_session.commit()

    r = await async_client.put(f"/api/seat-assignments/{seat.id}", headers=admin_auth_headers,
                               json={"user_id": 999999})
    assert r.status_code == 404, r.text
    await db_session.refresh(seat)
    assert seat.assigned_user_id is None


@pytest.mark.asyncio
async def test_reassign_to_other_company_user_is_404(async_client, admin_auth_headers, db_session):
    """타사 사원 배정 차단 (22 T0-1 존재 은닉)."""
    floor = Floor(id=uuid.uuid4(), office_id=uuid.uuid4(), level=1, name="1F")
    seat = _seat(floor_id=floor.id, number="A-4")
    db_session.add_all([floor, _user(2002, company_id=2), seat])
    await db_session.commit()

    r = await async_client.put(f"/api/seat-assignments/{seat.id}", headers=admin_auth_headers,
                               json={"user_id": 2002})
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_reassign_to_inactive_user_is_404(async_client, admin_auth_headers, db_session):
    floor = Floor(id=uuid.uuid4(), office_id=uuid.uuid4(), level=1, name="1F")
    seat = _seat(floor_id=floor.id, number="A-5")
    db_session.add_all([floor, _user(1004, active=False), seat])
    await db_session.commit()

    r = await async_client.put(f"/api/seat-assignments/{seat.id}", headers=admin_auth_headers,
                               json={"user_id": 1004})
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_reassign_same_user_does_not_grow_history(async_client, admin_auth_headers, db_session):
    """같은 사원 재지정은 무변경 — 편집기에서 저장을 반복해도 이력이 불어나지 않아야 한다."""
    floor = Floor(id=uuid.uuid4(), office_id=uuid.uuid4(), level=1, name="1F")
    seat = _seat(floor_id=floor.id, number="A-6", owner=1002)
    db_session.add_all([floor, _user(1002), seat])
    await _open_history(db_session, seat.id, 1002)
    await db_session.commit()

    r = await async_client.put(f"/api/seat-assignments/{seat.id}", headers=admin_auth_headers,
                               json={"user_id": 1002})
    assert r.status_code == 200, r.text
    hist = await _histories(db_session, seat.id)
    assert len(hist) == 1 and hist[0].unassigned_at is None


@pytest.mark.asyncio
async def test_reassign_vacates_previous_seat(async_client, admin_auth_headers, db_session):
    """한 사람 = 한 자리. 새 자리를 주면 갖고 있던 자리는 비워진다 (employees.seat_number가 단수)."""
    floor = Floor(id=uuid.uuid4(), office_id=uuid.uuid4(), level=1, name="1F")
    old = _seat(floor_id=floor.id, number="A-7", owner=1002)
    new = _seat(floor_id=floor.id, number="A-8")
    db_session.add_all([floor, _user(1002), old, new])
    await _open_history(db_session, old.id, 1002)
    await db_session.commit()

    r = await async_client.put(f"/api/seat-assignments/{new.id}", headers=admin_auth_headers,
                               json={"user_id": 1002})
    assert r.status_code == 200, r.text

    await db_session.refresh(old)
    await db_session.refresh(new)
    assert old.assigned_user_id is None and old.status == SeatStatus.AVAILABLE
    assert new.assigned_user_id == 1002 and new.status == SeatStatus.OCCUPIED
    old_hist = await _histories(db_session, old.id)
    assert all(h.unassigned_at is not None for h in old_hist)


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
