"""
ErpSyncService — ErpReader에서 읽어 우리 DB(erp_user/erp_team/erp_position)에 upsert.

소스(Mock/Postgres) 무관 동일 로직 (D18):
- users → erp_user upsert (조인 키 = ERP users.id)
- teams → erp_team upsert (조인 키 = ERP teams.id) (G005, P2-R1-T1)
- positions → erp_position upsert (조인 키 = ERP job_positions.id) (G005, P2-R1-T1)
- ERP에서 사라진 행 → soft-delete(is_active=False), 물리삭제 금지 (각 엔티티별 AuditLog 기록)
- work_hours: ERP 시간 → 분 환산 (users만 해당)

**스코프 결정 (G005, dtos.py 정본 유지)**: attendances/leaves는 read-through(미저장)로
유지한다. ErpAttendanceDTO/ErpLeaveDTO는 dtos.py에 "read-through, 미저장"으로 명시돼
있고 ErpAttendanceDTO에는 updated_at조차 없다 — 이는 대량 시계열 데이터를 미러링하지
않기로 한 기존 설계 결정이며, G005 범위는 이를 뒤집지 않는다(teams/positions만 미러
확장 대상).
"""

from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select, update

from app.erp.reader import ErpReader
from app.models.tables import AuditLog, ErpPosition, ErpRole, ErpTeam, ErpUser
import logging

_VALID_ROLES = {r.value for r in ErpRole}


@dataclass
class SyncResult:
    created: int = 0
    updated: int = 0
    deactivated: int = 0
    skipped: int = 0

    @property
    def total_touched(self) -> int:
        return self.created + self.updated + self.deactivated


def _map_role(raw: str) -> ErpRole:
    """알 수 없는 role은 EMPLOYEE로 안전 폴백 (스키마 드리프트 방어)."""
    return ErpRole(raw) if raw in _VALID_ROLES else ErpRole.EMPLOYEE


logger = logging.getLogger(__name__)

_INT64_MAX = 9223372036854775807


def _valid_erp_id(value) -> bool:
    """ERP id는 BigInteger(int64) — 범위 밖(스키마 드리프트/손상 페이로드)은 배치 전체를
    OverflowError로 중단시키지 않도록 스킵한다(부분 반영 + 경고)."""
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 1 <= value <= _INT64_MAX
    )


