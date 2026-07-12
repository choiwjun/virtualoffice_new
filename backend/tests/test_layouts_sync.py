"""G003 — 오피스 레이아웃 검증/배포(D12) + ERP 동기화 로그 테스트."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import ErpSyncLog, OfficeLayout, OfficeLayoutStatus

OFFICE_ID = uuid4()
FLOOR_ID = uuid4()

MINIMAL_LAYOUT = {"version": "1.0", "name": "test"}  # 스키마 미충족 → 검증 ERROR 발생


# ── 오피스 레이아웃 ────────────────────────────────────────
@pytest.mark.asyncio
async def test_layout_create_list_get(async_client: AsyncClient, admin_auth_headers):
    r = await async_client.post("/api/office-layouts", headers=admin_auth_headers, json={"office_id": str(OFFICE_ID), "floor_id": str(FLOOR_ID), "json": MINIMAL_LAYOUT})
    assert r.status_code == 201, r.text
    lid = r.json()["id"]
    assert r.json()["status"] == "draft" and r.json()["version"] == 1
    lst = await async_client.get("/api/office-layouts", headers=admin_auth_headers)
    assert lst.status_code == 200 and any(x["id"] == lid for x in lst.json())
    one = await async_client.get(f"/api/office-layouts/{lid}", headers=admin_auth_headers)
    assert one.status_code == 200 and one.json()["id"] == lid


@pytest.mark.asyncio
async def test_layout_validate_blocks_on_errors(async_client: AsyncClient, admin_auth_headers):
    r = await async_client.post("/api/office-layouts", headers=admin_auth_headers, json={"office_id": str(OFFICE_ID), "floor_id": str(FLOOR_ID), "json": MINIMAL_LAYOUT})
    lid = r.json()["id"]
    v = await async_client.post(f"/api/office-layouts/{lid}/validate", headers=admin_auth_headers)
    assert v.status_code == 200, v.text
    # D12: 스키마 미충족 레이아웃 → ERROR 존재 → draft 유지
    assert v.json()["error_count"] > 0
    assert v.json()["status"] == "draft"


@pytest.mark.asyncio
async def test_layout_deploy_requires_validated(async_client: AsyncClient, admin_auth_headers):
    r = await async_client.post("/api/office-layouts", headers=admin_auth_headers, json={"office_id": str(OFFICE_ID), "floor_id": str(FLOOR_ID), "json": MINIMAL_LAYOUT})
    lid = r.json()["id"]
    d = await async_client.post(f"/api/office-layouts/{lid}/deploy", headers=admin_auth_headers)
    assert d.status_code == 409, d.text  # D12: validated 아니면 배포 차단


@pytest.mark.asyncio
async def test_layout_deploy_and_rollback(async_client: AsyncClient, admin_auth_headers, db_session: AsyncSession):
    fl = uuid4()
    v1 = OfficeLayout(office_id=OFFICE_ID, floor_id=fl, version=1, status=OfficeLayoutStatus.VALIDATED, json=MINIMAL_LAYOUT)
    v2 = OfficeLayout(office_id=OFFICE_ID, floor_id=fl, version=2, status=OfficeLayoutStatus.VALIDATED, json=MINIMAL_LAYOUT)
    db_session.add_all([v1, v2])
    await db_session.flush()
    # deploy v1
    d1 = await async_client.post(f"/api/office-layouts/{v1.id}/deploy", headers=admin_auth_headers)
    assert d1.status_code == 200 and d1.json()["status"] == "deployed"
    # deploy v2 → v1 archived
    d2 = await async_client.post(f"/api/office-layouts/{v2.id}/deploy", headers=admin_auth_headers)
    assert d2.status_code == 200 and d2.json()["status"] == "deployed"
    # rollback v2 → v1 다시 deployed
    rb = await async_client.post(f"/api/office-layouts/{v2.id}/rollback", headers=admin_auth_headers)
    assert rb.status_code == 200, rb.text
    assert rb.json()["id"] == str(v1.id) and rb.json()["status"] == "deployed"


@pytest.mark.asyncio
async def test_layout_rbac(async_client: AsyncClient, auth_headers):
    r = await async_client.post("/api/office-layouts", headers=auth_headers, json={"office_id": str(OFFICE_ID), "floor_id": str(FLOOR_ID), "json": MINIMAL_LAYOUT})
    assert r.status_code == 403, r.text


# ── ERP 동기화 로그 ───────────────────────────────────────
@pytest_asyncio.fixture
async def seed_sync_logs(db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    ok = ErpSyncLog(started_at=now, finished_at=now, created=2, updated=1, deactivated=0, status="success", trigger="manual")
    bad = ErpSyncLog(started_at=now, finished_at=now, status="failed", trigger="manual", error="connection refused")
    db_session.add_all([ok, bad])
    await db_session.flush()


@pytest.mark.asyncio
async def test_erp_sync_status(async_client: AsyncClient, admin_auth_headers, seed_sync_logs):
    r = await async_client.get("/api/erp-sync/status", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_runs"] == 2 and body["failure_count"] == 1
    assert body["last_run"] is not None


@pytest.mark.asyncio
async def test_erp_sync_failures(async_client: AsyncClient, admin_auth_headers, seed_sync_logs):
    r = await async_client.get("/api/erp-sync/failures", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1 and r.json()[0]["status"] == "failed"


@pytest.mark.asyncio
async def test_erp_sync_status_rbac(async_client: AsyncClient, auth_headers):
    r = await async_client.get("/api/erp-sync/status", headers=auth_headers)
    assert r.status_code == 403, r.text
