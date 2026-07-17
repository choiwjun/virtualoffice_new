"""
대칭 암호화(at-rest) — D31 외부 계정 토큰 등 민감 문자열의 DB 저장 보호 (P1-5, 2026-07-17).

정본: 00-decisions §L D31 ③ "운영 전 암호화 저장 전환 필요".
- Fernet(AES128-CBC + HMAC). 키 = settings.integration_encryption_key(urlsafe base64 32B).
- production은 키 필수(assert_production_safe가 미설정 기동 거부). 비-production에서 키가 비면
  결정론 개발 고정키를 사용(테스트/로컬 재현성). 저장 문자열은 'enc:v1:' 프리픽스로 태깅해
  평문 하위호환(프리픽스 없으면 평문으로 간주) — 기존 행 마이그레이션 없이 점진 전환.
"""

from __future__ import annotations

import base64
import hashlib
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

_PREFIX = "enc:v1:"
# 비-production 개발 고정키(재현성). 운영은 settings.integration_encryption_key 필수.
_DEV_KEY_SEED = "virtualoffice-dev-integration-key-2026"


@lru_cache
def _fernet() -> Fernet:
    from app.config import settings

    key = settings.integration_encryption_key.strip()
    if not key:
        if settings.is_production:
            # assert_production_safe가 이미 막지만 방어적으로 재확인.
            raise RuntimeError("INTEGRATION_ENCRYPTION_KEY 미설정 (production)")
        # 개발 고정키: seed의 sha256 32B → urlsafe base64
        key = base64.urlsafe_b64encode(hashlib.sha256(_DEV_KEY_SEED.encode()).digest()).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(plaintext: Optional[str]) -> Optional[str]:
    """평문 → 'enc:v1:<token>'. None/빈 문자열은 그대로 반환."""
    if not plaintext:
        return plaintext
    token = _fernet().encrypt(plaintext.encode()).decode()
    return _PREFIX + token


def decrypt(stored: Optional[str]) -> Optional[str]:
    """'enc:v1:<token>' → 평문. 프리픽스 없으면 평문 하위호환으로 그대로 반환.
    복호 실패(키 불일치 등) 시 None(사용 불가 토큰으로 간주)."""
    if not stored:
        return stored
    if not stored.startswith(_PREFIX):
        return stored  # 평문 하위호환
    try:
        return _fernet().decrypt(stored[len(_PREFIX):].encode()).decode()
    except InvalidToken:
        return None
