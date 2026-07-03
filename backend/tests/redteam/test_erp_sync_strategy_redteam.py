"""
ERP 동기화 전략(증분/전체 대사 + soft-delete, D18) 적대적(red-team) 테스트.

목적: erp_incremental_sync / erp_full_reconciliation (ErpSyncService.sync_users 재사용)의
soft-delete·company 스코프·FK 보존·재실행 안전을 깨뜨리는 것을 목표로 한다. 하드삭제/캐스케이드/
스코프 누수/중복 비활성화가 없어야 한다.

@SPEC docs/planning/00-decisions.md D18, docs/erp-integration/contract.md §1.3/§1.4
@SPEC app/erp/sync.py, app/services/scheduler.py
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.erp.dtos import ErpUserDTO
from app.erp.mock_reader import MockErpReader
from app.models.tables import (
    ErpRole,
    ErpUser,
    KpiPeriodType,
    KpiResult,
    KpiSource,
    WorkLog,
    WorkLogStatus,
)
from app.services.scheduler import erp_full_reconciliation, erp_incremental_sync

pytestmark = pytest.mark.asyncio


def _dto(uid: int, company_id: int = 1, active: bool = True) -> ErpUserDTO:
    return ErpUserDTO(
        id=uid, company_id=company_id, email=f"u{uid}@c{company_id}.com", name=f"User {uid}",
        team_id=1, role="employee", position="사원", position_id=1,
        manager_id=None, default_work_type="office", default_work_hours=8, is_active=active,
    )


async def test_full_reconciliation_empty_reader_soft_deletes_all_active(
    db_session: AsyncSession,
):
    """ERP가 전원 사라진 극단 상황: 전체 대사 시 활성 사용자 전원 soft-delete(행은 보존)."""
    seeded = await erp_incremental_sync(db_session, MockErpReader(users=[_dto(1), _dto(2)]), company_id=1)
    assert seeded.created == 2

    r = await erp_full_reconciliation(db_session, MockErpReader(users=[]), company_id=1)
    assert r.deactivated == 2, "빈 리더에서 활성 사용자 전원 soft-delete 미동작"
    rows = (await db_session.execute(select(ErpUser).where(ErpUser.company_id == 1))).scalars().all()
    assert len(rows) == 2, "soft-delete가 아니라 하드삭제(행 소멸)"
    assert all(u.is_active is False for u in rows)


async def test_sync_company_scope_isolation(db_session: AsyncSession):
    """company 1 동기화가 company 2 사용자를 soft-delete하지 않는다(스코프 누수 방지)."""
    # company 2 사용자 사전 존재(동기화 대상 아님)
    db_session.add(
        ErpUser(id=99, company_id=2, email="other@c2.com", name="타사", erp_team_id=1,
                role=ErpRole.EMPLOYEE, is_active=True)
    )
    await db_session.commit()

    # company 1만 동기화(리더에 company 2 없음)
    await erp_incremental_sync(db_session, MockErpReader(users=[_dto(1)]), company_id=1)
    await erp_full_reconciliation(db_session, MockErpReader(users=[_dto(1)]), company_id=1)

    other = await db_session.get(ErpUser, 99)
    assert other is not None and other.is_active is True, "타 company 사용자가 부당하게 soft-delete됨"


async def test_soft_delete_preserves_fk_referenced_rows(db_session: AsyncSession):
    """soft-delete(UPDATE) 시 참조 행 보존(D18): 소프트삭제는 하드 DELETE가 아니므로 사용자를 참조하는
    평가 근거(work_log/kpi_result)를 지우지 않는다. 모델 FK는 ondelete=RESTRICT(D18 정합)이나
    SQLite 테스트는 FK 미강제라, 이 테스트는 'soft-delete=UPDATE라 캐스케이드 자체가 없음 + 하드삭제
    회귀 부재(u1 행 보존)'를 검증한다."""
    await erp_incremental_sync(db_session, MockErpReader(users=[_dto(1)]), company_id=1)
    # user 1을 참조하는 평가 근거(work_log, kpi_result) 생성
    db_session.add_all([
        WorkLog(user_id=1, work_date=date(2026, 7, 10), title="업무",
                status=WorkLogStatus.COMPLETED),
        KpiResult(user_id=1, period_type=KpiPeriodType.QUARTERLY, period_key="2026-Q3",
                  metric="work_completed_count", value=Decimal("1"), source=KpiSource.VIRTUAL_OFFICE),
    ])
    await db_session.commit()

    # ERP에서 user 1 사라짐 → soft-delete
    r = await erp_full_reconciliation(db_session, MockErpReader(users=[]), company_id=1)
    assert r.deactivated == 1

    u1 = await db_session.get(ErpUser, 1)
    assert u1 is not None and u1.is_active is False, "참조되는 사용자 soft-delete 미동작"
    # 참조 행(평가 근거)은 캐스케이드 없이 보존(D18 영구성)
    wl = (await db_session.execute(select(WorkLog).where(WorkLog.user_id == 1))).scalars().all()
    kr = (await db_session.execute(select(KpiResult).where(KpiResult.user_id == 1))).scalars().all()
    assert len(wl) == 1, "soft-delete가 work_log를 캐스케이드 삭제함"
    assert len(kr) == 1, "soft-delete가 kpi_result를 캐스케이드 삭제함"


async def test_already_inactive_user_not_recounted(db_session: AsyncSession):
    """이미 비활성인 사용자는 재대사에서 다시 deactivated로 집계되지 않는다(멱등)."""
    await erp_incremental_sync(db_session, MockErpReader(users=[_dto(1)]), company_id=1)
    r1 = await erp_full_reconciliation(db_session, MockErpReader(users=[]), company_id=1)
    assert r1.deactivated == 1
    r2 = await erp_full_reconciliation(db_session, MockErpReader(users=[]), company_id=1)
    assert r2.deactivated == 0, "이미 비활성 사용자가 재대사에서 중복 집계됨"


async def test_incremental_and_full_share_softdelete_semantics(db_session: AsyncSession):
    """증분·전체 대사 모두 sync_users 재사용 → 동일 soft-delete 시맨틱(주기만 다름)."""
    await erp_incremental_sync(db_session, MockErpReader(users=[_dto(1), _dto(2)]), company_id=1)
    # 증분도 company 전체 행을 대조하므로 사라진 사용자를 soft-delete한다
    r = await erp_incremental_sync(db_session, MockErpReader(users=[_dto(1)]), company_id=1)
    assert r.deactivated == 1
    u2 = await db_session.get(ErpUser, 2)
    assert u2 is not None and u2.is_active is False


async def test_soft_delete_writes_audit_log(db_session: AsyncSession):
    """soft-delete는 감사 로그(erp_user_soft_deleted)를 남긴다(D18/contract §1.3 감사 추적)."""
    from app.models.tables import AuditLog

    await erp_incremental_sync(db_session, MockErpReader(users=[_dto(1), _dto(2)]), company_id=1)
    await erp_full_reconciliation(db_session, MockErpReader(users=[_dto(1)]), company_id=1)

    logs = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.action == "erp_user_soft_deleted")
        )
    ).scalars().all()
    assert len(logs) == 1, "soft-delete 감사 로그 미생성"
    log = logs[0]
    assert log.entity_type == "erp_user"
    assert log.entity_id == "2"
    assert log.old_value == {"is_active": True}
    assert log.new_value == {"is_active": False}
