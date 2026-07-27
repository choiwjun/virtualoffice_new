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

import pytest
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

    async def test_list_avatars_returns_set_omits_unset(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        # user 1(본인) 설정, user 2는 미설정
        await async_client.put("/api/avatar", headers=auth_headers, json=_VALID)
        resp = await async_client.get(
            "/api/avatars?user_ids=1,2", headers=auth_headers
        )
        assert resp.status_code == 200
        rows = resp.json()
        assert isinstance(rows, list)
        ids = {r["user_id"] for r in rows}
        assert 1 in ids  # 설정된 사용자 포함
        assert 2 not in ids  # 미설정 사용자는 생략

    async def test_list_avatars_empty_when_no_valid_ids(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.get(
            "/api/avatars?user_ids=abc,", headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_list_avatars_requires_auth(self, async_client: AsyncClient):
        assert (
            await async_client.get("/api/avatars?user_ids=1")
        ).status_code in (401, 403)


# 1×1 PNG(유효 시그니처) — 사진 업로드 검증용 최소 페이로드.
_PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63fccff0bf1e00079f027e9b4e2d1e0000000049454e44ae426082"
)


class TestAvatarPhoto:
    """D35 배지 프로필 사진 업로드/삭제 (POST·DELETE /api/avatar/photo)."""

    @pytest.fixture(autouse=True)
    def _tmp_media_root(self, tmp_path, monkeypatch):
        # 테스트 산출 파일이 레포(backend/media)에 남지 않게 media_root를 tmp로.
        from app.config import settings as app_settings

        monkeypatch.setattr(app_settings, "media_root", str(tmp_path))

    async def test_upload_sets_photo_url_and_writes_file(
        self, async_client: AsyncClient, auth_headers: dict, tmp_path
    ):
        resp = await async_client.post(
            "/api/avatar/photo",
            headers=auth_headers,
            files={"file": ("me.png", _PNG_1PX, "image/png")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == 1
        assert data["photo_url"] and data["photo_url"].startswith("/media/avatars/1_")
        assert data["photo_url"].endswith(".png")
        stored = list((tmp_path / "avatars").glob("1_*"))
        assert len(stored) == 1
        assert stored[0].read_bytes() == _PNG_1PX

        # GET /api/avatar·/api/avatars 응답에도 photo_url 포함
        g = await async_client.get("/api/avatar", headers=auth_headers)
        assert g.json()["photo_url"] == data["photo_url"]
        lst = await async_client.get("/api/avatars?user_ids=1", headers=auth_headers)
        assert lst.json()[0]["photo_url"] == data["photo_url"]

    async def test_reupload_replaces_old_file(
        self, async_client: AsyncClient, auth_headers: dict, tmp_path
    ):
        await async_client.post(
            "/api/avatar/photo",
            headers=auth_headers,
            files={"file": ("a.png", _PNG_1PX, "image/png")},
        )
        # 확장자·content_type이 webp라 주장해도 **실제 바이트가 PNG**면 .png로 저장된다
        # (E5에서 매직바이트 판정으로 전환 — 22 T1-12).
        resp = await async_client.post(
            "/api/avatar/photo",
            headers=auth_headers,
            files={"file": ("b.webp", _PNG_1PX, "image/webp")},
        )
        assert resp.status_code == 200
        assert resp.json()["photo_url"].endswith(".png")
        # 이전 파일은 삭제되어 사용자당 1개만 유지
        assert len(list((tmp_path / "avatars").glob("1_*"))) == 1

    async def test_upload_type_is_decided_by_bytes_not_content_type(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        """content_type은 클라가 보낸 문자열 — 형식 판정 근거가 될 수 없다 (22 T1-12).

        E5 이전에는 content_type만 봤다. 그래서 ① 진짜 PNG를 image/gif라고 하면 거부되고
        ② HTML을 image/png라고 하면 통과해 /media 정적 서빙에서 실행됐다(저장형 XSS).
        지금은 둘 다 바이트가 결정한다.
        """
        # ① 거짓 content_type(gif)이어도 실제 PNG면 통과
        real_png = await async_client.post(
            "/api/avatar/photo",
            headers=auth_headers,
            files={"file": ("x.gif", _PNG_1PX, "image/gif")},
        )
        assert real_png.status_code == 200, real_png.text
        assert real_png.json()["photo_url"].endswith(".png")

        # ② image/png를 주장해도 실제로 HTML이면 거부
        disguised = await async_client.post(
            "/api/avatar/photo",
            headers=auth_headers,
            files={"file": ("evil.png", b"<html><script>alert(1)</script></html>", "image/png")},
        )
        assert disguised.status_code == 415, disguised.text
        assert disguised.json()["detail"] == "unsupported_image_type"

    async def test_upload_rejects_empty(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        empty = await async_client.post(
            "/api/avatar/photo",
            headers=auth_headers,
            files={"file": ("x.png", b"", "image/png")},
        )
        assert empty.status_code == 422

    async def test_upload_rejects_oversize(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        big = b"\x00" * (2 * 1024 * 1024 + 1)
        resp = await async_client.post(
            "/api/avatar/photo",
            headers=auth_headers,
            files={"file": ("big.png", big, "image/png")},
        )
        assert resp.status_code == 413

    async def test_delete_clears_photo(
        self, async_client: AsyncClient, auth_headers: dict, tmp_path
    ):
        await async_client.post(
            "/api/avatar/photo",
            headers=auth_headers,
            files={"file": ("me.png", _PNG_1PX, "image/png")},
        )
        resp = await async_client.delete("/api/avatar/photo", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["photo_url"] is None
        assert list((tmp_path / "avatars").glob("1_*")) == []
        # 미설정 상태에서 재삭제 → 404
        again = await async_client.delete("/api/avatar/photo", headers=auth_headers)
        assert again.status_code == 404

    async def test_photo_requires_auth(self, async_client: AsyncClient):
        assert (
            await async_client.post(
                "/api/avatar/photo",
                files={"file": ("me.png", _PNG_1PX, "image/png")},
            )
        ).status_code in (401, 403)
        assert (
            await async_client.delete("/api/avatar/photo")
        ).status_code in (401, 403)
