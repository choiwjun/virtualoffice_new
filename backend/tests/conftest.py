"""
pytest 구성 및 공유 픽스처

참조:
- 00-decisions.md: D4(JWT HS256, 자체 시크릿), D21(1인 운영)
- 11-tech-stack.md: FastAPI 0.115+, Python 3.11+, pytest-asyncio
- test-strategy.md: 테스트 레이어 정의

구성 요소:
1. 비동기 이벤트루프 (pytest-asyncio)
2. 테스트 DB (SQLite in-memory, 각 테스트 독립 세션)
3. FastAPI TestClient (httpx AsyncClient)
4. JWT 토큰 팩토리 (employee/leader/admin 역할별)
5. 시드 데이터 픽스처 (테스트용 사용자, 레이아웃, 좌석)
"""

import asyncio
import os
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# 백엔드 앱 임포트 (Phase 1에서 구현됨)
# from app.main import app
# from app.db import Base, get_db
# from app.core.security import create_access_token, hash_password
# from app.models import User


# ============================================================================
# 1. pytest-asyncio 구성: 고정된 이벤트루프
# ============================================================================

@pytest.fixture(scope="session")
def event_loop():
    """
    세션 레벨 이벤트루프 (모든 async 테스트가 공유).

    구성:
    - 플랫폼: Windows/Linux/macOS 호환
    - 정책: asyncio.DefaultEventLoopPolicy() 사용
    - 종료: 테스트 세션 종료 시 루프 종료
    """
    if os.name == "nt":  # Windows
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield loop
    loop.close()


# ============================================================================
# 2. 테스트 데이터베이스 (SQLite in-memory)
# ============================================================================

DATABASE_URL_TEST = "sqlite+aiosqlite:///:memory:"
# 대안 (선택사항): testcontainers-postgres
# - 근거: PostgreSQL 전용 기능 테스트 필요 시 사용 (Phase 2+)
# - 설정: docker-compose 또는 GitHub Actions로 PostgreSQL 컨테이너 자동 기동
# - 속도: in-memory SQLite < PostgreSQL 컨테이너 (각 테스트마다 약간의 지연)


@pytest_asyncio.fixture
async def test_db():
    """
    테스트 데이터베이스 생성 및 스키마 초기화.

    구성:
    - DB: SQLite in-memory (각 테스트마다 신규 인스턴스)
    - 격리: 병렬 테스트 지원 (worker ID별 DB 격리)
    - 정리: 테스트 종료 후 자동 삭제 (in-memory 특성)

    동작:
    1. 새 async 엔진 생성
    2. 모든 테이블 생성 (Base.metadata.create_all)
    3. 테스트 실행
    4. 테스트 후 자동 정리

    Phase 1에서 구현 시:
    ```python
    from app.db import Base

    engine = create_async_engine(
        DATABASE_URL_TEST,
        connect_args={"check_same_thread": False},  # SQLite 멀티스레드 허용
        poolclass=StaticPool,  # 메모리 DB 연결 풀
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    ```
    """
    # TODO: Phase 1에서 구현
    # engine = create_async_engine(DATABASE_URL_TEST, ...)
    # async with engine.begin() as conn:
    #     await conn.run_sync(Base.metadata.create_all)
    # yield engine
    # await engine.dispose()

    # 현재 Phase 0: 스텁만 제공
    yield None


@pytest_asyncio.fixture
async def db_session(test_db) -> AsyncGenerator[AsyncSession, None]:
    """
    각 테스트마다 신규 데이터베이스 세션.

    구성:
    - 격리: ROLLBACK 자동 (각 테스트 종료 후)
    - 트랜잭션: 테스트는 트랜잭션 내에서만 실행

    사용:
    ```python
    async def test_create_user(db_session):
        user = User(email="test@example.com", ...)
        db_session.add(user)
        await db_session.commit()
        assert user.id > 0
    ```

    Phase 1에서 구현 시:
    ```python
    SessionLocal = sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    ```
    """
    # TODO: Phase 1에서 구현
    # async with SessionLocal() as session:
    #     yield session
    #     await session.rollback()

    # 현재 Phase 0: 스텁만 제공
    yield None


# ============================================================================
# 3. FastAPI TestClient (비동기)
# ============================================================================

@pytest_asyncio.fixture
async def async_client(db_session) -> AsyncGenerator[AsyncClient, None]:
    """
    FastAPI 테스트용 비동기 클라이언트.

    구성:
    - 트랜스포트: ASGITransport (FastAPI ASGI 앱과 직접 통신)
    - 기본 URL: http://test (임의 도메인, 테스트 용도)
    - DB 오버라이드: get_db 의존성을 test_db_session으로 변경

    사용:
    ```python
    async def test_auth_login(async_client):
        response = await async_client.post(
            "/auth/login",
            json={"email": "user@example.com", "password": "secret"}
        )
        assert response.status_code == 201
        assert "token" in response.json()
    ```

    Phase 1에서 구현 시:
    ```python
    from app.main import app

    app.dependency_overrides[get_db] = lambda: db_session

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as client:
        yield client

    app.dependency_overrides.clear()
    ```
    """
    # TODO: Phase 1에서 구현
    # async with AsyncClient(
    #     transport=ASGITransport(app=app),
    #     base_url="http://test"
    # ) as client:
    #     yield client

    # 현재 Phase 0: 스텁만 제공
    yield None


