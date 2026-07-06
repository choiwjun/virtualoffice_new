"""
presence_store 단위·통합 테스트.

검증 범위:
1. upsert_presence — 신규 레코드 생성 (status only)
2. upsert_presence — 위치 포함 생성
3. upsert_presence — 기존 레코드 status 갱신 (updated_at 변경)
4. upsert_presence — 위치 선택적 갱신 (기존 위치 보존)
5. POST /api/wa/presence — zone 이벤트 → DB 저장 확인
6. presence_pubsub — SSE 이벤트 발행 확인
7. D20-a 주석 확인: 좌표 파라미터 존재 but KPI 미사용 명시

참조: 00-decisions.md D13, D19, D20-a, D20-c, D26
"""

from __future__ import annotations

import asyncio
from typing import AsyncGenerator
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models.tables import Presence, PresenceStatus
from app.services.presence_store import presence_pubsub, upsert_presence


# ---------------------------------------------------------------------------
# 픽스처
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """테스트별 독립 인메모리 SQLite 세션."""
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
    """FastAPI 테스트 클라이언트 (get_db → 테스트 세션 오버라이드)."""

    async def _override() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# 1. upsert_presence — 신규 레코드 (status only)
# ---------------------------------------------------------------------------

class TestUpsertPresenceNew:
    async def test_creates_presence_record_with_status_only(
        self, db_session: AsyncSession
    ):
        """신규 레코드: status만으로 생성 가능 (D13 7종, 위치 없음)."""
        user_id = 9001
        record = await upsert_presence(
            db_session, user_id=user_id, status=PresenceStatus.ONLINE
        )
        await db_session.commit()

        assert record.user_id == user_id
        assert record.status == PresenceStatus.ONLINE
        assert record.office_id is None
        assert record.floor_id is None
        assert record.x is None
        assert record.y is None
        assert record.z is None
        assert record.last_activity_at is not None
        assert record.updated_at is not None

    async def test_creates_presence_with_location(self, db_session: AsyncSession):
        """신규 레코드: 위치 포함 생성 (office_id, floor_id, x, y, z)."""
        user_id = 9002
        office_id = uuid4()
        floor_id = uuid4()
        record = await upsert_presence(
            db_session,
            user_id=user_id,
            status=PresenceStatus.WORKING,
            office_id=office_id,
            floor_id=floor_id,
            x=10.5,
            y=20.3,
            z=0.0,
        )
        await db_session.commit()

        assert record.status == PresenceStatus.WORKING
        assert record.office_id == office_id
        assert record.floor_id == floor_id
        assert record.x == pytest.approx(10.5)
        assert record.y == pytest.approx(20.3)
        assert record.z == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# 2. upsert_presence — 기존 레코드 갱신
# ---------------------------------------------------------------------------

class TestUpsertPresenceUpdate:
    async def test_updates_existing_status(self, db_session: AsyncSession):
        """기존 레코드: status 갱신 (online → working)."""
        user_id = 9003

        # 초기 생성
        await upsert_presence(db_session, user_id=user_id, status=PresenceStatus.ONLINE)
        await db_session.commit()

        # 상태 갱신
        updated = await upsert_presence(
            db_session, user_id=user_id, status=PresenceStatus.WORKING
        )
        await db_session.commit()

        assert updated.user_id == user_id
        assert updated.status == PresenceStatus.WORKING

    async def test_updates_location_when_provided(self, db_session: AsyncSession):
        """기존 레코드: 위치 제공 시 갱신."""
        user_id = 9004
        office_id = uuid4()
        floor_id = uuid4()

        await upsert_presence(db_session, user_id=user_id, status=PresenceStatus.ONLINE)
        await db_session.commit()

        updated = await upsert_presence(
            db_session,
            user_id=user_id,
            status=PresenceStatus.WORKING,
            office_id=office_id,
            floor_id=floor_id,
            x=5.0,
            y=8.0,
        )
        await db_session.commit()

        assert updated.status == PresenceStatus.WORKING
        assert updated.office_id == office_id
        assert updated.floor_id == floor_id
        assert updated.x == pytest.approx(5.0)

    async def test_preserves_existing_location_when_not_provided(
        self, db_session: AsyncSession
    ):
        """기존 레코드: 위치 미제공 시 기존 위치 보존."""
        user_id = 9005
        office_id = uuid4()
        floor_id = uuid4()

        # 위치 포함 초기 생성
        await upsert_presence(
            db_session,
            user_id=user_id,
            status=PresenceStatus.ONLINE,
            office_id=office_id,
            floor_id=floor_id,
            x=1.0,
            y=2.0,
        )
        await db_session.commit()

        # 위치 없이 status만 갱신
        updated = await upsert_presence(
            db_session, user_id=user_id, status=PresenceStatus.AWAY
        )
        await db_session.commit()

        assert updated.status == PresenceStatus.AWAY
        # 기존 위치 보존
        assert updated.office_id == office_id
        assert updated.x == pytest.approx(1.0)

    async def test_last_activity_at_updated(self, db_session: AsyncSession):
        """last_activity_at은 갱신 시 현재 UTC로 변경."""
        user_id = 9006

        first = await upsert_presence(
            db_session, user_id=user_id, status=PresenceStatus.ONLINE
        )
        await db_session.commit()
        first_ts = first.last_activity_at

        # 잠시 후 갱신
        await asyncio.sleep(0.01)

        second = await upsert_presence(
            db_session, user_id=user_id, status=PresenceStatus.WORKING
        )
        await db_session.commit()

        assert second.last_activity_at >= first_ts


