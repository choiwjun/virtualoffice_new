"""
ERP read-only 동기화 + 리더 어댑터 테스트 (목 기반).

실 DB 전환 후에도 이 테스트는 그대로 유효 — 로직이 소스에 무관하므로.
"""

from datetime import date

import pytest
from sqlalchemy import select

from app.erp.dtos import ErpUserDTO
from app.erp.mock_reader import MockErpReader
from app.erp.reader import get_erp_reader
from app.erp.sync import ErpSyncService
from app.models.tables import ErpRole, ErpUser


# ── 팩토리: 설정 기반 리더 선택 ───────────────────────────
def test_factory_selects_mock_when_no_url():
    from app.erp.mock_reader import MockErpReader as M
    assert isinstance(get_erp_reader(""), M)


def test_factory_selects_postgres_when_url_given():
    from app.erp.postgres_reader import PostgresErpReader
    reader = get_erp_reader("postgresql+asyncpg://u:p@localhost:5432/dailylog")
    assert isinstance(reader, PostgresErpReader)  # 엔진 생성만, 연결 안 함


# ── Mock 리더 ─────────────────────────────────────────────
async def test_mock_reader_company_scope():
    reader = MockErpReader()
    assert len(await reader.fetch_users(1)) == 5
    assert await reader.fetch_users(999) == []
    assert len(await reader.fetch_teams(1)) == 2
    assert len(await reader.fetch_positions(1)) == 3


async def test_mock_reader_read_through_attendances_leaves():
    reader = MockErpReader()
    d = date(2026, 7, 1)
    att = await reader.fetch_attendances(1, d, d)
    assert len(att) == 5 and att[0].work_type in ("office", "remote")
    leaves = await reader.fetch_leaves(1, d, d)
    assert len(leaves) == 1 and leaves[0].status == "approved"


# ── 동기화 → erp_user ─────────────────────────────────────
async def test_sync_creates_users(db_session):
    svc = ErpSyncService(db_session)
    result = await svc.sync_users(MockErpReader(), company_id=1)
    assert result.created == 5
    assert result.updated == 0

    rows = (await db_session.execute(select(ErpUser))).scalars().all()
    assert len(rows) == 5
    ceo = next(r for r in rows if r.id == 1)
    assert ceo.role == ErpRole.SUPER_ADMIN
    assert ceo.work_hours == 480  # 8h → 분 환산


async def test_sync_is_idempotent(db_session):
    svc = ErpSyncService(db_session)
    await svc.sync_users(MockErpReader(), company_id=1)
    result2 = await svc.sync_users(MockErpReader(), company_id=1)
    assert result2.created == 0
    assert result2.updated == 5
    rows = (await db_session.execute(select(ErpUser))).scalars().all()
    assert len(rows) == 5  # 중복 생성 없음


async def test_sync_soft_deletes_missing_user(db_session):
    svc = ErpSyncService(db_session)
    await svc.sync_users(MockErpReader(), company_id=1)

    # id=5 제거된 ERP 상태로 재동기화
    reduced = [u for u in MockErpReader()._users if u.id != 5]
    result = await svc.sync_users(MockErpReader(users=reduced), company_id=1)
    assert result.deactivated == 1

    gone = (await db_session.execute(select(ErpUser).where(ErpUser.id == 5))).scalar_one()
    assert gone.is_active is False  # 물리삭제 아님(평가 기록 영구성)


async def test_sync_updates_changed_fields(db_session):
    svc = ErpSyncService(db_session)
    await svc.sync_users(MockErpReader(), company_id=1)

    changed = [
        ErpUserDTO(id=3, company_id=1, email="dev1@example.com", name="이개발(승진)",
                   team_id=1, role="leader", position="팀장", position_id=2,
                   manager_id=2, default_work_type="office", default_work_hours=8, is_active=True)
    ]
    await svc.sync_users(MockErpReader(users=changed), company_id=1)
    row = (await db_session.execute(select(ErpUser).where(ErpUser.id == 3))).scalar_one()
    assert row.name == "이개발(승진)"
    assert row.role == ErpRole.LEADER


async def test_sync_unknown_role_falls_back_to_employee(db_session):
    svc = ErpSyncService(db_session)
    weird = [
        ErpUserDTO(id=99, company_id=1, email="x@example.com", name="미래직급",
                   team_id=1, role="cosmic_overlord", position=None, position_id=None,
                   manager_id=None, default_work_type="office", default_work_hours=8, is_active=True)
    ]
    await svc.sync_users(MockErpReader(users=weird), company_id=1)
    row = (await db_session.execute(select(ErpUser).where(ErpUser.id == 99))).scalar_one()
    assert row.role == ErpRole.EMPLOYEE
