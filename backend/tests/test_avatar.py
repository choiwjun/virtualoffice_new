"""
아바타 커스터마이징 API 통합 테스트 (C4, 06-screens §3.9).

검증:
1. GET /api/avatar — 미설정 시 404
2. PUT /api/avatar — 신규 생성(upsert) → 200 + 저장값 반환
3. PUT 후 GET — 저장값 조회
4. PUT 재호출 — 기존 갱신(중복 생성 안 함)
5. 잘못된 색상 형식 → 422
6. 인증 없이 접근 → 401/403 (본인 전용, D4)
"""

from __future__ import annotations

from httpx import AsyncClient

_VALID = {
    "preset_id": "humanoid_b",
    "top_color": "#22C55E",
    "bottom_color": "#0F766E",
    "show_nameplate": False,
}


class TestAvatar:
    async def test_get_returns_404_when_unset(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.get("/api/avatar", headers=auth_headers)
        assert resp.status_code == 404

    async def test_put_creates_avatar(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.put("/api/avatar", headers=auth_headers, json=_VALID)
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == 1  # employee_token sub=1
        assert data["preset_id"] == "humanoid_b"
        assert data["top_color"] == "#22C55E"
        assert data["bottom_color"] == "#0F766E"
        assert data["show_nameplate"] is False

    async def test_get_after_put_returns_saved(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        await async_client.put("/api/avatar", headers=auth_headers, json=_VALID)
        resp = await async_client.get("/api/avatar", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["preset_id"] == "humanoid_b"

    async def test_put_updates_existing(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        await async_client.put("/api/avatar", headers=auth_headers, json=_VALID)
        updated = {**_VALID, "preset_id": "humanoid_a", "top_color": "#EF4444"}
        resp = await async_client.put("/api/avatar", headers=auth_headers, json=updated)
        assert resp.status_code == 200
        assert resp.json()["preset_id"] == "humanoid_a"
        assert resp.json()["top_color"] == "#EF4444"

        # 여전히 단일 레코드(GET이 갱신값 반환)
        g = await async_client.get("/api/avatar", headers=auth_headers)
        assert g.json()["top_color"] == "#EF4444"

    async def test_put_rejects_bad_color(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        bad = {**_VALID, "top_color": "red"}
        resp = await async_client.put("/api/avatar", headers=auth_headers, json=bad)
        assert resp.status_code == 422

    async def test_requires_auth(self, async_client: AsyncClient):
        assert (await async_client.get("/api/avatar")).status_code in (401, 403)
        assert (
            await async_client.put("/api/avatar", json=_VALID)
        ).status_code in (401, 403)
