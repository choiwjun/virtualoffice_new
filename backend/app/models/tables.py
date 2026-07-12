# @TASK P0-T0.3 - 데이터 모델 및 ERD 정의
# @SPEC docs/planning/04-data-model.md
# @SPEC docs/data-model/erd.md

"""
SQLAlchemy 2.x 모델 정의 (async ORM)

**정본**: 04-data-model.md
**타임존**: UTC 저장, 표시 시 KST 변환(D19)
**soft-delete**: is_active 플래그(D18)
**FK 제약**: ON DELETE RESTRICT(평가 기록 영구성)
"""

from datetime import datetime, timezone, date
from decimal import Decimal
from typing import Optional, List
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime, Date, JSON, Text,
    ForeignKey, Index, UniqueConstraint, CheckConstraint, Enum as SQLEnum,
    BigInteger, Numeric, text
)
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.ext.declarative import declared_attr

# Portable JSON 타입: 운영(PostgreSQL)에서는 JSONB, 테스트(SQLite)에서는 JSON으로 폴백.
# 04-data-model.md는 JSONB가 정본이나, 테스트 in-memory SQLite 호환을 위해 variant 사용.
JSONB = JSON().with_variant(PG_JSONB, "postgresql")

# ============================================================================
# Base 클래스 & 공통 Mixin
# ============================================================================

class Base(DeclarativeBase):
    """SQLAlchemy ORM Base"""
    pass


class TimestampMixin:
    """생성·수정 타임스탬프 자동 관리 (UTC)"""

    @declared_attr
    def created_at(cls) -> Mapped[datetime]:
        """생성 시각 (UTC)"""
        return mapped_column(
            DateTime(timezone=True),
            nullable=False,
            default=lambda: datetime.now(timezone.utc)
        )

    @declared_attr
    def updated_at(cls) -> Mapped[datetime]:
        """수정 시각 (UTC)"""
        return mapped_column(
            DateTime(timezone=True),
            nullable=False,
            default=lambda: datetime.now(timezone.utc),
            onupdate=lambda: datetime.now(timezone.utc)
        )


class SoftDeleteMixin:
    """Soft-delete 지원 (is_active 플래그, D18)"""

    @declared_attr
    def is_active(cls) -> Mapped[bool]:
        """활성 여부 (soft-delete, ERP 하드 삭제 감지 시 FALSE)"""
        return mapped_column(Boolean, nullable=False, default=True, index=True)


# ============================================================================
# Enum 타입 정의 (D13, D16 확정)
# ============================================================================

class PresenceStatus(str, Enum):
    """직원 상태 (7종 확정, D13)"""
    OFFLINE = "offline"         # 로그아웃
    ONLINE = "online"           # 앱 실행, 오피스 로그인
    WORKING = "working"         # 좌석에서 업무
    MEETING = "meeting"         # 회의실 입장
    FOCUS = "focus"             # 집중실
    AWAY = "away"               # 일시 자리 비움(자동 전이 5분)
    EXTERNAL = "external"       # 외근/출장/재택(수동 전환)


class SeatType(str, Enum):
    """좌석 타입"""
    FIXED = "fixed"             # 고정 배치(팀 소속)
    FREE = "free"               # 자율석(누구나)
    TEMP = "temp"               # 임시석(게스트)
    PARTNER = "partner"         # 협력사/외부 전담


class SeatStatus(str, Enum):
    """좌석 상태"""
    AVAILABLE = "available"     # 비어있음
    OCCUPIED = "occupied"       # 배정됨
    DISABLED = "disabled"       # 사용 불가
    RESERVED = "reserved"       # 임시 예약


class MeetingStatus(str, Enum):
    """회의 상태"""
    SCHEDULED = "scheduled"     # 예정(미시작)
    IN_PROGRESS = "in_progress" # 진행 중
    COMPLETED = "completed"     # 완료
    CANCELLED = "cancelled"     # 취소


class OfficeLayoutStatus(str, Enum):
    """레이아웃 버전 상태"""
    DRAFT = "draft"             # 편집 중
    VALIDATED = "validated"     # 검증 완료
    DEPLOYED = "deployed"       # 라이브
    ARCHIVED = "archived"       # 이전 버전


class KpiPeriodType(str, Enum):
    """KPI 평가 기간 타입 (D16)"""
    DAILY = "daily"             # period_key = 'YYYY-MM-DD'
    QUARTERLY = "quarterly"     # period_key = 'YYYY-Q#'


class KpiObjectionStatus(str, Enum):
    """KPI 이의신청 상태머신 (D15)"""
    NONE = "none"               # 이의신청 없음(기본)
    SUBMITTED = "submitted"     # 접수됨(공개 후 7일 이내)
    REVIEWING = "reviewing"     # 재검토 중
    RESOLVED = "resolved"       # 처리 완료(확정)


class KpiSource(str, Enum):
    """KPI 출처"""
    VIRTUAL_OFFICE = "virtual_office"


class ErpRole(str, Enum):
    """ERP 권한"""
    EMPLOYEE = "employee"       # 일반 직원
    LEADER = "leader"           # 팀장
    ADMIN = "admin"             # 관리자
    SUPER_ADMIN = "super_admin" # 슈퍼 관리자


class OrgGroupType(str, Enum):
    """조직 타입"""
    DIVISION = "division"       # 본부
    DEPARTMENT = "department"   # 부서
    PART = "part"               # 파트


class RoomType(str, Enum):
    """방 타입"""
    LOBBY = "lobby"             # 로비
    MEETING = "meeting"         # 회의실
    LOUNGE = "lounge"           # 라운지
    FOCUS = "focus"             # 집중실
    PHONEBOOTH = "phonebooth"   # 폰부스


