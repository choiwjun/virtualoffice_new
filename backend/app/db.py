"""
데이터베이스 세션 관리 (SQLAlchemy async).

헌법(dependencies): DB 세션은 의존성(get_db)으로만 주입.
정본: 11-tech-stack.md (SQLAlchemy async + asyncpg), D3(단일 FastAPI 경유).
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.models.tables import Base  # noqa: F401  (재노출 — Alembic/테스트에서 사용)

# 우리 DB 엔진 (읽기/쓰기)
engine = create_async_engine(
    settings.database_url,
    echo=settings.db_echo,
    future=True,
    pool_pre_ping=True,
)

SessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI 의존성: 요청 스코프 DB 세션. 예외 시 롤백."""
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
