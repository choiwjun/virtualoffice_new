"""
G003 좌석 API 적대(red-team) e2e 테스트.

목표: 배타성/RBAC/상태머신 경계를 실제 HTTP 호출로 깨뜨려 본다.
제품코드는 수정하지 않는다 — 취약점 발견 시 blocker로 보고한다.

@SPEC 00-decisions.md D10, docs/planning/04-data-model.md §2.3
"""

from uuid import uuid4

from app.core.security import create_access_token
from app.models.tables import ErpRole, ErpUser, Floor, Office, Seat, SeatType


# ── 시드 헬퍼 ─────────────────────────────────────────────
async def _seed_floor(db_session):
    office = Office(id=uuid4(), company_id=uuid4(), name="RedTeam HQ")
    db_session.add(office)
    await db_session.flush()
    floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1F")
    db_session.add(floor)
    await db_session.flush()
    await db_session.commit()
    return floor.id


async def _seed_seat(db_session, floor_id, seat_number: str, seat_type: SeatType) -> None:
    seat = Seat(
        id=uuid4(),
        floor_id=floor_id,
        type=seat_type,
        coords={"x": 1.0, "y": 1.0, "facing": 0},
        seat_number=seat_number,
    )
    db_session.add(seat)
    await db_session.commit()


async def _seed_user(db_session, user_id: int) -> None:
    db_session.add(
        ErpUser(
            id=user_id,
            company_id=1,
            email=f"redteam{user_id}@example.com",
            name=f"RedTeam User {user_id}",
            erp_team_id=1,
            role=ErpRole.EMPLOYEE,
            is_active=True,
        )
    )
    await db_session.commit()


def _token_headers(sub: int, role: str = "employee") -> dict:
    token = create_access_token({"sub": str(sub), "email": f"u{sub}@example.com", "role": role})
    return {"Authorization": f"Bearer {token}"}


# ── 1. 배타성: 연속 assign은 두 번째가 409, 상태 오염 없이 재배정 가능 ──
async def test_exclusivity_double_assign_then_reassign(async_client, db_session, admin_auth_headers):
    floor_id = await _seed_floor(db_session)
    await _seed_seat(db_session, floor_id, "RT-EXCL-01", SeatType.FIXED)
    await _seed_user(db_session, 101)
    await _seed_user(db_session, 102)

    r1 = await async_client.post(
        "/seats/RT-EXCL-01/assign", json={"user_id": 101}, headers=admin_auth_headers
    )
    assert r1.status_code == 200, r1.text

    r2 = await async_client.post(
        "/seats/RT-EXCL-01/assign", json={"user_id": 102}, headers=admin_auth_headers
    )
    assert r2.status_code == 409, r2.text

    # 상태 오염 없음: 좌석은 여전히 101에게 배정된 채로 조회되어야 한다.
    listed = await async_client.get(
        "/seats", params={"status": "occupied"}, headers=admin_auth_headers
    )
    assert listed.status_code == 200
    seat_row = next(s for s in listed.json()["seats"] if s["seat_number"] == "RT-EXCL-01")
    assert seat_row["assigned_user_id"] == 101

    # 해제 후 재배정 가능
    r3 = await async_client.delete("/seats/RT-EXCL-01/assign", headers=admin_auth_headers)
    assert r3.status_code == 200, r3.text

    r4 = await async_client.post(
        "/seats/RT-EXCL-01/assign", json={"user_id": 102}, headers=admin_auth_headers
    )
    assert r4.status_code == 200, r4.text
    assert r4.json()["assigned_user_id"] == 102


# ── 2. 존재하지 않는 seat_number → 모든 배정 계열 엔드포인트 404 ──
async def test_nonexistent_seat_returns_404(async_client, admin_auth_headers, auth_headers):
    r_assign = await async_client.post(
        "/seats/NOPE-999/assign", json={"user_id": 1}, headers=admin_auth_headers
    )
    assert r_assign.status_code == 404

    r_unassign = await async_client.delete("/seats/NOPE-999/assign", headers=admin_auth_headers)
    assert r_unassign.status_code == 404

    r_occupy = await async_client.post("/seats/NOPE-999/occupy", headers=auth_headers)
    assert r_occupy.status_code == 404

    r_release = await async_client.delete("/seats/NOPE-999/occupy", headers=auth_headers)
    assert r_release.status_code == 404


# ── 3. RBAC: employee는 좌석 생성/배정 불가(403) ──
async def test_rbac_employee_forbidden_from_admin_actions(async_client, db_session, auth_headers):
    floor_id = await _seed_floor(db_session)
    await _seed_seat(db_session, floor_id, "RT-RBAC-01", SeatType.FIXED)

    r_create = await async_client.post(
        "/seats",
        json={"floor_id": str(floor_id), "type": "fixed", "coords": {"x": 0, "y": 0}},
        headers=auth_headers,
    )
    assert r_create.status_code == 403, r_create.text

    r_assign = await async_client.post(
        "/seats/RT-RBAC-01/assign", json={"user_id": 1}, headers=auth_headers
    )
    assert r_assign.status_code == 403, r_assign.text


