"""출장 신청·승인 API 테스트 (/api/trips).

워크플로우: requested → approved/rejected(관리자) → completed(본인, 보고 필수).
requested/approved → cancelled(본인). 삭제는 requested 본인만.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

TRIP_BODY = {
    "destination": "부산 벡스코",
    "purpose": "고객사 미팅",
    "start_date": "2026-08-01",
    "end_date": "2026-08-03",
    "note": "KTX 이동",
}


async def _create(client: AsyncClient, headers: dict, **overrides) -> dict:
    body = {**TRIP_BODY, **overrides}
    r = await client.post("/api/trips", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_trips_requires_auth(async_client: AsyncClient):
    r = await async_client.get("/api/trips")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_and_get_trip(async_client: AsyncClient, auth_headers):
    created = await _create(async_client, auth_headers)
    assert created["status"] == "requested"
    assert created["user_id"] == 1
    assert created["destination"] == "부산 벡스코"

    r = await async_client.get(f"/api/trips/{created['id']}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


@pytest.mark.asyncio
async def test_create_trip_invalid_dates(async_client: AsyncClient, auth_headers):
    r = await async_client.post(
        "/api/trips",
        headers=auth_headers,
        json={**TRIP_BODY, "start_date": "2026-08-05", "end_date": "2026-08-01"},
    )
    assert r.status_code == 400
    assert "end_date_before_start_date" in r.text


@pytest.mark.asyncio
async def test_list_scoped_to_owner_for_employee(
    async_client: AsyncClient, auth_headers, admin_auth_headers
):
    await _create(async_client, auth_headers)                 # user 1
    await _create(async_client, admin_auth_headers)           # user 3 (admin 본인 신청)

    r = await async_client.get("/api/trips", headers=auth_headers)
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert all(t["user_id"] == 1 for t in items)

    # 관리자는 전체 조회
    r2 = await async_client.get("/api/trips", headers=admin_auth_headers)
    assert len(r2.json()) == 2

    # 관리자 user_id 필터
    r3 = await async_client.get("/api/trips?user_id=1", headers=admin_auth_headers)
    assert len(r3.json()) == 1


@pytest.mark.asyncio
async def test_employee_cannot_read_others_trip(
    async_client: AsyncClient, auth_headers, admin_auth_headers
):
    other = await _create(async_client, admin_auth_headers)
    r = await async_client.get(f"/api/trips/{other['id']}", headers=auth_headers)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_approve_flow(async_client: AsyncClient, auth_headers, admin_auth_headers):
    trip = await _create(async_client, auth_headers)

    # employee 본인은 승인 불가
    r = await async_client.patch(
        f"/api/trips/{trip['id']}", headers=auth_headers, json={"status": "approved"}
    )
    assert r.status_code == 403

    # 관리자 승인
    r2 = await async_client.patch(
        f"/api/trips/{trip['id']}", headers=admin_auth_headers, json={"status": "approved"}
    )
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["status"] == "approved"
    assert body["approver_id"] == 3
    assert body["decided_at"] is not None

    # 승인된 출장 → 본인 완료 (보고 필수)
    r3 = await async_client.patch(
        f"/api/trips/{trip['id']}", headers=auth_headers, json={"status": "completed"}
    )
    assert r3.status_code == 400  # report 없음
    r4 = await async_client.patch(
        f"/api/trips/{trip['id']}",
        headers=auth_headers,
        json={"status": "completed", "report": "미팅 완료, 계약 진행 합의"},
    )
    assert r4.status_code == 200, r4.text
    assert r4.json()["status"] == "completed"
    assert r4.json()["report"].startswith("미팅 완료")


@pytest.mark.asyncio
async def test_reject_with_reason(async_client: AsyncClient, auth_headers, leader_token):
    trip = await _create(async_client, auth_headers)
    leader_headers = {"Authorization": f"Bearer {leader_token}"}
    r = await async_client.patch(
        f"/api/trips/{trip['id']}",
        headers=leader_headers,
        json={"status": "rejected", "reject_reason": "일정 중복"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"
    assert r.json()["reject_reason"] == "일정 중복"

    # 반려된 출장은 완료 전이 불가
    r2 = await async_client.patch(
        f"/api/trips/{trip['id']}",
        headers=auth_headers,
        json={"status": "completed", "report": "x"},
    )
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_cancel_own_requested(async_client: AsyncClient, auth_headers):
    trip = await _create(async_client, auth_headers)
    r = await async_client.patch(
        f"/api/trips/{trip['id']}", headers=auth_headers, json={"status": "cancelled"}
    )
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"

    # 취소된 건은 재승인 불가
    r2 = await async_client.patch(
        f"/api/trips/{trip['id']}", headers=auth_headers, json={"status": "approved"}
    )
    assert r2.status_code in (403, 409)


@pytest.mark.asyncio
async def test_edit_only_while_requested(async_client: AsyncClient, auth_headers, admin_auth_headers):
    trip = await _create(async_client, auth_headers)

    r = await async_client.patch(
        f"/api/trips/{trip['id']}", headers=auth_headers, json={"destination": "대전"}
    )
    assert r.status_code == 200
    assert r.json()["destination"] == "대전"

    await async_client.patch(
        f"/api/trips/{trip['id']}", headers=admin_auth_headers, json={"status": "approved"}
    )
    r2 = await async_client.patch(
        f"/api/trips/{trip['id']}", headers=auth_headers, json={"destination": "광주"}
    )
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_delete_only_requested(async_client: AsyncClient, auth_headers, admin_auth_headers):
    trip = await _create(async_client, auth_headers)
    approved = await _create(async_client, auth_headers)
    await async_client.patch(
        f"/api/trips/{approved['id']}", headers=admin_auth_headers, json={"status": "approved"}
    )

    r = await async_client.delete(f"/api/trips/{approved['id']}", headers=auth_headers)
    assert r.status_code == 409

    r2 = await async_client.delete(f"/api/trips/{trip['id']}", headers=auth_headers)
    assert r2.status_code == 204

    r3 = await async_client.get(f"/api/trips/{trip['id']}", headers=auth_headers)
    assert r3.status_code == 404


@pytest.mark.asyncio
async def test_status_filter(async_client: AsyncClient, auth_headers, admin_auth_headers):
    t1 = await _create(async_client, auth_headers)
    await _create(async_client, auth_headers)
    await async_client.patch(
        f"/api/trips/{t1['id']}", headers=admin_auth_headers, json={"status": "approved"}
    )

    r = await async_client.get("/api/trips?status=approved", headers=auth_headers)
    assert len(r.json()) == 1
    r2 = await async_client.get("/api/trips?status=requested", headers=auth_headers)
    assert len(r2.json()) == 1
    r3 = await async_client.get("/api/trips?status=bogus", headers=auth_headers)
    assert r3.status_code == 400
