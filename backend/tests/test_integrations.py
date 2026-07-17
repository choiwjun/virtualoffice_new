"""
본인 외부 계정 연동 API 테스트 (D31 — /api/integrations).

외부 네트워크 차단: app.services.integrations 함수를 monkeypatch.
"""

from __future__ import annotations

import pytest

from app.services.integrations import IntegrationError

pytestmark = pytest.mark.asyncio

_GH_PROFILE = {"login": "octocat", "name": "The Octocat", "public_repos": 8, "profile_url": "https://github.com/octocat"}
_GH_ACTIVITY = {
    "sample_size": 42, "push_events": 10, "pull_request_events": 4, "review_events": 2,
    "recent_repos": ["octocat/hello-world"], "last_event_at": "2026-07-17T00:00:00Z",
    "fetched_at": "2026-07-17T01:00:00Z",
}
_FIGMA_ME = {"email": "alice@virtualoffice.local", "handle": "alice-fig", "img_url": None}


@pytest.fixture(autouse=True)
def _mock_providers(monkeypatch):
    async def verify_github(account, token):
        if account == "no-such-user":
            raise IntegrationError("GitHub 계정 'no-such-user'를 찾을 수 없습니다", 400)
        return dict(_GH_PROFILE, login=account)

    async def fetch_github_activity(account, token):
        return dict(_GH_ACTIVITY)

    async def verify_figma(token):
        if token != "figd_valid":
            raise IntegrationError("Figma 토큰이 유효하지 않습니다", 400)
        return dict(_FIGMA_ME)

    async def fetch_figma_activity(token):
        return {"handle": _FIGMA_ME["handle"], "email": _FIGMA_ME["email"], "fetched_at": "2026-07-17T01:00:00Z"}

    import app.api.integrations as api_mod
    for name, fn in [
        ("verify_github", verify_github),
        ("fetch_github_activity", fetch_github_activity),
        ("verify_figma", verify_figma),
        ("fetch_figma_activity", fetch_figma_activity),
    ]:
        monkeypatch.setattr(api_mod.svc, name, fn)


async def test_requires_auth(async_client):
    r = await async_client.get("/api/integrations")
    assert r.status_code == 401


async def test_empty_list_initially(async_client, auth_headers):
    r = await async_client.get("/api/integrations", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


async def test_connect_github_verifies_and_syncs(async_client, auth_headers):
    r = await async_client.put(
        "/api/integrations/github", json={"account": "octocat"}, headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "github"
    assert body["account"] == "octocat"
    assert body["verified"] is True
    assert body["has_token"] is False
    assert body["activity"]["push_events"] == 10
    assert body["last_synced_at"] is not None
    assert "token" not in body and "access_token" not in body  # 토큰 미노출 계약


async def test_connect_github_unknown_account_rejected(async_client, auth_headers):
    r = await async_client.put(
        "/api/integrations/github", json={"account": "no-such-user"}, headers=auth_headers
    )
    assert r.status_code == 400
    assert "찾을 수 없습니다" in r.json()["detail"]


async def test_connect_figma_with_valid_token(async_client, auth_headers):
    r = await async_client.put(
        "/api/integrations/figma",
        json={"account": "whatever", "token": "figd_valid"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["verified"] is True
    assert body["has_token"] is True
    assert body["account"] == "alice-fig"  # 검증된 handle로 정규화


async def test_connect_figma_invalid_token_rejected(async_client, auth_headers):
    r = await async_client.put(
        "/api/integrations/figma",
        json={"account": "x", "token": "bad"},
        headers=auth_headers,
    )
    assert r.status_code == 400


async def test_connect_figma_without_token_unverified(async_client, auth_headers):
    r = await async_client.put(
        "/api/integrations/figma", json={"account": "alice-fig"}, headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["verified"] is False
    assert body["activity"] is None  # 토큰 없음 → 수집 불가


async def test_unknown_provider_404(async_client, auth_headers):
    r = await async_client.put(
        "/api/integrations/jira", json={"account": "x"}, headers=auth_headers
    )
    assert r.status_code == 404


async def test_sync_updates_activity(async_client, auth_headers):
    await async_client.put(
        "/api/integrations/github", json={"account": "octocat"}, headers=auth_headers
    )
    r = await async_client.post("/api/integrations/github/sync", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["activity"]["sample_size"] == 42


async def test_sync_not_connected_404(async_client, auth_headers):
    r = await async_client.post("/api/integrations/github/sync", headers=auth_headers)
    assert r.status_code == 404


async def test_disconnect_deletes_row(async_client, auth_headers):
    await async_client.put(
        "/api/integrations/github", json={"account": "octocat"}, headers=auth_headers
    )
    r = await async_client.delete("/api/integrations/github", headers=auth_headers)
    assert r.status_code == 204
    r = await async_client.get("/api/integrations", headers=auth_headers)
    assert r.json() == []


async def test_isolation_between_users(async_client, auth_headers, admin_auth_headers):
    """본인 것만 보인다 — employee 연동이 admin 목록에 나타나면 안 됨."""
    await async_client.put(
        "/api/integrations/github", json={"account": "octocat"}, headers=auth_headers
    )
    r = await async_client.get("/api/integrations", headers=admin_auth_headers)
    assert r.status_code == 200
    assert r.json() == []


# ── D31 토큰 at-rest 암호화 (P1-5, 2026-07-17) ──────────────────────────────

async def test_figma_token_stored_encrypted_at_rest(async_client, auth_headers, db_session):
    """Figma 토큰 연동 시 DB의 access_token은 암호문(enc:v1:)이어야 하고 평문이 아니어야 한다."""
    from sqlalchemy import select
    from app.models.tables import UserIntegration, IntegrationProvider
    from app.core import secretbox

    r = await async_client.put(
        "/api/integrations/figma",
        json={"account": "x", "token": "figd_valid"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["has_token"] is True
    assert "figd_valid" not in str(r.json())  # 응답 미노출

    row = (
        await db_session.execute(
            select(UserIntegration).where(UserIntegration.provider == IntegrationProvider.FIGMA)
        )
    ).scalar_one()
    assert row.access_token.startswith("enc:v1:")       # at-rest 암호문
    assert "figd_valid" not in row.access_token          # 평문 아님
    assert secretbox.decrypt(row.access_token) == "figd_valid"  # 복호 가능


def test_secretbox_roundtrip_and_plaintext_fallback():
    from app.core import secretbox

    enc = secretbox.encrypt("ghp_secret_abc")
    assert enc.startswith("enc:v1:") and "ghp_secret_abc" not in enc
    assert secretbox.decrypt(enc) == "ghp_secret_abc"
    # 평문 하위호환(프리픽스 없음)
    assert secretbox.decrypt("legacy_plain") == "legacy_plain"
    assert secretbox.encrypt(None) is None
    assert secretbox.encrypt("") == ""
