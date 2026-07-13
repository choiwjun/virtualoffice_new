"""
AI KPI 서술 초안 생성 (REQ-007, D14-e, D17).

정본:
- 08-kpi-logic.md: AI는 **서술(강점/개선/근거)만** 생성, 정량 점수는 결정론적 코드가 산출(D14-e).
- 00-decisions.md D20: 외부 LLM 전송 전 **가명화** 필수 → services/pseudonymize.py 경유.

동작 모드:
- settings.ai_draft_enabled=True AND nvidia_api_key 존재 → 실제 NVIDIA(OpenAI 호환) API 호출.
- 그 외(기본) → 결정론적 mock 초안. 네트워크·비용·키 없이 테스트/도그푸딩 가능.
- 실패 시 항상 mock으로 폴백 → 배치가 절대 죽지 않음.

반환 형태(ai_draft JSONB): {"강점": str, "개선": str, "근거": str, "_source": "nvidia"|"mock"}
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


def _mock_draft(metrics: dict[str, float], *, subject: str) -> dict[str, Any]:
    """결정론적 mock 서술 — 지표 임계값 기반 템플릿(재현 가능)."""
    strengths: list[str] = []
    improvements: list[str] = []

    def g(name: str) -> float:
        return float(metrics.get(name, 0) or 0)

    if g("work_completed_count") >= 5:
        strengths.append("업무 완료 건수가 안정적으로 높음")
    else:
        improvements.append("업무 완료 건수가 기준 대비 낮아 처리량 점검 필요")

    if g("action_items_ontime_rate") >= 80:
        strengths.append("액션아이템 기한 준수율 우수")
    elif g("action_items_ontime_rate") > 0:
        improvements.append("액션아이템 기한 준수율 개선 여지 있음")

    if g("collaboration_score") >= 70:
        strengths.append("협업 지표 양호")
    else:
        improvements.append("협업(회의록·상호작용) 참여 확대 권장")

    if g("report_fidelity_score") < 60 and g("report_fidelity_score") > 0:
        improvements.append("업무기록 충실도 보강 필요")

    if not strengths:
        strengths.append("전 지표가 기준 범위 내에서 무난히 유지됨")
    if not improvements:
        improvements.append("현 수준 유지, 특이 리스크 없음")

    return {
        "강점": " / ".join(strengths),
        "개선": " / ".join(improvements),
        "근거": f"대상 {subject}의 집계 지표: {_metrics_summary(metrics)}",
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


async def _llm_draft(metrics: dict[str, float], *, subject: str) -> dict[str, Any]:
    """실제 NVIDIA(OpenAI 호환) 호출. 실패 시 예외 → 호출부에서 mock 폴백."""
    prompt = (
        "너는 인사 평가 보조자다. 아래는 한 직원(가명)의 결정론적 KPI 정량 지표다. "
        "정량 점수를 새로 만들지 말고, 오직 '강점/개선/근거' 서술만 한국어로 간결하게 작성하라. "
        "실명·점수 산정 로직을 지어내지 마라.\n\n"
        f"대상: {subject}\n지표: {_metrics_summary(metrics)}\n\n"
        '반드시 JSON으로만 답하라: {"강점": "...", "개선": "...", "근거": "..."}'
    )
    text = await chat_completion(
        [{"role": "user", "content": prompt}],
        max_tokens=600,
        temperature=0.4,
    )
    data = _extract_json_object(text)
    return {
        "강점": str(data.get("강점", "")),
        "개선": str(data.get("개선", "")),
        "근거": str(data.get("근거", "")),
        "_source": "nvidia",
    }


async def generate_draft(metrics: dict[str, float], *, user_id: int) -> dict[str, Any]:
    """
    가명화 → (조건부) NVIDIA 호출 → 실패 시 mock 폴백. 항상 dict 반환.
    개인식별정보는 subject(가명 라벨)로만 전달된다(D20).
    """
    subject = pseudonymize_user(user_id)  # 실명·사번 대신 가명 라벨만 사용
    if llm_enabled():
        try:
            return await _llm_draft(metrics, subject=subject)
        except Exception:
            # 네트워크/키/파싱 실패 → 배치 중단 없이 mock 폴백
            pass
    return _mock_draft(metrics, subject=subject)


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

    draft = await generate_draft(metrics, user_id=user_id)

    agg_metric = _AGGREGATE_METRIC_BY_PERIOD[period_type]
    target = next((r for r in rows if r.metric == agg_metric), rows[0])
    target.ai_draft = draft
    target.ai_draft_generated_at = datetime.now(timezone.utc)
    target.ai_model = settings.ai_draft_model if draft.get("_source") == "nvidia" else "mock"
    await db.flush()
    return draft
