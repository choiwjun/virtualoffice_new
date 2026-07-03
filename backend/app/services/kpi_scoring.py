"""
KPI 결정론 점수 계산 서비스 (D14-e).

@SPEC docs/planning/00-decisions.md D14(KPI 로직), D14-e(결정론 점수), D14-d(이중집계 금지)
@SPEC docs/planning/08-kpi-logic.md §2.2 (신호 정의 & 수량화)

**핵심 원칙**:
- 정량 점수는 결정론적 코드로만 계산한다(D14-e). 동일 입력 → 동일 출력.
- AI는 서술(강점/개선/근거)만 생성하며 점수 계산에는 관여하지 않는다.
- attendance/presence(근태) 보정은 KPI 점수에 절대 반영하지 않는다(D14-d, ERP가 별도 반영 —
  이중집계 금지). 이 모듈은 근태 관련 입력을 아예 받지 않는다.
- `compute_kpi_metrics`는 순수 함수다: DB에 접근하지 않고 이미 필터링된 리스트만 받는다.
  (호출자가 대상 user_id + 기간으로 미리 필터링한 work_log/meeting_minute/action_item을 전달)

**8개 metric 중 1~7 산출** (04-data-model.md §2.5 어휘사전). 8번 `quarterly_total`은
분기 집계 배치(G010/D17)의 산출물이며 이 스토리 범위 밖이다(계약 #8 skip 유지).
"""

from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable, Optional

# 04-data-model.md §2.5 metric 어휘사전 (8개 — quarterly_total 포함)
METRIC_VOCABULARY: tuple[str, ...] = (
    "work_completed_count",
    "work_quality_score",
    "minutes_authored_count",
    "action_items_completed",
    "action_items_ontime_rate",
    "report_fidelity_score",
    "collaboration_score",
    "quarterly_total",
)

# collaboration_score 합성 가중치 (08-kpi-logic.md §2.1: 30/25/20/15/10)
_W_COMPLETED = Decimal("0.30")
_W_QUALITY = Decimal("0.25")
_W_MINUTES = Decimal("0.20")
_W_ONTIME = Decimal("0.15")
_W_FIDELITY = Decimal("0.10")

_ZERO = Decimal("0")
_HUNDRED = Decimal("100")
_ONE_DP = Decimal("0.1")


def _round1(value: Decimal) -> Decimal:
    """소수 1자리 반올림 (ROUND_HALF_UP — 감사 재현성, D14-e)."""
    return value.quantize(_ONE_DP, rounding=ROUND_HALF_UP)


def _enum_value(v: Any) -> Optional[str]:
    """Enum(str) 또는 순수 문자열 모두 허용 (ORM 객체·경량 테스트 더블 겸용)."""
    if v is None:
        return None
    return v.value if hasattr(v, "value") else str(v)


def _is_completed_work_log(wl: Any) -> bool:
    return _enum_value(getattr(wl, "status", None)) == "completed"


def _is_completed_action_item(ai: Any) -> bool:
    return _enum_value(getattr(ai, "status", None)) == "completed"


def _work_log_fidelity(wl: Any) -> int:
    """완료 work_log 1건의 충실도(0/25/50/75/100) — goal/category/result_url/next_action 각 25점."""
    score = 0
    if getattr(wl, "goal", None):
        score += 25
    if getattr(wl, "category", None):
        score += 25
    if getattr(wl, "result_url", None):
        score += 25
    if getattr(wl, "next_action", None):
        score += 25
    return score


def compute_kpi_metrics(
    work_logs: Iterable[Any],
    minutes: Iterable[Any],
    action_items: Iterable[Any],
) -> dict[str, Decimal]:
    """
    결정론 KPI metric 1~7 산출 (quarterly_total 제외).

    Args:
        work_logs: 대상 user_id + 기간으로 이미 필터링된 WorkLog(-호환) 리스트.
                    각 항목은 .status(WorkLogStatus|str), .goal, .category, .result_url,
                    .next_action 속성을 가진다.
        minutes: 대상 user_id(created_by) + 기간으로 이미 필터링된 MeetingMinute(-호환) 리스트.
                 (개수만 사용 — 순수 카운트, decisions 가점은 이 스토리 범위 밖)
        action_items: 대상 user_id(assignee_user_id) + 기간으로 이미 필터링된
                      ActionItem(-호환) 리스트. 각 항목은 .status, .completed_at, .due_date.

    Returns:
        dict[metric_vocabulary_key, Decimal] — 1~7번 metric만 (quarterly_total 제외).

    결정론 보장: 순수 함수, DB/시각(now())/난수 비의존. 동일 입력 리스트 → 동일 출력.
    attendance/presence(근태)는 입력 파라미터 자체가 없으므로 구조적으로 미반영(D14-d).
    """
    work_logs = list(work_logs)
    minutes = list(minutes)
    action_items = list(action_items)

    completed_logs = [wl for wl in work_logs if _is_completed_work_log(wl)]
    work_completed_count = Decimal(len(completed_logs))

    if completed_logs:
        fidelity_sum = sum(_work_log_fidelity(wl) for wl in completed_logs)
        work_quality_score = _round1(Decimal(fidelity_sum) / Decimal(len(completed_logs)))
    else:
        work_quality_score = _ZERO

    minutes_authored_count = Decimal(len(minutes))

    completed_items = [ai for ai in action_items if _is_completed_action_item(ai)]
    action_items_completed = Decimal(len(completed_items))

    if completed_items:
        ontime_count = sum(
            1
            for ai in completed_items
            if getattr(ai, "completed_at", None) is not None
            and getattr(ai, "due_date", None) is not None
            and _completed_at_date(ai) <= ai.due_date
        )
        action_items_ontime_rate = _round1(
            Decimal(ontime_count) / Decimal(len(completed_items)) * _HUNDRED
        )
    else:
        action_items_ontime_rate = _ZERO

    if completed_logs:
        fidelity_reported = sum(
            1
            for wl in completed_logs
            if getattr(wl, "result_url", None) or getattr(wl, "next_action", None)
        )
        report_fidelity_score = _round1(
            Decimal(fidelity_reported) / Decimal(len(completed_logs)) * _HUNDRED
        )
    else:
        report_fidelity_score = _ZERO

    _ontime_blend = (
        min(action_items_completed * Decimal(20), _HUNDRED) + action_items_ontime_rate
    ) / Decimal(2)
    collaboration_score = _round1(
        _W_COMPLETED * min(work_completed_count * Decimal(10), _HUNDRED)
        + _W_QUALITY * work_quality_score
        + _W_MINUTES * min(minutes_authored_count * Decimal(20), _HUNDRED)
        + _W_ONTIME * _ontime_blend
        + _W_FIDELITY * report_fidelity_score
    )

    return {
        "work_completed_count": work_completed_count,
        "work_quality_score": work_quality_score,
        "minutes_authored_count": minutes_authored_count,
        "action_items_completed": action_items_completed,
        "action_items_ontime_rate": action_items_ontime_rate,
        "report_fidelity_score": report_fidelity_score,
        "collaboration_score": collaboration_score,
    }


