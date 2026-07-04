"""
Presence API (G002) e2e 테스트 — 업서트/상태 전환/RBAC 조회.

@SPEC docs/planning/00-decisions.md D13(상태 7종)
@SPEC 04-data-model.md §2.4
"""

from uuid import uuid4

from sqlalchemy import select

from app.core.security import create_access_token
from app.models.tables import ErpRole, ErpUser, Floor, Office, Presence, PresenceStatus


# ── 시드 헬퍼 ─────────────────────────────────────────────
async def _seed_floor(db_session):
    office = Office(id=uuid4(), company_id=uuid4(), name="G002 HQ")
    db_session.add(office)
    await db_session.flush()
    floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1F")
    db_session.add(floor)
    await db_session.flush()
    await db_session.commit()
    return office.id, floor.id


async def _seed_user(db_session, user_id: int, erp_team_id: int = 1) -> None:
    db_session.add(
        ErpUser(
            id=user_id,
            company_id=1,
            email=f"g002-{user_id}@example.com",
            name=f"G002 User {user_id}",
            erp_team_id=erp_team_id,
            role=ErpRole.EMPLOYEE,
            is_active=True,
        )
    )
    await db_session.commit()


def _token_headers(sub: int, role: str = "employee", team_id: int | None = None) -> dict:
    claims = {"sub": str(sub), "email": f"u{sub}@example.com", "role": role}
    if team_id is not None:
        claims["team_id"] = team_id
    token = create_access_token(claims)
    return {"Authorization": f"Bearer {token}"}


def _presence_body(office_id, floor_id, status_value="online", x=1.0, y=2.0, z=3.0) -> dict:
    return {
        "office_id": str(office_id),
        "floor_id": str(floor_id),
        "x": x,
        "y": y,
        "z": z,
        "status": status_value,
    }


