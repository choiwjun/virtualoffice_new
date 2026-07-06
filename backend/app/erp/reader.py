"""
ErpReader 인터페이스 + 팩토리.

경계: 동기화/조회 로직은 이 추상에만 의존.
- ERP_DATABASE_URL 비었으면 MockErpReader (목 기반 개발)
- 설정되면 PostgresErpReader (실 dailylog read-only)
전환 = .env 한 줄. 소비 코드(SyncService 등)는 무변경.

# ErpSource = ErpReader (공개 별칭, services/erp_sync.py에서 재노출)
"""

from abc import ABC, abstractmethod
from datetime import date
from typing import Optional

from app.config import settings
from app.erp.dtos import (
    ErpAttendanceDTO,
    ErpLeaveDTO,
    OrgGroupDTO,
    ErpPositionDTO,
    ErpTeamDTO,
    ErpUserDTO,
)


class ErpReader(ABC):
    """ERP read-only 데이터 소스. company_id 스코프 필수.

    모든 메서드는 company_id 스코프를 필수로 받아 멀티테넌트 격리를 보장한다.
    GPS/민감 컬럼은 읽지 않는다(D20-c/f).
    """

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

    async def fetch_org_groups(self, company_id: int) -> list[OrgGroupDTO]:
        """ERP 측 조직 계층(부서/본부). 구현체 선택: 기본 빈 리스트.

        ERP 실 스키마에 org_group 테이블이 있으면 PostgresErpReader에서 오버라이드.
        없으면 관리자 UI에서 수동 구성 (우리 플랫폼 org_group 테이블에 직접 입력).
        """
        return []

    async def aclose(self) -> None:
        """리소스 정리 (Postgres 엔진 등). 기본 no-op."""


# 공개 별칭: services/erp_sync.py가 이 이름으로 재노출
ErpSource = ErpReader


def get_erp_reader(database_url: Optional[str] = None) -> ErpReader:
    """설정 기반 리더 선택. url 명시 시 우선(테스트용)."""
    url = database_url if database_url is not None else settings.erp_database_url
    if url:
        from app.erp.postgres_reader import PostgresErpReader

        return PostgresErpReader(url)

    from app.erp.mock_reader import MockErpReader

    return MockErpReader()