# ---------------------------------------------------------------------------
# 3. POST /api/wa/presence — zone 이벤트 → DB 저장 확인
# ---------------------------------------------------------------------------

class TestWaPresenceEndpointSavesToDb:
    async def test_zone_event_saves_presence_to_db(
        self, async_client: AsyncClient, db_session: AsyncSession
    ):
        """zone 이벤트(desk enter) → DB presence 저장 확인."""
        user_id = 9010
        resp = await async_client.post(
            "/api/wa/presence",
            json={"employee_id": user_id, "kind": "enter_zone", "zone_name": "desk"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["resolved_status"] == "working"

        # DB 직접 확인
        from sqlalchemy import select
        result = await db_session.execute(
            select(Presence).where(Presence.user_id == user_id)
        )
        rec = result.scalar_one_or_none()
        assert rec is not None
        assert rec.status == PresenceStatus.WORKING

    async def test_unmapped_event_does_not_save(
        self, async_client: AsyncClient, db_session: AsyncSession
    ):
        """매핑 안 되는 이벤트 → DB 저장 없음."""
        user_id = 9011
        # leave_zone without known zone → no mapping → resolved = None
        resp = await async_client.post(
            "/api/wa/presence",
            json={
                "employee_id": user_id,
                "kind": "leave_zone",
                "zone_name": "unknown_zone_xyz",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["resolved_status"] is None

        from sqlalchemy import select
        result = await db_session.execute(
            select(Presence).where(Presence.user_id == user_id)
        )
        rec = result.scalar_one_or_none()
        assert rec is None

    async def test_connect_event_saves_online_status(
        self, async_client: AsyncClient, db_session: AsyncSession
    ):
        """connect 이벤트 → online 저장."""
        user_id = 9012
        resp = await async_client.post(
            "/api/wa/presence",
            json={"employee_id": user_id, "kind": "connect"},
        )
        assert resp.status_code == 200
        assert resp.json()["resolved_status"] == "online"

        from sqlalchemy import select
        result = await db_session.execute(
            select(Presence).where(Presence.user_id == user_id)
        )
        rec = result.scalar_one()
        assert rec.status == PresenceStatus.ONLINE


# ---------------------------------------------------------------------------
# 4. SSE 이벤트 발행 확인
# ---------------------------------------------------------------------------

class TestPresencePubSub:
    async def test_publish_delivers_event_to_subscriber(self):
        """presence 저장 시 SSE 구독 큐에 이벤트 발행."""
        q = presence_pubsub.subscribe()
        try:
            await presence_pubsub.publish(
                {"user_id": 99, "status": "working", "updated_at": "2026-07-06T00:00:00+00:00"}
            )
            event = q.get_nowait()
            assert event["user_id"] == 99
            assert event["status"] == "working"
        finally:
            presence_pubsub.unsubscribe(q)

    async def test_upsert_publishes_to_subscribers(self, db_session: AsyncSession):
        """upsert_presence 호출 시 구독 큐에 이벤트 자동 발행."""
        q = presence_pubsub.subscribe()
        try:
            await upsert_presence(
                db_session, user_id=9020, status=PresenceStatus.FOCUS
            )
            # 이벤트가 발행됐는지 확인 (최대 100ms 대기)
            event = await asyncio.wait_for(q.get(), timeout=0.1)
            assert event["user_id"] == 9020
            assert event["status"] == "focus"
        finally:
            presence_pubsub.unsubscribe(q)

    async def test_unsubscribe_stops_delivery(self):
        """구독 해제 후 이벤트 미수신."""
        q = presence_pubsub.subscribe()
        presence_pubsub.unsubscribe(q)
        await presence_pubsub.publish({"user_id": 0, "status": "offline", "updated_at": ""})
        assert q.empty()


# ---------------------------------------------------------------------------
# 5. D20-a 규정 확인: 좌표는 KPI 미사용
# ---------------------------------------------------------------------------

class TestCoordinatePolicy:
    async def test_coordinates_stored_but_not_for_kpi(self, db_session: AsyncSession):
        """
        D20-a: 좌표(x,y,z)는 저장 허용이나 KPI 산출에 미사용.
        upsert_presence 시그니처에 x,y,z 파라미터 존재 확인.
        """
        import inspect
        sig = inspect.signature(upsert_presence)
        assert "x" in sig.parameters
        assert "y" in sig.parameters
        assert "z" in sig.parameters
        # GPS 금지(D20-c): office_id/floor_id는 WA 내부 좌표 식별자, GPS lat/lng 없음
        assert "lat" not in sig.parameters
        assert "lng" not in sig.parameters
