"""1:1 대화(DM) + 즉석 통화 토큰 — 팀원 상호작용 (09 §3.3 · D24).

설계 경계를 고정한다:
- DM 채널 id는 두 user_id를 정렬해 만든다 → A→B와 B→A가 같은 대화로 수렴.
- **admin도 남의 DM을 열람할 수 없다.** 팀 채널은 감독 목적으로 admin을 허용하지만
  1:1 대화에 같은 규칙을 적용하면 사찰이 된다.
- DM·통화 모두 같은 회사 안에서만. 타사·비활성·미존재는 동일 응답(사용자 탐색 차단).
- 통화 룸 이름은 참여자 2인을 인코딩 → 자기가 없는 룸의 토큰은 발급될 수 없다.
"""

from __future__ import annotations

from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.calls import call_room
from app.api.chat import dm_channel, dm_members
from app.core.security import create_access_token
from app.db import Base, get_db
from app.main import app
from app.models.tables import Company, ErpRole, ErpUser

C1, C2 = 1, 2
ALICE, BOB, ADMIN, C2_USER = 1001, 1002, 1003, 2001


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


def _headers(user_id: int, company_id: int, role: str = "employee", team_id: int = 1) -> dict:
    token = create_access_token(
        {"sub": str(user_id), "email": f"u{user_id}@t.local", "role": role,
         "company_id": company_id, "team_id": team_id}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def alice() -> dict:
    return _headers(ALICE, C1)


@pytest.fixture
def bob() -> dict:
    return _headers(BOB, C1)


@pytest.fixture
def admin() -> dict:
    return _headers(ADMIN, C1, "admin")


@pytest.fixture
def outsider() -> dict:
    return _headers(C2_USER, C2)


@pytest_asyncio.fixture
async def seeded(db_session: AsyncSession) -> None:
    db_session.add_all([
        Company(id=C1, name="회사1", slug="c1"),
        Company(id=C2, name="회사2", slug="c2"),
        ErpUser(id=ALICE, company_id=C1, email="alice@t.local", name="앨리스", erp_team_id=1,
                role=ErpRole.EMPLOYEE, is_active=True),
        ErpUser(id=BOB, company_id=C1, email="bob@t.local", name="밥", erp_team_id=1,
                role=ErpRole.EMPLOYEE, is_active=True),
        ErpUser(id=ADMIN, company_id=C1, email="admin@t.local", name="관리자", erp_team_id=1,
                role=ErpRole.ADMIN, is_active=True),
        ErpUser(id=C2_USER, company_id=C2, email="out@t.local", name="타사", erp_team_id=1,
                role=ErpRole.EMPLOYEE, is_active=True),
    ])
    await db_session.commit()


# ── 채널 id 규칙 ───────────────────────────────────────────
def test_dm_channel_is_order_independent():
    """A→B와 B→A가 같은 채널이어야 대화가 둘로 갈라지지 않는다."""
    assert dm_channel(1001, 1002) == dm_channel(1002, 1001) == "dm:1001-1002"
    assert dm_members("dm:1001-1002") == (1001, 1002)
    assert dm_members("dm:bad") is None
    assert dm_members("team:1") is None


def test_call_room_is_order_independent():
    assert call_room(1001, 1002) == call_room(1002, 1001) == "call:1001-1002"


# ── DM 열기 ────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_open_dm(async_client, seeded, alice):
    r = await async_client.post("/api/chat/dm", json={"user_id": BOB}, headers=alice)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == "dm:1001-1002"
    assert r.json()["kind"] == "dm"
    assert r.json()["peer_user_id"] == BOB
    assert r.json()["label"] == "밥"


@pytest.mark.asyncio
async def test_open_dm_both_directions_same_channel(async_client, seeded, alice, bob):
    a = (await async_client.post("/api/chat/dm", json={"user_id": BOB}, headers=alice)).json()
    b = (await async_client.post("/api/chat/dm", json={"user_id": ALICE}, headers=bob)).json()
    assert a["id"] == b["id"]


@pytest.mark.asyncio
async def test_cannot_dm_self(async_client, seeded, alice):
    r = await async_client.post("/api/chat/dm", json={"user_id": ALICE}, headers=alice)
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "cannot_dm_self"


@pytest.mark.asyncio
async def test_cannot_dm_other_tenant(async_client, seeded, alice):
    r = await async_client.post("/api/chat/dm", json={"user_id": C2_USER}, headers=alice)
    assert r.status_code == 404, r.text


# ── DM 메시지 · 접근 제어 ──────────────────────────────────
@pytest.mark.asyncio
async def test_dm_message_roundtrip(async_client, seeded, alice, bob):
    ch = "dm:1001-1002"
    r = await async_client.post("/api/chat/messages", json={"channel": ch, "content": "안녕"}, headers=alice)
    assert r.status_code == 201, r.text

    got = await async_client.get(f"/api/chat/messages?channel={ch}", headers=bob)
    assert got.status_code == 200, got.text
    assert [m["content"] for m in got.json()] == ["안녕"]


@pytest.mark.asyncio
async def test_third_party_cannot_read_dm(async_client, seeded, alice):
    """당사자가 아닌 사람은 채널 id를 알아도 못 읽는다."""
    ch = "dm:1001-1002"
    await async_client.post("/api/chat/messages", json={"channel": ch, "content": "비밀"}, headers=alice)

    third = _headers(4004, C1)
    r = await async_client.get(f"/api/chat/messages?channel={ch}", headers=third)
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_admin_cannot_read_others_dm(async_client, seeded, alice, admin):
    """팀 채널과 달리 1:1 대화는 admin도 열람 불가 — 감독 권한으로 열면 사찰이 된다."""
    ch = "dm:1001-1002"
    await async_client.post("/api/chat/messages", json={"channel": ch, "content": "사적인 얘기"}, headers=alice)

    r = await async_client.get(f"/api/chat/messages?channel={ch}", headers=admin)
    assert r.status_code == 403, r.text
    w = await async_client.post("/api/chat/messages", json={"channel": ch, "content": "끼어들기"}, headers=admin)
    assert w.status_code == 403, w.text


@pytest.mark.asyncio
async def test_admin_can_still_read_team_channel(async_client, seeded, admin):
    """대비 확인 — 팀 채널의 기존 admin 허용은 그대로다(회귀 방지)."""
    r = await async_client.get("/api/chat/messages?channel=team:1", headers=admin)
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_malformed_dm_channel_400(async_client, seeded, alice):
    r = await async_client.get("/api/chat/messages?channel=dm:notnumbers", headers=alice)
    assert r.status_code == 400, r.text


# ── 채널 목록 ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_dm_appears_in_channel_list_after_message(async_client, seeded, alice):
    """빈 대화는 목록을 어지럽힌다 — 메시지가 오간 뒤에만 나온다."""
    before = (await async_client.get("/api/chat/channels", headers=alice)).json()
    assert all(c["kind"] != "dm" for c in before)

    await async_client.post("/api/chat/messages", json={"channel": "dm:1001-1002", "content": "hi"}, headers=alice)
    after = (await async_client.get("/api/chat/channels", headers=alice)).json()
    dms = [c for c in after if c["kind"] == "dm"]
    assert len(dms) == 1
    assert dms[0]["id"] == "dm:1001-1002"
    assert dms[0]["label"] == "밥"  # 상대 이름으로 표시
    assert dms[0]["peer_user_id"] == BOB


@pytest.mark.asyncio
async def test_channel_list_does_not_leak_others_dms(async_client, seeded, alice):
    """내가 낀 대화만 목록에 나와야 한다."""
    other = _headers(4004, C1)
    await async_client.post("/api/chat/messages", json={"channel": "dm:1003-4004", "content": "x"}, headers=other)

    mine = (await async_client.get("/api/chat/channels", headers=alice)).json()
    assert all(c["id"] != "dm:1003-4004" for c in mine)


# ── 통화 토큰 ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_call_token(async_client, seeded, alice):
    r = await async_client.post("/api/calls/token", json={"peer_user_id": BOB}, headers=alice)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["room"] == "call:1001-1002"
    assert body["peer_user_id"] == BOB
    assert body["peer_name"] == "밥"
    assert body["token"]


@pytest.mark.asyncio
async def test_call_token_room_is_shared_by_both(async_client, seeded, alice, bob):
    """양쪽이 같은 룸으로 수렴해야 통화가 성립한다."""
    a = (await async_client.post("/api/calls/token", json={"peer_user_id": BOB}, headers=alice)).json()
    b = (await async_client.post("/api/calls/token", json={"peer_user_id": ALICE}, headers=bob)).json()
    assert a["room"] == b["room"]
    assert a["token"] != b["token"]  # identity가 다르므로 토큰은 달라야 한다


@pytest.mark.asyncio
async def test_cannot_call_self(async_client, seeded, alice):
    r = await async_client.post("/api/calls/token", json={"peer_user_id": ALICE}, headers=alice)
    assert r.status_code == 400, r.text
    assert r.json()["detail"] == "cannot_call_self"


@pytest.mark.asyncio
async def test_cannot_call_other_tenant(async_client, seeded, alice):
    r = await async_client.post("/api/calls/token", json={"peer_user_id": C2_USER}, headers=alice)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_cannot_call_inactive_user(async_client, seeded, alice, db_session):
    from sqlalchemy import select

    row = (await db_session.execute(select(ErpUser).where(ErpUser.id == BOB))).scalar_one()
    row.is_active = False
    await db_session.commit()

    r = await async_client.post("/api/calls/token", json={"peer_user_id": BOB}, headers=alice)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_call_token_requires_auth(async_client, seeded):
    r = await async_client.post("/api/calls/token", json={"peer_user_id": BOB})
    assert r.status_code == 401, r.text
