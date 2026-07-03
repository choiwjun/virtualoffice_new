"""
G009 ERP 동기화 모니터링(/sync/*) + 감사 로그(/audit-logs*) API 적대적(red-team) e2e 테스트.

목적: admin 전용 RBAC(비admin 403, 미인증 401), 존재하지 않는/형식이 잘못된 job_id·log_id의
404 통일, /audit-logs 필터(action/user_id/days) 동작, ERP 동기화 성공 흐름의 ErpSyncLog
정합성을 검증한다. 정상 플로우 기본 검증은 contract/test_management_api_stubs.py 담당 —
여기는 경계/공격 시나리오 전용.

실제 앱(app.main:app)을 httpx AsyncClient로 그대로 호출한다(conftest.async_client/db_session
재사용). mock ERP reader 활성(ERP_DATABASE_URL 미설정 테스트 환경) — Office/Floor/Room 등은
불필요, ErpUser/AuditLog/ErpSyncLog만 직접 시드한다.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import AuditLog, ErpSyncLog, ErpSyncStatus


# ============================================================================
# 1) 인증/RBAC — /sync/*
# ============================================================================

async def test_sync_trigger_requires_auth(async_client):
    r = await async_client.post("/sync/erp")
    assert r.status_code == 401, r.text


async def test_sync_trigger_non_admin_forbidden(async_client, auth_headers):
    r = await async_client.post("/sync/erp", headers=auth_headers)
    assert r.status_code == 403, r.text


async def test_sync_status_non_admin_forbidden(async_client, auth_headers):
    r = await async_client.get(f"/sync/status?job_id={uuid4()}", headers=auth_headers)
    assert r.status_code == 403, r.text


async def test_sync_status_requires_auth(async_client):
    r = await async_client.get(f"/sync/status?job_id={uuid4()}")
    assert r.status_code == 401, r.text


async def test_sync_errors_non_admin_forbidden(async_client, auth_headers):
    r = await async_client.get("/sync/errors", headers=auth_headers)
    assert r.status_code == 403, r.text


async def test_sync_errors_requires_auth(async_client):
    r = await async_client.get("/sync/errors")
    assert r.status_code == 401, r.text


# ============================================================================
# 2) /sync/status 경계 — 존재하지 않는/형식이 잘못된 job_id
# ============================================================================

async def test_sync_status_nonexistent_job_id_returns_404(async_client, admin_auth_headers):
    r = await async_client.get(f"/sync/status?job_id={uuid4()}", headers=admin_auth_headers)
    assert r.status_code == 404, r.text


async def test_sync_status_malformed_job_id_returns_404_not_422(async_client, admin_auth_headers):
    r = await async_client.get("/sync/status?job_id=not-a-uuid", headers=admin_auth_headers)
    assert r.status_code == 404, r.text


async def test_sync_status_sql_injection_job_id_returns_404(async_client, admin_auth_headers):
    r = await async_client.get(
        "/sync/status?job_id=1' OR '1'='1", headers=admin_auth_headers
    )
    assert r.status_code == 404, r.text


# ============================================================================
# 3) ERP 동기화 성공 흐름 — ErpSyncLog 정합성
# ============================================================================

async def test_sync_trigger_success_records_status_and_counts(
    db_session: AsyncSession, async_client, admin_auth_headers
):
    trigger = await async_client.post("/sync/erp", headers=admin_auth_headers)
    assert trigger.status_code == 202, trigger.text
    body = trigger.json()
    job_id = body["sync_job_id"]

    status_resp = await async_client.get(
        f"/sync/status?job_id={job_id}", headers=admin_auth_headers
    )
    assert status_resp.status_code == 200, status_resp.text
    data = status_resp.json()
    assert data["status"] == "success"
    assert data["error_count"] == 0
    # MockErpReader 기본 데이터셋: 5명 신규 생성
    assert data["created_count"] == 5

    log = await db_session.get(ErpSyncLog, UUID(job_id))
    assert log is not None
    assert log.status == ErpSyncStatus.SUCCESS
    assert log.finished_at is not None
    assert log.error_message is None


async def test_sync_errors_excludes_success_logs(
    db_session: AsyncSession, async_client, admin_auth_headers
):
    now = datetime.now(timezone.utc)
    db_session.add_all([
        ErpSyncLog(status=ErpSyncStatus.SUCCESS, started_at=now, finished_at=now),
        ErpSyncLog(
            status=ErpSyncStatus.FAILED,
            started_at=now,
            finished_at=now,
            error_count=1,
            error_message="connection timeout",
        ),
    ])
    await db_session.commit()

    r = await async_client.get("/sync/errors?limit=10", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    errors = r.json()["errors"]
    assert len(errors) == 1
    assert errors[0]["error_message"] == "connection timeout"
    assert errors[0]["error_count"] == 1


# ============================================================================
# 4) 인증/RBAC — /audit-logs*
# ============================================================================

async def test_audit_logs_requires_auth(async_client):
    r = await async_client.get("/audit-logs")
    assert r.status_code == 401, r.text


async def test_audit_log_detail_non_admin_forbidden(async_client, auth_headers):
    r = await async_client.get(f"/audit-logs/{uuid4()}", headers=auth_headers)
    assert r.status_code == 403, r.text


async def test_audit_log_detail_requires_auth(async_client):
    r = await async_client.get(f"/audit-logs/{uuid4()}")
    assert r.status_code == 401, r.text


# ============================================================================
# 5) /audit-logs/{id} 경계 — 존재하지 않는/형식이 잘못된 id
# ============================================================================

async def test_audit_log_detail_nonexistent_returns_404(async_client, admin_auth_headers):
    r = await async_client.get(f"/audit-logs/{uuid4()}", headers=admin_auth_headers)
    assert r.status_code == 404, r.text


async def test_audit_log_detail_malformed_id_returns_404_not_422(
    async_client, admin_auth_headers
):
    r = await async_client.get("/audit-logs/not-a-uuid", headers=admin_auth_headers)
    assert r.status_code == 404, r.text


# ============================================================================
# 6) /audit-logs 필터 동작 (action / user_id / days)
# ============================================================================

async def _seed_audit_logs(db_session: AsyncSession) -> None:
    now = datetime.now(timezone.utc)
    db_session.add_all([
        AuditLog(
            user_id=1, action="seat_assigned", entity_type="seat", entity_id="s-1",
            created_at=now,
        ),
        AuditLog(
            user_id=2, action="meeting_created", entity_type="meeting", entity_id="m-1",
            created_at=now,
        ),
        AuditLog(
            user_id=1, action="kpi_adjusted", entity_type="kpi_result", entity_id="k-1",
            old_value={"score": 80}, new_value={"score": 90},
            created_at=now - timedelta(days=10),
        ),
    ])
    await db_session.commit()


async def test_audit_logs_filter_by_action(db_session, async_client, admin_auth_headers):
    await _seed_audit_logs(db_session)
    r = await async_client.get("/audit-logs?action=seat_assigned", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    logs = r.json()["logs"]
    assert len(logs) == 1
    assert logs[0]["action"] == "seat_assigned"


async def test_audit_logs_filter_by_user_id(db_session, async_client, admin_auth_headers):
    await _seed_audit_logs(db_session)
    r = await async_client.get("/audit-logs?user_id=1", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    logs = r.json()["logs"]
    assert len(logs) == 2
    assert all(log["user_id"] == 1 for log in logs)


async def test_audit_logs_filter_by_days_excludes_older(
    db_session, async_client, admin_auth_headers
):
    await _seed_audit_logs(db_session)
    r = await async_client.get("/audit-logs?days=7", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    logs = r.json()["logs"]
    # kpi_adjusted(10일 전)는 7일 필터에서 제외
    assert len(logs) == 2
    assert "kpi_adjusted" not in {log["action"] for log in logs}


async def test_audit_logs_changes_mapping(db_session, async_client, admin_auth_headers):
    await _seed_audit_logs(db_session)
    r = await async_client.get("/audit-logs?action=kpi_adjusted", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    log = r.json()["logs"][0]
    assert log["changes"] == {"old": {"score": 80}, "new": {"score": 90}}
    assert log["resource_type"] == "kpi_result"
    assert log["resource_id"] == "k-1"
