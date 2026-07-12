# 테스트 전략 (Test Strategy)

> 🟢 **D27 반영(2026-07-09) — 재작성 완료.** D26(WorkAdventure)+Godot 폐기 → D27 스택으로 전환. 게임 클라이언트 테스트(GUT/GDScript)·CI(Godot headless)·성능표(Godot profiler/GTX1650)는 **Vitest + Playwright + Colyseus 테스트**로 교체됨. 백엔드 pytest(417+ 통과)·API 계약 테스트·통합 시나리오는 보존. 현행 정본 = 00-decisions §H(D27) · 14-virtual-office-spec · 15-realtime-server-spec · 16-render-spike-and-roadmap · 3d-design/{design-style-analysis, photoreal-web-strategy}.
>
> **D27 테스트 스택 요약**: 프론트/3D = Vitest(단위, R3F 컴포넌트·깊이합성 셰이더, 스파이크 `spikes/depth-composite` 포함) + Playwright(E2E) · 실시간 서버 = Colyseus 룸 테스트(Node/TS) · 백엔드 = pytest(현행 유지) · 성능 = 브라우저 프레임(아바타 N명) + Colyseus p95<500ms.

**문서**: 가상오피스 프로젝트 통합 테스트 프레임워크  
**버전**: 2.0  
**작성일**: 2026-07-02  
**갱신일**: 2026-07-09  
**상태**: D27 반영 확정

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
│  ├─ 도구: Playwright (웹 3D 화면)              │
│  ├─ 범위: 전체 시나리오 (UI 포함)              │
│  └─ 커버리지 기준: 주요 사용자 흐름            │
│                                                 │
│  🟡 통합 (Integration)                         │
│  ├─ 주기: Phase 1+ (API 구현)                  │
│  ├─ 도구: pytest + httpx (FastAPI) /           │
│  │         Colyseus 서버 테스트 (Node/TS)      │
│  ├─ 범위: API ↔ DB, 실시간 룸 ↔ 스냅샷        │
│  ├─ MockDB: SQLite in-memory (fast)           │
│  └─ 커버리지 기준: 모든 엔드포인트 기본 흐름   │
│                                                 │
│  🟢 단위 (Unit)                                |
│  ├─ 주기: Phase 0+ (즉시 작성)                 │
│  ├─ 도구: pytest (FastAPI),                    │
│  │         Vitest (프론트/R3F/셰이더)          │
│  ├─ 범위: 함수/컴포넌트/셰이더 단위            │
│  ├─ Mock: 외부 의존 (DB, API, 실시간 룸)      │
│  └─ 커버리지 기준: 전체 함수 >= 80%            │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 1.2 레이어별 책임

| 레이어 | 목적 | Phase | 도구 | 속도 | 신뢰성 |
|--------|------|-------|------|------|--------|
| **Unit** | 로직·컴포넌트·셰이더 검증 | Phase 0+ | pytest / Vitest | 빠름 | 고정의(deterministic) |
| **Integration** | API ↔ DB · 실시간 룸 연동 | Phase 1+ | pytest httpx / Colyseus 테스트 | 중간 | API 계약·룸 스냅샷 검증 |
| **E2E** | 사용자 시나리오 | Phase 3+ | Playwright | 느림 | 실제 브라우저 환경 재현 |

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

## 3. 프론트/3D 테스트 (Vitest + Playwright) 및 실시간 서버 테스트 (Colyseus)

> D27 전환: 게임 클라이언트가 Godot(GDScript/GUT)에서 **React + React Three Fiber(R3F) 웹 3D + 오프라인 렌더 깊이합성**으로 교체됨. 클라이언트 로직·컴포넌트·셰이더 검증은 Vitest(단위)와 Playwright(E2E)로, 아바타 이동·근접·좌석 점유 등 권위 검증은 **Colyseus 실시간 서버 테스트(Node/TS)**로 수행한다. Godot GUT / gut_cmdline / headless 실행은 폐기.

