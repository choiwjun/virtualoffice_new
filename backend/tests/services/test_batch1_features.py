"""배치1 신규 기능 테스트: 직렬화·클라버전·아바타스폰·구역권한·채팅."""

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.models.tables import (
    ErpRole,
    ErpUser,
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
    ZoneAccess,
)
from app.services.avatar_spawner import get_spawn_location
from app.services.office_layout_serializer import round_trip, to_json
from app.api.zone_access import user_can_enter_zone


# ── 직렬화(P3-R3-T1) ─────────────────────────────────────
def test_serializer_round_trip_identity():
    layout = {
        "dimensions": {"width_m": 20, "height_m": 15, "min_x": 0, "max_x": 20, "min_y": 0, "max_y": 15},
        "seats": [{"seat_id": "S1", "coords": {"x": 1, "y": 2}}],
        "metadata": {"floor_name": "1F"},
    }
    rt = round_trip(layout)
    assert rt["dimensions"] == layout["dimensions"]
    assert rt["seats"] == layout["seats"]
    # 누락 컬렉션 기본값 + 재-왕복 안정성
    assert rt["rooms"] == [] and rt["colliders"] == []
    assert round_trip(rt) == rt
    assert isinstance(to_json(layout), str)


# ── 아바타 스폰(P2-R3-T1) ────────────────────────────────
async def _office_floor(db: AsyncSession):
    office = Office(id=uuid4(), company_id=uuid4(), name="본사")
    db.add(office)
    await db.flush()
    floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1F")
    db.add(floor)
    await db.flush()
    return office, floor


async def test_avatar_spawn_from_seat_and_fallback(db_session: AsyncSession):
    db_session.add(ErpUser(id=1, company_id=1, email="u1@x.com", name="U1", erp_team_id=1, role=ErpRole.EMPLOYEE))
    _, floor = await _office_floor(db_session)
    db_session.add(
        Seat(id=uuid4(), floor_id=floor.id, type=SeatType.FIXED, assigned_user_id=1,
             coords={"x": 5.0, "y": 3.0, "facing": 90.0}, status=SeatStatus.OCCUPIED, seat_number="A1")
    )
    await db_session.commit()

    loc = await get_spawn_location(db_session, 1)
    assert loc["source"] == "seat" and loc["x"] == 5.0 and loc["facing"] == 90.0

    fallback = await get_spawn_location(db_session, 999)
    assert fallback["source"] == "lobby"


# ── 구역 접근 권한(P7-R1-T2) ─────────────────────────────
async def test_zone_access_helper(db_session: AsyncSession):
    zone_id = uuid4()
    emp = CurrentUser(user_id=1, email="e@x.com", role="employee", team_id=1)
    leader = CurrentUser(user_id=2, email="l@x.com", role="leader", team_id=1)
    admin = CurrentUser(user_id=3, email="a@x.com", role="admin", team_id=None)

    # 규칙 없음 → 개방
    assert await user_can_enter_zone(db_session, zone_id, emp) is True

    # leader만 enter 허용
    db_session.add(ZoneAccess(id=uuid4(), zone_id=zone_id, role="leader", permission="enter"))
    await db_session.commit()
    assert await user_can_enter_zone(db_session, zone_id, leader) is True
    assert await user_can_enter_zone(db_session, zone_id, emp) is False
    # admin은 항상 허용
    assert await user_can_enter_zone(db_session, zone_id, admin) is True


async def test_zone_access_api_guard(async_client, auth_headers):
    # 비관리자 규칙 생성 금지 + 존재하지 않는 zone → 404 (엔드포인트 접근)
    r = await async_client.get(f"/zones/{uuid4()}/access-control", headers=auth_headers)
    assert r.status_code == 404


# ── 클라이언트 버전(P7-R3-T2) ────────────────────────────
async def test_client_version(async_client, auth_headers):
    r = await async_client.get("/api/client/version?current=0.0.1", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["required"] is True  # 0.0.1 < min(0.1.0)
    r2 = await async_client.get("/api/client/version?current=9.9.9", headers=auth_headers)
    assert r2.json()["required"] is False and r2.json()["up_to_date"] is True


# ── 회의 채팅(P5-R3-T3) ──────────────────────────────────
async def test_meeting_messages(async_client, db_session: AsyncSession, auth_headers):
    db_session.add(ErpUser(id=1, company_id=1, email="u1@x.com", name="U1", erp_team_id=1, role=ErpRole.EMPLOYEE))
    _, floor = await _office_floor(db_session)
    room = Room(id=uuid4(), floor_id=floor.id, type=RoomType.MEETING, name="R1", capacity=4,
                coords={"x": 1, "y": 1, "width": 3, "height": 2}, status=RoomStatus.ACTIVE)
    db_session.add(room)
    await db_session.flush()
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    meeting = Meeting(id=uuid4(), room_id=room.id, host_user_id=1, title="M1",
                      scheduled_at=now, scheduled_end=now + timedelta(hours=1), status=MeetingStatus.SCHEDULED)
    db_session.add(meeting)
    await db_session.commit()

    mid = str(meeting.id)
    r = await async_client.post(f"/meetings/{mid}/messages", headers=auth_headers, json={"content": "안녕하세요"})
    assert r.status_code == 201
    r2 = await async_client.get(f"/meetings/{mid}/messages", headers=auth_headers)
    assert r2.status_code == 200 and len(r2.json()["messages"]) == 1
    # 빈 메시지 거부
    r3 = await async_client.post(f"/meetings/{mid}/messages", headers=auth_headers, json={"content": "  "})
    assert r3.status_code == 400
