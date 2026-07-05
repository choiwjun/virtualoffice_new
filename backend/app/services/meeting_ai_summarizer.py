"""
회의록 AI 요약 (P7-R1-T3, D20).

meeting_minute(summary/decisions/action_items) → 핵심 요약 문장 생성. ai_narrative와 동일 규약:
settings.ai_narrative_live면 Anthropic Claude 호출, 아니면 결정론 fallback(네트워크 미접촉).
D20: 외부 LLM에 실명/이메일 전달 금지 — 회의록 텍스트만 전달(발화자는 이미 사번 가명).
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import settings as default_settings

logger = logging.getLogger(__name__)

_ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_API_VERSION = "2023-06-01"


def _fallback_summary(minute_text: str) -> dict:
    """네트워크 없이 앞부분을 발췌한 결정론 요약(모델 미설정 시)."""
    condensed = " ".join(minute_text.split())
    return {"summary": condensed[:300], "model": "fallback"}


async def summarize_minute(minute_text: str, *, settings=default_settings) -> dict:
    """회의록 텍스트 → {summary, model}. 100~300자 목표. 라이브 실패 시 fallback."""
    if not minute_text.strip():
        return {"summary": "", "model": "fallback"}
    if not settings.ai_narrative_live:
        return _fallback_summary(minute_text)
    try:
        return await _live_summary(minute_text, settings=settings)
    except Exception:  # noqa: BLE001
        logger.warning("meeting_ai_summarizer: 라이브 호출 실패 — fallback", exc_info=True)
        return _fallback_summary(minute_text)


async def _live_summary(minute_text: str, *, settings) -> dict:
    prompt = (
        "다음 회의록을 한국어로 100~300자 이내 핵심 요약하세요. 결정사항과 액션아이템 중심으로.\n\n"
        + minute_text[:4000]
    )
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
                "max_tokens": 512,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        response.raise_for_status()
        body = response.json()
    text = "".join(b.get("text", "") for b in body.get("content", []) if isinstance(b, dict)).strip()
    if not text:
        raise ValueError("empty_summary")
    return {"summary": text, "model": settings.anthropic_model}


def minute_to_text(title: Optional[str], summary: Optional[str], decisions: Optional[str], action_items: Optional[str]) -> str:
    """meeting_minute 필드 → 요약 입력 텍스트."""
    parts = [p for p in [title, summary, decisions, action_items] if p]
    return "\n".join(parts)
