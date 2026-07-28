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
from uuid import uuid4

from sqlalchemy import select, update

from app.erp.reader import ErpReader
from app.models.tables import (
    USER_SOURCE_ERP,
    ErpRole,
    ErpUser,
    OrgGroup,
    OrgGroupType,
    UserTeamHistory,
)

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


@dataclass
class TeamSyncResult:
    """ERP 팀 → org_group 반영 결과."""

    created: int = 0   # 조직도에 없던 팀 → 그룹 신설
    linked: int = 0    # 이름이 같은 미연결 그룹을 발견 → 팀 번호만 이어 줌
    kept: int = 0      # 이미 누가 맡고 있음 → 손대지 않음(관리자 소유)


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

        # 기존 행 로드 (company 스코프 + ERP 정본 유저만).
        # source='native'(콘솔에서 admin이 직접 만든 유저)는 ERP에 존재하지 않는 게 정상이므로
        # 대사 대상에서 제외한다 — 포함하면 전체 대사가 매번 native 유저를 비활성화한다(Phase 3).
        existing: dict[int, ErpUser] = {
            row.id: row
            for row in (
                await self.session.execute(
                    select(ErpUser).where(
                        ErpUser.company_id == company_id,
                        ErpUser.source == USER_SOURCE_ERP,
                    )
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
                        last_synced_at=now, source=USER_SOURCE_ERP,
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

    async def sync_teams(self, reader: ErpReader, company_id: int) -> TeamSyncResult:
        """ERP teams → `org_group` 반영 (D39 후속).

        `ErpTeamDTO`에는 이름·색이 있었지만 아무도 `fetch_teams()`를 부르지 않아, ERP 연동
        회사도 팀 이름을 관리자가 손으로 이어야 했다(안 이으면 화면에 "팀 3"으로 뜬다).

        **기존 이름은 덮어쓰지 않는다.** 조직도는 관리자의 것이다 — 우리 화면에서 부서를
        "플랫폼개발팀"으로 고쳤는데 다음 동기화가 ERP 값으로 되돌리면, 관리자는 자기가 한 일이
        왜 사라지는지 알 수 없다. 그래서 이 동기화가 하는 일은 셋뿐이다:

          1. 조직도에 아직 없는 팀   → 부서로 신설(이름·색은 ERP 값이 출발점)
          2. 이름이 같은 미연결 그룹 → 팀 번호만 이어 줌(관리자가 먼저 만들어 둔 경우)
          3. 이미 누가 맡은 팀       → 손대지 않음

        결과적으로 ERP의 팀 **개편**(신설)은 따라가고 **개명**은 따라가지 않는다. 개명까지
        따라가려면 그룹에 출처(erp/native) 구분이 필요하다 — `erp_user.source`와 같은 장치를
        `org_group`에도 두는 별도 작업.

        팀 0은 건너뛴다 — "미배정" 센티널이라 그룹이 맡으면 소속 없는 사람이 뭉친다(D39-c).
        """
        teams = await reader.fetch_teams(company_id)
        rows = (
            await self.session.execute(
                select(OrgGroup).where(OrgGroup.company_id == company_id)
            )
        ).scalars().all()
        by_team = {g.erp_team_id: g for g in rows if g.erp_team_id is not None}
        by_name = {g.name.strip(): g for g in rows if g.erp_team_id is None}

        result = TeamSyncResult()
        for t in teams:
            if t.id == 0:
                continue
            if t.id in by_team:
                result.kept += 1
                continue
            name = (t.name or "").strip()
            existing = by_name.get(name) if name else None
            if existing is not None:
                existing.erp_team_id = t.id
                by_team[t.id] = existing
                by_name.pop(name, None)
                result.linked += 1
                continue
            group = OrgGroup(
                id=uuid4(),
                company_id=company_id,
                name=name or f"팀 {t.id}",
                type=OrgGroupType.DEPARTMENT,
                color=getattr(t, "color", None),
                erp_team_id=t.id,
            )
            self.session.add(group)
            by_team[t.id] = group
            result.created += 1

        await self.session.flush()
        return result
