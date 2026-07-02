# 테스트 전략 (Test Strategy)

**문서**: 가상오피스 프로젝트 통합 테스트 프레임워크  
**버전**: 1.0  
**작성일**: 2026-07-02  
**상태**: Phase 0 확정

---

## 1. 테스트 레이어 정의

### 1.1 레이어 구조

```
┌─────────────────────────────────────────────────┐
│              테스트 피라미드                     │
├─────────────────────────────────────────────────┤
│                                                 │
│  🔴 E2E (End-to-End)                           │
│  ├─ 주기: Phase 3+ (클라이언트 연동)            │
│  ├─ 도구: Playwright (웹) + Godot E2E          │
│  ├─ 범위: 전체 시나리오 (UI 포함)              │
│  └─ 커버리지 기준: 주요 사용자 흐름            │
│                                                 │
│  🟡 통합 (Integration)                         │
│  ├─ 주기: Phase 1+ (API 구현)                  │
│  ├─ 도구: pytest + httpx (FastAPI)             │
│  ├─ 범위: API ↔ DB, API ↔ LiveKit             │
│  ├─ MockDB: SQLite in-memory (fast)           │
│  └─ 커버리지 기준: 모든 엔드포인트 기본 흐름   │
│                                                 │
│  🟢 단위 (Unit)                                |
│  ├─ 주기: Phase 0+ (즉시 작성)                 │
│  ├─ 도구: pytest (FastAPI), GUT (GDScript)     │
│  ├─ 범위: 함수/메서드 단위                     │
│  ├─ Mock: 외부 의존 (DB, API, LiveKit)        │
│  └─ 커버리지 기준: 전체 함수 >= 80%            │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 1.2 레이어별 책임

| 레이어 | 목적 | Phase | 도구 | 속도 | 신뢰성 |
|--------|------|-------|------|------|--------|
| **Unit** | 로직 검증 | Phase 0+ | pytest/GUT | 빠름 | 고정의(deterministic) |
| **Integration** | API ↔ DB 연동 | Phase 1+ | pytest httpx | 중간 | API 계약 준수 검증 |
| **E2E** | 사용자 시나리오 | Phase 3+ | Playwright | 느림 | 실제 환경 재현 |

---

## 2. 백엔드 테스트 (FastAPI)

### 2.1 테스트 환경 (conftest.py)

```python
# backend/tests/conftest.py 생성됨 — 아래 섹션 참조
```

**구성 요소**:

1. **async 테스트 지원** (`pytest-asyncio`)
   - `@pytest.mark.asyncio` 데코레이터로 비동기 테스트 실행
   - 고정된 이벤트루프 (conftest: `event_loop` 픽스처)

2. **테스트 DB (SQLite in-memory)**
   ```python
   # 근거: 
   # - Phase 0/1: 단위/통합 테스트는 SQLite 충분
   # - 빠른 실행 (DB I/O 없음, 메모리 기반)
   # - 병렬 테스트 지원 (각 테스트별 독립 세션)
   # - Phase 2+: 실제 PostgreSQL 통합 테스트 분리
   ```

3. **FastAPI TestClient**
   ```python
   async_client = AsyncClient(transport=ASGITransport(app=app))
   # 근거: 비동기 엔드포인트 테스트에 최적화
   ```

4. **JWT 토큰 팩토리** (역할별)
   ```python
   @pytest.fixture
   def employee_token():
       # employee 역할 토큰 생성
   
   @pytest.fixture
   def leader_token():
       # leader 역할 토큰 생성
   
   @pytest.fixture
   def admin_token():
       # admin 역할 토큰 생성
   ```

5. **시드 데이터 픽스처**
   ```python
   @pytest.fixture
   def test_user():
       # 테스트용 사용자 생성
   
   @pytest.fixture
   def test_layout():
       # 테스트용 오피스 레이아웃 생성
   ```

### 2.2 테스트 스텁 (contract/)

**파일**: `backend/tests/contract/test_management_api_stubs.py`

**목적**: 모든 P0 계약 엔드포인트에 대한 테스트 골격 정의

**구조**:

```python
# 주요 리소스 그룹별 테스트 클래스

class TestAuthAPI:
    """POST /auth/login, POST /auth/refresh"""
    # - 성공 케이스: 올바른 credentials → 201, token 반환
    # - 에러 케이스: 잘못된 password → 401
    # - 권한 검증: 토큰 없음 → 401

