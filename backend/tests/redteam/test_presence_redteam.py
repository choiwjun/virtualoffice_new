"""
Presence API (G002) 레드팀 — 침투/경계값 테스트.

@SPEC docs/planning/00-decisions.md D13(상태 7종), D20-a(좌표 30일 파기)
@SPEC 04-data-model.md §2.4

목표: 크로스유저 데이터 유출, 잘못된 상태코드(500/422 오탐), purge 경계 오류를 찾는다.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from sqlalchemy import select

from app.core.security import create_access_token
from app.models.tables import ErpRole, ErpUser, Floor, Office, Presence, PresenceStatus
from app.services.scheduler import presence_coordinate_purge


# ── 시드 헬퍼 ─────────────────────────────────────────────
async def _seed_floor(db_session):
    office = Office(id=uuid4(), company_id=uuid4(), name="RedTeam Presence HQ")
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
            email=f"pr-{user_id}@example.com",
            name=f"RT User {user_id}",
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


async def _seed_presence_row(db_session, user_id, office_id, floor_id, status=PresenceStatus.ONLINE, updated_at=None):
    p = Presence(
        user_id=user_id,
        office_id=office_id,
        floor_id=floor_id,
        x=0.0,
        y=0.0,
        z=0.0,
        status=status,
    )
    if updated_at is not None:
        p.updated_at = updated_at
    db_session.add(p)
    await db_session.commit()
    return p


# ── (1) employee가 타인 presence 조회 → 404 (존재 미노출) ──
async def test_employee_reads_other_user_presence_404(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    await _seed_user(db_session, 2)
    await _seed_presence_row(db_session, 2, office_id, floor_id)

    headers = _token_headers(1)
    r = await async_client.get("/presence/2", headers=headers)
    assert r.status_code == 404, r.text


# ── (2) leader: 팀 외 유저 조회 404, 팀 내 유저 조회 200 ──
async def test_leader_reads_outside_team_404_and_own_team_ok(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 10, erp_team_id=1)  # leader 본인 팀
    await _seed_user(db_session, 11, erp_team_id=1)  # leader 팀원
    await _seed_user(db_session, 12, erp_team_id=99)  # 타팀
    await _seed_presence_row(db_session, 11, office_id, floor_id)
    await _seed_presence_row(db_session, 12, office_id, floor_id)

    leader_headers = _token_headers(10, role="leader", team_id=1)

    ok = await async_client.get("/presence/11", headers=leader_headers)
    assert ok.status_code == 200, ok.text

    forbidden = await async_client.get("/presence/12", headers=leader_headers)
    assert forbidden.status_code == 404, forbidden.text


# ── (3) employee가 타인 status PATCH → 403 ──
async def test_employee_patches_other_status_403(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    await _seed_user(db_session, 2)
    await _seed_presence_row(db_session, 2, office_id, floor_id)

    headers = _token_headers(1)
    r = await async_client.patch("/presence/2/status", json={"status": "away"}, headers=headers)
    assert r.status_code == 403, r.text


# ── (4) admin은 타인 status PATCH 가능 ──
async def test_admin_patches_any_status_ok(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    await _seed_presence_row(db_session, 1, office_id, floor_id)

    admin_headers = _token_headers(999, role="admin")
    r = await async_client.patch("/presence/1/status", json={"status": "meeting"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "meeting"


# ── (5) 잘못된 status 문자열 → 400 (422/500 아님) ──
async def test_invalid_status_string_is_400_not_422_or_500(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    headers = _token_headers(1)

    r_put = await async_client.put(
        "/presence", json=_presence_body(office_id, floor_id, "pwned"), headers=headers
    )
    assert r_put.status_code == 400, r_put.text

    await _seed_presence_row(db_session, 1, office_id, floor_id)
    r_patch = await async_client.patch("/presence/1/status", json={"status": "pwned"}, headers=headers)
    assert r_patch.status_code == 400, r_patch.text

    r_list = await async_client.get("/presence?status=pwned", headers=headers)
    assert r_list.status_code == 400, r_list.text


# ── (6) presence 행 없는 유저에게 PATCH status → 404 ──
async def test_patch_status_no_presence_row_404(async_client, db_session):
    await _seed_user(db_session, 1)
    headers = _token_headers(1)
    r = await async_client.patch("/presence/1/status", json={"status": "away"}, headers=headers)
    assert r.status_code == 404, r.text


# ── (7) 잘못된/악의적 user_id 경로 파라미터 → 정수 파싱 실패 시 422, 500 아님 ──
@pytest.mark.parametrize(
    "bad_id", ["abc", "1; DROP TABLE presence;--", "1 OR 1=1", "1.5"]
)
async def test_malformed_user_id_path_rejected_as_422(async_client, db_session, bad_id):
    headers = _token_headers(1)
    await _seed_user(db_session, 1)

    r_get = await async_client.get(f"/presence/{bad_id}", headers=headers)
    assert r_get.status_code == 422, f"GET {bad_id} -> {r_get.status_code}: {r_get.text}"

    r_patch = await async_client.patch(
        f"/presence/{bad_id}/status", json={"status": "away"}, headers=headers
    )
    assert r_patch.status_code == 422, f"PATCH {bad_id} -> {r_patch.status_code}: {r_patch.text}"


# ── (7-neg) 유효한 음수 정수 user_id → GET은 404(RBAC 존재 미노출), PATCH는 소유권
# 검사가 조회보다 먼저 수행되므로 403(존재 여부와 무관하게 항상 403 — 존재 유출 없음) ──
async def test_negative_user_id_get_404_patch_403(async_client, db_session):
    headers = _token_headers(1)
    await _seed_user(db_session, 1)

    r_get = await async_client.get("/presence/-1", headers=headers)
    assert r_get.status_code == 404, r_get.text

    r_patch = await async_client.patch("/presence/-1/status", json={"status": "away"}, headers=headers)
    assert r_patch.status_code == 403, r_patch.text


# ── (7b) BUG CANDIDATE: SQLite INTEGER 범위를 넘는 user_id → 500 (미처리 OverflowError) ──
# FastAPI의 `user_id: int` 경로 컨버터는 Python 임의정밀도 정수를 그대로 통과시킨다.
# db.get(Presence, user_id)가 SQLite 드라이버(aiosqlite)에 64bit 초과 정수를 그대로
# 바인딩하면 OverflowError가 발생하고, 이는 어떤 계층에서도 잡히지 않아 500으로 이어진다.
async def test_huge_int_user_id_path_never_500(async_client, db_session):
    headers = _token_headers(1)
    await _seed_user(db_session, 1)
    huge_id = "999999999999999999999999"  # int-parseable, but > SQLite INTEGER (64bit) range

    r_get = await async_client.get(f"/presence/{huge_id}", headers=headers)
    assert r_get.status_code in (404, 422), f"GET {huge_id} -> {r_get.status_code}: {r_get.text}"

    r_patch = await async_client.patch(
        f"/presence/{huge_id}/status", json={"status": "away"}, headers=headers
    )
    # 비관리자는 존재 확인(범위 가드) 전에 권한(403)이 우선한다 — 403/404/422 모두 500 아님(핵심 속성).
    assert r_patch.status_code in (403, 404, 422), f"PATCH {huge_id} -> {r_patch.status_code}: {r_patch.text}"


# ── (8) leader가 타팀 team_id로 GET /presence?team_id= → 403, 데이터 유출 없음 ──
async def test_leader_list_other_team_id_forbidden(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 10, erp_team_id=1)
    await _seed_user(db_session, 20, erp_team_id=99)
    await _seed_presence_row(db_session, 20, office_id, floor_id)

    leader_headers = _token_headers(10, role="leader", team_id=1)
    r = await async_client.get("/presence?team_id=99", headers=leader_headers)
    assert r.status_code == 403, r.text
    # 403 응답 바디에 타팀 presence 데이터가 새어나가지 않아야 함
    assert "20" not in r.text or "user_id" not in r.text


# ── (9) 미인증 요청 → 모든 엔드포인트 401 ──
async def test_unauthenticated_rejected_on_every_endpoint(async_client, db_session):
    office_id, floor_id = await _seed_floor(db_session)

    r_put = await async_client.put("/presence", json=_presence_body(office_id, floor_id))
    assert r_put.status_code == 401, r_put.text

    r_patch = await async_client.patch("/presence/1/status", json={"status": "away"})
    assert r_patch.status_code == 401, r_patch.text

    r_get_single = await async_client.get("/presence/1")
    assert r_get_single.status_code == 401, r_get_single.text

    r_list = await async_client.get("/presence")
    assert r_list.status_code == 401, r_list.text


# ── (10a) 필수 필드 누락(floor_id 없음) → 422 ──
async def test_put_presence_missing_floor_id_422(async_client, db_session):
    office_id, _floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    headers = _token_headers(1)

    body = {
        "office_id": str(office_id),
        "x": 1.0,
        "y": 2.0,
        "z": 3.0,
        "status": "online",
    }
    r = await async_client.put("/presence", json=body, headers=headers)
    assert r.status_code == 422, r.text


# ── (10b) 유한하지만 거대한 좌표값 → 500이 아닌 처리 ──
@pytest.mark.parametrize("extreme", [1e308, -1e308])
async def test_put_presence_huge_finite_coords_no_500(async_client, db_session, extreme):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    headers = _token_headers(1)

    body = _presence_body(office_id, floor_id, "online", x=extreme)
    r = await async_client.put("/presence", json=body, headers=headers)
    assert r.status_code != 500, f"x={extreme} -> 500: {r.text}"
    assert r.status_code in (200, 400, 422), f"x={extreme} -> {r.status_code}: {r.text}"


# ── (10c) BUG CANDIDATE: NaN/Infinity 좌표 → 500 (미처리 IntegrityError) ──
# httpx 클라이언트(allow_nan=False)는 json= 파라미터로 NaN/Infinity 직렬화를 거부하므로,
# 서버가 실제로 이 값을 받았을 때 어떻게 반응하는지 확인하려면 원문 JSON 바이트를 직접
# 구성해 raw body로 전송해야 한다(NaN/Infinity는 RFC 8259 위반이지만 표준 라이브러리
# json.loads는 기본적으로 허용하므로 서버가 이를 그대로 받아들일 위험이 있다).
@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
async def test_put_presence_non_finite_coords_never_500(async_client, db_session, literal):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    headers = {**_token_headers(1), "content-type": "application/json"}

    raw = (
        '{"office_id": "%s", "floor_id": "%s", "x": %s, "y": 1.0, "z": 1.0, "status": "online"}'
        % (office_id, floor_id, literal)
    )
    r = await async_client.put("/presence", content=raw.encode(), headers=headers)
    assert r.status_code != 500, f"x={literal} raw -> 500: {r.text}"
    assert r.status_code in (200, 400, 422), f"x={literal} raw -> {r.status_code}: {r.text}"


# ── (11) purge 경계: 30일 정확히/30일+1초/29일 → 삭제 대상 판정 + 멱등성 ──
async def test_purge_boundary_and_idempotency(db_session):
    office_id, floor_id = await _seed_floor(db_session)
    await _seed_user(db_session, 1)
    await _seed_user(db_session, 2)
    await _seed_user(db_session, 3)

    now = datetime(2026, 7, 4, 3, 0, 0, tzinfo=timezone.utc)
    exactly_30d = now - timedelta(days=30)
    just_over_30d = now - timedelta(days=30, seconds=1)
    under_30d = now - timedelta(days=29)

    await _seed_presence_row(db_session, 1, office_id, floor_id, updated_at=exactly_30d)
    await _seed_presence_row(db_session, 2, office_id, floor_id, updated_at=just_over_30d)
    await _seed_presence_row(db_session, 3, office_id, floor_id, updated_at=under_30d)

    deleted_count = await presence_coordinate_purge(db_session, now=now)
    assert deleted_count == 1, f"expected exactly 1 row purged (30d+1s), got {deleted_count}"

    remaining_ids = sorted(
        (await db_session.execute(select(Presence.user_id))).scalars().all()
    )
    assert remaining_ids == [1, 3], f"boundary row (exactly 30d) or fresh row (29d) wrongly purged: {remaining_ids}"

    # 멱등성: 재실행 시 추가 삭제 없음
    second_run = await presence_coordinate_purge(db_session, now=now)
    assert second_run == 0, f"purge not idempotent: second run deleted {second_run}"

    remaining_ids_after = sorted(
        (await db_session.execute(select(Presence.user_id))).scalars().all()
    )
    assert remaining_ids_after == [1, 3]
