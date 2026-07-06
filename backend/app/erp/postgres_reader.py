"""
PostgresErpReader — 실 dailylog read-only 접근.

SQL은 라이브 스키마(2026-07-02 검증) 컬럼명 사용:
- attendances: attendance_date (updated_at 없음 → 날짜 범위 증분)
- users.role: employee|leader|admin|super_admin
전용 async 엔진(읽기 전용). 쓰기 금지(D18, ERP=원본).
접속정보(ERP_DATABASE_URL) 확보 시 팩토리가 자동 선택.

⚠️ asyncpg 미설치 환경: 엔진은 첫 연결 시점에만 생성(lazy).
   get_erp_reader() 호출 자체는 asyncpg 없이도 성공한다.
"""

from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.erp.dtos import (
    ErpAttendanceDTO,
    ErpLeaveDTO,
    OrgGroupDTO,
    ErpPositionDTO,
    ErpTeamDTO,
    ErpUserDTO,
)


class PostgresErpReader:
    """ErpReader 구현. dailylog Postgres에 read-only 쿼리.

    엔진은 최초 쿼리 시점에 생성(lazy) → asyncpg 없는 환경에서도
    인스턴스 생성은 성공한다. 실제 DB 연결은 ERP_DATABASE_URL 설정 후.
    """

    def __init__(self, database_url: str):
        self._database_url = database_url
        self._engine: AsyncEngine | None = None  # lazy

    def _get_engine(self) -> AsyncEngine:
        """첫 호출 시 엔진 생성(asyncpg import 지연)."""
        if self._engine is None:
            self._engine = create_async_engine(
                self._database_url, pool_pre_ping=True, echo=False
            )
        return self._engine

    async def fetch_users(self, company_id: int) -> list[ErpUserDTO]:
        sql = text(
            """
            SELECT id, company_id, email, name, team_id, role, position,
                   position_id, manager_id, default_work_type, default_work_hours,
                   is_active
            FROM users
            WHERE company_id = :cid
            ORDER BY id ASC
            """
        )
        async with self._get_engine().connect() as conn:
            rows = (await conn.execute(sql, {"cid": company_id})).mappings().all()
        return [
            ErpUserDTO(
                id=r["id"], company_id=r["company_id"], email=r["email"], name=r["name"],
                team_id=r["team_id"], role=r["role"], position=r["position"],
                position_id=r["position_id"], manager_id=r["manager_id"],
                default_work_type=r["default_work_type"],
                default_work_hours=r["default_work_hours"], is_active=r["is_active"],
            )
            for r in rows
        ]

    async def fetch_teams(self, company_id: int) -> list[ErpTeamDTO]:
        sql = text(
            """
            SELECT id, company_id, name, color, leader_name
            FROM teams WHERE company_id = :cid ORDER BY id ASC
            """
        )
        async with self._get_engine().connect() as conn:
            rows = (await conn.execute(sql, {"cid": company_id})).mappings().all()
        return [
            ErpTeamDTO(id=r["id"], company_id=r["company_id"], name=r["name"],
                       color=r["color"], leader_name=r["leader_name"])
            for r in rows
        ]

    async def fetch_positions(self, company_id: int) -> list[ErpPositionDTO]:
        sql = text(
            """
            SELECT id, company_id, name, level, is_active
            FROM job_positions WHERE company_id = :cid ORDER BY level DESC, id ASC
            """
        )
        async with self._get_engine().connect() as conn:
            rows = (await conn.execute(sql, {"cid": company_id})).mappings().all()
        return [
            ErpPositionDTO(id=r["id"], company_id=r["company_id"], name=r["name"],
                           level=r["level"], is_active=r["is_active"])
            for r in rows
        ]

    async def fetch_org_groups(self, company_id: int) -> list[OrgGroupDTO]:
        """ERP org_group 계층 조회.

        ERP 실 스키마에 조직 계층 테이블이 있으면 아래 SQL 조정.
        없으면 우리 플랫폼 org_group은 관리자 UI에서 수동 구성.
        현재: ERP DB 스키마 미확정 → 빈 리스트 반환(실 어댑터 자리).
        """
        # TODO(erp-integration): ERP가 departments/divisions 테이블을 노출할 때 구현.
        # 예시 쿼리:
        # SELECT id, company_id, name, type, parent_id FROM org_groups WHERE company_id = :cid
        return []

    async def fetch_attendances(self, company_id: int, start: date, end: date) -> list[ErpAttendanceDTO]:
        # ⚠️ attendance_date (date 아님), updated_at 없음 → 날짜 범위로만.
        sql = text(
            """
            SELECT user_id, attendance_date, check_in_at, check_out_at, work_type
            FROM attendances
            WHERE company_id = :cid
              AND attendance_date >= :start AND attendance_date <= :end
            ORDER BY attendance_date ASC, user_id ASC
            """
        )
        async with self._get_engine().connect() as conn:
            rows = (await conn.execute(sql, {"cid": company_id, "start": start, "end": end})).mappings().all()
        return [
            ErpAttendanceDTO(user_id=r["user_id"], attendance_date=r["attendance_date"],
                             check_in_at=r["check_in_at"], check_out_at=r["check_out_at"],
                             work_type=r["work_type"])
            for r in rows
        ]

    async def fetch_leaves(self, company_id: int, start: date, end: date) -> list[ErpLeaveDTO]:
        # 범위와 겹치는 휴가 (end_date >= start AND start_date <= end)
        sql = text(
            """
            SELECT id, user_id, type, half_day_time, start_date, end_date, status
            FROM leaves
            WHERE company_id = :cid
              AND end_date >= :start AND start_date <= :end
            ORDER BY start_date ASC, user_id ASC
            """
        )
        async with self._get_engine().connect() as conn:
            rows = (await conn.execute(sql, {"cid": company_id, "start": start, "end": end})).mappings().all()
        return [
            ErpLeaveDTO(id=r["id"], user_id=r["user_id"], type=r["type"],
                        half_day_time=r["half_day_time"], start_date=r["start_date"],
                        end_date=r["end_date"], status=r["status"])
            for r in rows
        ]

    async def aclose(self) -> None:
        if self._engine is not None:
            await self._engine.dispose()
