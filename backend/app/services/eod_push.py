"""
EOD(End-of-Day) ERP 전송 배치 (REQ-008, D18).

정본: 03-erp-integration.md, 00-decisions.md D18.
- daily_status_push 큐(status=pending)를 ERP로 전송하고 pending→sent 전이.
- 매일 18:05 KST 배치(KPI 18:00 이후) + 관리자 수동 트리거.
- 멱등: 이미 sent인 행은 재전송하지 않음. run_id로 배치 회차를 태깅.
- 실패 시 status=failed, retry_count+1, error_message 기록 (retry API로 pending 재큐잉).

전송 계층:
- settings.erp_push_endpoint 미설정 → **mock 전송**(상태머신만 동작, 실 ERP 미접속).
  실 ERP write-back DB/HTTP는 외부 의존 → 엔드포인트 설정 시 아래 _transmit 실경로 구현 지점.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.tables import (
    DailyStatusPush,
    DailyStatusPushStatus,
    DailyStatusPushTarget,
)

MAX_RETRY = 3


async def _transmit(push: DailyStatusPush) -> dict:
    """
    단일 push를 ERP로 전송. 성공 시 ERP 응답 dict 반환, 실패 시 예외.

    - erp_push_endpoint 미설정: mock 성공(실 ERP 미접속 상태의 정직한 표현).
    - 설정 시: 실 ERP write-back 구현 지점(현재는 외부 의존으로 미배선 → NotImplemented).
    """
    if not settings.erp_push_endpoint:
        return {"ok": True, "mock": True, "target": push.target.value}
    # 실 ERP write-back (HTTP POST / read-write DB)은 외부 리소스 확보 후 구현.
    raise NotImplementedError("real ERP push endpoint not yet wired (external dependency)")


async def run_eod_push(
    db: AsyncSession,
    *,
    run_id: Optional[UUID] = None,
    push_date: Optional[date] = None,
    target: DailyStatusPushTarget = DailyStatusPushTarget.ERP_DAILY_REPORTS,
) -> dict:
    """
    pending 상태의 daily_status_push를 ERP로 전송.

    Args:
        run_id: 배치 회차 식별자(멱등 태깅). 미지정 시 신규 생성.
        push_date: 대상 날짜(KST). 미지정 시 전체 pending.
        target: 전송 대상(기본 erp_daily_reports).

    Returns:
        {run_id, sent, failed, total} 요약.
    """
    run_id = run_id or uuid4()

    conds = [
        DailyStatusPush.status == DailyStatusPushStatus.PENDING,
        DailyStatusPush.target == target,
    ]
    if push_date is not None:
        conds.append(DailyStatusPush.push_date == push_date)

    rows = (await db.execute(select(DailyStatusPush).where(*conds))).scalars().all()

    sent = 0
    failed = 0
    for push in rows:
        try:
            resp = await _transmit(push)
            push.status = DailyStatusPushStatus.SENT
            push.pushed_at = datetime.now(timezone.utc)
            push.erp_response = resp
            push.error_message = None
            push.run_id = run_id
            sent += 1
        except Exception as exc:
            push.status = DailyStatusPushStatus.FAILED
            push.error_message = str(exc)[:1000]
            push.retry_count = (push.retry_count or 0) + 1
            push.run_id = run_id
            failed += 1

    await db.flush()
    return {
        "run_id": str(run_id),
        "sent": sent,
        "failed": failed,
        "total": len(rows),
    }
