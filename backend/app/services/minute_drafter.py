"""
회의록 초안 생성 (P5-R4-T2, D5).

STT 전사(화자분리 세그먼트) → 결정사항/액션아이템 후보 초안을 추출한다. 이 모듈의 추출 로직은
네트워크·엔진 없이 동작하는 순수 함수(한국어 키워드 휴리스틱)로, 단위 테스트 가능하다.
실제 오디오→텍스트 변환(STT 엔진)과 화자분리는 stt_service/egress_service가 담당(런타임 B-03).

D20: 외부 전송용 화자는 실명 대신 사번(EMP-{id})으로 가명처리한다.
"""

from __future__ import annotations

import re
from typing import Any

# 액션아이템/결정사항 신호 키워드(한국어).
_ACTION_KEYWORDS = ("하기로", "담당", "액션", "todo", "follow", "까지", "진행하", "정리하", "공유하")
_DECISION_KEYWORDS = ("결정", "합의", "확정", "채택", "승인")
_DUE_RE = re.compile(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일|(\d{4}-\d{2}-\d{2})|(오늘|내일|모레|이번\s*주|다음\s*주)")


def pseudonymize_speaker(speaker: Any) -> str:
    """화자 식별자를 사번 형태로 가명처리(D20). int/‘user:3’ → EMP-3, 그 외 문자열은 그대로 라벨."""
    if isinstance(speaker, int):
        return f"EMP-{speaker}"
    s = str(speaker)
    m = re.search(r"(\d+)", s)
    return f"EMP-{m.group(1)}" if m else s


def draft_from_transcript(segments: list[dict[str, Any]]) -> dict[str, Any]:
    """화자분리 세그먼트 → 회의록 초안.

    segments: [{speaker, text}] (speaker는 user_id 또는 라벨).
    반환: {summary, decisions[], action_items[{owner, task, due}], speakers[], missing_rate_hint}
    """
    decisions: list[str] = []
    action_items: list[dict[str, Any]] = []
    speakers: set[str] = set()

    for seg in segments:
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        speaker = pseudonymize_speaker(seg.get("speaker", "unknown"))
        speakers.add(speaker)
        low = text.lower()

        if any(k in text or k.lower() in low for k in _DECISION_KEYWORDS):
            decisions.append(text)
        if any(k in text or k.lower() in low for k in _ACTION_KEYWORDS):
            due_m = _DUE_RE.search(text)
            action_items.append(
                {
                    "owner": speaker,
                    "task": text,
                    "due": due_m.group(0) if due_m else None,
                }
            )

    summary = " / ".join(s.get("text", "") for s in segments[:3] if s.get("text"))
    return {
        "summary": summary[:500],
        "decisions": decisions,
        "action_items": action_items,
        "speakers": sorted(speakers),
    }


def to_stt_draft_text(draft: dict[str, Any]) -> str:
    """초안 dict → meeting_minute.stt_draft 저장용 텍스트(사람이 검토·수정)."""
    lines = ["[요약]", draft.get("summary", ""), "", "[결정사항]"]
    lines += [f"- {d}" for d in draft.get("decisions", [])] or ["- (없음)"]
    lines += ["", "[액션아이템]"]
    for a in draft.get("action_items", []) or []:
        due = f" (기한: {a['due']})" if a.get("due") else ""
        lines.append(f"- {a['owner']}: {a['task']}{due}")
    if not draft.get("action_items"):
        lines.append("- (없음)")
    return "\n".join(lines)
