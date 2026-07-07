"""일일 상태 리포트(daily_status_push) POST/GET 테스트 (REQ-008)."""

import pytest


@pytest.mark.asyncio
async def test_create_daily_status_push(async_client, auth_headers):
    """본인 일일 상태 리포트를 큐잉하면 pending 레코드 생성."""
    r = await async_client.post(
        "/api/daily-status-push",
        headers=auth_headers,
        json={
            "today_plan": "스프린트 이슈 정리",
            "in_progress": "office-layout 편집기",
            "blockers": "없음",
            "tomorrow_plan": "리뷰 반영",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["target"] == "erp_daily_reports"
    assert body["payload"]["today_plan"] == "스프린트 이슈 정리"
    assert body["payload"]["blockers"] == "없음"


@pytest.mark.asyncio
async def test_daily_status_push_admin_list_includes_created(async_client, auth_headers, admin_auth_headers):
    """생성된 리포트가 관리자 조회 목록에 나타난다."""
    await async_client.post(
        "/api/daily-status-push",
        headers=auth_headers,
        json={"today_plan": "A", "in_progress": "B", "blockers": "C", "tomorrow_plan": "D"},
    )
    r = await async_client.get("/api/daily-status-push", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert any(x["payload"].get("today_plan") == "A" for x in rows)


@pytest.mark.asyncio
async def test_daily_status_push_requires_auth(async_client):
    """미인증은 401."""
    r = await async_client.post("/api/daily-status-push", json={"today_plan": "x"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_kpi_erp_push_target(async_client, admin_auth_headers):
    """KPI ERP 푸시: target=erp_kpi_results + payload override로 큐잉."""
    r = await async_client.post(
        "/api/daily-status-push",
        headers=admin_auth_headers,
        json={"target": "erp_kpi_results", "payload": {"metric": "quarterly_total", "final_score": 88.5, "period_key": "2026-Q3"}},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["target"] == "erp_kpi_results"
    assert body["payload"]["final_score"] == 88.5


@pytest.mark.asyncio
async def test_invalid_target_rejected(async_client, admin_auth_headers):
    """알 수 없는 target은 400."""
    r = await async_client.post("/api/daily-status-push", headers=admin_auth_headers, json={"target": "bogus"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_retry_failed_push(async_client, admin_auth_headers, auth_headers, db_session):
    """실패한 push를 재시도하면 pending + retry_count 증가."""
    import uuid
    from app.models.tables import DailyStatusPush, DailyStatusPushStatus, DailyStatusPushTarget
    row = DailyStatusPush(
        id=uuid.uuid4(), user_id=1003, push_date=__import__("datetime").date.today(),
        target=DailyStatusPushTarget.ERP_DAILY_REPORTS, payload={"x": 1},
        status=DailyStatusPushStatus.FAILED, error_message="boom", retry_count=0,
    )
    db_session.add(row)
    await db_session.commit()
    r = await async_client.post(f"/api/daily-status-push/{row.id}/retry", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending"


@pytest.mark.asyncio
async def test_retry_only_failed(async_client, admin_auth_headers, db_session):
    """pending 상태는 재시도 불가(409)."""
    import uuid
    from app.models.tables import DailyStatusPush, DailyStatusPushStatus, DailyStatusPushTarget
    row = DailyStatusPush(
        id=uuid.uuid4(), user_id=1003, push_date=__import__("datetime").date.today(),
        target=DailyStatusPushTarget.ERP_DAILY_REPORTS, payload={"x": 1},
        status=DailyStatusPushStatus.PENDING,
    )
    db_session.add(row)
    await db_session.commit()
    r = await async_client.post(f"/api/daily-status-push/{row.id}/retry", headers=admin_auth_headers)
    assert r.status_code == 409
