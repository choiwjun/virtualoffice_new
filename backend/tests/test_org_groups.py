"""org_group CRUD·검증·배포 테스트 (REQ-011, org-chart-editor)."""

import pytest


@pytest.mark.asyncio
async def test_org_group_crud(async_client, admin_auth_headers):
    # create division
    r = await async_client.post("/api/org-groups", headers=admin_auth_headers, json={"name": "개발본부", "type": "division", "color": "#3498db"})
    assert r.status_code == 201, r.text
    div = r.json()
    assert div["type"] == "division"
    # create department under division
    r2 = await async_client.post("/api/org-groups", headers=admin_auth_headers, json={"name": "플랫폼팀", "type": "department", "parent_id": div["id"]})
    assert r2.status_code == 201, r2.text
    dept = r2.json()
    assert dept["parent_id"] == div["id"]
    # update
    r3 = await async_client.put(f"/api/org-groups/{dept['id']}", headers=admin_auth_headers, json={"name": "플랫폼개발팀"})
    assert r3.status_code == 200 and r3.json()["name"] == "플랫폼개발팀"
    # delete child first (parent has child → 409)
    rdel = await async_client.delete(f"/api/org-groups/{div['id']}", headers=admin_auth_headers)
    assert rdel.status_code == 409
    await async_client.delete(f"/api/org-groups/{dept['id']}", headers=admin_auth_headers)
    rdel2 = await async_client.delete(f"/api/org-groups/{div['id']}", headers=admin_auth_headers)
    assert rdel2.status_code == 204


@pytest.mark.asyncio
async def test_org_validate_and_deploy_clean(async_client, admin_auth_headers):
    await async_client.post("/api/org-groups", headers=admin_auth_headers, json={"name": "본부A", "type": "division"})
    v = await async_client.post("/api/org-groups/validate", headers=admin_auth_headers)
    assert v.status_code == 200 and v.json()["valid"] is True
    d = await async_client.post("/api/org-groups/deploy", headers=admin_auth_headers)
    assert d.status_code == 200 and d.json()["valid"] is True


@pytest.mark.asyncio
async def test_org_self_parent_rejected(async_client, admin_auth_headers):
    r = await async_client.post("/api/org-groups", headers=admin_auth_headers, json={"name": "본부B", "type": "division"})
    gid = r.json()["id"]
    r2 = await async_client.put(f"/api/org-groups/{gid}", headers=admin_auth_headers, json={"parent_id": gid})
    assert r2.status_code == 400


