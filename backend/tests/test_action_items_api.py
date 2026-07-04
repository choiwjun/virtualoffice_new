"""
G004 액션아이템 CRUD + KPI 인입 경로 테스트 (T12c).

@SPEC backend/app/api/action_items.py
@SPEC backend/app/api/meetings.py (PUT /minutes 구조적 액션아이템 인입)
@SPEC backend/app/services/kpi_scoring.py (aggregate_user_period — 계산 로직 불변, 인입 경로만 검증)
"""

from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import (
    ActionItem,
    ActionItemStatus,
    ErpRole,
    ErpUser,
    Floor,
    KpiPeriodType,
    Meeting,
    MeetingParticipant,
    MeetingParticipantRole,
    MeetingStatus,
    Office,
    Room,
    RoomType,
)
from app.services.kpi_scoring import aggregate_user_period, period_key_to_range

pytestmark = pytest.mark.asyncio

BASE = datetime(2026, 8, 1, 10, 0, 0, tzinfo=timezone.utc)


# ============================================================================
# 헬퍼
# ============================================================================
async def _seed_room(db_session: AsyncSession) -> Room:
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


async def _seed_user(db_session: AsyncSession, user_id: int, email: str, erp_team_id: int = 1) -> ErpUser:
    user = ErpUser(
        id=user_id,
        company_id=1,
        email=email,
        name=f"User {user_id}",
        erp_team_id=erp_team_id,
        role=ErpRole.EMPLOYEE,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _seed_meeting(db_session: AsyncSession, room: Room, host_user_id: int) -> Meeting:
    meeting = Meeting(
        id=uuid4(),
        room_id=room.id,
        host_user_id=host_user_id,
        title="Sync",
        scheduled_at=BASE,
        scheduled_end=BASE + timedelta(hours=1),
        status=MeetingStatus.SCHEDULED,
    )
    db_session.add(meeting)
    await db_session.commit()
    return meeting


async def _add_participant(db_session: AsyncSession, meeting_id, user_id: int) -> None:
    db_session.add(
        MeetingParticipant(
            id=uuid4(),
            meeting_id=meeting_id,
            user_id=user_id,
            invited_at=BASE,
            role=MeetingParticipantRole.PARTICIPANT,
        )
    )
    await db_session.commit()


def _due_date_payload() -> str:
    return "2026-09-15"


# ============================================================================
# 1) 생성 RBAC
# ============================================================================
async def test_create_by_host_succeeds(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=1)

    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "Follow up",
            "assignee_user_id": 1,
            "due_date": _due_date_payload(),
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "open"
    assert body["priority"] == "medium"
    assert body["assignee_user_id"] == 1


async def test_create_by_participant_succeeds(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 99, "host99@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=99)
    await _add_participant(db_session, meeting.id, user_id=1)

    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "Participant task",
            "assignee_user_id": 1,
            "due_date": _due_date_payload(),
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text


async def test_create_by_admin_succeeds(db_session, async_client: AsyncClient, admin_auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 99, "host99@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=99)

    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "Admin-created task",
            "assignee_user_id": 1,
            "due_date": _due_date_payload(),
        },
        headers=admin_auth_headers,
    )
    assert resp.status_code == 201, resp.text


async def test_create_by_non_participant_returns_403(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 99, "host99@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=99)

    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "Not allowed",
            "assignee_user_id": 1,
            "due_date": _due_date_payload(),
        },
        headers=auth_headers,
    )
    assert resp.status_code == 403, resp.text
    assert resp.json().get("detail") == "action_item_create_forbidden"


async def test_create_with_missing_meeting_returns_404(db_session, async_client: AsyncClient, auth_headers):
    await _seed_user(db_session, 1, "employee@example.com")
    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(uuid4()),
            "title": "Ghost meeting",
            "assignee_user_id": 1,
            "due_date": _due_date_payload(),
        },
        headers=auth_headers,
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "meeting_not_found"