class DailyStatusPushTarget(str, Enum):
    """일일 푸시 대상"""
    ERP_DAILY_REPORTS = "erp_daily_reports"
    ERP_KPI_RESULTS = "erp_kpi_results"


class DailyStatusPushStatus(str, Enum):
    """일일 푸시 상태"""
    PENDING = "pending"         # 대기 중
    SENT = "sent"               # 전송 완료
    FAILED = "failed"           # 전송 실패


class ActionItemStatus(str, Enum):
    """액션아이템 상태"""
    OPEN = "open"               # 열림
    IN_PROGRESS = "in_progress" # 진행 중
    COMPLETED = "completed"     # 완료
    CANCELLED = "cancelled"     # 취소


class WorkLogStatus(str, Enum):
    """업무 로그 상태"""
    STARTED = "started"         # 시작
    COMPLETED = "completed"     # 완료


class MeetingMinuteStatus(str, Enum):
    """회의록 상태"""
    DRAFT = "draft"             # 초안
    FINALIZED = "finalized"     # 확정


class MeetingParticipantRole(str, Enum):
    """회의 참석자 역할"""
    ORGANIZER = "organizer"     # 주최자
    PRESENTER = "presenter"     # 발표자
    PARTICIPANT = "participant" # 참석자


class RecordingConsentType(str, Enum):
    RECORDING = "recording"
    STT = "stt"


