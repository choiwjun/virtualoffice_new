"""
D20 가명화 유틸 — AI(외부 LLM)에 개인식별정보(PII)를 전송하기 전 비식별 처리.

정본: docs/planning/00-decisions.md D20 (개인정보 최소수집·가명화),
      08-kpi-logic.md (AI 서술 초안은 정량 점수·실명 미포함).

원칙:
- 외부 LLM(Claude 등)에는 **실명·이메일·사번**을 그대로 보내지 않는다.
- 대신 회사 스코프 내에서 안정적(stable)이되 원본을 복원할 수 없는 가명 라벨을 사용한다.
- 가명 라벨은 결정론적(동일 user_id → 동일 라벨) → 감사·재현성 확보(D14-e).
"""

from __future__ import annotations

import hashlib
import re

# 가명화 솔트: 원문 복원 난이도를 높이기 위한 고정 접두. 운영 시 config로 분리 가능.
_SALT = "vo-kpi-pseudo-v1"

# 흔한 한국어 이름/이메일/사번 패턴(로그·payload 스크럽용, best-effort)
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_EMP_NO_RE = re.compile(r"\b\d{4,8}\b")


def pseudonymize_user(user_id: int) -> str:
    """user_id → 안정적 가명 라벨 (예: 'EMP-3f9a2c'). 비가역."""
    digest = hashlib.sha256(f"{_SALT}:{user_id}".encode("utf-8")).hexdigest()
    return f"EMP-{digest[:6]}"


def scrub_pii(text: str) -> str:
    """자유 텍스트에서 이메일·사번 추정치를 마스킹 (best-effort PII 스크럽)."""
    if not text:
        return text
    text = _EMAIL_RE.sub("[email]", text)
    text = _EMP_NO_RE.sub("[id]", text)
    return text


def pseudonymize_payload(payload: dict, *, user_id: int) -> dict:
    """
    KPI/리포트 payload에서 식별자 필드를 가명 라벨로 치환한 사본 반환.
    원본 payload는 변경하지 않는다(비파괴).
    """
    label = pseudonymize_user(user_id)
    safe: dict = {}
    _PII_KEYS = {"name", "full_name", "email", "employee_no", "emp_no", "user_id", "login_id"}
    for k, v in (payload or {}).items():
        if k in _PII_KEYS:
            safe[k] = label if k in {"user_id", "employee_no", "emp_no", "login_id"} else "[redacted]"
        elif isinstance(v, str):
            safe[k] = scrub_pii(v)
        else:
            safe[k] = v
    safe.setdefault("subject", label)
    return safe
