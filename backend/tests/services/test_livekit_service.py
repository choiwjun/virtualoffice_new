"""
LiveKit 입장 토큰 발급 슬라이스 검증 (B-03, D24).

issue_join_token 단일 진입점: LiveKit 설정 시 실 LiveKit AccessToken(VideoGrants room_join),
미설정 시 결정적 stub 토큰(하위호환)을 발급한다. 실 LiveKit 서버 룸 생성/화상/STT는 범위 밖.

@SPEC docs/planning/00-decisions.md D24, backend/app/services/livekit_service.py
"""

import jwt

from app.config import settings
from app.services.livekit_service import issue_join_token


def test_issue_join_token_real_livekit_when_configured(monkeypatch):
    """LiveKit 설정(key+secret) 시 실 LiveKit AccessToken 발급 — grant/iss/sub 검증."""
    monkeypatch.setattr(settings, "livekit_api_key", "APIdevkey123")
    monkeypatch.setattr(settings, "livekit_api_secret", "devsecret-abcdefghijklmnopqrstuvwxyz-0123")
    assert settings.livekit_enabled is True

    token = issue_join_token(room="meeting-abc", identity="42", name="Tester")

    # LiveKit AccessToken은 api_secret(HS256)로 서명, iss=api_key.
    decoded = jwt.decode(token, "devsecret-abcdefghijklmnopqrstuvwxyz-0123", algorithms=["HS256"])
    assert decoded["iss"] == "APIdevkey123"
    assert decoded["sub"] == "42"
    grant = decoded["video"]
    assert grant["roomJoin"] is True
    assert grant["room"] == "meeting-abc"
    # 실 LiveKit 토큰은 video grant를 dict로 담는다(stub의 "join" 문자열과 구조가 다름).
    assert isinstance(grant, dict)


def test_issue_join_token_stub_fallback_when_unconfigured(monkeypatch):
    """LiveKit 미설정(기본) 시 기존 stub 토큰 형식 유지 — 하위호환(계약 무회귀)."""
    monkeypatch.setattr(settings, "livekit_api_key", "")
    monkeypatch.setattr(settings, "livekit_api_secret", "")
    assert settings.livekit_enabled is False

    token = issue_join_token(room="meeting-xyz", identity="7")

    # stub은 앱 자체 JWT(jwt_secret_key HS256), video="join" 문자열.
    decoded = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    assert decoded["sub"] == "7"
    assert decoded["room"] == "meeting-xyz"
    assert decoded["video"] == "join"


def test_issue_join_token_requires_both_key_and_secret(monkeypatch):
    """key만 있고 secret이 없으면 미설정으로 간주(부분 설정 → stub fallback, 반쪽 실토큰 방지)."""
    monkeypatch.setattr(settings, "livekit_api_key", "APIdevkey123")
    monkeypatch.setattr(settings, "livekit_api_secret", "")
    assert settings.livekit_enabled is False

    token = issue_join_token(room="meeting-1", identity="1")
    decoded = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    assert decoded["video"] == "join"  # stub
