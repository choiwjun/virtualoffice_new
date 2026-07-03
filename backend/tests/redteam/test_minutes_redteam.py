"""
G006 회의록 API 적대적(red-team) e2e 테스트.

목적: backend/app/api/meetings.py 의 회의록 엔드포인트(minutes/stt-draft/confirm)를
깨뜨리는 것을 목표로 하는 독립 테스트 스위트. 제품 코드/모델은 수정하지 않는다.

@SPEC docs/planning/00-decisions.md D5(STT 자동 생성/수동 폴백), D20(녹음 고지)
@SPEC backend/app/api/meetings.py (get/update/confirm minutes)
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import ErpRole, ErpUser, Floor, Office, Room, RoomType

pytestmark = pytest.mark.asyncio


# ============================================================================
# 헬퍼: 시드 + 회의 생성
# ============================================================================

async def _seed_office_floor_room(db_session: AsyncSession) -> Room:
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
        capacity=8,
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


BASE = datetime(2026, 9, 1, 10, 0, 0, tzinfo=timezone.utc)


async def _create_meeting(async_client: AsyncClient, room: Room, auth_headers) -> str:
    create = await async_client.post(
        "/meetings",
        json={
            "title": "Minute test",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    return create.json()["meeting_id"]


# ============================================================================
# 1) 조회 404 (미존재 회의 / 회의록 미존재 / 잘못된 id)
# ============================================================================

async def test_get_minutes_nonexistent_meeting_returns_404(
    db_session, async_client: AsyncClient, auth_headers
):
    resp = await async_client.get(f"/meetings/{uuid4()}/minutes", headers=auth_headers)
    assert resp.status_code == 404, resp.text


async def test_get_minutes_without_minute_returns_404(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")
    meeting_id = await _create_meeting(async_client, room, auth_headers)

    resp = await async_client.get(f"/meetings/{meeting_id}/minutes", headers=auth_headers)
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "minute_not_found"


@pytest.mark.parametrize("bad_id", ["not-a-uuid", "12345", "../../etc/passwd", "1' OR '1'='1"])
async def test_malformed_meeting_id_minutes_returns_404_not_422(
    db_session, async_client: AsyncClient, auth_headers, bad_id
):
    for path in (f"/meetings/{bad_id}/minutes", f"/meetings/{bad_id}/minutes/stt-draft"):
        resp = await async_client.get(path, headers=auth_headers)
        assert resp.status_code == 404, f"{path} -> {resp.status_code} {resp.text}"


async def test_stt_draft_without_minute_returns_404(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")
    meeting_id = await _create_meeting(async_client, room, auth_headers)

    resp = await async_client.get(
        f"/meetings/{meeting_id}/minutes/stt-draft", headers=auth_headers
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "stt_draft_not_found"


# ============================================================================
# 2) 수정 upsert + 지속성
# ============================================================================

async def test_put_creates_minute_and_get_reflects(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")
    meeting_id = await _create_meeting(async_client, room, auth_headers)

    put = await async_client.put(
        f"/meetings/{meeting_id}/minutes",
        json={
            "content": "요약본",
            "decisions": ["결정 A", "결정 B"],
            "action_items": [{"owner_id": 1, "task": "후속 작업", "due_date": "2026-09-10"}],
        },
        headers=auth_headers,
    )
    assert put.status_code == 200, put.text

    get = await async_client.get(f"/meetings/{meeting_id}/minutes", headers=auth_headers)
    assert get.status_code == 200, get.text
    data = get.json()
    assert data["summary"] == "요약본"
    assert "결정 A" in data["decisions"] and "결정 B" in data["decisions"]
    assert "후속 작업" in (data["action_items_summary"] or "")
    assert data["status"] == "draft"


async def test_put_second_time_does_not_duplicate_minute(
    db_session, async_client: AsyncClient, auth_headers
):
    """meeting_id 유니크 제약 + upsert 로 회의록은 회의당 1건만 유지되어야 한다."""
    from sqlalchemy import func, select

    from app.models.tables import MeetingMinute

    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")
    meeting_id = await _create_meeting(async_client, room, auth_headers)

    for text in ("v1", "v2"):
        r = await async_client.put(
            f"/meetings/{meeting_id}/minutes",
            json={"content": text, "decisions": ["d"]},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text

    count = (
        await db_session.execute(
            select(func.count()).select_from(MeetingMinute).where(
                MeetingMinute.meeting_id == UUID(meeting_id)
            )
        )
    ).scalar_one()
    assert count == 1, f"expected exactly 1 minute row, got {count}"


# ============================================================================
# 3) 확정 권한(RBAC) + 확정 후 불변
# ============================================================================

async def test_confirm_by_non_host_non_admin_forbidden(
    db_session, async_client: AsyncClient, auth_headers, leader_token
):
    """확정 권한은 호스트+관리자(D5). 비호스트·비관리자(leader)는 403."""
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")
    meeting_id = await _create_meeting(async_client, room, auth_headers)  # host=employee(1)

    put = await async_client.put(
        f"/meetings/{meeting_id}/minutes",
        json={"content": "초안", "decisions": ["d"]},
        headers=auth_headers,
    )
    assert put.status_code == 200, put.text

    # leader(sub=2)는 호스트도 관리자도 아님 → 403
    lead = await async_client.post(
        f"/meetings/{meeting_id}/minutes/confirm",
        headers={"Authorization": f"Bearer {leader_token}"},
    )
    assert lead.status_code == 403, lead.text
    assert lead.json().get("detail") == "minute_confirm_forbidden"


async def test_host_can_confirm_own_minute(
    db_session, async_client: AsyncClient, auth_headers
):
    """정본 D5: 호스트(회의 개설자)는 자기 회의록을 확정할 수 있어야 한다(admin 전용 아님)."""
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")
    meeting_id = await _create_meeting(async_client, room, auth_headers)  # host=employee(1)

    put = await async_client.put(
        f"/meetings/{meeting_id}/minutes",
        json={"content": "초안", "decisions": ["d"]},
        headers=auth_headers,
    )
    assert put.status_code == 200, put.text

    confirm = await async_client.post(
        f"/meetings/{meeting_id}/minutes/confirm", headers=auth_headers
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["status"] == "finalized"


async def test_update_by_non_host_non_participant_forbidden(
    db_session, async_client: AsyncClient, auth_headers, leader_token
):
    """수정 권한(D5 참석자/호스트): 비호스트·비참석자·비관리자(leader)는 403."""
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")
    meeting_id = await _create_meeting(async_client, room, auth_headers)  # host=employee(1)

    resp = await async_client.put(
        f"/meetings/{meeting_id}/minutes",
        json={"content": "침입 수정", "decisions": ["x"]},
        headers={"Authorization": f"Bearer {leader_token}"},
    )
    assert resp.status_code == 403, resp.text
    assert resp.json().get("detail") == "minute_edit_forbidden"


async def test_confirm_without_minute_returns_404(
    db_session, async_client: AsyncClient, admin_auth_headers
):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")
    # 회의는 employee(auth_headers)가 만들어야 하지만 여기선 admin이 만들어도 무관.
    create = await async_client.post(
        "/meetings",
        json={
            "title": "no minute",
            "room_id": str(room.id),
            "start_time": _iso(BASE),
            "end_time": _iso(BASE + timedelta(hours=1)),
        },
        headers=admin_auth_headers,
    )
    assert create.status_code == 201, create.text
    meeting_id = create.json()["meeting_id"]

    resp = await async_client.post(
        f"/meetings/{meeting_id}/minutes/confirm", headers=admin_auth_headers
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "minute_not_found"


async def test_finalized_minute_is_immutable(
    db_session, async_client: AsyncClient, auth_headers, admin_auth_headers
):
    room = await _seed_office_floor_room(db_session)
    await _seed_user(db_session, 1, "host1@example.com")
    meeting_id = await _create_meeting(async_client, room, auth_headers)

    put = await async_client.put(
        f"/meetings/{meeting_id}/minutes",
        json={"content": "초안", "decisions": ["d"]},
        headers=auth_headers,
    )
    assert put.status_code == 200, put.text

    confirm = await async_client.post(
        f"/meetings/{meeting_id}/minutes/confirm", headers=admin_auth_headers
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["status"] == "finalized"

    # 확정 후 재수정 시도 → 409 minute_finalized
    reput = await async_client.put(
        f"/meetings/{meeting_id}/minutes",
        json={"content": "몰래 수정", "decisions": ["x"]},
        headers=auth_headers,
    )
    assert reput.status_code == 409, reput.text
    assert reput.json().get("detail") == "minute_finalized"


# ============================================================================
# 4) 미인증 차단
# ============================================================================

async def test_unauthenticated_minutes_access_returns_401(
    db_session, async_client: AsyncClient
):
    room = await _seed_office_floor_room(db_session)
    mid = uuid4()
    get = await async_client.get(f"/meetings/{mid}/minutes")
    assert get.status_code == 401, get.text
    put = await async_client.put(
        f"/meetings/{mid}/minutes", json={"content": "x", "decisions": ["d"]}
    )
    assert put.status_code == 401, put.text
    confirm = await async_client.post(f"/meetings/{mid}/minutes/confirm")
    assert confirm.status_code == 401, confirm.text
