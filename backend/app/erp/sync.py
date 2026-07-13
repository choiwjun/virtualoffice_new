"""
ErpSyncService — ErpReader에서 읽어 우리 DB(erp_user + user_team_history)에 upsert.

소스(Mock/Postgres) 무관 동일 로직 (D18):
- users → erp_user upsert (조인 키 = ERP users.id)
- ERP에서 사라진 사용자 → soft-delete(is_active=False), 물리삭제 금지
- work_hours: ERP 시간 → 분 환산
- 팀 이동 감지: erp_team_id 변경 시 user_team_history 이력 기록 (D18)
- attendances/leaves는 read-through(미저장) — 서비스가 DTO 그대로 반환
- 레코드 단위 멱등 upsert (metric 단위 아님, primary key = ERP id)

컬럼 화이트리스트 최소수집(D20-f): GPS/슬랙/깃허브 등 미수집.
GPS 기반 자동 상태 전이 금지(D20-c).
"""

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.erp.reader import ErpReader
from app.models.tables import ErpRole, ErpUser, UserTeamHistory

_VALID_ROLES = {r.value for r in ErpRole}


@dataclass
class SyncResult:
    created: int = 0
    updated: int = 0
    deactivated: int = 0
    team_moves: int = 0  # 팀 이동 감지 건수 (user_team_history 기록)

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
        """ERP users → erp_user upsert + user_team_history 이력.

        증분(updated_at 기준 아님 — ERP users에 updated_at 미보장):
        매 호출마다 전체 대사 → 레코드 단위 비교 후 변경분만 반영.
        전체 대사에서 사라진 활성 사용자 → soft-delete(is_active=False).
        """
        now = datetime.now(timezone.utc)
        dtos = await reader.fetch_users(company_id)
        fetched_ids = {d.id for d in dtos}
        result = SyncResult()

        # 기존 행 로드 (company 스코프)
        existing: dict[int, ErpUser] = {
            row.id: row
            for row in (
                await self.session.execute(
                    select(ErpUser).where(ErpUser.company_id == company_id)
                )
            ).scalars()
        }

        # 열린 팀 이력 로드 (valid_to IS NULL) — 팀 이동 감지용
        open_histories: dict[int, UserTeamHistory] = {}
        if existing:
            hist_rows = (
                await self.session.execute(
                    select(UserTeamHistory).where(
                        UserTeamHistory.user_id.in_(existing.keys()),
                        UserTeamHistory.valid_to.is_(None),
                    )
                )
            ).scalars().all()
            open_histories = {h.user_id: h for h in hist_rows}

        for d in dtos:
            row = existing.get(d.id)
            work_hours_min = d.default_work_hours * 60 if d.default_work_hours is not None else None
            new_team_id = d.team_id or 0

            if row is None:
                # 신규 삽입
                self.session.add(
                    ErpUser(
                        id=d.id, company_id=d.company_id, email=d.email, name=d.name,
                        erp_team_id=new_team_id, role=_map_role(d.role),
                        position=d.position, position_id=d.position_id,
                        manager_id=d.manager_id, work_type=d.default_work_type,
                        work_hours=work_hours_min, is_active=d.is_active,
                        last_synced_at=now,
                    )
                )
                # 최초 팀 이력 기록
                self.session.add(
                    UserTeamHistory(
                        user_id=d.id,
                        erp_team_id=new_team_id,
                        valid_from=now,
                    )
                )
                result.created += 1
            else:
                # 팀 이동 감지: erp_team_id 변경 시 이력 닫고 새 이력 열기
                if row.erp_team_id != new_team_id:
                    prev_hist = open_histories.get(d.id)
                    if prev_hist is not None:
                        prev_hist.valid_to = now  # 이전 이력 닫기
                    # 새 이력 열기
                    self.session.add(
                        UserTeamHistory(
                            user_id=d.id,
                            erp_team_id=new_team_id,
                            valid_from=now,
                        )
                    )
                    result.team_moves += 1

                row.email = d.email
                row.name = d.name
                row.erp_team_id = new_team_id
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
        # 예외: password_hash가 있는 로컬 dev/도그푸딩 계정(scripts/seed_dev.py)은 보존 —
        # mock ERP 전체 대사가 시드 계정을 비활성화해 로그인이 끊기는 문제 방지 (QA 2026-07-13).
        stale_ids = [
            uid for uid, row in existing.items()
            if uid not in fetched_ids and row.is_active and row.password_hash is None
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