class ErpSyncService:
    def __init__(self, session):
        self.session = session

    async def sync_users(self, reader: ErpReader, company_id: int) -> SyncResult:
        now = datetime.now(timezone.utc)
        dtos = await reader.fetch_users(company_id)
        fetched_ids = {d.id for d in dtos if _valid_erp_id(d.id)}
        result = SyncResult()

        # 기존 행 로드 (company 스코프)
        existing = {
            row.id: row
            for row in (
                await self.session.execute(
                    select(ErpUser).where(ErpUser.company_id == company_id)
                )
            ).scalars()
        }

        for d in dtos:
            if not _valid_erp_id(d.id):
                logger.warning("erp sync(users): skip out-of-range id %r", d.id)
                result.skipped += 1
                continue
            row = existing.get(d.id)
            work_hours_min = d.default_work_hours * 60 if d.default_work_hours is not None else None
            if row is None:
                self.session.add(
                    ErpUser(
                        id=d.id, company_id=d.company_id, email=d.email, name=d.name,
                        erp_team_id=d.team_id or 0, role=_map_role(d.role),
                        position=d.position, position_id=d.position_id,
                        manager_id=d.manager_id, work_type=d.default_work_type,
                        work_hours=work_hours_min, is_active=d.is_active,
                        last_synced_at=now,
                    )
                )
                result.created += 1
            else:
                row.email = d.email
                row.name = d.name
                row.erp_team_id = d.team_id or 0
                row.role = _map_role(d.role)
                row.position = d.position
                row.position_id = d.position_id
                row.manager_id = d.manager_id
                row.work_type = d.default_work_type
                row.work_hours = work_hours_min
                row.is_active = d.is_active
                row.last_synced_at = now
                result.updated += 1

        # ERP에서 사라진 활성 사용자 → soft-delete
        stale_ids = [
            uid for uid, row in existing.items()
            if uid not in fetched_ids and row.is_active
        ]
        if stale_ids:
            await self.session.execute(
                update(ErpUser)
                .where(ErpUser.id.in_(stale_ids))
                .values(is_active=False, last_synced_at=now)
            )
            # D18/contract §1.3: 하드삭제 감지 soft-delete는 감사 추적(actor=시스템 배치).
            # AuditLog는 stage-only(commit은 호출자=scheduler/sync 엔드포인트가 수행) — soft-delete와 원자적.
            for uid in stale_ids:
                self.session.add(
                    AuditLog(
                        user_id=None,
                        action="erp_user_soft_deleted",
                        entity_type="erp_user",
                        entity_id=str(uid),
                        old_value={"is_active": True},
                        new_value={"is_active": False},
                    )
                )
            result.deactivated = len(stale_ids)

        await self.session.flush()
        return result

    async def sync_teams(self, reader: ErpReader, company_id: int) -> SyncResult:
        now = datetime.now(timezone.utc)
        dtos = await reader.fetch_teams(company_id)
        fetched_ids = {d.id for d in dtos if _valid_erp_id(d.id)}
        result = SyncResult()

        # 기존 행 로드 (company 스코프)
        existing = {
            row.id: row
            for row in (
                await self.session.execute(
                    select(ErpTeam).where(ErpTeam.company_id == company_id)
                )
            ).scalars()
        }

        for d in dtos:
            if not _valid_erp_id(d.id):
                logger.warning("erp sync(teams): skip out-of-range id %r", d.id)
                result.skipped += 1
                continue
            row = existing.get(d.id)
            if row is None:
                self.session.add(
                    ErpTeam(
                        id=d.id, company_id=d.company_id, name=d.name,
                        color=d.color, leader_name=d.leader_name,
                        last_synced_at=now,
                    )
                )
                result.created += 1
            else:
                row.name = d.name
                row.color = d.color
                row.leader_name = d.leader_name
                row.is_active = True
                row.last_synced_at = now
                result.updated += 1

        # ERP에서 사라진 활성 팀 → soft-delete
        stale_ids = [
            uid for uid, row in existing.items()
            if uid not in fetched_ids and row.is_active
        ]
        if stale_ids:
            await self.session.execute(
                update(ErpTeam)
                .where(ErpTeam.id.in_(stale_ids))
                .values(is_active=False, last_synced_at=now)
            )
            for uid in stale_ids:
                self.session.add(
                    AuditLog(
                        user_id=None,
                        action="erp_team_soft_deleted",
                        entity_type="erp_team",
                        entity_id=str(uid),
                        old_value={"is_active": True},
                        new_value={"is_active": False},
                    )
                )
            result.deactivated = len(stale_ids)

        await self.session.flush()
        return result

    async def sync_positions(self, reader: ErpReader, company_id: int) -> SyncResult:
        now = datetime.now(timezone.utc)
        dtos = await reader.fetch_positions(company_id)
        fetched_ids = {d.id for d in dtos if _valid_erp_id(d.id)}
        result = SyncResult()

        # 기존 행 로드 (company 스코프)
        existing = {
            row.id: row
            for row in (
                await self.session.execute(
                    select(ErpPosition).where(ErpPosition.company_id == company_id)
                )
            ).scalars()
        }

        for d in dtos:
            if not _valid_erp_id(d.id):
                logger.warning("erp sync(positions): skip out-of-range id %r", d.id)
                result.skipped += 1
                continue
            row = existing.get(d.id)
            if row is None:
                self.session.add(
                    ErpPosition(
                        id=d.id, company_id=d.company_id, name=d.name,
                        level=d.level, is_active=True,
                        last_synced_at=now,
                    )
                )
                result.created += 1
            else:
                row.name = d.name
                row.level = d.level
                row.is_active = True
                row.last_synced_at = now
                result.updated += 1

        # ERP에서 사라진 활성 직급 → soft-delete
        stale_ids = [
            uid for uid, row in existing.items()
            if uid not in fetched_ids and row.is_active
        ]
        if stale_ids:
            await self.session.execute(
                update(ErpPosition)
                .where(ErpPosition.id.in_(stale_ids))
                .values(is_active=False, last_synced_at=now)
            )
            for uid in stale_ids:
                self.session.add(
                    AuditLog(
                        user_id=None,
                        action="erp_position_soft_deleted",
                        entity_type="erp_position",
                        entity_id=str(uid),
                        old_value={"is_active": True},
                        new_value={"is_active": False},
                    )
                )
            result.deactivated = len(stale_ids)

        await self.session.flush()
        return result
