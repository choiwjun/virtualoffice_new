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