class TestSeatAssignmentAPI:
    """GET/POST /seats, GET/PUT /seats/{id}/assign"""
    # - 성공: 좌석 생성, 배정, 조회
    # - 에러: 중복 배정 → 409, 미존재 좌석 → 404

class TestOfficeLayoutAPI:
    """GET/POST /layouts, POST /layouts/{id}/deploy"""
    # - 성공: 레이아웃 생성, 배포
    # - 검증: 잘못된 JSON → 400
    # - 권한: admin만 배포 가능 → 403

class TestMeetingAPI:
    """POST /meetings, GET /meetings/{id}, POST /meetings/{id}/join"""
    # - 성공: 회의 생성, 입장
    # - 기본: 필수 필드만으로 201

class TestMeetingMinuteAPI:
    """GET /meetings/{id}/minutes, PUT /minutes/{id}"""
    # - STT 초안 조회
    # - 확정 (관리자만)

class TestWorkLogAPI:
    """POST /work-logs, GET /work-logs?period="""
    # - 업무기록 CRUD
    # - 필터링: 기간별

class TestKPIResultAPI:
    """GET /kpi-results, PUT /kpi-results/{id}/adjust"""
    # - 조회: 자신/팀/전체 (권한별)
    # - 조정: admin만
    # - 이의신청: employee만 제출

class TestObjectionAPI:
    """POST /objections, PUT /objections/{id}"""
    # - 제출: employee
    # - 승인/거부: admin

class TestSyncAPI:
    """POST /sync/erp, GET /sync/status"""
    # - 수동 트리거
    # - 상태 조회

class TestAuditLogAPI:
    """GET /audit-logs"""
    # - 감사 로그 조회 (admin만)
```

**마킹**: 모든 테스트에 `@pytest.mark.skip(reason="Phase N 구현 후 활성화")`

**테스트 케이스 수**:
- 인증: 5개 (성공, 401, 미만료, 갱신, 권한)
- 좌석: 8개 (생성, 조회, 배정, 중복, 자율좌석)
- 레이아웃: 10개 (생성, 배포, 검증, 버전, 권한)
- 회의: 8개 (생성, 조회, 입장, 예약 충돌, 명시적 입장 확인)
- 회의록: 5개 (STT 조회, 확정, 검토)
- 업무: 6개 (CRUD, 필터)
- KPI: 12개 (조회, 조정, 이의신청, 확정)
- 동기화: 4개 (수동, 상태, 실패)
- 감사: 3개 (조회, 필터)

**합계**: ~61개 테스트 케이스

### 2.3 WebSocket 테스트 스텁 (contract/)

**파일**: `backend/tests/contract/test_realtime_api_stubs.py`

**목적**: WebSocket 계약 검증

**구조**:

```python
class TestWebSocketHandshake:
    """핸드셰이크 및 protocol_version 협상"""
    # - 성공: hello + 유효 JWT → 접수
    # - 미지원 버전: protocol_version 1 → reject
    # - 무효 토큰: reject

class TestWebSocketReconnection:
    """재접속 및 스냅샷 복구"""
    # - sequence_num 기반 스냅샷 요청
    # - 낙선된 메시지 재전송

class TestWebSocketMessages:
    """주요 메시지 타입"""
    # - avatar_move: 좌표 동기화
    # - presence_update: 상태 변이
    # - meeting_enter/exit: 회의실 점유
    # - chat: 근접 채팅

class TestWebSocketErrorHandling:
    """에러 코드"""
    # - 1000: 정상 종료
    # - 4001: 인증 실패
    # - 4002: 프로토콜 오류
    # - 4003: 서버 상태 초과
```

**테스트 케이스 수**:
- 핸드셰이크: 4개
- 재접속: 3개
- 메시지: 6개
- 에러: 4개

**합계**: ~17개 테스트 케이스

---

## 3. 게임 클라이언트 테스트 (GDScript)

### 3.1 GUT (Godot Unit Test) 구성

**파일**: `godot/tests/test_avatar_movement.gd`

**목적**: 아바타 이동, 충돌, 좌석 점유 로직 테스트

**구조**:

```gdscript
# test_avatar_movement.gd

class TestAvatarMovement:
    """아바타 기본 이동"""
    # - 이동 방향 설정 → position 변경
    # - 속도 제한 (max_speed 적용)
    # - 회전 (facing 각도)

