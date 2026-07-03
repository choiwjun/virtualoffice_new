"""
G004 레이아웃 API/검증 게이트 적대적(red-team) e2e 테스트.

목표: 제품 코드는 건드리지 않고, 실제 취약점(검증 우회·RBAC 누락·상태전이 오류·
크래시)이 있는지 블랙박스로 두드려본다. 전부 통과 시 현재 구현에 발견된 결함이
없다는 뜻이다.

@SPEC backend/app/api/layouts.py
@SPEC backend/app/services/office_layout_validator.py
@SPEC docs/planning/00-decisions.md#D12
"""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import Floor, Office

pytestmark = pytest.mark.asyncio


# ============================================================================
# 시드 픽스처
# ============================================================================

@pytest_asyncio.fixture
async def office_floor(db_session: AsyncSession) -> dict:
    """레이아웃 FK 제약을 만족하는 최소 Office + Floor 시드."""
    office = Office(id=uuid.uuid4(), company_id=uuid.uuid4(), name="Red Team HQ")
    db_session.add(office)
    await db_session.flush()
    floor = Floor(id=uuid.uuid4(), office_id=office.id, level=1, name="1F")
    db_session.add(floor)
    await db_session.commit()
    return {"office_id": str(office.id), "floor_id": str(floor.id)}


# ============================================================================
# 레이아웃 JSON 빌더
# ============================================================================

def _deployable_layout(office_id: str, floor_id: str, *, with_spawn: bool = True) -> dict:
    """공식 스키마 required 필드를 모두 채운 최소 배포 가능(ERROR=0) 레이아웃.

    zones/rooms/furniture/colliders를 비워 두면 조직·에셋·문·수용인원 검증이
    전부 스킵되므로(office_layout_validator._validate_assets/_validate_org 등)
    순수하게 스키마 + 구조 규칙만 통과하면 배포 가능하다. validate_office_layout()
    으로 사전 검증했다(deployable=True, errors=[]).
    """
    layout = {
        "metadata": {
            "version": "1.0",
            "schema_version": 1,
            "layout_id": str(uuid.uuid4()),
            "office_id": office_id,
            "floor_id": floor_id,
            "floor_name": "1F",
            "created_at": "2026-07-01T00:00:00Z",
            "updated_at": "2026-07-01T00:00:00Z",
            "created_by": 1,
            "updated_by": 1,
            "language": "ko-KR",
        },
        "floor": {
            "id": floor_id,
            "level": 1,
            "name": "1F",
            "coordinate_origin": "top_left",
            "floor_height_m": 0.0,
            "unit_system": "metric",
        },
        "dimensions": {
            "width_m": 10.0,
            "height_m": 10.0,
            "min_x": 0.0,
            "max_x": 10.0,
            "min_y": 0.0,
            "max_y": 10.0,
        },
        "zones": [],
        "rooms": [],
        "seats": [],
        "colliders": [],
    }
    if with_spawn:
        layout["spawn_points"] = [{"spawn_id": "SP1", "coords": {"x": 5.0, "y": 5.0}}]
    return layout


def _broken_layout() -> dict:
    """공식 스키마 required 필드가 전부 빠진, 명백히 배포 불가능한 레이아웃."""
    return {"foo": "bar"}


def _spawn_reachability_layout() -> dict:
    """coord_to_cell 섀도잉 회귀 재현용: spawn_points만 있는 레이아웃(§services 회귀 케이스와 동일 형태).

    metadata/floor/zones/rooms/colliders가 없어 스키마 ERROR는 발생하지만,
    (c) 도달성 단계(_validate_reachability)가 크래시 없이 실행되는지가 핵심이다.
    """
    return {
        "dimensions": {"min_x": 0.0, "min_y": 0.0, "width_m": 5.0, "height_m": 5.0},
        "spawn_points": [{"spawn_id": "SP1", "coords": {"x": 1.0, "y": 1.0}}],
        "seats": [{"seat_id": "S1", "coords": {"x": 2.0, "y": 2.0}}],
        "rooms": [],
    }


