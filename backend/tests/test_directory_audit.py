"""G001 갭 보강 테스트 — teams / org-groups / objections GET / audit-logs.

management-api.yaml 미구현 조회 엔드포인트 + 감사 로그 기록 검증.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import (
    AuditLog,
    ErpUser,
    KpiPeriodType,
    KpiResult,
    OrgGroup,
    OrgGroupType,
)

COMPANY_ID = 1  # 04 §2.2: INTEGER (erp_user.company_id 동일 타입)


@pytest_asyncio.fixture
async def seed_dir(db_session: AsyncSession):
    users = [
        ErpUser(id=1, company_id=1, email="employee@example.com", name="Emp", erp_team_id=10, role="employee"),
        ErpUser(id=2, company_id=1, email="leader@example.com", name="Lead", erp_team_id=10, role="leader"),
        ErpUser(id=3, company_id=1, email="admin@example.com", name="Adm", erp_team_id=20, role="admin"),
    ]
    div = OrgGroup(id=uuid4(), company_id=COMPANY_ID, name="개발본부", type=OrgGroupType.DIVISION, sort_order=1)
    dept = OrgGroup(id=uuid4(), company_id=COMPANY_ID, name="플랫폼부", type=OrgGroupType.DEPARTMENT, parent_id=div.id, sort_order=2)
    db_session.add_all([*users, div, dept])
    await db_session.flush()
    return {"div": div, "dept": dept}


@pytest.mark.asyncio
async def test_list_teams(async_client: AsyncClient, auth_headers, seed_dir):
    r = await async_client.get("/api/teams", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 2
    team10 = next(t for t in body["items"] if t["team_id"] == 10)
    assert team10["member_count"] == 2
    assert team10["leader"]["role"] == "leader"  # 팀장 감지


@pytest.mark.asyncio
async def test_list_org_groups(async_client: AsyncClient, auth_headers, seed_dir):
    r = await async_client.get("/api/org-groups", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2
    names = {g["name"] for g in body["items"]}
    assert {"개발본부", "플랫폼부"} <= names
    dept = next(g for g in body["items"] if g["name"] == "플랫폼부")
    assert dept["parent_id"] == str(seed_dir["div"].id)  # 계층 parent_id


@pytest.mark.asyncio
async def test_get_objection_none_owner(async_client: AsyncClient, auth_headers, db_session):
    kr = KpiResult(user_id=1, period_type=KpiPeriodType.QUARTERLY, period_key="2026-Q3", metric="collaboration_score", value=Decimal("50"))
    db_session.add(kr)
    await db_session.flush()
    r = await async_client.get(f"/api/kpi-results/{kr.id}/objections", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["objection_status"] == "none"


@pytest.mark.asyncio
async def test_get_objection_forbidden_other_user(async_client: AsyncClient, auth_headers, db_session):
    # employee(id=1) tries to read user 2's objection → 403
    kr = KpiResult(user_id=2, period_type=KpiPeriodType.QUARTERLY, period_key="2026-Q3", metric="quarterly_total", value=Decimal("80"))
    db_session.add(kr)
    await db_session.flush()
    r = await async_client.get(f"/api/kpi-results/{kr.id}/objections", headers=auth_headers)
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_audit_logs_admin_only(async_client: AsyncClient, auth_headers, admin_auth_headers, db_session):
    db_session.add(AuditLog(user_id=3, action="kpi_finalized", entity_type="kpi_result", entity_id="x-1"))
    await db_session.flush()
    # employee blocked
    r_emp = await async_client.get("/api/audit-logs", headers=auth_headers)
    assert r_emp.status_code == 403, r_emp.text
    # admin allowed
    r_adm = await async_client.get("/api/audit-logs", headers=admin_auth_headers)
    assert r_adm.status_code == 200, r_adm.text
    body = r_adm.json()
    assert body["total"] >= 1
    assert any(i["action"] == "kpi_finalized" for i in body["items"])
    # filter
    r_f = await async_client.get("/api/audit-logs?entity_type=kpi_result&action=kpi_finalized", headers=admin_auth_headers)
    assert r_f.status_code == 200
    assert all(i["entity_type"] == "kpi_result" for i in r_f.json()["items"])
