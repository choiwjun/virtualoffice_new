"""
ERP API 엔드포인트 통합 테스트 (async_client + 목 리더).

전체 흐름: 인증 → sync → 직원 디렉터리 → 근태 read-through.
"""

from datetime import date


# ── 인증 가드 ─────────────────────────────────────────────
async def test_employees_requires_auth(async_client):
    assert (await async_client.get("/api/employees")).status_code == 401


async def test_sync_requires_admin(async_client, auth_headers):
    # employee 토큰(auth_headers) → 403
    assert (await async_client.post("/api/erp/sync", headers=auth_headers)).status_code == 403


# ── 전체 흐름 ─────────────────────────────────────────────
async def test_sync_then_list_employees(async_client, admin_auth_headers, auth_headers):
    # 최초 동기화 (admin)
    r = await async_client.post("/api/erp/sync", headers=admin_auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["created"] == 5 and body["updated"] == 0

    # 직원 디렉터리 (employee 권한이면 충분)
    r = await async_client.get("/api/employees", headers=auth_headers)
    assert r.status_code == 200
    employees = r.json()
    assert len(employees) == 5
    ceo = next(e for e in employees if e["id"] == 1)
    assert ceo["role"] == "super_admin"

    # 단건 조회
    r = await async_client.get("/api/employees/3", headers=auth_headers)
    assert r.status_code == 200 and r.json()["name"] == "이개발"

    # 없는 직원 → 404
    r = await async_client.get("/api/employees/99999", headers=auth_headers)
    assert r.status_code == 404


async def test_sync_idempotent_via_api(async_client, admin_auth_headers):
    await async_client.post("/api/erp/sync", headers=admin_auth_headers)
    r = await async_client.post("/api/erp/sync", headers=admin_auth_headers)
    assert r.json() == {"created": 0, "updated": 5, "deactivated": 0}


# ── 근태 read-through ─────────────────────────────────────
async def test_attendances_read_through(async_client, auth_headers, admin_auth_headers):
    d = date(2026, 7, 1).isoformat()
    # 일반 직원: 본인(user_id=1) 근태만 (06 §3.12 — 전체 근태는 관리자 전용)
    r = await async_client.get(f"/api/attendances?start={d}&end={d}", headers=auth_headers)
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["user_id"] == 1
    # 관리자: 전체
    r2 = await async_client.get(f"/api/attendances?start={d}&end={d}", headers=admin_auth_headers)
    assert len(r2.json()) == 5


async def test_attendances_invalid_range(async_client, auth_headers):
    r = await async_client.get(
        "/api/attendances?start=2026-07-10&end=2026-07-01", headers=auth_headers
    )
    assert r.status_code == 400
