"""
MockErpReader — 목 기반 개발용 인메모리 ERP 데이터.

실 dailylog 스키마(2026-07-02 검증)를 반영한 소규모 조직 시드:
- 1개 회사(company_id=1), 2개 팀, 직급 3단계, 직원 5명(보고라인 포함).
- 조직 그룹 2개(본부 1 + 팀 1).
실 DB 전환 시 이 클래스는 교체되고 SyncService/조회 로직은 무변경.
"""

from datetime import date, datetime, timezone

from app.erp.dtos import (
    ErpAttendanceDTO,
    ErpLeaveDTO,
    OrgGroupDTO,
    ErpPositionDTO,
    ErpTeamDTO,
    ErpUserDTO,
)
from app.erp.reader import ErpReader

_COMPANY_ID = 1

_TEAMS = [
    ErpTeamDTO(id=1, company_id=1, name="개발팀", color="#2563eb", leader_name="김리더"),
    ErpTeamDTO(id=2, company_id=1, name="디자인팀", color="#db2777", leader_name="박리더"),
]

_POSITIONS = [
    ErpPositionDTO(id=1, company_id=1, name="사원", level=1, is_active=True),
    ErpPositionDTO(id=2, company_id=1, name="팀장", level=3, is_active=True),
    ErpPositionDTO(id=3, company_id=1, name="대표", level=9, is_active=True),
]

_USERS = [
    ErpUserDTO(id=1, company_id=1, email="ceo@example.com", name="대표이사",
               team_id=None, role="super_admin", position="대표", position_id=3,
               manager_id=None, default_work_type="office", default_work_hours=8, is_active=True),
    ErpUserDTO(id=2, company_id=1, email="dev.lead@example.com", name="김리더",
               team_id=1, role="leader", position="팀장", position_id=2,
               manager_id=1, default_work_type="office", default_work_hours=8, is_active=True),
    ErpUserDTO(id=3, company_id=1, email="dev1@example.com", name="이개발",
               team_id=1, role="employee", position="사원", position_id=1,
               manager_id=2, default_work_type="remote", default_work_hours=8, is_active=True),
    ErpUserDTO(id=4, company_id=1, email="design.lead@example.com", name="박리더",
               team_id=2, role="leader", position="팀장", position_id=2,
               manager_id=1, default_work_type="office", default_work_hours=8, is_active=True),
    ErpUserDTO(id=5, company_id=1, email="design1@example.com", name="최디자인",
               team_id=2, role="employee", position="사원", position_id=1,
               manager_id=4, default_work_type="office", default_work_hours=8, is_active=True),
]

_ORG_GROUPS = [
    OrgGroupDTO(id=1, company_id=1, name="기술본부", type="division", parent_id=None),
    OrgGroupDTO(id=2, company_id=1, name="제품팀", type="department", parent_id=1),
]


class MockErpReader(ErpReader):
    """ErpReader 구현 (in-memory). company_id 미스매치 시 빈 리스트.

    MockErpSource = MockErpReader (서비스 레이어에서 동일 명칭 사용 가능).
    """

    def __init__(self, users=None, teams=None, positions=None, org_groups=None):
        self._users = list(users) if users is not None else list(_USERS)
        self._teams = list(teams) if teams is not None else list(_TEAMS)
        self._positions = list(positions) if positions is not None else list(_POSITIONS)
        self._org_groups = list(org_groups) if org_groups is not None else list(_ORG_GROUPS)

    async def fetch_users(self, company_id: int) -> list[ErpUserDTO]:
        return [u for u in self._users if u.company_id == company_id]

    async def fetch_teams(self, company_id: int) -> list[ErpTeamDTO]:
        return [t for t in self._teams if t.company_id == company_id]

    async def fetch_positions(self, company_id: int) -> list[ErpPositionDTO]:
        return [p for p in self._positions if p.company_id == company_id]

    async def fetch_org_groups(self, company_id: int) -> list[OrgGroupDTO]:
        return [g for g in self._org_groups if g.company_id == company_id]

    async def fetch_attendances(self, company_id: int, start: date, end: date) -> list[ErpAttendanceDTO]:
        # 활성 사용자 각각 start일에 출근 1건 (범위 필터 데모)
        base = datetime(start.year, start.month, start.day, 9, 0, tzinfo=timezone.utc)
        out = datetime(start.year, start.month, start.day, 18, 0, tzinfo=timezone.utc)
        return [
            ErpAttendanceDTO(user_id=u.id, attendance_date=start,
                             check_in_at=base, check_out_at=out, work_type=u.default_work_type)
            for u in self._users
            if u.company_id == company_id and u.is_active and start <= end
        ]

    async def fetch_leaves(self, company_id: int, start: date, end: date) -> list[ErpLeaveDTO]:
        return [
            ErpLeaveDTO(id=1, user_id=3, type="vacation", half_day_time=None,
                        start_date=start, end_date=start, status="approved")
        ] if start <= end else []

    async def aclose(self) -> None:
        return None


# 공개 별칭 (services/erp_sync.py 문서와 일치)
MockErpSource = MockErpReader