class ActionItemPriority(str, Enum):
    """액션아이템 우선순위"""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class RoomStatus(str, Enum):
    """방 상태"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    MAINTENANCE = "maintenance"


class AssetType(str, Enum):
    """에셋 타입 (07-3d §5.3 v1.1 정본)"""
    FURNITURE = "furniture"     # 가구
    STRUCTURE = "structure"     # 구조물 (벽, 바닥 등)
    MATERIAL = "material"       # 머티리얼
    UI3D = "ui3d"               # 3D UI 요소
    CHARACTER = "character"     # 캐릭터
    ENVIRONMENT = "environment" # 환경 요소


# ============================================================================
# A. ERP 미러 계층 (1개)
# ============================================================================

class ErpUser(Base, TimestampMixin, SoftDeleteMixin):
    # @TASK T1.0 - ERP 사용자 동기화
    # @SPEC 04-data-model.md §2.1
    """
    ERP 직원 정보 (읽기 전용 동기화, D18)

    **동기화**: 매시간 증분 + 매일 00:00 KST 전체 대사
    **soft-delete**: is_active=false (물리 삭제 금지, 평가 기록 영구성)
    **타임존**: UTC 저장, 표시 시 KST 변환(D19)
    """
    __tablename__ = "erp_user"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    """ERP users.id (조인 키)"""

    company_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    """사내 회사 ID (멀티테넌트 스코프)"""

    email: Mapped[str] = mapped_column(String(255), nullable=False)
    """이메일 (ERP와 동일)"""

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    """직원명"""

    erp_team_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    """ERP teams.id (FK to ERP, read-only)"""

    role: Mapped[ErpRole] = mapped_column(
        SQLEnum(ErpRole),
        nullable=False,
        default=ErpRole.EMPLOYEE,
        index=True
    )
    """권한"""

    position: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """직책 (자유텍스트)"""

    position_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    """ERP job_positions.id"""

    manager_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="SET NULL"),
        nullable=True
    )
    """보고 라인 (self FK)"""

    work_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    """근무 형태 (office/remote 등)"""

    work_hours: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    """일일 근무시간 (분 단위)"""

    last_synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """마지막 ERP 동기화 시각 (UTC)"""
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """로컬 개발 OIDC 인증용 bcrypt 해시 (ERP 동기화 무관 — dev/도그푸딩 전용)."""

    # 관계 (self-FK 표준: many-to-one 스칼라 쪽에 remote_side=[id], 컬렉션 쪽은 없음)
    managed_users: Mapped[List["ErpUser"]] = relationship(
        "ErpUser",
        back_populates="manager"
    )
    manager: Mapped[Optional["ErpUser"]] = relationship(
        "ErpUser",
        remote_side=[id],
        back_populates="managed_users"
    )

    __table_args__ = (
        UniqueConstraint("company_id", "email", name="uq_erp_user_company_email"),
        Index("idx_erp_user_company_email", "company_id", "email"),
        Index("idx_erp_user_team", "erp_team_id"),
        Index("idx_erp_user_role", "role"),
        # is_active 인덱스는 SoftDeleteMixin(index=True)이 생성 — 중복 명시 Index 제거(A3-20)
    )


# ============================================================================
# B. 조직·구역·공간 계층 (6개)
# ============================================================================

class OrgGroup(Base, TimestampMixin):
    # @TASK T2.0 - 조직 그룹 정의
    # @SPEC 04-data-model.md §2.2
    """
    사내 조직 계층 (본부/부서/파트)

    ERP teams(리프)를 묶어서 상위 계층 구성
    """
    __tablename__ = "org_group"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    company_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[OrgGroupType] = mapped_column(SQLEnum(OrgGroupType), nullable=False, index=True)
    parent_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("org_group.id", ondelete="SET NULL"),
        nullable=True
    )
    color: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)
    """HEX 컬러 (3D 구역 시각화)"""
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # 관계 (self-FK 표준: many-to-one 스칼라 쪽에 remote_side=[id], 컬렉션 쪽은 없음)
    children: Mapped[List["OrgGroup"]] = relationship(
        "OrgGroup",
        back_populates="parent"
    )
    parent: Mapped[Optional["OrgGroup"]] = relationship(
        "OrgGroup",
        remote_side=[id],
        back_populates="children"
    )

    __table_args__ = (
        Index("idx_org_group_company_parent", "company_id", "parent_id"),
    )


class TeamZone(Base, TimestampMixin):
    # @TASK T3.0 - 팀↔구역 매핑
    # @SPEC 04-data-model.md §2.2
    """
    ERP 팀 ↔ 3D 오피스 구역 매핑 (D10)

    팀을 물리적 공간으로 배치
    """
    __tablename__ = "team_zone"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    erp_team_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    """ERP teams.id (FK to ERP)"""
    org_group_id: Mapped[UUID] = mapped_column(
        ForeignKey("org_group.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    office_id: Mapped[UUID] = mapped_column(
        ForeignKey("office.id", ondelete="RESTRICT"),
        nullable=False
    )
    floor_id: Mapped[UUID] = mapped_column(
        ForeignKey("floor.id", ondelete="RESTRICT"),
        nullable=False
    )
    zone_label: Mapped[str] = mapped_column(String(255), nullable=False)
    color: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)
    polygon: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    """2D 좌표 배열 (Konva 좌석편집기용)"""

    # 관계
    org_group: Mapped["OrgGroup"] = relationship("OrgGroup")
    office: Mapped["Office"] = relationship("Office")
    floor: Mapped["Floor"] = relationship("Floor")

    __table_args__ = (
        UniqueConstraint("erp_team_id", "office_id", "floor_id", name="uq_team_zone_unique"),
        Index("idx_team_zone_erp_team", "erp_team_id"),
        Index("idx_team_zone_org_group", "org_group_id"),
    )


class Office(Base, TimestampMixin):
    # @TASK T4.0 - 사무실 정의
    # @SPEC 04-data-model.md §2.2
    """물리 사무실 단위"""
    __tablename__ = "office"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    company_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    """멀티테넌트 스코프"""
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    """사무실명 (예: "본사", "판교")"""
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)


class Floor(Base, TimestampMixin):
    # @TASK T5.0 - 층 정의
    # @SPEC 04-data-model.md §2.2
    """office 내 층"""
    __tablename__ = "floor"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    office_id: Mapped[UUID] = mapped_column(
        ForeignKey("office.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    """1, 2, 3... (B1 = -1)"""
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    minimap_config: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    """미니맵 2D 레이아웃 (캐시용)"""

    # 관계
    office: Mapped["Office"] = relationship("Office")

    __table_args__ = (
        UniqueConstraint("office_id", "level", name="uq_floor_unique"),
        Index("idx_floor_office", "office_id"),
    )


class OfficeLayout(Base, TimestampMixin):
    # @TASK T6.0 - 레이아웃 버전 관리
    # @SPEC 04-data-model.md §2.3
    """
    좌석·회의실·구역 정보 JSON + 버전 관리

    draft → validated → deployed / ← archived (롤백)
    """
    __tablename__ = "office_layout"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    office_id: Mapped[UUID] = mapped_column(
        ForeignKey("office.id", ondelete="RESTRICT"),
        nullable=False
    )
    floor_id: Mapped[UUID] = mapped_column(
        ForeignKey("floor.id", ondelete="RESTRICT"),
        nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    """증분 버전 (1, 2, 3...)"""
    status: Mapped[OfficeLayoutStatus] = mapped_column(
        SQLEnum(OfficeLayoutStatus),
        nullable=False,
        default=OfficeLayoutStatus.DRAFT,
        index=True
    )
    json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    """구조 정의 (05-office-layout-schema.md 참조)"""
    created_by: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="SET NULL"),
        nullable=True
    )
    validated_by: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="SET NULL"),
        nullable=True
    )
    deployed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """배포 시각 (UTC 저장, 표시 시 KST 변환)"""
    deployment_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 관계
    office: Mapped["Office"] = relationship("Office")
    floor: Mapped["Floor"] = relationship("Floor")
    created_by_user: Mapped[Optional["ErpUser"]] = relationship(
        "ErpUser",
        foreign_keys=[created_by]
    )
    validated_by_user: Mapped[Optional["ErpUser"]] = relationship(
        "ErpUser",
        foreign_keys=[validated_by]
    )

    __table_args__ = (
        UniqueConstraint("office_id", "floor_id", "version", name="uq_office_layout_version"),
        Index("idx_office_layout_status", "status", "deployed_at"),
    )


class Room(Base, TimestampMixin):
    # @TASK T7.0 - 방(회의실 등) 정의
    # @SPEC 04-data-model.md §2.3
    """
    회의실·라운지·집중실·폰부스 메타데이터

    office_layout JSON과는 별개로 메타 관리
    """
    __tablename__ = "room"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    floor_id: Mapped[UUID] = mapped_column(
        ForeignKey("floor.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    type: Mapped[RoomType] = mapped_column(
        SQLEnum(RoomType),
        nullable=False,
        index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    """수용인원"""
    coords: Mapped[dict] = mapped_column(JSONB, nullable=False)
    """{x, y, width, height} 2D top_left 기준 미터 좌표 (D25). 3D 변환은 Godot 임포트 시 수행."""
    enter_trigger: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    """{x, y, width, height} 진입 감지 영역 (2D top_left 미터, D25)"""
    livekit_room: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """LiveKit room ID (회의 이용 시)"""
    status: Mapped[RoomStatus] = mapped_column(
        SQLEnum(RoomStatus),
        nullable=False,
        default=RoomStatus.ACTIVE
    )

    # 관계
    floor: Mapped["Floor"] = relationship("Floor")

    __table_args__ = (
        Index("idx_room_floor_type", "floor_id", "type"),
        Index("idx_room_livekit", "livekit_room"),
    )


# ============================================================================
# C. 좌석·현위치 계층 (4개 + 1개 히스토리)
# ============================================================================

class Seat(Base, TimestampMixin):
    # @TASK T8.0 - 좌석 정의
    # @SPEC 04-data-model.md §2.3, D10 (좌석 배정 분리)
    """
    개별 좌석 (배정 정보는 DB 소유, layout JSON과 분리 — D10)

    **배정 분리 원칙**:
    - layout JSON: 공간 구조만(좌석 위치·타입·방향·furniture)
    - DB(seat): 배정 정보(assigned_user_id) 소유
    - 배정 변경 시 레이아웃 재배포 불필요
    """
    __tablename__ = "seat"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    floor_id: Mapped[UUID] = mapped_column(
        ForeignKey("floor.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    team_zone_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("team_zone.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    """소속 구역 (null = 공용)"""
    type: Mapped[SeatType] = mapped_column(
        SQLEnum(SeatType),
        nullable=False,
        index=True
    )
    assigned_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    """현재 배정 사원"""
    coords: Mapped[dict] = mapped_column(JSONB, nullable=False)
    """{x, y} + facing — 2D top_left 기준 미터 좌표 (D25)"""
    status: Mapped[SeatStatus] = mapped_column(
        SQLEnum(SeatStatus),
        nullable=False,
        default=SeatStatus.AVAILABLE
    )
    seat_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    """선택 좌석 번호 (예: "1-A-01")"""

    # 관계
    floor: Mapped["Floor"] = relationship("Floor")
    team_zone: Mapped[Optional["TeamZone"]] = relationship("TeamZone")
    assigned_user: Mapped[Optional["ErpUser"]] = relationship("ErpUser")

    __table_args__ = (
        Index("idx_seat_floor_type", "floor_id", "type"),
        Index("idx_seat_assigned_user", "assigned_user_id"),
        # 부분 유니크: seat_number가 NULL이 아닐 때만 (floor_id, seat_number) 유일.
        # UniqueConstraint는 부분(where) 미지원 → unique Index로 구현 (dialect별 where).
        Index(
            "uq_seat_number", "floor_id", "seat_number", unique=True,
            sqlite_where=text("seat_number IS NOT NULL"),
            postgresql_where=text("seat_number IS NOT NULL"),
        ),
    )


class SeatAssignmentHistory(Base):
    # @TASK T9.0 - 좌석 배정 이력
    # @SPEC 04-data-model.md §2.3
    """좌석 배정 생애주기 추적 (감사, UI 타임라인)"""
    __tablename__ = "seat_assignment_history"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    seat_id: Mapped[UUID] = mapped_column(
        ForeignKey("seat.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    """배정된 사원 (RESTRICT: 배정 이력 보존)"""
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )
    """배정 시각 (UTC)"""
    unassigned_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """해제 시각"""
    assigned_by: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="SET NULL"),
        nullable=True
    )
    """배정 담당자"""
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """배정 사유 (예: "팀 재구성", "퇴사")"""
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )

    # 관계
    seat: Mapped["Seat"] = relationship("Seat")
    user: Mapped["ErpUser"] = relationship("ErpUser", foreign_keys=[user_id])
    assigned_by_user: Mapped[Optional["ErpUser"]] = relationship("ErpUser", foreign_keys=[assigned_by])

    __table_args__ = (
        Index("idx_seat_assignment_history_seat", "seat_id", "assigned_at"),
        Index("idx_seat_assignment_history_user", "user_id", "assigned_at"),
        CheckConstraint(
            "unassigned_at IS NULL OR unassigned_at >= assigned_at",
            name="ck_assignment_dates",
        ),
        # 좌석 배타성: 현재 배정(unassigned_at IS NULL)은 좌석당 1건만 (부분 unique)
        Index(
            "uk_current_seat", "seat_id", unique=True,
            sqlite_where=text("unassigned_at IS NULL"),
            postgresql_where=text("unassigned_at IS NULL"),
        ),
    )


class UserTeamHistory(Base):
    # @TASK T10.0 - 팀 이동 이력 (신설, D18)
    # @SPEC 04-data-model.md §2.3
    """
    직원의 팀 소속 변경 이력 (D18)

    분기 중 팀 이동자의 KPI 벤치마크 왜곡 방지.
    평가 기간에 실제 소속했던 팀 기준으로 벤치마크 계산.
    """
    __tablename__ = "user_team_history"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    """RESTRICT: 팀 이동 이력 보존"""
    erp_team_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    """당시 소속 팀 (ERP teams.id)"""
    valid_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )
    """소속 시작 (UTC)"""
    valid_to: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """소속 종료 (UTC, NULL = 현재 소속)"""
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )

    # 관계
    user: Mapped["ErpUser"] = relationship("ErpUser")

    __table_args__ = (
        Index("idx_user_team_history_user", "user_id", "valid_from"),
        Index("idx_user_team_history_team", "erp_team_id", "valid_from"),
        CheckConstraint(
            "valid_to IS NULL OR valid_to >= valid_from",
            name="ck_uth_dates",
        ),
    )


class Presence(Base):
    # @TASK T11.0 - 실시간 상태·위치
    # @SPEC 04-data-model.md §2.4
    """
    직원 실시간 상태·위치 (7종 상태, D13)

    Godot 서버 → FastAPI → DB 업데이트. 실시간 동기화.
    """
    __tablename__ = "presence"

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="CASCADE"),
        primary_key=True
    )
    """ERP user.id (PK)"""
    office_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("office.id", ondelete="RESTRICT"),
        nullable=True,
        index=True
    )
    """현재 오피스"""
    floor_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("floor.id", ondelete="RESTRICT"),
        nullable=True,
        index=True
    )
    """현재 층"""
    x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    z: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    """3D 위치 (월드좌표)"""
    status: Mapped[PresenceStatus] = mapped_column(
        SQLEnum(PresenceStatus),
        nullable=False,
        index=True
    )
    """상태 (7종: offline/online/working/meeting/focus/away/external, D13)"""
    last_activity_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """마지막 활동 시각 (UTC)"""
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        index=True
    )
    """상태 업데이트 시각 (UTC)"""

    # 관계
    user: Mapped["ErpUser"] = relationship("ErpUser")
    office: Mapped[Optional["Office"]] = relationship("Office")
    floor: Mapped[Optional["Floor"]] = relationship("Floor")

    __table_args__ = (
        Index("idx_presence_office_floor", "office_id", "floor_id"),
        Index("idx_presence_status", "status"),
        Index("idx_presence_updated_at", "updated_at"),
    )


# ============================================================================
# D. 협업·회의 계층 (3개 + 2개 보조)
# ============================================================================

class Meeting(Base, TimestampMixin):
    # @TASK T12.0 - 회의
    # @SPEC 04-data-model.md §2.4
    """
    회의 메타데이터 (화상, 회의록, 결정사항, 액션아이템 추적)

    **단방향 FK**: meeting ↔ meeting_minute는 단방향만
    (meeting_minute.meeting_id → meeting.id, 역방향 FK 폐기 — 순환 참조 방지)
    """
    __tablename__ = "meeting"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    room_id: Mapped[UUID] = mapped_column(
        ForeignKey("room.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    host_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    """주최자"""
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    scheduled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )
    """예정 시각 (UTC)"""
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """실제 시작 시각 (UTC)"""
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """실제 종료 시각 (UTC)"""
    status: Mapped[MeetingStatus] = mapped_column(
        SQLEnum(MeetingStatus),
        nullable=False,
        default=MeetingStatus.SCHEDULED,
        index=True
    )
    livekit_room: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """LiveKit room ID"""
    recording_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    """화상 녹화 URL (선택, 녹음 동의 시에만, 보존 90일 후 파기 — D20-b)"""

    # 관계
    room: Mapped["Room"] = relationship("Room")
    host: Mapped["ErpUser"] = relationship("ErpUser")
    participants: Mapped[List["MeetingParticipant"]] = relationship(
        "MeetingParticipant",
        back_populates="meeting",
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_meeting_room_scheduled", "room_id", "scheduled_at"),
        Index("idx_meeting_host", "host_user_id"),
        Index("idx_meeting_status", "status", "started_at"),
        # 실제 컬럼은 scheduled_at/started_at/ended_at (scheduled_start/end 없음)
        CheckConstraint(
            "ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at",
            name="ck_meeting_times",
        ),
    )


class MeetingParticipant(Base):
    # @TASK T12a.0 - 회의 참석자
    # @SPEC 04-data-model.md §2.4
    """회의 참석자 관리 (joined_at/left_at로 실제 참석 추적)"""
    __tablename__ = "meeting_participant"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meeting.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    invited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )
    """초대 시각 (UTC)"""
    joined_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """실제 입장 시각"""
    left_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """퇴장 시각"""
    role: Mapped[MeetingParticipantRole] = mapped_column(
        SQLEnum(MeetingParticipantRole),
        nullable=False,
        default=MeetingParticipantRole.PARTICIPANT
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )

    # 관계
    meeting: Mapped["Meeting"] = relationship("Meeting", back_populates="participants")
    user: Mapped["ErpUser"] = relationship("ErpUser")

    __table_args__ = (
        UniqueConstraint("meeting_id", "user_id", name="uq_meeting_participant"),
        Index("idx_meeting_participant_user", "user_id", "invited_at"),
    )


class RecordingConsent(Base):
    """회의별 참석자 녹음/STT 동의 기록."""
    __tablename__ = "recording_consent"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meeting.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    consent_type: Mapped[RecordingConsentType] = mapped_column(
        SQLEnum(RecordingConsentType),
        nullable=False,
    )
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    meeting: Mapped["Meeting"] = relationship("Meeting")
    user: Mapped["ErpUser"] = relationship("ErpUser")

    __table_args__ = (
        UniqueConstraint(
            "meeting_id",
            "user_id",
            "consent_type",
            name="uq_recording_consent_meeting_user_type",
        ),
        Index("idx_recording_consent_meeting_type", "meeting_id", "consent_type"),
    )


class MeetingMinute(Base, TimestampMixin):
    # @TASK T12b.0 - 회의록
    # @SPEC 04-data-model.md §2.4
    """
    회의 결과 기록 (논의, 결정사항, 액션아이템)

    **단방향 FK**: meeting_minute.meeting_id → meeting.id만
    (meeting.meeting_minute_id 역방향 FK 폐기)
    """
    __tablename__ = "meeting_minute"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meeting.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    """단방향 FK (meeting.meeting_minute_id 역방향 폐기)"""
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """논의 요약"""
    decisions: Mapped[str] = mapped_column(Text, nullable=False)
    """결정사항 (마크다운)"""
    action_items_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """액션아이템 요약"""
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    attachments: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    """{filename, url, mime_type}"""
    stt_draft: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """STT 원본 초안 (D5 — 회의 음성 전사 결과, 수정 전 원본 보존)"""
    ai_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """AI 요약 (Phase 7 — stt_draft 기반 자동 요약)"""
    created_by: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="RESTRICT"),
        nullable=False
    )
    """기록자"""
    reviewed_by: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="SET NULL"),
        nullable=True
    )
    """검토자"""
    status: Mapped[MeetingMinuteStatus] = mapped_column(
        SQLEnum(MeetingMinuteStatus),
        nullable=False,
        default=MeetingMinuteStatus.DRAFT,
        index=True
    )

    # 관계
    meeting: Mapped["Meeting"] = relationship("Meeting")
    creator: Mapped["ErpUser"] = relationship("ErpUser", foreign_keys=[created_by])
    reviewer: Mapped[Optional["ErpUser"]] = relationship("ErpUser", foreign_keys=[reviewed_by])

    __table_args__ = (
        UniqueConstraint("meeting_id", name="uq_meeting_minute_meeting"),
    )


class ActionItem(Base, TimestampMixin):
    # @TASK T12c.0 - 액션아이템
    # @SPEC 04-data-model.md §2.4
    """
    회의에서 나온 할일 (담당자, 기한, 진행상태 추적)

    ERP의 task/issue와는 독립적
    """
    __tablename__ = "action_item"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meeting.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    assignee_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    """담당자"""
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    """기한 (KST 날짜)"""
    priority: Mapped[ActionItemPriority] = mapped_column(
        SQLEnum(ActionItemPriority),
        nullable=False,
        default=ActionItemPriority.MEDIUM
    )
    status: Mapped[ActionItemStatus] = mapped_column(
        SQLEnum(ActionItemStatus),
        nullable=False,
        default=ActionItemStatus.OPEN,
        index=True
    )
    related_ref: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    """외부 참조 (Jira issue URL, GitHub PR 등)"""
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    completed_evidence_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    """완료 증거 (결과물 링크)"""

    # 관계
    meeting: Mapped["Meeting"] = relationship("Meeting")
    assignee: Mapped["ErpUser"] = relationship("ErpUser")

    __table_args__ = (
        Index("idx_action_item_assignee_status", "assignee_user_id", "status"),
        Index("idx_action_item_due_date_status", "due_date", "status"),
    )


# ============================================================================
# E. 업무·KPI·연동 계층 (3개)
# ============================================================================

class WorkLog(Base, TimestampMixin):
    # @TASK T13.0 - 업무 기록
    # @SPEC 04-data-model.md §2.5
    """
    직원이 수행한 업무 단위 기록 (목표, 소요시간, 결과물)

    업무결과 집계 → KPI 산출 기초
    """
    __tablename__ = "work_log"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    """RESTRICT: D18 평가 근거 영구 보존"""
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    """업무 날짜 (KST)"""
    category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    """업무 분류 (개발, 리뷰, 회의, 설계 등)"""
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    goal: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """이번 업무의 목표"""
    related_project: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    """프로젝트명 (Jira Project key 등)"""
    url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    """관련 URL (PR, Issue, Confluence)"""
    est_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    """예상 소요시간 (분)"""
    actual_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    """실제 소요시간 (분)"""
    status: Mapped[WorkLogStatus] = mapped_column(
        SQLEnum(WorkLogStatus),
        nullable=False,
        index=True
    )
    result_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    """결과물 URL (코드, 문서)"""
    result_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """결과 설명"""
    attachments: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    issues: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    """발생한 이슈 (자유텍스트 배열)"""
    next_action: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """다음 액션 (follow-up)"""
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    """완료 전환 시각 (UTC). status=completed 전이 시 자동 기록 (D14-a)."""

    # 관계
    user: Mapped["ErpUser"] = relationship("ErpUser")

    __table_args__ = (
        Index("idx_work_log_user_date", "user_id", "work_date"),
        Index("idx_work_log_status_date", "status", "work_date"),
    )


class KpiResult(Base, TimestampMixin):
    # @TASK T14.0 - KPI 평가 결과 (정본 스키마, D16)
    # @SPEC 04-data-model.md §2.5
    """
    KPI 평가 결과 (정본 스키마, D16)

    **메트릭별 롱포맷**: 1행 = 1 user + 1 기간 + 1 metric
    **정량 값**: 결정론적 코드로 계산(D14-e)
    **AI 서술**: ai_draft JSONB (정량 점수 미포함)
    **ERP 푸시**: final_score만 전송, 관리자 확정 이벤트 + 분기 마감 배치(D17)

    **8가지 metric**:
    1. work_completed_count (완료 work_log 건수)
    2. work_quality_score (충실도 점수 0-100)
    3. minutes_authored_count (회의록 작성 수)
    4. action_items_completed (담당 액션아이템 완료 수)
    5. action_items_ontime_rate (담당 액션아이템 기한내 완료율 0-100)
    6. report_fidelity_score (업무기록/일일리포트 충실도 0-100)
    7. collaboration_score (종합 협업 점수 0-100)
    8. quarterly_total (분기 종합 점수)
    """
    __tablename__ = "kpi_result"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    """RESTRICT: 평가 기록 영구성(D18)"""
    period_type: Mapped[KpiPeriodType] = mapped_column(
        SQLEnum(KpiPeriodType),
        nullable=False
    )
    """daily | quarterly (기간 타입, 'period' 컬럼 폐기 — D16)"""
    period_key: Mapped[str] = mapped_column(String(20), nullable=False)
    """period_type=daily → 'YYYY-MM-DD', quarterly → 'YYYY-Q#' (NULL 금지 — D16)"""
    metric: Mapped[str] = mapped_column(String(100), nullable=False)
    """metric 어휘사전(8가지) 값만 허용"""
    value: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    """결정론적 코드로 계산된 정량 값 (NUMERIC(10,2) — 04 정본, 감사 재현성 D14-e)"""
    unit: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    """단위 (count, %, score)"""
    source: Mapped[KpiSource] = mapped_column(
        SQLEnum(KpiSource),
        nullable=False,
        default=KpiSource.VIRTUAL_OFFICE
    )

    # AI 초안 (D14-e)
    ai_draft: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    """AI 서술 초안 {강점, 개선, 근거} — 정량 점수 미포함(D14-e)"""
    ai_draft_generated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    ai_model: Mapped[str] = mapped_column(String(50), nullable=False, default="claude-opus")

    # 관리자 검토 (D15)
    admin_adjusted_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    """관리자 조정 점수 (미조정 시 NULL → value가 유효, NUMERIC(10,2))"""
    admin_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """관리자 검토/조정 사유"""
    admin_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="SET NULL"),
        nullable=True
    )
    admin_reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    # 이의신청 상태머신 (D15)
    objection_status: Mapped[KpiObjectionStatus] = mapped_column(
        SQLEnum(KpiObjectionStatus),
        nullable=False,
        default=KpiObjectionStatus.NONE
        # 인덱스는 idx_kpi_result_objection(명시 Index)만 사용 (A3-20 중복 제거)
    )
    objection_detail: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    """{category, text, evidence, submitted_at}"""
    objection_submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    objection_resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    # 확정 (D15)
    final_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    """확정 최종 점수 (= admin_adjusted_score ?? value, 확정 시 설정, NUMERIC(10,2))"""
    finalized_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
        # 인덱스는 idx_kpi_result_finalized(명시 Index)만 사용 (A3-20 중복 제거)
    )
    """확정 시각 (UTC, NULL = 미확정)"""

    # 추가
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """메트릭별 추가 주석"""

    # ERP 푸시 (D15·D17)
    pushed_to_erp: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    pushed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True
    )
    """ERP 전송 시각 (UTC)"""

    # 관계
    user: Mapped["ErpUser"] = relationship("ErpUser", foreign_keys=[user_id])
    admin_user: Mapped[Optional["ErpUser"]] = relationship("ErpUser", foreign_keys=[admin_user_id])

    __table_args__ = (
        UniqueConstraint("user_id", "period_type", "period_key", "metric", name="uq_kpi_result_metric"),
        Index("idx_kpi_result_objection", "objection_status"),
        Index("idx_kpi_result_pushed", "pushed_to_erp", "pushed_at"),
        Index("idx_kpi_result_finalized", "finalized_at"),
        CheckConstraint("value >= 0", name="ck_kpi_value_nonnegative"),
    )


class DailyStatusPush(Base, TimestampMixin):
    # @TASK T15.0 - 일일 상태 푸시 로그
    # @SPEC 04-data-model.md §2.5
    """
    우리 플랫폼 → ERP 연동의 배치 로그 (D17)

    target별로 재시도를 분리 관리:
    - erp_daily_reports: 매일 18:00 KST
    - erp_kpi_results: 관리자 확정 + 분기 마감 배치
    """
    __tablename__ = "daily_status_push"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )
    """RESTRICT: 전송 이력 보존(D18)"""
    push_date: Mapped[date] = mapped_column(Date, nullable=False)
    """푸시 대상 날짜 (KST 경계)"""
    target: Mapped[DailyStatusPushTarget] = mapped_column(
        SQLEnum(DailyStatusPushTarget),
        nullable=False,
        index=True
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    """전송 페이로드 (일일리포트 or KPI)"""
    status: Mapped[DailyStatusPushStatus] = mapped_column(
        SQLEnum(DailyStatusPushStatus),
        nullable=False,
        default=DailyStatusPushStatus.PENDING,
        index=True
    )
    pushed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """실제 전송 시각 (UTC)"""
    erp_response: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    """ERP 응답 (성공/에러 본문)"""
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """실패 사유 요약 (재시도 판정용)"""
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    """재시도 횟수 (최대 3, 지수 백오프)"""
    run_id: Mapped[Optional[UUID]] = mapped_column(nullable=True, index=True)
    """배치 실행 식별자 (멱등성·감사)"""

    # 관계
    user: Mapped["ErpUser"] = relationship("ErpUser")

    __table_args__ = (
        Index("idx_daily_status_push_status", "status", "target", "created_at"),
        Index("idx_daily_status_push_user_date", "user_id", "push_date"),
        Index("idx_daily_status_push_run_id", "run_id"),
    )


# ============================================================================
# F. 자산·감시·감사 계층 (2개)
# ============================================================================

class Asset(Base, TimestampMixin):
    # @TASK T16.0 - 3D 에셋 레지스트리
    # @SPEC docs/planning/07-3d-visual-asset-pipeline.md §5.3 v1.1 (정본, C4-c)
    """
    3D 에셋 메타데이터 (Blender → GLB/glTF → 웹/R3F, D28 전환. 구 파이프라인: → .tscn → Godot)

    - PK는 카탈로그 키 문자열 (예: "reception-desk-v1.0") — 05 layout asset_id와 직접 조인
    - 라이선스/저작권 추적 + 성능 예산(polygon/파일 크기) 정본 소스
    """
    __tablename__ = "asset"

    asset_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    """카탈로그 키 (예: "reception-desk-v1.0")"""
    asset_name: Mapped[str] = mapped_column(String(256), nullable=False)
    """표시명 (예: "Reception Desk")"""
    asset_type: Mapped[AssetType] = mapped_column(
        SQLEnum(AssetType),
        nullable=False,
        index=True
    )
    """furniture | structure | material | ui3d | character | environment"""
    asset_category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    """office | meeting-room | lounge | lobby 등"""
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """원본 다운로드 URL (CC0 소스: ambientCG, Poly Haven)"""
    author: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    """에셋 제작자"""
    license: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    """CC0 | CC-BY | custom | proprietary"""
    license_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """라이선스 문서 링크"""
    downloaded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """최초 취득 시각 (UTC)"""
    modified_by: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    """수정/가공한 사람 (자유텍스트 — 07 §5.3)"""
    commercial_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    """상업적 사용 가능"""
    attribution_required: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    """저작권 표시 필수"""
    redistribution_allowed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    """수정본 재배포 가능"""
    original_file_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    """원본 SHA-256 (변조 감지)"""
    optimized_file_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    """최적화 후 GLB SHA-256"""
    gltf_path: Mapped[str] = mapped_column(String(256), nullable=False)
    """웹 배포 산출물 glTF/GLB 경로 (D28 R3F 전환: 구 Godot res://….tscn 대체, 05 ASSET_CATALOG 조회 대상)"""
    source_glb_path: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    """임포트 소스 glb (저장소 보관, pak 미포함)"""
    file_size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    """산출물 크기 (성능 예산 참고용, CDN 아님 — 런타임 다운로드 없음/D8)"""
    polygon_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    """트라이앵글 수 (LOD 0). 05 performance 파생 계산의 정본 소스"""
    texture_resolution: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    """예: "2048x2048" """
    dimension: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    """실측 크기 {"width":1.5,"depth":0.8,"height":0.75}(m). 05 좌석↔가구 정합·검증의 정본"""
    footprint_2d: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    """편집기 도면용 2D 풋프린트 {"width":1.5,"depth":0.8}(m)"""
    thumbnail_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """편집기 팔레트 썸네일"""
    used_in_scene: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    """사용 장면 배열 (예: ["stage1_lobby", "stage1_office"])"""
    external_dependencies: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """의존 에셋 (예: materials/wood_floor_006)"""
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """커스텀 메타데이터, 사용 노트"""
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    """soft delete 시각 (NULL = 활성)"""

    __table_args__ = (
        Index("idx_asset_type_category", "asset_type", "asset_category"),
        Index("idx_asset_license", "license"),
    )


class AuditLog(Base):
    # @TASK T17.0 - 감사 로그
    # @SPEC 04-data-model.md §2.6
    """
    중요 엔티티 변경 감시 (좌석배정, 회의, KPI, 배포)

    **컴플라이언스**: 5년 보존 후 파기/익명화(D20-e)

    **감시 대상 액션**:
    - seat_assigned / seat_unassigned
    - meeting_created / meeting_updated / meeting_cancelled
    - recording_started / recording_stopped (D20-b)
    - kpi_adjusted / kpi_finalized / kpi_objection_submitted
    - office_layout_deployed
    """
    __tablename__ = "audit_log"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="SET NULL"),
        nullable=True
    )
    """행위자 (nullable=system)"""
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    """액션명"""
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    """엔티티 타입"""
    entity_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    old_value: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    """IPv4/IPv6"""
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )
    """행위 시각 (UTC 저장, 표시 시 KST 변환)"""

    # 관계
    user: Mapped[Optional["ErpUser"]] = relationship("ErpUser")

    __table_args__ = (
        Index("idx_audit_log_user_time", "user_id", "created_at"),
        Index("idx_audit_log_entity", "entity_type", "entity_id"),
        Index("idx_audit_log_action_time", "action", "created_at"),
    )


