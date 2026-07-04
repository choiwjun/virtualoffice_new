# @TASK G004 red-team - 액션아이템 CRUD + 회의록 구조적 인입 경로 적대적 검증
# @SPEC backend/app/api/action_items.py
# @SPEC backend/app/api/meetings.py (PUT /minutes 구조적 액션아이템 인입)

"""
G004 액션아이템 API 적대적(red-team) 테스트.

목표: 부순다. 500, 크로스유저 유출, 불법 상태 전이 허용, 회의록 인입 중복/크래시를
찾아내면 절대 assertion을 완화하지 않고 실패로 남긴다(버그 리포트용 증거).
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
    Meeting,
    MeetingParticipant,
    MeetingParticipantRole,
    MeetingStatus,
    Office,
    Room,
    RoomType,
)

pytestmark = pytest.mark.asyncio

BASE = datetime(2026, 8, 1, 10, 0, 0, tzinfo=timezone.utc)


# ============================================================================
# 헬퍼 (test_action_items_api.py / test_meetings_redteam.py 패턴과 동일)
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


# ============================================================================
# 1) 인증/인가 — 참여자 아닌 employee 생성 403, 미인증 401
# ============================================================================
async def test_create_non_participant_employee_returns_403(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 99, "host99@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=99)

    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "Sneaky",
            "assignee_user_id": 1,
            "due_date": "2026-09-01",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 403, resp.text
    assert resp.json().get("detail") == "action_item_create_forbidden"


async def test_unauthenticated_create_returns_401(db_session, async_client: AsyncClient):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=1)

    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "No token",
            "assignee_user_id": 1,
            "due_date": "2026-09-01",
        },
    )
    assert resp.status_code == 401, resp.text


async def test_unauthenticated_get_and_list_return_401(db_session, async_client: AsyncClient):
    resp_list = await async_client.get("/action-items")
    assert resp_list.status_code == 401, resp_list.text
    resp_get = await async_client.get(f"/action-items/{uuid4()}")
    assert resp_get.status_code == 401, resp_get.text


# ============================================================================
# 2) 잘못된 UUID / 초거대 정수 — 404/422, 절대 500 아님
# ============================================================================
@pytest.mark.parametrize(
    "bad_id",
    ["not-a-uuid", "12345", "../../etc/passwd", "1' OR '1'='1", "%00", "😀😀😀"],
)
async def test_malformed_action_item_id_never_500(
    db_session, async_client: AsyncClient, auth_headers, bad_id
):
    for verb, fn in (
        ("get", async_client.get),
        ("patch", lambda p: async_client.patch(p, json={"status": "in_progress"}, headers=auth_headers)),
        ("delete", async_client.delete),
    ):
        if verb == "patch":
            resp = await fn(f"/action-items/{bad_id}")
        else:
            resp = await fn(f"/action-items/{bad_id}", headers=auth_headers)
        assert resp.status_code in (404, 422), f"{verb.upper()} /action-items/{bad_id!r} -> {resp.status_code}: {resp.text}"
        assert resp.status_code != 500


async def test_malformed_meeting_id_in_create_returns_404_or_422_not_500(
    db_session, async_client: AsyncClient, auth_headers
):
    await _seed_user(db_session, 1, "employee@example.com")
    for bad_meeting_id in ("not-a-uuid", "1' OR '1'='1"):
        resp = await async_client.post(
            "/action-items",
            json={
                "meeting_id": bad_meeting_id,
                "title": "x",
                "assignee_user_id": 1,
                "due_date": "2026-09-01",
            },
            headers=auth_headers,
        )
        assert resp.status_code in (404, 422), f"{bad_meeting_id!r} -> {resp.status_code}: {resp.text}"
        assert resp.status_code != 500


async def test_huge_int_assignee_user_id_on_create_never_500(
    db_session, async_client: AsyncClient, auth_headers
):
    """assignee_user_id는 BigInteger 컬럼 — SQLite 드라이버는 64bit를 초과하는 파이썬 int를
    바인딩할 때 OverflowError를 던진다. API가 이를 잡지 않으면 500 유출 (BLOCKER 후보)."""
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=1)

    huge = 10**30
    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "Huge assignee",
            "assignee_user_id": huge,
            "due_date": "2026-09-01",
        },
        headers=auth_headers,
    )
    assert resp.status_code in (404, 422), f"huge assignee_user_id -> {resp.status_code}: {resp.text}"
    assert resp.status_code != 500


async def test_huge_int_assignee_user_id_on_list_filter_never_500(
    db_session, async_client: AsyncClient, auth_headers
):
    huge = 10**30
    resp = await async_client.get(f"/action-items?assignee_user_id={huge}", headers=auth_headers)
    assert resp.status_code != 500, resp.text
    assert resp.status_code in (200, 403, 422), resp.text


# ============================================================================
# 3) due_date 형식/범위 — 절대 500 아님
# ============================================================================
@pytest.mark.parametrize(
    "bad_due_date",
    ["not-a-date", "2026-13-45", "01/09/2026", "", None, 20260901, ["2026-09-01"]],
)
async def test_create_with_malformed_due_date_never_500(
    db_session, async_client: AsyncClient, auth_headers, bad_due_date
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=1)

    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "Bad date",
            "assignee_user_id": 1,
            "due_date": bad_due_date,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422, f"due_date={bad_due_date!r} -> {resp.status_code}: {resp.text}"


async def test_create_with_far_past_and_far_future_due_date_accepted_no_500(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=1)

    for due in ("1900-01-01", "2999-12-31"):
        resp = await async_client.post(
            "/action-items",
            json={
                "meeting_id": str(meeting.id),
                "title": f"Extreme date {due}",
                "assignee_user_id": 1,
                "due_date": due,
            },
            headers=auth_headers,
        )
        # 계약상 due_date 범위 검증이 없으므로 201로 수용되거나 검증기가 있으면 422 — 500만 배제.
        assert resp.status_code in (201, 422), f"due_date={due} -> {resp.status_code}: {resp.text}"
        assert resp.status_code != 500


# ============================================================================
# 4) PATCH 상태값/전이 위법성
# ============================================================================
async def test_patch_status_pwned_returns_400(db_session, async_client: AsyncClient, auth_headers):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Mine", assignee_user_id=1, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.patch(f"/action-items/{item.id}", json={"status": "pwned"}, headers=auth_headers)
    assert resp.status_code == 400, resp.text
    assert resp.json().get("detail") == "invalid_status"


@pytest.mark.parametrize(
    "start_status,target_status",
    [
        (ActionItemStatus.COMPLETED, "open"),
        (ActionItemStatus.COMPLETED, "in_progress"),
        (ActionItemStatus.COMPLETED, "completed"),
        (ActionItemStatus.CANCELLED, "completed"),
        (ActionItemStatus.CANCELLED, "open"),
        (ActionItemStatus.CANCELLED, "cancelled"),
        (ActionItemStatus.OPEN, "open"),
        (ActionItemStatus.IN_PROGRESS, "open"),
        (ActionItemStatus.IN_PROGRESS, "in_progress"),
    ],
)
async def test_illegal_or_same_state_transitions_rejected(
    db_session, async_client: AsyncClient, auth_headers, start_status, target_status
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(
        id=uuid4(),
        meeting_id=meeting.id,
        title="Terminal",
        assignee_user_id=1,
        due_date=date(2026, 9, 1),
        status=start_status,
    )
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.patch(f"/action-items/{item.id}", json={"status": target_status}, headers=auth_headers)
    assert resp.status_code == 400, (
        f"{start_status.value}->{target_status} should be rejected, got {resp.status_code}: {resp.text}"
    )
    assert resp.json().get("detail") == "invalid_transition"

    # DB에 실제로 반영되지 않았는지 확인 (전이 거부가 부작용 없이 순수해야 함)
    await db_session.refresh(item)
    assert item.status == start_status


# ============================================================================
# 5) PATCH 권한 — 비담당자/비관리자 403
# ============================================================================
async def test_patch_by_non_assignee_employee_returns_403(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 50, "other@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Other's", assignee_user_id=50, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.patch(
        f"/action-items/{item.id}", json={"title": "hijacked"}, headers=auth_headers
    )
    assert resp.status_code == 403, resp.text
    assert resp.json().get("detail") == "action_item_update_forbidden"

    await db_session.refresh(item)
    assert item.title == "Other's", "forbidden PATCH must not mutate the row"


async def test_patch_by_meeting_host_who_is_not_assignee_still_forbidden(
    db_session, async_client: AsyncClient, auth_headers
):
    """호스트라도 담당자/관리자가 아니면 PATCH 불가 — DELETE와 달리 PATCH RBAC은 host를 인정하지 않음."""
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host_employee@example.com")
    await _seed_user(db_session, 50, "assignee@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=1)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Assigned to other", assignee_user_id=50, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.patch(
        f"/action-items/{item.id}", json={"status": "in_progress"}, headers=auth_headers
    )
    assert resp.status_code == 403, resp.text


# ============================================================================
# 6) 크로스유저/크로스팀 조회 — 404, 목록 유출 없음
# ============================================================================
async def test_employee_get_other_users_item_returns_404_not_leaked(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com", erp_team_id=1)
    await _seed_user(db_session, 77, "victim@example.com", erp_team_id=2)
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    victim_item = ActionItem(
        id=uuid4(), meeting_id=meeting.id, title="Secret", assignee_user_id=77, due_date=date(2026, 9, 1)
    )
    db_session.add(victim_item)
    await db_session.commit()

    resp = await async_client.get(f"/action-items/{victim_item.id}", headers=auth_headers)
    assert resp.status_code == 404, resp.text
    assert "Secret" not in resp.text


async def test_leader_get_other_team_item_returns_404(
    db_session, async_client: AsyncClient, leader_token
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 2, "leader@example.com", erp_team_id=1)
    await _seed_user(db_session, 77, "outsider@example.com", erp_team_id=2)
    await _seed_user(db_session, 999, "host@example.com", erp_team_id=1)
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    outsider_item = ActionItem(
        id=uuid4(), meeting_id=meeting.id, title="Other team", assignee_user_id=77, due_date=date(2026, 9, 1)
    )
    db_session.add(outsider_item)
    await db_session.commit()

    leader_headers = {"Authorization": f"Bearer {leader_token}"}
    resp = await async_client.get(f"/action-items/{outsider_item.id}", headers=leader_headers)
    assert resp.status_code == 404, resp.text



async def test_list_never_leaks_other_users_items_to_employee(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com", erp_team_id=1)
    await _seed_user(db_session, 2, "other1@example.com", erp_team_id=1)
    await _seed_user(db_session, 3, "other2@example.com", erp_team_id=2)
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    db_session.add_all(
        [
            ActionItem(id=uuid4(), meeting_id=meeting.id, title="Mine", assignee_user_id=1, due_date=date(2026, 9, 1)),
            ActionItem(id=uuid4(), meeting_id=meeting.id, title="Not mine A", assignee_user_id=2, due_date=date(2026, 9, 1)),
            ActionItem(id=uuid4(), meeting_id=meeting.id, title="Not mine B", assignee_user_id=3, due_date=date(2026, 9, 1)),
        ]
    )
    await db_session.commit()

    resp = await async_client.get("/action-items", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {i["assignee_user_id"] for i in body["items"]} == {1}
    assert body["total"] == 1
    titles = {i["title"] for i in body["items"]}
    assert "Not mine A" not in titles and "Not mine B" not in titles


async def test_list_meeting_id_filter_does_not_bypass_scoping(
    db_session, async_client: AsyncClient, auth_headers
):
    """meeting_id 필터를 추가해도 employee 스코프(본인 항목만)를 우회할 수 없어야 한다."""
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com", erp_team_id=1)
    await _seed_user(db_session, 2, "other@example.com", erp_team_id=1)
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    db_session.add_all(
        [
            ActionItem(id=uuid4(), meeting_id=meeting.id, title="Mine", assignee_user_id=1, due_date=date(2026, 9, 1)),
            ActionItem(id=uuid4(), meeting_id=meeting.id, title="Not mine", assignee_user_id=2, due_date=date(2026, 9, 1)),
        ]
    )
    await db_session.commit()

    resp = await async_client.get(f"/action-items?meeting_id={meeting.id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert {i["assignee_user_id"] for i in items} == {1}, f"scoping bypass via meeting_id filter: {items}"


# ============================================================================
# 7) DELETE 권한 — 비호스트/비관리자 403
# ============================================================================
async def test_delete_by_non_host_non_admin_employee_returns_403(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 50, "assignee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Not mine", assignee_user_id=50, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.delete(f"/action-items/{item.id}", headers=auth_headers)
    assert resp.status_code == 403, resp.text
    assert resp.json().get("detail") == "action_item_delete_forbidden"

    # 삭제되지 않았는지 확인
    still_there = await db_session.get(ActionItem, item.id)
    assert still_there is not None


async def test_assignee_who_is_not_host_nor_admin_cannot_delete(
    db_session, async_client: AsyncClient, auth_headers
):
    """담당자 본인이라도 회의 호스트/관리자가 아니면 DELETE 불가 (PATCH와 반대 RBAC)."""
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Assigned to me", assignee_user_id=1, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.delete(f"/action-items/{item.id}", headers=auth_headers)
    assert resp.status_code == 403, resp.text


# ============================================================================
# 8) 회의록(minutes) 구조적 액션아이템 인입 — 기형 입력, 멱등성, 부분 오염 방지
# ============================================================================
async def _create_meeting_via_api(async_client: AsyncClient, room: Room, headers: dict) -> str:
    resp = await async_client.post(
        "/meetings",
        json={
            "title": "Sync",
            "room_id": str(room.id),
            "start_time": BASE.isoformat(),
            "end_time": (BASE + timedelta(hours=1)).isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["meeting_id"]


async def test_minutes_malformed_action_items_never_500(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")
    meeting_id = await _create_meeting_via_api(async_client, room, auth_headers)

    payload = {
        "title": "Minutes",
        "action_items": [
            {"task": "missing owner_id", "due_date": "2026-09-20", "title": "No owner"},
            {"task": "string owner_id", "owner_id": "1", "due_date": "2026-09-20", "title": "String owner"},
            {"task": "float owner_id", "owner_id": 1.5, "due_date": "2026-09-20", "title": "Float owner"},
            {"task": "bool owner_id", "owner_id": True, "due_date": "2026-09-20", "title": "Bool owner"},
            {"task": "bad due_date", "owner_id": 1, "due_date": "not-a-date", "title": "Bad due"},
            {"task": "null due_date", "owner_id": 1, "due_date": None, "title": "Null due"},
            {"task": "missing title", "owner_id": 1, "due_date": "2026-09-20"},
            {"task": "empty title", "owner_id": 1, "due_date": "2026-09-20", "title": ""},
            {"task": "huge owner_id", "owner_id": 10**30, "due_date": "2026-09-20", "title": "Huge owner"},
            {
                "task": "nested",
                "owner_id": 1,
                "due_date": "2026-09-20",
                "title": "Nested",
                "extra": {"a": {"b": {"c": list(range(1000))}}},
            },
        ],
    }
    resp = await async_client.put(f"/meetings/{meeting_id}/minutes", json=payload, headers=auth_headers)
    assert resp.status_code != 500, resp.text
    assert resp.status_code == 200, resp.text

    stmt = select(ActionItem).where(ActionItem.meeting_id == UUID(meeting_id))
    rows = (await db_session.execute(stmt)).scalars().all()
    # 오직 "nested"(title+int owner_id+valid due_date 모두 존재)만 구조적 행이 되어야 한다.
    assert len(rows) == 1, f"expected exactly 1 valid structured ActionItem, got {len(rows)}: {[r.title for r in rows]}"
    assert rows[0].title == "Nested"
    assert rows[0].assignee_user_id == 1


async def test_minutes_owner_id_referencing_nonexistent_user_skipped_not_500(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")
    meeting_id = await _create_meeting_via_api(async_client, room, auth_headers)

    payload = {
        "title": "Minutes",
        "action_items": [
            {"title": "Ghost owner", "owner_id": 9999, "due_date": "2026-09-20"},
        ],
    }
    resp = await async_client.put(f"/meetings/{meeting_id}/minutes", json=payload, headers=auth_headers)
    assert resp.status_code != 500, resp.text
    assert resp.status_code == 200, resp.text

    stmt = select(ActionItem).where(ActionItem.meeting_id == UUID(meeting_id))
    rows = (await db_session.execute(stmt)).scalars().all()
    assert len(rows) == 0, f"nonexistent owner_id should be skipped, not persisted: {rows}"


async def test_minutes_repeated_put_does_not_duplicate_action_items(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")
    meeting_id = await _create_meeting_via_api(async_client, room, auth_headers)

    payload = {
        "title": "Minutes",
        "action_items": [
            {"title": "Repeat me", "owner_id": 1, "due_date": "2026-09-20"},
        ],
    }
    for i in range(5):
        resp = await async_client.put(f"/meetings/{meeting_id}/minutes", json=payload, headers=auth_headers)
        assert resp.status_code == 200, f"iteration {i}: {resp.text}"

    stmt = select(ActionItem).where(ActionItem.meeting_id == UUID(meeting_id))
    rows = (await db_session.execute(stmt)).scalars().all()
    assert len(rows) == 1, f"expected exactly 1 row after 5 repeated PUTs, got {len(rows)}"


async def test_minutes_partial_bad_batch_does_not_corrupt_valid_items(
    db_session, async_client: AsyncClient, auth_headers
):
    """한 배치에 유효 항목과 기형 항목이 섞여 있어도 유효 항목만 정확히 반영되고
    기형 항목 처리 중 예외로 트랜잭션 전체가 롤백/오염되지 않아야 한다."""
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")
    await _seed_user(db_session, 2, "teammate@example.com")
    meeting_id = await _create_meeting_via_api(async_client, room, auth_headers)

    payload = {
        "title": "Minutes",
        "action_items": [
            {"title": "Valid one", "owner_id": 1, "due_date": "2026-09-20"},
            {"title": "Bad due", "owner_id": 2, "due_date": "garbage"},
            {"title": "Valid two", "owner_id": 2, "due_date": "2026-09-21"},
            {"title": "Ghost", "owner_id": 424242, "due_date": "2026-09-22"},
        ],
    }
    resp = await async_client.put(f"/meetings/{meeting_id}/minutes", json=payload, headers=auth_headers)
    assert resp.status_code == 200, resp.text

    stmt = select(ActionItem).where(ActionItem.meeting_id == UUID(meeting_id))
    rows = (await db_session.execute(stmt)).scalars().all()
    titles = {r.title for r in rows}
    assert titles == {"Valid one", "Valid two"}, f"unexpected structural rows: {titles}"


async def test_minutes_edit_by_non_participant_returns_403(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")

    meeting = await _seed_meeting(db_session, room, host_user_id=999)

    resp = await async_client.put(
        f"/meetings/{meeting.id}/minutes",
        json={"title": "Hijack", "action_items": [{"title": "x", "owner_id": 1, "due_date": "2026-09-20"}]},
        headers=auth_headers,
    )
    assert resp.status_code == 403, resp.text

    stmt = select(ActionItem).where(ActionItem.meeting_id == meeting.id)
    rows = (await db_session.execute(stmt)).scalars().all()
    assert len(rows) == 0, "forbidden minute edit must not create structured action items"


# ============================================================================
# 9) PATCH -> completed sets completed_at, idempotent-safe
# ============================================================================
async def test_patch_to_completed_sets_completed_at_and_repeated_patch_is_safe(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    item = ActionItem(id=uuid4(), meeting_id=meeting.id, title="Mine", assignee_user_id=1, due_date=date(2026, 9, 1))
    db_session.add(item)
    await db_session.commit()

    resp = await async_client.patch(f"/action-items/{item.id}", json={"status": "completed"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    completed_at_1 = resp.json()["completed_at"]
    assert completed_at_1 is not None

    # 동일 상태로 재전송 시도(이미 종결 상태) -> 400, 서버 크래시 없음, completed_at 불변
    resp2 = await async_client.patch(f"/action-items/{item.id}", json={"status": "completed"}, headers=auth_headers)
    assert resp2.status_code == 400, resp2.text
    assert resp2.json().get("detail") == "invalid_transition"

    resp3 = await async_client.get(f"/action-items/{item.id}", headers=auth_headers)
    assert resp3.status_code == 200, resp3.text
    assert resp3.json()["completed_at"] == completed_at_1, "completed_at must not change on rejected re-transition"


async def test_patch_other_fields_while_completed_does_not_reset_completed_at(
    db_session, async_client: AsyncClient, admin_auth_headers
):
    """종결 상태에서 상태 이외 필드만 수정해도(관리자 권한으로) completed_at이 초기화되면 안 된다."""
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "employee@example.com")
    await _seed_user(db_session, 999, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=999)
    completed_ts = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)
    item = ActionItem(
        id=uuid4(),
        meeting_id=meeting.id,
        title="Done",
        assignee_user_id=1,
        due_date=date(2026, 9, 1),
        status=ActionItemStatus.COMPLETED,
        completed_at=completed_ts,
    )
    db_session.add(item)
    await db_session.commit()

    initial = await async_client.get(f"/action-items/{item.id}", headers=admin_auth_headers)
    assert initial.status_code == 200, initial.text
    initial_completed_at = initial.json()["completed_at"]
    assert initial_completed_at is not None

    resp = await async_client.patch(
        f"/action-items/{item.id}", json={"related_ref": "JIRA-99"}, headers=admin_auth_headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["related_ref"] == "JIRA-99"
    # SQLite 테스트 드라이버는 tz-aware datetime을 왕복 후 naive로 반환할 수 있음(계약상
    # 무관한 드라이버 특성) — 여기서는 실제 시각(instant)이 보존되는지만 검증한다.
    def _parsed(v: str) -> datetime:
        dt = datetime.fromisoformat(v)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    assert _parsed(resp.json()["completed_at"]) == _parsed(initial_completed_at), "completed_at instant must be preserved"


# ============================================================================
# 10) 생성 시 assignee/meeting 불일치 또는 미존재 -> 404
# ============================================================================
async def test_create_with_nonexistent_meeting_and_valid_assignee_returns_404(
    db_session, async_client: AsyncClient, auth_headers
):
    await _seed_user(db_session, 1, "employee@example.com")
    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(uuid4()),
            "title": "Ghost meeting",
            "assignee_user_id": 1,
            "due_date": "2026-09-01",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "meeting_not_found"


async def test_create_with_valid_meeting_and_nonexistent_assignee_returns_404(
    db_session, async_client: AsyncClient, auth_headers
):
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=1)

    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "Ghost assignee",
            "assignee_user_id": 424242,
            "due_date": "2026-09-01",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("detail") == "assignee_not_found"


async def test_create_assignee_not_related_to_meeting_still_allowed_by_contract(
    db_session, async_client: AsyncClient, auth_headers
):
    """계약상 assignee가 회의 참석자일 필요는 없음(호스트/관리자가 임의 사용자에게 할당 가능).
    이 자체는 버그가 아니지만, 존재하지 않는 조합에서 404가 아닌 엉뚱한 성공/500이 나오면 안 된다."""
    room = await _seed_room(db_session)
    await _seed_user(db_session, 1, "host@example.com")
    await _seed_user(db_session, 55, "unrelated@example.com")
    meeting = await _seed_meeting(db_session, room, host_user_id=1)

    resp = await async_client.post(
        "/action-items",
        json={
            "meeting_id": str(meeting.id),
            "title": "Assign to unrelated user",
            "assignee_user_id": 55,
            "due_date": "2026-09-01",
        },
        headers=auth_headers,
    )
    assert resp.status_code in (201, 403, 404), resp.text
    assert resp.status_code != 500
