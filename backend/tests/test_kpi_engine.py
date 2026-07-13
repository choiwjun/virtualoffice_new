"""
test_kpi_engine.py — KPI 결정론 계산 엔진 테스트 (Lane C — G003)

검증 항목:
1. 결정론성: 같은 입력 반복 → 같은 value (감사 요건, D14-e)
2. 각 metric 공식 검증 (work_completed_count, work_quality_score, 등)
3. collaboration_score 합성 공식 검증
4. D14 폐기 항목 미포함 확인:
   - 시간 비례 점수 미사용 (D14-a)
   - 회의 참석 기본점 없음 (D14-b)
   - 액션 생성 가점 없음 (D14-c)
   - 근태 보정 없음 (D14-d)
5. kpi_result 롱포맷 upsert 검증
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from datetime import date, datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.tables import (
    ActionItem,
    ActionItemStatus,
    ErpUser,
    Meeting,
    MeetingMinute,
    MeetingMinuteStatus,
    MeetingParticipant,
    MeetingStatus,
    WorkLog,
    WorkLogStatus,
    KpiResult,
)
from app.services.kpi_engine import (
    _synthesize_collaboration_score,
    compute_kpi,
    compute_and_upsert_kpi,
    _parse_period,
)


# ──────────────────────────────────────────────────────────────────────────────
# 픽스처
# ──────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def seed_user(db_session: AsyncSession) -> ErpUser:
    """테스트용 ErpUser (KPI 계산 대상)."""
    user = ErpUser(
        id=100,
        company_id=1,
        email="kpi_test@example.com",
        name="KPI Test User",
        erp_team_id=10,
        role="employee",
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def seed_admin_user(db_session: AsyncSession) -> ErpUser:
    """테스트용 admin ErpUser."""
    user = ErpUser(
        id=200,
        company_id=1,
        email="admin_kpi@example.com",
        name="Admin User",
        erp_team_id=10,
        role="admin",
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def seed_office_room(db_session: AsyncSession) -> UUID:
    """SQLite FK 미검증 — room_id용 UUID만 반환 (Office/Floor/Room 불필요)."""
    from uuid import uuid4 as _uuid4
    return _uuid4()


# ──────────────────────────────────────────────────────────────────────────────
# _parse_period 검증
# ──────────────────────────────────────────────────────────────────────────────

def test_parse_period_daily():
    start, end = _parse_period("daily", "2026-07-01")
    assert start == date(2026, 7, 1)
    assert end == date(2026, 7, 1)


def test_parse_period_quarterly():
    start, end = _parse_period("quarterly", "2026-Q3")
    assert start == date(2026, 7, 1)
    assert end == date(2026, 9, 30)


def test_parse_period_quarterly_q1():
    start, end = _parse_period("quarterly", "2026-Q1")
    assert start == date(2026, 1, 1)
    assert end == date(2026, 3, 31)


def test_parse_period_invalid_quarterly():
    with pytest.raises(ValueError):
        _parse_period("quarterly", "2026-Q5")


# ──────────────────────────────────────────────────────────────────────────────
# collaboration_score 합성 단위 테스트 (DB 불필요)
# ──────────────────────────────────────────────────────────────────────────────

def test_collaboration_score_zero_inputs():
    score = _synthesize_collaboration_score(0, 0, 0, 0, 0, 0, 0)
    assert score == 0.0


def test_collaboration_score_max_inputs():
    """모든 항목 만점 → collaboration_score = 100."""
    # work_count=10 (norm=100), quality=100, minutes=5 (norm=100),
    # decisions_bonus=0, action=10 (norm=100), ontime=100, fidelity=100
    score = _synthesize_collaboration_score(10, 100, 5, 0, 10, 100, 100)
    assert score == 100.0


def test_collaboration_score_weights():
    """가중치 30/25/20/15/10 검증."""
    # work_count=10 only
    score_wc = _synthesize_collaboration_score(10, 0, 0, 0, 0, 0, 0)
    assert abs(score_wc - 30.0) < 0.1

    # work_quality=100 only
    score_wq = _synthesize_collaboration_score(0, 100, 0, 0, 0, 0, 0)
    assert abs(score_wq - 25.0) < 0.1

    # minutes=5 only (norm=100, decisions_bonus=0)
    score_mn = _synthesize_collaboration_score(0, 0, 5, 0, 0, 0, 0)
    assert abs(score_mn - 20.0) < 0.1

    # fidelity=100 only
    score_fi = _synthesize_collaboration_score(0, 0, 0, 0, 0, 0, 100)
    assert abs(score_fi - 10.0) < 0.1


def test_collaboration_score_bounded():
    """결과는 항상 0~100."""
    score = _synthesize_collaboration_score(100, 100, 100, 100, 100, 100, 100)
    assert 0.0 <= score <= 100.0


# ──────────────────────────────────────────────────────────────────────────────
# compute_kpi 결정론성 테스트
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_determinism_empty(db_session: AsyncSession, seed_user: ErpUser):
    """데이터 없음 → 두 번 호출해도 같은 결과 (0값)."""
    r1 = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    r2 = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    assert r1 == r2


@pytest.mark.asyncio
async def test_determinism_with_data(db_session: AsyncSession, seed_user: ErpUser):
    """데이터 있을 때 동일 입력 반복 → 동일 value (핵심 감사 요건)."""
    # work_log 추가
    wl = WorkLog(
        user_id=seed_user.id,
        work_date=date(2026, 7, 1),
        title="Test Work",
        status=WorkLogStatus.COMPLETED,
        goal="목표 설정 완료",
        category="개발",
        result_url="https://github.com/pr/1",
        next_action="후속 작업 진행",
    )
    db_session.add(wl)
    await db_session.flush()

    r1 = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    r2 = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    r3 = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")

    assert r1 == r2 == r3, "결정론성 위반: 같은 입력에서 다른 결과 발생"


# ──────────────────────────────────────────────────────────────────────────────
# work_completed_count 공식 검증
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_work_completed_count_only_completed(db_session: AsyncSession, seed_user: ErpUser):
    """started 상태는 count 미산입 (D14-a)."""
    # completed 2건, started 1건
    for i, st in enumerate([WorkLogStatus.COMPLETED, WorkLogStatus.COMPLETED, WorkLogStatus.STARTED]):
        db_session.add(WorkLog(
            user_id=seed_user.id,
            work_date=date(2026, 7, 1),
            title=f"Work {i}",
            status=st,
        ))
    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    assert r["work_completed_count"] == 2.0


@pytest.mark.asyncio
async def test_work_completed_count_date_filter(db_session: AsyncSession, seed_user: ErpUser):
    """기간 외 work_log는 미산입."""
    db_session.add(WorkLog(
        user_id=seed_user.id,
        work_date=date(2026, 6, 30),  # 기간 전날
        title="Past Work",
        status=WorkLogStatus.COMPLETED,
    ))
    db_session.add(WorkLog(
        user_id=seed_user.id,
        work_date=date(2026, 7, 1),
        title="Today Work",
        status=WorkLogStatus.COMPLETED,
    ))
    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    assert r["work_completed_count"] == 1.0


# ──────────────────────────────────────────────────────────────────────────────
# work_quality_score 공식 검증
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_work_quality_score_full(db_session: AsyncSession, seed_user: ErpUser):
    """모든 충실도 항목 작성 시 100점."""
    db_session.add(WorkLog(
        user_id=seed_user.id,
        work_date=date(2026, 7, 1),
        title="Full Quality",
        status=WorkLogStatus.COMPLETED,
        goal="명확한 목표를 설정하였습니다",
        category="개발",
        result_url="https://github.com/pr/1",
        next_action="다음에 할 일을 기술하였습니다",
    ))
    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    assert r["work_quality_score"] == 100.0


@pytest.mark.asyncio
async def test_work_quality_score_no_result_url(db_session: AsyncSession, seed_user: ErpUser):
    """result_url 없으면 충실도 70점 (result_url 30점 미인정)."""
    db_session.add(WorkLog(
        user_id=seed_user.id,
        work_date=date(2026, 7, 1),
        title="No URL",
        status=WorkLogStatus.COMPLETED,
        goal="명확한 목표 설정",
        category="개발",
        result_url=None,
        next_action="다음 액션 작성",
    ))
    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    assert r["work_quality_score"] == 70.0


@pytest.mark.asyncio
async def test_work_quality_score_empty_fields(db_session: AsyncSession, seed_user: ErpUser):
    """모든 충실도 항목 없으면 0점."""
    db_session.add(WorkLog(
        user_id=seed_user.id,
        work_date=date(2026, 7, 1),
        title="Bare Log",
        status=WorkLogStatus.COMPLETED,
    ))
    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    assert r["work_quality_score"] == 0.0


@pytest.mark.asyncio
async def test_work_quality_score_no_time_proportion(db_session: AsyncSession, seed_user: ErpUser):
    """D14-a: est_minutes/actual_minutes는 점수에 영향 없음 (시간 비례 폐기)."""
    # est_minutes 매우 큰 값
    db_session.add(WorkLog(
        user_id=seed_user.id,
        work_date=date(2026, 7, 1),
        title="Long Work",
        status=WorkLogStatus.COMPLETED,
        est_minutes=10000,
        actual_minutes=9999,
        goal="목표 설정",
        category="개발",
        result_url="https://result.example.com",
        next_action="다음 작업",
    ))
    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    # 시간 비례가 없으므로 충실도 100점
    assert r["work_quality_score"] == 100.0
    # work_completed_count = 1 (건수 기반)
    assert r["work_completed_count"] == 1.0


# ──────────────────────────────────────────────────────────────────────────────
# minutes_authored_count 공식 검증 (D14-b)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_minutes_authored_count(
    db_session: AsyncSession,
    seed_user: ErpUser,
    seed_office_room: UUID,
):
    """회의록 created_by 기준 카운트. 참석 기본점 없음 (D14-b)."""
    # 회의 2개 생성
    for i in range(2):
        meeting = Meeting(
            room_id=seed_office_room,
            title=f"Meeting {i}",
            scheduled_at=datetime(2026, 7, 1, 10 + i, 0, tzinfo=timezone.utc),
            host_user_id=seed_user.id,
            status=MeetingStatus.COMPLETED,
        )
        db_session.add(meeting)
        await db_session.flush()

        minute = MeetingMinute(
            meeting_id=meeting.id,
            created_by=seed_user.id,
            decisions="- 결정 사항 1\n- 결정 사항 2",
            status=MeetingMinuteStatus.FINALIZED,
        )
        db_session.add(minute)

    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    assert r["minutes_authored_count"] == 2.0


@pytest.mark.asyncio
async def test_minutes_authored_no_attendance_bonus(
    db_session: AsyncSession,
    seed_user: ErpUser,
    seed_office_room: UUID,
):
    """회의 참석만 하고 회의록 작성 안 하면 minutes_authored_count=0 (D14-b 폐기)."""
    admin = ErpUser(id=201, company_id=1, email="host@example.com", name="Host", erp_team_id=10, role="admin")
    db_session.add(admin)
    await db_session.flush()

    meeting = Meeting(
        room_id=seed_office_room,
        title="Meeting Host By Admin",
        scheduled_at=datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc),
        host_user_id=admin.id,  # seed_user is NOT the host
        status=MeetingStatus.COMPLETED,
    )
    db_session.add(meeting)
    await db_session.flush()

    # seed_user 참석만 (회의록 미작성)
    participant = MeetingParticipant(
        meeting_id=meeting.id,
        user_id=seed_user.id,
        invited_at=datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc),
        joined_at=datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc),
    )
    db_session.add(participant)
    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    # 참석 기본점 없음 (D14-b 폐기)
    assert r["minutes_authored_count"] == 0.0


# ──────────────────────────────────────────────────────────────────────────────
# action_items_completed / action_items_ontime_rate (D14-c)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_action_items_completed_and_ontime_rate(
    db_session: AsyncSession,
    seed_user: ErpUser,
    seed_office_room: UUID,
):
    """완료 5건, 기한 내 4건 → completed=5, ontime_rate=80%."""
    meeting = Meeting(
        room_id=seed_office_room,
        title="AI Meeting",
        scheduled_at=datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc),
        host_user_id=seed_user.id,
        status=MeetingStatus.COMPLETED,
    )
    db_session.add(meeting)
    await db_session.flush()

    # 4건: due_date=7/5, completed_at=7/1 (기한 내 완료 — ontime)
    for i in range(4):
        db_session.add(ActionItem(
            meeting_id=meeting.id,
            title=f"Action {i}",
            assignee_user_id=seed_user.id,
            due_date=date(2026, 7, 5),           # due: 7/5
            status=ActionItemStatus.COMPLETED,
            completed_at=datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc),  # 완료: 7/1
        ))
    # 1건: due_date=6/30, completed_at=7/1 (기한 후 완료 — late)
    db_session.add(ActionItem(
        meeting_id=meeting.id,
        title="Late Action",
        assignee_user_id=seed_user.id,
        due_date=date(2026, 6, 30),              # due: 6/30
        status=ActionItemStatus.COMPLETED,
        completed_at=datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc),  # 완료: 7/1 (due 이후)
    ))
    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    assert r["action_items_completed"] == 5.0
    assert abs(r["action_items_ontime_rate"] - 80.0) < 0.01


@pytest.mark.asyncio
async def test_action_items_no_creation_bonus(
    db_session: AsyncSession,
    seed_user: ErpUser,
    seed_office_room: UUID,
):
    """액션아이템 생성만 하고 미완료 → 점수 없음 (D14-c 폐기: 생성 가점 없음)."""
    meeting = Meeting(
        room_id=seed_office_room,
        title="Meeting",
        scheduled_at=datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc),
        host_user_id=seed_user.id,
        status=MeetingStatus.COMPLETED,
    )
    db_session.add(meeting)
    await db_session.flush()

    # open 상태 (미완료) — 생성만
    db_session.add(ActionItem(
        meeting_id=meeting.id,
        title="Open Action",
        assignee_user_id=seed_user.id,
        due_date=date(2026, 7, 10),
        status=ActionItemStatus.OPEN,
    ))
    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    assert r["action_items_completed"] == 0.0
    assert r["action_items_ontime_rate"] == 0.0


# ──────────────────────────────────────────────────────────────────────────────
# D14 폐기 항목 미포함 확인 (포괄적)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_d14_no_attendance_based_score(
    db_session: AsyncSession,
    seed_user: ErpUser,
    seed_office_room: UUID,
):
    """
    D14-b: 회의 참석만으로는 어떤 metric에도 가점 없음.
    참석 기본점·주최자 가점 폐기 확인.
    """
    admin = ErpUser(id=202, company_id=1, email="host2@example.com", name="Host2", erp_team_id=10, role="admin")
    db_session.add(admin)
    await db_session.flush()

    # 10개 회의에 참석 (host=admin, seed_user는 참석자)
    for i in range(10):
        m = Meeting(
            room_id=seed_office_room,
            title=f"Mtg {i}",
            scheduled_at=datetime(2026, 7, 1, i + 8, 0, tzinfo=timezone.utc),
            host_user_id=admin.id,
            status=MeetingStatus.COMPLETED,
        )
        db_session.add(m)
        await db_session.flush()
        p = MeetingParticipant(
            meeting_id=m.id,
            user_id=seed_user.id,
            invited_at=datetime(2026, 7, 1, i + 7, 0, tzinfo=timezone.utc),
            joined_at=datetime(2026, 7, 1, i + 8, 0, tzinfo=timezone.utc),
        )
        db_session.add(p)

    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    # 참석 기본점 없음 → minutes_authored_count = 0
    assert r["minutes_authored_count"] == 0.0
    # 회의 참석으로 인한 collaboration_score 상승 없음
    # (work/action/fidelity 모두 0이므로 collab=0)
    assert r["collaboration_score"] == 0.0


@pytest.mark.asyncio
async def test_d14_no_time_proportion(db_session: AsyncSession, seed_user: ErpUser):
    """D14-a: est_minutes/actual_minutes 값이 달라도 work_completed_count는 건수 기반."""
    for minutes in [10, 100, 1000]:
        db_session.add(WorkLog(
            user_id=seed_user.id,
            work_date=date(2026, 7, 1),
            title=f"Work {minutes}min",
            status=WorkLogStatus.COMPLETED,
            est_minutes=minutes,
            actual_minutes=minutes,
        ))
    await db_session.flush()

    r = await compute_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    # 시간 비례 아닌 건수 기반
    assert r["work_completed_count"] == 3.0


# ──────────────────────────────────────────────────────────────────────────────
# compute_and_upsert_kpi: 롱포맷 upsert 검증
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upsert_creates_8_rows(db_session: AsyncSession, seed_user: ErpUser):
    """upsert 후 kpi_result rows = 8종 metric."""
    results = await compute_and_upsert_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    await db_session.flush()

    assert len(results) == 8
    metrics = {r.metric for r in results}
    expected = {
        "work_completed_count",
        "work_quality_score",
        "minutes_authored_count",
        "action_items_completed",
        "action_items_ontime_rate",
        "report_fidelity_score",
        "collaboration_score",
        "quarterly_total",
    }
    assert metrics == expected


@pytest.mark.asyncio
async def test_upsert_idempotent(db_session: AsyncSession, seed_user: ErpUser):
    """같은 기간 두 번 upsert → DB rows 수 동일 (8개, 중복 삽입 없음)."""
    await compute_and_upsert_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    await db_session.flush()

    # 두 번째 upsert
    await compute_and_upsert_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    await db_session.flush()

    stmt = select(KpiResult).where(
        KpiResult.user_id == seed_user.id,
        KpiResult.period_type == "daily",
        KpiResult.period_key == "2026-07-01",
    )
    rows = (await db_session.execute(stmt)).scalars().all()
    assert len(rows) == 8


@pytest.mark.asyncio
async def test_upsert_value_updated(db_session: AsyncSession, seed_user: ErpUser):
    """데이터 변경 후 재upsert → value가 업데이트됨."""
    # 초기 upsert (데이터 없음 → 0)
    await compute_and_upsert_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    await db_session.flush()

    # work_log 추가
    db_session.add(WorkLog(
        user_id=seed_user.id,
        work_date=date(2026, 7, 1),
        title="New Work",
        status=WorkLogStatus.COMPLETED,
    ))
    await db_session.flush()

    # 재upsert
    results = await compute_and_upsert_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    await db_session.flush()

    wcc_row = next(r for r in results if r.metric == "work_completed_count")
    assert float(wcc_row.value) == 1.0


@pytest.mark.asyncio
async def test_upsert_ai_draft_on_aggregate_only(db_session: AsyncSession, seed_user: ErpUser):
    """REQ-007: 정량 metric 행은 ai_draft 없음, 분기 집계 행(quarterly_total)에만 서술 부착.

    daily는 초안 미생성 (06 §3.13.1 "AI 서술 초안은 분기에만 존재").
    정량 값(value)은 여전히 결정론적(D14-e) — 서술은 value와 분리된 별도 필드."""
    daily_results = await compute_and_upsert_kpi(db_session, seed_user.id, "daily", "2026-07-01")
    await db_session.flush()
    assert not any(isinstance(r.ai_draft, dict) for r in daily_results)  # daily: 초안 없음

    results = await compute_and_upsert_kpi(db_session, seed_user.id, "quarterly", "2026-Q3")
    await db_session.flush()

    with_draft = [r for r in results if isinstance(r.ai_draft, dict)]
    assert len(with_draft) == 1  # 집계 metric 1행에만
    assert with_draft[0].metric == "quarterly_total"
    assert "strengths" in with_draft[0].ai_draft  # 08 §6.2.2 구조 (2026-07-13 #27 전환)
    # 나머지 정량 metric 행은 서술 없음
    for r in results:
        if r.metric != "quarterly_total":
            assert not isinstance(r.ai_draft, dict)


# ──────────────────────────────────────────────────────────────────────────────
# quarterly 기간 테스트
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_quarterly_compute(db_session: AsyncSession, seed_user: ErpUser):
    """quarterly 기간 계산 — 정상 동작 및 결정론성."""
    # 분기 내 work_log 3건
    for d in [date(2026, 7, 1), date(2026, 8, 15), date(2026, 9, 30)]:
        db_session.add(WorkLog(
            user_id=seed_user.id,
            work_date=d,
            title=f"Q3 Work {d}",
            status=WorkLogStatus.COMPLETED,
            goal="분기 목표",
            category="개발",
            result_url="https://result.url",
            next_action="다음 할 일",
        ))
    await db_session.flush()

    r1 = await compute_kpi(db_session, seed_user.id, "quarterly", "2026-Q3")
    r2 = await compute_kpi(db_session, seed_user.id, "quarterly", "2026-Q3")
    assert r1 == r2
    assert r1["work_completed_count"] == 3.0
    assert r1["quarterly_total"] >= 0


# ──────────────────────────────────────────────────────────────────────────────
# KPI 야간 배치 스케줄러 (_kpi_batch_job) — D16 정본: daily + quarterly만
# ──────────────────────────────────────────────────────────────────────────────

def test_parse_period_batch_types_supported():
    """배치가 넘기는 두 period_type(daily/quarterly)이 KST 현재 period_key로 파싱된다.

    회귀 방지: 스케줄러가 daily+quarterly만 호출해야 한다(D16 weekly/monthly 폐기).
    """
    from datetime import datetime, timedelta, timezone

    kst_now = datetime.now(timezone(timedelta(hours=9)))
    daily_key = kst_now.date().isoformat()
    quarter_key = f"{kst_now.year}-Q{(kst_now.month - 1) // 3 + 1}"

    d_start, d_end = _parse_period("daily", daily_key)
    assert d_start == d_end == kst_now.date()

    q_start, q_end = _parse_period("quarterly", quarter_key)
    assert q_start <= kst_now.date() <= q_end


def test_parse_period_weekly_monthly_rejected():
    """D16 정본: weekly/monthly는 폐기되어 여전히 ValueError여야 한다."""
    with pytest.raises(ValueError):
        _parse_period("weekly", "2026-07-01")
    with pytest.raises(ValueError):
        _parse_period("monthly", "2026-07")


@pytest.mark.asyncio
async def test_kpi_batch_job_upserts_daily_and_quarterly(
    db_session: AsyncSession,
    seed_user: ErpUser,
    monkeypatch,
):
    """실버그 회귀: _kpi_batch_job()이 예외 없이 daily+quarterly를 upsert한다.

    이전 버그: 루프가 daily/weekly/monthly + period_key=None이라
    _parse_period에서 매번 ValueError/TypeError → 배치가 죽었다(kpi_18/kpi_21).
    수정 후: KST 현재값으로 daily/quarterly만 계산, kpi_result 행 생성 확인.
    """
    from datetime import datetime, timedelta, timezone

    from app.services import scheduler as scheduler_mod

    # seed_user를 active로 명시(soft-delete 기본 True지만 배치 필터 조건 충족 보장)
    seed_user.is_active = True
    await db_session.flush()

    # 배치 job은 SessionLocal()로 자체 세션을 연다 → 테스트 세션을 yield하도록 대체.
    class _FakeSessionLocal:
        def __init__(self, session: AsyncSession):
            self._session = session

        async def __aenter__(self) -> AsyncSession:
            return self._session

        async def __aexit__(self, *exc) -> bool:
            return False

    monkeypatch.setattr(
        scheduler_mod, "SessionLocal", lambda: _FakeSessionLocal(db_session)
    )

    # 예외 없이 완료되어야 한다(이전 버그면 여기서 except 브랜치로 빠져 rollback).
    await scheduler_mod._kpi_batch_job()

    kst_now = datetime.now(timezone(timedelta(hours=9)))
    daily_key = kst_now.date().isoformat()
    quarter_key = f"{kst_now.year}-Q{(kst_now.month - 1) // 3 + 1}"

    rows = (
        await db_session.execute(
            select(KpiResult).where(KpiResult.user_id == seed_user.id)
        )
    ).scalars().all()

    period_types = {r.period_type for r in rows}
    assert "daily" in period_types
    assert "quarterly" in period_types
    # weekly/monthly는 절대 생성되지 않아야 한다(D16).
    assert "weekly" not in period_types
    assert "monthly" not in period_types

    # 두 기간의 period_key가 KST 현재값과 일치.
    daily_keys = {r.period_key for r in rows if r.period_type == "daily"}
    quarter_keys = {r.period_key for r in rows if r.period_type == "quarterly"}
    assert daily_keys == {daily_key}
    assert quarter_keys == {quarter_key}

    # collaboration_score metric 행이 daily/quarterly 양쪽에 존재.
    daily_metrics = {r.metric for r in rows if r.period_type == "daily"}
    assert "collaboration_score" in daily_metrics
    assert "quarterly_total" in daily_metrics
