"""
G003 architect HIGH 회귀 방지: org_group 삭제 시 team_zone.org_group_id RESTRICT FK로
매핑된 team_zone이 있으면 409(org_group_in_use). 운영 Postgres에서 미처리 500 방지.

전역 conftest의 SQLite 엔진은 PRAGMA foreign_keys=ON을 걸지 않아 RESTRICT/SET NULL이
무시된다(false green). 이 테스트는 FK 강제 엔진을 별도로 띄워 실제 DB 동작을 검증한다.

@TASK P2-R1-T3
"""

from uuid import uuid4

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import create_access_token
from app.db import get_db
from app.main import app
from app.models.tables import (
    Base,
    Floor,
    Office,
    OrgGroup,
    OrgGroupType,
    TeamZone,
)


def _admin_headers() -> dict:
    tok = create_access_token({"sub": "3", "email": "admin@example.com", "role": "admin"})
    return {"Authorization": f"Bearer {tok}"}


@pytest_asyncio.fixture
async def fk_client():
    """PRAGMA foreign_keys=ON을 강제한 격리 in-memory 엔진 + FastAPI 오버라이드."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _record):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _override():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, session_factory
    app.dependency_overrides.clear()
    await engine.dispose()


async def _seed(session_factory):
    async with session_factory() as s:
        office = Office(id=uuid4(), company_id=uuid4(), name="HQ")
        s.add(office)
        await s.flush()
        floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1F")
        s.add(floor)
        referenced = OrgGroup(id=uuid4(), company_id=uuid4(), name="Dept-ref", type=OrgGroupType.PART)
        free = OrgGroup(id=uuid4(), company_id=uuid4(), name="Dept-free", type=OrgGroupType.PART)
        s.add_all([floor, referenced, free])
        await s.flush()
        tz = TeamZone(
            id=uuid4(),
            erp_team_id=1,
            org_group_id=referenced.id,
            office_id=office.id,
            floor_id=floor.id,
            zone_label="A",
        )
        s.add(tz)
        await s.commit()
        return str(referenced.id), str(free.id)


async def test_delete_org_group_referenced_by_team_zone_returns_409(fk_client):
    client, session_factory = fk_client
    ref_id, free_id = await _seed(session_factory)

    # 매핑된 team_zone이 있는 org_group 삭제 → RESTRICT → 409(500 아님)
    r = await client.delete(f"/org-groups/{ref_id}", headers=_admin_headers())
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "org_group_in_use"

    # 참조 없는 org_group은 정상 삭제
    r2 = await client.delete(f"/org-groups/{free_id}", headers=_admin_headers())
    assert r2.status_code == 200, r2.text
    assert r2.json()["deleted"] is True
