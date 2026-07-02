"""
ERP read-only DTO — 라이브 dailylog 스키마 기준 (2026-07-02 검증).

출처: space-daily/backend/app/models/tables.py
- 우리 도메인 모델(ErpUser 등)과 분리된 순수 전송 객체.
- Reader 구현(Mock/Postgres)이 이 DTO를 반환 → SyncService가 소비.
"""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional


@dataclass(frozen=True)
class ErpUserDTO:
    """ERP users 행. 조인 키 = id."""

    id: int
    company_id: int
    email: str
    name: str
    team_id: Optional[int]
    role: str  # employee | leader | admin | super_admin
    position: Optional[str]  # 자유텍스트
    position_id: Optional[int]
    manager_id: Optional[int]  # 보고라인 self-FK
    default_work_type: str  # office | remote
    default_work_hours: int  # 시간 단위(ERP), 우리 저장 시 분으로 환산
    is_active: bool


@dataclass(frozen=True)
class ErpTeamDTO:
    """ERP teams 행 (리프 조직). 색/리더명 포함."""

    id: int
    company_id: int
    name: str
    color: str
    leader_name: Optional[str]


@dataclass(frozen=True)
class ErpPositionDTO:
    """ERP job_positions 행. level = 서열."""

    id: int
    company_id: int
    name: str
    level: int
    is_active: bool


@dataclass(frozen=True)
class ErpAttendanceDTO:
    """ERP attendances 행 (read-through, 미저장).

    ⚠️ 날짜 컬럼 = attendance_date, updated_at 없음(증분 불가 → 날짜 범위).
    """

    user_id: int
    attendance_date: date
    check_in_at: Optional[datetime]
    check_out_at: Optional[datetime]
    work_type: str  # office | remote


@dataclass(frozen=True)
class ErpLeaveDTO:
    """ERP leaves 행 (read-through, 미저장)."""

    id: int
    user_id: int
    type: str  # vacation | sick | half_day | other
    half_day_time: Optional[str]  # AM | PM
    start_date: date
    end_date: date
    status: str  # pending | approved | rejected | on_hold
