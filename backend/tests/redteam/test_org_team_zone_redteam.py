"""
G003 org_group / team_zone 적대적(red-team) 테스트.

목표: 정상 경로 재확인이 아니라 깨뜨리는 것. RBAC 우회, 잘못된 UUID, 잘못된
enum 값, 계층 사이클, 중복/누락 FK team_zone 생성, 크고 중첩된 JSON payload,
깊은 트리 중첩, 인젝션성 쿼리 필터를 대상으로 500/RBAC 우회/사이클 허용/트리
무한루프 여부를 검사한다.

@TASK G003 red-team
"""

from uuid import uuid4

from app.models.tables import Floor, Office


# ── 시드 헬퍼 ─────────────────────────────────────────────
async def _seed_office_floor(db_session):
    office = Office(id=uuid4(), company_id=uuid4(), name="RedTeam HQ")
    db_session.add(office)
    await db_session.flush()
    floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1F")
    db_session.add(floor)
    await db_session.commit()
    return office.id, floor.id


def _leader_headers(leader_token: str) -> dict:
    return {"Authorization": f"Bearer {leader_token}"}


async def _make_org_group(async_client, admin_auth_headers, name="RT", type_="division", parent_id=None):
    payload = {"name": name, "type": type_}
    if parent_id is not None:
        payload["parent_id"] = str(parent_id)
    r = await async_client.post("/org-groups", json=payload, headers=admin_auth_headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ── (1) RBAC: employee/leader/unauth 쓰기 차단 ─────────────
async def test_org_group_write_rbac_employee_and_leader_403(
    async_client, db_session, auth_headers, leader_token
):
    leader_headers = _leader_headers(leader_token)
    for headers in (auth_headers, leader_headers):
        r_post = await async_client.post(
            "/org-groups", json={"name": "X", "type": "division"}, headers=headers
        )
        assert r_post.status_code == 403, r_post.text

    # PUT/DELETE against a real row, still forbidden for non-admin.
    # Seed a row directly via db to avoid needing admin token here.
    from app.models.tables import OrgGroup, OrgGroupType

    row = OrgGroup(id=uuid4(), company_id=uuid4(), name="Seed", type=OrgGroupType.DIVISION)
    db_session.add(row)
    await db_session.commit()

    for headers in (auth_headers, leader_headers):
        r_put = await async_client.put(
            f"/org-groups/{row.id}", json={"name": "hacked"}, headers=headers
        )
        assert r_put.status_code == 403, r_put.text
        r_del = await async_client.delete(f"/org-groups/{row.id}", headers=headers)
        assert r_del.status_code == 403, r_del.text


async def test_org_group_write_unauthenticated_401(async_client, db_session):
    from app.models.tables import OrgGroup, OrgGroupType

    row = OrgGroup(id=uuid4(), company_id=uuid4(), name="Seed", type=OrgGroupType.DIVISION)
    db_session.add(row)
    await db_session.commit()

    r_post = await async_client.post("/org-groups", json={"name": "X", "type": "division"})
    assert r_post.status_code == 401
    r_put = await async_client.put(f"/org-groups/{row.id}", json={"name": "y"})
    assert r_put.status_code == 401
    r_del = await async_client.delete(f"/org-groups/{row.id}")
    assert r_del.status_code == 401
    r_tree = await async_client.get("/org-groups/tree")
    assert r_tree.status_code == 401


async def test_team_zone_write_rbac_employee_and_leader_403(
    async_client, db_session, auth_headers, leader_token
):
    office_id, floor_id = await _seed_office_floor(db_session)
    leader_headers = _leader_headers(leader_token)
    payload = {
        "erp_team_id": 999,
        "org_group_id": str(uuid4()),
        "office_id": str(office_id),
        "floor_id": str(floor_id),
        "zone_label": "Z",
    }
    for headers in (auth_headers, leader_headers):
        r = await async_client.post("/team-zones", json=payload, headers=headers)
        assert r.status_code == 403, r.text
        r_del = await async_client.delete(f"/team-zones/{uuid4()}", headers=headers)
        assert r_del.status_code == 403, r_del.text


async def test_team_zone_unauthenticated_401(async_client):
    r_post = await async_client.post("/team-zones", json={})
    assert r_post.status_code == 401
    r_get = await async_client.get("/team-zones")
    assert r_get.status_code == 401
    r_one = await async_client.get(f"/team-zones/{uuid4()}")
    assert r_one.status_code == 401
    r_del = await async_client.delete(f"/team-zones/{uuid4()}")
    assert r_del.status_code == 401


# ── (2) malformed/non-UUID id → 404/422, 절대 500 아님 ────
async def test_org_group_malformed_id_never_500(async_client, admin_auth_headers):
    bad_ids = ["not-a-uuid", "12345", "'; DROP TABLE org_group;--", "%20%20", "😀😀😀"]
    for bad in bad_ids:
        r_put = await async_client.put(
            f"/org-groups/{bad}", json={"name": "x"}, headers=admin_auth_headers
        )
        assert r_put.status_code in (404, 422), (bad, r_put.status_code, r_put.text)
        r_del = await async_client.delete(f"/org-groups/{bad}", headers=admin_auth_headers)
        assert r_del.status_code in (404, 422), (bad, r_del.status_code, r_del.text)


async def test_team_zone_malformed_id_never_500(async_client, admin_auth_headers):
    bad_ids = ["not-a-uuid", "12345", "'; DROP TABLE team_zone;--", "%20%20"]
    for bad in bad_ids:
        r_get = await async_client.get(f"/team-zones/{bad}", headers=admin_auth_headers)
        assert r_get.status_code in (404, 422), (bad, r_get.status_code, r_get.text)
        r_del = await async_client.delete(f"/team-zones/{bad}", headers=admin_auth_headers)
        assert r_del.status_code in (404, 422), (bad, r_del.status_code, r_del.text)


# ── (3) invalid org_group type → 400 ───────────────────────
async def test_create_org_group_invalid_type_400_variants(async_client, admin_auth_headers):
    for bad_type in ("ceo", "DIVISION", "", "division; DROP TABLE org_group;"):
        r = await async_client.post(
            "/org-groups", json={"name": "X", "type": bad_type}, headers=admin_auth_headers
        )
        assert r.status_code == 400, (bad_type, r.status_code, r.text)


# ── (4) parent_id → random nonexistent UUID → 404 ─────────
async def test_create_org_group_random_nonexistent_parent_404(async_client, admin_auth_headers):
    r = await async_client.post(
        "/org-groups",
        json={"name": "Orphan", "type": "part", "parent_id": str(uuid4())},
        headers=admin_auth_headers,
    )
    assert r.status_code == 404, r.text


# ── (5) 계층 사이클 방지: 자기참조 + 자손 사이클 ──────────
async def test_org_group_self_parent_and_descendant_cycle_400(async_client, admin_auth_headers):
    a_id = await _make_org_group(async_client, admin_auth_headers, name="A", type_="division")
    b_id = await _make_org_group(
        async_client, admin_auth_headers, name="B", type_="department", parent_id=a_id
    )

    # self-parent
    r_self = await async_client.put(
        f"/org-groups/{a_id}", json={"parent_id": a_id}, headers=admin_auth_headers
    )
    assert r_self.status_code == 400, r_self.text

    # A is parent of B; setting A.parent_id = B creates a cycle (A->B->A)
    r_cycle = await async_client.put(
        f"/org-groups/{a_id}", json={"parent_id": b_id}, headers=admin_auth_headers
    )
    assert r_cycle.status_code == 400, r_cycle.text

    # verify A's parent_id was NOT mutated by the rejected attempt
    r_tree = await async_client.get("/org-groups/tree", headers=admin_auth_headers)
    assert r_tree.status_code == 200
    roots = r_tree.json()["items"]
    root_ids = {n["id"] for n in roots}
    assert a_id in root_ids, "A must remain a root after rejected cycle update"


async def test_org_group_three_level_cycle_400(async_client, admin_auth_headers):
    # A -> B -> C ; then attempt A.parent_id = C (cycle through 2 hops)
    a_id = await _make_org_group(async_client, admin_auth_headers, name="A2", type_="division")
    b_id = await _make_org_group(
        async_client, admin_auth_headers, name="B2", type_="department", parent_id=a_id
    )
    c_id = await _make_org_group(
        async_client, admin_auth_headers, name="C2", type_="part", parent_id=b_id
    )
    r_cycle = await async_client.put(
        f"/org-groups/{a_id}", json={"parent_id": c_id}, headers=admin_auth_headers
    )
    assert r_cycle.status_code == 400, r_cycle.text


# ── (6) sync-teams idempotency + RBAC ──────────────────────
async def test_sync_teams_double_call_no_duplicate_leaves(async_client, admin_auth_headers):
    r1 = await async_client.post("/org-groups/sync-teams", headers=admin_auth_headers)
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    total_after_first = body1["created"] + body1["existing"]

    r2 = await async_client.post("/org-groups/sync-teams", headers=admin_auth_headers)
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["created"] == 0, "second sync-teams call must not create new leaves"
    assert body2["existing"] == total_after_first

    r3 = await async_client.post("/org-groups/sync-teams", headers=admin_auth_headers)
    body3 = r3.json()
    assert body3["created"] == 0
    assert body3["existing"] == total_after_first

    # confirm no duplicate PART rows with same name exist in the tree
    r_tree = await async_client.get("/org-groups/tree", headers=admin_auth_headers)
    names = [n["name"] for n in r_tree.json()["items"]]
    assert len(names) == len(set(names)), f"duplicate leaf org_group names after repeated sync: {names}"


async def test_sync_teams_employee_and_leader_403(async_client, auth_headers, leader_token):
    r_emp = await async_client.post("/org-groups/sync-teams", headers=auth_headers)
    assert r_emp.status_code == 403, r_emp.text
    r_leader = await async_client.post(
        "/org-groups/sync-teams", headers=_leader_headers(leader_token)
    )
    assert r_leader.status_code == 403, r_leader.text


# ── (7) team_zone 중복 → 409 not 500 ───────────────────────
async def test_team_zone_duplicate_erp_team_office_floor_409(
    async_client, db_session, admin_auth_headers
):
    office_id, floor_id = await _seed_office_floor(db_session)
    org_group_id = await _make_org_group(async_client, admin_auth_headers, name="TZ-Org")
    payload = {
        "erp_team_id": 4242,
        "org_group_id": org_group_id,
        "office_id": str(office_id),
        "floor_id": str(floor_id),
        "zone_label": "Zone1",
    }
    r1 = await async_client.post("/team-zones", json=payload, headers=admin_auth_headers)
    assert r1.status_code == 201, r1.text

    # exact duplicate
    r2 = await async_client.post("/team-zones", json=payload, headers=admin_auth_headers)
    assert r2.status_code == 409, r2.text

    # duplicate but different zone_label/color still collides on the unique triple
    payload_variant = {**payload, "zone_label": "DifferentLabel", "color": "#abcdef"}
    r3 = await async_client.post("/team-zones", json=payload_variant, headers=admin_auth_headers)
    assert r3.status_code == 409, r3.text

    # verify only one row actually exists (no partial insert/corruption)
    r_list = await async_client.get(
        "/team-zones", params={"erp_team_id": 4242}, headers=admin_auth_headers
    )
    assert r_list.json()["total"] == 1, r_list.text


# ── (8) team_zone with missing FK → 404 each ──────────────
async def test_team_zone_each_missing_fk_returns_404(async_client, db_session, admin_auth_headers):
    office_id, floor_id = await _seed_office_floor(db_session)
    org_group_id = await _make_org_group(async_client, admin_auth_headers, name="TZ-Org2")

    r_missing_org = await async_client.post(
        "/team-zones",
        json={
            "erp_team_id": 1,
            "org_group_id": str(uuid4()),
            "office_id": str(office_id),
            "floor_id": str(floor_id),
            "zone_label": "Z",
        },
        headers=admin_auth_headers,
    )
    assert r_missing_org.status_code == 404, r_missing_org.text
    assert r_missing_org.json()["detail"] == "org_group_not_found"

    r_missing_office = await async_client.post(
        "/team-zones",
        json={
            "erp_team_id": 2,
            "org_group_id": org_group_id,
            "office_id": str(uuid4()),
            "floor_id": str(floor_id),
            "zone_label": "Z",
        },
        headers=admin_auth_headers,
    )
    assert r_missing_office.status_code == 404, r_missing_office.text
    assert r_missing_office.json()["detail"] == "office_not_found"

    r_missing_floor = await async_client.post(
        "/team-zones",
        json={
            "erp_team_id": 3,
            "org_group_id": org_group_id,
            "office_id": str(office_id),
            "floor_id": str(uuid4()),
            "zone_label": "Z",
        },
        headers=admin_auth_headers,
    )
    assert r_missing_floor.status_code == 404, r_missing_floor.text
    assert r_missing_floor.json()["detail"] == "floor_not_found"


# ── (9) 크고 중첩된 polygon JSON → 저장 또는 거부, 500 아님 ─
async def test_team_zone_large_nested_polygon_no_500(async_client, db_session, admin_auth_headers):
    office_id, floor_id = await _seed_office_floor(db_session)
    org_group_id = await _make_org_group(async_client, admin_auth_headers, name="TZ-Poly")

    # deeply nested dict (100 levels)
    nested = {}
    cursor = nested
    for i in range(100):
        cursor["child"] = {}
        cursor = cursor["child"]
    cursor["leaf"] = True

    r_nested = await async_client.post(
        "/team-zones",
        json={
            "erp_team_id": 5001,
            "org_group_id": org_group_id,
            "office_id": str(office_id),
            "floor_id": str(floor_id),
            "zone_label": "DeepNest",
            "polygon": nested,
        },
        headers=admin_auth_headers,
    )
    assert r_nested.status_code in (201, 400, 413, 422), r_nested.text

    # large flat array of points
    big_points = {"points": [[float(i), float(i * 2)] for i in range(20000)]}
    r_large = await async_client.post(
        "/team-zones",
        json={
            "erp_team_id": 5002,
            "org_group_id": org_group_id,
            "office_id": str(office_id),
            "floor_id": str(floor_id),
            "zone_label": "BigPoly",
            "polygon": big_points,
        },
        headers=admin_auth_headers,
    )
    assert r_large.status_code in (201, 400, 413, 422), r_large.text
    if r_large.status_code == 201:
        r_get = await async_client.get(
            f"/team-zones/{r_large.json()['id']}", headers=admin_auth_headers
        )
        assert r_get.status_code == 200
        assert len(r_get.json()["polygon"]["points"]) == 20000


# ── (10) 깊은 트리(5+ 단계) 정확한 중첩, 무한루프 없음 ────
async def test_org_group_deep_chain_tree_correct_nesting(async_client, admin_auth_headers):
    ids = []
    parent = None
    for i in range(7):
        gid = await _make_org_group(
            async_client, admin_auth_headers, name=f"Deep{i}", type_="part", parent_id=parent
        )
        ids.append(gid)
        parent = gid

    r_tree = await async_client.get("/org-groups/tree", headers=admin_auth_headers)
    assert r_tree.status_code == 200
    roots = r_tree.json()["items"]
    root = next(n for n in roots if n["id"] == ids[0])

    # walk down exactly 7 levels, verify id ordering and no extra branching
    node = root
    for depth in range(7):
        assert node["id"] == ids[depth], f"depth {depth} mismatch"
        if depth < 6:
            assert len(node["children"]) == 1, f"depth {depth} expected exactly 1 child"
            node = node["children"][0]
        else:
            assert node["children"] == []


# ── (11) team-zones 필터 인젝션성 값 → 500 아님 ───────────
async def test_team_zone_list_filter_injection_like_values_no_500(
    async_client, admin_auth_headers
):
    bad_values = {
        "org_group_id": "'; DROP TABLE team_zone;--",
        "office_id": "1 OR 1=1",
        "floor_id": "<script>alert(1)</script>",
    }
    for key, val in bad_values.items():
        r = await async_client.get(
            "/team-zones", params={key: val}, headers=admin_auth_headers
        )
        assert r.status_code == 422, (key, val, r.status_code, r.text)

    r_bad_erp = await async_client.get(
        "/team-zones", params={"erp_team_id": "not-an-int"}, headers=admin_auth_headers
    )
    assert r_bad_erp.status_code == 422, r_bad_erp.text

    # combination of all filters at once with valid-shaped but nonexistent UUIDs
    r_combo = await async_client.get(
        "/team-zones",
        params={
            "org_group_id": str(uuid4()),
            "office_id": str(uuid4()),
            "floor_id": str(uuid4()),
            "erp_team_id": 999999999,
        },
        headers=admin_auth_headers,
    )
    assert r_combo.status_code == 200
    assert r_combo.json()["items"] == []