@pytest.mark.asyncio
async def test_org_crud_requires_admin(async_client, auth_headers):
    r = await async_client.post("/api/org-groups", headers=auth_headers, json={"name": "x", "type": "part"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_org_invalid_type(async_client, admin_auth_headers):
    r = await async_client.post("/api/org-groups", headers=admin_auth_headers, json={"name": "x", "type": "bogus"})
    assert r.status_code == 400


# ── erp_team_id 매핑 — 팀 이름의 정본 ──────────────────────────────────
@pytest.mark.asyncio
async def test_org_group_carries_team_mapping(async_client, admin_auth_headers):
    """생성·수정·조회에서 erp_team_id가 왕복한다."""
    r = await async_client.post(
        "/api/org-groups", headers=admin_auth_headers,
        json={"name": "데이터팀", "type": "department", "erp_team_id": 3},
    )
    assert r.status_code == 201, r.text
    gid = r.json()["id"]
    assert r.json()["erp_team_id"] == 3

    lst = await async_client.get("/api/org-groups", headers=admin_auth_headers)
    got = next(g for g in lst.json()["items"] if g["id"] == gid)
    assert got["erp_team_id"] == 3

    r2 = await async_client.put(
        f"/api/org-groups/{gid}", headers=admin_auth_headers, json={"erp_team_id": 7}
    )
    assert r2.status_code == 200 and r2.json()["erp_team_id"] == 7


@pytest.mark.asyncio
async def test_org_group_unlink_team_with_sentinel(async_client, admin_auth_headers):
    """-1이 연결 해제다. null은 "안 건드림"이라 해제를 표현할 수 없다."""
    r = await async_client.post(
        "/api/org-groups", headers=admin_auth_headers,
        json={"name": "품질팀", "type": "department", "erp_team_id": 4},
    )
    gid = r.json()["id"]

    # 이름만 바꾸는 요청이 연결을 지우면 안 된다.
    keep = await async_client.put(
        f"/api/org-groups/{gid}", headers=admin_auth_headers, json={"name": "QA팀"}
    )
    assert keep.json()["erp_team_id"] == 4, "다른 필드 수정이 매핑을 날렸다"

    off = await async_client.put(
        f"/api/org-groups/{gid}", headers=admin_auth_headers, json={"erp_team_id": -1}
    )
    assert off.status_code == 200 and off.json()["erp_team_id"] is None


@pytest.mark.asyncio
async def test_org_group_duplicate_team_is_409(async_client, admin_auth_headers):
    """한 팀을 두 그룹이 주장하면 이름이 조회 순서로 갈린다 — 어느 그룹인지까지 알려준다."""
    await async_client.post(
        "/api/org-groups", headers=admin_auth_headers,
        json={"name": "플랫폼개발팀", "type": "department", "erp_team_id": 1},
    )
    dup = await async_client.post(
        "/api/org-groups", headers=admin_auth_headers,
        json={"name": "디자인실", "type": "division", "erp_team_id": 1},
    )
    assert dup.status_code == 409, dup.text
    assert dup.json()["detail"]["group_name"] == "플랫폼개발팀"

    other = await async_client.post(
        "/api/org-groups", headers=admin_auth_headers,
        json={"name": "인사팀", "type": "department"},
    )
    move = await async_client.put(
        f"/api/org-groups/{other.json()['id']}", headers=admin_auth_headers,
        json={"erp_team_id": 1},
    )
    assert move.status_code == 409, "수정 경로에도 같은 가드가 있어야 한다"


@pytest.mark.asyncio
async def test_org_group_keeps_own_team_on_self_update(async_client, admin_auth_headers):
    """자기 자신이 이미 쓰는 번호를 다시 저장해도 409가 아니다(편집기 반복 저장)."""
    r = await async_client.post(
        "/api/org-groups", headers=admin_auth_headers,
        json={"name": "영업팀", "type": "department", "erp_team_id": 5},
    )
    gid = r.json()["id"]
    again = await async_client.put(
        f"/api/org-groups/{gid}", headers=admin_auth_headers,
        json={"name": "영업팀", "erp_team_id": 5},
    )
    assert again.status_code == 200, again.text


@pytest.mark.asyncio
async def test_org_group_rejects_team_zero(async_client, admin_auth_headers):
    """0은 "팀 미배정" 센티널이다 — 그룹이 맡으면 소속 없는 사람 전원이 그 이름으로 뭉친다."""
    r = await async_client.post(
        "/api/org-groups", headers=admin_auth_headers,
        json={"name": "경영지원본부", "type": "division", "erp_team_id": 0},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "team_zero_reserved"

    ok = await async_client.post(
        "/api/org-groups", headers=admin_auth_headers,
        json={"name": "경영지원본부", "type": "division"},
    )
    moved = await async_client.put(
        f"/api/org-groups/{ok.json()['id']}", headers=admin_auth_headers,
        json={"erp_team_id": 0},
    )
    assert moved.status_code == 400, "수정 경로에도 같은 가드가 있어야 한다"


@pytest.mark.asyncio
async def test_org_group_many_unmapped_layers_coexist(async_client, admin_auth_headers):
    """팀이 아닌 계층(본부·파트)은 여럿이 공존해야 한다 — NULL을 유니크가 막으면 안 된다."""
    for name in ("경영지원본부", "기술본부", "사업본부"):
        r = await async_client.post(
            "/api/org-groups", headers=admin_auth_headers, json={"name": name, "type": "division"}
        )
        assert r.status_code == 201, r.text
