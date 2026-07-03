"""
G007 업무기록 API 적대적(red-team) e2e 테스트.

목적: backend/app/api/worklogs.py 를 깨뜨리는 것을 목표로 하는 독립 스위트.
제품 코드/모델은 수정하지 않는다.

@SPEC docs/planning/00-decisions.md D14(업무결과), D17(일일 마감), D18(근거 무결성)
@SPEC backend/app/api/worklogs.py
"""

from uuid import uuid4

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _create(client: AsyncClient, headers: dict, **over) -> str:
    body = {"title": "기본 업무"}
    body.update(over)
    r = await client.post("/work-logs", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["work_log_id"]


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# 1) 인증/입력 검증
# ============================================================================

async def test_create_requires_auth(db_session, async_client: AsyncClient):
    r = await async_client.post("/work-logs", json={"title": "x"})
    assert r.status_code == 401, r.text


async def test_create_missing_title_returns_422(
    db_session, async_client: AsyncClient, auth_headers
):
    r = await async_client.post("/work-logs", json={"goal": "제목 없음"}, headers=auth_headers)
    assert r.status_code == 422, r.text


async def test_invalid_period_returns_400(
    db_session, async_client: AsyncClient, auth_headers
):
    r = await async_client.get("/work-logs?period=2026Q3", headers=auth_headers)
    assert r.status_code == 400, r.text
    assert r.json().get("detail") == "invalid_period"


@pytest.mark.parametrize("bad_id", ["not-a-uuid", "12345", "1' OR '1'='1"])
async def test_malformed_work_log_id_returns_404_not_422(
    db_session, async_client: AsyncClient, auth_headers, bad_id
):
    g = await async_client.get(f"/work-logs/{bad_id}", headers=auth_headers)
    assert g.status_code == 404, g.text
    p = await async_client.put(
        f"/work-logs/{bad_id}", json={"result": "x"}, headers=auth_headers
    )
    assert p.status_code == 404, p.text
    d = await async_client.delete(f"/work-logs/{bad_id}", headers=auth_headers)
    assert d.status_code == 404, d.text


async def test_update_nonexistent_returns_404(
    db_session, async_client: AsyncClient, auth_headers
):
    r = await async_client.put(
        f"/work-logs/{uuid4()}", json={"result": "x"}, headers=auth_headers
    )
    assert r.status_code == 404, r.text


# ============================================================================
# 2) 소유권/RBAC (D18 근거 무결성)
# ============================================================================

async def test_get_others_work_log_returns_404(
    db_session, async_client: AsyncClient, auth_headers, admin_auth_headers
):
    # admin(sub=3)이 자기 기록 생성 → employee(sub=1)는 접근 불가(존재 미노출 404)
    wid = await _create(async_client, admin_auth_headers, title="admin 기록")
    g = await async_client.get(f"/work-logs/{wid}", headers=auth_headers)
    assert g.status_code == 404, g.text


async def test_update_by_non_author_forbidden(
    db_session, async_client: AsyncClient, auth_headers, leader_token
):
    # employee(sub=1) 작성 → leader(sub=2) 수정 시도 → 403
    wid = await _create(async_client, auth_headers, title="employee 기록")
    r = await async_client.put(
        f"/work-logs/{wid}", json={"result": "침입"}, headers=_bearer(leader_token)
    )
    assert r.status_code == 403, r.text
    assert r.json().get("detail") == "not_author"


async def test_delete_by_non_author_non_admin_forbidden(
    db_session, async_client: AsyncClient, auth_headers, leader_token
):
    wid = await _create(async_client, auth_headers, title="employee 기록")
    r = await async_client.delete(f"/work-logs/{wid}", headers=_bearer(leader_token))
    assert r.status_code == 403, r.text


async def test_admin_can_delete_others_work_log(
    db_session, async_client: AsyncClient, auth_headers, admin_auth_headers
):
    # employee 작성 → admin 삭제 → 200 (작성자/admin만 삭제 D 규약)
    wid = await _create(async_client, auth_headers, title="employee 기록")
    r = await async_client.delete(f"/work-logs/{wid}", headers=admin_auth_headers)
    assert r.status_code == 200, r.text


async def test_list_scoped_to_own_by_default(
    db_session, async_client: AsyncClient, auth_headers, admin_auth_headers
):
    # employee(1) 1건 + admin(3) 1건 생성 → employee 목록엔 본인 것만.
    await _create(async_client, auth_headers, title="내 업무", work_date="2026-06-10")
    await _create(async_client, admin_auth_headers, title="관리자 업무", work_date="2026-06-10")

    r = await async_client.get("/work-logs", headers=auth_headers)
    assert r.status_code == 200, r.text
    logs = r.json()["work_logs"]
    assert len(logs) == 1
    assert all(w["user_id"] == 1 for w in logs)


async def test_list_other_user_by_non_admin_forbidden(
    db_session, async_client: AsyncClient, auth_headers
):
    r = await async_client.get("/work-logs?user_id=999", headers=auth_headers)
    assert r.status_code == 403, r.text


async def test_admin_can_list_other_user(
    db_session, async_client: AsyncClient, auth_headers, admin_auth_headers
):
    await _create(async_client, auth_headers, title="내 업무", work_date="2026-06-11")
    r = await async_client.get("/work-logs?user_id=1", headers=admin_auth_headers)
    assert r.status_code == 200, r.text
    logs = r.json()["work_logs"]
    assert all(w["user_id"] == 1 for w in logs)


# ============================================================================
# 3) D17 일일 마감 규칙 + 지속성
# ============================================================================

async def test_explicit_work_date_persists(
    db_session, async_client: AsyncClient, auth_headers
):
    wid = await _create(async_client, auth_headers, title="특정일", work_date="2026-06-20")
    g = await async_client.get(f"/work-logs/{wid}", headers=auth_headers)
    assert g.status_code == 200, g.text
    assert g.json()["work_date"] == "2026-06-20"


async def test_author_can_update_own_work_log(
    db_session, async_client: AsyncClient, auth_headers
):
    wid = await _create(async_client, auth_headers, title="원본", result="원래 결과")
    r = await async_client.put(
        f"/work-logs/{wid}", json={"result": "수정 결과", "status": "completed"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"] == "수정 결과"
    assert body["status"] == "completed"


async def test_future_work_date_rejected(
    db_session, async_client: AsyncClient, auth_headers
):
    """04-data-model.md:976 앱 레이어 규칙: 사용자 지정 미래 work_date는 400."""
    r = await async_client.post(
        "/work-logs",
        json={"title": "미래 조작", "work_date": "2099-01-01"},
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text
    assert r.json().get("detail") == "work_date_in_future"


async def test_result_description_alias_accepted(
    db_session, async_client: AsyncClient, auth_headers
):
    """OpenAPI 어휘 result_description 로 보내도 드롭되지 않고 저장·반환된다(계약 result 별칭)."""
    create = await async_client.post(
        "/work-logs",
        json={"title": "별칭 검증", "result_description": "정본 어휘 결과"},
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["result"] == "정본 어휘 결과"
    assert body["result_description"] == "정본 어휘 결과"