class TestAvatarCollision:
    """충돌 감지 및 방지"""
    # - 벽과 충돌 → 이동 중단
    # - 가구와 충돌 → 회피경로 선택
    # - 타 아바타와 충돌 → 밀치기 없음 (권위 검증)

class TestSeatOccupancy:
    """좌석 점유"""
    # - 좌석 범위 진입 → seat_id 설정
    # - 좌석 범위 퇴출 → seat_id 해제
    # - 중복 점유 불가 (서버 검증)

class TestProximityInteraction:
    """근접 메뉴"""
    # - 직원/가구/회의실 <= 2m → 상호작용 버튼 표시
    # - 범위 벗어남 → 숨김
```

**테스트 케이스 수**:
- 이동: 5개 (방향, 속도, 회전, 범위)
- 충돌: 6개 (벽, 가구, 아바타, 경로 선택)
- 좌석: 4개 (진입, 퇴출, 중복, 배정 오류)
- 근접: 3개 (표시, 숨김, 범위)

**합계**: ~18개 테스트 케이스

### 3.2 테스트 실행

```bash
# Godot 헤드리스 모드로 GUT 실행
godot --headless --script res://addons/gut/gut_cmdline.gd
```

---

## 4. CI/CD 파이프라인

### 4.1 GitHub Actions 워크플로우

**파일**: `.github/workflows/test-phase.yaml`

**구조**:

```yaml
name: Test Phase [Phase N]
on:
  push:
    branches: [phase-*]
  pull_request:
    branches: [main]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - Python 3.11 설치
      - pytest --cov=app (커버리지 80% 이상)
      - ruff check . (린트)
      - mypy app/ (타입 체크)

  godot:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - Godot 4.3+ 다운로드
      - godot --headless --script gut_cmdline.gd
      - 테스트 결과 수집 (JUnit XML)

  quality-gate:
    needs: [backend, godot]
    steps:
      - 테스트 통과 여부 확인
      - 커버리지 >= 70% 확인
      - 배포 가능 여부 판정
```

### 4.2 배포 게이트 정책

```
┌──────────────────────────────────────────────────┐
│            배포 게이트 (Deployment Gate)         │
├──────────────────────────────────────────────────┤
│                                                  │
│  필수 조건 (모두 통과해야 병합 가능):            │
│                                                  │
│  ✅ 테스트                                       │
│     └─ pytest: 모든 테스트 통과 (0 실패)       │
│     └─ GUT: 모든 테스트 통과                   │
│                                                  │
│  ✅ 커버리지                                     │
│     └─ 라인 커버리지 >= 70%                     │
│     └─ 브랜치 커버리지 >= 60%                   │
│                                                  │
│  ✅ 린트                                         │
│     └─ ruff check: 0 errors                     │
│     └─ (warnings는 허용)                        │
│                                                  │
│  ✅ 타입 검사                                    │
│     └─ mypy: 0 errors                           │
│                                                  │
│  ⚠️  Flaky 테스트                               │
│     └─ 테스트 3회 연속 실행 통과 필수           │
│     (불안정 테스트 감지 및 격리)               │
│                                                  │
│  조건 미충족 시:                                 │
│  ❌ main 병합 자동 거부 (GitHub branch protection)
│  🔔 담당자 에러 리포트 전송                     │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 4.3 배포 체크리스트

**Phase 0 → Phase 1 병합 전**:
```
- [x] 모든 P0 테스트 스텁 작성 (3개 계약)
- [x] conftest.py: pytest 기반 제공
- [x] test-strategy.md: 전략 문서
- [x] test-phase.yaml: CI/CD 정의
- [x] 테스트 총 수: ~96개 (모두 skip 상태)
```

**Phase 1 → Phase 2 병합 전**:
```
- [ ] 모든 단위 테스트 통과
- [ ] 커버리지 >= 70%
- [ ] 0 린트 에러
- [ ] 0 타입 에러
- [ ] 3회 연속 실행 통과
```

---

## 5. 성능 테스트 (D22 검증)

### 5.1 테스트 항목

| 항목 | 기준 | 측정 방법 | Phase |
|------|------|---------|-------|
| **아바타 동기화** | E2E p95 < 500ms | 20명 시뮬레이션 → 지연 측정 | 3+ |
| **서버 tick** | 20Hz (50ms) | Godot 헤드리스 profiler | 2+ |
| **로딩 시간** | < 5초 | 클라이언트 바이너리 기동 | 2+ |
| **회의록 STT** | 누락률 < 5% | 테스트 회의 N회 대조 | 4+ (S2) |
| **클라이언트 FPS** | GTX1650: 60fps, 내장: 30fps | Godot profiler | 2+ |
| **WebSocket 메시지 지연** | < 200ms (근접 메뉴) | 연결 상태 모니터링 | 2+ |