async def test_create_with_missing_assignee_returns_404(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=1)

    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "Ghost assignee",
            "assignee_user_id": 9999,
            "due_date": _due_date_payload(),
        },
        headers=auth_headers,
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "assignee_not_found"


# ============================================================================
# 2) 목록 RBAC 스코핑 + 필터
# ============================================================================
async def test_list_scoping_employee_leader_admin(
    db_session, async_client: AsyncClient, auth_headers, leader_token, admin_auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com", erp_team_id=1)
    await _seed_user(db_session, 50, "teammate@example.com", erp_team_id=1)
    await _seed_user(db_session, 99, "outsider@example.com", erp_team_id=2)
    await _seed_user(db_session, 999, "host@example.com", erp_team_id=1)
    meeting = await _seed_meeting(db_session, room, host_user_id=999)

    db_session.add_all(
        [
            ActionItem(id=uuid4(), meeting_id=meeting.id, title="A1", assignee_user_id=1, due_date=date(2026, 9, 1)),
            ActionItem(id=uuid4(), meeting_id=meeting.id, title="A2", assignee_user_id=50, due_date=date(2026, 9, 2)),
            ActionItem(id=uuid4(), meeting_id=meeting.id, title="A3", assignee_user_id=99, due_date=date(2026, 9, 3)),
        ]
    )
    await db_session.commit()

    leader_headers = {"Authorization": f"Bearer {leader_token}"}

    # employee(=1): 본인 항목만
    resp = await async_client.get("/action-items", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert {i["assignee_user_id"] for i in items} == {1}

    # leader(team_id=1): 팀(erp_team_id=1) 소속인 1,50 은 보이고 99(team2)는 안 보임
    resp = await async_client.get("/action-items", headers=leader_headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert {i["assignee_user_id"] for i in items} == {1, 50}

    # admin: 전체
    resp = await async_client.get("/action-items", headers=admin_auth_headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert {i["assignee_user_id"] for i in items} == {1, 50, 99}
    assert resp.json()["total"] == 3


async def test_list_explicit_assignee_filter_scope_enforced(
    db_session, async_client: AsyncClient, auth_headers, leader_token
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com", erp_team_id=1)
    await _seed_user(db_session, 50, "teammate@example.com", erp_team_id=1)
    await _seed_user(db_session, 99, "outsider@example.com", erp_team_id=2)
    await _seed_user(db_session, 999, "host@example.com", erp_team_id=1)
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    db_session.add(
        ActionItem(id=uuid4(), meeting_id=meeting.id, title="A2", assignee_user_id=50, due_date=date(2026, 9, 2))
    )
    await db_session.commit()

    leader_headers = {"Authorization": f"Bearer {leader_token}"}

    # employee querying someone else's assignee scope -> 403
    resp = await async_client.get("/action-items?assignee_user_id=50", headers=auth_headers)
    assert resp.status_code == 403, resp.text

    # leader querying in-team assignee -> 200
    resp = await async_client.get("/action-items?assignee_user_id=50", headers=leader_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["total"] == 1

    # leader querying out-of-team assignee -> 403
    resp = await async_client.get("/action-items?assignee_user_id=99", headers=leader_headers)
    assert resp.status_code == 403, resp.text


async def test_list_invalid_status_filter_returns_400(db_session, async_client: AsyncClient, auth_headers):
    resp = await async_client.get("/action-items?status=bogus", headers=auth_headers)
    assert resp.status_code == 400, resp.text
    assert resp.json().get("detail") == "invalid_status"


# ============================================================================
# 3) 조회 404 / RBAC (존재 미노출)
# ============================================================================
async def test_get_visible_to_assignee_self(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Mine", assignee_user_id=1, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.get(f"/action-items/{item.id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text


async def test_get_visible_to_meeting_participant(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 50, "teammate@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    await _add_participant(db_session, meeting.id, user_id=1)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Not mine", assignee_user_id=50, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.get(f"/action-items/{item.id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text


async def test_get_hidden_as_404_for_unrelated_user(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 50, "teammate@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Not mine", assignee_user_id=50, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.get(f"/action-items/{item.id}", headers=auth_headers)
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "action_item_not_found"


async def test_get_nonexistent_returns_404(db_session, async_client: AsyncClient, auth_headers):
    resp = await async_client.get(f"/action-items/{uuid4()}", headers=auth_headers)
    assert resp.status_code == 404, resp.text


@pytest.mark.parametrize("bad_id", ["not-a-uuid", "12345", "1' OR '1'='1"])
async def test_get_malformed_id_returns_404_not_422(db_session, async_client: AsyncClient, auth_headers, bad_id):
    resp = await async_client.get(f"/action-items/{bad_id}", headers=auth_headers)
    assert resp.status_code == 404, resp.text


# ============================================================================
# 4) PATCH 상태 전이 + 필드 갱신
# ============================================================================
async def test_patch_open_to_in_progress_to_completed_sets_completed_at(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Mine", assignee_user_id=1, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    r1 = await async_client.patch(f"/action-items/{item.id}", json={"status": "in_progress"}, headers=auth_headers)
    assert r1.status_code == 200, r1.text
    assert r1.json()["status"] == "in_progress"
    assert r1.json()["completed_at"] is None

    r2 = await async_client.patch(f"/action-items/{item.id}", json={"status": "completed"}, headers=auth_headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "completed"
    assert r2.json()["completed_at"] is not None


async def test_patch_terminal_status_rejects_further_transition(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(
        id=uuid4(),
        meeting_id=meeting.id,
        title="Done",
        assignee_user_id=1,
        due_date=date(2026, 9, 1),
        status=ActionItemStatus.COMPLETED,
    )
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.patch(f"/action-items/{item.id}", json={"status": "open"}, headers=auth_headers)
    assert resp.status_code == 400, resp.text
    assert resp.json().get("detail") == "invalid_transition"


async def test_patch_invalid_status_value_returns_400(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Mine", assignee_user_id=1, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.patch(f"/action-items/{item.id}", json={"status": "bogus"}, headers=auth_headers)
    assert resp.status_code == 400, resp.text
    assert resp.json().get("detail") == "invalid_status"


async def test_patch_by_non_assignee_non_admin_returns_403(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 50, "teammate@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Not mine", assignee_user_id=50, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.patch(f"/action-items/{item.id}", json={"status": "in_progress"}, headers=auth_headers)
    assert resp.status_code == 403, resp.text
    assert resp.json().get("detail") == "action_item_update_forbidden"


async def test_patch_by_admin_allowed(db_session, async_client: AsyncClient, admin_auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Mine", assignee_user_id=1, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.patch(
        f"/action-items/{item.id}", json={"title": "Renamed", "related_ref": "JIRA-1"}, headers=admin_auth_headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "Renamed"
    assert resp.json()["related_ref"] == "JIRA-1"


async def test_patch_nonexistent_returns_404(db_session, async_client: AsyncClient, auth_headers):
    resp = await async_client.patch(f"/action-items/{uuid4()}", json={"status": "in_progress"}, headers=auth_headers)
    assert resp.status_code == 404, resp.text


# ============================================================================
# 5) 삭제
# ============================================================================
async def test_delete_by_admin_succeeds(db_session, async_client: AsyncClient, admin_auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Mine", assignee_user_id=1, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.delete(f"/action-items/{item.id}", headers=admin_auth_headers)
    assert resp.status_code == 200, resp.text


async def test_delete_by_host_succeeds(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 50, "assignee@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=1)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Owned by team", assignee_user_id=50, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.delete(f"/action-items/{item.id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text


async def test_delete_by_other_returns_403(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Not mine", assignee_user_id=1, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.delete(f"/action-items/{item.id}", headers=auth_headers)
    assert resp.status_code == 403, resp.text
    assert resp.json().get("detail") == "action_item_delete_forbidden"


async def test_delete_nonexistent_returns_404(db_session, async_client: AsyncClient, admin_auth_headers):
    resp = await async_client.delete(f"/action-items/{uuid4()}", headers=admin_auth_headers)
    assert resp.status_code == 404, resp.text


# ============================================================================
# 6) 회의록(minutes) 구조적 액션아이템 인입 + 멱등성
# ============================================================================
async def test_minute_update_creates_structured_action_items_and_is_idempotent(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")

    create = await async_client.post(
        "/meetings",
        json={
            "title": "Sync",
            "room_id": str(room.id),
            "start_time": BASE.isoformat(),
            "end_time": (BASE + timedelta(hours=1)).isoformat(),
        },
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    meeting_id = create.json()["meeting_id"]

    payload = {
        "title": "Minutes",
        "decisions": ["Ship it"],
        "action_items": [
            {"task": "Write report", "owner_id": 1, "due_date": "2026-09-20", "title": "Write report"},
            {"task": "No structured fields", "owner_id": None, "due_date": None},
        ],
    }
    put1 = await async_client.put(f"/meetings/{meeting_id}/minutes", json=payload, headers=auth_headers)
    assert put1.status_code == 200, put1.text
    assert "Write report" in put1.json()["action_items_summary"]

    stmt = select(ActionItem).where(ActionItem.meeting_id == UUID(meeting_id))
    rows = (await db_session.execute(stmt)).scalars().all()
    assert len(rows) == 1, f"expected exactly 1 structured ActionItem row, got {len(rows)}"
    assert rows[0].assignee_user_id == 1
    assert rows[0].due_date == date(2026, 9, 20)

    # 재전송 -> 중복 생성되지 않아야 함(멱등)
    put2 = await async_client.put(f"/meetings/{meeting_id}/minutes", json=payload, headers=auth_headers)
    assert put2.status_code == 200, put2.text
    rows_after = (await db_session.execute(stmt)).scalars().all()
    assert len(rows_after) == 1, f"expected still 1 row after repeat PUT, got {len(rows_after)}"


# ============================================================================
# 7) KPI 인입 검증 (compute_kpi_metrics 로직 자체는 변경하지 않음 — 인입 경로만 검증)
# ============================================================================
async def test_completed_action_items_are_ingested_by_kpi_aggregation(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)

    now = datetime.now(timezone.utc)
    quarter = (now.month - 1) // 3 + 1
    period_key = f"{now.year}-Q{quarter}"
    _start, end = period_key_to_range(KpiPeriodType.QUARTERLY, period_key)

    item = ActionItem(
        id=uuid4(),
        meeting_id=meeting.id,
        title="Deliverable",
        assignee_user_id=1,
        due_date=end,  # 분기 마지막 날 — 테스트 실행 시각 기준 항상 미래/당일 → on-time 보장
    )
    db_session.add(item)
    await db_session.commit()

    patch1 = await async_client.patch(
        f"/action-items/{item.id}", json={"status": "in_progress"}, headers=auth_headers
    )
    assert patch1.status_code == 200, patch1.text
    patch2 = await async_client.patch(
        f"/action-items/{item.id}", json={"status": "completed"}, headers=auth_headers
    )
    assert patch2.status_code == 200, patch2.text

    metrics = await aggregate_user_period(db_session, user_id=1, period_type=KpiPeriodType.QUARTERLY, period_key=period_key)
    assert metrics["action_items_completed"] == 1
    assert metrics["action_items_ontime_rate"] == 100


# ============================================================================
# 8) 미인증 401
# ============================================================================
async def test_unauthenticated_writes_return_401(db_session, async_client: AsyncClient):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=1)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Mine", assignee_user_id=1, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    create_resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "Should fail",
            "assignee_user_id": 1,
            "due_date": _due_date_payload(),
        },
    )
    assert create_resp.status_code == 401, create_resp.text

    patch_resp = await async_client.patch(f"/action-items/{item.id}", json={"status": "in_progress"})
    assert patch_resp.status_code == 401, patch_resp.text

    delete_resp = await async_client.delete(f"/action-items/{item.id}")
    assert delete_resp.status_code == 401, delete_resp.text