# ============================================================================
# 4. JWT 토큰 팩토리 (역할별)
# ============================================================================

@pytest.fixture
def employee_token():
    """
    employee 역할 JWT 토큰 생성.

    토큰 구성:
    - 알고리즘: HS256
    - 비밀키: 자체 시크릿 (환경 변수 또는 설정)
    - 만료: 8시간
    - 클레임:
      - user_id: 테스트용 ID
      - email: "employee@example.com"
      - role: "employee"

    근거 (D4):
    - HS256 + 자체 시크릿 (ERP와 미공유)
    - 게임서버는 검증만 (발급 안 함)

    Phase 1에서 구현 시:
    ```python
    from app.core.security import create_access_token

    token = create_access_token(
        data={
            "sub": "1",
            "email": "employee@example.com",
            "role": "employee"
        },
        expires_delta=timedelta(hours=8)
    )
    return token
    ```
    """
    # TODO: Phase 1에서 구현
    # token = create_access_token(...)
    # return token

    # 현재 Phase 0: 스텁만 제공
    return "mock_employee_token_phase_0"


@pytest.fixture
def leader_token():
    """
    leader 역할 JWT 토큰 생성.

    토큰 구성:
    - role: "leader"
    - team_id: 테스트용 팀 ID

    권한:
    - 자신의 팀 직원 데이터 조회/관리
    - 팀 밖 데이터 접근 불가
    """
    # TODO: Phase 1에서 구현
    # token = create_access_token(
    #     data={"role": "leader", "team_id": 1, ...}
    # )
    # return token

    # 현재 Phase 0: 스텁만 제공
    return "mock_leader_token_phase_0"


@pytest.fixture
def admin_token():
    """
    admin 역할 JWT 토큰 생성.

    토큰 구성:
    - role: "admin"

    권한:
    - 모든 기능 접근 (제약 없음)
    """
    # TODO: Phase 1에서 구현
    # token = create_access_token(
    #     data={"role": "admin", ...}
    # )
    # return token

    # 현재 Phase 0: 스텁만 제공
    return "mock_admin_token_phase_0"


# ============================================================================
# 5. 시드 데이터 픽스처
# ============================================================================

@pytest.fixture
def test_user():
    """
    테스트용 사용자 객체.

    구성:
    - user_id: 1
    - email: "testuser@example.com"
    - password: hashed("TestPass123!")
    - role: "employee"
    - name: "Test User"

    사용:
    ```python
    async def test_user_profile(async_client, test_user):
        response = await async_client.get(
            f"/users/{test_user.id}",
            headers={"Authorization": f"Bearer {employee_token}"}
        )
        assert response.json()["email"] == test_user.email
    ```

    Phase 1에서 구현 시:
    ```python
    from app.models import User
    from app.core.security import hash_password

    user = User(
        user_id=1,
        email="testuser@example.com",
        hashed_password=hash_password("TestPass123!"),
        role="employee",
        name="Test User"
    )
    return user
    ```
    """
    # TODO: Phase 1에서 구현
    # return User(...)

    # 현재 Phase 0: 스텁만 제공
    return {
        "user_id": 1,
        "email": "testuser@example.com",
        "role": "employee",
        "name": "Test User"
    }


@pytest.fixture
def test_layout():
    """
    테스트용 오피스 레이아웃.

    구성 (참조: 05-office-layout-schema.md):
    - version: "1.0"
    - floors: [
        {
          level: 1,
          name: "1F",
          zones: [...],
          rooms: [...],
          seats: [...],
          collision_map: {...}
        }
      ]

    검증:
    - 좌표 범위: 0 <= x,y < 100
    - 좌석 수: 1+ (최소 하나)
    - 중복 제거: seat_id 유일
    - 접근성: A* 경로 계산 가능

    Phase 1에서 구현 시:
    ```python
    from app.models import OfficeLayout

    layout = OfficeLayout(
        version="1.0",
        layout_json={
            "floors": [
                {
                    "level": 1,
                    "name": "1F",
                    "zones": [...],
                    ...
                }
            ]
        }
    )
    return layout
    ```
    """
    # TODO: Phase 1에서 구현
    # return OfficeLayout(...)

    # 현재 Phase 0: 스텁만 제공
    return {
        "version": "1.0",
        "floors": [
            {
                "level": 1,
                "name": "1F",
                "zones": [],
                "rooms": [],
                "seats": [
                    {
                        "seat_id": "1F-A01",
                        "x": 10.0,
                        "y": 10.0,
                        "type": "desk",
                        "facing": 0
                    }
                ],
                "collision_map": {}
            }
        ]
    }


