"""
AI 서술 초안 provider 단위 테스트 (G006, D14-e/D20).

@TASK P6-R2-T2 - AI draft provider (fallback | claude)
"""

from __future__ import annotations

import httpx
import pytest

from app.config import Settings
from app.services.ai_narrative import generate_narrative, pseudonymize


def _fallback_settings() -> Settings:
    return Settings(ai_narrative_provider="fallback", anthropic_api_key="")


def _live_settings() -> Settings:
    return Settings(
        ai_narrative_provider="claude",
        anthropic_api_key="test-key",
        anthropic_model="claude-opus-4",
    )


# ============================================================================
# pseudonymize — D20: 실명/이메일 절대 미노출
# ============================================================================
def test_pseudonymize_never_emits_raw_name():
    ref = pseudonymize(42)
    assert ref == "EMP-42"
    assert "@" not in ref
    assert "홍길동" not in ref


# ============================================================================
# fallback 경로 — 네트워크 미사용, 서술만(정량 점수 없음)
# ============================================================================
@pytest.mark.asyncio
async def test_generate_narrative_fallback_when_not_live():
    settings = _fallback_settings()
    assert settings.ai_narrative_live is False

    result = await generate_narrative(
        "work_completed_count", 5, user_id=7, settings=settings
    )

    assert result["model"] == "fallback"
    assert isinstance(result["strength"], str) and result["strength"]
    assert isinstance(result["improvement"], str) and result["improvement"]
    # D14-e: 서술만 담고 정량 점수(final_score 등 숫자 키) 미포함
    assert set(result.keys()) == {"strength", "improvement", "note", "model"}
    # D20: 실명/이메일 문자열이 결과에 노출되지 않는다.
    dump = str(result)
    assert "홍길동" not in dump
    assert "@" not in dump


@pytest.mark.asyncio
async def test_generate_narrative_missing_api_key_is_not_live():
    settings = Settings(ai_narrative_provider="claude", anthropic_api_key="")
    assert settings.ai_narrative_live is False
    result = await generate_narrative("work_quality_score", 80, user_id=1, settings=settings)
    assert result["model"] == "fallback"


# ============================================================================
# live 경로 — httpx 모킹, 실 네트워크 없음
# ============================================================================
@pytest.mark.asyncio
async def test_generate_narrative_live_parses_anthropic_response(monkeypatch):
    settings = _live_settings()
    assert settings.ai_narrative_live is True

    captured_payload = {}

    class _FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "content": [
                    {
                        "type": "text",
                        "text": "STRENGTH: 협업 지표가 우수합니다\nIMPROVEMENT: 보고 빈도를 늘리세요",
                    }
                ]
            }

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info):
            return False

        async def post(self, url, headers=None, json=None):
            captured_payload["url"] = url
            captured_payload["headers"] = headers
            captured_payload["json"] = json
            return _FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    result = await generate_narrative(
        "collaboration_score", 90, user_id=99, settings=settings
    )

    assert result["model"] == "claude-opus-4"
    assert result["strength"] == "협업 지표가 우수합니다"
    assert result["improvement"] == "보고 빈도를 늘리세요"
    # D20: 프롬프트에는 가명(EMP-99)만 사용, 실명/이메일 없음.
    prompt_text = str(captured_payload["json"])
    assert "EMP-99" in prompt_text
    assert "@" not in prompt_text


@pytest.mark.asyncio
async def test_generate_narrative_live_falls_back_on_httpx_error(monkeypatch):
    settings = _live_settings()

    class _FailingAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info):
            return False

        async def post(self, *args, **kwargs):
            raise httpx.ConnectError("boom", request=httpx.Request("POST", "https://x"))

    monkeypatch.setattr(httpx, "AsyncClient", _FailingAsyncClient)

    result = await generate_narrative("work_completed_count", 3, user_id=5, settings=settings)

    assert result["model"] == "fallback"
    assert result["note"] == "ai_draft_fallback"


@pytest.mark.asyncio
async def test_generate_narrative_live_falls_back_on_unparseable_response(monkeypatch):
    settings = _live_settings()

    class _FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"content": [{"type": "text", "text": "예상치 못한 형식의 응답"}]}

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info):
            return False

        async def post(self, *args, **kwargs):
            return _FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    result = await generate_narrative("work_completed_count", 3, user_id=5, settings=settings)

    assert result["model"] == "fallback"
