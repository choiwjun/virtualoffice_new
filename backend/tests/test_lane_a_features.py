"""
Lane A 기능 테스트 — APScheduler 배치, 신규 API, 로그인 백오프.

- Scheduler: KPI/ERP 배치 작업 (단위 테스트, 실제 스케줄은 통합 테스트)
- GET /api/seat-assignments: 배정 이력 조회
- GET /api/daily-status-push: ERP 전송 큐 조회
- Login backoff: 5회 실패 시 5분 잠금
"""

import pytest
from datetime import date, datetime, timezone, timedelta
from uuid import uuid4


from app.models.tables import (
    ErpRole,
    DailyStatusPush,
    DailyStatusPushStatus,
    DailyStatusPushTarget,
    ErpUser,
    Floor,
    Seat,
    SeatAssignmentHistory,
    SeatStatus,
)
from app.core.security import hash_password

# ── conftest 픽스처 별칭 (async_client/auth_headers/admin_auth_headers) ──────────
@pytest.fixture
def client(async_client):
    return async_client


@pytest.fixture
def admin_headers(admin_auth_headers):
    return admin_auth_headers


@pytest.fixture
def user_headers(auth_headers):
    return auth_headers


@pytest.fixture(autouse=True)
def _reset_login_backoff():
    """in-memory 로그인 백오프 전역 상태를 테스트 간 격리."""
    from app.api import auth as _auth
    _auth._login_attempts.clear()
    yield
    _auth._login_attempts.clear()


@pytest.fixture
async def seed_users(db_session):
    """alice/bob 시드 (password123) — 로그인 백오프 테스트용."""
    users = [
        ErpUser(id=1001, company_id=1, email="alice@virtualoffice.local", name="김앨리스",
                erp_team_id=1, role=ErpRole.ADMIN, position="CTO",
                password_hash=hash_password("password123"), is_active=True),
        ErpUser(id=1002, company_id=1, email="bob@virtualoffice.local", name="이밥",
                erp_team_id=1, role=ErpRole.LEADER, position="개발팀장",
                password_hash=hash_password("password123"), is_active=True),
    ]
    for u in users:
        db_session.add(u)
    await db_session.commit()
    return users


