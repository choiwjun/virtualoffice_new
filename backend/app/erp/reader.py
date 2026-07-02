"""
ErpReader 인터페이스 + 팩토리.

경계: 동기화/조회 로직은 이 추상에만 의존.
- ERP_DATABASE_URL 비었으면 MockErpReader (목 기반 개발)
- 설정되면 PostgresErpReader (실 dailylog read-only)
전환 = .env 한 줄. 소비 코드(SyncService 등)는 무변경.
"""

from abc import ABC, abstractmethod
from datetime import date
from typing import Optional

from app.config import settings
from app.erp.dtos import (
    ErpAttendanceDTO,
    ErpLeaveDTO,
    ErpPositionDTO,
    ErpTeamDTO,
    ErpUserDTO,
)


class ErpReader(ABC):
    """ERP read-only 데이터 소스. company_id 스코프 필수."""

    @abstractmethod
    async def fetch_users(self, company_id: int) -> list[ErpUserDTO]: ...

    @abstractmethod
    async def fetch_teams(self, company_id: int) -> list[ErpTeamDTO]: ...

    @abstractmethod
    async def fetch_positions(self, company_id: int) -> list[ErpPositionDTO]: ...

    @abstractmethod
    async def fetch_attendances(
        self, company_id: int, start: date, end: date
    ) -> list[ErpAttendanceDTO]: ...

    @abstractmethod
    async def fetch_leaves(
        self, company_id: int, start: date, end: date
    ) -> list[ErpLeaveDTO]: ...

    async def aclose(self) -> None:
        """리소스 정리 (Postgres 엔진 등). 기본 no-op."""


def get_erp_reader(database_url: Optional[str] = None) -> ErpReader:
    """설정 기반 리더 선택. url 명시 시 우선(테스트용)."""
    url = database_url if database_url is not None else settings.erp_database_url
    if url:
        from app.erp.postgres_reader import PostgresErpReader

        return PostgresErpReader(url)

    from app.erp.mock_reader import MockErpReader

    return MockErpReader()
