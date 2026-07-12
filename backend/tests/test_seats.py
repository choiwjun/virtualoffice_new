"""
좌석 점유/반납 통합 테스트.

검증 범위:
1. GET /api/seats — 전체 목록 / 층 필터
2. POST /api/seat-assignments — 점유 성공 → seat.status=occupied + history INSERT(assigned_at)
3. POST /api/seat-assignments — 이미 점유된 좌석 → 409
4. POST /api/seat-assignments — fixed 좌석이고 타인 배정 → 409
5. POST /api/seat-assignments/{seat_id}/release — 반납 → status=available + unassigned_at 갱신
6. 반납 후 재점유 가능 확인

참조: 00-decisions.md D10, D19; 05-office-layout-schema §3.11
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

from app.core.security import create_access_token
from app.db import Base, get_db
from app.main import app
from app.models.tables import (
    Seat,
    SeatAssignmentHistory,
    SeatStatus,
    SeatType,
)


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


@pytest.fixture
def user_token() -> str:
    """사용자 1001 (alice) JWT 토큰."""
    return create_access_token({"sub": "1001", "email": "alice@test.local", "role": "admin"})


@pytest.fixture
def user2_token() -> str:
    """사용자 1002 (bob) JWT 토큰."""
    return create_access_token({"sub": "1002", "email": "bob@test.local", "role": "employee"})


@pytest.fixture
def auth_headers(user_token: str) -> dict:
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture
def auth_headers_user2(user2_token: str) -> dict:
    return {"Authorization": f"Bearer {user2_token}"}


async def _create_seat(
    db: AsyncSession,
    *,
    floor_id=None,
    seat_type: SeatType = SeatType.FREE,
    seat_status: SeatStatus = SeatStatus.AVAILABLE,
    assigned_user_id=None,
) -> Seat:
    """테스트용 좌석 생성 헬퍼."""
    seat = Seat(
        id=uuid4(),
        floor_id=floor_id or uuid4(),
        type=seat_type,
        status=seat_status,
        assigned_user_id=assigned_user_id,
        coords={"x": 1.0, "y": 2.0},
    )
    db.add(seat)
    await db.flush()
    return seat


# ---------------------------------------------------------------------------
# 1. GET /api/seats
# ---------------------------------------------------------------------------

class TestListSeats:
    async def test_returns_empty_list_when_no_seats(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        """좌석 없으면 빈 목록 반환."""
        resp = await async_client.get("/api/seats", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_returns_all_seats(
        self, async_client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ):
        """좌석 2개 생성 후 전체 목록 반환."""
        await _create_seat(db_session)
        await _create_seat(db_session)
        await db_session.commit()

        resp = await async_client.get("/api/seats", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    async def test_filters_by_floor_id(
        self, async_client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ):
        """floor_id 필터링."""
        floor_a = uuid4()
        floor_b = uuid4()
        await _create_seat(db_session, floor_id=floor_a)
        await _create_seat(db_session, floor_id=floor_b)
        await db_session.commit()

        resp = await async_client.get(f"/api/seats?floor_id={floor_a}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["floor_id"] == str(floor_a)

    async def test_invalid_floor_id_returns_400(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        """잘못된 floor_id → 400."""
        resp = await async_client.get("/api/seats?floor_id=not-a-uuid", headers=auth_headers)
        assert resp.status_code == 400

    async def test_requires_auth(self, async_client: AsyncClient):
        """HG-SEC: 인증 없이 좌석 목록 조회 → 401/403."""
        resp = await async_client.get("/api/seats")
        assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# 2. POST /api/seat-assignments — 점유 성공
# ---------------------------------------------------------------------------

class TestAssignSeat:
    async def test_assigns_available_seat(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
    ):
        """빈 좌석 점유 성공 → status=occupied, history INSERT."""
        seat = await _create_seat(db_session, seat_status=SeatStatus.AVAILABLE)
        await db_session.commit()

        resp = await async_client.post(
            "/api/seat-assignments",
            json={"seat_id": str(seat.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["seat_id"] == str(seat.id)
        assert body["status"] == "occupied"

    async def test_seat_status_becomes_occupied(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
    ):
        """점유 후 seat.status = occupied."""
        seat = await _create_seat(db_session)
        await db_session.commit()

        await async_client.post(
            "/api/seat-assignments",
            json={"seat_id": str(seat.id)},
            headers=auth_headers,
        )

        await db_session.refresh(seat)
        assert seat.status == SeatStatus.OCCUPIED
        assert seat.assigned_user_id == 1001  # alice (sub from token)

    async def test_history_row_inserted(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
    ):
        """점유 시 seat_assignment_history 레코드 INSERT(assigned_at)."""
        seat = await _create_seat(db_session)
        await db_session.commit()

        await async_client.post(
            "/api/seat-assignments",
            json={"seat_id": str(seat.id)},
            headers=auth_headers,
        )

        result = await db_session.execute(
            select(SeatAssignmentHistory).where(
                SeatAssignmentHistory.seat_id == seat.id
            )
        )
        history = result.scalars().all()
        assert len(history) == 1
        assert history[0].assigned_at is not None
        assert history[0].unassigned_at is None

    async def test_assign_with_explicit_user_id(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
    ):
        """body에 user_id 명시 → 해당 사용자에게 배정."""
        seat = await _create_seat(db_session)
        await db_session.commit()

        resp = await async_client.post(
            "/api/seat-assignments",
            json={"seat_id": str(seat.id), "user_id": 1002},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["user_id"] == 1002

    async def test_unauthenticated_returns_401(
        self, async_client: AsyncClient, db_session: AsyncSession
    ):
        """인증 없이 요청 → 401."""
        seat = await _create_seat(db_session)
        await db_session.commit()

        resp = await async_client.post(
            "/api/seat-assignments",
            json={"seat_id": str(seat.id)},
        )
        assert resp.status_code == 401

    async def test_nonexistent_seat_returns_404(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        """존재하지 않는 좌석 → 404."""
        resp = await async_client.post(
            "/api/seat-assignments",
            json={"seat_id": str(uuid4())},
            headers=auth_headers,
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 3. 중복 점유 409
# ---------------------------------------------------------------------------

class TestAssignSeatConflict:
    async def test_already_occupied_returns_409(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
    ):
        """이미 OCCUPIED 좌석 점유 시도 → 409."""
        seat = await _create_seat(
            db_session,
            seat_status=SeatStatus.OCCUPIED,
            assigned_user_id=1002,
        )
        await db_session.commit()

        resp = await async_client.post(
            "/api/seat-assignments",
            json={"seat_id": str(seat.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 409
        assert resp.json()["detail"] == "seat_already_occupied"

    async def test_fixed_seat_with_other_user_returns_409(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
    ):
        """fixed 좌석이고 타인(1002)이 배정된 경우 alice(1001) 점유 시도 → 409 (§3.11)."""
        seat = await _create_seat(
            db_session,
            seat_type=SeatType.FIXED,
            seat_status=SeatStatus.AVAILABLE,   # AVAILABLE이어도
            assigned_user_id=1002,              # 타인(bob) 고정 배정됨
        )
        await db_session.commit()

        resp = await async_client.post(
            "/api/seat-assignments",
            json={"seat_id": str(seat.id)},
            headers=auth_headers,   # alice(1001)로 요청
        )
        assert resp.status_code == 409
        assert resp.json()["detail"] == "seat_fixed_to_other_user"


# ---------------------------------------------------------------------------
# 4. POST /api/seat-assignments/{seat_id}/release — 반납
# ---------------------------------------------------------------------------

class TestReleaseSeat:
    async def test_release_sets_status_to_available(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
    ):
        """반납 → status=available, assigned_user_id=NULL."""
        seat = await _create_seat(
            db_session,
            seat_status=SeatStatus.OCCUPIED,
            assigned_user_id=1001,
        )
        await db_session.commit()

        resp = await async_client.post(
            f"/api/seat-assignments/{seat.id}/release",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "available"

        await db_session.refresh(seat)
        assert seat.status == SeatStatus.AVAILABLE
        assert seat.assigned_user_id is None

    async def test_release_updates_history_unassigned_at(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
    ):
        """반납 → history.unassigned_at 갱신 (D19 UTC)."""
        seat = await _create_seat(
            db_session,
            seat_status=SeatStatus.OCCUPIED,
            assigned_user_id=1001,
        )
        # history 레코드 미리 삽입
        history = SeatAssignmentHistory(
            seat_id=seat.id,
            user_id=1001,
            assigned_at=datetime.now(timezone.utc),
        )
        db_session.add(history)
        await db_session.commit()

        resp = await async_client.post(
            f"/api/seat-assignments/{seat.id}/release",
            headers=auth_headers,
        )
        assert resp.status_code == 200

        await db_session.refresh(history)
        assert history.unassigned_at is not None

    async def test_release_not_occupied_returns_409(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
    ):
        """이미 AVAILABLE 좌석 반납 시도 → 409."""
        seat = await _create_seat(db_session, seat_status=SeatStatus.AVAILABLE)
        await db_session.commit()

        resp = await async_client.post(
            f"/api/seat-assignments/{seat.id}/release",
            headers=auth_headers,
        )
        assert resp.status_code == 409
        assert resp.json()["detail"] == "seat_not_occupied"

    async def test_release_nonexistent_returns_404(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        """존재하지 않는 좌석 반납 → 404."""
        resp = await async_client.post(
            f"/api/seat-assignments/{uuid4()}/release",
            headers=auth_headers,
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 5. 반납 후 재점유
# ---------------------------------------------------------------------------

class TestReleaseAndReassign:
    async def test_can_reassign_after_release(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
        auth_headers_user2: dict,
    ):
        """반납 후 다른 사용자가 재점유 가능."""
        seat = await _create_seat(
            db_session,
            seat_status=SeatStatus.OCCUPIED,
            assigned_user_id=1001,
        )
        history = SeatAssignmentHistory(
            seat_id=seat.id,
            user_id=1001,
            assigned_at=datetime.now(timezone.utc),
        )
        db_session.add(history)
        await db_session.commit()

        # alice 반납
        resp = await async_client.post(
            f"/api/seat-assignments/{seat.id}/release",
            headers=auth_headers,
        )
        assert resp.status_code == 200

        # bob 재점유
        resp2 = await async_client.post(
            "/api/seat-assignments",
            json={"seat_id": str(seat.id)},
            headers=auth_headers_user2,
        )
        assert resp2.status_code == 201
        assert resp2.json()["user_id"] == 1002

        await db_session.refresh(seat)
        assert seat.assigned_user_id == 1002
        assert seat.status == SeatStatus.OCCUPIED