# ── GET /api/seat-assignments ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_seat_assignments_query_empty(client, admin_headers, db_session):
    """배정 이력 없을 때 빈 배열."""
    resp = await client.get("/api/seat-assignments", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_seat_assignments_query_with_data(client, admin_headers, db_session):
    """배정 이력 조회 (seat_id/user_id 필터)."""
    # 준비: floor, seat, history
    floor = Floor(id=uuid4(), office_id=uuid4(), level=1, name="테스트층")
    seat1 = Seat(id=uuid4(), floor_id=floor.id, type="desk", status=SeatStatus.AVAILABLE, coords={"x": 1, "y": 1})
    seat2 = Seat(id=uuid4(), floor_id=floor.id, type="desk", status=SeatStatus.AVAILABLE, coords={"x": 2, "y": 2})
    db_session.add_all([floor, seat1, seat2])
    
    now = datetime.now(timezone.utc)
    hist1 = SeatAssignmentHistory(
        id=uuid4(), seat_id=seat1.id, user_id=1001, assigned_at=now,
        assigned_by=1001, reason="test"
    )
    hist2 = SeatAssignmentHistory(
        id=uuid4(), seat_id=seat2.id, user_id=1002, assigned_at=now + timedelta(seconds=10),
        assigned_by=1001
    )
    db_session.add_all([hist1, hist2])
    await db_session.commit()
    
    # 전체 조회
    resp = await client.get("/api/seat-assignments", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["user_id"] == 1002  # 최신순
    assert data[1]["user_id"] == 1001
    
    # seat_id 필터
    resp = await client.get(f"/api/seat-assignments?seat_id={seat1.id}", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["seat_id"] == str(seat1.id)
    
    # user_id 필터
    resp = await client.get("/api/seat-assignments?user_id=1002", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["user_id"] == 1002


@pytest.mark.asyncio
async def test_seat_assignments_requires_admin(client, user_headers):
    """비관리자는 403."""
    resp = await client.get("/api/seat-assignments", headers=user_headers)
    assert resp.status_code == 403


# ── GET /api/daily-status-push ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_daily_status_push_query_empty(client, admin_headers, db_session):
    """전송 큐 없을 때 빈 배열."""
    resp = await client.get("/api/daily-status-push", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_daily_status_push_query_with_data(client, admin_headers, db_session):
    """ERP 전송 큐 조회 (user_id/status 필터)."""
    now = datetime.now(timezone.utc)
    push1 = DailyStatusPush(
        id=uuid4(), user_id=1001, push_date=date.today(),
        target=DailyStatusPushTarget.ERP_DAILY_REPORTS,
        payload={"test": "data"},
        status=DailyStatusPushStatus.PENDING,
    )
    push2 = DailyStatusPush(
        id=uuid4(), user_id=1002, push_date=date.today(),
        target=DailyStatusPushTarget.ERP_KPI_RESULTS,
        payload={"kpi": 123},
        status=DailyStatusPushStatus.SENT,
        pushed_at=now,
    )
    db_session.add_all([push1, push2])
    await db_session.commit()
    
    # 전체 조회
    resp = await client.get("/api/daily-status-push", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    
    # status 필터
    resp = await client.get("/api/daily-status-push?status=pending", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["status"] == "pending"
    
    # user_id 필터
    resp = await client.get("/api/daily-status-push?user_id=1002", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["user_id"] == 1002


@pytest.mark.asyncio
async def test_daily_status_push_employee_self_scope(client, user_headers):
    """비관리자: 본인 것만 조회 가능(06 §3.6 'ERP 동기화 확인'), 타인 user_id 지정 시 403."""
    resp = await client.get("/api/daily-status-push", headers=user_headers)
    assert resp.status_code == 200  # 본인 스코프 자동 적용

    resp2 = await client.get("/api/daily-status-push?user_id=9999", headers=user_headers)
    assert resp2.status_code == 403


# ── Login backoff (HG-AUTH) ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_backoff_after_5_failures(client, db_session, seed_users):
    """5회 로그인 실패 시 5분 잠금."""
    # 테스트 사용자 (alice@virtualoffice.local)는 conftest.py 픽스처에 존재
    email = "alice@virtualoffice.local"
    wrong_password = "wrongpassword"
    
    # 4회 실패 → 401
    for i in range(4):
        resp = await client.post("/api/auth/login", json={"email": email, "password": wrong_password})
        assert resp.status_code == 401, f"Attempt {i+1} should return 401"
    
    # 5회째 실패 → 여전히 401
    resp = await client.post("/api/auth/login", json={"email": email, "password": wrong_password})
    assert resp.status_code == 401
    
    # 6회째 시도 → 429 (잠금)
    resp = await client.post("/api/auth/login", json={"email": email, "password": wrong_password})
    assert resp.status_code == 429
    assert "Too many failed login attempts" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_login_backoff_cleared_on_success(client, db_session, seed_users):
    """실패 후 성공하면 카운터 초기화."""
    email = "alice@virtualoffice.local"
    wrong_password = "wrongpassword"
    correct_password = "password123"
    
    # 3회 실패
    for _ in range(3):
        await client.post("/api/auth/login", json={"email": email, "password": wrong_password})
    
    # 성공 로그인 → 200
    resp = await client.post("/api/auth/login", json={"email": email, "password": correct_password})
    assert resp.status_code == 200
    assert "access_token" in resp.json()
    
    # 다시 4회 실패 가능 (카운터 리셋됨)
    for i in range(4):
        resp = await client.post("/api/auth/login", json={"email": email, "password": wrong_password})
        assert resp.status_code == 401
    
    # 5회째도 401 (아직 잠금 전)
    resp = await client.post("/api/auth/login", json={"email": email, "password": wrong_password})
    assert resp.status_code == 401
    
    # 6회째 → 429
    resp = await client.post("/api/auth/login", json={"email": email, "password": wrong_password})
    assert resp.status_code == 429


# ── Lifespan / Scheduler 기동 (회귀 방지: 스케줄러 import·start/stop) ──────────

@pytest.mark.asyncio
async def test_lifespan_starts_and_stops_scheduler():
    """app lifespan이 스케줄러를 오류 없이 start/stop (컨테이너 크래시 회귀 방지)."""
    from app.main import app

    async with app.router.lifespan_context(app):
        pass  # startup(scheduler 시작) 성공 = import·등록 정상
    # shutdown(scheduler 정지)까지 예외 없이 완료


@pytest.mark.asyncio
async def test_scheduler_registers_expected_jobs():
    """스케줄러 잡 등록이 D17/D18 정본과 일치 (08 §4.1: KPI=21:00 단일, EOD=18:00)."""
    import app.services.scheduler as sched

    sched.start_scheduler()
    try:
        jobs = sched._scheduler.get_jobs()
        ids = {j.id for j in jobs}
        assert "kpi_21" in ids, "KPI 21:00 야간 배치 누락"
        assert "kpi_18" not in ids, "18:00 KPI 잡은 D17 정본에 없음 (18:00=EOD push 전용)"
        assert "eod_push" in ids, "EOD 18:00 push 잡 누락"
        assert "erp_hourly" in ids, "ERP 매시간 동기화 잡 누락"
        assert "audit_retention_purge" in ids, "audit_log 5년 파기 잡 누락 (D20-e)"
        eod = next(j for j in jobs if j.id == "eod_push")
        trigger = str(eod.trigger)
        assert "hour='18'" in trigger and "minute='0'" in trigger, f"EOD는 18:00 KST 정본: {trigger}"
    finally:
        sched.stop_scheduler()
