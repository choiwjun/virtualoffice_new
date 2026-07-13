"""회의록 AI 요약 (P7 — decisions/summary/notes/stt_draft 기반).

정책은 ai_draft와 동일:
- settings.ai_draft_enabled=True AND nvidia_api_key 존재 → 실제 NVIDIA(OpenAI 호환) 호출.
- 그 외(기본) → 결정론적 mock 요약. 네트워크·키·비용 없이 테스트/도그푸딩 가능.
- 실패 시 항상 mock 폴백 → 요약 생성이 요청을 죽이지 않음.
"""

from __future__ import annotations

from app.services.ai_client import chat_completion, llm_enabled

_MAX_EXCERPT = 220


def _count_decisions(decisions: str | None) -> int:
    """decisions(마크다운)의 최상위 리스트 항목(-, *) 수 — 08 §2.2.2 규칙과 동일."""
    if not decisions:
        return 0
    return sum(1 for ln in decisions.splitlines() if ln.strip().startswith(("-", "*")))


def _mock_summary(source: str, *, decisions_count: int) -> str:
    """결정론적 mock 요약 — 실 STT/LLM 없이 데모 가능(같은 입력=같은 출력)."""
    body = " ".join(source.split())
    if not body:
        return "[자동 요약] 요약할 내용이 없습니다."
    excerpt = body[:_MAX_EXCERPT] + ("…" if len(body) > _MAX_EXCERPT else "")
    prefix = f"[자동 요약] 주요 결정 {decisions_count}건. " if decisions_count else "[자동 요약] "
    return prefix + excerpt


async def _llm_summary(source: str) -> str:
    """실제 NVIDIA(OpenAI 호환) 호출. 실패 시 예외 → 호출부에서 mock 폴백."""
    text = await chat_completion(
        [
            {
                "role": "user",
                "content": (
                    "다음 회의록을 한국어 3~5문장으로 요약하라. 결정사항·액션아이템 중심, "
                    "군더더기 없이:\n\n" + source
                ),
            }
        ],
        max_tokens=512,
        temperature=0.3,
    )
    return text or _mock_summary(source, decisions_count=_count_decisions(source))


async def generate_meeting_summary(
    *,
    decisions: str | None,
    summary: str | None = None,
    notes: str | None = None,
    stt_draft: str | None = None,
) -> str:
    """회의록 요약 문자열 생성. 가명화 불필요(회의록은 본문 그대로 사내 저장)."""
    source = "\n".join(s for s in (summary, decisions, notes, stt_draft) if s)
    if llm_enabled():
        try:
            return await _llm_summary(source)
        except Exception:
            pass
    return _mock_summary(source, decisions_count=_count_decisions(decisions))