def _completed_at_date(action_item: Any):
    """completed_at(datetime)을 due_date(date)와 비교 가능한 date로 정규화."""
    completed_at = action_item.completed_at
    return completed_at.date() if hasattr(completed_at, "date") else completed_at


# ============================================================================
# DB 집계 래퍼 (선택) — compute_kpi_metrics를 실제 테이블에 적용
# ============================================================================

def period_key_to_range(period_type: Any, period_key: str):
    """
    period_type/period_key(D16) → [start_date, end_date] 폐구간(date, date).

    daily: period_key='YYYY-MM-DD' → 해당 하루.
    quarterly: period_key='YYYY-Q#' → 해당 분기 첫날~마지막날 (Q1=1~3월 …).
    """
    from datetime import date

    period_type_value = _enum_value(period_type)
    if period_type_value == "daily":
        d = date.fromisoformat(period_key)
        return d, d
    if period_type_value == "quarterly":
        try:
            year_s, q_s = period_key.split("-Q")
            year = int(year_s)
            quarter = int(q_s)
        except (ValueError, AttributeError):
            raise ValueError(f"invalid_quarterly_period_key: {period_key}")
        if quarter not in (1, 2, 3, 4):
            raise ValueError(f"invalid_quarter: {quarter}")
        start_month = (quarter - 1) * 3 + 1
        start = date(year, start_month, 1)
        end_month = start_month + 2
        if end_month == 12:
            end = date(year, 12, 31)
        else:
            next_month_first = date(year, end_month + 1, 1)
            from datetime import timedelta

            end = next_month_first - timedelta(days=1)
        return start, end
    raise ValueError(f"unsupported_period_type: {period_type_value}")


async def aggregate_user_period(db, user_id: int, period_type: Any, period_key: str) -> dict[str, Decimal]:
    """
    DB 집계 래퍼: user_id + 기간의 WorkLog/MeetingMinute/ActionItem을 조회해
    compute_kpi_metrics로 위임한다. (compute_kpi_metrics 자체는 여전히 순수/DB비의존)

    action_items는 '기간 내 완료'를 기준으로 집계한다(due_date가 기간 내인 항목 전체를
    가져와 completed 여부는 compute_kpi_metrics가 판단 — 기한이 기간 밖이어도 이미
    완료된 항목의 이행률 왜곡을 피하기 위해 due_date 기준으로 스코프).
    """
    from sqlalchemy import select

    from app.models.tables import ActionItem, MeetingMinute, WorkLog

    start, end = period_key_to_range(period_type, period_key)
    # created_at 계열(datetime)은 반개구간 [start, end_exclusive)으로 비교해야 종료일 자정 이후
    # 시각의 레코드까지 정확히 포함한다(end가 date 자정 00:00 기준이라 <= end만으로는 종료일
    # 회의록이 과소집계됨). work_date/due_date는 Date 컬럼이라 <= end로 폐구간 유지 가능.
    from datetime import datetime, time, timedelta

    end_exclusive = datetime.combine(end + timedelta(days=1), time.min)

    work_logs = (
        await db.execute(
            select(WorkLog).where(
                WorkLog.user_id == user_id,
                WorkLog.work_date >= start,
                WorkLog.work_date <= end,
            )
        )
    ).scalars().all()

    minutes = (
        await db.execute(
            select(MeetingMinute).where(
                MeetingMinute.created_by == user_id,
                MeetingMinute.created_at >= start,
                MeetingMinute.created_at < end_exclusive,
            )
        )
    ).scalars().all()

    action_items = (
        await db.execute(
            select(ActionItem).where(
                ActionItem.assignee_user_id == user_id,
                ActionItem.due_date >= start,
                ActionItem.due_date <= end,
            )
        )
    ).scalars().all()

    return compute_kpi_metrics(work_logs, minutes, action_items)
