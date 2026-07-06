"""
ERP read-only 동기화 + 리더 어댑터 통합테스트 (목 기반, G003).

커버리지:
  - 팩토리 소스 선택 (mock / postgres lazy)
  - 최초 동기화(insert) + user_team_history 초기 기록
  - 증분(update): 필드 변경 반영
  - soft-delete: ERP에서 사라진 사용자 is_active=False
  - 재실행 멱등성: 중복 없음
  - 팀 이동 이력: erp_team_id 변경 시 user_team_history 닫고 새 이력
  - 알 수 없는 role → EMPLOYEE 폴백
  - org_groups: mock fetch_org_groups 데이터 확인
  - services.erp_sync 공개 API 접근 가능성

실 DB 연결 불가는 정상 — mock으로 전체 로직 검증.
PostgresErpReader 인스턴스 생성은 lazy engine으로 asyncpg 없이도 성공.
"""

from datetime import date

import pytest
from sqlalchemy import select

from app.erp.dtos import ErpUserDTO
from app.erp.mock_reader import MockErpReader, MockErpSource
from app.erp.reader import ErpSource, get_erp_reader
from app.erp.sync import ErpSyncService
from app.models.tables import ErpRole, ErpUser, UserTeamHistory


# ─────────────────────────────────────────────────────────
# 팩토리: 설정 기반 리더 선택
# ─────────────────────────────────────────────────────────

def test_factory_selects_mock_when_no_url():
    from app.erp.mock_reader import MockErpReader as M
    assert isinstance(get_erp_reader(""), M)


def test_factory_selects_postgres_when_url_given():
    """PostgresErpReader: lazy engine → asyncpg 없는 환경에서도 인스턴스 생성 성공."""
    from app.erp.postgres_reader import PostgresErpReader
    reader = get_erp_reader("postgresql+asyncpg://u:p@localhost:5432/dailylog")
    assert isinstance(reader, PostgresErpReader)
    # 실제 연결 안 함 — asyncpg 없어도 여기까지는 OK (lazy engine)


# ─────────────────────────────────────────────────────────
# 공개 서비스 레이어 접근 가능성
# ─────────────────────────────────────────────────────────

def test_services_erp_sync_public_api():
    """services.erp_sync 공개 이름이 정상 임포트된다."""
    from app.services.erp_sync import (
        ErpSource,
        ErpSyncService as Svc,
        MockErpSource,
        SyncResult,
        get_erp_source,
    )
    assert issubclass(MockErpSource, ErpSource)
    src = get_erp_source("")
    assert isinstance(src, MockErpSource)


# ─────────────────────────────────────────────────────────
# Mock 리더
# ─────────────────────────────────────────────────────────

async def test_mock_reader_company_scope():
    reader = MockErpReader()
    assert len(await reader.fetch_users(1)) == 5
    assert await reader.fetch_users(999) == []
    assert len(await reader.fetch_teams(1)) == 2
    assert len(await reader.fetch_positions(1)) == 3


async def test_mock_reader_org_groups():
    reader = MockErpReader()
    groups = await reader.fetch_org_groups(1)
    assert len(groups) == 2
    assert await reader.fetch_org_groups(999) == []
    # 타입 검증
    types = {g.type for g in groups}
    assert types <= {"division", "department", "part"}


async def test_mock_reader_read_through_attendances_leaves():
    reader = MockErpReader()
    d = date(2026, 7, 1)
    att = await reader.fetch_attendances(1, d, d)
    assert len(att) == 5 and att[0].work_type in ("office", "remote")
    leaves = await reader.fetch_leaves(1, d, d)
    assert len(leaves) == 1 and leaves[0].status == "approved"


# ─────────────────────────────────────────────────────────
# 동기화 → erp_user (최초 삽입)
# ─────────────────────────────────────────────────────────

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


async def test_sync_creates_initial_team_history(db_session):
    """최초 동기화 시 user_team_history 초기 이력 생성."""
    svc = ErpSyncService(db_session)
    await svc.sync_users(MockErpReader(), company_id=1)

    histories = (await db_session.execute(select(UserTeamHistory))).scalars().all()
    # 5명 각각 초기 이력 1건
    assert len(histories) == 5

    # 모든 이력은 열려 있어야 함 (valid_to IS NULL)
    assert all(h.valid_to is None for h in histories)

    # 개발팀(team_id=1) 소속 user 2, 3 확인
    dev_histories = [h for h in histories if h.erp_team_id == 1]
    assert len(dev_histories) == 2


