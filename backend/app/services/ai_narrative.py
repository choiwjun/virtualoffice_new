"""
KPI AI 서술 초안 생성 (D14-e, D20, G006).

@TASK P6-R2-T2 - AI 서술 provider (fallback | claude)
@SPEC docs/planning/00-decisions.md D14-e(정량 점수 미포함 서술), D20(가명처리)

- D14-e: AI 서술(strength/improvement/note)은 정성적 서술만 담고, 정량 점수(final_score 등)는
  절대 포함하지 않는다.
- D20: 외부 LLM(Anthropic)에는 실명/이메일을 절대 전달하지 않는다 — user_id를 사번 형태
  (EMP-{user_id})로 가명처리한 값만 프롬프트에 사용한다.
- settings.ai_narrative_live(provider='claude' + anthropic_api_key 설정)가 아니면 네트워크를
  전혀 타지 않는 결정론 fallback만 생성한다(이 모듈은 임포트만으로 네트워크에 닿지 않는다).
- 라이브 호출 중 httpx 오류/응답 파싱 실패 등 어떤 예외가 나도 fallback으로 안전하게 대체한다.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings as default_settings

logger = logging.getLogger(__name__)

_ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_API_VERSION = "2023-06-01"


def pseudonymize(user_id: int) -> str:
    """user_id를 사번 형태로 가명처리한다(D20) — 실명/이메일은 절대 반환하지 않는다."""
    return f"EMP-{user_id}"


def _fallback_narrative(metric: str, value: Any) -> dict:
    """네트워크 없이 정량 값 기반 결정론 서술을 생성한다(모델 미가용/미설정 시 기본값)."""
    return {
        "strength": f"{metric} 지표 값 {value} 기반 초안 대기",
        "improvement": "AI 서술 생성 대기 중(라이브 모델 미설정 또는 비활성)",
        "note": "ai_draft_fallback",
        "model": "fallback",
    }


def _build_prompt(metric: str, value: Any, employee_ref: str) -> str:
    # D20: employee_ref(가명)만 사용 — 실명/이메일 금지.
    return (
        f"직원 {employee_ref}의 KPI 지표 '{metric}' 값은 {value}입니다. "
        "이 정량 값만 근거로, 점수나 등급을 언급하지 말고 강점(strength)과 개선점(improvement)을 "
        "한국어로 각 1문장씩 간결히 서술하세요. 형식: 'STRENGTH: ...\\nIMPROVEMENT: ...'"
    )


def _parse_anthropic_text(text: str) -> tuple[str, str]:
    """'STRENGTH: ...\nIMPROVEMENT: ...' 형태 응답을 파싱한다. 형식이 다르면 ValueError."""
    strength = ""
    improvement = ""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.upper().startswith("STRENGTH:"):
            strength = stripped.split(":", 1)[1].strip()
        elif stripped.upper().startswith("IMPROVEMENT:"):
            improvement = stripped.split(":", 1)[1].strip()
    if not strength or not improvement:
        raise ValueError("anthropic_response_missing_strength_or_improvement")
    return strength, improvement


async def _live_narrative(metric: str, value: Any, user_id: int, *, settings) -> dict:
    employee_ref = pseudonymize(user_id)
    prompt = _build_prompt(metric, value, employee_ref)
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            _ANTHROPIC_MESSAGES_URL,
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": _ANTHROPIC_API_VERSION,
                "content-type": "application/json",
            },
            json={
                "model": settings.anthropic_model,
                "max_tokens": 256,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        response.raise_for_status()
        body = response.json()

    text = "".join(
        block.get("text", "") for block in body.get("content", []) if isinstance(block, dict)
    )
    strength, improvement = _parse_anthropic_text(text)
    return {
        "strength": strength,
        "improvement": improvement,
        "note": "ai_draft_live",
        "model": settings.anthropic_model,
    }


async def generate_narrative(
    metric: str, value: Any, user_id: int, *, settings=default_settings
) -> dict:
    """KPI 지표에 대한 AI 서술 초안을 생성한다.

    반환값: {strength, improvement, note, model} — 정량 점수는 절대 포함하지 않는다(D14-e).
    settings.ai_narrative_live가 아니면 네트워크를 타지 않고 결정론 fallback을 반환한다.
    라이브 호출 중 예외(네트워크/파싱 등 무엇이든)가 발생하면 fallback으로 안전하게 대체한다.
    """
    if not settings.ai_narrative_live:
        return _fallback_narrative(metric, value)

    try:
        return await _live_narrative(metric, value, user_id, settings=settings)
    except Exception:  # noqa: BLE001 - 라이브 호출 실패는 무엇이든 fallback으로 흡수한다.
        logger.warning(
            "ai_narrative: Anthropic 라이브 호출 실패 — 결정론 fallback으로 대체합니다.",
            exc_info=True,
        )
        return _fallback_narrative(metric, value)
