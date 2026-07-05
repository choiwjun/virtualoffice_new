"""배치3: 회의록 AI 요약(P7-R1-T3) + 모바일 푸시 리마인더(P7-R2-T1)."""

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import (
    ActionItem,
    ActionItemPriority,
    ActionItemStatus,
    ErpRole,
    ErpUser,
    Floor,
    Meeting,
    MeetingStatus,
    Office,
    Room,
    RoomStatus,
    RoomType,
)
from app.services import push_notification
from app.services.meeting_ai_summarizer import minute_to_text, summarize_minute


async def _office_floor_room_meeting(db: AsyncSession, when: datetime, uid: int = 1):
    if not await db.get(ErpUser, uid):
        db.add(ErpUser(id=uid, company_id=1, email=f"u{uid}@x.com", name=f"U{uid}", erp_team_id=1, role=ErpRole.EMPLOYEE))
    office = Office(id=uuid4(), company_id=uuid4(), name="본사")
    db.add(office)
    await db.flush()
    floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1F")
    db.add(floor)
    await db.flush()
    room = Room(id=uuid4(), floor_id=floor.id, type=RoomType.MEETING, name="R", capacity=4,
                coords={"x": 1, "y": 1, "width": 3, "height": 2}, status=RoomStatus.ACTIVE)
    db.add(room)
    await db.flush()
    meeting = Meeting(id=uuid4(), room_id=room.id, host_user_id=uid, title="스탠드업",
                      scheduled_at=when, scheduled_end=when + timedelta(hours=1), status=MeetingStatus.SCHEDULED)
    db.add(meeting)
    await db.flush()
    return meeting


# ── 회의록 AI 요약(P7-R1-T3) ─────────────────────────────
async def test_summarizer_fallback():
    text = minute_to_text("주간회의", "요약본문", "배포 승인", "- EMP-3: QA")
    r = await summarize_minute(text)
    assert r["model"] == "fallback" and len(r["summary"]) > 0
    empty = await summarize_minute("")
    assert empty["summary"] == ""


async def test_summarize_endpoint(async_client, db_session: AsyncSession, admin_auth_headers):
    now = datetime.now(timezone.utc)
    meeting = await _office_floor_room_meeting(db_session, now, uid=3)
    await db_session.commit()
    mid = str(meeting.id)
    # 회의록 생성(PUT) 후 요약
    await async_client.put(f"/meetings/{mid}/minutes", headers=admin_auth_headers,
                           json={"title": "회의록", "content": "핵심 논의", "decisions": ["배포 승인"]})
    r = await async_client.post(f"/meetings/{mid}/minutes/summarize", headers=admin_auth_headers)
    assert r.status_code == 200
    assert r.json()["ai_summary"] and r.json()["model"] == "fallback"


# ── 모바일 푸시 리마인더(P7-R2-T1) ───────────────────────
async def test_upcoming_reminders(db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    meeting = await _office_floor_room_meeting(db_session, now + timedelta(minutes=20), uid=1)
    db_session.add(ActionItem(id=uuid4(), meeting_id=meeting.id, title="문서정리", assignee_user_id=1,
                              due_date=(now + timedelta(hours=12)).date(), priority=ActionItemPriority.MEDIUM,
                              status=ActionItemStatus.OPEN))
    await db_session.commit()

    reminders = await push_notification.upcoming_reminders(db_session, now)
    types = {r["type"] for r in reminders}
    assert "meeting_soon" in types and "action_due" in types

    # 미설정 시 send는 no-op(False)
    assert await push_notification.send({"title": "x"}) is False


async def test_reminders_exclude_far_events(db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    # 2시간 뒤 회의는 30분 리드타임 밖 → 제외
    await _office_floor_room_meeting(db_session, now + timedelta(hours=2), uid=5)
    await db_session.commit()
    reminders = await push_notification.upcoming_reminders(db_session, now)
    assert all(r["type"] != "meeting_soon" for r in reminders)
