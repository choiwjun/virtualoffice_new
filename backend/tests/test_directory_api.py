"""
G002 디렉터리 API 테스트: 직원 RBAC 필터 + /api/teams + /api/org-groups.

계약 스텁이 없는 그룹(직원/팀/조직) → 전용 테스트. 미러 테이블(erp_user/org_group)
+ mock reader(teams read-through) 기반. RBAC 매트릭스 정본: management-api.yaml /users.
"""

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import ErpRole, ErpUser, OrgGroup, OrgGroupType


async def _seed_users(db: AsyncSession) -> None:
    db.add_all(
        [
            ErpUser(id=1, company_id=1, email="u1@example.com", name="U1",
                    erp_team_id=1, role=ErpRole.EMPLOYEE),
            ErpUser(id=2, company_id=1, email="u2@example.com", name="U2",
                    erp_team_id=1, role=ErpRole.LEADER),
            ErpUser(id=3, company_id=1, email="u3@example.com", name="U3",
                    erp_team_id=1, role=ErpRole.EMPLOYEE),
            ErpUser(id=4, company_id=1, email="u4@example.com", name="U4",
                    erp_team_id=2, role=ErpRole.EMPLOYEE),
        ]
    )
    await db.commit()


# ── RBAC 직원 조회 (management-api.yaml /users) ────────────
async def test_employee_sees_only_self(async_client, db_session, auth_headers):
    await _seed_users(db_session)
    r = await async_client.get("/api/employees", headers=auth_headers)  # employee sub=1
    assert r.status_code == 200
    assert [e["id"] for e in r.json()["items"]] == [1]


async def test_leader_sees_own_team(async_client, db_session, leader_token):
    await _seed_users(db_session)
    r = await async_client.get(
        "/api/employees", headers={"Authorization": f"Bearer {leader_token}"}
    )  # leader team_id=1
    assert r.status_code == 200
    assert sorted(e["id"] for e in r.json()["items"]) == [1, 2, 3]


async def test_admin_sees_all(async_client, db_session, admin_auth_headers):
    await _seed_users(db_session)
    r = await async_client.get("/api/employees", headers=admin_auth_headers)
    assert r.status_code == 200
    assert sorted(e["id"] for e in r.json()["items"]) == [1, 2, 3, 4]


async def test_employees_requires_auth(async_client):
    assert (await async_client.get("/api/employees")).status_code == 401


# ── 팀 조회 (read-through, mock reader) ────────────────────
async def test_list_teams(async_client, auth_headers):
    r = await async_client.get("/api/teams", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert {t["name"] for t in body["items"]} == {"개발팀", "디자인팀"}


async def test_teams_pagination(async_client, auth_headers):
    r = await async_client.get("/api/teams?limit=1&offset=0", headers=auth_headers)
    body = r.json()
    assert len(body["items"]) == 1 and body["total"] == 2


async def test_teams_requires_auth(async_client):
    assert (await async_client.get("/api/teams")).status_code == 401


# ── 조직도 계층 조회 ──────────────────────────────────────
async def test_list_org_groups_hierarchy(async_client, db_session, auth_headers):
    company = uuid4()
    root = OrgGroup(company_id=company, name="본부", type=OrgGroupType.DIVISION, sort_order=1)
    db_session.add(root)
    await db_session.flush()
    child = OrgGroup(
        company_id=company, name="개발부", type=OrgGroupType.DEPARTMENT,
        parent_id=root.id, sort_order=2,
    )
    db_session.add(child)
    await db_session.commit()

    r = await async_client.get("/api/org-groups", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    by_name = {g["name"]: g for g in body["items"]}
    assert by_name["개발부"]["parent_id"] == str(root.id)
    assert by_name["본부"]["parent_id"] is None
    assert by_name["본부"]["type"] == "division"


async def test_org_groups_requires_auth(async_client):
    assert (await async_client.get("/api/org-groups")).status_code == 401


# ── 상세 조회 RBAC (get_employee) ─────────────────────────
async def test_employee_can_get_self_detail(async_client, db_session, auth_headers):
    await _seed_users(db_session)
    r = await async_client.get("/api/employees/1", headers=auth_headers)
    assert r.status_code == 200 and r.json()["id"] == 1


async def test_employee_cannot_get_other_detail(async_client, db_session, auth_headers):
    await _seed_users(db_session)
    r = await async_client.get("/api/employees/2", headers=auth_headers)
    assert r.status_code == 404


async def test_admin_can_get_any_detail(async_client, db_session, admin_auth_headers):
    await _seed_users(db_session)
    r = await async_client.get("/api/employees/2", headers=admin_auth_headers)
    assert r.status_code == 200 and r.json()["id"] == 2
