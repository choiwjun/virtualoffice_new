"""
meeting_minutes API 통합 테스트 — G002 Lane B

검증 범위:
1. POST /api/meeting-minutes — 회의록 생성 (draft)
2. POST /api/meeting-minutes — 동일 meeting 중복 → 409
3. GET  /api/meeting-minutes — 목록 / meeting_id 필터
4. GET  /api/meeting-minutes/{id} — 상세
5. PATCH /api/meeting-minutes/{id} — 수정 (draft 상태)
6. PATCH /api/meeting-minutes/{id} — finalized 후 수정 → 409
7. POST /api/meeting-minutes/{id}/finalize — draft→finalized
8. POST /api/meeting-minutes/{id}/finalize — 이미 finalized → 409
9. POST /api/meeting-minutes/{id}/stt-draft → 501
10. POST /api/meeting-minutes/{id}/action-items — 생성
11. GET  /api/meeting-minutes/{id}/action-items — 목록
12. PATCH /api/meeting-minutes/{id}/action-items/{item_id} — 수정 + completed 전이
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import AsyncGenerator
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db import Base, get_db
from app.main import app
from app.models.tables import (
    ErpUser,
    ErpRole,
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
    """기본 시드 (SQLite FK 미적용 — Office/Floor 불필요)."""
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

    for uid, email, name, role in [
        (1001, "alice@test.local", "Alice", ErpRole.EMPLOYEE),
        (1002, "bob@test.local", "Bob", ErpRole.ADMIN),
    ]:
        db_session.add(
            ErpUser(id=uid, company_id=1, email=email, name=name, erp_team_id=1, role=role)
        )

    await db_session.commit()
    return {"room": room}


async def _create_meeting(client, room_id: str, headers: dict, offset_hours: int = 2) -> str:
    """공통 헬퍼: 회의 생성 후 ID 반환."""
    scheduled = (datetime.now(timezone.utc) + timedelta(hours=offset_hours)).isoformat()
    resp = await client.post(
        "/api/meetings",
        json={"room_id": room_id, "title": "테스트 회의", "scheduled_at": scheduled},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _create_minute(client, meeting_id: str, headers: dict) -> str:
    """공통 헬퍼: 회의록 생성 후 ID 반환."""
    resp = await client.post(
        "/api/meeting-minutes",
        json={
            "meeting_id": meeting_id,
            "decisions": "Q3 일정 확정",
            "notes": "추가 노트",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# 회의록 테스트
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_minute_success(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers)

    resp = await async_client.post(
        "/api/meeting-minutes",
        json={"meeting_id": meeting_id, "decisions": "결정: API 설계 확정"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["meeting_id"] == meeting_id
    assert data["status"] == "draft"
    assert data["created_by"] == 1001
    assert data["decisions"] == "결정: API 설계 확정"


@pytest.mark.asyncio
async def test_create_minute_meeting_not_found(async_client, seeded, auth_headers):
    resp = await async_client.post(
        "/api/meeting-minutes",
        json={"meeting_id": str(uuid4()), "decisions": "결정"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_minute_duplicate_409(async_client, seeded, auth_headers):
    """동일 meeting에 두 번째 회의록 → 409."""
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=10)
    await _create_minute(async_client, meeting_id, auth_headers)

    resp = await async_client.post(
        "/api/meeting-minutes",
        json={"meeting_id": meeting_id, "decisions": "중복"},
        headers=auth_headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_list_minutes(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    # 여러 회의 + 회의록 생성 (각 meeting당 1개 제한)
    for offset in range(12, 15):
        mid = await _create_meeting(async_client, room_id, auth_headers, offset_hours=offset)
        await _create_minute(async_client, mid, auth_headers)

    resp = await async_client.get("/api/meeting-minutes", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) >= 3


@pytest.mark.asyncio
async def test_list_minutes_filter_by_meeting(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    mid1 = await _create_meeting(async_client, room_id, auth_headers, offset_hours=20)
    mid2 = await _create_meeting(async_client, room_id, auth_headers, offset_hours=21)
    await _create_minute(async_client, mid1, auth_headers)
    await _create_minute(async_client, mid2, auth_headers)

    resp = await async_client.get(
        "/api/meeting-minutes",
        params={"meeting_id": mid1},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert all(m["meeting_id"] == mid1 for m in resp.json())


@pytest.mark.asyncio
async def test_get_minute_detail(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=30)
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    resp = await async_client.get(f"/api/meeting-minutes/{minute_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == minute_id


@pytest.mark.asyncio
async def test_get_minute_not_found(async_client, auth_headers):
    resp = await async_client.get(f"/api/meeting-minutes/{uuid4()}", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_minute(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=40)
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    resp = await async_client.patch(
        f"/api/meeting-minutes/{minute_id}",
        json={"decisions": "수정된 결정사항", "notes": "수정된 노트"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["decisions"] == "수정된 결정사항"
    assert data["notes"] == "수정된 노트"


@pytest.mark.asyncio
async def test_finalize_minute(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=50)
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    resp = await async_client.post(
        f"/api/meeting-minutes/{minute_id}/finalize",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "finalized"
    assert resp.json()["reviewed_by"] == 1001


@pytest.mark.asyncio
async def test_finalize_already_finalized_409(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=60)
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    await async_client.post(f"/api/meeting-minutes/{minute_id}/finalize", headers=auth_headers)
    resp = await async_client.post(
        f"/api/meeting-minutes/{minute_id}/finalize", headers=auth_headers
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_patch_finalized_409(async_client, seeded, auth_headers):
    """확정된 회의록 수정 → 409."""
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=70)
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    await async_client.post(f"/api/meeting-minutes/{minute_id}/finalize", headers=auth_headers)
    resp = await async_client.patch(
        f"/api/meeting-minutes/{minute_id}",
        json={"decisions": "변경 시도"},
        headers=auth_headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_stt_draft_501(async_client, seeded, auth_headers):
    """STT 초안 엔드포인트 → 501 Not Implemented."""
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=80)
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    resp = await async_client.post(
        f"/api/meeting-minutes/{minute_id}/stt-draft",
        headers=auth_headers,
    )
    assert resp.status_code == 501


# ---------------------------------------------------------------------------
# 액션아이템 테스트
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_action_item(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=90)
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    resp = await async_client.post(
        f"/api/meeting-minutes/{minute_id}/action-items",
        json={
            "title": "API 문서 작성",
            "assignee_user_id": 1001,
            "due_date": "2026-08-01",
            "priority": "high",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "API 문서 작성"
    assert data["assignee_user_id"] == 1001
    assert data["status"] == "open"
    assert data["priority"] == "high"
    assert data["due_date"] == "2026-08-01"


@pytest.mark.asyncio
async def test_list_action_items(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=100)
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    for i in range(3):
        await async_client.post(
            f"/api/meeting-minutes/{minute_id}/action-items",
            json={
                "title": f"할일 {i}",
                "assignee_user_id": 1001,
                "due_date": f"2026-08-0{i+1}",
            },
            headers=auth_headers,
        )

    resp = await async_client.get(
        f"/api/meeting-minutes/{minute_id}/action-items",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 3


@pytest.mark.asyncio
async def test_patch_action_item_complete_transition(async_client, seeded, auth_headers):
    """status → completed 전이 시 completed_at 설정."""
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=110)
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    create_resp = await async_client.post(
        f"/api/meeting-minutes/{minute_id}/action-items",
        json={"title": "완료 테스트", "assignee_user_id": 1001, "due_date": "2026-08-15"},
        headers=auth_headers,
    )
    item_id = create_resp.json()["id"]

    patch_resp = await async_client.patch(
        f"/api/meeting-minutes/{minute_id}/action-items/{item_id}",
        json={"status": "completed", "completed_evidence_url": "https://example.com/result"},
        headers=auth_headers,
    )
    assert patch_resp.status_code == 200
    data = patch_resp.json()
    assert data["status"] == "completed"
    assert data["completed_at"] is not None
    assert data["completed_evidence_url"] == "https://example.com/result"


@pytest.mark.asyncio
async def test_patch_action_item_fields(async_client, seeded, auth_headers):
    """액션아이템 필드 수정."""
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=120)
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    create_resp = await async_client.post(
        f"/api/meeting-minutes/{minute_id}/action-items",
        json={"title": "초기 제목", "assignee_user_id": 1001, "due_date": "2026-08-20"},
        headers=auth_headers,
    )
    item_id = create_resp.json()["id"]

    patch_resp = await async_client.patch(
        f"/api/meeting-minutes/{minute_id}/action-items/{item_id}",
        json={"title": "수정된 제목", "priority": "low", "status": "in_progress"},
        headers=auth_headers,
    )
    assert patch_resp.status_code == 200
    data = patch_resp.json()
    assert data["title"] == "수정된 제목"
    assert data["priority"] == "low"
    assert data["status"] == "in_progress"
    assert data["completed_at"] is None  # in_progress는 completed_at 없음


@pytest.mark.asyncio
async def test_action_item_not_found(async_client, seeded, auth_headers):
    room_id = str(seeded["room"].id)
    meeting_id = await _create_meeting(async_client, room_id, auth_headers, offset_hours=130)
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    resp = await async_client.patch(
        f"/api/meeting-minutes/{minute_id}/action-items/{uuid4()}",
        json={"title": "없는 항목"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_minute_other_user_forbidden(async_client, seeded, auth_headers, admin_headers):
    """기록자도 아니고 관리자도 아닌 사용자가 수정 시도 → 403."""
    room_id = str(seeded["room"].id)
    # admin이 회의 생성
    meeting_id = await _create_meeting(async_client, room_id, admin_headers, offset_hours=140)

    # alice (user 1001) 가 회의록 생성
    minute_id = await _create_minute(async_client, meeting_id, auth_headers)

    # admin (1002, role=admin) 이 수정 → 성공 (admin은 허용)
    resp = await async_client.patch(
        f"/api/meeting-minutes/{minute_id}",
        json={"notes": "관리자 수정"},
        headers=admin_headers,
    )
    assert resp.status_code == 200

    # 다른 employee가 수정 시도를 테스트하기 위해 employee 토큰 생성
    other_token = create_access_token(
        {"sub": "1003", "email": "charlie@test.local", "role": "employee"}
    )
    other_headers = {"Authorization": f"Bearer {other_token}"}

    resp2 = await async_client.patch(
        f"/api/meeting-minutes/{minute_id}",
        json={"notes": "타인 수정 시도"},
        headers=other_headers,
    )
    assert resp2.status_code == 403
