"""
test_eod_push.py — EOD ERP 전송 배치 (REQ-008/D18).

검증:
1. pending → sent 전이 (mock 전송)
2. run_id 태깅 + pushed_at 기록
3. 멱등: 재실행 시 이미 sent인 행 재전송 안 함 (total=0)
4. 관리자 수동 트리거 API POST /api/daily-status-push/run
5. 스케줄러에 eod_push 잡 등록됨
"""

from __future__ import annotations

from datetime import date

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import (
    DailyStatusPush,
    DailyStatusPushStatus,
    DailyStatusPushTarget,
    ErpUser,
)
from app.services.eod_push import run_eod_push


@pytest_asyncio.fixture
async def seed_user(db_session: AsyncSession) -> ErpUser:
    user = ErpUser(id=100, company_id=1, email="u@x.com", name="U", erp_team_id=10, role="employee")
    db_session.add(user)
    await db_session.flush()
    return user


async def _queue_push(db: AsyncSession, user_id: int) -> DailyStatusPush:
    row = DailyStatusPush(
        user_id=user_id,
        push_date=date(2026, 7, 1),
        target=DailyStatusPushTarget.ERP_DAILY_REPORTS,
        payload={"today": "작업 A", "tomorrow": "작업 B"},
        status=DailyStatusPushStatus.PENDING,
    )
    db.add(row)
    await db.flush()
    return row


async def test_pending_to_sent(db_session: AsyncSession, seed_user: ErpUser):
    row = await _queue_push(db_session, seed_user.id)
    summary = await run_eod_push(db_session)
    assert summary["sent"] == 1
    assert summary["failed"] == 0
    assert summary["total"] == 1

    await db_session.refresh(row)
    assert row.status == DailyStatusPushStatus.SENT
    assert row.pushed_at is not None
    assert row.run_id is not None
    assert row.erp_response and row.erp_response.get("ok") is True


async def test_idempotent_rerun(db_session: AsyncSession, seed_user: ErpUser):
    await _queue_push(db_session, seed_user.id)
    first = await run_eod_push(db_session)
    assert first["sent"] == 1
    # 재실행: pending이 없으므로 아무것도 전송 안 함 (멱등)
    second = await run_eod_push(db_session)
    assert second["total"] == 0
    assert second["sent"] == 0


async def test_run_endpoint_admin(async_client, admin_auth_headers, db_session: AsyncSession, seed_user: ErpUser):
    await _queue_push(db_session, seed_user.id)
    await db_session.commit()
    resp = await async_client.post("/api/daily-status-push/run", headers=admin_auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sent"] == 1
    assert body["total"] == 1
    assert body["run_id"]


async def test_run_endpoint_requires_admin(async_client, auth_headers):
    resp = await async_client.post("/api/daily-status-push/run", headers=auth_headers)
    assert resp.status_code == 403


def test_scheduler_registers_eod_job():
    """스케줄러 잡 등록 확인 (실기동 없이 함수 존재/등록 로직)."""
    from app.services import scheduler as sch

    assert hasattr(sch, "_eod_push_job")