# ── (a) upsert: 생성 후 제자리 갱신(1행 유지) ─────────────
async def test_upsert_presence_creates_then_updates_in_place(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    headers = _token_headers(1)

    r1 = await async_client.put(
        "/presence", json=_presence_body(office_id, floor_id, "online"), headers=headers
    )
    assert r1.status_code == 200
    body1 = r1.json()
    assert body1["user_id"] == 1
    assert body1["status"] == "online"
    assert body1["last_activity_at"] is not None

    r2 = await async_client.put(
        "/presence", json=_presence_body(office_id, floor_id, "focus", x=9.0), headers=headers
    )
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["status"] == "focus"
    assert body2["x"] == 9.0

    rows = (await db_session.execute(select(Presence))).scalars().all()
    assert len(rows) == 1
    assert rows[0].status == PresenceStatus.FOCUS


async def test_upsert_presence_invalid_status_400(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    headers = _token_headers(1)
    r = await async_client.put(
        "/presence", json=_presence_body(office_id, floor_id, "not_a_status"), headers=headers
    )
    assert r.status_code == 400


# ── (b) 상태 전환 PATCH ────────────────────────────────────
async def test_patch_status_self_ok(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    headers = _token_headers(1)
    await async_client.put("/presence", json=_presence_body(office_id, floor_id), headers=headers)

    r = await async_client.patch("/presence/1/status", json={"status": "meeting"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["status"] == "meeting"


async def test_patch_status_employee_to_other_403(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    await _seed_user(db_session, 2)
    owner_headers = _token_headers(2)
    await async_client.put("/presence", json=_presence_body(office_id, floor_id), headers=owner_headers)

    other_headers = _token_headers(1)
    r = await async_client.patch("/presence/2/status", json={"status": "away"}, headers=other_headers)
    assert r.status_code == 403


async def test_patch_status_admin_to_other_ok(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    await _seed_user(db_session, 3, erp_team_id=99)
    owner_headers = _token_headers(3)
    await async_client.put("/presence", json=_presence_body(office_id, floor_id), headers=owner_headers)

    admin_headers = _token_headers(999, role="admin")
    r = await async_client.patch("/presence/3/status", json={"status": "away"}, headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "away"


async def test_patch_status_invalid_status_400(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    headers = _token_headers(1)
    await async_client.put("/presence", json=_presence_body(office_id, floor_id), headers=headers)

    r = await async_client.patch("/presence/1/status", json={"status": "bogus"}, headers=headers)
    assert r.status_code == 400


async def test_patch_status_missing_row_404(async_client, db_session):
    await _seed_user(db_session, 1)
    headers = _token_headers(1)
    r = await async_client.patch("/presence/1/status", json={"status": "away"}, headers=headers)
    assert r.status_code == 404


# ── (c) GET RBAC 스코핑 ────────────────────────────────────
async def _seed_presence_row(db_session, user_id, office_id, floor_id, status=PresenceStatus.ONLINE):
    db_session.add(
        Presence(
            user_id=user_id,
            office_id=office_id,
            floor_id=floor_id,
            x=0.0,
            y=0.0,
            z=0.0,
            status=status,
        )
    )
    await db_session.commit()


async def test_get_single_employee_self_only(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    await _seed_user(db_session, 2)
    await _seed_presence_row(db_session, 1, office_id, floor_id)
    await _seed_presence_row(db_session, 2, office_id, floor_id)

    headers = _token_headers(1)
    ok = await async_client.get("/presence/1", headers=headers)
    assert ok.status_code == 200
    forbidden = await async_client.get("/presence/2", headers=headers)
    assert forbidden.status_code == 404


async def test_get_single_leader_team_scope(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1, erp_team_id=1)  # leader's team member
    await _seed_user(db_session, 2, erp_team_id=1)
    await _seed_user(db_session, 3, erp_team_id=99)  # other team
    await _seed_presence_row(db_session, 1, office_id, floor_id)
    await _seed_presence_row(db_session, 3, office_id, floor_id)

    leader_headers = _token_headers(2, role="leader", team_id=1)
    same_team = await async_client.get("/presence/1", headers=leader_headers)
    assert same_team.status_code == 200
    other_team = await async_client.get("/presence/3", headers=leader_headers)
    assert other_team.status_code == 404


async def test_get_single_admin_sees_any(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    await _seed_presence_row(db_session, 1, office_id, floor_id)

    admin_headers = _token_headers(999, role="admin")
    r = await async_client.get("/presence/1", headers=admin_headers)
    assert r.status_code == 200


async def test_list_employee_sees_only_self(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    await _seed_user(db_session, 2)
    await _seed_presence_row(db_session, 1, office_id, floor_id)
    await _seed_presence_row(db_session, 2, office_id, floor_id)

    headers = _token_headers(1)
    r = await async_client.get("/presence", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert [p["user_id"] for p in body["presence"]] == [1]


async def test_list_leader_sees_own_team(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1, erp_team_id=1)
    await _seed_user(db_session, 2, erp_team_id=1)
    await _seed_user(db_session, 3, erp_team_id=99)
    await _seed_presence_row(db_session, 1, office_id, floor_id)
    await _seed_presence_row(db_session, 2, office_id, floor_id)
    await _seed_presence_row(db_session, 3, office_id, floor_id)

    leader_headers = _token_headers(2, role="leader", team_id=1)
    r = await async_client.get("/presence", headers=leader_headers)
    assert r.status_code == 200
    body = r.json()
    assert sorted(p["user_id"] for p in body["presence"]) == [1, 2]
    assert body["total"] == 2


async def test_list_admin_sees_all(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    await _seed_user(db_session, 2)
    await _seed_presence_row(db_session, 1, office_id, floor_id)
    await _seed_presence_row(db_session, 2, office_id, floor_id)

    admin_headers = _token_headers(999, role="admin")
    r = await async_client.get("/presence", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["total"] == 2


async def test_presence_requires_auth(async_client):
    assert (await async_client.get("/presence")).status_code == 401
