"""
pytest 구성 및 공유 픽스처 (실제 앱 연결됨).

참조:
- 00-decisions.md: D4(JWT HS256 자체시크릿), D18(soft-delete), D21(1인 운영)
- 11-tech-stack.md: FastAPI, SQLAlchemy async, pytest-asyncio
- asyncio_mode=auto (pytest.ini) — async 테스트/픽스처 자동 처리

구성:
1. 테스트 DB: SQLite in-memory (테스트별 격리 엔진, StaticPool)
2. FastAPI AsyncClient (get_db 오버라이드)
3. JWT 토큰 팩토리 (employee/leader/admin)
4. 시드 데이터 픽스처
"""

import asyncio
import os
from datetime import timedelta
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db import Base, get_db
from app.main import app

# Windows: Selector 이벤트루프 (asyncpg/aiosqlite 호환)
if os.name == "nt":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

DATABASE_URL_TEST = "sqlite+aiosqlite:///:memory:"


# ============================================================================
# DB: 테스트별 격리 인메모리 엔진
# ============================================================================

@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """테스트별 신규 인메모리 DB + 세션. 종료 시 폐기(자동 격리)."""
    engine = create_async_engine(
        DATABASE_URL_TEST,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        yield session

    await engine.dispose()


@pytest_asyncio.fixture
async def async_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """FastAPI 비동기 테스트 클라이언트. get_db → 테스트 세션 오버라이드."""

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


# ============================================================================
# JWT 토큰 팩토리 (D4: HS256 자체 시크릿, 24h)
# ============================================================================

@pytest.fixture
def employee_token() -> str:
    return create_access_token(
        {"sub": "1", "email": "employee@example.com", "role": "employee"},
        expires_delta=timedelta(hours=8),
    )


@pytest.fixture
def leader_token() -> str:
    return create_access_token(
        {"sub": "2", "email": "leader@example.com", "role": "leader", "team_id": 1},
        expires_delta=timedelta(hours=8),
    )


@pytest.fixture
def admin_token() -> str:
    return create_access_token(
        {"sub": "3", "email": "admin@example.com", "role": "admin"},
        expires_delta=timedelta(hours=8),
    )


@pytest.fixture
def auth_headers(employee_token: str) -> dict:
    return {"Authorization": f"Bearer {employee_token}"}


@pytest.fixture
def admin_auth_headers(admin_token: str) -> dict:
    return {"Authorization": f"Bearer {admin_token}"}


# ============================================================================
# 시드 데이터 (딕셔너리 형태 — 계약/스텁 참조용)
# ============================================================================

@pytest.fixture
def test_layout() -> dict:
    """테스트용 오피스 레이아웃 (05-office-layout-schema.md)."""
    return {
        "version": "1.0",
        "floors": [
            {
                "level": 1,
                "name": "1F",
                "zones": [],
                "rooms": [],
                "seats": [
                    {"seat_id": "1F-A01", "x": 10.0, "y": 10.0, "type": "desk", "facing": 0}
                ],
                "collision_map": {},
            }
        ],
    }


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> dict:
    """로그인 계약 테스트용 시드 사용자 + 로컬 크리덴셜 (G001)."""
    from app.core.security import hash_password
    from app.models.tables import AuthCredential, ErpRole, ErpUser

    user = ErpUser(
        id=1,
        company_id=1,
        email="testuser@example.com",
        name="Test User",
        erp_team_id=1,
        role=ErpRole.EMPLOYEE,
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        AuthCredential(user_id=1, password_hash=hash_password("TestPass123!"))
    )
    await db_session.commit()
    return {
        "id": 1,
        "email": "testuser@example.com",
        "name": "Test User",
        "role": "employee",
    }


# ============================================================================
# pytest 훅
# ============================================================================

# contract/ 계약 스텁은 각 테스트의 @pytest.mark.skip로 개별 제어한다.
# 스토리 구현 완료 시 해당 테스트의 @pytest.mark.skip만 제거해 활성화한다.
