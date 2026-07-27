"""비밀번호 설정 링크 — E4 (24-spec Phase 3 초대 + Phase 6 리셋, 메일 없는 링크 방식).

관리자가 남의 비밀번호를 알지 않고도 사람을 들이고, 비번 분실 시 DB 개입 없이 복구할 수
있어야 한다. 그 흐름의 계약과 보안 규율을 고정한다:
- 발급 → 본인이 비밀번호 설정 → 즉시 로그인
- 평문 토큰 DB 미저장 / 단회성 / 만료 / 회수 / 재발급 시 이전 링크 무효
- 링크는 company 스코프 (타사 유저에게 발급 불가)
- 비활성 계정의 링크는 죽는다 (퇴사자 재진입 차단)
- 본인 비밀번호 변경(현재 비번 확인)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token, hash_password
from app.db import Base, get_db
from app.main import app
from app.models.tables import (
    USER_SOURCE_ERP,
    AuthToken,
    Company,
    ErpRole,
    ErpUser,
)
from app.services.tokens import hash_token

C1, C2 = 1, 2
ADMIN_ID = 201       # 회사1 admin (비번 있음)
PENDING_ID = 202     # 회사1, 비번 미설정 (초대 대상)
MEMBER_ID = 203      # 회사1, 비번 있음 (재설정 대상)
C2_USER_ID = 204     # 회사2 유저


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


def _headers(user_id: int, role: str, company_id: int) -> dict:
    token = create_access_token(
        {"sub": str(user_id), "email": f"u{user_id}@t.local", "role": role, "company_id": company_id}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_headers() -> dict:
    return _headers(ADMIN_ID, "admin", C1)


@pytest.fixture
def c2_admin_headers() -> dict:
    return _headers(C2_USER_ID, "admin", C2)


@pytest_asyncio.fixture
async def seeded(db_session: AsyncSession) -> None:
    db_session.add_all([
        Company(id=C1, name="회사1", slug="c1"),
        Company(id=C2, name="회사2", slug="c2"),
        ErpUser(id=ADMIN_ID, company_id=C1, email="admin@c1.local", name="관리자", erp_team_id=1,
                role=ErpRole.ADMIN, password_hash=hash_password("adminpass123"),
                is_active=True, source=USER_SOURCE_ERP),
        ErpUser(id=PENDING_ID, company_id=C1, email="pending@c1.local", name="초대대기", erp_team_id=1,
                role=ErpRole.EMPLOYEE, password_hash=None, is_active=True, source=USER_SOURCE_ERP),
        ErpUser(id=MEMBER_ID, company_id=C1, email="member@c1.local", name="기존직원", erp_team_id=1,
                role=ErpRole.EMPLOYEE, password_hash=hash_password("oldpass12345"),
                is_active=True, source=USER_SOURCE_ERP),
        ErpUser(id=C2_USER_ID, company_id=C2, email="c2@c2.local", name="타사", erp_team_id=1,
                role=ErpRole.ADMIN, is_active=True, source=USER_SOURCE_ERP),
    ])
    await db_session.commit()


def _token_of(url: str) -> str:
    return url.split("token=", 1)[1]


# ── 발급 ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_issue_invitation_link_for_pending_user(async_client, seeded, admin_headers):
    """비번 미설정 계정 → purpose=invitation."""
    r = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["purpose"] == "invitation"
    assert "/set-password?token=" in body["url"]
    assert body["employee_email"] == "pending@c1.local"


@pytest.mark.asyncio
async def test_issue_reset_link_for_existing_user(async_client, seeded, admin_headers):
    """이미 로그인하던 계정 → purpose=password_reset (만료가 더 짧다)."""
    r = await async_client.post(f"/api/employees/{MEMBER_ID}/access-link", headers=admin_headers)
    assert r.status_code == 201, r.text
    assert r.json()["purpose"] == "password_reset"


@pytest.mark.asyncio
async def test_plaintext_token_is_not_stored(async_client, seeded, admin_headers, db_session):
    """DB엔 sha256만 — 유출돼도 링크를 복원할 수 없어야 한다."""
    r = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    raw = _token_of(r.json()["url"])

    rows = (await db_session.execute(select(AuthToken))).scalars().all()
    assert len(rows) == 1
    assert rows[0].token_hash != raw
    assert rows[0].token_hash == hash_token(raw)
    assert len(rows[0].token_hash) == 64


@pytest.mark.asyncio
async def test_issue_requires_admin(async_client, seeded):
    r = await async_client.post(
        f"/api/employees/{PENDING_ID}/access-link", headers=_headers(MEMBER_ID, "employee", C1)
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_issue_cross_tenant_is_404(async_client, seeded, c2_admin_headers, db_session):
    """타사 유저에게 링크 발급 불가 — 계정 탈취 경로."""
    r = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=c2_admin_headers)
    assert r.status_code == 404, r.text
    assert (await db_session.execute(select(AuthToken))).scalars().all() == []


@pytest.mark.asyncio
async def test_issue_for_inactive_employee_409(async_client, seeded, admin_headers, db_session):
    row = (await db_session.execute(select(ErpUser).where(ErpUser.id == PENDING_ID))).scalar_one()
    row.is_active = False
    await db_session.commit()

    r = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "employee_inactive"


# ── 확인 · 사용 ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_check_valid_token_reveals_target(async_client, seeded, admin_headers):
    r = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    raw = _token_of(r.json()["url"])

    chk = await async_client.get(f"/api/auth/set-password?token={raw}")
    assert chk.status_code == 200, chk.text
    body = chk.json()
    assert body["valid"] is True
    assert body["email"] == "pending@c1.local"
    assert body["name"] == "초대대기"
    assert body["company_name"] == "회사1"
    assert body["purpose"] == "invitation"


@pytest.mark.asyncio
async def test_check_unknown_token_is_invalid(async_client, seeded):
    chk = await async_client.get("/api/auth/set-password?token=totally-made-up")
    assert chk.status_code == 200, chk.text
    assert chk.json() == {"valid": False, "purpose": None, "email": None, "name": None, "company_name": None}


@pytest.mark.asyncio
async def test_set_password_then_login(async_client, seeded, admin_headers):
    """초대 링크로 본인이 비번 설정 → 즉시 로그인 토큰까지 (관리자는 비번을 모른다)."""
    r = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    raw = _token_of(r.json()["url"])

    done = await async_client.post("/api/auth/set-password", json={"token": raw, "password": "mynewpass123"})
    assert done.status_code == 200, done.text
    assert done.json()["user"]["id"] == PENDING_ID
    assert done.json()["user"]["company_id"] == C1
    assert done.json()["access_token"]

    login = await async_client.post(
        "/api/auth/login", json={"email": "pending@c1.local", "password": "mynewpass123"}
    )
    assert login.status_code == 200, login.text


@pytest.mark.asyncio
async def test_reset_link_replaces_old_password(async_client, seeded, admin_headers):
    r = await async_client.post(f"/api/employees/{MEMBER_ID}/access-link", headers=admin_headers)
    raw = _token_of(r.json()["url"])
    await async_client.post("/api/auth/set-password", json={"token": raw, "password": "resetpass999"})

    old = await async_client.post("/api/auth/login", json={"email": "member@c1.local", "password": "oldpass12345"})
    assert old.status_code == 401, "옛 비밀번호가 아직 살아있다"
    new = await async_client.post("/api/auth/login", json={"email": "member@c1.local", "password": "resetpass999"})
    assert new.status_code == 200, new.text


@pytest.mark.asyncio
async def test_token_is_single_use(async_client, seeded, admin_headers):
    r = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    raw = _token_of(r.json()["url"])

    first = await async_client.post("/api/auth/set-password", json={"token": raw, "password": "firstpass123"})
    assert first.status_code == 200, first.text
    second = await async_client.post("/api/auth/set-password", json={"token": raw, "password": "hijack123456"})
    assert second.status_code == 410, second.text
    assert second.json()["detail"] == "invalid_or_expired_token"


@pytest.mark.asyncio
async def test_reissue_revokes_previous_link(async_client, seeded, admin_headers):
    """재발급하면 이전 링크는 죽는다 — 안 그러면 '회수'가 의미를 잃는다."""
    first = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    old_raw = _token_of(first.json()["url"])
    second = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    new_raw = _token_of(second.json()["url"])
    assert old_raw != new_raw

    dead = await async_client.post("/api/auth/set-password", json={"token": old_raw, "password": "oldlink12345"})
    assert dead.status_code == 410, dead.text
    alive = await async_client.post("/api/auth/set-password", json={"token": new_raw, "password": "newlink12345"})
    assert alive.status_code == 200, alive.text


@pytest.mark.asyncio
async def test_revoke_kills_link(async_client, seeded, admin_headers):
    r = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    raw = _token_of(r.json()["url"])

    rev = await async_client.delete(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    assert rev.status_code == 204, rev.text

    chk = await async_client.get(f"/api/auth/set-password?token={raw}")
    assert chk.json()["valid"] is False
    used = await async_client.post("/api/auth/set-password", json={"token": raw, "password": "revoked12345"})
    assert used.status_code == 410, used.text


@pytest.mark.asyncio
async def test_revoke_cross_tenant_is_404(async_client, seeded, c2_admin_headers, admin_headers, db_session):
    await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    r = await async_client.delete(f"/api/employees/{PENDING_ID}/access-link", headers=c2_admin_headers)
    assert r.status_code == 404, r.text

    row = (await db_session.execute(select(AuthToken))).scalars().first()
    assert row.revoked_at is None  # 타사 호출로 회수되면 안 된다


@pytest.mark.asyncio
async def test_expired_token_is_rejected(async_client, seeded, admin_headers, db_session):
    r = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    raw = _token_of(r.json()["url"])

    row = (await db_session.execute(select(AuthToken))).scalars().one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db_session.commit()

    chk = await async_client.get(f"/api/auth/set-password?token={raw}")
    assert chk.json()["valid"] is False
    used = await async_client.post("/api/auth/set-password", json={"token": raw, "password": "expired12345"})
    assert used.status_code == 410, used.text


@pytest.mark.asyncio
async def test_link_dies_when_employee_deactivated(async_client, seeded, admin_headers, db_session):
    """발급 후 비활성된 계정의 링크는 죽어야 한다 (퇴사자 재진입 차단)."""
    r = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    raw = _token_of(r.json()["url"])

    row = (await db_session.execute(select(ErpUser).where(ErpUser.id == PENDING_ID))).scalar_one()
    row.is_active = False
    await db_session.commit()

    chk = await async_client.get(f"/api/auth/set-password?token={raw}")
    assert chk.json()["valid"] is False
    used = await async_client.post("/api/auth/set-password", json={"token": raw, "password": "ghostpass123"})
    assert used.status_code == 410, used.text


@pytest.mark.asyncio
async def test_weak_password_rejected(async_client, seeded, admin_headers):
    r = await async_client.post(f"/api/employees/{PENDING_ID}/access-link", headers=admin_headers)
    raw = _token_of(r.json()["url"])
    weak = await async_client.post("/api/auth/set-password", json={"token": raw, "password": "short"})
    assert weak.status_code == 422, weak.text


@pytest.mark.asyncio
async def test_setting_password_clears_login_backoff(async_client, seeded, admin_headers):
    """5회 실패로 잠긴 뒤 재설정하면 바로 새 비번으로 들어갈 수 있어야 한다."""
    for _ in range(5):
        await async_client.post("/api/auth/login", json={"email": "member@c1.local", "password": "wrong"})
    locked = await async_client.post(
        "/api/auth/login", json={"email": "member@c1.local", "password": "oldpass12345"}
    )
    assert locked.status_code == 429, "선행조건: 백오프가 걸려 있어야 함"

    r = await async_client.post(f"/api/employees/{MEMBER_ID}/access-link", headers=admin_headers)
    raw = _token_of(r.json()["url"])
    done = await async_client.post("/api/auth/set-password", json={"token": raw, "password": "afterlock1234"})
    assert done.status_code == 200, done.text

    login = await async_client.post(
        "/api/auth/login", json={"email": "member@c1.local", "password": "afterlock1234"}
    )
    assert login.status_code == 200, login.text


# ── 본인 비밀번호 변경 ──────────────────────────────────────
@pytest.mark.asyncio
async def test_change_password(async_client, seeded):
    headers = _headers(MEMBER_ID, "employee", C1)
    r = await async_client.post(
        "/api/auth/change-password",
        json={"current_password": "oldpass12345", "new_password": "changed12345"},
        headers=headers,
    )
    assert r.status_code == 204, r.text

    old = await async_client.post("/api/auth/login", json={"email": "member@c1.local", "password": "oldpass12345"})
    assert old.status_code == 401
    new = await async_client.post("/api/auth/login", json={"email": "member@c1.local", "password": "changed12345"})
    assert new.status_code == 200, new.text


@pytest.mark.asyncio
async def test_change_password_wrong_current_401(async_client, seeded):
    r = await async_client.post(
        "/api/auth/change-password",
        json={"current_password": "definitely-wrong", "new_password": "whatever12345"},
        headers=_headers(MEMBER_ID, "employee", C1),
    )
    assert r.status_code == 401, r.text
    assert r.json()["detail"] == "invalid_current_password"


@pytest.mark.asyncio
async def test_change_password_requires_auth(async_client, seeded):
    r = await async_client.post(
        "/api/auth/change-password",
        json={"current_password": "x", "new_password": "whatever12345"},
    )
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_change_password_revokes_outstanding_links(async_client, seeded, admin_headers):
    """본인이 비번을 바꿨는데 관리자가 뿌린 재설정 링크가 살아있으면 탈취 창이 열린다."""
    r = await async_client.post(f"/api/employees/{MEMBER_ID}/access-link", headers=admin_headers)
    raw = _token_of(r.json()["url"])

    await async_client.post(
        "/api/auth/change-password",
        json={"current_password": "oldpass12345", "new_password": "selfchosen123"},
        headers=_headers(MEMBER_ID, "employee", C1),
    )
    dead = await async_client.post("/api/auth/set-password", json={"token": raw, "password": "stolen123456"})
    assert dead.status_code == 410, dead.text
