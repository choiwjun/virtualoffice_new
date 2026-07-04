"""
Presence 좌표 파기 배치(D20-a) 단위 테스트 (G002).

@SPEC docs/planning/00-decisions.md D20-a(presence 좌표 30일 파기)
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.tables import ErpRole, ErpUser, Floor, Office, Presence, PresenceStatus
from app.services.scheduler import presence_coordinate_purge


async def _seed_floor(db_session):
    office = Office(id=uuid4(), company_id=uuid4(), name="Purge HQ")
    db_session.add(office)
    await db_session.flush()
    floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1F")
    db_session.add(floor)
    await db_session.flush()
    await db_session.commit()
    return office.id, floor.id


async def _seed_user(db_session, user_id: int) -> None:
    db_session.add(
        ErpUser(
            id=user_id,
            company_id=1,
            email=f"purge-{user_id}@example.com",
            name=f"Purge User {user_id}",
            erp_team_id=1,
            role=ErpRole.EMPLOYEE,
            is_active=True,
        )
    )
    await db_session.commit()


async def _seed_presence(db_session, user_id, office_id, floor_id, updated_at) -> None:
    p = Presence(
        user_id=user_id,
        office_id=office_id,
        floor_id=floor_id,
        x=0.0,
        y=0.0,
        z=0.0,
        status=PresenceStatus.ONLINE,
    )
    db_session.add(p)
    await db_session.flush()
    # updated_at has onupdate=now() default; overwrite directly via update to simulate stale rows.
    await db_session.execute(
        Presence.__table__.update().where(Presence.user_id == user_id).values(updated_at=updated_at)
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_purge_deletes_rows_older_than_30_days_and_keeps_fresh(db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    await _seed_user(db_session, 2)

    now = datetime(2026, 7, 4, tzinfo=timezone.utc)
    stale_at = now - timedelta(days=31)
    fresh_at = now - timedelta(days=1)

    await _seed_presence(db_session, 1, office_id, floor_id, stale_at)
    await _seed_presence(db_session, 2, office_id, floor_id, fresh_at)

    deleted = await presence_coordinate_purge(db_session, now=now)
    await db_session.commit()
    assert deleted == 1

    rows = (await db_session.execute(select(Presence))).scalars().all()
    assert [r.user_id for r in rows] == [2]


@pytest.mark.asyncio
async def test_purge_is_idempotent_second_run_deletes_zero(db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)

    now = datetime(2026, 7, 4, tzinfo=timezone.utc)
    stale_at = now - timedelta(days=45)
    await _seed_presence(db_session, 1, office_id, floor_id, stale_at)

    first = await presence_coordinate_purge(db_session, now=now)
    await db_session.commit()
    assert first == 1

    second = await presence_coordinate_purge(db_session, now=now)
    await db_session.commit()
    assert second == 0


@pytest.mark.asyncio
async def test_purge_no_stale_rows_deletes_nothing(db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    now = datetime(2026, 7, 4, tzinfo=timezone.utc)
    await _seed_presence(db_session, 1, office_id, floor_id, now - timedelta(days=1))

    deleted = await presence_coordinate_purge(db_session, now=now)
    assert deleted == 0


@pytest.mark.asyncio
async def test_purge_defaults_now_to_utc_when_not_provided(db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    stale_at = datetime.now(timezone.utc) - timedelta(days=40)
    await _seed_presence(db_session, 1, office_id, floor_id, stale_at)

    deleted = await presence_coordinate_purge(db_session)
    await db_session.commit()
    assert deleted == 1