class ErpSyncLog(Base):
    """ERP 동기화 실행 로그 (management-api: /erp-sync/status·/failures).

    각 POST /api/erp/sync 실행마다 1건 적재. 실패 시 status=failed + error.
    """

    __tablename__ = "erp_sync_log"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deactivated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="success", index=True)
    """success | failed"""
    trigger: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    """manual | scheduled"""
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

class Notice(Base, TimestampMixin, SoftDeleteMixin):
    """사내 공지사항 (대시보드 우측 패널 · 14-virtual-office-spec §2.8).

    관리자 작성 · 전 직원 열람. is_active soft-delete, pinned 상단 고정.
    """

    __tablename__ = "notice"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    """본문 (마크다운 상세 열람용)"""
    author: Mapped[str] = mapped_column(String(100), nullable=False, default="공지")
    """표시 작성자 라벨 (예: 인사팀, IT팀)"""
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    """상단 고정 여부"""
    created_by: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    """작성자 ERP user.id (감사용, 표시는 author 라벨)"""

    __table_args__ = (
        Index("idx_notice_active_pinned_time", "is_active", "pinned", "created_at"),
    )


class UserAvatar(Base, TimestampMixin):
    # @TASK C4 - 아바타 커스터마이징
    # @SPEC 06-screens.md §3.9 (프리셋 + 상/하의 색상 팔레트 + 이름표)
    """
    직원 아바타 커스터마이징 (user_id당 1개).

    경량: 프리셋 식별자 + 상/하의 색상(#RRGGBB) + 이름표 표시 여부.
    리깅/에셋은 07-3d-visual-asset-pipeline 참조. 고도화 시 확장.
    """
    __tablename__ = "user_avatar"

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("erp_user.id", ondelete="CASCADE"),
        primary_key=True,
    )
    """ERP user.id (PK, 1:1)"""
    preset_id: Mapped[str] = mapped_column(String(32), nullable=False, default="humanoid_a")
    """아바타 프리셋 식별자 (humanoid_a | humanoid_b …)"""
    top_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#3B5BFE")
    """상의 색상 (#RRGGBB)"""
    bottom_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#1E293B")
    """하의 색상 (#RRGGBB)"""
    show_nameplate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    """머리 위 이름표(이름/직급) 표시 여부"""
