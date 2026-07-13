"""OpenAI 호환 LLM 클라이언트 (NVIDIA Integrate API).

정본: 11-tech-stack.md, 00-decisions.md D20(외부 LLM 전송 전 가명화 — 호출부 책임).

- ai_draft(KPI 서술) / ai_summary(회의록 요약) 공용.
- settings.nvidia_base_url + nvidia_api_key + ai_draft_model 사용.
- OpenAI 호환 `POST /chat/completions` → choices[0].message.content 반환.
- 실패(네트워크/HTTP/파싱) 시 예외 전파 → 호출부에서 mock 폴백(서비스가 죽지 않음).
"""

from __future__ import annotations

import httpx

from app.config import settings


def llm_enabled() -> bool:
    """실제 LLM 호출 가능 여부: 기능 on + 키 존재. 둘 중 하나라도 없으면 mock."""
    return bool(settings.ai_draft_enabled and settings.nvidia_api_key)


async def chat_completion(
    messages: list[dict[str, str]],
    *,
    max_tokens: int,
    temperature: float = 0.3,
    top_p: float = 0.95,
    timeout: float = 60.0,
) -> str:
    """OpenAI 호환 chat completion 1회 호출. content 문자열 반환(실패 시 예외).

    thinking/reasoning 토큰은 요약 품질을 해치므로 활성화하지 않는다(stream=False).
    """
    url = f"{settings.nvidia_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": settings.ai_draft_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {settings.nvidia_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    return (data["choices"][0]["message"]["content"] or "").strip()
