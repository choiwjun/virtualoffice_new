"""셀프서브 테넌트 프로비저닝 — POST /api/auth/register (24-spec Phase 2 · 22 T0-4 · 23 E2).

공개(미인증) 라우트: 새 Company + 첫 admin ErpUser 생성 후 즉시 로그인 토큰 발급.
커버리지:
- 성공: 회사+admin 생성, 토큰·user.company_id(≠1)·company.slug 반환, /me 200.
- 교차 테넌트 격리: 신규 admin은 자기 (빈) 테넌트만 조회 — company-1 시드 데이터 안 보임.
- 이메일 중복 → 409, 같은 회사명 → 다른 유니크 slug.
- 짧은 비번/잘못된 이메일/빈 회사명 → 422.
- native id 대역: 신규 admin id는 ERP/시드 대역(1001~,2001~)과 겹치지 않는 10억+.
- 클라가 company_id/role/id 지정 시도 → 무시(서버 강제).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import AsyncGenerator
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models.tables import (
    Company,
    DEFAULT_COMPANY_ID,
    ErpRole,
    ErpUser,
    Meeting,
    MeetingStatus,
    Room,
    RoomStatus,
    RoomType,
)


# ---------------------------------------------------------------------------
# 픽스처 (표준 인메모리 SQLite + get_db 오버라이드)
# ---------------------------------------------------------------------------


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


@pytest_asyncio.fixture
async def company1_seed(db_session: AsyncSession) -> dict:
    """기본 회사(id=1) + 그 회사의 admin·Room·Meeting 시드.

    신규로 가입한 테넌트가 이 company-1 데이터를 절대 못 보는지 검증하기 위한 미끼.
    """
    now = datetime.now(timezone.utc)
    db_session.add(
        Company(id=DEFAULT_COMPANY_ID, name="기본 회사", slug="default", created_at=now, updated_at=now)
    )
    db_session.add(
        ErpUser(id=1001, company_id=1, email="alice@virtualoffice.local", name="김앨리스",
                erp_team_id=1, role=ErpRole.ADMIN)
    )
    room1 = Room(id=uuid4(), floor_id=uuid4(), type=RoomType.MEETING, name="회사1 회의실",
                 capacity=10, coords={"x": 0, "y": 0, "width": 5, "height": 5}, status=RoomStatus.ACTIVE)
    db_session.add(room1)
    m1 = Meeting(id=uuid4(), company_id=1, room_id=room1.id, host_user_id=1001,
                 title="회사1 회의", scheduled_at=now, duration_minutes=60, status=MeetingStatus.SCHEDULED)
    db_session.add(m1)
    await db_session.commit()
    return {"m1": m1}


def _valid_body(**over) -> dict:
    body = {
        "company_name": "Acme Robotics",
        "admin_name": "Alice Owner",
        "admin_email": "owner@acme.example",
        "admin_password": "sup3r-secret-pw",
    }
    body.update(over)
    return body


# ---------------------------------------------------------------------------
# 성공 경로
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_creates_company_and_admin(async_client, company1_seed):
    """새 회사+admin 생성 → 토큰·user.company_id(≠1)·company.slug 반환."""
    r = await async_client.post("/api/auth/register", json=_valid_body())
    assert r.status_code == 200, r.text
    body = r.json()

    # 토큰·타입·만료
    assert body["access_token"]
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0

    # user: /login과 동일 UserInfo shape + 새 company_id
    user = body["user"]
    assert user["email"] == "owner@acme.example"
    assert user["role"] == "admin"
    assert user["company_id"] != DEFAULT_COMPANY_ID  # 새 테넌트 (NOT 1)
    assert user["company_id"] == body["company"]["id"]

    # company 블록
    company = body["company"]
    assert company["name"] == "Acme Robotics"
    assert company["slug"] == "acme-robotics"
    assert isinstance(company["id"], int)


@pytest.mark.asyncio
async def test_register_token_works_on_me(async_client, company1_seed):
    """발급 토큰으로 /api/auth/me → 200 + 올바른 company_id (즉시 로그인)."""
    r = await async_client.post("/api/auth/register", json=_valid_body())
    body = r.json()
    token = body["access_token"]
    new_cid = body["user"]["company_id"]

    me = await async_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    assert me.json()["company_id"] == new_cid
    assert me.json()["email"] == "owner@acme.example"


@pytest.mark.asyncio
async def test_register_admin_id_in_native_band(async_client, company1_seed):
    """첫 admin id는 ERP 조인키·시드 대역(1001~, 2001~)과 겹치지 않는 10억+ 대역."""
    r = await async_client.post("/api/auth/register", json=_valid_body())
    assert r.status_code == 200, r.text
    assert r.json()["user"]["id"] >= 1_000_000_000


# ---------------------------------------------------------------------------
# 교차 테넌트 격리 (신규 테넌트는 자기 것만 — company-1 시드 안 보임)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_registered_admin_sees_only_own_empty_tenant(async_client, company1_seed):
    """갓 가입한 admin의 토큰으로 /api/meetings → company-1 시드 회의 미포함(빈 목록)."""
    r = await async_client.post("/api/auth/register", json=_valid_body())
    token = r.json()["access_token"]

    ml = await async_client.get("/api/meetings", headers={"Authorization": f"Bearer {token}"})
    assert ml.status_code == 200, ml.text
    ids = {m["id"] for m in ml.json()}
    assert str(company1_seed["m1"].id) not in ids  # company-1 미끼 안 보임
    assert ids == set()  # 신규 테넌트는 비어 있음


# ---------------------------------------------------------------------------
# 중복·유니크 slug
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_duplicate_email_409(async_client, company1_seed):
    """이메일 중복(전 테넌트) → 409 email_taken."""
    r1 = await async_client.post("/api/auth/register", json=_valid_body())
    assert r1.status_code == 200, r1.text
    r2 = await async_client.post(
        "/api/auth/register",
        json=_valid_body(company_name="Other Co"),  # 같은 이메일, 다른 회사명
    )
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"] == "email_taken"


@pytest.mark.asyncio
async def test_register_same_name_gets_unique_slug(async_client, company1_seed):
    """같은 회사명으로 2번째 가입 → slug 충돌 회피(-2 접미사), 서로 다른 유니크 slug."""
    r1 = await async_client.post("/api/auth/register", json=_valid_body(admin_email="a@acme.example"))
    r2 = await async_client.post("/api/auth/register", json=_valid_body(admin_email="b@acme.example"))
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    s1 = r1.json()["company"]["slug"]
    s2 = r2.json()["company"]["slug"]
    assert s1 == "acme-robotics"
    assert s2 == "acme-robotics-2"
    assert s1 != s2


# ---------------------------------------------------------------------------
# 검증 실패 → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_short_password_422(async_client, company1_seed):
    r = await async_client.post("/api/auth/register", json=_valid_body(admin_password="short"))
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_register_bad_email_422(async_client, company1_seed):
    r = await async_client.post("/api/auth/register", json=_valid_body(admin_email="not-an-email"))
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_register_empty_company_name_422(async_client, company1_seed):
    r = await async_client.post("/api/auth/register", json=_valid_body(company_name="   "))
    assert r.status_code == 422, r.text


# ---------------------------------------------------------------------------
# 권한 상승 차단 — 클라가 company_id/role/id를 지정해도 무시
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_ignores_client_supplied_privileged_fields(
    async_client, company1_seed, db_session
):
    """클라가 company_id=1·role=super_admin·id=1001을 밀어넣어도 서버가 강제로 새 값 부여."""
    body = _valid_body()
    body.update({"company_id": 1, "role": "super_admin", "id": 1001, "erp_team_id": 999})
    r = await async_client.post("/api/auth/register", json=body)
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    assert user["company_id"] != 1  # company-1 탈취 불가
    assert user["role"] == "admin"  # super_admin 승격 불가
    assert user["id"] != 1001  # 기존 시드 id 덮어쓰기 불가

    # DB에서도 확인: 새 admin은 native id로, company-1 alice(1001)는 그대로.
    alice = (await db_session.execute(select(ErpUser).where(ErpUser.id == 1001))).scalar_one()
    assert alice.email == "alice@virtualoffice.local"  # 미변조


# ---------------------------------------------------------------------------
# rate-limit (login과 동일 IP 예산 — LoginRateLimitMiddleware가 /register도 커버)
# ---------------------------------------------------------------------------


def _reset_ratelimit_buckets():
    """빌드된 미들웨어 스택을 순회해 LoginRateLimitMiddleware의 IP 버킷을 비운다.

    이 미들웨어는 app에 1개, in-memory 슬라이딩 윈도우(60s)라 같은 스위트의 다른
    rate-limit 테스트/가입 호출이 버킷을 오염시킨다 → 임계값 테스트 전 리셋(오염 제거).
    주의: app.middleware_stack은 첫 요청에서 지연 빌드되므로, 호출 시점엔 이미
    async_client가 warm-up 요청을 보내 스택이 존재한다.
    """
    from app.core.ratelimit import LoginRateLimitMiddleware

    node = app.middleware_stack
    depth = 0
    while node is not None and depth < 50:
        if isinstance(node, LoginRateLimitMiddleware):
            node._hits.clear()
        node = getattr(node, "app", None)
        depth += 1


@pytest.mark.asyncio
async def test_register_ip_rate_limited(async_client, company1_seed):
    """동일 IP에서 임계값 초과 가입 → 429 (login과 동일한 IP rate-limit 미들웨어)."""
    from app.config import settings

    # warm-up: 첫 요청으로 app.middleware_stack을 빌드시킨 뒤 버킷을 리셋한다.
    await async_client.get("/health")
    _reset_ratelimit_buckets()

    prev = settings.login_rate_limit_per_min
    settings.login_rate_limit_per_min = 2  # 테스트용 낮은 임계값
    try:
        codes = []
        for i in range(3):
            r = await async_client.post(
                "/api/auth/register", json=_valid_body(admin_email=f"u{i}@acme.example")
            )
            codes.append(r.status_code)
        assert codes[:2] == [200, 200], codes  # 처음 2회 통과
        assert codes[2] == 429, codes  # 3번째는 IP 제한 429
    finally:
        settings.login_rate_limit_per_min = prev
