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
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.tables import (
    DailyStatusPush,
    DailyStatusPushTarget,
    ErpUser,
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
    first = compute_resp.json()["results"][0]
    result_id = first["id"]
    adjusted = round(first["value"] * 1.05, 4)  # ±10% 이내 (08 §3.2)
    note = "결과물 충실도 및 회의 기여 반영을 위해 수동으로 조정합니다. 근거: PR 리뷰 반영 이력."

    resp = await async_client.post(
        f"/api/kpi-results/{result_id}/adjust",
        json={"admin_adjusted_score": adjusted, "admin_note": note},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["admin_adjusted_score"] == adjusted
    assert data["admin_note"] == note
    assert data["admin_user_id"] == 3


@pytest.mark.asyncio
async def test_adjust_leader_team_scope(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
):
    """leader는 자기 팀만 조정 가능 (06 §3.10). 타 팀 → 403, 같은 팀 → 200. finalize는 leader 불가."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    first = compute_resp.json()["results"][0]
    note = "팀 스코프 검증을 위한 삼십자 이상의 관리자 조정 사유 텍스트입니다."
    payload = {"admin_adjusted_score": round(first["value"] * 1.05, 4), "admin_note": note}

    # 타 팀 leader (team_id=1 ≠ user1의 erp_team_id=10) → 403
    other_leader = create_access_token(
        {"sub": "2", "email": "leader@example.com", "role": "leader", "team_id": 1},
        expires_delta=timedelta(hours=8),
    )
    r1 = await async_client.post(
        f"/api/kpi-results/{first['id']}/adjust",
        json=payload,
        headers={"Authorization": f"Bearer {other_leader}"},
    )
    assert r1.status_code == 403
    assert "team_scope_violation" in r1.text

    # 같은 팀 leader (team_id=10) → 200
    same_leader = create_access_token(
        {"sub": "2", "email": "leader@example.com", "role": "leader", "team_id": 10},
        expires_delta=timedelta(hours=8),
    )
    r2 = await async_client.post(
        f"/api/kpi-results/{first['id']}/adjust",
        json=payload,
        headers={"Authorization": f"Bearer {same_leader}"},
    )
    assert r2.status_code == 200, r2.text

    # finalize는 admin 전용 — 같은 팀 leader라도 403 (06 §3.10)
    r3 = await async_client.post(
        f"/api/kpi-results/{first['id']}/finalize",
        headers={"Authorization": f"Bearer {same_leader}"},
    )
    assert r3.status_code == 403


@pytest.mark.asyncio
async def test_adjust_out_of_range_rejected(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
):
    """원점수 ±10% 초과 조정 → 422 (08 §3.2 백엔드 강제)."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    first = compute_resp.json()["results"][0]
    note = "±10% 초과 조정이 거부되는지 검증하기 위한 삼십자 이상 조정 사유입니다."

    resp = await async_client.post(
        f"/api/kpi-results/{first['id']}/adjust",
        json={"admin_adjusted_score": first["value"] * 2 + 100, "admin_note": note},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 422
    assert "adjusted_score_out_of_range" in resp.text


@pytest.mark.asyncio
async def test_adjust_note_too_short_rejected(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
):
    """조정 사유 30자 미만 → 422 (08 §3.2 필수 ≥30자)."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    first = compute_resp.json()["results"][0]

    resp = await async_client.post(
        f"/api/kpi-results/{first['id']}/adjust",
        json={"admin_adjusted_score": first["value"], "admin_note": "짧은 사유"},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 422


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
        json={"admin_adjusted_score": 50.0, "admin_note": "권한 없는 일반 직원의 조정 시도가 거부되는지 검증하는 사유입니다"},
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
    first = compute_resp.json()["results"][0]
    result_id = first["id"]
    adjusted = round(first["value"] * 0.95, 4)  # ±10% 이내

    adj = await async_client.post(
        f"/api/kpi-results/{result_id}/adjust",
        json={"admin_adjusted_score": adjusted, "admin_note": "확정 시 조정 점수가 반영되는지 검증하기 위한 조정 사유입니다."},
        headers=admin_auth_headers,
    )
    assert adj.status_code == 200, adj.text

    resp = await async_client.post(f"/api/kpi-results/{result_id}/finalize", headers=admin_auth_headers)
    assert resp.status_code == 200
    assert resp.json()["final_score"] == adjusted


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
async def published_result(
    async_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seed_work_logs,
    admin_auth_headers: dict,
) -> dict:
    """공개(계산 완료, 미확정) 상태 kpi_result — 08 §3.3: 이의는 공개 후 7일 내, 확정 전."""
    compute_resp = await async_client.post(
        "/api/kpi-results/compute",
        json={"user_id": 1, "period_type": "daily", "period_key": "2026-07-01"},
        headers=admin_auth_headers,
    )
    return compute_resp.json()["results"][0]


@pytest.mark.asyncio
async def test_objection_submit(
    async_client: AsyncClient,
    published_result: dict,
    auth_headers: dict,
):
    """본인 이의신청 none → submitted (공개 후·확정 전, 08 §3.3 제출 형식)."""
    resp = await async_client.post(
        f"/api/kpi-results/{published_result['id']}/objections",
        json={
            "category": "data_error",
            "text": "결과물 URL을 제출했으나 미반영된 것으로 보입니다",
            "evidence": [{"type": "link", "url": "https://github.com/pr/100"}],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["objection_status"] == "submitted"
    assert data["objection_detail"]["objection_category"] == "data_error"
    assert data["objection_detail"]["evidence"] == [{"type": "link", "url": "https://github.com/pr/100"}]
    assert data["objection_submitted_at"] is not None


@pytest.mark.asyncio
async def test_objection_invalid_category(
    async_client: AsyncClient,
    published_result: dict,
    auth_headers: dict,
):
    """카테고리 enum(score_basis|missing_signal|data_error) 외 값 → 422."""
    resp = await async_client.post(
        f"/api/kpi-results/{published_result['id']}/objections",
        json={"category": "계산 오류", "text": "자유 한글 카테고리는 더 이상 허용되지 않습니다"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_objection_advance_to_reviewing(
    async_client: AsyncClient,
    published_result: dict,
    auth_headers: dict,
    admin_auth_headers: dict,
):
    """submitted → reviewing."""
    await async_client.post(
        f"/api/kpi-results/{published_result['id']}/objections",
        json={"category": "score_basis", "text": "이의신청 상세 내용을 기술합니다"},
        headers=auth_headers,
    )

    resp = await async_client.post(
        f"/api/kpi-results/{published_result['id']}/objections/review",
        json={"action": "advance"},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["objection_status"] == "reviewing"


@pytest.mark.asyncio
async def test_objection_resolve_finalizes_and_repushes(
    async_client: AsyncClient,
    db_session: AsyncSession,
    published_result: dict,
    auth_headers: dict,
    admin_auth_headers: dict,
):
    """submitted → reviewing → resolved: final_score·finalized_at 확정 + ERP push 적재 (08 §3.3)."""
    rid = published_result["id"]
    base = published_result["value"]
    revised = round(base * 1.05, 4)  # ±10% 이내 재조정

    await async_client.post(
        f"/api/kpi-results/{rid}/objections",
        json={"category": "missing_signal", "text": "회의록 공동작성 2건이 누락 집계되었습니다"},
        headers=auth_headers,
    )
    await async_client.post(
        f"/api/kpi-results/{rid}/objections/review",
        json={"action": "advance"},
        headers=admin_auth_headers,
    )

    resp = await async_client.post(
        f"/api/kpi-results/{rid}/objections/review",
        json={"action": "resolve", "note": "이의 타당, 점수 재조정", "revised_score": revised},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["objection_status"] == "resolved"
    assert data["objection_resolved_at"] is not None
    assert data["final_score"] == revised
    assert data["finalized_at"] is not None  # resolve가 곧 확정

    # ERP 재push 적재 확인
    stmt = select(DailyStatusPush).where(
        DailyStatusPush.user_id == 1,
        DailyStatusPush.target == DailyStatusPushTarget.ERP_KPI_RESULTS,
    )
    pushes = (await db_session.execute(stmt)).scalars().all()
    assert any(p.payload.get("kpi_result_id") == rid for p in pushes)


@pytest.mark.asyncio
async def test_objection_resolve_revised_score_out_of_range(
    async_client: AsyncClient,
    published_result: dict,
    auth_headers: dict,
    admin_auth_headers: dict,
):
    """resolve 재조정도 ±10% 한도 적용 → 422."""
    rid = published_result["id"]
    await async_client.post(
        f"/api/kpi-results/{rid}/objections",
        json={"category": "score_basis", "text": "이의신청 상세 내용을 기술합니다"},
        headers=auth_headers,
    )
    await async_client.post(
        f"/api/kpi-results/{rid}/objections/review",
        json={"action": "advance"},
        headers=admin_auth_headers,
    )
    resp = await async_client.post(
        f"/api/kpi-results/{rid}/objections/review",
        json={"action": "resolve", "revised_score": published_result["value"] * 2 + 100},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_objection_invalid_state_advance(
    async_client: AsyncClient,
    published_result: dict,
    admin_auth_headers: dict,
):
    """submitted 아닌 상태에서 advance → 409."""
    # 이의신청 없이 바로 advance 시도 (status=none)
    resp = await async_client.post(
        f"/api/kpi-results/{published_result['id']}/objections/review",
        json={"action": "advance"},
        headers=admin_auth_headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_objection_after_finalize_rejected(
    async_client: AsyncClient,
    published_result: dict,
    admin_auth_headers: dict,
    auth_headers: dict,
):
    """확정 후 이의신청 → 409 (스펙: 공개~확정 전 7일 창에서만 접수)."""
    rid = published_result["id"]
    fin = await async_client.post(f"/api/kpi-results/{rid}/finalize", headers=admin_auth_headers)
    assert fin.status_code == 200, fin.text

    resp = await async_client.post(
        f"/api/kpi-results/{rid}/objections",
        json={"category": "data_error", "text": "확정 후에는 접수되지 않아야 합니다"},
        headers=auth_headers,
    )
    assert resp.status_code == 409
    assert "already_finalized" in resp.text


@pytest.mark.asyncio
async def test_finalize_blocked_while_objection_in_progress(
    async_client: AsyncClient,
    published_result: dict,
    auth_headers: dict,
    admin_auth_headers: dict,
):
    """이의 진행 중(submitted/reviewing) finalize → 409 (resolve로만 확정)."""
    rid = published_result["id"]
    await async_client.post(
        f"/api/kpi-results/{rid}/objections",
        json={"category": "score_basis", "text": "이의신청 진행 중 확정 차단 검증입니다"},
        headers=auth_headers,
    )
    resp = await async_client.post(f"/api/kpi-results/{rid}/finalize", headers=admin_auth_headers)
    assert resp.status_code == 409
    assert "objection_in_progress" in resp.text


@pytest.mark.asyncio
async def test_objection_other_user_forbidden(
    async_client: AsyncClient,
    published_result: dict,
):
    """타인이 이의신청 → 403."""
    other_token = create_access_token(
        {"sub": "999", "email": "other@example.com", "role": "employee"},
        expires_delta=timedelta(hours=8),
    )
    resp = await async_client.post(
        f"/api/kpi-results/{published_result['id']}/objections",
        json={"category": "data_error", "text": "타인 이의신청 시도"},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_objection_invalid_action(
    async_client: AsyncClient,
    published_result: dict,
    auth_headers: dict,
    admin_auth_headers: dict,
):
    """review action 잘못된 값 → 422."""
    await async_client.post(
        f"/api/kpi-results/{published_result['id']}/objections",
        json={"category": "score_basis", "text": "이의신청 내용입니다"},
        headers=auth_headers,
    )
    resp = await async_client.post(
        f"/api/kpi-results/{published_result['id']}/objections/review",
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