### 3.1 프론트/3D 단위 테스트 (Vitest)

**파일**: `frontend/tests/**/*.test.ts(x)`, `spikes/depth-composite/tests/**/*.test.ts`

**목적**: R3F 컴포넌트 렌더·상태, 깊이합성 셰이더 정확도, 클라이언트 좌표/보간 로직 검증

**구조**:

```ts
// R3F 컴포넌트 렌더 (@react-three/test-renderer)
describe("AvatarMesh", () => {
  // - 위치 prop → 메시 transform 반영
  // - presence 상태 변이 → 머티리얼/라벨 갱신
  // - 원격 아바타 스냅샷 보간(lerp) 정확도
});

// 깊이합성 셰이더 (spikes/depth-composite 게이트)
describe("DepthCompositeShader", () => {
  // - 오프라인 렌더 depth PNG ↔ WebGL depth 정렬
  // - 오클루전 경계: 아바타-가구 가림 판정
  // - 경계 오차 ≤ 2px (스파이크 PASS 게이트, D27)
});

// 근접/좌석 클라이언트 표현 로직
describe("ProximityUI", () => {
  // - 근접 반경 <= 2m → 상호작용 버튼 표시
  // - 범위 벗어남 → 숨김 (표현만; 권위 판정은 서버)
});
```

**테스트 케이스 수**:
- R3F 컴포넌트: 6개 (렌더, transform, presence, 라벨, 보간, 언마운트)
- 깊이합성 셰이더: 5개 (depth 정렬, 오클루전, **경계오차 ≤ 2px 게이트**, 스케일, 카메라 파라미터)
- 근접/좌석 UI: 4개 (표시, 숨김, 범위, 좌석 표현)

**합계**: ~15개 테스트 케이스

### 3.2 실시간 서버 테스트 (Colyseus, Node/TS)

**파일**: `realtime-server/test/**/*.test.ts`

**목적**: 룸 라이프사이클, 이동·근접 권위 검증, 20Hz tick, 스냅샷/보정을 서버 측에서 검증

**구조**:

```ts
// @colyseus/testing 기반
describe("OfficeRoom", () => {
  // 룸 라이프사이클
  // - onJoin: JWT 검증 → 클라이언트 등록, 초기 스냅샷 전송
  // - onLeave: presence 정리, 좌석 해제

  // 이동 권위 검증 (8케이스)
  // - 유효 이동 → 상태 반영
  // - 속도 초과 → 서버 클램프(치팅 방지)
  // - 벽/가구 충돌 → 이동 거부
  // - 타 아바타 밀치기 없음 (서버 권위)

  // 근접 권위 검증 (8케이스)
  // - 근접 반경 진입/이탈 판정
  // - 근접 채팅 대상 집합 산출
  // - 회의실 점유·중복 점유 거부

  // tick / 스냅샷
  // - 20Hz(50ms) 시뮬레이션 tick 유지
  // - 스냅샷 브로드캐스트 및 sequence_num 재동기화
});
```

**테스트 케이스 수**:
- 룸 라이프사이클: 4개 (join/leave/JWT/좌석해제)
- 이동 권위 검증: 8개 (유효, 속도클램프, 벽, 가구, 아바타충돌, 좌표경계 등)
- 근접 권위 검증: 8개 (진입/이탈, 채팅집합, 회의실점유, 중복거부 등)
- tick/스냅샷: 4개 (20Hz 유지, 스냅샷, sequence_num 재동기, 재접속 복구)

**합계**: ~24개 테스트 케이스

### 3.3 테스트 실행

