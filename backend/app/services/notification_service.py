"""
실패 알림 서비스 (P7-R3-T3, D18/D21).

- record_notification: Notification 행을 세션에 stage(관리자 콘솔 알림). commit은 호출자 소유
  (audit_service와 동일 원자성 규약 — 도메인 트랜잭션과 함께 커밋/롤백).
- alert_slack_webhook_url이 설정되면 Slack Incoming Webhook으로 best-effort 병행 전송한다.
  전송 실패는 알림 적재 자체를 막지 않는다(외부 채널은 부가, 원본은 DB).

관측 스택(Grafana/Prometheus/Loki/Uptime Kuma, D21)은 인프라 범위로 이 서비스 밖.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as default_settings
from app.models.tables import Notification

logger = logging.getLogger(__name__)


async def record_notification(
    db: AsyncSession,
    *,
    category: str,
    title: str,
    message: Optional[str] = None,
    severity: str = "error",
    context: Optional[dict[str, Any]] = None,
    send_external: bool = True,
    settings=default_settings,
    client: Optional[httpx.AsyncClient] = None,
) -> Notification:
    """알림 1건을 세션에 stage하고, 웹훅이 설정돼 있으면 best-effort로 외부 전송한다.

    반환값: stage된 Notification(호출자가 commit 후 id 확정). commit/flush는 하지 않는다.
    """
    note = Notification(
        category=category,
        severity=severity,
        title=title,
        message=message,
        context=context,
        is_read=False,
    )
    db.add(note)

    if send_external and settings.alert_webhook_enabled:
        await _post_slack(settings.alert_slack_webhook_url, category, severity, title, message, client)

    return note


async def _post_slack(
    webhook_url: str,
    category: str,
    severity: str,
    title: str,
    message: Optional[str],
    client: Optional[httpx.AsyncClient],
) -> None:
    """Slack Incoming Webhook best-effort 전송. 실패는 삼킨다(외부 채널은 부가)."""
    text = f"[{severity.upper()}][{category}] {title}"
    if message:
        text += f"\n{message}"
    owns = client is None
    http = client or httpx.AsyncClient(timeout=5.0)
    try:
        await http.post(webhook_url, json={"text": text})
    except Exception:  # noqa: BLE001 - 외부 전송 실패는 알림 적재를 막지 않는다.
        logger.warning("record_notification: Slack 웹훅 전송 실패(non-fatal)", exc_info=True)
    finally:
        if owns:
            await http.aclose()