### 5.2 부하 테스트

```python
# backend/tests/performance/test_load.py (Phase 2+ 신설)

@pytest.mark.load
async def test_presence_update_throughput():
    """
    100명 동시접속 시 presence 업데이트 처리량
    기준: 초당 100개 이상
    """
    pass

@pytest.mark.load
async def test_database_query_latency():
    """
    10,000개 seat_assignment 조회 시 지연
    기준: p95 < 100ms
    """
    pass
```

---

## 6. 테스트 실행 명령어

### 6.1 로컬 개발

```bash
# 전체 테스트 (현재: 모두 skip)
pytest

# 특정 테스트만 실행
pytest backend/tests/contract/test_management_api_stubs.py::TestAuthAPI -v

# 커버리지 레포트 생성
pytest --cov=app --cov-report=html

# GDScript 테스트
godot --headless --script res://addons/gut/gut_cmdline.gd

# 린트 + 타입 체크
ruff check .
mypy app/
```

### 6.2 CI/CD (GitHub Actions)

```bash
# GitHub에 push 시 자동 실행
git push origin phase-0-tests

# 결과 확인
# https://github.com/spacecl/voffice/actions/workflows/test-phase.yaml
```

---

## 7. 테스트 명명 규칙

### 7.1 테스트 메서드명

```python
# 패턴: test_{기능}_{시나리오}_{기대결과}

# ✅ Good
def test_auth_login_valid_credentials_returns_201():
    pass

def test_auth_login_invalid_password_returns_401():
    pass

def test_seat_assignment_duplicate_raises_409():
    pass

# ❌ Bad
def test_auth():
    pass

def test_it_works():
    pass
```

### 7.2 테스트 마킹

```python
# Phase별 활성화
@pytest.mark.skip(reason="Phase 0 스텁")
@pytest.mark.phase0  # 현재 활성화

@pytest.mark.skip(reason="Phase 1에서 활성화")
@pytest.mark.phase1  # 구현 시 활성화

# 테스트 타입
@pytest.mark.unit
@pytest.mark.integration
@pytest.mark.e2e

# 성능
@pytest.mark.slow
@pytest.mark.load
```

---

## 8. 공통 문제 해결

### 8.1 Flaky 테스트 감지

```bash
# 동일 테스트 3회 연속 실행
pytest --count=3 backend/tests/contract/

# 불안정한 테스트 격리
pytest -m "not flaky"
```

### 8.2 테스트 격리 (독립성 확보)

```python
# ✅ Good: 각 테스트는 독립적
@pytest.fixture
def clean_db():
    # 각 테스트마다 신규 DB 세션
    yield session
    session.rollback()

# ❌ Bad: 테스트 간 상태 공유
global_state = {}
```

### 8.3 Mock vs Real

```python
# Unit 테스트: Mock 사용
@patch('app.services.send_email')
def test_user_signup(mock_email):
    mock_email.return_value = True
    assert signup_user(...) == True

# Integration 테스트: Real (in-memory DB)
def test_user_signup_integration(db_session):
    user = create_user(db_session)
    assert user.id > 0
```

---

## 9. Phase별 활성화 계획

| Phase | 활성화 항목 | 추가 도구 |
|-------|-----------|---------|
| **0** | 스텁 작성, conftest | pytest, pytest-asyncio |
| **1** | 백엔드 구현, 단위 테스트 | httpx, SQLAlchemy, Factory Boy |
| **2** | 게임 클라이언트, GUT | Godot GUT addon |
| **3** | E2E 테스트 | Playwright, live DB |
| **4** | 성능 테스트 | pytest-benchmark, locust |

---

## 10. 참고 문서

- **00-decisions.md**: D21(1인 운영), D22(성능 수치)
- **11-tech-stack.md**: §4.2(빌드/배포 파이프라인)
- **12-tasks.md**: P0-T0.7, P1-T1.2, P2-T2.1

---

**문서 버전**: 1.0  
**마지막 갱신**: 2026-07-02  
**상태**: 승인됨 (Phase 0 출시 준비)
