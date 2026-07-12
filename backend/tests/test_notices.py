"""공지사항 API 테스트 (14-virtual-office-spec §2.8).

조회=전 직원(인증 필수), 작성/삭제=admin. pinned 상단 고정, soft-delete.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_notices_requires_auth(async_client: AsyncClient):
    r = await async_client.get("/api/notices")
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_notices_empty(async_client: AsyncClient, auth_headers):
    r = await async_client.get("/api/notices", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"items": [], "total": 0}


@pytest.mark.asyncio
async def test_create_notice_forbidden_for_employee(async_client: AsyncClient, auth_headers):
    r = await async_client.post("/api/notices", headers=auth_headers, json={"title": "x"})
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_create_list_pinned_first(
    async_client: AsyncClient, auth_headers, admin_auth_headers
):
    r1 = await async_client.post(
        "/api/notices", headers=admin_auth_headers, json={"title": "일반 공지", "author": "IT팀"}
    )
    assert r1.status_code == 201, r1.text
    r2 = await async_client.post(
        "/api/notices",
        headers=admin_auth_headers,
        json={"title": "고정 공지", "author": "인사팀", "pinned": True},
    )
    assert r2.status_code == 201, r2.text

    rl = await async_client.get("/api/notices", headers=auth_headers)
    assert rl.status_code == 200, rl.text
    items = rl.json()["items"]
    assert len(items) == 2
    assert items[0]["title"] == "고정 공지"  # pinned 우선
    assert items[0]["pinned"] is True
    assert items[0]["author"] == "인사팀"
    assert "created_at" in items[0]


@pytest.mark.asyncio
async def test_delete_notice_soft_delete_admin_only(
    async_client: AsyncClient, auth_headers, admin_auth_headers
):
    r1 = await async_client.post(
        "/api/notices", headers=admin_auth_headers, json={"title": "삭제 대상"}
    )
    nid = r1.json()["id"]

    rf = await async_client.delete(f"/api/notices/{nid}", headers=auth_headers)
    assert rf.status_code == 403, rf.text  # employee 불가

    rd = await async_client.delete(f"/api/notices/{nid}", headers=admin_auth_headers)
    assert rd.status_code == 204, rd.text

    rl = await async_client.get("/api/notices", headers=auth_headers)
    assert all(i["id"] != nid for i in rl.json()["items"])  # 목록에서 제외

    rd2 = await async_client.delete(f"/api/notices/{nid}", headers=admin_auth_headers)
    assert rd2.status_code == 404, rd2.text  # 이미 비활성 → 404


@pytest.mark.asyncio
async def test_create_notice_validation(async_client: AsyncClient, admin_auth_headers):
    r = await async_client.post("/api/notices", headers=admin_auth_headers, json={"title": ""})
    assert r.status_code == 422, r.text  # 빈 제목 거부
