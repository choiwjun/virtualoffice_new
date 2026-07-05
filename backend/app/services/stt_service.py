"""
STT + 화자분리 (P5-R4-T2, D5).

Egress 오디오 → 한국어 STT + 화자분리 세그먼트. 실 STT 엔진(예: whisper/클라우드 STT)은
런타임 부재로 차단(B-03/B-10) — settings로 엔진이 설정되면 연결한다. 미설정 시 빈 세그먼트를
반환하며, 회의록 흐름은 수동 폴백(사람이 stt_draft 작성)으로 격하된다(D5 폴백).

세그먼트 형식: [{speaker, text, start?, end?}] — minute_drafter가 소비한다.
"""

from __future__ import annotations

from typing import Any


def is_engine_configured() -> bool:
    """실 STT 엔진 설정 여부. 현재 배포엔 엔진 미설정 — 항상 False(런타임 B-03)."""
    return False


async def transcribe(audio_ref: str) -> list[dict[str, Any]]:
    """오디오 참조 → 화자분리 세그먼트. 엔진 미설정 시 빈 리스트(수동 폴백).

    audio_ref: Egress가 저장한 오디오 파일/스트림 식별자.
    """
    if not is_engine_configured():
        return []
    # 실 엔진 연결점(미구현 — 엔진 확보 시 여기서 STT 호출 후 화자분리 매핑).
    raise NotImplementedError("stt_engine_not_wired")  # pragma: no cover


def measure_miss_rate(reference: list[dict[str, Any]], hypothesis: list[dict[str, Any]]) -> float:
    """수동 전사(reference) 대비 STT(hypothesis) 액션아이템·발화자 누락률(D22 <5% 목표) 측정.

    순수 함수 — 스파이크 S2/정확도 측정에 사용. reference의 발화자·핵심 문장 중 hypothesis에
    없는 비율을 반환(0.0~1.0). reference가 비면 0.0.
    """
    ref_keys = {(str(s.get("speaker")), str(s.get("text", "")).strip()) for s in reference}
    if not ref_keys:
        return 0.0
    hyp_texts = {str(s.get("text", "")).strip() for s in hypothesis}
    missing = sum(1 for (_spk, txt) in ref_keys if txt not in hyp_texts)
    return round(missing / len(ref_keys), 4)
