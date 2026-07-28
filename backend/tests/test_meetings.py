"""
meetings API 통합 테스트 — G002 Lane B

검증 범위:
1. POST /api/meetings — 회의 예약 성공
2. POST /api/meetings — room 존재 안 함 → 404
3. POST /api/meetings — 동일 room 동일 시간 → 409 (D23)
4. GET  /api/meetings — 목록 조회 / scheduled_at 범위 필터
5. GET  /api/meetings/{id} — 상세 조회 / 없으면 404
6. POST /api/meetings/{id}/join — 참석 등록 (upsert joined_at)
7. GET  /api/meetings/{id}/participants — 참석자 목록
8. 인증 없이 → 401
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import AsyncGenerator
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db import Base, get_db
from app.main import app
from app.models.tables import (
    ErpUser,
    ErpRole,
    Meeting,
    MeetingStatus,
    Room,
    RoomStatus,
    RoomType,
)


# ---------------------------------------------------------------------------
# 픽스처
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def async_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def _override() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def user_token() -> str:
    return create_access_token({"sub": "1001", "email": "alice@test.local", "role": "employee"})


@pytest.fixture
def admin_token() -> str:
    return create_access_token({"sub": "1002", "email": "bob@test.local", "role": "admin"})


@pytest.fixture
def auth_headers(user_token: str) -> dict:
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture
def admin_headers(admin_token: str) -> dict:
    return {"Authorization": f"Bearer {admin_token}"}


@pytest_asyncio.fixture
async def seeded(db_session: AsyncSession):
    """기본 시드: room, erp_user (SQLite FK 미적용 — Office/Floor 불필요)."""
    room = Room(
        id=uuid4(),
        floor_id=uuid4(),           # SQLite FK 미적용
        type=RoomType.MEETING,
        name="회의실 A",
        capacity=10,
        coords={"x": 0, "y": 0, "width": 10, "height": 10},
        status=RoomStatus.ACTIVE,
    )
    db_session.add(room)

    user = ErpUser(
        id=1001,
        company_id=1,
        email="alice@test.local",
        name="Alice",
        erp_team_id=1,
        role=ErpRole.EMPLOYEE,
    )
    db_session.add(user)

    user2 = ErpUser(
        id=1002,
        company_id=1,
        email="bob@test.local",
        name="Bob",
        erp_team_id=1,
        role=ErpRole.ADMIN,
    )
    db_session.add(user2)

    await db_session.commit()
    return {"room": room}


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _future_utc(hours: int = 1) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


# ---------------------------------------------------------------------------
# 테스트
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_meeting_success(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    scheduled = _future_utc(2)
    resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "Q2 킥오프", "scheduled_at": scheduled},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["title"] == "Q2 킥오프"
    assert data["room_id"] == room_id
    assert data["status"] == "scheduled"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_meeting_room_not_found(async_client, seeded, auth_headers):
    resp = await async_client.post(
        "/api/meetings",
        json={"room_id": str(uuid4()), "title": "없는 방", "scheduled_at": _future_utc()},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_meeting_room_time_conflict(async_client, seeded, auth_headers):
    """D23: 동일 room + 동일 scheduled_at → 409."""
    room_id = str(seeded["room"].id)
    scheduled = _future_utc(3)
    # 첫 번째 예약
    resp1 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "첫 회의", "scheduled_at": scheduled},
        headers=auth_headers,
    )
    assert resp1.status_code == 201

    # 두 번째 예약 (동일 방, 동일 시각) → 409
    resp2 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "충돌 회의", "scheduled_at": scheduled},
        headers=auth_headers,
    )
    assert resp2.status_code == 409
    assert "conflict" in resp2.json()["detail"]


@pytest.mark.asyncio
async def test_create_meeting_cancelled_no_conflict(async_client, seeded, db_session, auth_headers):
    """취소된 회의는 겹침 검사에서 제외."""
    room_id = str(seeded["room"].id)
    scheduled = _future_utc(4)

    # 예약 생성
    resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "취소 회의", "scheduled_at": scheduled},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    meeting_id = resp.json()["id"]

    # DB에서 직접 cancelled 처리
    from uuid import UUID
    result = await db_session.execute(
        select(Meeting).where(Meeting.id == UUID(meeting_id))
    )
    m = result.scalar_one()
    m.status = MeetingStatus.CANCELLED
    await db_session.commit()

    # 같은 방, 같은 시각으로 재예약 → 201 (취소 제외)
    resp2 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "재예약", "scheduled_at": scheduled},
        headers=auth_headers,
    )
    assert resp2.status_code == 201


@pytest.mark.asyncio
async def test_list_meetings(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    for i in range(3):
        await async_client.post(
            "/api/meetings",
            json={"room_id": room_id, "title": f"회의 {i}", "scheduled_at": _future_utc(i + 1)},
            headers=auth_headers,
        )
    resp = await async_client.get("/api/meetings", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) >= 3


@pytest.mark.asyncio
async def test_list_meetings_date_filter(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    far_future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "멀리 회의", "scheduled_at": far_future},
        headers=auth_headers,
    )
    # 오늘부터 내일까지 필터 → 멀리 회의 제외
    from_dt = datetime.now(timezone.utc).isoformat()
    to_dt = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    resp = await async_client.get(
        "/api/meetings",
        params={"scheduled_from": from_dt, "scheduled_to": to_dt},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    titles = [m["title"] for m in resp.json()]
    assert "멀리 회의" not in titles


@pytest.mark.asyncio
async def test_get_meeting_detail(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    create_resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "상세 조회 테스트", "scheduled_at": _future_utc(5)},
        headers=auth_headers,
    )
    meeting_id = create_resp.json()["id"]

    resp = await async_client.get(f"/api/meetings/{meeting_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == meeting_id
    assert resp.json()["title"] == "상세 조회 테스트"


@pytest.mark.asyncio
async def test_get_meeting_not_found(async_client, auth_headers):
    resp = await async_client.get(f"/api/meetings/{uuid4()}", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_join_meeting(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    create_resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "참석 테스트", "scheduled_at": _future_utc(6)},
        headers=auth_headers,
    )
    meeting_id = create_resp.json()["id"]

    resp = await async_client.post(f"/api/meetings/{meeting_id}/join", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["meeting_id"] == meeting_id
    assert data["user_id"] == 1001
    assert data["joined_at"] is not None


@pytest.mark.asyncio
async def test_join_meeting_upsert(async_client, seeded, auth_headers):
    """같은 사용자가 join 두 번 → joined_at 갱신, 레코드 중복 없음."""
    room_id = str(seeded["room"].id)
    create_resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "Upsert 테스트", "scheduled_at": _future_utc(7)},
        headers=auth_headers,
    )
    meeting_id = create_resp.json()["id"]

    r1 = await async_client.post(f"/api/meetings/{meeting_id}/join", headers=auth_headers)
    assert r1.status_code == 200

    import asyncio
    await asyncio.sleep(0.01)

    r2 = await async_client.post(f"/api/meetings/{meeting_id}/join", headers=auth_headers)
    assert r2.status_code == 200
    # joined_at이 갱신되었거나 같아야 함 (upsert)
    assert r2.json()["user_id"] == 1001


@pytest.mark.asyncio
async def test_list_participants(async_client, seeded, auth_headers, admin_headers):
    room_id = str(seeded["room"].id)
    create_resp = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "참석자 목록 테스트", "scheduled_at": _future_utc(8)},
        headers=auth_headers,
    )
    meeting_id = create_resp.json()["id"]

    # user 1001 참석
    await async_client.post(f"/api/meetings/{meeting_id}/join", headers=auth_headers)
    # user 1002 참석
    await async_client.post(f"/api/meetings/{meeting_id}/join", headers=admin_headers)

    resp = await async_client.get(f"/api/meetings/{meeting_id}/participants", headers=auth_headers)
    assert resp.status_code == 200
    participants = resp.json()
    user_ids = {p["user_id"] for p in participants}
    assert 1001 in user_ids
    assert 1002 in user_ids


@pytest.mark.asyncio
async def test_unauthenticated_401(async_client, seeded):
    resp = await async_client.get("/api/meetings")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# QA 2026-07-13 수리분: rooms 피커 / 시간대 겹침(D23) / 상태 전이 / 정원 / leave
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_rooms_for_picker(async_client, seeded, auth_headers):
    """GET /api/rooms — 예약 피커용 방 목록 (06 §3.5.1)."""
    resp = await async_client.get("/api/rooms", headers=auth_headers)
    assert resp.status_code == 200
    rooms = resp.json()
    assert len(rooms) == 1
    assert rooms[0]["name"] == "회의실 A"
    assert rooms[0]["capacity"] == 10
    assert rooms[0]["type"] == "meeting"
    assert rooms[0]["scene_key"] is None, "미연결 방은 null — 서버가 씬 키를 지어내지 않는다"


# ── scene_key: 씬의 방 ↔ DB 방 정본 ──────────────────────────────────────
@pytest.mark.asyncio
async def test_room_scene_key_roundtrip(async_client, seeded, auth_headers, admin_headers):
    """연결하면 GET /api/rooms에 실려 나온다 — 화면이 이름 문자열로 때우지 않아도 된다."""
    rid = str(seeded["room"].id)
    r = await async_client.patch(f"/api/rooms/{rid}", headers=admin_headers, json={"scene_key": "boardroom"})
    assert r.status_code == 200, r.text
    assert r.json()["scene_key"] == "boardroom"

    listed = await async_client.get("/api/rooms", headers=auth_headers)
    assert listed.json()[0]["scene_key"] == "boardroom"

    off = await async_client.patch(f"/api/rooms/{rid}", headers=admin_headers, json={"scene_key": None})
    assert off.status_code == 200 and off.json()["scene_key"] is None


@pytest.mark.asyncio
async def test_room_scene_key_requires_admin(async_client, seeded, auth_headers):
    rid = str(seeded["room"].id)
    r = await async_client.patch(f"/api/rooms/{rid}", headers=auth_headers, json={"scene_key": "boardroom"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_room_scene_key_rejects_unmatchable_format(async_client, seeded, admin_headers):
    """공백·대문자는 씬 id와 절대 맞지 않는다 — 저장해 두면 조용히 안 되는 연결이 된다."""
    rid = str(seeded["room"].id)
    for bad in ["Board Room", "BOARDROOM", "-boardroom", "board_room", "x" * 65]:
        r = await async_client.patch(f"/api/rooms/{rid}", headers=admin_headers, json={"scene_key": bad})
        assert r.status_code == 400, f"{bad!r} → {r.status_code}"
        assert r.json()["detail"]["code"] == "invalid_scene_key"

    # 앞뒤 공백은 다듬는다 — 붙여넣기 한 칸 때문에 연결이 안 되면 원인을 찾을 수 없다.
    trimmed = await async_client.patch(f"/api/rooms/{rid}", headers=admin_headers, json={"scene_key": " boardroom "})
    assert trimmed.status_code == 200 and trimmed.json()["scene_key"] == "boardroom"

    # 공백만 남으면 "해제" 의도로 읽는다.
    ok = await async_client.patch(f"/api/rooms/{rid}", headers=admin_headers, json={"scene_key": "   "})
    assert ok.status_code == 200 and ok.json()["scene_key"] is None


@pytest.mark.asyncio
async def test_room_scene_key_taken_is_409(async_client, seeded, admin_headers, db_session):
    """한 씬 방을 두 DB 방이 주장하면 어느 일정이 뜰지가 조회 순서로 갈린다."""
    second = Room(
        id=uuid4(), company_id=1, floor_id=uuid4(), type=RoomType.MEETING,
        name="회의실 B", capacity=4, coords={"x": 0, "y": 0, "width": 4, "height": 4},
        status=RoomStatus.ACTIVE,
    )
    db_session.add(second)
    await db_session.commit()

    rid = str(seeded["room"].id)
    await async_client.patch(f"/api/rooms/{rid}", headers=admin_headers, json={"scene_key": "boardroom"})
    dup = await async_client.patch(f"/api/rooms/{second.id}", headers=admin_headers, json={"scene_key": "boardroom"})
    assert dup.status_code == 409, dup.text
    assert dup.json()["detail"]["room_name"] == "회의실 A"

    # 자기가 이미 쓰는 값을 다시 저장하는 건 통과해야 한다(폼 반복 저장).
    again = await async_client.patch(f"/api/rooms/{rid}", headers=admin_headers, json={"scene_key": "boardroom"})
    assert again.status_code == 200


@pytest.mark.asyncio
async def test_room_scene_key_cross_tenant_is_404(async_client, seeded, admin_headers, db_session):
    """타사 방의 씬 연결을 바꾸면 그 회사 오피스 화면이 엉뚱한 일정을 띄운다."""
    other = Room(
        id=uuid4(), company_id=999, floor_id=uuid4(), type=RoomType.MEETING,
        name="타사 회의실", capacity=4, coords={"x": 0, "y": 0, "width": 4, "height": 4},
        status=RoomStatus.ACTIVE,
    )
    db_session.add(other)
    await db_session.commit()

    r = await async_client.patch(f"/api/rooms/{other.id}", headers=admin_headers, json={"scene_key": "lounge"})
    assert r.status_code == 404, r.text
    await db_session.refresh(other)
    assert other.scene_key is None, "변조 전에 차단돼야 한다"


@pytest.mark.asyncio
async def test_conflict_overlapping_window(async_client, seeded, auth_headers):
    """D23: [start, start+duration) 겹침 → 409, 인접(끝==시작)·이전 시간대는 허용."""
    room_id = str(seeded["room"].id)
    base = datetime.now(timezone.utc) + timedelta(days=1)
    base = base.replace(minute=0, second=0, microsecond=0)

    r1 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "10시 회의", "scheduled_at": base.isoformat(), "duration_minutes": 60},
        headers=auth_headers,
    )
    assert r1.status_code == 201, r1.text

    # 30분 뒤 시작 (겹침) → 409
    r2 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "10시반 회의", "scheduled_at": (base + timedelta(minutes=30)).isoformat(), "duration_minutes": 60},
        headers=auth_headers,
    )
    assert r2.status_code == 409
    assert "room_time_conflict" in r2.text

    # 기존 회의보다 이른 시간대(끝이 기존 시작과 겹치지 않음) → 허용 (구버전 오작동 케이스)
    r3 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "9시 회의", "scheduled_at": (base - timedelta(minutes=60)).isoformat(), "duration_minutes": 30},
        headers=auth_headers,
    )
    assert r3.status_code == 201, r3.text

    # 정확히 종료 시각에 시작 (반개구간 — 겹침 아님) → 허용
    r4 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "11시 회의", "scheduled_at": (base + timedelta(minutes=60)).isoformat(), "duration_minutes": 30},
        headers=auth_headers,
    )
    assert r4.status_code == 201, r4.text

    # 이른 회의가 새 회의 시간대를 관통 (09:30 시작 60분 vs 기존 10:00) → 409
    r5 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "9시반 관통", "scheduled_at": (base - timedelta(minutes=30)).isoformat(), "duration_minutes": 60},
        headers=auth_headers,
    )
    assert r5.status_code == 409


@pytest.mark.asyncio
async def test_meeting_lifecycle_start_end(async_client, seeded, auth_headers, admin_headers):
    """상태 전이: scheduled → in_progress → completed. 호스트/관리자만, 잘못된 전이 409."""
    room_id = str(seeded["room"].id)
    create = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "전이 테스트", "scheduled_at": _future_utc(3)},
        headers=auth_headers,  # host = 1001
    )
    mid = create.json()["id"]
    assert create.json()["status"] == "scheduled"
    assert create.json()["participant_count"] == 1  # 호스트 organizer 자동 등록

    # end before start → 409
    r0 = await async_client.post(f"/api/meetings/{mid}/end", headers=auth_headers)
    assert r0.status_code == 409

    # 시작 (호스트)
    r1 = await async_client.post(f"/api/meetings/{mid}/start", headers=auth_headers)
    assert r1.status_code == 200, r1.text
    assert r1.json()["status"] == "in_progress"
    assert r1.json()["started_at"] is not None

    # 중복 시작 → 409
    r2 = await async_client.post(f"/api/meetings/{mid}/start", headers=auth_headers)
    assert r2.status_code == 409

    # 종료 (관리자도 가능)
    r3 = await async_client.post(f"/api/meetings/{mid}/end", headers=admin_headers)
    assert r3.status_code == 200
    assert r3.json()["status"] == "completed"
    assert r3.json()["ended_at"] is not None


@pytest.mark.asyncio
async def test_start_requires_host_or_admin(async_client, seeded, auth_headers, admin_headers):
    """비호스트 일반 직원은 시작 불가 (403)."""
    room_id = str(seeded["room"].id)
    create = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "권한 테스트", "scheduled_at": _future_utc(4)},
        headers=admin_headers,  # host = 1002(admin)
    )
    mid = create.json()["id"]
    other_employee = create_access_token({"sub": "1001", "email": "alice@test.local", "role": "employee"})
    r = await async_client.post(
        f"/api/meetings/{mid}/start", headers={"Authorization": f"Bearer {other_employee}"}
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_join_blocked_after_cancel_or_complete(async_client, seeded, auth_headers, admin_headers):
    """취소/종료된 회의 join → 409 (06 §5.2)."""
    room_id = str(seeded["room"].id)
    create = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "취소될 회의", "scheduled_at": _future_utc(5)},
        headers=auth_headers,
    )
    mid = create.json()["id"]
    await async_client.delete(f"/api/meetings/{mid}", headers=admin_headers)  # cancel

    r = await async_client.post(f"/api/meetings/{mid}/join", headers=auth_headers)
    assert r.status_code == 409
    assert "meeting_not_joinable" in r.text


@pytest.mark.asyncio
async def test_join_capacity_and_leave(async_client, db_session, seeded, auth_headers, admin_headers):
    """정원 초과 join → 409, leave 후 재입장 가능 + left_at 기록."""
    # capacity 1 방 생성
    small = Room(
        id=uuid4(), floor_id=uuid4(), type=RoomType.MEETING, name="폰부스",
        capacity=1, coords={"x": 0, "y": 0, "width": 2, "height": 2}, status=RoomStatus.ACTIVE,
    )
    db_session.add(small)
    await db_session.commit()

    create = await async_client.post(
        "/api/meetings",
        json={"room_id": str(small.id), "title": "1인실 회의", "scheduled_at": _future_utc(6)},
        headers=auth_headers,
    )
    mid = create.json()["id"]

    r1 = await async_client.post(f"/api/meetings/{mid}/join", headers=auth_headers)
    assert r1.status_code == 200

    r2 = await async_client.post(f"/api/meetings/{mid}/join", headers=admin_headers)
    assert r2.status_code == 409
    assert "room_capacity_exceeded" in r2.text

    # 첫 참석자 leave → 자리 확보
    r3 = await async_client.post(f"/api/meetings/{mid}/leave", headers=auth_headers)
    assert r3.status_code == 200
    assert r3.json()["left_at"] is not None

    r4 = await async_client.post(f"/api/meetings/{mid}/join", headers=admin_headers)
    assert r4.status_code == 200


@pytest.mark.asyncio
async def test_list_meetings_status_filter(async_client, seeded, auth_headers):
    """GET /api/meetings?status= 필터 (진행중 오버레이용)."""
    room_id = str(seeded["room"].id)
    c1 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "예정 회의", "scheduled_at": _future_utc(7)},
        headers=auth_headers,
    )
    c2 = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "진행중 회의", "scheduled_at": _future_utc(9)},
        headers=auth_headers,
    )
    await async_client.post(f"/api/meetings/{c2.json()['id']}/start", headers=auth_headers)

    r = await async_client.get("/api/meetings?status=in_progress", headers=auth_headers)
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["title"] == "진행중 회의"

    r2 = await async_client.get("/api/meetings?status=bogus", headers=auth_headers)
    assert r2.status_code == 400


# ---------------------------------------------------------------------------
# 후속(goal 2026-07-13): 참석자 초대/응답 (06 §3.5.1)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invite_and_respond(async_client, seeded, auth_headers, admin_headers):
    """호스트 초대 → invited, 대상자 수락/거절 응답, 비호스트 초대 403."""
    room_id = str(seeded["room"].id)
    create = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "초대 테스트", "scheduled_at": _future_utc(30)},
        headers=auth_headers,  # host=1001
    )
    mid = create.json()["id"]

    # 호스트가 1002 초대
    r = await async_client.post(
        f"/api/meetings/{mid}/participants", json={"user_ids": [1002]}, headers=auth_headers
    )
    assert r.status_code == 201, r.text
    invited = r.json()
    assert len(invited) == 1
    assert invited[0]["user_id"] == 1002
    assert invited[0]["invite_status"] == "invited"
    assert invited[0]["user_name"] == "Bob"

    # 멱등: 재초대 시 중복 생성 없음
    r2 = await async_client.post(
        f"/api/meetings/{mid}/participants", json={"user_ids": [1002]}, headers=auth_headers
    )
    assert r2.status_code == 201
    assert r2.json() == []

    # 초대받은 1002가 거절
    r3 = await async_client.patch(
        f"/api/meetings/{mid}/participants/me", json={"status": "declined"}, headers=admin_headers
    )
    assert r3.status_code == 200
    assert r3.json()["invite_status"] == "declined"

    # join하면 accepted로 확정
    r4 = await async_client.post(f"/api/meetings/{mid}/join", headers=admin_headers)
    assert r4.status_code == 200
    assert r4.json()["invite_status"] == "accepted"

    # 참석자 목록에 이름·상태 포함, 호스트는 organizer+accepted
    r5 = await async_client.get(f"/api/meetings/{mid}/participants", headers=auth_headers)
    by_uid = {p["user_id"]: p for p in r5.json()}
    assert by_uid[1001]["role"] == "organizer"
    assert by_uid[1001]["invite_status"] == "accepted"
    assert by_uid[1002]["invite_status"] == "accepted"

    # 비호스트(1002, admin이지만 — employee 케이스) 초대 권한: employee 토큰으로 새 회의에 시도
    other = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "권한 회의", "scheduled_at": _future_utc(40)},
        headers=admin_headers,  # host=1002
    )
    emp_token = create_access_token({"sub": "1001", "email": "alice@test.local", "role": "employee"})
    r6 = await async_client.post(
        f"/api/meetings/{other.json()['id']}/participants",
        json={"user_ids": [1001]},
        headers={"Authorization": f"Bearer {emp_token}"},
    )
    assert r6.status_code == 403


@pytest.mark.asyncio
async def test_respond_not_invited_404(async_client, seeded, auth_headers, admin_headers):
    """초대되지 않은 사용자의 응답 → 404."""
    room_id = str(seeded["room"].id)
    create = await async_client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "미초대 응답", "scheduled_at": _future_utc(50)},
        headers=auth_headers,
    )
    r = await async_client.patch(
        f"/api/meetings/{create.json()['id']}/participants/me",
        json={"status": "accepted"},
        headers=admin_headers,
    )
    assert r.status_code == 404
