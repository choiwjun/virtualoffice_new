"""테넌트 브랜딩(화이트라벨) — E5 (24-spec Phase 4 · 23 E5/A7).

두 회사가 서로 다른 브랜드로 동시에 표시돼야 하고, 그 설정이 테넌트를 넘지 않아야 한다.
로고 업로드는 **content_type이 아니라 실제 바이트**로 판정한다(22 T1-12 — /media 정적 서빙
경로에 HTML/JS가 들어가면 저장형 XSS).
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.core.security import create_access_token
from app.db import Base, get_db
from app.main import app
from app.models.tables import Company, ErpRole, ErpUser

C1, C2 = 1, 2
C1_ADMIN, C1_EMP, C2_ADMIN = 401, 402, 403

# 최소 유효 이미지 바이트 (시그니처만 맞으면 sniff 통과 — 디코딩은 하지 않는다).
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP_BYTES = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 32


@pytest.fixture(autouse=True)
def _isolated_media(tmp_path, monkeypatch):
    """업로드가 실제 media_root를 오염시키지 않도록 테스트별 디렉터리로 격리."""
    monkeypatch.setattr(settings, "media_root", str(tmp_path / "media"))
    yield
    shutil.rmtree(tmp_path / "media", ignore_errors=True)


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def async_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def _override() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def _headers(user_id: int, company_id: int, role: str = "admin") -> dict:
    token = create_access_token(
        {"sub": str(user_id), "email": f"u{user_id}@t.local", "role": role, "company_id": company_id}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def c1_admin() -> dict:
    return _headers(C1_ADMIN, C1)


@pytest.fixture
def c1_employee() -> dict:
    return _headers(C1_EMP, C1, "employee")


@pytest.fixture
def c2_admin() -> dict:
    return _headers(C2_ADMIN, C2)


@pytest_asyncio.fixture
async def seeded(db_session: AsyncSession) -> None:
    db_session.add_all([
        Company(id=C1, name="회사1 주식회사", slug="c1"),
        Company(id=C2, name="회사2 주식회사", slug="c2"),
        ErpUser(id=C1_ADMIN, company_id=C1, email="a1@t.local", name="A1", erp_team_id=1,
                role=ErpRole.ADMIN, is_active=True),
        ErpUser(id=C1_EMP, company_id=C1, email="e1@t.local", name="E1", erp_team_id=1,
                role=ErpRole.EMPLOYEE, is_active=True),
        ErpUser(id=C2_ADMIN, company_id=C2, email="a2@t.local", name="A2", erp_team_id=1,
                role=ErpRole.ADMIN, is_active=True),
    ])
    await db_session.commit()


# ── 조회 ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_get_branding_defaults_to_company_name(async_client, seeded, c1_admin):
    """brand_name 미설정 → company_name으로 채워 내려간다(프론트 폴백 불필요)."""
    r = await async_client.get("/api/branding", headers=c1_admin)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["company_id"] == C1
    assert b["brand_name"] == "회사1 주식회사"
    assert b["primary_color"] is None and b["logo_url"] is None


@pytest.mark.asyncio
async def test_get_branding_is_scoped(async_client, seeded, c2_admin):
    r = await async_client.get("/api/branding", headers=c2_admin)
    assert r.status_code == 200, r.text
    assert r.json()["company_id"] == C2
    assert r.json()["brand_name"] == "회사2 주식회사"


@pytest.mark.asyncio
async def test_get_branding_requires_auth(async_client, seeded):
    assert (await async_client.get("/api/branding")).status_code == 401


# ── 수정 ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_update_branding(async_client, seeded, c1_admin):
    r = await async_client.put(
        "/api/branding",
        json={"brand_name": "아크미", "primary_color": "#FF6600", "accent_color": "#00AAFF"},
        headers=c1_admin,
    )
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["brand_name"] == "아크미"
    assert b["primary_color"] == "#FF6600"
    assert b["accent_color"] == "#00AAFF"
    assert b["company_name"] == "회사1 주식회사", "법인명은 브랜드명과 별개로 보존"


@pytest.mark.asyncio
async def test_partial_update_preserves_other_fields(async_client, seeded, c1_admin):
    """색만 바꿀 때 브랜드명이 날아가면 안 된다 (미지정 = 건드리지 않음)."""
    await async_client.put("/api/branding", json={"brand_name": "아크미"}, headers=c1_admin)
    r = await async_client.put("/api/branding", json={"primary_color": "#123456"}, headers=c1_admin)
    assert r.status_code == 200, r.text
    assert r.json()["brand_name"] == "아크미"
    assert r.json()["primary_color"] == "#123456"


@pytest.mark.asyncio
async def test_empty_string_resets_to_default(async_client, seeded, c1_admin):
    """빈 문자열 = 기본값 복귀."""
    await async_client.put(
        "/api/branding", json={"brand_name": "아크미", "primary_color": "#FF6600"}, headers=c1_admin
    )
    r = await async_client.put("/api/branding", json={"brand_name": "", "primary_color": ""}, headers=c1_admin)
    assert r.status_code == 200, r.text
    assert r.json()["brand_name"] == "회사1 주식회사"  # name 폴백
    assert r.json()["primary_color"] is None


@pytest.mark.asyncio
async def test_update_requires_admin(async_client, seeded, c1_employee):
    r = await async_client.put("/api/branding", json={"brand_name": "무권한"}, headers=c1_employee)
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_invalid_hex_422(async_client, seeded, c1_admin):
    for bad in ("red", "#GGG", "#12345", "FF6600"):
        r = await async_client.put("/api/branding", json={"primary_color": bad}, headers=c1_admin)
        assert r.status_code == 422, f"{bad} → {r.status_code}"


@pytest.mark.asyncio
async def test_two_tenants_hold_different_brands(async_client, seeded, c1_admin, c2_admin):
    """같은 인스턴스에서 두 회사가 서로 다른 브랜드로 동시 표시된다 (E5 완료 기준)."""
    await async_client.put(
        "/api/branding", json={"brand_name": "아크미", "primary_color": "#FF6600"}, headers=c1_admin
    )
    await async_client.put(
        "/api/branding", json={"brand_name": "글로벡스", "primary_color": "#00AA55"}, headers=c2_admin
    )
    b1 = (await async_client.get("/api/branding", headers=c1_admin)).json()
    b2 = (await async_client.get("/api/branding", headers=c2_admin)).json()
    assert (b1["brand_name"], b1["primary_color"]) == ("아크미", "#FF6600")
    assert (b2["brand_name"], b2["primary_color"]) == ("글로벡스", "#00AA55")


@pytest.mark.asyncio
async def test_update_does_not_leak_to_other_tenant(async_client, seeded, c1_admin, db_session):
    await async_client.put("/api/branding", json={"brand_name": "아크미"}, headers=c1_admin)
    other = (await db_session.execute(select(Company).where(Company.id == C2))).scalar_one()
    assert other.brand_name is None


# ── 공개 엔드포인트 ────────────────────────────────────────
@pytest.mark.asyncio
async def test_public_branding_by_slug(async_client, seeded, c1_admin):
    await async_client.put(
        "/api/branding", json={"brand_name": "아크미", "primary_color": "#FF6600"}, headers=c1_admin
    )
    r = await async_client.get("/api/branding/public?slug=c1")
    assert r.status_code == 200, r.text
    assert r.json()["brand_name"] == "아크미"
    assert r.json()["primary_color"] == "#FF6600"


@pytest.mark.asyncio
async def test_public_branding_unknown_slug_is_empty_200(async_client, seeded):
    """404로 갈리면 slug 존재 여부를 훑는 열거 수단이 된다 → 항상 200 + 빈 브랜딩."""
    r = await async_client.get("/api/branding/public?slug=does-not-exist")
    assert r.status_code == 200, r.text
    assert r.json() == {"brand_name": None, "logo_url": None, "primary_color": None}


@pytest.mark.asyncio
async def test_public_branding_needs_no_auth(async_client, seeded):
    assert (await async_client.get("/api/branding/public?slug=c1")).status_code == 200


# ── 로고 업로드 ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_upload_logo_png(async_client, seeded, c1_admin):
    r = await async_client.post(
        "/api/branding/logo",
        files={"file": ("logo.png", PNG_BYTES, "image/png")},
        headers=c1_admin,
    )
    assert r.status_code == 200, r.text
    url = r.json()["logo_url"]
    assert url.startswith(f"/media/branding/{C1}/logo_") and url.endswith(".png")
    assert (Path(settings.media_root) / "branding" / str(C1)).exists()


@pytest.mark.asyncio
async def test_logo_is_namespaced_per_company(async_client, seeded, c1_admin, c2_admin):
    """경로 열거로 타사 로고를 훑지 못하게 회사별 디렉터리로 분리."""
    r1 = await async_client.post(
        "/api/branding/logo", files={"file": ("a.png", PNG_BYTES, "image/png")}, headers=c1_admin
    )
    r2 = await async_client.post(
        "/api/branding/logo", files={"file": ("b.png", PNG_BYTES, "image/png")}, headers=c2_admin
    )
    assert f"/branding/{C1}/" in r1.json()["logo_url"]
    assert f"/branding/{C2}/" in r2.json()["logo_url"]


@pytest.mark.asyncio
async def test_upload_rejects_html_disguised_as_png(async_client, seeded, c1_admin):
    """content_type만 믿으면 /media에서 실행되는 저장형 XSS가 된다 (22 T1-12)."""
    payload = b"<html><script>alert(document.cookie)</script></html>"
    r = await async_client.post(
        "/api/branding/logo",
        files={"file": ("evil.png", payload, "image/png")},
        headers=c1_admin,
    )
    assert r.status_code == 415, r.text
    assert r.json()["detail"] == "unsupported_image_type"


@pytest.mark.asyncio
async def test_upload_rejects_svg(async_client, seeded, c1_admin):
    """SVG는 스크립트를 품을 수 있어 허용 형식에서 제외."""
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    r = await async_client.post(
        "/api/branding/logo",
        files={"file": ("logo.svg", svg, "image/svg+xml")},
        headers=c1_admin,
    )
    assert r.status_code == 415, r.text


@pytest.mark.asyncio
async def test_upload_accepts_jpeg_and_webp(async_client, seeded, c1_admin):
    for name, data, ext in (("a.jpg", JPEG_BYTES, ".jpg"), ("b.webp", WEBP_BYTES, ".webp")):
        r = await async_client.post(
            "/api/branding/logo",
            files={"file": (name, data, "application/octet-stream")},  # 거짓 content_type이어도 통과
            headers=c1_admin,
        )
        assert r.status_code == 200, r.text
        assert r.json()["logo_url"].endswith(ext)


@pytest.mark.asyncio
async def test_upload_replaces_previous_file(async_client, seeded, c1_admin):
    """교체 시 이전 파일은 지워지고 URL이 바뀐다(캐시 무효화)."""
    first = (await async_client.post(
        "/api/branding/logo", files={"file": ("a.png", PNG_BYTES, "image/png")}, headers=c1_admin
    )).json()["logo_url"]
    second = (await async_client.post(
        "/api/branding/logo", files={"file": ("b.jpg", JPEG_BYTES, "image/jpeg")}, headers=c1_admin
    )).json()["logo_url"]

    files = list((Path(settings.media_root) / "branding" / str(C1)).glob("logo_*"))
    assert len(files) == 1, [f.name for f in files]
    assert second.endswith(".jpg")
    assert first != second


@pytest.mark.asyncio
async def test_upload_empty_file_422(async_client, seeded, c1_admin):
    r = await async_client.post(
        "/api/branding/logo", files={"file": ("empty.png", b"", "image/png")}, headers=c1_admin
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_upload_requires_admin(async_client, seeded, c1_employee):
    r = await async_client.post(
        "/api/branding/logo", files={"file": ("a.png", PNG_BYTES, "image/png")}, headers=c1_employee
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_delete_logo(async_client, seeded, c1_admin):
    await async_client.post(
        "/api/branding/logo", files={"file": ("a.png", PNG_BYTES, "image/png")}, headers=c1_admin
    )
    r = await async_client.delete("/api/branding/logo", headers=c1_admin)
    assert r.status_code == 200, r.text
    assert r.json()["logo_url"] is None
    assert list((Path(settings.media_root) / "branding" / str(C1)).glob("logo_*")) == []


# ── 아바타 업로드도 같은 규율인지 (동일 취약점 재발 방지) ──
@pytest.mark.asyncio
async def test_avatar_upload_also_rejects_disguised_file(async_client, seeded, c1_admin):
    payload = b"<html><script>alert(1)</script></html>"
    r = await async_client.post(
        "/api/avatar/photo",
        files={"file": ("evil.png", payload, "image/png")},
        headers=c1_admin,
    )
    assert r.status_code == 415, r.text
    assert r.json()["detail"] == "unsupported_image_type"


@pytest.mark.asyncio
async def test_avatar_upload_accepts_real_png(async_client, seeded, c1_admin):
    r = await async_client.post(
        "/api/avatar/photo",
        files={"file": ("me.png", PNG_BYTES, "application/octet-stream")},
        headers=c1_admin,
    )
    assert r.status_code == 200, r.text
    assert r.json()["photo_url"].endswith(".png")
