"""
모바일/푸시 알림 (P7-R2-T1).

리마인더 대상: 회의 시작 30분 전, 액션아이템 기한 24h 전(12-tasks P7-R2-T1). 전송 채널은
FCM 또는 Slack — 미설정 시 no-op(관측 로그만). upcoming_reminders는 순수 조회 로직으로
테스트 가능하며, 실제 발송 스케줄 연결은 배포 인프라(FCM 키/Slack 웹훅) 확보 후.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as default_settings
from app.models.tables import ActionItem, ActionItemStatus, Meeting, MeetingStatus

logger = logging.getLogger(__name__)

MEETING_LEAD = timedelta(minutes=30)
ACTION_LEAD = timedelta(hours=24)


async def upcoming_reminders(db: AsyncSession, now: datetime | None = None) -> list[dict[str, Any]]:
    """지금 기준 리마인더 대상 목록. 회의(30분 이내 시작·예정) + 액션아이템(24h 이내 기한·미완료)."""
    if now is None:
        now = datetime.now(timezone.utc)
    reminders: list[dict[str, Any]] = []

    meeting_cutoff = now + MEETING_LEAD
    meetings = (
        await db.execute(
            select(Meeting).where(
                Meeting.status == MeetingStatus.SCHEDULED,
                Meeting.scheduled_at >= now,
                Meeting.scheduled_at <= meeting_cutoff,
            )
        )
    ).scalars().all()
    for m in meetings:
        reminders.append(
            {"type": "meeting_soon", "target_user_id": m.host_user_id,
             "title": f"곧 회의: {m.title}", "when": m.scheduled_at.isoformat()}
        )

    action_cutoff = (now + ACTION_LEAD).date()
    items = (
        await db.execute(
            select(ActionItem).where(
                ActionItem.status != ActionItemStatus.COMPLETED,
                ActionItem.due_date.is_not(None),
                ActionItem.due_date <= action_cutoff,
            )
        )
    ).scalars().all()
    for it in items:
        reminders.append(
            {"type": "action_due", "target_user_id": it.assignee_user_id,
             "title": "액션아이템 기한 임박", "when": it.due_date.isoformat() if it.due_date else None}
        )
    return reminders


async def send(payload: dict[str, Any], *, settings=default_settings, client: httpx.AsyncClient | None = None) -> bool:
    """단건 알림 전송. Slack 웹훅 설정 시 전송, 미설정 시 no-op(로그). 반환: 실제 전송 여부."""
    if not settings.alert_webhook_enabled:
        logger.info("push_notification(no-op): %s", payload.get("title"))
        return False
    owns = client is None
    http = client or httpx.AsyncClient(timeout=5.0)
    try:
        await http.post(settings.alert_slack_webhook_url, json={"text": payload.get("title", "알림")})
        return True
    except Exception:  # noqa: BLE001
        logger.warning("push_notification 전송 실패(non-fatal)", exc_info=True)
        return False
    finally:
        if owns:
            await http.aclose()