# ── 4. 자율석만 self-occupy 가능; 고정석은 409 ──
async def test_occupy_only_free_seats(async_client, db_session, auth_headers):
    floor_id = await _seed_floor(db_session)
    await _seed_seat(db_session, floor_id, "RT-FREE-01", SeatType.FREE)
    await _seed_seat(db_session, floor_id, "RT-FIXED-01", SeatType.FIXED)

    r_free = await async_client.post("/seats/RT-FREE-01/occupy", headers=auth_headers)
    assert r_free.status_code == 200, r_free.text

    r_fixed = await async_client.post("/seats/RT-FIXED-01/occupy", headers=auth_headers)
    assert r_fixed.status_code == 409, r_fixed.text


# ── 5. 이미 점유된 좌석 재점유 409; 남의 점유석 반납 시도 404 ──
async def test_occupy_conflict_and_foreign_release_denied(async_client, db_session, auth_headers, leader_token):
    floor_id = await _seed_floor(db_session)
    await _seed_seat(db_session, floor_id, "RT-FREE-02", SeatType.FREE)

    r_first = await async_client.post("/seats/RT-FREE-02/occupy", headers=auth_headers)
    assert r_first.status_code == 200, r_first.text

    leader_headers = {"Authorization": f"Bearer {leader_token}"}
    r_second = await async_client.post("/seats/RT-FREE-02/occupy", headers=leader_headers)
    assert r_second.status_code == 409, r_second.text

    # leader(sub=2)는 employee(sub=1) 점유석을 반납할 수 없어야 한다.
    r_foreign_release = await async_client.delete("/seats/RT-FREE-02/occupy", headers=leader_headers)
    assert r_foreign_release.status_code == 404, r_foreign_release.text

    # 진짜 점유자는 정상 반납 가능(상태 오염 없었는지 확인).
    r_owner_release = await async_client.delete("/seats/RT-FREE-02/occupy", headers=auth_headers)
    assert r_owner_release.status_code == 200, r_owner_release.text


# ── 6. 잘못된 좌석 type 문자열 → 400 ──
async def test_invalid_seat_type_rejected(async_client, db_session, admin_auth_headers):
    floor_id = await _seed_floor(db_session)
    r = await async_client.post(
        "/seats",
        json={"floor_id": str(floor_id), "type": "desk", "coords": {"x": 0, "y": 0}},
        headers=admin_auth_headers,
    )
    assert r.status_code in (400, 422), r.text


# ── 7. 미인증 요청 → 401 ──
async def test_unauthenticated_requests_rejected(async_client):
    r_list = await async_client.get("/seats")
    assert r_list.status_code == 401

    r_available = await async_client.get("/seats/available")
    assert r_available.status_code == 401


# ── 8. assign 페이로드 검증 + 존재하지 않는 user_id 안전 처리 ──
async def test_assign_payload_validation_and_unknown_user(async_client, db_session, admin_auth_headers):
    floor_id = await _seed_floor(db_session)
    await _seed_seat(db_session, floor_id, "RT-PAYLOAD-01", SeatType.FIXED)
    await _seed_seat(db_session, floor_id, "RT-PAYLOAD-02", SeatType.FIXED)

    r_missing = await async_client.post(
        "/seats/RT-PAYLOAD-01/assign", json={}, headers=admin_auth_headers
    )
    assert r_missing.status_code == 422, r_missing.text

    r_bad_type = await async_client.post(
        "/seats/RT-PAYLOAD-01/assign", json={"user_id": "not-an-int"}, headers=admin_auth_headers
    )
    assert r_bad_type.status_code == 422, r_bad_type.text

    # 존재하지 않는 user_id: FK 오류가 500으로 새면 안 된다.
    r_unknown_user = await async_client.post(
        "/seats/RT-PAYLOAD-02/assign", json={"user_id": 999999}, headers=admin_auth_headers
    )
    assert r_unknown_user.status_code != 500, r_unknown_user.text
    assert r_unknown_user.status_code in (200, 400, 404, 409, 422), r_unknown_user.text


# ── 9. (보너스) 다른 admin 토큰으로 동시성 유사 경합에도 좌석당 활성 배정은 1건 ──
async def test_exclusivity_holds_across_repeated_conflicting_assigns(async_client, db_session, admin_auth_headers):
    floor_id = await _seed_floor(db_session)
    await _seed_seat(db_session, floor_id, "RT-EXCL-02", SeatType.FIXED)
    await _seed_user(db_session, 201)
    await _seed_user(db_session, 202)
    await _seed_user(db_session, 203)

    ok = await async_client.post(
        "/seats/RT-EXCL-02/assign", json={"user_id": 201}, headers=admin_auth_headers
    )
    assert ok.status_code == 200, ok.text

    for other_user in (202, 203):
        conflict = await async_client.post(
            "/seats/RT-EXCL-02/assign", json={"user_id": other_user}, headers=admin_auth_headers
        )
        assert conflict.status_code == 409, conflict.text

    # 세 번 연속 시도 후에도 원래 배정(201)이 그대로 살아있어야 한다.
    listed = await async_client.get(
        "/seats", params={"status": "occupied"}, headers=admin_auth_headers
    )
    seat_row = next(s for s in listed.json()["seats"] if s["seat_number"] == "RT-EXCL-02")
    assert seat_row["assigned_user_id"] == 201