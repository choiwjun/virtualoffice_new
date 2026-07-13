# @TASK A3-11/A3-12 - 모델 제약·self-FK relationship 동작 검증
# @SPEC docs/planning/04-data-model.md

"""
tables.py 모델 동작 검증:

- A3-12: self-FK relationship 방향 (ErpUser.manager / OrgGroup.parent 가
  스칼라 many-to-one, 컬렉션이 one-to-many로 실제 로드되는지)
- A3-11: CHECK 제약 (ck_assignment_dates / ck_uth_dates / ck_kpi_value_nonnegative
  / ck_meeting_times) + 좌석 배타성 부분 unique(uk_current_seat)
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.models.tables import (
    ErpUser,
    KpiPeriodType,
    KpiResult,
    Meeting,
    MeetingStatus,
    Office,
    OrgGroup,
    OrgGroupType,
    Room,
    RoomType,
    Floor,
    Seat,
    SeatAssignmentHistory,
    SeatStatus,
    SeatType,
    UserTeamHistory,
)

UTC_NOW = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)


def _make_user(user_id: int, manager_id: int | None = None) -> ErpUser:
    return ErpUser(
        id=user_id,
        company_id=1,
        email=f"user{user_id}@example.com",
        name=f"User {user_id}",
        erp_team_id=1,
        manager_id=manager_id,
    )


async def _seed_office_floor(session):
    office = Office(company_id=1, name="본사")
    session.add(office)
    await session.flush()
    floor = Floor(office_id=office.id, level=1, name="1F")
    session.add(floor)
    await session.flush()
    return office, floor


# ── A3-12: self-FK relationship 방향 ──────────────────────


async def test_erp_user_manager_self_fk_direction(db_session):
    """manager(스칼라) → 상급자, managed_users(컬렉션) → 부하 방향으로 로드돼야 한다."""
    boss = _make_user(1)
    report = _make_user(2, manager_id=1)
    db_session.add_all([boss, report])
    await db_session.commit()

    # 관계 캐시 없이 eager-load로 재로드 (async lazy-load 회피)
    db_session.expire_all()
    rows = (
        await db_session.execute(
            select(ErpUser)
            .options(selectinload(ErpUser.manager), selectinload(ErpUser.managed_users))
            .order_by(ErpUser.id)
        )
    ).scalars().all()
    loaded_boss, loaded_report = rows

    assert loaded_report.manager is not None and loaded_report.manager.id == 1
    assert [u.id for u in loaded_boss.managed_users] == [2]

    # 역방향: boss.manager 없음, report.managed_users 없음
    assert loaded_boss.manager is None
    assert loaded_report.managed_users == []


async def test_org_group_parent_self_fk_direction(db_session):
    """parent(스칼라) → 상위 조직, children(컬렉션) → 하위 조직 방향으로 로드돼야 한다."""
    company = 1  # 04 §2.2: INTEGER (erp_user.company_id 동일 타입)
    root = OrgGroup(company_id=company, name="본부", type=OrgGroupType.DIVISION)
    db_session.add(root)
    await db_session.flush()
    child = OrgGroup(
        company_id=company, name="부서", type=OrgGroupType.DEPARTMENT, parent_id=root.id
    )
    db_session.add(child)
    await db_session.commit()

    db_session.expire_all()
    rows = (
        await db_session.execute(
            select(OrgGroup).options(
                selectinload(OrgGroup.parent), selectinload(OrgGroup.children)
            )
        )
    ).scalars().all()
    by_id = {g.id: g for g in rows}
    loaded_root, loaded_child = by_id[root.id], by_id[child.id]

    assert loaded_child.parent is not None and loaded_child.parent.id == root.id
    assert [c.id for c in loaded_root.children] == [child.id]
    assert loaded_root.parent is None


# ── A3-11: CHECK 제약 ─────────────────────────────────────


async def test_ck_uth_dates_rejects_inverted_range(db_session):
    db_session.add(_make_user(1))
    await db_session.flush()

    db_session.add(
        UserTeamHistory(
            user_id=1,
            erp_team_id=1,
            valid_from=UTC_NOW,
            valid_to=UTC_NOW - timedelta(days=1),  # valid_to < valid_from → 위반
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_ck_kpi_value_nonnegative(db_session):
    db_session.add(_make_user(1))
    await db_session.flush()

    db_session.add(
        KpiResult(
            user_id=1,
            period_type=KpiPeriodType.DAILY,
            period_key="2026-07-01",
            metric="work_completed_count",
            value=Decimal("-1.00"),  # 음수 → 위반
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_ck_assignment_dates_and_uk_current_seat(db_session):
    _, floor = await _seed_office_floor(db_session)
    db_session.add_all([_make_user(1), _make_user(2)])
    seat = Seat(
        floor_id=floor.id,
        type=SeatType.FIXED,
        coords={"x": 1.0, "y": 2.0, "facing": 0},
        status=SeatStatus.AVAILABLE,
    )
    db_session.add(seat)
    await db_session.flush()

    # (1) unassigned_at < assigned_at → ck_assignment_dates 위반
    db_session.add(
        SeatAssignmentHistory(
            seat_id=seat.id,
            user_id=1,
            assigned_at=UTC_NOW,
            unassigned_at=UTC_NOW - timedelta(hours=1),
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()

    # (2) 현재 배정(unassigned_at IS NULL)은 좌석당 1건 — 부분 unique
    _, floor = await _seed_office_floor(db_session)
    db_session.add_all([_make_user(1), _make_user(2)])
    seat = Seat(
        floor_id=floor.id,
        type=SeatType.FIXED,
        coords={"x": 1.0, "y": 2.0, "facing": 0},
        status=SeatStatus.AVAILABLE,
    )
    db_session.add(seat)
    await db_session.flush()

    # 과거 배정(종료됨) + 현재 배정 1건 → OK
    db_session.add(
        SeatAssignmentHistory(
            seat_id=seat.id, user_id=1,
            assigned_at=UTC_NOW - timedelta(days=2),
            unassigned_at=UTC_NOW - timedelta(days=1),
        )
    )
    db_session.add(
        SeatAssignmentHistory(seat_id=seat.id, user_id=1, assigned_at=UTC_NOW)
    )
    await db_session.flush()

    # 두 번째 "현재" 배정 → uk_current_seat 위반
    db_session.add(
        SeatAssignmentHistory(seat_id=seat.id, user_id=2, assigned_at=UTC_NOW)
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_ck_meeting_times_rejects_end_before_start(db_session):
    _, floor = await _seed_office_floor(db_session)
    db_session.add(_make_user(1))
    room = Room(
        floor_id=floor.id,
        type=RoomType.MEETING,
        name="회의실 A",
        capacity=6,
        coords={"x": 0.0, "y": 0.0, "width": 4.0, "height": 3.0},
    )
    db_session.add(room)
    await db_session.flush()

    db_session.add(
        Meeting(
            room_id=room.id,
            host_user_id=1,
            title="테스트 회의",
            scheduled_at=UTC_NOW,
            started_at=UTC_NOW,
            ended_at=UTC_NOW - timedelta(minutes=30),  # 종료 < 시작 → 위반
            status=MeetingStatus.COMPLETED,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()
