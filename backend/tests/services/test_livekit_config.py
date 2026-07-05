"""LiveKit 설정 활성화 검증 (P5-R1-T2): 키 설정 시 실 LiveKit AccessToken 발급 확인.

실 LiveKit 서버는 이 환경에서 불필요 — 토큰 발급은 오프라인 JWT 서명이므로, livekit-api로
발급된 토큰의 video grant(roomJoin/room)를 디코드해 검증한다. 룸 생성/미디어는 서버 필요(B-03).
"""

import jwt

from app.services import livekit_service


def test_issue_join_token_real_when_configured(monkeypatch):
    # docker-compose livekit 기본값과 동일하게 설정 → livekit_enabled=True.
    monkeypatch.setattr(livekit_service.settings, "livekit_api_key", "devkey", raising=False)
    monkeypatch.setattr(
        livekit_service.settings, "livekit_api_secret", "devsecret_at_least_32_chars_long__", raising=False
    )
    assert livekit_service.settings.livekit_enabled is True

    token = livekit_service.issue_join_token("meeting-abc", "3", name="관리자")
    # 실 LiveKit AccessToken은 HS256 JWT — 서명 검증 없이 payload 구조만 확인.
    payload = jwt.decode(token, options={"verify_signature": False})
    assert payload["sub"] == "3"
    # LiveKit grant: video.roomJoin=true, room 일치.
    video = payload.get("video", {})
    assert video.get("roomJoin") is True
    assert video.get("room") == "meeting-abc"
    # 발급자(iss)가 api_key여야 실 LiveKit 서버가 검증 가능.
    assert payload.get("iss") == "devkey"


def test_issue_join_token_stub_when_unconfigured(monkeypatch):
    monkeypatch.setattr(livekit_service.settings, "livekit_api_key", "", raising=False)
    monkeypatch.setattr(livekit_service.settings, "livekit_api_secret", "", raising=False)
    assert livekit_service.settings.livekit_enabled is False
    token = livekit_service.issue_join_token("meeting-x", "5")
    payload = jwt.decode(token, options={"verify_signature": False})
    # stub은 FastAPI 자체 JWT: {sub, room, video:"join"} — LiveKit grant 없음.
    assert payload["sub"] == "5" and payload["room"] == "meeting-x"
    assert payload["video"] == "join"
