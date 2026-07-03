"""
B-14 감사 생산자 훅 적대적(red-team) 테스트.

목적: 도메인 API(seats/meetings/kpi/layouts)의 감사 대상 액션이 실제로 ``AuditLog``
레코드를 남기는지(D20 감사추적 컴플라이언스 컨트롤 작동), 그리고 그 기록이
**대상 액션과 원자적**인지(실패/멱등/거부 시 감사 미생성)를 깨뜨리는 것을 목표로 한다.
제품 코드/모델은 수정하지 않는다 — 취약점 발견 시 blocker로 보고한다.

@SPEC docs/planning/00-decisions.md D20 (audit_log 컴플라이언스)
@SPEC docs/planning/04-data-model.md §2.6 (audit_log)
@SPEC backend/app/services/audit_service.py + 도메인 라우터 훅
"""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import (
    AuditLog,
    ErpRole,
    ErpUser,
    Floor,
    KpiObjectionStatus,
    KpiPeriodType,
    KpiResult,
    KpiSource,
    Meeting,
    Office,
    OfficeLayout,
    Room,
    RoomType,
    Seat,
    SeatType,
)

pytestmark = pytest.mark.asyncio

# admin_token/auth_headers 픽스처가 발급하는 actor user_id (conftest.py)
_ADMIN_UID = 3
_EMPLOYEE_UID = 1


# ── 시드 헬퍼 ─────────────────────────────────────────────
async def _seed_floor(db_session: AsyncSession):
    office = Office(id=uuid4(), company_id=uuid4(), name="Audit HQ")
    db_session.add(office)
    await db_session.flush()
    floor = Floor(id=uuid4(), office_id=office.id, level=1, name="1F")
    db_session.add(floor)
    await db_session.flush()
    await db_session.commit()
    return office.id, floor.id


async def _seed_seat(db_session: AsyncSession, floor_id, seat_number: str) -> Seat:
    seat = Seat(
        id=uuid4(),
        floor_id=floor_id,
        type=SeatType.FIXED,
        coords={"x": 1.0, "y": 1.0, "facing": 0},
        seat_number=seat_number,
    )
    db_session.add(seat)
    await db_session.commit()
    await db_session.refresh(seat)
    return seat