@pytest.fixture
def test_meeting():
    """
    테스트용 회의.

    구성:
    - meeting_id: uuid
    - title: "테스트 회의"
    - room_id: "1F-MR01" (1층 회의실 01)
    - host_id: 1 (host 사용자)
    - start_time: datetime.now()
    - end_time: datetime.now() + timedelta(hours=1)
    - status: "scheduled" | "in_progress" | "finished"

    Phase 1에서 구현 시:
    ```python
    from app.models import Meeting
    from datetime import datetime, timedelta

    meeting = Meeting(
        title="테스트 회의",
        room_id="1F-MR01",
        host_id=1,
        start_time=datetime.now(),
        end_time=datetime.now() + timedelta(hours=1),
        status="scheduled"
    )
    return meeting
    ```
    """
    # TODO: Phase 1에서 구현
    # return Meeting(...)

    # 현재 Phase 0: 스텁만 제공
    return {
        "meeting_id": "test-meeting-001",
        "title": "테스트 회의",
        "room_id": "1F-MR01",
        "host_id": 1,
        "status": "scheduled"
    }


# ============================================================================
# 6. 유틸리티 픽스처
# ============================================================================

@pytest.fixture
def auth_headers(employee_token):
    """
    인증 헤더 포함 요청용 헬퍼.

    사용:
    ```python
    async def test_protected_endpoint(async_client, auth_headers):
        response = await async_client.get(
            "/protected",
            headers=auth_headers
        )
        assert response.status_code == 200
    ```
    """
    return {"Authorization": f"Bearer {employee_token}"}


@pytest.fixture
def admin_auth_headers(admin_token):
    """
    관리자 권한 인증 헤더.
    """
    return {"Authorization": f"Bearer {admin_token}"}


# ============================================================================
# 7. pytest 훅: 테스트 수집 및 실행 제어
# ============================================================================

def pytest_configure(config):
    """
    pytest 초기화: 커스텀 마킹 등록.
    """
    config.addinivalue_line("markers", "unit: 단위 테스트")
    config.addinivalue_line("markers", "integration: 통합 테스트")
    config.addinivalue_line("markers", "e2e: E2E 테스트")
    config.addinivalue_line("markers", "slow: 느린 테스트 (부하/성능)")
    config.addinivalue_line("markers", "load: 부하 테스트")
    config.addinivalue_line("markers", "skip_phase: Phase 미완성 스킵")
    config.addinivalue_line("markers", "flaky: 불안정한 테스트")


def pytest_collection_modifyitems(config, items):
    """
    테스트 수집 후 처리: Phase별 skip 자동 적용.

    동작:
    - skip 이미 마킹된 테스트: 그대로 유지
    - contract/ 디렉토리의 테스트: 자동 skip (구현 대기)
    """
    for item in items:
        # contract 폴더의 테스트는 Phase 0 스텁이므로 자동 skip
        if "contract" in str(item.fspath):
            item.add_marker(pytest.mark.skip(reason="구현 대기 (Phase 1+)"))

        # 느린 테스트는 기본 실행 제외 (필요 시 -m slow로 실행)
        if item.get_closest_marker("slow"):
            item.add_marker(pytest.mark.slow)


# ============================================================================
# 8. 참고: Phase 1 구현 시 필수 설정
# ============================================================================

"""
Phase 1 구현 시 다음을 conftest.py에 추가:

1. 실제 앱 임포트:
   from app.main import app
   from app.db import Base, SessionLocal, get_db
   from app.models import User
   from app.core.security import create_access_token, hash_password

2. 테스트 DB 엔진 구성:
   ENGINE = create_async_engine(
       DATABASE_URL_TEST,
       connect_args={"check_same_thread": False},
       poolclass=StaticPool,
   )

3. test_db 픽스처 구현 (아래 주석 해제):
   @pytest_asyncio.fixture
   async def test_db():
       async with ENGINE.begin() as conn:
           await conn.run_sync(Base.metadata.create_all)
       yield ENGINE
       async with ENGINE.begin() as conn:
           await conn.run_sync(Base.metadata.drop_all)

4. db_session 픽스처 구현:
   SessionLocal = sessionmaker(
       ENGINE,
       class_=AsyncSession,
       expire_on_commit=False,
   )

   @pytest_asyncio.fixture
   async def db_session():
       async with SessionLocal() as session:
           yield session
           await session.rollback()

5. async_client 픽스처 구현:
   app.dependency_overrides[get_db] = lambda: db_session
   async with AsyncClient(...) as client:
       yield client
   app.dependency_overrides.clear()

6. 토큰 팩토리 구현:
   token = create_access_token(data={...})

7. 시드 데이터 생성:
   user = User(...)
   db_session.add(user)
   await db_session.commit()
"""

