"""
ERP 팀/직급 미러 동기화 테스트 (G005, P2-R1-T1).

erp_user 동기화(test_erp_sync.py)와 동일 패턴을 erp_team/erp_position에 적용한다.
attendances/leaves는 read-through(미저장) 설계(dtos.py)라 이 파일의 범위가 아니다.
"""

from sqlalchemy import select

from app.erp.dtos import ErpPositionDTO, ErpTeamDTO
from app.erp.mock_reader import MockErpReader
from app.erp.sync import ErpSyncService
from app.models.tables import AuditLog, ErpPosition, ErpTeam


# ── sync_teams ──────────────────────────────────────────────
async def test_sync_teams_creates_rows(db_session):
    svc = ErpSyncService(db_session)
    result = await svc.sync_teams(MockErpReader(), company_id=1)
    assert result.created == 2
    assert result.updated == 0

    rows = (await db_session.execute(select(ErpTeam))).scalars().all()
    assert len(rows) == 2
    dev = next(r for r in rows if r.id == 1)
    assert dev.name == "개발팀"
    assert dev.color == "#2563eb"
    assert dev.leader_name == "김리더"
    assert dev.is_active is True


async def test_sync_teams_is_idempotent(db_session):
    svc = ErpSyncService(db_session)
    await svc.sync_teams(MockErpReader(), company_id=1)
    result2 = await svc.sync_teams(MockErpReader(), company_id=1)
    assert result2.created == 0
    assert result2.updated == 2
    rows = (await db_session.execute(select(ErpTeam))).scalars().all()
    assert len(rows) == 2  # 중복 생성 없음


async def test_sync_teams_updates_changed_fields(db_session):
    svc = ErpSyncService(db_session)
    await svc.sync_teams(MockErpReader(), company_id=1)

    changed = [
        ErpTeamDTO(id=1, company_id=1, name="개발팀(리브랜딩)", color="#111111", leader_name="신규리더"),
        ErpTeamDTO(id=2, company_id=1, name="디자인팀", color="#db2777", leader_name="박리더"),
    ]
    await svc.sync_teams(MockErpReader(teams=changed), company_id=1)
    row = (await db_session.execute(select(ErpTeam).where(ErpTeam.id == 1))).scalar_one()
    assert row.name == "개발팀(리브랜딩)"
    assert row.color == "#111111"
    assert row.leader_name == "신규리더"


async def test_sync_teams_soft_deletes_missing_team(db_session):
    svc = ErpSyncService(db_session)
    await svc.sync_teams(MockErpReader(), company_id=1)

    reduced = [t for t in MockErpReader()._teams if t.id != 2]
    result = await svc.sync_teams(MockErpReader(teams=reduced), company_id=1)
    assert result.deactivated == 1

    gone = (await db_session.execute(select(ErpTeam).where(ErpTeam.id == 2))).scalar_one()
    assert gone.is_active is False  # 물리삭제 아님

    logs = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.action == "erp_team_soft_deleted")
        )
    ).scalars().all()
    assert len(logs) == 1
    assert logs[0].entity_type == "erp_team"
    assert logs[0].entity_id == "2"
    assert logs[0].old_value == {"is_active": True}
    assert logs[0].new_value == {"is_active": False}


async def test_sync_teams_company_scope_isolation(db_session):
    svc = ErpSyncService(db_session)
    other_company_team = [
        ErpTeamDTO(id=10, company_id=2, name="타사팀", color="#000000", leader_name=None)
    ]
    await svc.sync_teams(MockErpReader(teams=other_company_team), company_id=2)
    await svc.sync_teams(MockErpReader(), company_id=1)

    rows_company_1 = (
        await db_session.execute(select(ErpTeam).where(ErpTeam.company_id == 1))
    ).scalars().all()
    assert len(rows_company_1) == 2
    rows_company_2 = (
        await db_session.execute(select(ErpTeam).where(ErpTeam.company_id == 2))
    ).scalars().all()
    assert len(rows_company_2) == 1
    assert rows_company_2[0].id == 10


# ── sync_positions ──────────────────────────────────────────
async def test_sync_positions_creates_rows(db_session):
    svc = ErpSyncService(db_session)
    result = await svc.sync_positions(MockErpReader(), company_id=1)
    assert result.created == 3
    assert result.updated == 0

    rows = (await db_session.execute(select(ErpPosition))).scalars().all()
    assert len(rows) == 3
    leader_pos = next(r for r in rows if r.id == 2)
    assert leader_pos.name == "팀장"
    assert leader_pos.level == 3
    assert leader_pos.is_active is True


