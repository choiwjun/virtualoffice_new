"""
G005 회의 API 적대적(red-team) e2e 테스트.

목적: backend/app/api/meetings.py 구현을 깨뜨리는 것을 목표로 하는 독립 테스트 스위트.
제품 코드/모델은 절대 수정하지 않는다 — 취약점 발견 시 blocker로 보고한다.

@SPEC docs/planning/00-decisions.md D23(예약 충돌), D24(명시적 입장)
@SPEC backend/app/api/meetings.py
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import ErpRole, ErpUser, Floor, Office, Room, RoomType

pytestmark = pytest.mark.asyncio


# ============================================================================
# 헬퍼: 시드
# ============================================================================

async def _seed_office_floor_room(db_session: AsyncSession, *, capacity: int = 8) -> Room:
    office = Office(id=uuid4(), company_id=uuid4(), name="HQ")
    db_session.add(office)
    await db_session.flush()

    floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1F")
    db_session.add(floor)
    await db_session.flush()

    room = Room(
        id=uuid4(),
        floor_id=floor.id,
        type=RoomType.MEETING,
        name="Room A",
        capacity=capacity,
        coords={"x": 0, "y": 0, "width": 5, "height": 5},
    )
    db_session.add(room)
    await db_session.flush()
    await db_session.commit()
    return room


async def _seed_user(db_session: AsyncSession, user_id: int, email: str) -> ErpUser:
    user = ErpUser(
        id=user_id,
        company_id=1,
        email=email,
        name=f"User {user_id}",
        erp_team_id=1,
        role=ErpRole.EMPLOYEE,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    return user


def _iso(dt: datetime) -> str:
    return dt.isoformat()


BASE = datetime(2026, 8, 1, 10, 0, 0, tzinfo=timezone.utc)


# ============================================================================
# 1) 예약 충돌 (겹침 409 / 인접 반개구간 201 / 다른 room 201)
# ============================================================================

async def test_room_conflict_overlap_returns_409(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    r1 = await async_client.post(
        "/meetings",
        json={
            "title": "M1",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert r1.status_code == 201, r1.text

    r2 = await async_client.post(
        "/meetings",
        json={
            "title": "M2 overlap",
            "room_id": str(room.id),
            "start_time": _iso(BASE + timedelta(minutes=30)),
            "end_time": _iso(BASE + timedelta(hours=1, minutes=30)),
        },
        headers=auth_headers,
    )
    assert r2.status_code == 409, r2.text
    assert r2.json().get("detail") == "room_conflict"


async def test_room_adjacent_half_open_interval_returns_201(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    r1 = await async_client.post(
        "/meetings",
        json={
            "title": "M1",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert r1.status_code == 201, r1.text

    # 정확히 맞닿는 구간 [11:00,12:00) — 반개구간 규약상 겹치지 않아야 함
    r2 = await async_client.post(
        "/meetings",
        json={
            "title": "M2 adjacent",
            "room_id": str(room.id),
            "start_time": _iso(BASE + timedelta(hours=1)),
            "end_time": _iso(BASE + timedelta(hours=2)),
        },
        headers=auth_headers,
    )
    assert r2.status_code == 201, r2.text


async def test_different_room_same_time_returns_201(
    db_session, async_client: AsyncClient, auth_headers
):
    room1 = await _seed_office_floor_room(db_session)
    room2 = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    r1 = await async_client.post(
        "/meetings",
        json={
            "title": "M1",
            "room_id": str(room1.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert r1.status_code == 201, r1.text

    r2 = await async_client.post(
        "/meetings",
        json={
            "title": "M2 other room",
            "room_id": str(room2.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert r2.status_code == 201, r2.text


# ============================================================================
# 2) invalid_time_range
# ============================================================================

async def test_invalid_time_range_end_before_start_returns_400(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    r = await async_client.post(
        "/meetings",
        json={
            "title": "Bad",
            "room_id": str(room.id),
            "start_time": _iso(BASE + timedelta(hours=1)),
            "end_time": _iso(BASE),
        },
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text
    assert r.json().get("detail") == "invalid_time_range"


async def test_invalid_time_range_end_equal_start_returns_400(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    r = await async_client.post(
        "/meetings",
        json={
            "title": "Zero-length",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE),
        },
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text


# ============================================================================
# 3) room_not_found
# ============================================================================

async def test_create_with_nonexistent_room_returns_404(
    db_session, async_client: AsyncClient, auth_headers
):
    await _seed_user(db_session, 1, "host1@example.com")

    r = await async_client.post(
        "/meetings",
        json={
            "title": "Ghost room",
            "room_id": str(uuid4()),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text
    assert r.json().get("detail") == "room_not_found"


# ============================================================================
# 4) host 권한 — DELETE
# ============================================================================

async def test_non_host_cannot_cancel_meeting_but_host_can(
    db_session, async_client: AsyncClient, auth_headers, leader_token
):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")
    await _seed_user(db_session, 2, "leader@example.com")

    create = await async_client.post(
        "/meetings",
        json={
            "title": "Hosted by 1",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    meeting_id = create.json()["meeting_id"]

    other_headers = {"Authorization": f"Bearer {leader_token}"}
    forbidden = await async_client.delete(f"/meetings/{meeting_id}", headers=other_headers)
    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json().get("detail") == "not_host"

    # 취소 안 됐어야 함 — 상태 확인
    still = await async_client.get(f"/meetings/{meeting_id}", headers=auth_headers)
    assert still.status_code == 200
    assert still.json()["status"] == "scheduled"

    ok = await async_client.delete(f"/meetings/{meeting_id}", headers=auth_headers)
    assert ok.status_code == 200, ok.text
    assert ok.json().get("status") == "cancelled"

    after = await async_client.get(f"/meetings/{meeting_id}", headers=auth_headers)
    assert after.status_code == 200
    assert after.json()["status"] == "cancelled"


# ============================================================================
# 5) join: 상태 전이 + upsert (중복 참가자 방지)
# ============================================================================

async def test_join_transitions_to_in_progress_and_upserts_participant(
    db_session, async_client: AsyncClient, auth_headers
):
    from sqlalchemy import select

    from app.models.tables import Meeting, MeetingParticipant, MeetingStatus

    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    create = await async_client.post(
        "/meetings",
        json={
            "title": "Join test",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    meeting_id = create.json()["meeting_id"]

    j1 = await async_client.post(f"/meetings/{meeting_id}/join", headers=auth_headers)
    assert j1.status_code == 200, j1.text
    body1 = j1.json()
    assert "livekit_token" in body1 and body1["livekit_token"]
    assert "room_name" in body1 and body1["room_name"]

    # DB 재조회로 실제 상태 전이 확인 (응답 바디만 믿지 않는다)
    from uuid import UUID as _UUID

    db_meeting = await db_session.get(Meeting, _UUID(meeting_id))
    await db_session.refresh(db_meeting)
    assert db_meeting.status == MeetingStatus.IN_PROGRESS

    # 중복 join → participant row 중복 생성 금지 (upsert)
    j2 = await async_client.post(f"/meetings/{meeting_id}/join", headers=auth_headers)
    assert j2.status_code == 200, j2.text

    rows = (
        await db_session.execute(
            select(MeetingParticipant).where(
                MeetingParticipant.meeting_id == _UUID(meeting_id),
                MeetingParticipant.user_id == 1,
            )
        )
    ).scalars().all()
    assert len(rows) == 1, f"expected exactly 1 participant row after duplicate join, got {len(rows)}"


# ============================================================================
# 6) 미존재/잘못된 UUID → 404 (422 아님)
# ============================================================================

@pytest.mark.parametrize("bad_id", ["not-a-uuid", "12345", "", "../../etc/passwd", "1' OR '1'='1"])
async def test_malformed_meeting_id_returns_404_not_422(
    db_session, async_client: AsyncClient, auth_headers, bad_id
):
    for verb, path in (
        ("get", f"/meetings/{bad_id}"),
        ("post", f"/meetings/{bad_id}/join"),
        ("post", f"/meetings/{bad_id}/leave"),
    ):
        r = await getattr(async_client, verb)(path, headers=auth_headers)
        # 빈 문자열 경로는 라우트 자체가 안 붙어 다른 엔드포인트로 매칭될 수 있으므로 제외
        if bad_id == "" and path.rstrip("/") in ("/meetings", "/meetings/join", "/meetings/leave"):
            continue
        assert r.status_code == 404, f"{verb.upper()} {path} -> {r.status_code}: {r.text}"


async def test_nonexistent_but_valid_uuid_returns_404(
    db_session, async_client: AsyncClient, auth_headers
):
    missing = str(uuid4())
    r_get = await async_client.get(f"/meetings/{missing}", headers=auth_headers)
    assert r_get.status_code == 404
    r_join = await async_client.post(f"/meetings/{missing}/join", headers=auth_headers)
    assert r_join.status_code == 404
    r_leave = await async_client.post(f"/meetings/{missing}/leave", headers=auth_headers)
    assert r_leave.status_code == 404
    r_del = await async_client.delete(f"/meetings/{missing}", headers=auth_headers)
    assert r_del.status_code == 404


# ============================================================================
# 7) 미인증 401
# ============================================================================

async def test_unauthenticated_list_and_create_return_401(db_session, async_client: AsyncClient):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    r_list = await async_client.get("/meetings")
    assert r_list.status_code == 401, r_list.text

    r_create = await async_client.post(
        "/meetings",
        json={
            "title": "No auth",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
    )
    assert r_create.status_code == 401, r_create.text


# ============================================================================
# 8) leave idempotent / cancel된 회의 join 안전 처리
# ============================================================================

async def test_leave_without_join_is_idempotent_no_crash(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    create = await async_client.post(
        "/meetings",
        json={
            "title": "Leave without join",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    meeting_id = create.json()["meeting_id"]

    r = await async_client.post(f"/meetings/{meeting_id}/leave", headers=auth_headers)
    assert r.status_code in (200, 404), f"leave without join crashed or returned unexpected code: {r.status_code} {r.text}"
    assert r.status_code < 500


async def test_join_cancelled_meeting_is_handled_safely(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    create = await async_client.post(
        "/meetings",
        json={
            "title": "To be cancelled",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    meeting_id = create.json()["meeting_id"]

    cancel = await async_client.delete(f"/meetings/{meeting_id}", headers=auth_headers)
    assert cancel.status_code == 200, cancel.text

    join = await async_client.post(f"/meetings/{meeting_id}/join", headers=auth_headers)
    # WATCH 해소(G012): CANCELLED 회의 join은 명시적으로 차단(409)하고 토큰을 발급하지 않는다.
    assert join.status_code == 409, f"cancelled meeting join must be blocked: {join.status_code} {join.text}"
    assert join.json().get("detail") == "meeting_not_joinable"
    assert "livekit_token" not in join.json()


async def test_cancelled_meeting_does_not_block_new_booking_in_same_slot(
    db_session, async_client: AsyncClient, auth_headers
):
    """CANCELLED 상태는 충돌 검증에서 활성 상태(SCHEDULED/IN_PROGRESS)가 아니므로
    동일 슬롯 재예약이 가능해야 한다 — 취소 후 방이 영구히 막히는 회귀를 방지."""
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    create = await async_client.post(
        "/meetings",
        json={
            "title": "First",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    meeting_id = create.json()["meeting_id"]

    cancel = await async_client.delete(f"/meetings/{meeting_id}", headers=auth_headers)
    assert cancel.status_code == 200, cancel.text

    rebook = await async_client.post(
        "/meetings",
        json={
            "title": "Rebook same slot",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert rebook.status_code == 201, rebook.text


# ============================================================================
# 9) 종료/취소 회의 입장 차단 + open-ended 예약 충돌 (G012 WATCH 해소)
# ============================================================================

async def test_join_completed_meeting_returns_409(
    db_session, async_client: AsyncClient, auth_headers
):
    from uuid import UUID as _UUID

    from app.models.tables import Meeting, MeetingStatus

    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    create = await async_client.post(
        "/meetings",
        json={
            "title": "To be completed",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    meeting_id = create.json()["meeting_id"]

    # 완료 전용 엔드포인트가 없으므로 상태를 직접 COMPLETED로 전이.
    db_meeting = await db_session.get(Meeting, _UUID(meeting_id))
    db_meeting.status = MeetingStatus.COMPLETED
    await db_session.commit()

    join = await async_client.post(f"/meetings/{meeting_id}/join", headers=auth_headers)
    assert join.status_code == 409, join.text
    assert join.json().get("detail") == "meeting_not_joinable"
    assert "livekit_token" not in join.json()


async def test_open_ended_meeting_blocks_conflicting_booking(
    db_session, async_client: AsyncClient, auth_headers
):
    """scheduled_end IS NULL(open-ended) 회의는 [scheduled_at, ∞) 상시점유 →
    이후 시작하는 신규 예약이 409로 차단되어야 한다(방 영구 방치 갭 방지)."""
    from uuid import UUID as _UUID

    from app.models.tables import Meeting

    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")

    create = await async_client.post(
        "/meetings",
        json={
            "title": "Open-ended",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    meeting_id = create.json()["meeting_id"]

    # 종료 시각을 제거해 open-ended 회의로 만든다(모델상 scheduled_end nullable).
    db_meeting = await db_session.get(Meeting, _UUID(meeting_id))
    db_meeting.scheduled_end = None
    await db_session.commit()

    # open-ended 회의 시작 이후에 시작하는 예약은 충돌로 차단.
    conflict = await async_client.post(
        "/meetings",
        json={
            "title": "After open-ended start",
            "room_id": str(room.id),
            "start_time": _iso(BASE + timedelta(hours=2)),
            "end_time": _iso(BASE + timedelta(hours=3)),
        },
        headers=auth_headers,
    )
    assert conflict.status_code == 409, conflict.text
    assert conflict.json().get("detail") == "room_conflict"

    # open-ended 회의 시작 이전에 끝나는 예약은 충돌 아님(경계: end <= scheduled_at).
    before = await async_client.post(
        "/meetings",
        json={
            "title": "Before open-ended start",
            "room_id": str(room.id),
            "start_time": _iso(BASE - timedelta(hours=2)),
            "end_time": _iso(BASE - timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert before.status_code == 201, before.text