async def _create_layout(
    async_client: AsyncClient, headers: dict, office_id: str, floor_id: str, layout: dict
) -> dict:
    resp = await async_client.post(
        "/layouts",
        json={"office_id": office_id, "floor_id": floor_id, "json": layout},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ============================================================================
# 1) 검증 게이트: ERROR 레이아웃은 배포 불가(D12)
# ============================================================================

async def test_deploy_rejects_layout_with_validation_errors(
    async_client: AsyncClient, admin_auth_headers: dict, office_floor: dict
):
    created = await _create_layout(
        async_client, admin_auth_headers, office_floor["office_id"], office_floor["floor_id"],
        _broken_layout(),
    )
    layout_id = created["layout_id"]
    assert created["status"] == "draft"

    resp = await async_client.post(f"/layouts/{layout_id}/deploy", headers=admin_auth_headers)
    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert body["errors"], "ERROR 존재 레이아웃이 errors 없이 400을 반환함(D12 위반)"

    check = await async_client.get(f"/layouts/{layout_id}", headers=admin_auth_headers)
    assert check.status_code == 200
    assert check.json()["status"] != "deployed", "검증 실패 레이아웃이 배포됨(D12 우회)"


# ============================================================================
# 2) RBAC: employee는 admin 전용 액션에 접근 불가
# ============================================================================

async def test_employee_cannot_create_deploy_or_rollback(
    async_client: AsyncClient, auth_headers: dict, admin_auth_headers: dict, office_floor: dict
):
    # employee가 create 시도 → 403 (레이아웃 없이도 role 게이트가 먼저 걸려야 함)
    resp = await async_client.post(
        "/layouts",
        json={
            "office_id": office_floor["office_id"],
            "floor_id": office_floor["floor_id"],
            "json": _broken_layout(),
        },
        headers=auth_headers,
    )
    assert resp.status_code == 403, resp.text

    # admin이 대상 레이아웃을 하나 만들어 둔다(존재 여부와 무관하게 role 게이트 우선순위 확인용).
    created = await _create_layout(
        async_client, admin_auth_headers, office_floor["office_id"], office_floor["floor_id"],
        _deployable_layout(office_floor["office_id"], office_floor["floor_id"]),
    )
    layout_id = created["layout_id"]

    resp = await async_client.post(f"/layouts/{layout_id}/deploy", headers=auth_headers)
    assert resp.status_code == 403, resp.text

    resp = await async_client.post(
        f"/layouts/{layout_id}/rollback", params={"version": 1}, headers=auth_headers
    )
    assert resp.status_code == 403, resp.text


# ============================================================================
# 3) 잘못된 UUID / 미존재 UUID → 항상 404 (422 아님)
# ============================================================================

async def test_get_layout_invalid_and_missing_uuid_both_404(
    async_client: AsyncClient, admin_auth_headers: dict
):
    resp = await async_client.get("/layouts/nonexistent", headers=admin_auth_headers)
    assert resp.status_code == 404, f"잘못된 UUID 형식이 404가 아님: {resp.status_code} {resp.text}"

    missing_uuid = str(uuid.uuid4())
    resp = await async_client.get(f"/layouts/{missing_uuid}", headers=admin_auth_headers)
    assert resp.status_code == 404, f"미존재 UUID가 404가 아님: {resp.status_code} {resp.text}"


# ============================================================================
# 3-b) 스키마 위반 payload로 validate 호출 → 400 + errors
# ============================================================================

async def test_validate_endpoint_rejects_malformed_schema(
    async_client: AsyncClient, admin_auth_headers: dict
):
    resp = await async_client.post(
        "/layouts/validate", json={"invalid": "schema"}, headers=admin_auth_headers
    )
    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert body["errors"], "스키마 위반 payload인데 errors가 비어있음"
    assert body["deployable"] is False


# ============================================================================
# 4) /layouts/current: 배포 없으면 404, 배포 후 200 + layout_json
# ============================================================================

async def test_current_layout_404_then_200_after_deploy(
    async_client: AsyncClient, admin_auth_headers: dict, office_floor: dict
):
    resp = await async_client.get("/layouts/current", headers=admin_auth_headers)
    assert resp.status_code == 404, resp.text

    created = await _create_layout(
        async_client, admin_auth_headers, office_floor["office_id"], office_floor["floor_id"],
        _deployable_layout(office_floor["office_id"], office_floor["floor_id"]),
    )
    deploy_resp = await async_client.post(
        f"/layouts/{created['layout_id']}/deploy", headers=admin_auth_headers
    )
    assert deploy_resp.status_code == 200, deploy_resp.text

    resp = await async_client.get("/layouts/current", headers=admin_auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "layout_json" in body
    assert "json" not in body


# ============================================================================
# 5) rollback 미존재 버전 → 404 / deploy 시 기존 DEPLOYED → archived 전이
# ============================================================================

async def test_rollback_missing_version_404_and_deploy_archives_previous(
    async_client: AsyncClient, admin_auth_headers: dict, office_floor: dict
):
    v1 = await _create_layout(
        async_client, admin_auth_headers, office_floor["office_id"], office_floor["floor_id"],
        _deployable_layout(office_floor["office_id"], office_floor["floor_id"]),
    )
    assert v1["version"] == 1

    # 존재하지 않는 버전으로 rollback → 404
    resp = await async_client.post(
        f"/layouts/{v1['layout_id']}/rollback", params={"version": 999}, headers=admin_auth_headers
    )
    assert resp.status_code == 404, resp.text

    deploy_v1 = await async_client.post(
        f"/layouts/{v1['layout_id']}/deploy", headers=admin_auth_headers
    )
    assert deploy_v1.status_code == 200, deploy_v1.text

    v2 = await _create_layout(
        async_client, admin_auth_headers, office_floor["office_id"], office_floor["floor_id"],
        _deployable_layout(office_floor["office_id"], office_floor["floor_id"]),
    )
    assert v2["version"] == 2

    deploy_v2 = await async_client.post(
        f"/layouts/{v2['layout_id']}/deploy", headers=admin_auth_headers
    )
    assert deploy_v2.status_code == 200, deploy_v2.text

    check_v1 = await async_client.get(f"/layouts/{v1['layout_id']}", headers=admin_auth_headers)
    assert check_v1.status_code == 200
    assert check_v1.json()["status"] == "archived", (
        f"새 버전 배포 후 이전 DEPLOYED가 archived로 전이되지 않음: {check_v1.json()}"
    )
    check_v2 = await async_client.get(f"/layouts/{v2['layout_id']}", headers=admin_auth_headers)
    assert check_v2.json()["status"] == "deployed"


# ============================================================================
# 6) DEPLOYED 상태 레이아웃은 PUT으로 수정 불가(409)
# ============================================================================

async def test_update_deployed_layout_returns_409(
    async_client: AsyncClient, admin_auth_headers: dict, office_floor: dict
):
    created = await _create_layout(
        async_client, admin_auth_headers, office_floor["office_id"], office_floor["floor_id"],
        _deployable_layout(office_floor["office_id"], office_floor["floor_id"]),
    )
    deploy_resp = await async_client.post(
        f"/layouts/{created['layout_id']}/deploy", headers=admin_auth_headers
    )
    assert deploy_resp.status_code == 200, deploy_resp.text

    resp = await async_client.put(
        f"/layouts/{created['layout_id']}",
        json={"json": _deployable_layout(office_floor["office_id"], office_floor["floor_id"])},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 409, (
        f"DEPLOYED 레이아웃이 PUT으로 수정됨(draft 전용 제약 우회): {resp.status_code} {resp.text}"
    )


# ============================================================================
# 7) 미인증 요청 → 401
# ============================================================================

async def test_unauthenticated_requests_return_401(async_client: AsyncClient):
    resp = await async_client.get("/layouts")
    assert resp.status_code == 401, resp.text

    resp = await async_client.get("/layouts/current")
    assert resp.status_code == 401, resp.text


# ============================================================================
# 8) 검증기 버그 회귀: spawn_points 레이아웃 validate 호출 시 500 없음
# ============================================================================

async def test_validate_with_spawn_points_never_crashes(
    async_client: AsyncClient, admin_auth_headers: dict
):
    resp = await async_client.post(
        "/layouts/validate", json=_spawn_reachability_layout(), headers=admin_auth_headers
    )
    assert resp.status_code in (200, 400), (
        f"spawn_points 레이아웃 validate가 크래시(500) 또는 예상 외 상태코드 반환: "
        f"{resp.status_code} {resp.text}"
    )
    body = resp.json()
    assert "errors" in body and "warnings" in body
