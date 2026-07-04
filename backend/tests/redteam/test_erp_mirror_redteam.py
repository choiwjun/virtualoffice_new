"""
ERP 팀/직급 미러 동기화(sync_teams/sync_positions, G005) 적대적(red-team) 테스트.

목적: erp_team/erp_position 미러의 전체 대사·company 스코프·멱등성·재활성화·감사 로그를
깨뜨리는 것을 목표로 한다. test_erp_mirror_sync.py(정상 경로)와 달리 여기서는 극단 입력
(빈 리더, 재활성화, 거대 id, 이미 비활성 행 재대사, positions.is_active DTO 플래그와
미러 soft-delete 시맨틱 충돌 가능성)을 다룬다.

@SPEC app/erp/sync.py (sync_teams/sync_positions), docs/planning/00-decisions.md D18
"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.erp.dtos import ErpPositionDTO, ErpTeamDTO
from app.erp.mock_reader import MockErpReader
from app.erp.sync import ErpSyncService
from app.models.tables import AuditLog, ErpPosition, ErpTeam

pytestmark = pytest.mark.asyncio


def _team(id_, company_id=1, name="팀", color="#111111", leader_name="리더"):
    return ErpTeamDTO(id=id_, company_id=company_id, name=name, color=color, leader_name=leader_name)


def _position(id_, company_id=1, name="직급", level=1, is_active=True):
    return ErpPositionDTO(id=id_, company_id=company_id, name=name, level=level, is_active=is_active)


# ── (1) 빈 리더 → 전체 대사(활성 행 전원 soft-delete) ──────────────
async def test_teams_empty_reader_deactivates_all_active_rows(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    seeded = await svc.sync_teams(MockErpReader(teams=[_team(1), _team(2), _team(3)]), company_id=1)
    assert seeded.created == 3

    r = await svc.sync_teams(MockErpReader(teams=[]), company_id=1)
    assert r.deactivated == 3, "빈 리더에서 활성 팀 전원 soft-delete 미동작"

    rows = (await db_session.execute(select(ErpTeam).where(ErpTeam.company_id == 1))).scalars().all()
    assert len(rows) == 3, "soft-delete가 아니라 하드삭제(행 소멸)"
    assert all(t.is_active is False for t in rows)

    logs = (
        await db_session.execute(select(AuditLog).where(AuditLog.action == "erp_team_soft_deleted"))
    ).scalars().all()
    assert len(logs) == 3, "soft-delete 감사 로그 개수 불일치(행당 1건이어야 함)"
    assert {log.entity_id for log in logs} == {"1", "2", "3"}


async def test_positions_empty_reader_deactivates_all_active_rows(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    seeded = await svc.sync_positions(
        MockErpReader(positions=[_position(1), _position(2), _position(3)]), company_id=1
    )
    assert seeded.created == 3

    r = await svc.sync_positions(MockErpReader(positions=[]), company_id=1)
    assert r.deactivated == 3, "빈 리더에서 활성 직급 전원 soft-delete 미동작"

    rows = (await db_session.execute(select(ErpPosition).where(ErpPosition.company_id == 1))).scalars().all()
    assert len(rows) == 3
    assert all(p.is_active is False for p in rows)

    logs = (
        await db_session.execute(select(AuditLog).where(AuditLog.action == "erp_position_soft_deleted"))
    ).scalars().all()
    assert len(logs) == 3
    assert {log.entity_id for log in logs} == {"1", "2", "3"}


# ── (2) company 스코프 격리: A 동기화가 B를 절대 건드리지 않음 ──────
async def test_teams_company_a_sync_never_touches_company_b(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    # 두 회사 모두 시드
    await svc.sync_teams(MockErpReader(teams=[_team(1, company_id=1), _team(2, company_id=1)]), company_id=1)
    await svc.sync_teams(MockErpReader(teams=[_team(100, company_id=2)]), company_id=2)

    # A만 재동기화하되 팀 하나가 사라짐(soft-delete 유발) — B에 영향 없어야 함
    r = await svc.sync_teams(MockErpReader(teams=[_team(1, company_id=1)]), company_id=1)
    assert r.deactivated == 1

    b_row = await db_session.get(ErpTeam, 100)
    assert b_row is not None, "타사 팀 행이 사라짐(스코프 누수로 인한 오삭제/오조회)"
    assert b_row.is_active is True, "타사 팀이 부당하게 soft-delete됨(company 스코프 누수)"

    b_logs = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.action == "erp_team_soft_deleted", AuditLog.entity_id == "100")
        )
    ).scalars().all()
    assert len(b_logs) == 0, "타사 팀에 대한 soft-delete 감사 로그가 부당하게 생성됨"


async def test_positions_company_a_sync_never_touches_company_b(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    await svc.sync_positions(
        MockErpReader(positions=[_position(1, company_id=1), _position(2, company_id=1)]), company_id=1
    )
    await svc.sync_positions(MockErpReader(positions=[_position(200, company_id=2)]), company_id=2)

    r = await svc.sync_positions(MockErpReader(positions=[_position(1, company_id=1)]), company_id=1)
    assert r.deactivated == 1

    b_row = await db_session.get(ErpPosition, 200)
    assert b_row is not None, "타사 직급 행이 사라짐"
    assert b_row.is_active is True, "타사 직급이 부당하게 soft-delete됨(company 스코프 누수)"


# ── (3) 멱등성: 동일 데이터 반복 동기화 시 신규 0/비활성 0/로그 중복 없음 ──
async def test_teams_repeated_identical_sync_is_fully_idempotent(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    data = [_team(1), _team(2)]
    await svc.sync_teams(MockErpReader(teams=data), company_id=1)
    r2 = await svc.sync_teams(MockErpReader(teams=data), company_id=1)
    r3 = await svc.sync_teams(MockErpReader(teams=data), company_id=1)

    assert r2.created == 0 and r2.deactivated == 0
    assert r3.created == 0 and r3.deactivated == 0

    rows = (await db_session.execute(select(ErpTeam))).scalars().all()
    assert len(rows) == 2, "반복 동기화가 중복 행을 생성함"

    logs = (
        await db_session.execute(select(AuditLog).where(AuditLog.action == "erp_team_soft_deleted"))
    ).scalars().all()
    assert len(logs) == 0, "변경 없는 반복 동기화가 soft-delete 감사 로그를 남김(로그 스팸)"


async def test_positions_repeated_identical_sync_is_fully_idempotent(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    data = [_position(1), _position(2), _position(3)]
    await svc.sync_positions(MockErpReader(positions=data), company_id=1)
    r2 = await svc.sync_positions(MockErpReader(positions=data), company_id=1)
    r3 = await svc.sync_positions(MockErpReader(positions=data), company_id=1)

    assert r2.created == 0 and r2.deactivated == 0
    assert r3.created == 0 and r3.deactivated == 0

    rows = (await db_session.execute(select(ErpPosition))).scalars().all()
    assert len(rows) == 3

    logs = (
        await db_session.execute(select(AuditLog).where(AuditLog.action == "erp_position_soft_deleted"))
    ).scalars().all()
    assert len(logs) == 0


# ── (4) 재활성화: soft-delete된 id가 다시 나타나면 is_active=True로 복구 ──
async def test_team_reactivation_after_soft_delete(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    await svc.sync_teams(MockErpReader(teams=[_team(1), _team(2)]), company_id=1)
    r_del = await svc.sync_teams(MockErpReader(teams=[_team(1)]), company_id=1)
    assert r_del.deactivated == 1
    dead = await db_session.get(ErpTeam, 2)
    assert dead.is_active is False

    # id=2가 리더에 다시 나타남(예: ERP측 실수 정정, 복구)
    r_reactivate = await svc.sync_teams(MockErpReader(teams=[_team(1), _team(2, name="부활팀")]), company_id=1)
    revived = await db_session.get(ErpTeam, 2)
    assert revived is not None, "재활성화 대신 행이 사라짐"
    assert revived.is_active is True, "재등장한 팀이 재활성화되지 않고 죽은 채로 남음"
    assert revived.name == "부활팀", "재활성화 시 최신 필드가 반영되지 않음"

    rows = (await db_session.execute(select(ErpTeam))).scalars().all()
    assert len(rows) == 2, "재활성화가 새 행을 중복 생성함(같은 id로 upsert되어야 함)"
    # 재활성화는 신규 생성이 아니라 update 경로여야 한다
    assert r_reactivate.created == 0, "재활성화가 created로 잘못 집계됨(update여야 함)"
    # id=1(변경 없음)과 id=2(재활성화) 둘 다 update 경로를 타므로 updated=2
    assert r_reactivate.updated == 2


async def test_position_reactivation_after_soft_delete(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    await svc.sync_positions(MockErpReader(positions=[_position(1), _position(2)]), company_id=1)
    r_del = await svc.sync_positions(MockErpReader(positions=[_position(1)]), company_id=1)
    assert r_del.deactivated == 1
    dead = await db_session.get(ErpPosition, 2)
    assert dead.is_active is False

    r_reactivate = await svc.sync_positions(
        MockErpReader(positions=[_position(1), _position(2, name="부활직급", is_active=True)]), company_id=1
    )
    revived = await db_session.get(ErpPosition, 2)
    assert revived is not None
    assert revived.is_active is True, "재등장한 직급이 재활성화되지 않고 죽은 채로 남음"
    assert revived.name == "부활직급"

    rows = (await db_session.execute(select(ErpPosition))).scalars().all()
    assert len(rows) == 2, "재활성화가 새 행을 중복 생성함"
    assert r_reactivate.created == 0
    # id=1(변경 없음)과 id=2(재활성화) 둘 다 update 경로를 타므로 updated=2
    assert r_reactivate.updated == 2


# ── (5) 이미 비활성인 행은 후속 동기화에서 재집계되지 않음 ──────────
async def test_team_already_inactive_not_recounted_as_deactivated(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    await svc.sync_teams(MockErpReader(teams=[_team(1), _team(2)]), company_id=1)
    r1 = await svc.sync_teams(MockErpReader(teams=[_team(1)]), company_id=1)
    assert r1.deactivated == 1
    r2 = await svc.sync_teams(MockErpReader(teams=[_team(1)]), company_id=1)
    assert r2.deactivated == 0, "이미 비활성인 팀이 재대사에서 중복 집계됨"

    logs = (
        await db_session.execute(select(AuditLog).where(AuditLog.action == "erp_team_soft_deleted"))
    ).scalars().all()
    assert len(logs) == 1, "이미 비활성인 팀에 대해 감사 로그가 중복 생성됨"


async def test_position_already_inactive_not_recounted_as_deactivated(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    await svc.sync_positions(MockErpReader(positions=[_position(1), _position(2)]), company_id=1)
    r1 = await svc.sync_positions(MockErpReader(positions=[_position(1)]), company_id=1)
    assert r1.deactivated == 1
    r2 = await svc.sync_positions(MockErpReader(positions=[_position(1)]), company_id=1)
    assert r2.deactivated == 0, "이미 비활성인 직급이 재대사에서 중복 집계됨"

    logs = (
        await db_session.execute(select(AuditLog).where(AuditLog.action == "erp_position_soft_deleted"))
    ).scalars().all()
    assert len(logs) == 1, "이미 비활성인 직급에 대해 감사 로그가 중복 생성됨"


# ── (6) 거대/이례적 id 값이 동기화를 크래시시키지 않음 ──────────────
HUGE_ID = 10**30


async def test_team_huge_id_does_not_crash_sync(db_session: AsyncSession):
    """수정됨(G005): int64 범위 밖 id(스키마 드리프트/손상 페이로드)는 배치를
    OverflowError로 죽이지 않고 스킵된다 — 같은 배치의 정상 행은 그대로 반영(부분 반영 + 경고)."""
    svc = ErpSyncService(db_session)
    r = await svc.sync_teams(MockErpReader(teams=[_team(1), _team(HUGE_ID)]), company_id=1)
    assert r.created == 1
    assert r.skipped == 1
    assert (await db_session.get(ErpTeam, 1)) is not None


async def test_position_huge_id_does_not_crash_sync(db_session: AsyncSession):
    """수정됨(G005): sync_positions도 동일하게 범위 밖 id를 스킵(부분 반영), 크래시 없음."""
    svc = ErpSyncService(db_session)
    r = await svc.sync_positions(
        MockErpReader(positions=[_position(1), _position(HUGE_ID)]), company_id=1
    )
    assert r.created == 1
    assert r.skipped == 1
    assert (await db_session.get(ErpPosition, 1)) is not None


# ── (7) 필드 변경(name/color/level)이 update 시 영구 반영 ──────────
async def test_team_field_updates_persisted(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    await svc.sync_teams(MockErpReader(teams=[_team(1, name="구팀명", color="#000000", leader_name="구리더")]), company_id=1)
    await svc.sync_teams(
        MockErpReader(teams=[_team(1, name="신팀명", color="#abcdef", leader_name="신리더")]), company_id=1
    )
    row = await db_session.get(ErpTeam, 1)
    assert row.name == "신팀명"
    assert row.color == "#abcdef"
    assert row.leader_name == "신리더"


async def test_position_field_updates_persisted(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    await svc.sync_positions(MockErpReader(positions=[_position(1, name="구직급", level=1)]), company_id=1)
    await svc.sync_positions(MockErpReader(positions=[_position(1, name="신직급", level=7)]), company_id=1)
    row = await db_session.get(ErpPosition, 1)
    assert row.name == "신직급"
    assert row.level == 7


# ── (8) soft-delete AuditLog 필드 정확성(action/entity_type/entity_id/old/new) ──
async def test_team_soft_delete_audit_log_fields_exact(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    await svc.sync_teams(MockErpReader(teams=[_team(7)]), company_id=1)
    await svc.sync_teams(MockErpReader(teams=[]), company_id=1)

    log = (
        await db_session.execute(select(AuditLog).where(AuditLog.action == "erp_team_soft_deleted"))
    ).scalar_one()
    assert log.entity_type == "erp_team"
    assert log.entity_id == "7"
    assert log.old_value == {"is_active": True}
    assert log.new_value == {"is_active": False}
    assert log.user_id is None  # 시스템 배치 주체


async def test_position_soft_delete_audit_log_fields_exact(db_session: AsyncSession):
    svc = ErpSyncService(db_session)
    await svc.sync_positions(MockErpReader(positions=[_position(9)]), company_id=1)
    await svc.sync_positions(MockErpReader(positions=[]), company_id=1)

    log = (
        await db_session.execute(select(AuditLog).where(AuditLog.action == "erp_position_soft_deleted"))
    ).scalar_one()
    assert log.entity_type == "erp_position"
    assert log.entity_id == "9"
    assert log.old_value == {"is_active": True}
    assert log.new_value == {"is_active": False}
    assert log.user_id is None


# ── (9) positions DTO.is_active 플래그 vs 미러 soft-delete 시맨틱 ──────
async def test_position_mirror_is_active_reflects_presence_not_dto_business_flag(
    db_session: AsyncSession,
):
    """수정됨(G005, WATCH-2 해소): 미러 is_active는 'ERP 응답에 존재함'(presence) 의미로
    teams와 동일하게 sync 시 True로 유지된다. ERP측 업무 비활성 플래그(DTO.is_active=False)를
    미러 soft-delete 컬럼에 혼입하지 않는다 — 감사 사각지대 제거."""
    svc = ErpSyncService(db_session)
    await svc.sync_positions(MockErpReader(positions=[_position(5, is_active=True)]), company_id=1)
    row = await db_session.get(ErpPosition, 5)
    assert row.is_active is True

    # 여전히 fetch 결과에 존재 → presence=True 유지(DTO 업무 플래그와 무관, soft-delete 아님)
    r = await svc.sync_positions(MockErpReader(positions=[_position(5, is_active=False)]), company_id=1)
    row = await db_session.get(ErpPosition, 5)
    assert row.is_active is True
    assert r.deactivated == 0

    # 실제로 ERP에서 사라지면 그때 soft-delete + 감사(presence 기준 — 사각지대 없음)
    r2 = await svc.sync_positions(MockErpReader(positions=[]), company_id=1)
    assert r2.deactivated == 1
    row = await db_session.get(ErpPosition, 5)
    assert row.is_active is False
    logs = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "erp_position_soft_deleted", AuditLog.entity_id == "5"
            )
        )
    ).scalars().all()
    assert len(logs) == 1  # presence 소실 시 정확히 1건 감사(사각지대 없음)
