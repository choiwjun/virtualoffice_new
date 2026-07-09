"""
test_ai_draft.py — AI KPI 서술 초안 생성 + D20 가명화 (REQ-007).

검증:
1. 가명화: user_id → 안정적 비가역 라벨, payload PII 치환
2. mock 초안: 결정론적, {강점/개선/근거} 구조, _source=mock
3. 초안이 실명·이메일을 포함하지 않음 (D20)
4. compute_and_upsert_kpi 실행 시 집계 metric 행에 ai_draft 부착
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import ErpUser, KpiResult
from app.services.ai_draft import generate_draft, generate_and_attach_draft, _mock_draft
from app.services.kpi_engine import compute_and_upsert_kpi
from app.services.pseudonymize import (
    pseudonymize_user,
    pseudonymize_payload,
    scrub_pii,
)


@pytest_asyncio.fixture
async def seed_user(db_session: AsyncSession) -> ErpUser:
    user = ErpUser(
        id=100,
        company_id=1,
        email="alice.real@company.com",
        name="김앨리스",
        erp_team_id=10,
        role="employee",
    )
    db_session.add(user)
    await db_session.flush()
    return user


# ── 가명화 (D20) ──────────────────────────────────────────────

def test_pseudonymize_user_stable_and_irreversible():
    a = pseudonymize_user(100)
    b = pseudonymize_user(100)
    assert a == b  # 결정론적(동일 입력 → 동일 라벨)
    assert a.startswith("EMP-")
    assert "100" not in a  # 원본 id 노출 안 함
    assert pseudonymize_user(101) != a  # 다른 사용자 → 다른 라벨


def test_pseudonymize_payload_redacts_pii():
    payload = {"name": "김앨리스", "email": "alice@company.com", "user_id": 100, "note": "문의 alice@company.com"}
    safe = pseudonymize_payload(payload, user_id=100)
    assert safe["name"] == "[redacted]"
    assert safe["user_id"] == pseudonymize_user(100)
    assert "alice@company.com" not in safe["note"]
    assert safe["subject"] == pseudonymize_user(100)
    # 원본 비파괴
    assert payload["name"] == "김앨리스"


def test_scrub_pii():
    assert "@" not in scrub_pii("연락 bob@x.com 참고")
    assert "[id]" in scrub_pii("사번 12345 확인")


# ── mock 초안 ─────────────────────────────────────────────────

def test_mock_draft_structure_deterministic():
    metrics = {"work_completed_count": 6, "action_items_ontime_rate": 90, "collaboration_score": 75}
    d1 = _mock_draft(metrics, subject="EMP-abc123")
    d2 = _mock_draft(metrics, subject="EMP-abc123")
    assert d1 == d2  # 결정론
    assert set(["강점", "개선", "근거", "_source"]).issubset(d1.keys())
    assert d1["_source"] == "mock"


async def test_generate_draft_no_pii_leak():
    """AI 초안에 실명/이메일이 포함되지 않아야 함 (D20)."""
    metrics = {"work_completed_count": 6, "collaboration_score": 80}
    draft = await generate_draft(metrics, user_id=100)
    blob = str(draft)
    assert "김앨리스" not in blob
    assert "@" not in draft["근거"]
    assert pseudonymize_user(100) in draft["근거"]  # 가명 라벨은 포함


# ── kpi_engine 통합 ───────────────────────────────────────────

async def test_compute_attaches_ai_draft(db_session: AsyncSession, seed_user: ErpUser):
    results = await compute_and_upsert_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    assert results  # 정량 계산은 유효

    all_rows = (
        await db_session.execute(
            select(KpiResult).where(
                KpiResult.user_id == seed_user.id,
                KpiResult.period_type == "daily",
                KpiResult.period_key == "2026-07-01",
            )
        )
    ).scalars().all()
    # JSONB None은 SQLite에서 JSON-null로 저장 → SQL 필터 대신 Python으로 dict 판별
    with_draft = [r for r in all_rows if isinstance(r.ai_draft, dict)]
    assert len(with_draft) == 1  # 집계 metric 1행에 초안 부착
    draft = with_draft[0].ai_draft
    assert "강점" in draft and "개선" in draft
    assert with_draft[0].ai_draft_generated_at is not None
