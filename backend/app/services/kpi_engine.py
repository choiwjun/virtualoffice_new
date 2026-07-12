"""
KPI 결정론 계산 엔진 (Lane C — G003)

결정론적 공식: 같은 입력 → 같은 점수 (감사 요건, D14-e)
metric 어휘 8종 (04-data-model.md §2.5 정본):
  work_completed_count / work_quality_score / minutes_authored_count /
  action_items_completed / action_items_ontime_rate / report_fidelity_score /
  collaboration_score / quarterly_total

D14 폐기 항목 일절 미포함:
  - 시간 비례 점수 (D14-a)
  - 회의 참석 기본점·주최자 가점 (D14-b)
  - 액션 생성 가점 (D14-c)
  - 근태 보정 (D14-d)

collaboration_score 합성 가중치 (08-kpi-logic.md):
  work_completed_count  → 30%
  work_quality_score    → 25%
  minutes_authored_count (+ decisions bonus) → 20%
  action_items (completed + ontime_rate)     → 15%
  report_fidelity_score → 10%
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import (
    ActionItem,
    KpiObjectionStatus,
    KpiPeriodType,
    KpiResult,
    KpiSource,
    MeetingMinute,
    WorkLog,
    WorkLogStatus,
)

# ──────────────────────────────────────────────────────────────────────────────
# 내부 상수
# ──────────────────────────────────────────────────────────────────────────────

# collaboration_score 합성 가중치 (08-kpi-logic 확정)
_W_WORK_COUNT   = 0.30  # work_completed_count
_W_WORK_QUALITY = 0.25  # work_quality_score
_W_MINUTES      = 0.20  # minutes_authored (+ decisions bonus)
_W_ACTIONS      = 0.15  # action_items composite
_W_FIDELITY     = 0.10  # report_fidelity_score

# work_quality_score 충실도 항목별 점수 (합계 = 100점 만점)
_QUALITY_GOAL     = 30.0
_QUALITY_CATEGORY = 20.0
_QUALITY_RESULT_URL = 30.0
_QUALITY_NEXT_ACTION = 20.0

# decisions 가점 (분당 가중치, 상한 20점)
_DECISIONS_PER_ITEM = 2.0
_DECISIONS_CAP      = 20.0

# action_items 일일 인정 상한 (쪼개기 방지, D14-c)
_ACTION_DAILY_CAP = 10

# ──────────────────────────────────────────────────────────────────────────────
# 기간 파싱 헬퍼
# ──────────────────────────────────────────────────────────────────────────────

def _parse_period(period_type: str, period_key: str) -> tuple[date, date]:
    """period_type/period_key → (start_date, end_date) inclusive."""
    if period_type == KpiPeriodType.DAILY or period_type == "daily":
        d = date.fromisoformat(period_key)
        return d, d

    if period_type == KpiPeriodType.QUARTERLY or period_type == "quarterly":
        # 'YYYY-Q#'
        m = re.fullmatch(r"(\d{4})-Q([1-4])", period_key)
        if not m:
            raise ValueError(f"Invalid quarterly period_key: {period_key!r}")
        year, q = int(m.group(1)), int(m.group(2))
        q_start_month = (q - 1) * 3 + 1
        q_end_month = q_start_month + 2
        # last day of q_end_month
        if q_end_month == 12:
            end = date(year, 12, 31)
        else:
            end = date(year, q_end_month + 1, 1).__class__(year, q_end_month + 1, 1)
            # use calendar arithmetic
            import calendar
            last_day = calendar.monthrange(year, q_end_month)[1]
            end = date(year, q_end_month, last_day)
        start = date(year, q_start_month, 1)
        return start, end

    raise ValueError(f"Unsupported period_type: {period_type!r}")


# ──────────────────────────────────────────────────────────────────────────────
# 개별 metric 계산 함수 (모두 결정론적)
# ──────────────────────────────────────────────────────────────────────────────

async def _calc_work_completed_count(
    db: AsyncSession,
    user_id: int,
    start: date,
    end: date,
) -> float:
    """완료(status=completed) work_log 건수 (D14-a, 시간 비례 미반영)."""
    q = select(func.count()).where(
        WorkLog.user_id == user_id,
        WorkLog.status == WorkLogStatus.COMPLETED,
        WorkLog.work_date >= start,
        WorkLog.work_date <= end,
    )
    result = await db.execute(q)
    return float(result.scalar_one())


async def _calc_work_quality_score(
    db: AsyncSession,
    user_id: int,
    start: date,
    end: date,
) -> float:
    """
    완료 work_log의 충실도 평균 (0-100).

    각 완료 로그마다:
      goal 작성   +30
      category    +20
      result_url  +30
      next_action +20

    AI 신뢰도 검증(보일러플레이트/중복) → 이번 구현에서는 결정론적 규칙 기반.
    현재: 텍스트 5자 미만이면 해당 항목 미인정(보일러플레이트 감점).
    """
    q = select(WorkLog).where(
        WorkLog.user_id == user_id,
        WorkLog.status == WorkLogStatus.COMPLETED,
        WorkLog.work_date >= start,
        WorkLog.work_date <= end,
    )
    result = await db.execute(q)
    logs = result.scalars().all()
    if not logs:
        return 0.0

    total = 0.0
    for log in logs:
        score = 0.0
        if log.goal and len(log.goal.strip()) >= 5:
            score += _QUALITY_GOAL
        if log.category and len(log.category.strip()) >= 1:
            score += _QUALITY_CATEGORY
        if log.result_url and len(log.result_url.strip()) >= 5:
            score += _QUALITY_RESULT_URL
        if log.next_action and len(log.next_action.strip()) >= 5:
            score += _QUALITY_NEXT_ACTION
        total += score

    return round(total / len(logs), 2)


async def _calc_minutes_authored_count(
    db: AsyncSession,
    user_id: int,
    start: date,
    end: date,
) -> tuple[float, float]:
    """
    회의록 작성 수 + decisions 가점 raw값 반환 (D14-b).

    반환: (minutes_authored_count, decisions_bonus_raw)
    decisions_bonus_raw는 collaboration_score 합성 시 minutes 비중에 포함.

    결정론적: decisions TEXT의 최상위 리스트 항목(-, *) 수 기준.
    AI 신뢰도 검증: 3글자 미만 항목은 실체 없음으로 제외.
    """
    # meeting_minute.created_by 기준, 기간 내 회의(scheduled_at) 연결
    from app.models.tables import Meeting

    q = (
        select(MeetingMinute)
        .join(Meeting, MeetingMinute.meeting_id == Meeting.id)
        .where(
            MeetingMinute.created_by == user_id,
            func.date(Meeting.scheduled_at) >= start,
            func.date(Meeting.scheduled_at) <= end,
        )
    )
    result = await db.execute(q)
    minutes = result.scalars().all()

    count = float(len(minutes))
    decisions_bonus = 0.0
    for m in minutes:
        if m.decisions:
            items = re.findall(r"^[\-\*]\s+(.+)$", m.decisions, re.MULTILINE)
            valid_items = [i for i in items if len(i.strip()) >= 3]
            bonus = min(len(valid_items) * _DECISIONS_PER_ITEM, _DECISIONS_CAP)
            decisions_bonus += bonus

    return count, decisions_bonus


async def _calc_action_items(
    db: AsyncSession,
    user_id: int,
    start: date,
    end: date,
) -> tuple[float, float]:
    """
    담당 액션아이템 완료 수 + 기한 내 완료율 (D14-c).

    일일 인정 상한(_ACTION_DAILY_CAP)으로 쪼개기 방지.
    반환: (action_items_completed, action_items_ontime_rate)
    """
    from app.models.tables import ActionItemStatus

    # 담당 완료 액션아이템 (기간 내 completed_at 기준)
    # completed_at이 기간 내에 있는 항목 카운트 — daily/quarterly 기간 어느 쪽이든 동작.
    q_completed = select(ActionItem).where(
        ActionItem.assignee_user_id == user_id,
        ActionItem.status == ActionItemStatus.COMPLETED,
        ActionItem.completed_at.is_not(None),
        func.date(ActionItem.completed_at) >= start,
        func.date(ActionItem.completed_at) <= end,
    )
    result = await db.execute(q_completed)
    completed = result.scalars().all()

    # 일일 인정 상한: 날짜별 completed_at 기준 집계 후 cap
    from collections import defaultdict
    daily_counts: dict[date, list[ActionItem]] = defaultdict(list)
    for ai in completed:
        if ai.completed_at:
            d = ai.completed_at.date() if hasattr(ai.completed_at, "date") else ai.completed_at
        else:
            d = ai.due_date
        daily_counts[d].append(ai)

    # cap per day
    capped: list[ActionItem] = []
    for d, items in daily_counts.items():
        capped.extend(items[:_ACTION_DAILY_CAP])

    total_completed = float(len(capped))
    if total_completed == 0:
        return 0.0, 0.0

    ontime = 0
    for ai in capped:
        if ai.completed_at is not None and ai.due_date is not None:
            completed_date = (
                ai.completed_at.date()
                if hasattr(ai.completed_at, "date")
                else ai.completed_at
            )
            if completed_date <= ai.due_date:
                ontime += 1

    ontime_rate = round((ontime / total_completed) * 100, 2)
    return total_completed, ontime_rate


async def _calc_report_fidelity_score(
    db: AsyncSession,
    user_id: int,
    start: date,
    end: date,
) -> float:
    """
    업무기록 충실도 (0-100).

    기간 내 각 날에:
      - work_log 기록이 존재 → 기본점 50
      - 완료 work_log 존재 → +30
      - 평균 work_quality_score 반영 → +20 * (quality/100)
    일일 평균 후 반환.

    보일러플레이트 감점은 _calc_work_quality_score에서 이미 반영됨.
    """
    q = select(WorkLog).where(
        WorkLog.user_id == user_id,
        WorkLog.work_date >= start,
        WorkLog.work_date <= end,
    )
    result = await db.execute(q)
    logs = result.scalars().all()

    if not logs:
        return 0.0

    # 기간 일수
    delta = (end - start).days + 1
    daily: dict[date, list[WorkLog]] = {}
    for log in logs:
        daily.setdefault(log.work_date, []).append(log)

    day_scores = []
    for day_logs in daily.values():
        score = 50.0  # 작성 기본점
        completed = [wl for wl in day_logs if wl.status == WorkLogStatus.COMPLETED]
        if completed:
            score += 30.0
        # quality bonus
        quality_scores = []
        for log in completed:
            q_score = 0.0
            if log.goal and len(log.goal.strip()) >= 5:
                q_score += _QUALITY_GOAL
            if log.category and len(log.category.strip()) >= 1:
                q_score += _QUALITY_CATEGORY
            if log.result_url and len(log.result_url.strip()) >= 5:
                q_score += _QUALITY_RESULT_URL
            if log.next_action and len(log.next_action.strip()) >= 5:
                q_score += _QUALITY_NEXT_ACTION
            quality_scores.append(q_score)
        if quality_scores:
            avg_quality = sum(quality_scores) / len(quality_scores)
            score += 20.0 * (avg_quality / 100.0)

        day_scores.append(min(score, 100.0))

    # 기록이 없는 날은 0점
    missing_days = delta - len(day_scores)
    total = sum(day_scores) + (0.0 * missing_days)
    return round(total / delta, 2)


def _synthesize_collaboration_score(
    work_completed_count: float,
    work_quality_score: float,
    minutes_authored_count: float,
    decisions_bonus: float,
    action_items_completed: float,
    action_items_ontime_rate: float,
    report_fidelity_score: float,
) -> float:
    """
    collaboration_score (0-100) 결정론적 합성.

    가중치 (08-kpi-logic):
      work_completed_count  30%: 건수를 정규화(10건=100점 기준)
      work_quality_score    25%: 0-100 그대로
      minutes_authored(+decisions bonus) 20%
      action_items          15%: completed + ontime_rate 복합
      report_fidelity       10%
    """
    # work_completed: 10건 기준 100점, 상한 100
    work_count_norm = min(work_completed_count * 10.0, 100.0)

    # minutes: 5건 기준 100점, decisions bonus 포함 (상한 100)
    minutes_norm = min(minutes_authored_count * 20.0 + decisions_bonus, 100.0)

    # action_items: completed 기준 (10건=100, 상한 100) + ontime_rate 평균
    action_count_norm = min(action_items_completed * 10.0, 100.0)
    action_composite = (action_count_norm + action_items_ontime_rate) / 2.0

    score = (
        _W_WORK_COUNT   * work_count_norm
        + _W_WORK_QUALITY * work_quality_score
        + _W_MINUTES      * minutes_norm
        + _W_ACTIONS      * action_composite
        + _W_FIDELITY     * report_fidelity_score
    )
    return round(min(max(score, 0.0), 100.0), 2)


# ──────────────────────────────────────────────────────────────────────────────
# 메인 계산 함수
# ──────────────────────────────────────────────────────────────────────────────

async def compute_kpi(
    db: AsyncSession,
    user_id: int,
    period_type: str,
    period_key: str,
) -> dict[str, Any]:
    """
    결정론적 KPI 계산.

    Returns:
        dict: {metric_name: value, ...} — 8종 metric.

    같은 입력(user_id, period_type, period_key)에 DB 데이터가 동일하면
    항상 같은 결과를 반환한다 (감사 요건, D14-e).
    """
    start, end = _parse_period(period_type, period_key)

    work_count = await _calc_work_completed_count(db, user_id, start, end)
    work_quality = await _calc_work_quality_score(db, user_id, start, end)
    minutes_count, decisions_bonus = await _calc_minutes_authored_count(db, user_id, start, end)
    action_completed, action_ontime_rate = await _calc_action_items(db, user_id, start, end)
    fidelity = await _calc_report_fidelity_score(db, user_id, start, end)

    collab = _synthesize_collaboration_score(
        work_count,
        work_quality,
        minutes_count,
        decisions_bonus,
        action_completed,
        action_ontime_rate,
        fidelity,
    )

    # quarterly_total: collaboration_score의 기간 누적 (daily = collab 그대로,
    # quarterly = collaboration_score * 기간 일수의 평균대비 스케일)
    # 정본: quarterly_total은 분기에만 의미, daily에서는 collab과 동일로 저장.
    start_d, end_d = start, end
    period_days = (end_d - start_d).days + 1
    if period_type in (KpiPeriodType.QUARTERLY, "quarterly"):
        # 13주(91일) 기준 스케일
        quarterly_total = round(collab * (period_days / 91.0), 2)
    else:
        quarterly_total = collab

    return {
        "work_completed_count": work_count,
        "work_quality_score": work_quality,
        "minutes_authored_count": minutes_count,
        "action_items_completed": action_completed,
        "action_items_ontime_rate": action_ontime_rate,
        "report_fidelity_score": fidelity,
        "collaboration_score": collab,
        "quarterly_total": quarterly_total,
    }


# ──────────────────────────────────────────────────────────────────────────────
# DB upsert
# ──────────────────────────────────────────────────────────────────────────────

_METRIC_UNITS = {
    "work_completed_count": "count",
    "work_quality_score": "score",
    "minutes_authored_count": "count",
    "action_items_completed": "count",
    "action_items_ontime_rate": "%",
    "report_fidelity_score": "score",
    "collaboration_score": "score",
    "quarterly_total": "score",
}


async def compute_and_upsert_kpi(
    db: AsyncSession,
    user_id: int,
    period_type: str,
    period_key: str,
) -> list[KpiResult]:
    """
    KPI 계산 후 kpi_result 롱포맷 upsert.
    UNIQUE(user_id, period_type, period_key, metric) 기준 upsert.
    정량 값은 결정론적(D14-e). AI 서술 초안(ai_draft)은 집계 metric 행에 별도 생성(REQ-007).
    """

    metrics = await compute_kpi(db, user_id, period_type, period_key)

    results: list[KpiResult] = []
    for metric_name, value in metrics.items():
        # SQLite/PostgreSQL 모두: SELECT → UPDATE/INSERT
        stmt = select(KpiResult).where(
            KpiResult.user_id == user_id,
            KpiResult.period_type == period_type,
            KpiResult.period_key == period_key,
            KpiResult.metric == metric_name,
        )
        existing = (await db.execute(stmt)).scalar_one_or_none()

        now = datetime.now(timezone.utc)
        if existing is not None:
            existing.value = Decimal(str(round(value, 2)))
            existing.updated_at = now
            existing.ai_draft = None  # AI 서술 후속
            results.append(existing)
        else:
            row = KpiResult(
                user_id=user_id,
                period_type=period_type,
                period_key=period_key,
                metric=metric_name,
                value=Decimal(str(round(value, 2))),
                unit=_METRIC_UNITS.get(metric_name, ""),
                source=KpiSource.VIRTUAL_OFFICE,
                ai_draft=None,
                objection_status=KpiObjectionStatus.NONE,
            )
            db.add(row)
            results.append(row)

    await db.flush()

    # AI 서술 초안 생성·부착 (REQ-007). 가명화 후 Claude 또는 mock. 실패해도 KPI 계산은 유효.
    try:
        from app.services.ai_draft import generate_and_attach_draft

        await generate_and_attach_draft(
            db,
            user_id=user_id,
            period_type=period_type,
            period_key=period_key,
            metrics=metrics,
        )
    except Exception as exc:  # 초안 생성 실패가 정량 계산을 무효화하지 않음
        print(f"[KPI] ai_draft generation skipped for user={user_id}: {exc}")

    return results
