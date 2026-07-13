"""업무 보고서 API 테스트 (/api/reports).

draft에서만 수정·삭제. submitted 전환 시 submitted_at 기록 후 불변.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

REPORT_BODY = {
    "report_type": "daily",
    "report_date": "2026-07-13",
    "title": "7/13 일일 보고",
    "content": "- 오버레이 z-index 버그 수정\n- 4개 메뉴 개발 착수",
}


async def _create(client: AsyncClient, headers: dict, **overrides) -> dict:
    r = await client.post("/api/reports", headers=headers, json={**REPORT_BODY, **overrides})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_reports_requires_auth(async_client: AsyncClient):
    r = await async_client.get("/api/reports")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_draft_and_get(async_client: AsyncClient, auth_headers):
    created = await _create(async_client, auth_headers)
    assert created["status"] == "draft"
    assert created["submitted_at"] is None
    assert created["user_id"] == 1

    r = await async_client.get(f"/api/reports/{created['id']}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["title"] == REPORT_BODY["title"]


@pytest.mark.asyncio
async def test_create_submitted_directly(async_client: AsyncClient, auth_headers):
    created = await _create(async_client, auth_headers, status="submitted")
    assert created["status"] == "submitted"
    assert created["submitted_at"] is not None


@pytest.mark.asyncio
async def test_validation(async_client: AsyncClient, auth_headers):
    r = await async_client.post(
        "/api/reports", headers=auth_headers, json={**REPORT_BODY, "title": ""}
    )
    assert r.status_code == 422
    r2 = await async_client.post(
        "/api/reports", headers=auth_headers, json={**REPORT_BODY, "report_type": "yearly"}
    )
    assert r2.status_code == 422


@pytest.mark.asyncio
async def test_update_draft_then_submit(async_client: AsyncClient, auth_headers):
    created = await _create(async_client, auth_headers)

    r = await async_client.patch(
        f"/api/reports/{created['id']}",
        headers=auth_headers,
        json={"title": "수정된 제목", "content": "업데이트된 내용"},
    )
    assert r.status_code == 200
    assert r.json()["title"] == "수정된 제목"

    r2 = await async_client.patch(
        f"/api/reports/{created['id']}", headers=auth_headers, json={"status": "submitted"}
    )
    assert r2.status_code == 200
    assert r2.json()["status"] == "submitted"
    assert r2.json()["submitted_at"] is not None

    # 제출 후 수정 불가 (불변)
    r3 = await async_client.patch(
        f"/api/reports/{created['id']}", headers=auth_headers, json={"title": "몰래 수정"}
    )
    assert r3.status_code == 409

    # 역전이(draft 복귀)도 불가
    r4 = await async_client.patch(
        f"/api/reports/{created['id']}", headers=auth_headers, json={"status": "draft"}
    )
    assert r4.status_code == 409


@pytest.mark.asyncio
async def test_delete_draft_only(async_client: AsyncClient, auth_headers):
    draft = await _create(async_client, auth_headers)
    submitted = await _create(async_client, auth_headers, status="submitted")

    r = await async_client.delete(f"/api/reports/{submitted['id']}", headers=auth_headers)
    assert r.status_code == 409

    r2 = await async_client.delete(f"/api/reports/{draft['id']}", headers=auth_headers)
    assert r2.status_code == 204
    r3 = await async_client.get(f"/api/reports/{draft['id']}", headers=auth_headers)
    assert r3.status_code == 404


@pytest.mark.asyncio
async def test_list_scope_and_filters(
    async_client: AsyncClient, auth_headers, admin_auth_headers
):
    await _create(async_client, auth_headers)                                  # user 1 daily draft
    await _create(async_client, auth_headers, report_type="weekly", status="submitted")
    await _create(async_client, admin_auth_headers)                            # user 3

    # employee: 본인 것만
    r = await async_client.get("/api/reports", headers=auth_headers)
    assert len(r.json()) == 2
    assert all(x["user_id"] == 1 for x in r.json())

    # 타인 조회 시도 → 403
    r2 = await async_client.get("/api/reports?user_id=3", headers=auth_headers)
    assert r2.status_code == 403

    # 관리자: 전체 + user_id 필터
    r3 = await async_client.get("/api/reports", headers=admin_auth_headers)
    assert len(r3.json()) == 3
    r4 = await async_client.get("/api/reports?user_id=1", headers=admin_auth_headers)
    assert len(r4.json()) == 2

    # 필터
    r5 = await async_client.get("/api/reports?report_type=weekly", headers=auth_headers)
    assert len(r5.json()) == 1
    r6 = await async_client.get("/api/reports?status=submitted", headers=auth_headers)
    assert len(r6.json()) == 1
    r7 = await async_client.get("/api/reports?report_type=bogus", headers=auth_headers)
    assert r7.status_code == 400


@pytest.mark.asyncio
async def test_admin_cannot_edit_others_report(
    async_client: AsyncClient, auth_headers, admin_auth_headers
):
    created = await _create(async_client, auth_headers)
    r = await async_client.patch(
        f"/api/reports/{created['id']}", headers=admin_auth_headers, json={"title": "관리자 수정"}
    )
    assert r.status_code == 403
    # 조회는 가능
    r2 = await async_client.get(f"/api/reports/{created['id']}", headers=admin_auth_headers)
    assert r2.status_code == 200
