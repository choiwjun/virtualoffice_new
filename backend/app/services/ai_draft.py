"""
AI KPI 서술 초안 생성 (REQ-007, D14-e, D17).

정본:
- 08-kpi-logic.md: AI는 **서술(강점/개선/근거)만** 생성, 정량 점수는 결정론적 코드가 산출(D14-e).
- 00-decisions.md D20: 외부 LLM 전송 전 **가명화** 필수 → services/pseudonymize.py 경유.

동작 모드:
- settings.ai_draft_enabled=True AND nvidia_api_key 존재 → 실제 NVIDIA(OpenAI 호환) API 호출.
- 그 외(기본) → 결정론적 mock 초안. 네트워크·비용·키 없이 테스트/도그푸딩 가능.
- 실패 시 항상 mock으로 폴백 → 배치가 절대 죽지 않음.

반환 형태(ai_draft JSONB, 08 §6.2.2 구조 — 2026-07-13 #27 전환):
{"strengths": [{"strength","example"}], "improvement_areas": [{"area","rationale","actions"[]}],
 "overall_assessment": "상|중상|중|중하|하", "overall_rationale": str,
 "team_percentile": float|None (§5.4 코드 산출·AI 미계산), "_source": "nvidia"|"mock"}
구 평면 구조({"강점","개선","근거"})는 저장된 이력에만 존재 — 프론트가 양쪽 렌더.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.tables import KpiResult
from app.services.ai_client import chat_completion, llm_enabled
from app.services.pseudonymize import pseudonymize_user

# 서술의 기준이 되는 집계 metric (이 행에 초안을 부착)
# D16: period_type은 daily/quarterly 2종만 존재. AI 서술 초안은 분기에만 생성
# (06 §3.13.1 "AI 서술 초안은 분기에만 존재", 08 §6.2.2 분기별 1회).
_AGGREGATE_METRIC_BY_PERIOD = {
    "quarterly": "quarterly_total",
}


def _metrics_summary(metrics: dict[str, float]) -> str:
    """가명화된 정량 요약 문자열 (LLM 프롬프트/근거용, PII 없음)."""
    parts = [f"{k}={round(float(v), 2)}" for k, v in sorted(metrics.items())]
    return ", ".join(parts)


def _readable_summary(metrics: dict[str, float]) -> str:
    """사람이 읽는 정량 요약 문장 — 화면 노출용(원시 metric=value 덤프 금지, 2026-07-17 사용자 지적)."""
    def g(name: str) -> float:
        return float(metrics.get(name, 0) or 0)

    return (
        f"완료 업무 {g('work_completed_count'):.0f}건 · 회의록 {g('minutes_authored_count'):.0f}건 · "
        f"액션 이행 {g('action_items_completed'):.0f}건(정시율 {g('action_items_ontime_rate'):.0f}%) · "
        f"협업 종합 {g('collaboration_score'):.1f}점"
    )


def _overall_band(collab: float) -> tuple[str, str]:
    """서술적 종합 판단(상/중상/중/중하/하) — 근거는 정량 인용(D14-e: 점수 재계산 아님)."""
    if collab >= 85:
        return "상", "협업 종합점수가 상위 구간(85+)에 안정적으로 위치"
    if collab >= 70:
        return "중상", "협업 종합점수가 양호 구간(70~85)에 위치"
    if collab >= 55:
        return "중", "협업 종합점수가 평균 구간(55~70)에 위치"
    if collab >= 40:
        return "중하", "협업 종합점수가 평균 하단(40~55)에 위치"
    return "하", "협업 종합점수가 기준 대비 낮은 구간(40 미만)에 위치"


def _mock_draft(
    metrics: dict[str, float], *, subject: str, team_percentile: Optional[float] = None
) -> dict[str, Any]:
    """결정론적 mock 서술 — 지표 임계값 기반 템플릿(재현 가능). 08 §6.2.2 구조."""
    strengths: list[dict[str, str]] = []
    improvements: list[dict[str, Any]] = []

    def g(name: str) -> float:
        return float(metrics.get(name, 0) or 0)

    if g("work_completed_count") >= 5:
        strengths.append({
            "strength": "업무 완료 건수가 안정적으로 높음",
            "example": f"기간 완료 {g('work_completed_count'):.0f}건",
        })
    else:
        improvements.append({
            "area": "업무 처리량",
            "rationale": f"완료 건수 {g('work_completed_count'):.0f}건 — 기준(5건) 대비 낮음",
            "actions": ["업무 분할 크기 점검", "차단 요인을 일일 기록의 이슈란에 남기기"],
        })

    if g("action_items_ontime_rate") >= 80:
        strengths.append({
            "strength": "액션아이템 기한 준수율 우수",
            "example": f"준수율 {g('action_items_ontime_rate'):.0f}%",
        })
    elif g("action_items_ontime_rate") > 0:
        improvements.append({
            "area": "액션아이템 기한 관리",
            "rationale": f"준수율 {g('action_items_ontime_rate'):.0f}% — 개선 여지",
            "actions": ["기한 임박 액션 주간 점검", "지연 예상 시 조기 재협의"],
        })

    if g("collaboration_score") >= 70:
        strengths.append({
            "strength": "협업 지표 양호",
            "example": f"협업 종합점수 {g('collaboration_score'):.1f}점",
        })
    else:
        improvements.append({
            "area": "협업 참여",
            "rationale": f"협업 종합점수 {g('collaboration_score'):.1f}점 — 기준(70점) 미만",
            "actions": ["회의록 작성 참여 확대", "결정사항(decisions) 기록 습관화"],
        })

    if 0 < g("report_fidelity_score") < 60:
        improvements.append({
            "area": "업무기록 충실도",
            "rationale": f"기록 충실도 {g('report_fidelity_score'):.1f}점 — 기준(60점) 미만",
            "actions": ["목표·결과 URL·다음 액션 4항목 채우기"],
        })

    if not strengths:
        strengths.append({
            "strength": "전 지표가 기준 범위 내에서 무난히 유지됨",
            "example": _readable_summary(metrics),
        })
    if not improvements:
        improvements.append({"area": "현 수준 유지", "rationale": "특이 리스크 없음", "actions": []})

    assessment, rationale_head = _overall_band(g("collaboration_score"))
    return {
        "strengths": strengths,
        "improvement_areas": improvements,
        "overall_assessment": assessment,
        "overall_rationale": f"{rationale_head}. 기간 집계: {_readable_summary(metrics)}",
        "team_percentile": team_percentile,
        "_source": "mock",
    }


def _extract_json_object(text: str) -> dict[str, Any]:
    """모델 출력에서 JSON 오브젝트 추출(```json 코드펜스·전후 산문 허용)."""
    t = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", t, re.DOTALL)
    if fence:
        t = fence.group(1)
    else:
        start, end = t.find("{"), t.rfind("}")
        if start != -1 and end > start:
            t = t[start : end + 1]
    return json.loads(t)


async def _llm_draft(
    metrics: dict[str, float], *, subject: str, team_percentile: Optional[float] = None
) -> dict[str, Any]:
    """실제 NVIDIA(OpenAI 호환) 호출. 실패 시 예외 → 호출부에서 mock 폴백. 08 §6.2.2 구조."""
    pct_line = (
        f"team_percentile(코드 산출값, 그대로 인용): {team_percentile}"
        if team_percentile is not None
        else "team_percentile: 미제공(모수 부족) — 언급하지 마라"
    )
    schema_line = (
        '{"strengths": [{"strength": "...", "example": "..."}],'
        ' "improvement_areas": [{"area": "...", "rationale": "...", "actions": ["..."]}],'
        ' "overall_assessment": "상|중상|중|중하|하", "overall_rationale": "..."}'
    )
    prompt = (
        "너는 인사 평가 보조자다. 아래는 한 직원(가명)의 결정론적 KPI 정량 지표다. "
        "정량 점수를 새로 만들거나 수정하지 말고, 서술만 한국어로 간결하게 작성하라. "
        "실명·성격 판단·절대표현을 쓰지 마라. 백분위 등 수치는 제공된 값만 인용하라.\n\n"
        f"대상: {subject}\n지표: {_metrics_summary(metrics)}\n{pct_line}\n\n"
        f"반드시 아래 JSON 스키마로만 답하라(08 §6.2.2):\n{schema_line}"
    )
    text = await chat_completion(
        [{"role": "user", "content": prompt}],
        max_tokens=900,
        temperature=0.4,
    )
    data = _extract_json_object(text)
    if not isinstance(data.get("strengths"), list) or not isinstance(
        data.get("improvement_areas"), list
    ):
        raise ValueError("llm draft schema mismatch")
    assessment = str(data.get("overall_assessment", "")).strip()
    if assessment not in {"상", "중상", "중", "중하", "하"}:
        raise ValueError("llm overall_assessment out of vocabulary")
    return {
        "strengths": data["strengths"],
        "improvement_areas": data["improvement_areas"],
        "overall_assessment": assessment,
        "overall_rationale": str(data.get("overall_rationale", "")),
        "team_percentile": team_percentile,  # 코드 산출값 강제 — AI 응답값 무시 (D14-e)
        "_source": "nvidia",
    }


async def generate_draft(
    metrics: dict[str, float], *, user_id: int, team_percentile: Optional[float] = None
) -> dict[str, Any]:
    """
    가명화 → (조건부) NVIDIA 호출 → 실패 시 mock 폴백. 항상 dict 반환.
    개인식별정보는 subject(가명 라벨)로만 전달된다(D20).
    team_percentile은 코드(kpi_engine §5.4)가 산출해 주입 — AI가 계산하지 않음(D14-e).
    """
    subject = pseudonymize_user(user_id)  # 실명·사번 대신 가명 라벨만 사용
    if llm_enabled():
        try:
            return await _llm_draft(metrics, subject=subject, team_percentile=team_percentile)
        except Exception:
            # 네트워크/키/파싱 실패 → 배치 중단 없이 mock 폴백
            pass
    return _mock_draft(metrics, subject=subject, team_percentile=team_percentile)


async def generate_and_attach_draft(
    db: AsyncSession,
    *,
    user_id: int,
    period_type: str,
    period_key: str,
    metrics: Optional[dict[str, float]] = None,
) -> Optional[dict[str, Any]]:
    """
    해당 (user, period) 집계 metric 행에 ai_draft를 생성·부착.
    metrics 미제공 시 저장된 kpi_result 행에서 재구성.
    반환: 생성된 draft dict (대상 행 없으면 None).
    """
    rows = (
        await db.execute(
            select(KpiResult).where(
                KpiResult.user_id == user_id,
                KpiResult.period_type == period_type,
                KpiResult.period_key == period_key,
            )
        )
    ).scalars().all()
    if not rows:
        return None

    # AI 서술 초안은 분기(quarterly)에만 생성 — daily는 정량 지표만 (06 §3.13.1, 08 §6.2.2)
    if period_type not in _AGGREGATE_METRIC_BY_PERIOD:
        return None

    if metrics is None:
        metrics = {r.metric: float(r.value) for r in rows}

    # 08 §5.4: 팀 백분위는 코드가 산출해 AI 입력으로 제공 (모수 부족 시 None=미표시)
    from app.services.kpi_engine import compute_team_percentile

    team_percentile = await compute_team_percentile(db, user_id, period_type, period_key)

    draft = await generate_draft(metrics, user_id=user_id, team_percentile=team_percentile)

    agg_metric = _AGGREGATE_METRIC_BY_PERIOD[period_type]
    target = next((r for r in rows if r.metric == agg_metric), rows[0])
    target.ai_draft = draft
    target.ai_draft_generated_at = datetime.now(timezone.utc)
    target.ai_model = settings.ai_draft_model if draft.get("_source") == "nvidia" else "mock"
    await db.flush()
    return draft