async def _seed_user(db_session: AsyncSession, user_id: int) -> ErpUser:
    user = ErpUser(
        id=user_id,
        company_id=1,
        email=f"audit{user_id}@example.com",
        name=f"Audit User {user_id}",
        erp_team_id=1,
        role=ErpRole.EMPLOYEE,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _seed_room(db_session: AsyncSession) -> Room:
    _, floor_id = await _seed_floor(db_session)
    room = Room(
        id=uuid4(),
        floor_id=floor_id,
        type=RoomType.MEETING,
        name="Room A",
        capacity=8,
        coords={"x": 0, "y": 0, "width": 5, "height": 5},
    )
    db_session.add(room)
    await db_session.commit()
    await db_session.refresh(room)
    return room


async def _seed_kpi(db_session: AsyncSession, *, user_id: int = 1, value: Decimal = Decimal("50.00")) -> KpiResult:
    kr = KpiResult(
        user_id=user_id,
        period_type=KpiPeriodType.QUARTERLY,
        period_key="2026-Q3",
        metric="collaboration_score",
        value=value,
        source=KpiSource.VIRTUAL_OFFICE,
        objection_status=KpiObjectionStatus.NONE,
    )
    db_session.add(kr)
    await db_session.commit()
    await db_session.refresh(kr)
    return kr


def _deployable_layout(office_id: str, floor_id: str) -> dict:
    return {
        "metadata": {
            "version": "1.0",
            "schema_version": 1,
            "layout_id": str(uuid4()),
            "office_id": office_id,
            "floor_id": floor_id,
            "floor_name": "1F",
            "created_at": "2026-07-01T00:00:00Z",
            "updated_at": "2026-07-01T00:00:00Z",
            "created_by": 1,
            "updated_by": 1,
            "language": "ko-KR",
        },
        "floor": {
            "id": floor_id,
            "level": 1,
            "name": "1F",
            "coordinate_origin": "top_left",
            "floor_height_m": 0.0,
            "unit_system": "metric",
        },
        "dimensions": {
            "width_m": 10.0,
            "height_m": 10.0,
            "min_x": 0.0,
            "max_x": 10.0,
            "min_y": 0.0,
            "max_y": 10.0,
        },
        "zones": [],
        "rooms": [],
        "seats": [],
        "colliders": [],
        "spawn_points": [{"spawn_id": "SP1", "coords": {"x": 5.0, "y": 5.0}}],
    }


async def _audit_rows(db_session: AsyncSession, action: str = None) -> list[AuditLog]:
    stmt = select(AuditLog)
    if action is not None:
        stmt = stmt.where(AuditLog.action == action)
    return list((await db_session.execute(stmt)).scalars().all())


# ── 1. 좌석 배정/해제 감사 ────────────────────────────────
async def test_seat_assign_creates_audit(async_client: AsyncClient, db_session, admin_auth_headers):
    _, floor_id = await _seed_floor(db_session)
    seat = await _seed_seat(db_session, floor_id, "1F-A01")
    await _seed_user(db_session, 200)

    r = await async_client.post(
        "/seats/1F-A01/assign", json={"user_id": 200}, headers=admin_auth_headers
    )
    assert r.status_code == 200, r.text

    rows = await _audit_rows(db_session, "seat_assigned")
    assert len(rows) == 1, "seat_assigned 감사 로그가 정확히 1건 생성되어야 함"
    log = rows[0]
    assert log.entity_type == "seat"
    assert log.entity_id == str(seat.id)
    assert log.user_id == _ADMIN_UID, "감사 actor는 요청 관리자여야 함"
    assert log.new_value == {"assigned_user_id": 200, "seat_number": "1F-A01"}


async def test_seat_unassign_creates_audit(async_client: AsyncClient, db_session, admin_auth_headers):
    _, floor_id = await _seed_floor(db_session)
    seat = await _seed_seat(db_session, floor_id, "1F-A01")
    await _seed_user(db_session, 200)

    await async_client.post(
        "/seats/1F-A01/assign", json={"user_id": 200}, headers=admin_auth_headers
    )
    r = await async_client.delete("/seats/1F-A01/assign", headers=admin_auth_headers)
    assert r.status_code == 200, r.text

    rows = await _audit_rows(db_session, "seat_unassigned")
    assert len(rows) == 1
    assert rows[0].entity_id == str(seat.id)
    assert rows[0].old_value == {"assigned_user_id": 200}
    assert rows[0].new_value == {"assigned_user_id": None}


async def test_seat_assign_conflict_creates_no_extra_audit(
    async_client: AsyncClient, db_session, admin_auth_headers
):
    """원자성: 두 번째 assign은 409(사전 충돌 검사)로 거부 → seat_assigned 감사는 1건만."""
    _, floor_id = await _seed_floor(db_session)
    await _seed_seat(db_session, floor_id, "1F-A01")
    await _seed_user(db_session, 200)
    await _seed_user(db_session, 201)

    r1 = await async_client.post(
        "/seats/1F-A01/assign", json={"user_id": 200}, headers=admin_auth_headers
    )
    assert r1.status_code == 200, r1.text
    r2 = await async_client.post(
        "/seats/1F-A01/assign", json={"user_id": 201}, headers=admin_auth_headers
    )
    assert r2.status_code == 409, r2.text

    rows = await _audit_rows(db_session, "seat_assigned")
    assert len(rows) == 1, "충돌로 거부된 배정은 감사 로그를 남기면 안 됨(원자성)"


# ── 2. 회의 생성/취소 감사 ────────────────────────────────
async def test_meeting_create_creates_audit(async_client: AsyncClient, db_session, admin_auth_headers):
    room = await _seed_room(db_session)
    now = datetime(2026, 8, 1, 10, 0, 0, tzinfo=timezone.utc)
    r = await async_client.post(
        "/meetings",
        json={
            "title": "Sync",
            "room_id": str(room.id),
            "start_time": now.isoformat(),
            "end_time": (now.replace(hour=11)).isoformat(),
        },
        headers=admin_auth_headers,
    )
    assert r.status_code == 201, r.text

    meeting = (await db_session.execute(select(Meeting))).scalars().one()
    rows = await _audit_rows(db_session, "meeting_created")
    assert len(rows) == 1
    assert rows[0].entity_type == "meeting"
    assert rows[0].entity_id == str(meeting.id)
    assert rows[0].user_id == _ADMIN_UID
    assert rows[0].new_value["room_id"] == str(room.id)


async def test_meeting_cancel_creates_audit(async_client: AsyncClient, db_session, admin_auth_headers):
    room = await _seed_room(db_session)
    now = datetime(2026, 8, 1, 10, 0, 0, tzinfo=timezone.utc)
    create = await async_client.post(
        "/meetings",
        json={
            "title": "Sync",
            "room_id": str(room.id),
            "start_time": now.isoformat(),
            "end_time": (now.replace(hour=11)).isoformat(),
        },
        headers=admin_auth_headers,
    )
    assert create.status_code == 201, create.text
    meeting = (await db_session.execute(select(Meeting))).scalars().one()

    r = await async_client.delete(f"/meetings/{meeting.id}", headers=admin_auth_headers)
    assert r.status_code == 200, r.text

    rows = await _audit_rows(db_session, "meeting_cancelled")
    assert len(rows) == 1
    assert rows[0].entity_id == str(meeting.id)
    assert rows[0].new_value == {"status": "cancelled"}


async def test_meeting_cancel_by_non_host_creates_no_audit(
    async_client: AsyncClient, db_session, admin_auth_headers, auth_headers
):
    """거부(403 not_host)된 취소는 감사 로그를 남기면 안 됨."""
    room = await _seed_room(db_session)
    now = datetime(2026, 8, 1, 10, 0, 0, tzinfo=timezone.utc)
    # host = admin(uid 3)
    await async_client.post(
        "/meetings",
        json={
            "title": "Sync",
            "room_id": str(room.id),
            "start_time": now.isoformat(),
            "end_time": (now.replace(hour=11)).isoformat(),
        },
        headers=admin_auth_headers,
    )
    meeting = (await db_session.execute(select(Meeting))).scalars().one()
    # employee(uid 1)가 취소 시도 → 403
    r = await async_client.delete(f"/meetings/{meeting.id}", headers=auth_headers)
    assert r.status_code == 403, r.text

    rows = await _audit_rows(db_session, "meeting_cancelled")
    assert len(rows) == 0, "비호스트 취소 거부는 감사 미생성"


# ── 3. KPI 조정/확정/이의신청 감사 ────────────────────────
async def test_kpi_adjust_creates_audit(async_client: AsyncClient, db_session, admin_auth_headers):
    kr = await _seed_kpi(db_session, user_id=1, value=Decimal("50.00"))
    r = await async_client.put(
        f"/kpi-results/{kr.id}/adjust",
        json={"admin_adjusted_score": "77.5", "admin_note": "보정"},
        headers=admin_auth_headers,
    )
    assert r.status_code == 200, r.text

    rows = await _audit_rows(db_session, "kpi_adjusted")
    assert len(rows) == 1
    assert rows[0].entity_type == "kpi_result"
    assert rows[0].entity_id == str(kr.id)
    assert rows[0].user_id == _ADMIN_UID
    assert rows[0].old_value == {"admin_adjusted_score": None}
    assert rows[0].new_value["admin_adjusted_score"] == 77.5


async def test_kpi_confirm_creates_audit(async_client: AsyncClient, db_session, admin_auth_headers):
    kr = await _seed_kpi(db_session, user_id=1, value=Decimal("64.30"))
    r = await async_client.post(f"/kpi-results/{kr.id}/confirm", headers=admin_auth_headers)
    assert r.status_code == 200, r.text

    rows = await _audit_rows(db_session, "kpi_finalized")
    assert len(rows) == 1
    assert rows[0].entity_id == str(kr.id)
    assert rows[0].new_value["final_score"] == 64.3


async def test_kpi_confirm_idempotent_creates_single_audit(
    async_client: AsyncClient, db_session, admin_auth_headers
):
    """멱등: 이미 확정된 결과 재confirm은 조기반환 → kpi_finalized 감사는 1건만."""
    kr = await _seed_kpi(db_session, user_id=1, value=Decimal("40.00"))
    first = await async_client.post(f"/kpi-results/{kr.id}/confirm", headers=admin_auth_headers)
    assert first.status_code == 200, first.text
    second = await async_client.post(f"/kpi-results/{kr.id}/confirm", headers=admin_auth_headers)
    assert second.status_code == 200, second.text

    rows = await _audit_rows(db_session, "kpi_finalized")
    assert len(rows) == 1, "멱등 재확정은 감사 로그를 중복 생성하면 안 됨"


async def test_kpi_objection_creates_audit(async_client: AsyncClient, db_session, auth_headers):
    """이의신청 감사의 actor는 제출한 본인(employee uid 1)."""
    kr = await _seed_kpi(db_session, user_id=_EMPLOYEE_UID, value=Decimal("50.00"))
    r = await async_client.post(
        f"/kpi-results/{kr.id}/objections",
        json={"category": "scoring", "text": "재검토 요청"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text

    rows = await _audit_rows(db_session, "kpi_objection_submitted")
    assert len(rows) == 1
    assert rows[0].entity_id == str(kr.id)
    assert rows[0].user_id == _EMPLOYEE_UID
    assert rows[0].new_value["category"] == "scoring"


async def test_kpi_adjust_forbidden_creates_no_audit(
    async_client: AsyncClient, db_session, auth_headers
):
    """거부(403 비admin)된 조정은 감사 미생성."""
    kr = await _seed_kpi(db_session, user_id=1)
    r = await async_client.put(
        f"/kpi-results/{kr.id}/adjust",
        json={"admin_adjusted_score": "77.5"},
        headers=auth_headers,
    )
    assert r.status_code == 403, r.text
    assert await _audit_rows(db_session, "kpi_adjusted") == []


# ── 4. 레이아웃 배포/롤백 감사 ────────────────────────────
async def test_layout_deploy_creates_audit(async_client: AsyncClient, db_session, admin_auth_headers):
    office_id, floor_id = await _seed_floor(db_session)
    create = await async_client.post(
        "/layouts",
        json={
            "office_id": str(office_id),
            "floor_id": str(floor_id),
            "json": _deployable_layout(str(office_id), str(floor_id)),
        },
        headers=admin_auth_headers,
    )
    assert create.status_code == 201, create.text
    layout_id = create.json()["layout_id"]

    r = await async_client.post(f"/layouts/{layout_id}/deploy", headers=admin_auth_headers)
    assert r.status_code == 200, r.text

    rows = await _audit_rows(db_session, "office_layout_deployed")
    assert len(rows) == 1
    assert rows[0].entity_type == "office_layout"
    assert rows[0].entity_id == layout_id
    assert rows[0].user_id == _ADMIN_UID
    assert "version" in rows[0].new_value


async def test_layout_rollback_creates_audit_with_via_flag(
    async_client: AsyncClient, db_session, admin_auth_headers
):
    office_id, floor_id = await _seed_floor(db_session)

    async def _create_and_deploy() -> dict:
        c = await async_client.post(
            "/layouts",
            json={
                "office_id": str(office_id),
                "floor_id": str(floor_id),
                "json": _deployable_layout(str(office_id), str(floor_id)),
            },
            headers=admin_auth_headers,
        )
        assert c.status_code == 201, c.text
        body = c.json()
        d = await async_client.post(f"/layouts/{body['layout_id']}/deploy", headers=admin_auth_headers)
        assert d.status_code == 200, d.text
        return d.json()

    v1 = await _create_and_deploy()
    await _create_and_deploy()  # v2 배포 → v1 archived

    rb = await async_client.post(
        f"/layouts/{v1['layout_id']}/rollback?version={v1['version']}", headers=admin_auth_headers
    )
    assert rb.status_code == 200, rb.text

    rows = await _audit_rows(db_session, "office_layout_deployed")
    # deploy 2회 + rollback 1회 = 3건, 그 중 rollback 1건은 via=rollback
    assert len(rows) == 3
    rollback_rows = [r for r in rows if r.new_value.get("via") == "rollback"]
    assert len(rollback_rows) == 1, "롤백도 office_layout_deployed 감사를 via=rollback으로 남겨야 함"


async def test_deploy_validation_failure_creates_no_audit(
    async_client: AsyncClient, db_session, admin_auth_headers
):
    """원자성: 검증 실패(400)로 배포되지 않은 레이아웃은 감사 미생성."""
    office_id, floor_id = await _seed_floor(db_session)
    create = await async_client.post(
        "/layouts",
        json={"office_id": str(office_id), "floor_id": str(floor_id), "json": {"foo": "bar"}},
        headers=admin_auth_headers,
    )
    assert create.status_code == 201, create.text
    layout_id = create.json()["layout_id"]

    r = await async_client.post(f"/layouts/{layout_id}/deploy", headers=admin_auth_headers)
    assert r.status_code == 400, r.text
    assert await _audit_rows(db_session, "office_layout_deployed") == []


# ── 5. 읽기 전용 액션은 감사 미생성 ───────────────────────
async def test_readonly_actions_create_no_audit(async_client: AsyncClient, db_session, admin_auth_headers):
    _, floor_id = await _seed_floor(db_session)
    await _seed_seat(db_session, floor_id, "1F-A01")
    await async_client.get("/seats", headers=admin_auth_headers)
    await async_client.get("/layouts", headers=admin_auth_headers)
    await async_client.get("/kpi-results", headers=admin_auth_headers)

    assert await _audit_rows(db_session) == [], "GET 조회는 감사 로그를 남기면 안 됨"

# ── 6. 포렌식 메타(IP/User-Agent) 기록 ────────────────────
async def test_audit_captures_client_ip_and_user_agent(
    async_client: AsyncClient, db_session, admin_auth_headers
):
    """감사 로그가 요청의 클라이언트 IP와 User-Agent를 기록해야 함(D20 포렌식 완전성)."""
    _, floor_id = await _seed_floor(db_session)
    await _seed_seat(db_session, floor_id, "1F-A01")
    await _seed_user(db_session, 200)

    headers = {**admin_auth_headers, "User-Agent": "AuditProbe/9.9"}
    r = await async_client.post("/seats/1F-A01/assign", json={"user_id": 200}, headers=headers)
    assert r.status_code == 200, r.text

    rows = await _audit_rows(db_session, "seat_assigned")
    assert len(rows) == 1
    log = rows[0]
    assert log.ip_address is not None, "감사 로그에 클라이언트 IP가 기록되어야 함"
    assert log.user_agent == "AuditProbe/9.9", "감사 로그에 요청 User-Agent가 기록되어야 함"
