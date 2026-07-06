"""
업무 로그 CRUD + 요약 통합 테스트 (Lane A, G001).

검증 범위:
1.  POST /api/work-logs — 생성 (본인)
2.  POST /api/work-logs — 관리자가 타인 대신 생성
3.  POST /api/work-logs — 비관리자가 타인 지정 → 403
4.  GET  /api/work-logs — 본인 목록 조회
5.  GET  /api/work-logs — work_date 범위 필터
6.  GET  /api/work-logs — category 필터
7.  GET  /api/work-logs — status 필터
8.  GET  /api/work-logs/{id} — 단건 조회 (본인)
9.  GET  /api/work-logs/{id} — 타인 조회 (비관리자) → 403
10. GET  /api/work-logs/{id} — 타인 조회 (관리자) → 200
11. PATCH /api/work-logs/{id} — 필드 수정
12. PATCH /api/work-logs/{id} — completed 전이 → completed_at 기록
13. PATCH /api/work-logs/{id} — completed → started 역전환 → completed_at 초기화
14. DELETE /api/work-logs/{id} — STARTED 삭제 허용
15. DELETE /api/work-logs/{id} — COMPLETED 삭제 → 409
16. DELETE /api/work-logs/{id} — 타인 삭제 (비관리자) → 403
17. GET  /api/work-logs/summary — daily 집계
18. GET  /api/work-logs/summary — monthly 집계 + 카테고리 분포

참조: 04-data-model.md §2.3, D14-a, D18, D19
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db import Base, get_db
from app.main import app


# ---------------------------------------------------------------------------
# 픽스처
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """테스트별 독립 인메모리 SQLite."""
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
def emp_token() -> str:
    """user_id=1, role=employee"""
    return create_access_token({"sub": "1", "email": "emp@test.local", "role": "employee"})


@pytest.fixture
def emp2_token() -> str:
    """user_id=2, role=employee"""
    return create_access_token({"sub": "2", "email": "emp2@test.local", "role": "employee"})


@pytest.fixture
def admin_token() -> str:
    """user_id=99, role=admin"""
    return create_access_token({"sub": "99", "email": "admin@test.local", "role": "admin"})


@pytest.fixture
def leader_token() -> str:
    """user_id=50, role=leader"""
    return create_access_token({"sub": "50", "email": "leader@test.local", "role": "leader"})


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------

def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


TODAY = date.today().isoformat()


async def _create_log(client: AsyncClient, token: str, **kwargs) -> dict:
    """helper: POST /api/work-logs and return json."""
    payload = {
        "work_date": TODAY,
        "title": "Test Task",
        "status": "started",
        **kwargs,
    }
    resp = await client.post("/api/work-logs", json=payload, headers=auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# 1. 생성 — 본인
# ---------------------------------------------------------------------------

async def test_create_own(async_client: AsyncClient, emp_token: str):
    """POST /api/work-logs — 본인 소유 생성."""
    data = await _create_log(async_client, emp_token, category="dev", est_minutes=60)
    assert data["user_id"] == 1
    assert data["title"] == "Test Task"
    assert data["status"] == "started"
    assert data["category"] == "dev"
    assert data["est_minutes"] == 60
    assert data["completed_at"] is None
    assert "id" in data


# ---------------------------------------------------------------------------
# 2. 생성 — 관리자가 타인 대신
# ---------------------------------------------------------------------------

async def test_create_for_other_as_admin(async_client: AsyncClient, admin_token: str):
    """관리자는 user_id 타인 지정 가능."""
    data = await _create_log(async_client, admin_token, user_id=10)
    assert data["user_id"] == 10


# ---------------------------------------------------------------------------
# 3. 생성 — 비관리자 타인 지정 → 403
# ---------------------------------------------------------------------------

async def test_create_for_other_as_employee_forbidden(async_client: AsyncClient, emp_token: str):
    """비관리자가 다른 user_id 지정하면 403."""
    resp = await async_client.post(
        "/api/work-logs",
        json={"work_date": TODAY, "title": "X", "status": "started", "user_id": 999},
        headers=auth(emp_token),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 4. 목록 조회 — 본인
# ---------------------------------------------------------------------------

async def test_list_own(async_client: AsyncClient, emp_token: str):
    """GET /api/work-logs — 본인 로그만 반환."""
    await _create_log(async_client, emp_token, title="Log A")
    await _create_log(async_client, emp_token, title="Log B")
    resp = await async_client.get("/api/work-logs", headers=auth(emp_token))
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert all(d["user_id"] == 1 for d in data)


# ---------------------------------------------------------------------------
# 5. 필터 — work_date 범위
# ---------------------------------------------------------------------------

async def test_filter_date_range(async_client: AsyncClient, emp_token: str):
    """start_date / end_date 필터 작동 확인."""
    today = date.today()
    yesterday = (today - timedelta(days=1)).isoformat()
    tomorrow = (today + timedelta(days=1)).isoformat()

    await _create_log(async_client, emp_token, work_date=yesterday, title="Yesterday")
    await _create_log(async_client, emp_token, work_date=today.isoformat(), title="Today")
    await _create_log(async_client, emp_token, work_date=tomorrow, title="Tomorrow")

    # 오늘만
    resp = await async_client.get(
        "/api/work-logs",
        params={"start_date": today.isoformat(), "end_date": today.isoformat()},
        headers=auth(emp_token),
    )
    assert resp.status_code == 200
    titles = [d["title"] for d in resp.json()]
    assert "Today" in titles
    assert "Yesterday" not in titles
    assert "Tomorrow" not in titles


# ---------------------------------------------------------------------------
# 6. 필터 — category
# ---------------------------------------------------------------------------

async def test_filter_category(async_client: AsyncClient, emp_token: str):
    """category 필터."""
    await _create_log(async_client, emp_token, category="dev", title="Dev Task")
    await _create_log(async_client, emp_token, category="review", title="Review Task")

    resp = await async_client.get("/api/work-logs", params={"category": "dev"}, headers=auth(emp_token))
    assert resp.status_code == 200
    data = resp.json()
    assert all(d["category"] == "dev" for d in data)
    assert len(data) == 1


# ---------------------------------------------------------------------------
# 7. 필터 — status
# ---------------------------------------------------------------------------

async def test_filter_status(async_client: AsyncClient, emp_token: str):
    """status 필터."""
    await _create_log(async_client, emp_token, status="started", title="Started")
    await _create_log(async_client, emp_token, status="completed", title="Done")

    resp = await async_client.get(
        "/api/work-logs", params={"status": "completed"}, headers=auth(emp_token)
    )
    assert resp.status_code == 200
    data = resp.json()
    assert all(d["status"] == "completed" for d in data)


# ---------------------------------------------------------------------------
# 8. 단건 조회 — 본인
# ---------------------------------------------------------------------------

async def test_get_own(async_client: AsyncClient, emp_token: str):
    """GET /api/work-logs/{id} 본인 조회."""
    created = await _create_log(async_client, emp_token)
    resp = await async_client.get(f"/api/work-logs/{created['id']}", headers=auth(emp_token))
    assert resp.status_code == 200
    assert resp.json()["id"] == created["id"]


# ---------------------------------------------------------------------------
# 9. 단건 조회 — 타인 비관리자 → 403
# ---------------------------------------------------------------------------

async def test_get_other_as_employee_forbidden(
    async_client: AsyncClient, emp_token: str, emp2_token: str
):
    """비관리자는 타인 로그 단건 조회 불가."""
    created = await _create_log(async_client, emp_token)  # user_id=1
    # user_id=2가 조회
    resp = await async_client.get(f"/api/work-logs/{created['id']}", headers=auth(emp2_token))
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 10. 단건 조회 — 관리자 타인 조회 허용
# ---------------------------------------------------------------------------

async def test_get_other_as_admin(
    async_client: AsyncClient, emp_token: str, admin_token: str
):
    """관리자는 타인 로그 단건 조회 가능."""
    created = await _create_log(async_client, emp_token)
    resp = await async_client.get(f"/api/work-logs/{created['id']}", headers=auth(admin_token))
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# 11. PATCH — 필드 수정
# ---------------------------------------------------------------------------

async def test_patch_fields(async_client: AsyncClient, emp_token: str):
    """PATCH /api/work-logs/{id} 필드 수정."""
    created = await _create_log(async_client, emp_token, title="Original")
    resp = await async_client.patch(
        f"/api/work-logs/{created['id']}",
        json={"title": "Updated", "actual_minutes": 90},
        headers=auth(emp_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Updated"
    assert data["actual_minutes"] == 90


# ---------------------------------------------------------------------------
# 12. PATCH — completed 전이 → completed_at 기록
# ---------------------------------------------------------------------------

async def test_patch_completed_transition(async_client: AsyncClient, emp_token: str):
    """status → completed 전이 시 completed_at 자동 기록 (D14-a)."""
    created = await _create_log(async_client, emp_token, status="started")
    assert created["completed_at"] is None

    resp = await async_client.patch(
        f"/api/work-logs/{created['id']}",
        json={"status": "completed"},
        headers=auth(emp_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "completed"
    assert data["completed_at"] is not None, "completed_at must be set on completed transition"


# ---------------------------------------------------------------------------
# 13. PATCH — completed → started 역전환 → completed_at 초기화
# ---------------------------------------------------------------------------

async def test_patch_uncomplete_clears_completed_at(async_client: AsyncClient, emp_token: str):
    """completed → started 역전환 시 completed_at 초기화."""
    created = await _create_log(async_client, emp_token, status="completed")
    assert created["completed_at"] is not None

    resp = await async_client.patch(
        f"/api/work-logs/{created['id']}",
        json={"status": "started"},
        headers=auth(emp_token),
    )
    assert resp.status_code == 200
    assert resp.json()["completed_at"] is None


# ---------------------------------------------------------------------------
# 14. DELETE — STARTED 삭제 허용
# ---------------------------------------------------------------------------

async def test_delete_started(async_client: AsyncClient, emp_token: str):
    """STARTED 상태 로그 삭제 가능."""
    created = await _create_log(async_client, emp_token, status="started")
    resp = await async_client.delete(
        f"/api/work-logs/{created['id']}", headers=auth(emp_token)
    )
    assert resp.status_code == 204

    # 삭제 후 404 확인
    resp2 = await async_client.get(f"/api/work-logs/{created['id']}", headers=auth(emp_token))
    assert resp2.status_code == 404


# ---------------------------------------------------------------------------
# 15. DELETE — COMPLETED 삭제 → 409
# ---------------------------------------------------------------------------

async def test_delete_completed_blocked(async_client: AsyncClient, emp_token: str):
    """D14-a/D18: COMPLETED 로그 삭제 불허 → 409."""
    created = await _create_log(async_client, emp_token, status="completed")
    resp = await async_client.delete(
        f"/api/work-logs/{created['id']}", headers=auth(emp_token)
    )
    assert resp.status_code == 409
    assert "cannot_delete_completed" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# 16. DELETE — 타인 삭제 비관리자 → 403
# ---------------------------------------------------------------------------

async def test_delete_other_as_employee_forbidden(
    async_client: AsyncClient, emp_token: str, emp2_token: str
):
    """비관리자는 타인 로그 삭제 불가."""
    created = await _create_log(async_client, emp_token)  # user_id=1, started
    resp = await async_client.delete(
        f"/api/work-logs/{created['id']}", headers=auth(emp2_token)
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 17. 요약 — daily 집계
# ---------------------------------------------------------------------------

async def test_summary_daily(async_client: AsyncClient, emp_token: str):
    """GET /api/work-logs/summary — daily period_type 집계."""
    today = date.today().isoformat()
    await _create_log(async_client, emp_token, work_date=today, category="dev", status="completed", actual_minutes=60)
    await _create_log(async_client, emp_token, work_date=today, category="review", status="started", actual_minutes=30)

    resp = await async_client.get(
        "/api/work-logs/summary",
        params={"period_type": "daily"},
        headers=auth(emp_token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["period_type"] == "daily"
    periods = body["periods"]
    assert len(periods) >= 1

    # 오늘 집계
    today_entry = next((p for p in periods if p["period"] == today), None)
    assert today_entry is not None
    assert today_entry["total_count"] == 2
    assert today_entry["completed_count"] == 1
    assert today_entry["started_count"] == 1
    assert today_entry["total_actual_minutes"] == 90
    assert "dev" in today_entry["categories"]
    assert "review" in today_entry["categories"]


# ---------------------------------------------------------------------------
# 18. 요약 — monthly 집계 + 카테고리 분포
# ---------------------------------------------------------------------------

async def test_summary_monthly(async_client: AsyncClient, emp_token: str):
    """GET /api/work-logs/summary — monthly 집계 + 카테고리 분포 확인."""
    today = date.today()
    month_key = today.strftime("%Y-%m")

    await _create_log(async_client, emp_token, category="dev", actual_minutes=120, status="completed")
    await _create_log(async_client, emp_token, category="dev", actual_minutes=60, status="completed")
    await _create_log(async_client, emp_token, category="meeting", actual_minutes=30, status="started")

    resp = await async_client.get(
        "/api/work-logs/summary",
        params={"period_type": "monthly"},
        headers=auth(emp_token),
    )
    assert resp.status_code == 200
    body = resp.json()
    month_entry = next((p for p in body["periods"] if p["period"] == month_key), None)
    assert month_entry is not None
    assert month_entry["total_count"] == 3
    assert month_entry["completed_count"] == 2
    cats = month_entry["categories"]
    assert cats.get("dev") == 2
    assert cats.get("meeting") == 1
    assert month_entry["total_actual_minutes"] == 210


# ---------------------------------------------------------------------------
# 19. 요약 — 잘못된 period_type → 400
# ---------------------------------------------------------------------------

async def test_summary_invalid_period_type(async_client: AsyncClient, emp_token: str):
    resp = await async_client.get(
        "/api/work-logs/summary",
        params={"period_type": "hourly"},
        headers=auth(emp_token),
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# 20. completed 생성 시 completed_at 즉시 기록
# ---------------------------------------------------------------------------

async def test_create_completed_sets_completed_at(async_client: AsyncClient, emp_token: str):
    """status=completed로 생성 시 completed_at 즉시 기록 (D14-a)."""
    data = await _create_log(async_client, emp_token, status="completed")
    assert data["status"] == "completed"
    assert data["completed_at"] is not None


# ---------------------------------------------------------------------------
# 21. leader 권한으로 타인 로그 조회
# ---------------------------------------------------------------------------

async def test_leader_can_read_other(
    async_client: AsyncClient, emp_token: str, leader_token: str
):
    """leader 역할도 타인 로그 조회 가능 (ADMIN_ROLES에 leader 포함)."""
    created = await _create_log(async_client, emp_token)
    resp = await async_client.get(f"/api/work-logs/{created['id']}", headers=auth(leader_token))
    assert resp.status_code == 200