# ─────────────────────────────────────────────────────────
# 멱등성: 재실행
# ─────────────────────────────────────────────────────────

async def test_sync_is_idempotent(db_session):
    svc = ErpSyncService(db_session)
    await svc.sync_users(MockErpReader(), company_id=1)
    result2 = await svc.sync_users(MockErpReader(), company_id=1)
    assert result2.created == 0
    assert result2.updated == 5
    rows = (await db_session.execute(select(ErpUser))).scalars().all()
    assert len(rows) == 5  # 중복 생성 없음


async def test_sync_idempotent_no_duplicate_history(db_session):
    """재실행 시 팀 변경 없으면 user_team_history 중복 생성 안 함."""
    svc = ErpSyncService(db_session)
    await svc.sync_users(MockErpReader(), company_id=1)
    await svc.sync_users(MockErpReader(), company_id=1)

    histories = (await db_session.execute(select(UserTeamHistory))).scalars().all()
    # 여전히 5건 (팀 이동 없음)
    assert len(histories) == 5
    assert all(h.valid_to is None for h in histories)


# ─────────────────────────────────────────────────────────
# 증분: 필드 변경 반영
# ─────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────
# 팀 이동 이력 (user_team_history)
# ─────────────────────────────────────────────────────────

async def test_sync_records_team_movement(db_session):
    """팀 이동 감지 시 이전 이력 닫고 새 이력 열기."""
    svc = ErpSyncService(db_session)
    # 1차: user 3 = 개발팀(1)
    await svc.sync_users(MockErpReader(), company_id=1)

    # user 3을 디자인팀(2)으로 이동
    moved = [
        ErpUserDTO(id=3, company_id=1, email="dev1@example.com", name="이개발",
                   team_id=2, role="employee", position="사원", position_id=1,
                   manager_id=4, default_work_type="office", default_work_hours=8, is_active=True)
    ]
    result = await svc.sync_users(MockErpReader(users=moved), company_id=1)
    assert result.team_moves == 1

    histories = (
        await db_session.execute(
            select(UserTeamHistory)
            .where(UserTeamHistory.user_id == 3)
            .order_by(UserTeamHistory.valid_from)
        )
    ).scalars().all()

    assert len(histories) == 2
    # 첫 번째 이력: 개발팀, 닫혀 있음
    assert histories[0].erp_team_id == 1
    assert histories[0].valid_to is not None
    # 두 번째 이력: 디자인팀, 열려 있음
    assert histories[1].erp_team_id == 2
    assert histories[1].valid_to is None


async def test_sync_team_history_no_spurious_close_on_no_change(db_session):
    """팀 변경 없으면 열린 이력 닫지 않는다."""
    svc = ErpSyncService(db_session)
    await svc.sync_users(MockErpReader(), company_id=1)

    # 이름만 바꾸고 팀 유지
    same_team = [
        ErpUserDTO(id=2, company_id=1, email="dev.lead@example.com", name="김리더(개명)",
                   team_id=1, role="leader", position="팀장", position_id=2,
                   manager_id=1, default_work_type="office", default_work_hours=8, is_active=True)
    ]
    result = await svc.sync_users(MockErpReader(users=same_team), company_id=1)
    assert result.team_moves == 0

    histories = (
        await db_session.execute(
            select(UserTeamHistory).where(UserTeamHistory.user_id == 2)
        )
    ).scalars().all()
    assert len(histories) == 1
    assert histories[0].valid_to is None  # 이력 닫히지 않음


# ─────────────────────────────────────────────────────────
# soft-delete: ERP에서 사라진 사용자
# ─────────────────────────────────────────────────────────

async def test_sync_soft_deletes_missing_user(db_session):
    svc = ErpSyncService(db_session)
    await svc.sync_users(MockErpReader(), company_id=1)

    # id=5 제거된 ERP 상태로 재동기화
    reduced = [u for u in MockErpReader()._users if u.id != 5]
    result = await svc.sync_users(MockErpReader(users=reduced), company_id=1)
    assert result.deactivated == 1

    gone = (await db_session.execute(select(ErpUser).where(ErpUser.id == 5))).scalar_one()
    assert gone.is_active is False  # 물리삭제 아님(평가 기록 영구성)


# ─────────────────────────────────────────────────────────
# 역할 폴백
# ─────────────────────────────────────────────────────────

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