```bash
# 프론트/3D 단위 (Vitest)
cd frontend && npx vitest run
cd spikes/depth-composite && npx vitest run   # 깊이합성 셰이더 게이트

# 실시간 서버 (Colyseus, Node/TS)
cd realtime-server && npm test

# E2E (Playwright) — §4 CI 및 Phase 3+ 참조
cd frontend && npx playwright test
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

  frontend:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - Node 20 설치
      - npm ci (frontend, spikes/depth-composite)
      - npx vitest run --coverage (R3F·깊이합성 셰이더, 경계오차 ≤ 2px 게이트)
      - npx playwright test (E2E, Phase 3+)
      - 테스트 결과 수집 (JUnit XML)

  realtime:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - Node 20 설치
      - npm ci (realtime-server)
      - npm test (@colyseus/testing: 룸·이동검증8·근접검증8·20Hz tick·스냅샷)
      - 테스트 결과 수집 (JUnit XML)

  quality-gate:
    needs: [backend, frontend, realtime]
    steps:
      - 테스트 통과 여부 확인 (pytest / Vitest / Colyseus)
      - 커버리지 >= 70% 확인
      - 깊이합성 경계오차 ≤ 2px 게이트 확인 (스파이크)
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
│     └─ Vitest: 프론트/3D·셰이더 통과           │
│     └─ Colyseus: 실시간 룸 테스트 통과         │
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
- [x] test-phase.yaml: CI/CD 정의 (backend/frontend/realtime 잡)
- [x] 테스트 총 수: 백엔드 계약 ~78개(skip) + 프론트/3D ~15개 + 실시간 ~24개
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
| **아바타 동기화** | Colyseus p95 < 500ms | 20명 부하 시뮬레이션 → 지연 측정 | 3+ |
| **서버 tick** | 20Hz (50ms) | Colyseus 룸 tick 계측 (Node) | 2+ |
| **초기 로딩 시간** | < 5초 | 웹 3D 씬 최초 렌더까지(브라우저) | 2+ |
| **회의록 STT** | 누락률 < 5% | 테스트 회의 N회 대조 | 4+ (S2) |
| **브라우저 프레임(아바타 N명)** | 데스크톱 60fps / 저사양 30fps | 브라우저 devtools 프레임 계측 | 2+ |
| **실시간 메시지 지연** | < 200ms (근접 메뉴) | Colyseus 클라이언트 왕복 측정 | 2+ |

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

# 프론트/3D 테스트 (Vitest) + 실시간 서버 (Colyseus)
cd frontend && npx vitest run
cd realtime-server && npm test

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
| **0** | 스텁 작성, conftest, 깊이합성 셰이더 스파이크 | pytest, pytest-asyncio, Vitest |
| **1** | 백엔드 구현, 단위 테스트 | httpx, SQLAlchemy, Factory Boy |
| **2** | 웹 3D 클라이언트·실시간 서버 테스트 | Vitest, @react-three/test-renderer, @colyseus/testing |
| **3** | E2E 테스트 | Playwright, live DB |
| **4** | 성능 테스트 | pytest-benchmark, locust, 브라우저 devtools |

---

## 10. 참고 문서

- **00-decisions.md**: D21(1인 운영), D22(성능 수치)
- **11-tech-stack.md**: §4.2(빌드/배포 파이프라인)
- **12-tasks.md**: P0-T0.7, P1-T1.2, P2-T2.1

---

**문서 버전**: 2.0  
**마지막 갱신**: 2026-07-09  
**상태**: D27 반영 확정

### 변경 이력

| 버전 | 날짜 | 변경 |
|------|------|------|
| 1.0 | 2026-07-02 | 최초 작성 (Godot/WorkAdventure 기준) |
| 2.0 | 2026-07-09 | **D27 반영** — Godot(GUT/GDScript, headless gut_cmdline) 게임클라 테스트·CI·성능표(Godot profiler/GTX1650) 폐기. Vitest(프론트/R3F/깊이합성 셰이더, 경계오차 ≤ 2px 게이트) + Playwright(E2E) + Colyseus 실시간 서버 테스트(룸·이동검증8·근접검증8·20Hz tick·스냅샷)로 교체. 백엔드 pytest·API 계약 테스트·통합 시나리오는 보존. 정본: 00-decisions §H, 14/15/16. |
