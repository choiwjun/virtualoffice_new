"""
G003 - org_group 계층 CRUD + team_zone 매핑 API 테스트.

@TASK P2-R1-T3 (org_group), P2-R2-T1 (team_zone)
"""

from uuid import uuid4

from app.models.tables import Floor, Office


# ── 시드 헬퍼 ─────────────────────────────────────────────
async def _seed_office_floor(db_session):
    office = Office(id=uuid4(), company_id=uuid4(), name="G003 HQ")
    db_session.add(office)
    await db_session.flush()
    floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1F")
    db_session.add(floor)
    await db_session.commit()
    return office.id, floor.id


# ── org_group: 생성 ───────────────────────────────────────
async def test_create_org_group_admin_ok(async_client, db_session, admin_auth_headers):
    r = await async_client.post(
        "/org-groups", json={"name": "본부A", "type": "division"}, headers=admin_auth_headers
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "본부A"
    assert body["type"] == "division"
    assert body["parent_id"] is None
    assert isinstance(body["id"], str)
    assert isinstance(body["company_id"], str)


async def test_create_org_group_employee_forbidden(async_client, auth_headers):
    r = await async_client.post(
        "/org-groups", json={"name": "본부B", "type": "division"}, headers=auth_headers
    )
    assert r.status_code == 403, r.text


async def test_create_org_group_invalid_type_400(async_client, admin_auth_headers):
    r = await async_client.post(
        "/org-groups", json={"name": "X", "type": "not_a_type"}, headers=admin_auth_headers
    )
    assert r.status_code == 400, r.text


async def test_create_org_group_missing_parent_404(async_client, admin_auth_headers):
    r = await async_client.post(
        "/org-groups",
        json={"name": "부서A", "type": "department", "parent_id": str(uuid4())},
        headers=admin_auth_headers,
    )
    assert r.status_code == 404, r.text


# ── org_group: 트리 ───────────────────────────────────────
async def test_org_group_tree_nesting(async_client, admin_auth_headers):
    r_parent = await async_client.post(
        "/org-groups", json={"name": "본부트리", "type": "division"}, headers=admin_auth_headers
    )
    assert r_parent.status_code == 201, r_parent.text
    parent_id = r_parent.json()["id"]

    r_child = await async_client.post(
        "/org-groups",
        json={"name": "부서트리", "type": "department", "parent_id": parent_id},
        headers=admin_auth_headers,
    )
    assert r_child.status_code == 201, r_child.text
    child_id = r_child.json()["id"]

    r_tree = await async_client.get("/org-groups/tree", headers=admin_auth_headers)
    assert r_tree.status_code == 200, r_tree.text
    items = r_tree.json()["items"]
    parent_node = next(n for n in items if n["id"] == parent_id)
    assert any(c["id"] == child_id for c in parent_node["children"])


# ── org_group: 수정/삭제 ──────────────────────────────────
async def test_org_group_update_and_delete(async_client, admin_auth_headers):
    r_create = await async_client.post(
        "/org-groups", json={"name": "수정전", "type": "division"}, headers=admin_auth_headers
    )
    org_id = r_create.json()["id"]

    r_update = await async_client.put(
        f"/org-groups/{org_id}",
        json={"name": "수정후", "color": "#123456"},
        headers=admin_auth_headers,
    )
    assert r_update.status_code == 200, r_update.text
    assert r_update.json()["name"] == "수정후"
    assert r_update.json()["color"] == "#123456"

    r_update_404 = await async_client.put(
        f"/org-groups/{uuid4()}", json={"name": "no"}, headers=admin_auth_headers
    )
    assert r_update_404.status_code == 404

    r_delete = await async_client.delete(f"/org-groups/{org_id}", headers=admin_auth_headers)
    assert r_delete.status_code == 200, r_delete.text

    r_delete_404 = await async_client.delete(f"/org-groups/{uuid4()}", headers=admin_auth_headers)
    assert r_delete_404.status_code == 404


async def test_org_group_delete_orphans_children_via_set_null(
    async_client, admin_auth_headers
):
    r_parent = await async_client.post(
        "/org-groups", json={"name": "부모SN", "type": "division"}, headers=admin_auth_headers
    )
    parent_id = r_parent.json()["id"]
    r_child = await async_client.post(
        "/org-groups",
        json={"name": "자식SN", "type": "department", "parent_id": parent_id},
        headers=admin_auth_headers,
    )
    child_id = r_child.json()["id"]

    r_delete = await async_client.delete(f"/org-groups/{parent_id}", headers=admin_auth_headers)
    assert r_delete.status_code == 200

    r_tree = await async_client.get("/org-groups/tree", headers=admin_auth_headers)
    items = r_tree.json()["items"]
    # 자식은 이제 parent_id=NULL이 되어 루트 목록에 나타난다.
    assert any(n["id"] == child_id for n in items)


async def test_org_group_self_parent_400(async_client, admin_auth_headers):
    r_create = await async_client.post(
        "/org-groups", json={"name": "셀프", "type": "part"}, headers=admin_auth_headers
    )
    org_id = r_create.json()["id"]
    r_update = await async_client.put(
        f"/org-groups/{org_id}", json={"parent_id": org_id}, headers=admin_auth_headers
    )
    assert r_update.status_code == 400, r_update.text


# ── org_group: sync-teams (honest ERP sync) ──────────────
async def test_sync_teams_creates_leaf_per_erp_team_and_is_idempotent(
    async_client, admin_auth_headers
):
    r1 = await async_client.post("/org-groups/sync-teams", headers=admin_auth_headers)
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["created"] == 2  # MockErpReader 고정 팀 2개(개발팀/디자인팀)
    assert body1["existing"] == 0

    r_tree = await async_client.get("/org-groups/tree", headers=admin_auth_headers)
    names = {n["name"] for n in r_tree.json()["items"]}
    assert "개발팀" in names
    assert "디자인팀" in names

    r2 = await async_client.post("/org-groups/sync-teams", headers=admin_auth_headers)
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["created"] == 0
    assert body2["existing"] == 2


async def test_sync_teams_employee_forbidden(async_client, auth_headers):
    r = await async_client.post("/org-groups/sync-teams", headers=auth_headers)
    assert r.status_code == 403, r.text


# ── team_zone: 생성/중복/404 ──────────────────────────────
async def test_team_zone_create_and_duplicate_409(
    async_client, db_session, admin_auth_headers
):
    office_id, floor_id = await _seed_office_floor(db_session)
    r_org = await async_client.post(
        "/org-groups", json={"name": "팀존조직", "type": "part"}, headers=admin_auth_headers
    )
    org_group_id = r_org.json()["id"]

    payload = {
        "erp_team_id": 1,
        "org_group_id": org_group_id,
        "office_id": str(office_id),
        "floor_id": str(floor_id),
        "zone_label": "A구역",
        "color": "#ff0000",
    }
    r_create = await async_client.post("/team-zones", json=payload, headers=admin_auth_headers)
    assert r_create.status_code == 201, r_create.text
    tz = r_create.json()
    assert tz["zone_label"] == "A구역"
    assert isinstance(tz["id"], str)

    r_dup = await async_client.post("/team-zones", json=payload, headers=admin_auth_headers)
    assert r_dup.status_code == 409, r_dup.text

    return tz["id"], org_group_id, office_id, floor_id


async def test_team_zone_missing_org_group_office_floor_404(
    async_client, db_session, admin_auth_headers
):
    office_id, floor_id = await _seed_office_floor(db_session)
    r_org = await async_client.post(
        "/org-groups", json={"name": "팀존조직404", "type": "part"}, headers=admin_auth_headers
    )
    org_group_id = r_org.json()["id"]

    r_missing_org = await async_client.post(
        "/team-zones",
        json={
            "erp_team_id": 2,
            "org_group_id": str(uuid4()),
            "office_id": str(office_id),
            "floor_id": str(floor_id),
            "zone_label": "B구역",
        },
        headers=admin_auth_headers,
    )
    assert r_missing_org.status_code == 404

    r_missing_office = await async_client.post(
        "/team-zones",
        json={
            "erp_team_id": 2,
            "org_group_id": org_group_id,
            "office_id": str(uuid4()),
            "floor_id": str(floor_id),
            "zone_label": "B구역",
        },
        headers=admin_auth_headers,
    )
    assert r_missing_office.status_code == 404

    r_missing_floor = await async_client.post(
        "/team-zones",
        json={
            "erp_team_id": 2,
            "org_group_id": org_group_id,
            "office_id": str(office_id),
            "floor_id": str(uuid4()),
            "zone_label": "B구역",
        },
        headers=admin_auth_headers,
    )
    assert r_missing_floor.status_code == 404


# ── team_zone: 목록 필터/단건/삭제 ────────────────────────
async def test_team_zone_list_filters_get_and_delete(
    async_client, db_session, admin_auth_headers
):
    office_id, floor_id = await _seed_office_floor(db_session)
    r_org = await async_client.post(
        "/org-groups", json={"name": "팀존필터", "type": "part"}, headers=admin_auth_headers
    )
    org_group_id = r_org.json()["id"]

    r_create = await async_client.post(
        "/team-zones",
        json={
            "erp_team_id": 5,
            "org_group_id": org_group_id,
            "office_id": str(office_id),
            "floor_id": str(floor_id),
            "zone_label": "C구역",
        },
        headers=admin_auth_headers,
    )
    assert r_create.status_code == 201, r_create.text
    tz_id = r_create.json()["id"]

    r_list_all = await async_client.get("/team-zones", headers=admin_auth_headers)
    assert r_list_all.status_code == 200
    assert any(item["id"] == tz_id for item in r_list_all.json()["items"])

    r_list_filtered = await async_client.get(
        "/team-zones", params={"erp_team_id": 5}, headers=admin_auth_headers
    )
    assert all(item["erp_team_id"] == 5 for item in r_list_filtered.json()["items"])
    assert len(r_list_filtered.json()["items"]) == 1

    r_list_no_match = await async_client.get(
        "/team-zones", params={"erp_team_id": 999}, headers=admin_auth_headers
    )
    assert r_list_no_match.json()["items"] == []

    r_get = await async_client.get(f"/team-zones/{tz_id}", headers=admin_auth_headers)
    assert r_get.status_code == 200
    assert r_get.json()["id"] == tz_id

    r_get_404 = await async_client.get(f"/team-zones/{uuid4()}", headers=admin_auth_headers)
    assert r_get_404.status_code == 404

    r_delete = await async_client.delete(f"/team-zones/{tz_id}", headers=admin_auth_headers)
    assert r_delete.status_code == 200

    r_delete_404 = await async_client.delete(f"/team-zones/{tz_id}", headers=admin_auth_headers)
    assert r_delete_404.status_code == 404


# ── 인증/인가 ─────────────────────────────────────────────
async def test_unauthenticated_rejected_on_writes(async_client, db_session):
    office_id, floor_id = await _seed_office_floor(db_session)
    r_org_create = await async_client.post("/org-groups", json={"name": "무인증", "type": "part"})
    assert r_org_create.status_code == 401

    r_sync = await async_client.post("/org-groups/sync-teams")
    assert r_sync.status_code == 401

    r_tz_create = await async_client.post(
        "/team-zones",
        json={
            "erp_team_id": 1,
            "org_group_id": str(uuid4()),
            "office_id": str(office_id),
            "floor_id": str(floor_id),
            "zone_label": "D구역",
        },
    )
    assert r_tz_create.status_code == 401

    r_tz_delete = await async_client.delete(f"/team-zones/{uuid4()}")
    assert r_tz_delete.status_code == 401

    r_org_update = await async_client.put(f"/org-groups/{uuid4()}", json={"name": "x"})
    assert r_org_update.status_code == 401

    r_org_delete = await async_client.delete(f"/org-groups/{uuid4()}")
    assert r_org_delete.status_code == 401


async def test_team_zone_write_employee_forbidden(async_client, db_session, auth_headers):
    office_id, floor_id = await _seed_office_floor(db_session)
    r = await async_client.post(
        "/team-zones",
        json={
            "erp_team_id": 1,
            "org_group_id": str(uuid4()),
            "office_id": str(office_id),
            "floor_id": str(floor_id),
            "zone_label": "E구역",
        },
        headers=auth_headers,
    )
    assert r.status_code == 403, r.text
