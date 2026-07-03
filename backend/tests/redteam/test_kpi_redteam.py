"""
G008 KPI 평가 API 적대적(red-team) e2e 테스트.

목적: backend/app/api/kpi.py, backend/app/services/kpi_scoring.py 를 깨뜨리는 것을
목표로 하는 독립 스위트. 제품 코드/모델은 절대 수정하지 않는다 — 취약점 발견 시 blocker로 보고.

@SPEC docs/planning/00-decisions.md D14(KPI 로직), D14-d(이중집계 금지), D14-e(결정론),
      D15(이의신청 상태머신), D16(롱포맷 스키마)
@SPEC backend/app/api/kpi.py
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import ErpRole, ErpUser, KpiObjectionStatus, KpiPeriodType, KpiResult, KpiSource

pytestmark = pytest.mark.asyncio


# ============================================================================
# 헬퍼: 시드
# ============================================================================

async def _seed_user(db_session: AsyncSession, user_id: int, *, team_id: int = 1, email: str = None) -> ErpUser:
    user = ErpUser(
        id=user_id,
        company_id=1,
        email=email or f"user{user_id}@example.com",
        name=f"User {user_id}",
        erp_team_id=team_id,
        role=ErpRole.EMPLOYEE,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _seed_kpi(
    db_session: AsyncSession,
    *,
    user_id: int = 1,
    period_type: KpiPeriodType = KpiPeriodType.QUARTERLY,
    period_key: str = "2026-Q3",
    metric: str = "collaboration_score",
    value: Decimal = Decimal("50.00"),
    created_at: datetime = None,
    objection_status: KpiObjectionStatus = KpiObjectionStatus.NONE,
) -> KpiResult:
    kr = KpiResult(
        user_id=user_id,
        period_type=period_type,
        period_key=period_key,
        metric=metric,
        value=value,
        source=KpiSource.VIRTUAL_OFFICE,
        objection_status=objection_status,
        **({"created_at": created_at} if created_at is not None else {}),
    )
    db_session.add(kr)
    await db_session.commit()
    await db_session.refresh(kr)
    return kr


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# 1) 인증/입력 검증
# ============================================================================

async def test_list_kpi_results_requires_auth(db_session, async_client: AsyncClient):
    r = await async_client.get("/kpi-results")
    assert r.status_code == 401, r.text


async def test_metrics_vocabulary_requires_auth(db_session, async_client: AsyncClient):
    r = await async_client.get("/kpi/metrics")
    assert r.status_code == 401, r.text


@pytest.mark.parametrize("bad_id", ["not-a-uuid", "kpi-001", "1' OR '1'='1"])
async def test_malformed_kpi_result_id_returns_404_not_422(
    db_session, async_client: AsyncClient, auth_headers, admin_auth_headers, bad_id
):
    g = await async_client.get(f"/kpi-results/{bad_id}", headers=auth_headers)
    assert g.status_code == 404, g.text
    a = await async_client.put(
        f"/kpi-results/{bad_id}/adjust",
        json={"admin_adjusted_score": 10.0},
        headers=admin_auth_headers,
    )
    assert a.status_code == 404, a.text
    c = await async_client.post(f"/kpi-results/{bad_id}/confirm", headers=admin_auth_headers)
    assert c.status_code == 404, c.text
    o = await async_client.post(
        f"/kpi-results/{bad_id}/objections",
        json={"category": "calculation_error", "text": "x"},
        headers=auth_headers,
    )
    assert o.status_code == 404, o.text
    d = await async_client.get(f"/kpi-results/{bad_id}/ai-draft", headers=auth_headers)
    assert d.status_code == 404, d.text


# ============================================================================
# 2) RBAC — 조회 (employee 본인 / leader 팀 / admin 전체)
# ============================================================================

async def test_employee_cannot_read_others_kpi(
    db_session, async_client: AsyncClient, auth_headers
):
    # employee(auth_headers=sub 1)와 다른 user_id(999)의 KPI → 존재 미노출 404
    await _seed_user(db_session, 999, team_id=99)
    kr = await _seed_kpi(db_session, user_id=999)
    r = await async_client.get(f"/kpi-results/{kr.id}", headers=auth_headers)
    assert r.status_code == 404, r.text


async def test_leader_cannot_read_other_team_kpi(
    db_session, async_client: AsyncClient, leader_token
):
    # leader_token team_id=1, 대상 유저는 team_id=99 → 팀 밖 404
    await _seed_user(db_session, 999, team_id=99)
    kr = await _seed_kpi(db_session, user_id=999)
    r = await async_client.get(f"/kpi-results/{kr.id}", headers=_bearer(leader_token))
    assert r.status_code == 404, r.text


async def test_leader_can_read_own_team_kpi(
    db_session, async_client: AsyncClient, leader_token, test_user
):
    # test_user(id=1) erp_team_id=1 == leader_token team_id=1
    kr = await _seed_kpi(db_session, user_id=1)
    r = await async_client.get(f"/kpi-results/{kr.id}", headers=_bearer(leader_token))
    assert r.status_code == 200, r.text


async def test_admin_can_read_any_kpi(
    db_session, async_client: AsyncClient, admin_auth_headers
):
    await _seed_user(db_session, 999, team_id=99)
    kr = await _seed_kpi(db_session, user_id=999)
    r = await async_client.get(f"/kpi-results/{kr.id}", headers=admin_auth_headers)
    assert r.status_code == 200, r.text


async def test_list_scoped_to_self_by_default_for_employee(
    db_session, async_client: AsyncClient, auth_headers, test_user
):
    await _seed_user(db_session, 999, team_id=99)
    await _seed_kpi(db_session, user_id=1, metric="work_completed_count")
    await _seed_kpi(db_session, user_id=999, metric="work_completed_count")

    r = await async_client.get("/kpi-results", headers=auth_headers)
    assert r.status_code == 200, r.text
    results = r.json()["kpi_results"]
    assert len(results) == 1
    assert results[0]["user_id"] == 1


async def test_employee_cannot_list_other_user_id(
    db_session, async_client: AsyncClient, auth_headers
):
    r = await async_client.get("/kpi-results?user_id=999", headers=auth_headers)
    assert r.status_code == 403, r.text


# ============================================================================
# 3) RBAC — 관리자 전용 (adjust/confirm)
# ============================================================================

async def test_adjust_forbidden_for_employee(
    db_session, async_client: AsyncClient, auth_headers, test_user
):
    kr = await _seed_kpi(db_session, user_id=1)
    r = await async_client.put(
        f"/kpi-results/{kr.id}/adjust",
        json={"admin_adjusted_score": 99.0},
        headers=auth_headers,
    )
    assert r.status_code == 403, r.text


async def test_adjust_forbidden_for_leader(
    db_session, async_client: AsyncClient, leader_token, test_user
):
    kr = await _seed_kpi(db_session, user_id=1)
    r = await async_client.put(
        f"/kpi-results/{kr.id}/adjust",
        json={"admin_adjusted_score": 99.0},
        headers=_bearer(leader_token),
    )
    assert r.status_code == 403, r.text


async def test_confirm_forbidden_for_non_admin(
    db_session, async_client: AsyncClient, auth_headers, test_user
):
    kr = await _seed_kpi(db_session, user_id=1)
    r = await async_client.post(f"/kpi-results/{kr.id}/confirm", headers=auth_headers)
    assert r.status_code == 403, r.text


async def test_aggregate_forbidden_for_non_admin(
    db_session, async_client: AsyncClient, auth_headers
):
    r = await async_client.post("/kpi/aggregate?period=2026-Q3", headers=auth_headers)
    assert r.status_code == 403, r.text


# ============================================================================
# 4) 이의신청 상태머신 + 유예기간
# ============================================================================

async def test_objection_submit_by_non_owner_forbidden(
    db_session, async_client: AsyncClient, auth_headers, test_user
):
    # KPI 소유자는 999, 요청자는 employee(1) → 403
    await _seed_user(db_session, 999, team_id=99)
    kr = await _seed_kpi(db_session, user_id=999)
    r = await async_client.post(
        f"/kpi-results/{kr.id}/objections",
        json={"category": "calculation_error", "text": "타인 이의신청 시도"},
        headers=auth_headers,
    )
    assert r.status_code == 403, r.text


async def test_objection_duplicate_submission_conflict(
    db_session, async_client: AsyncClient, auth_headers, test_user
):
    kr = await _seed_kpi(db_session, user_id=1)
    first = await async_client.post(
        f"/kpi-results/{kr.id}/objections",
        json={"category": "calculation_error", "text": "최초 이의신청"},
        headers=auth_headers,
    )
    assert first.status_code == 201, first.text

    second = await async_client.post(
        f"/kpi-results/{kr.id}/objections",
        json={"category": "calculation_error", "text": "중복 이의신청"},
        headers=auth_headers,
    )
    assert second.status_code == 409, second.text


async def test_objection_grace_period_expired_returns_410(
    db_session, async_client: AsyncClient, auth_headers, test_user
):
    old = await _seed_kpi(
        db_session, user_id=1, created_at=datetime.now(timezone.utc) - timedelta(days=8)
    )
    r = await async_client.post(
        f"/kpi-results/{old.id}/objections",
        json={"category": "calculation_error", "text": "유예기간 초과"},
        headers=auth_headers,
    )
    assert r.status_code == 410, r.text


async def test_objection_within_grace_period_boundary_accepted(
    db_session, async_client: AsyncClient, auth_headers, test_user
):
    # 6일 23시간 경과 → 아직 유예기간 내(7일 이내) → 201
    fresh = await _seed_kpi(
        db_session,
        user_id=1,
        period_key="2026-Q2",
        created_at=datetime.now(timezone.utc) - timedelta(days=6, hours=23),
    )
    r = await async_client.post(
        f"/kpi-results/{fresh.id}/objections",
        json={"category": "calculation_error", "text": "경계값 내 제출"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text


async def test_objection_no_backward_transition_after_resolved(
    db_session, async_client: AsyncClient, auth_headers, admin_auth_headers, test_user
):
    kr = await _seed_kpi(db_session, user_id=1)
    submit = await async_client.post(
        f"/kpi-results/{kr.id}/objections",
        json={"category": "calculation_error", "text": "이의"},
        headers=auth_headers,
    )
    assert submit.status_code == 201, submit.text

    # D15: submitted 상태에서 바로 confirm은 409 — 먼저 adjust로 재검토(reviewing) 착수해야 함.
    premature_confirm = await async_client.post(
        f"/kpi-results/{kr.id}/confirm", headers=admin_auth_headers
    )
    assert premature_confirm.status_code == 409, premature_confirm.text
    assert premature_confirm.json()["detail"] == "objection_pending_review"

    adjust = await async_client.put(
        f"/kpi-results/{kr.id}/adjust",
        json={"admin_adjusted_score": 55.0, "admin_note": "재검토"},
        headers=admin_auth_headers,
    )
    assert adjust.status_code == 200, adjust.text
    assert adjust.json()["objection_status"] == "reviewing"

    confirm = await async_client.post(f"/kpi-results/{kr.id}/confirm", headers=admin_auth_headers)
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["objection_status"] == "resolved"

    # resolved 상태에서 재제출 시도 → 상태가 다시 submitted로 역행하지 않고 409
    resubmit = await async_client.post(
        f"/kpi-results/{kr.id}/objections",
        json={"category": "calculation_error", "text": "재제출 시도"},
        headers=auth_headers,
    )
    assert resubmit.status_code == 409, resubmit.text
    detail = await async_client.get(f"/kpi-results/{kr.id}", headers=auth_headers)
    assert detail.json()["objection_status"] == "resolved"


# ============================================================================
# 5) adjust/confirm 동작 정확성
# ============================================================================

async def test_adjust_score_reflected_in_final_score_after_confirm(
    db_session, async_client: AsyncClient, admin_auth_headers, test_user
):
    kr = await _seed_kpi(db_session, user_id=1, value=Decimal("50.00"))
    adjust = await async_client.put(
        f"/kpi-results/{kr.id}/adjust",
        json={"admin_adjusted_score": 77.5, "admin_note": "보정"},
        headers=admin_auth_headers,
    )
    assert adjust.status_code == 200, adjust.text

    confirm = await async_client.post(f"/kpi-results/{kr.id}/confirm", headers=admin_auth_headers)
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["final_score"] == 77.5


async def test_confirm_without_adjust_uses_raw_value(
    db_session, async_client: AsyncClient, admin_auth_headers, test_user
):
    kr = await _seed_kpi(db_session, user_id=1, value=Decimal("64.30"))
    confirm = await async_client.post(f"/kpi-results/{kr.id}/confirm", headers=admin_auth_headers)
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["final_score"] == 64.3


async def test_confirm_is_idempotent(
    db_session, async_client: AsyncClient, admin_auth_headers, test_user
):
    kr = await _seed_kpi(db_session, user_id=1, value=Decimal("40.00"))
    first = await async_client.post(f"/kpi-results/{kr.id}/confirm", headers=admin_auth_headers)
    assert first.status_code == 200, first.text
    finalized_first = first.json()["finalized_at"]

    second = await async_client.post(f"/kpi-results/{kr.id}/confirm", headers=admin_auth_headers)
    assert second.status_code == 200, second.text
    assert second.json()["finalized_at"] == finalized_first
    assert second.json()["final_score"] == 40.0

async def test_confirm_on_submitted_objection_returns_409(
    db_session, async_client: AsyncClient, auth_headers, admin_auth_headers, test_user
):
    """D15: 미검토(submitted) 이의신청 상태에서 confirm 시도 → 409 objection_pending_review."""
    kr = await _seed_kpi(db_session, user_id=1)
    submit = await async_client.post(
        f"/kpi-results/{kr.id}/objections",
        json={"category": "calculation_error", "text": "이의"},
        headers=auth_headers,
    )
    assert submit.status_code == 201, submit.text

    confirm = await async_client.post(f"/kpi-results/{kr.id}/confirm", headers=admin_auth_headers)
    assert confirm.status_code == 409, confirm.text
    assert confirm.json()["detail"] == "objection_pending_review"

    detail = await async_client.get(f"/kpi-results/{kr.id}", headers=auth_headers)
    assert detail.json()["objection_status"] == "submitted"
    assert detail.json()["finalized_at"] is None


async def test_adjust_after_finalized_returns_409(
    db_session, async_client: AsyncClient, admin_auth_headers, test_user
):
    """D15: 확정(finalized_at 설정) 후 adjust 시도 → 409 kpi_already_finalized (값 괴리 방지)."""
    kr = await _seed_kpi(db_session, user_id=1, value=Decimal("40.00"))
    confirm = await async_client.post(f"/kpi-results/{kr.id}/confirm", headers=admin_auth_headers)
    assert confirm.status_code == 200, confirm.text

    adjust = await async_client.put(
        f"/kpi-results/{kr.id}/adjust",
        json={"admin_adjusted_score": 90.0, "admin_note": "확정 후 조정 시도"},
        headers=admin_auth_headers,
    )
    assert adjust.status_code == 409, adjust.text
    assert adjust.json()["detail"] == "kpi_already_finalized"


async def test_adjust_negative_score_returns_400(
    db_session, async_client: AsyncClient, admin_auth_headers, test_user
):
    """모델 제약(value>=0) 정합: 음수 admin_adjusted_score → 400 invalid_adjusted_score."""
    kr = await _seed_kpi(db_session, user_id=1)
    adjust = await async_client.put(
        f"/kpi-results/{kr.id}/adjust",
        json={"admin_adjusted_score": -5.0, "admin_note": "잘못된 값"},
        headers=admin_auth_headers,
    )
    assert adjust.status_code == 400, adjust.text
    assert adjust.json()["detail"] == "invalid_adjusted_score"


# ============================================================================
# 6) 결정론 검증 (D14-e) — DB 집계 래퍼 포함
# ============================================================================

async def test_deterministic_metrics_same_input_same_output_via_service(db_session):
    from types import SimpleNamespace

    from app.services.kpi_scoring import compute_kpi_metrics

    def _inputs():
        return (
            [
                SimpleNamespace(status="completed", goal="g", category="c",
                                 result_url="u", next_action="n"),
                SimpleNamespace(status="completed", goal=None, category=None,
                                 result_url=None, next_action=None),
            ],
            [SimpleNamespace(created_by=1)],
            [],
        )

    out1 = compute_kpi_metrics(*_inputs())
    out2 = compute_kpi_metrics(*_inputs())
    assert out1 == out2
    # attendance/presence 미반영: 함수 인자로 존재하지 않음(구조적 방지, D14-d)
    assert out1["work_completed_count"] == 2
    assert out1["work_quality_score"] == Decimal("50.0")
