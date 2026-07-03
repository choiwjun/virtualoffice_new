"""ORM 모델 재노출. 정본: app/models/tables.py (04-data-model.md)."""

from app.models.tables import (
    Base,
    # ── ERP 미러 / 조직 ──
    ErpUser,
    AuthCredential,
    OrgGroup,
    TeamZone,
    UserTeamHistory,
    # ── 공간 / 레이아웃 ──
    Office,
    Floor,
    OfficeLayout,
    Room,
    Seat,
    SeatAssignmentHistory,
    # ── 실시간 / 프레즌스 ──
    Presence,
    # ── 회의 / 협업 ──
    Meeting,
    MeetingParticipant,
    MeetingMinute,
    ActionItem,
    WorkLog,
    # ── KPI / ERP push ──
    KpiResult,
    DailyStatusPush,
    # ── 에셋 / 감사 ──
    Asset,
    AuditLog,
)

__all__ = [
    "Base",
    "ErpUser",
    "AuthCredential",
    "OrgGroup",
    "TeamZone",
    "UserTeamHistory",
    "Office",
    "Floor",
    "OfficeLayout",
    "Room",
    "Seat",
    "SeatAssignmentHistory",
    "Presence",
    "Meeting",
    "MeetingParticipant",
    "MeetingMinute",
    "ActionItem",
    "WorkLog",
    "KpiResult",
    "DailyStatusPush",
    "Asset",
    "AuditLog",
]
