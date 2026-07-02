"""
ErpSyncService — ErpReader에서 읽어 우리 DB(erp_user)에 upsert.

소스(Mock/Postgres) 무관 동일 로직 (D18):
- users → erp_user upsert (조인 키 = ERP users.id)
- ERP에서 사라진 사용자 → soft-delete(is_active=False), 물리삭제 금지
- work_hours: ERP 시간 → 분 환산
- attendances/leaves는 read-through(미저장) — 서비스가 DTO 그대로 반환
"""

from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select, update

from app.erp.reader import ErpReader
from app.models.tables import ErpRole, ErpUser

_VALID_ROLES = {r.value for r in ErpRole}


@dataclass
class SyncResult:
    created: int = 0
    updated: int = 0
    deactivated: int = 0

    @property
    def total_touched(self) -> int:
        return self.created + self.updated + self.deactivated


def _map_role(raw: str) -> ErpRole:
    """알 수 없는 role은 EMPLOYEE로 안전 폴백 (스키마 드리프트 방어)."""
    return ErpRole(raw) if raw in _VALID_ROLES else ErpRole.EMPLOYEE


class ErpSyncService:
    def __init__(self, session):
        self.session = session

    async def sync_users(self, reader: ErpReader, company_id: int) -> SyncResult:
        now = datetime.now(timezone.utc)
        dtos = await reader.fetch_users(company_id)
        fetched_ids = {d.id for d in dtos}
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
            result.deactivated = len(stale_ids)

        await self.session.flush()
        return result
