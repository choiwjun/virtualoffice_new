"""
test_kpi_api.py — KPI API 엔드포인트 테스트 (Lane C — G003)

검증 항목:
1. compute: 관리자 트리거, 계산 결과 저장
2. GET list/detail: 본인 vs 관리자 권한
3. adjust: 관리자 점수 조정
4. finalize: final_score 확정 + daily_status_push 적재
5. objections 상태머신: none → submitted → reviewing → resolved
6. 권한 검증 (비관리자 → 403)
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.tables import (
    DailyStatusPush,
    DailyStatusPushTarget,
    ErpUser,
    KpiObjectionStatus,
    KpiPeriodType,
    KpiResult,
    KpiSource,
    MeetingStatus,
    Meeting,
    MeetingMinuteStatus,
    MeetingMinute,
    Office,
    Floor,
    Room,
    RoomType,
    RoomStatus,
    WorkLog,
    WorkLogStatus,
)


# ──────────────────────────────────────────────────────────────────────────────
# 픽스처
# ──────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def users(db_session: AsyncSession):
    """employee(id=1), admin(id=3) ErpUser 생성."""
    emp = ErpUser(id=1, company_id=1, email="employee@example.com", name="Employee", erp_team_id=10, role="employee")
    adm = ErpUser(id=3, company_id=1, email="admin@example.com", name="Admin", erp_team_id=10, role="admin")
    db_session.add_all([emp, adm])
    await db_session.flush()
    return {"employee": emp, "admin": adm}


@pytest_asyncio.fixture
async def seed_work_logs(db_session: AsyncSession, users):
    """employee의 work_log 시드."""
    emp_id = users["employee"].id
    for i in range(3):
        db_session.add(WorkLog(
            user_id=emp_id,
            work_date=date(2026, 7, 1),
            title=f"Work {i}",
            status=WorkLogStatus.COMPLETED,
            goal=f"목표 {i} 설정 완료",
            category="개발",
            result_url=f"https://github.com/pr/{i}",
            next_action="다음 작업 진행",
        ))
    await db_session.flush()


# ──────────────────────────────────────────────────────────────────────────────
# compute
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_compute_admin_success(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
):
    """관리자 compute → 200, 8개 metric 반환."""
    resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["computed"] == 8
    metrics = {r["metric"] for r in data["results"]}
    assert "work_completed_count" in metrics
    assert "collaboration_score" in metrics
    assert "quarterly_total" in metrics


@pytest.mark.asyncio
async def test_compute_employee_forbidden(
    async_client: AsyncClient,
    users,
    auth_headers: dict,
):
    """일반 직원 compute → 403."""
    resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_compute_invalid_period_type(
    async_client: AsyncClient,
    users,
    admin_auth_headers: dict,
):
    """잘못된 period_type → 422."""
    resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "weekly", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_compute_deterministic_via_api(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
):
    """같은 파라미터 두 번 compute → work_completed_count 동일."""
    payload = {"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"}

    r1 = await async_client.post("/api/kpi-results/compute", json=payload, headers=admin_auth_headers)
    r2 = await async_client.post("/api/kpi-results/compute", json=payload, headers=admin_auth_headers)

    assert r1.status_code == r2.status_code == 200
    v1 = next(r["value"] for r in r1.json()["results"] if r["metric"] == "work_completed_count")
    v2 = next(r["value"] for r in r2.json()["results"] if r["metric"] == "work_completed_count")
    assert v1 == v2


# ──────────────────────────────────────────────────────────────────────────────
# GET list / detail
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_own_results(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
    auth_headers: dict,
):
    """본인은 자신의 kpi_result 조회 가능."""
    await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )

    resp = await async_client.get("/api/kpi-results", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 8
    for item in data:
        assert item["user_id"] == 1


@pytest.mark.asyncio
async def test_list_others_forbidden_for_employee(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
    auth_headers: dict,
):
    """일반 직원이 타인 user_id 조회 → 403."""
    await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 3, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )

    resp = await async_client.get("/api/kpi-results?user_id=3", headers=auth_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_list_others(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
):
    """관리자는 user_id 파라미터로 타인 조회 가능."""
    await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )

    resp = await async_client.get("/api/kpi-results?user_id=1", headers=admin_auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 8


@pytest.mark.asyncio
async def test_get_single_result(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
    auth_headers: dict,
):
    """GET /{id} — 단건 조회."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    result_id = compute_resp.json()["results"][0]["id"]

    resp = await async_client.get(f"/api/kpi-results/{result_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == result_id


@pytest.mark.asyncio
async def test_get_not_found(async_client: AsyncClient, users, auth_headers: dict):
    """존재하지 않는 ID → 404."""
    resp = await async_client.get(
        "/api/kpi-results/00000000-0000-0000-0000-000000000000",
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ──────────────────────────────────────────────────────────────────────────────
# adjust
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_adjust_admin(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
):
    """관리자 점수 조정 → admin_adjusted_score 설정."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    result_id = compute_resp.json()["results"][0]["id"]

    resp = await async_client.post(
        f"/api/kpi-results/{result_id}/adjust",
        json={"admin_adjusted_score": 85.0, "admin_note": "수동 조정 사유입니다"},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["admin_adjusted_score"] == 85.0
    assert data["admin_note"] == "수동 조정 사유입니다"
    assert data["admin_user_id"] == 3


@pytest.mark.asyncio
async def test_adjust_employee_forbidden(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
    auth_headers: dict,
):
    """일반 직원 adjust → 403."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    result_id = compute_resp.json()["results"][0]["id"]

    resp = await async_client.post(
        f"/api/kpi-results/{result_id}/adjust",
        json={"admin_adjusted_score": 50.0, "admin_note": "불법 조정"},
        headers=auth_headers,
    )
    assert resp.status_code == 403


# ──────────────────────────────────────────────────────────────────────────────
# finalize
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_finalize_sets_final_score(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
):
    """finalize → final_score = value (조정 없는 경우)."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    wcc_result = next(r for r in compute_resp.json()["results"] if r["metric"] == "work_completed_count")
    result_id = wcc_result["id"]
    original_value = wcc_result["value"]

    resp = await async_client.post(f"/api/kpi-results/{result_id}/finalize", headers=admin_auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["final_score"] == original_value
    assert data["finalized_at"] is not None


@pytest.mark.asyncio
async def test_finalize_uses_adjusted_score(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
):
    """finalize → final_score = admin_adjusted_score (조정된 경우)."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    result_id = compute_resp.json()["results"][0]["id"]

    await async_client.post(
        f"/api/kpi-results/{result_id}/adjust",
        json={"admin_adjusted_score": 77.0, "admin_note": "조정"},
        headers=admin_auth_headers,
    )

    resp = await async_client.post(f"/api/kpi-results/{result_id}/finalize", headers=admin_auth_headers)
    assert resp.status_code == 200
    assert resp.json()["final_score"] == 77.0


@pytest.mark.asyncio
async def test_finalize_creates_daily_status_push(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
):
    """finalize → daily_status_push target=erp_kpi_results status=pending 적재."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    result_id = compute_resp.json()["results"][0]["id"]

    await async_client.post(f"/api/kpi-results/{result_id}/finalize", headers=admin_auth_headers)

    # DB에서 daily_status_push 확인
    stmt = select(DailyStatusPush).where(
        DailyStatusPush.user_id == 1,
        DailyStatusPush.target == DailyStatusPushTarget.ERP_KPI_RESULTS,
    )
    push = (await db_session.execute(stmt)).scalar_one_or_none()
    assert push is not None
    assert push.status.value == "pending"
    assert push.payload["kpi_result_id"] == result_id


@pytest.mark.asyncio
async def test_finalize_idempotent_rejected(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
):
    """이미 확정된 kpi_result 재확정 → 409."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    result_id = compute_resp.json()["results"][0]["id"]

    await async_client.post(f"/api/kpi-results/{result_id}/finalize", headers=admin_auth_headers)
    resp2 = await async_client.post(f"/api/kpi-results/{result_id}/finalize", headers=admin_auth_headers)
    assert resp2.status_code == 409


# ──────────────────────────────────────────────────────────────────────────────
# 이의신청 상태머신 (D15)
# ──────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def finalized_result(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
) -> str:
    """확정된 kpi_result ID 반환."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    result_id = compute_resp.json()["results"][0]["id"]
    await async_client.post(f"/api/kpi-results/{result_id}/finalize", headers=admin_auth_headers)
    return result_id


@pytest.mark.asyncio
async def test_objection_submit(
    async_client: AsyncClient,
    finalized_result: str,
    auth_headers: dict,
):
    """본인 이의신청 none → submitted."""
    resp = await async_client.post(
        f"/api/kpi-results/{finalized_result}/objections",
        json={
            "category": "계산 오류",
            "text": "결과물 URL을 제출했으나 미반영된 것으로 보입니다",
            "evidence": "https://github.com/pr/100",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["objection_status"] == "submitted"
    assert data["objection_detail"]["category"] == "계산 오류"
    assert data["objection_submitted_at"] is not None


@pytest.mark.asyncio
async def test_objection_advance_to_reviewing(
    async_client: AsyncClient,
    finalized_result: str,
    auth_headers: dict,
    admin_auth_headers: dict,
):
    """submitted → reviewing."""
    await async_client.post(
        f"/api/kpi-results/{finalized_result}/objections",
        json={"category": "계산 오류", "text": "이의신청 상세 내용을 기술합니다", "evidence": None},
        headers=auth_headers,
    )

    resp = await async_client.post(
        f"/api/kpi-results/{finalized_result}/objections/review",
        json={"action": "advance"},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["objection_status"] == "reviewing"


@pytest.mark.asyncio
async def test_objection_resolve(
    async_client: AsyncClient,
    finalized_result: str,
    auth_headers: dict,
    admin_auth_headers: dict,
):
    """submitted → reviewing → resolved."""
    await async_client.post(
        f"/api/kpi-results/{finalized_result}/objections",
        json={"category": "계산 오류", "text": "이의신청 상세 내용입니다", "evidence": None},
        headers=auth_headers,
    )
    await async_client.post(
        f"/api/kpi-results/{finalized_result}/objections/review",
        json={"action": "advance"},
        headers=admin_auth_headers,
    )

    resp = await async_client.post(
        f"/api/kpi-results/{finalized_result}/objections/review",
        json={"action": "resolve", "note": "이의 타당, 점수 재조정", "revised_score": 90.0},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["objection_status"] == "resolved"
    assert data["objection_resolved_at"] is not None
    assert data["final_score"] == 90.0


@pytest.mark.asyncio
async def test_objection_invalid_state_advance(
    async_client: AsyncClient,
    finalized_result: str,
    admin_auth_headers: dict,
):
    """submitted 아닌 상태에서 advance → 409."""
    # 이의신청 없이 바로 advance 시도 (status=none)
    resp = await async_client.post(
        f"/api/kpi-results/{finalized_result}/objections/review",
        json={"action": "advance"},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_objection_not_finalized(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
    auth_headers: dict,
):
    """미확정 kpi_result에 이의신청 → 409."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-02"},
        headers=admin_auth_headers,
    )
    result_id = compute_resp.json()["results"][0]["id"]

    resp = await async_client.post(
        f"/api/kpi-results/{result_id}/objections",
        json={"category": "오류", "text": "이의신청 내용입니다", "evidence": None},
        headers=auth_headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_objection_other_user_forbidden(
    async_client: AsyncClient,
    finalized_result: str,
):
    """타인이 이의신청 → 403."""
    other_token = create_access_token(
        {"sub": "999", "email": "other@example.com", "role": "employee"},
        expires_delta=timedelta(hours=8),
    )
    resp = await async_client.post(
        f"/api/kpi-results/{finalized_result}/objections",
        json={"category": "오류", "text": "타인 이의신청 시도", "evidence": None},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_objection_invalid_action(
    async_client: AsyncClient,
    finalized_result: str,
    auth_headers: dict,
    admin_auth_headers: dict,
):
    """review action 잘못된 값 → 422."""
    await async_client.post(
        f"/api/kpi-results/{finalized_result}/objections",
        json={"category": "오류", "text": "이의신청 내용입니다", "evidence": None},
        headers=auth_headers,
    )
    resp = await async_client.post(
        f"/api/kpi-results/{finalized_result}/objections/review",
        json={"action": "invalid_action"},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_filter_by_period_type_and_key(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
    auth_headers: dict,
):
    """period_type/period_key 필터 쿼리 동작 확인."""
    await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-02"},
        headers=admin_auth_headers,
    )

    resp = await async_client.get(
        "/api/kpi-results?period_type=daily&period_key=2026-07-01",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert all(r["period_key"] == "2026-07-01" for r in data)
    assert len(data) == 8