async def test_sync_positions_is_idempotent(db_session):
    svc = ErpSyncService(db_session)
    await svc.sync_positions(MockErpReader(), company_id=1)
    result2 = await svc.sync_positions(MockErpReader(), company_id=1)
    assert result2.created == 0
    assert result2.updated == 3
    rows = (await db_session.execute(select(ErpPosition))).scalars().all()
    assert len(rows) == 3  # 중복 생성 없음


async def test_sync_positions_updates_changed_fields(db_session):
    svc = ErpSyncService(db_session)
    await svc.sync_positions(MockErpReader(), company_id=1)

    changed = [
        ErpPositionDTO(id=1, company_id=1, name="사원", level=1, is_active=True),
        ErpPositionDTO(id=2, company_id=1, name="수석팀장", level=4, is_active=True),
        ErpPositionDTO(id=3, company_id=1, name="대표", level=9, is_active=True),
    ]
    await svc.sync_positions(MockErpReader(positions=changed), company_id=1)
    row = (await db_session.execute(select(ErpPosition).where(ErpPosition.id == 2))).scalar_one()
    assert row.name == "수석팀장"
    assert row.level == 4


async def test_sync_positions_soft_deletes_missing_position(db_session):
    svc = ErpSyncService(db_session)
    await svc.sync_positions(MockErpReader(), company_id=1)

    reduced = [p for p in MockErpReader()._positions if p.id != 3]
    result = await svc.sync_positions(MockErpReader(positions=reduced), company_id=1)
    assert result.deactivated == 1

    gone = (await db_session.execute(select(ErpPosition).where(ErpPosition.id == 3))).scalar_one()
    assert gone.is_active is False  # 물리삭제 아님

    logs = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.action == "erp_position_soft_deleted")
        )
    ).scalars().all()
    assert len(logs) == 1
    assert logs[0].entity_type == "erp_position"
    assert logs[0].entity_id == "3"


async def test_sync_positions_company_scope_isolation(db_session):
    svc = ErpSyncService(db_session)
    other_company_position = [
        ErpPositionDTO(id=20, company_id=2, name="타사직급", level=1, is_active=True)
    ]
    await svc.sync_positions(MockErpReader(positions=other_company_position), company_id=2)
    await svc.sync_positions(MockErpReader(), company_id=1)

    rows_company_1 = (
        await db_session.execute(select(ErpPosition).where(ErpPosition.company_id == 1))
    ).scalars().all()
    assert len(rows_company_1) == 3
    rows_company_2 = (
        await db_session.execute(select(ErpPosition).where(ErpPosition.company_id == 2))
    ).scalars().all()
    assert len(rows_company_2) == 1
    assert rows_company_2[0].id == 20


# ── 스케줄러 배선: erp_incremental_sync가 teams/positions 미러도 채움 ──
async def test_scheduler_incremental_sync_populates_team_and_position_mirrors(db_session):
    """architect MEDIUM(배선 미검증) 해소: 스케줄러 erp_incremental_sync 모듈 함수가
    users뿐 아니라 teams/positions 미러도 채우는지 검증(배선 삭제 시 실패해야 함)."""
    from app.services.scheduler import erp_incremental_sync

    await erp_incremental_sync(db_session, MockErpReader(), company_id=1)

    teams = (await db_session.execute(select(ErpTeam))).scalars().all()
    positions = (await db_session.execute(select(ErpPosition))).scalars().all()
    assert len(teams) == 2
    assert len(positions) >= 1


# ── 엔드포인트 배선: POST /sync/erp가 teams/positions 미러도 채움 ──
async def test_sync_erp_trigger_populates_team_position_mirrors(
    async_client, db_session, admin_auth_headers
):
    """architect LOW(엔드포인트-경로 미직접검증) 해소: 정본 관리자 트리거 /sync/erp가
    users뿐 아니라 teams/positions 미러도 채우는지 직접 검증."""
    r = await async_client.post("/sync/erp", headers=admin_auth_headers)
    assert r.status_code == 202, r.text

    teams = (await db_session.execute(select(ErpTeam))).scalars().all()
    positions = (await db_session.execute(select(ErpPosition))).scalars().all()
    assert len(teams) == 2
    assert len(positions) >= 1
