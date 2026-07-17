# 전체 회귀 게이트 리포트

- 실행 주체: RegressionSweep (병렬 QA 레인)
- 실행 일시: 2026-07-17
- 대상: backend(pytest, in-memory sqlite), realtime(colyseus, tsx smoke + live :2567 load target), frontend(tsc/vitest)
- 코드 수정 없음. 라이브 서버(backend 8000 / frontend 3000 / realtime 2567 / LiveKit 컨테이너) 재시작/종료 없음.

## 1. Backend 전체 (pytest -q)

```
cmd.exe /c "cd backend && set DATABASE_URL=sqlite+aiosqlite:///:memory:&& .venv\Scripts\python.exe -m pytest -q 2>&1"
```

**[PASS]** 355 passed, 85 skipped, 0 failed, 31 warnings, 248.38s (0:04:08). 요청: 전체 스위트 실행. 기대: 실패 0건. 실제: `355 passed, 85 skipped, 31 warnings in 248.38s` — 실패 없음.

- Skip 85건 사유: `backend/tests/conftest.py:163`의 전역 훅이 `tests/contract/*` 경로의 모든 테스트를 자동 skip 처리 — `pytest.mark.skip(reason="구현 대기 (Phase 2+ 계약 스텁)")`. 대상 파일:
  - `tests/contract/test_management_api_stubs.py` — 개별 마커 사유 `"Phase 1에서 구현 후 활성화"` (약 16개 케이스 확인: auth/login, seats CRUD, layouts CRUD 등)
  - `tests/contract/test_realtime_api_stubs.py` — 개별 마커 사유 `"Phase 1에서 구현 후 활성화"`(핸드셰이크/재접속/메시지/에러, 다수) + `"Phase 2+ (부하 테스트)"`(E2E 지연) + `"Phase 3+ (스파이크 S3)"`(헤드리스 부하) + `"Phase 2+"`(tick rate)
  - 즉 이 계약 스텁들은 실제 라이브 서버(:8000 API, 실 WS) 대비 실행된 적이 없는 "설계만 있는 골격" 상태 — Phase 1/2/3 구현 완료 여부와 무관하게 conftest 훅이 무조건 skip시키므로, 실제 구현이 끝났더라도 이 파일들은 재활성화(마커 제거) 없이는 영원히 skip으로 남는다.

- Deprecation 경고(비차단): `KpiResultOut`의 Pydantic V1 class-based Config, `LayoutCreate`/`LayoutUpdate`의 `json` 필드명이 BaseModel 속성을 shadow, `HTTP_422_UNPROCESSABLE_ENTITY` deprecated in FastAPI/Starlette. 회귀 없음이나 향후 버전 업그레이드 시 파손 위험.

## 2. Backend redteam (tests/redteam 단독)

```
cmd.exe /c "cd backend && set DATABASE_URL=sqlite+aiosqlite:///:memory:&& .venv\Scripts\python.exe -m pytest tests/redteam -q 2>&1"
```

**[FAIL]** 요청: `tests/redteam` 디렉토리 pytest 실행. 기대: N개 테스트 수집·실행. 실제: **"no tests ran (exit code 5)"** — `tests/redteam/`에는 `__pycache__/`만 존재하고 테스트 소스(`.py`) 파일이 전부 없음 (`__init__.py` 포함 0개). `__pycache__` 안의 `.pyc` 잔재로 미루어 최소 19개 redteam 파일이 과거 존재했던 흔적(`test_action_items_redteam`, `test_audit_producer_redteam`, `test_auth_lockout_redteam`, `test_auth_redteam`, `test_directory_redteam`, `test_erp_mirror_redteam`, `test_erp_sync_strategy_redteam`, `test_kpi_aggregate_redteam`, `test_kpi_redteam`, `test_layouts_redteam`, `test_meetings_redteam`, `test_minutes_redteam`, `test_org_team_zone_redteam`, `test_presence_redteam`, `test_realtime_redteam`, `test_seats_redteam`, `test_sync_audit_redteam`, `test_worklogs_redteam`). `git status`/`git log -- tests/redteam`은 빈 결과 — 이 파일들은 git으로 추적된 적이 없어(unstaged 신규 파일이었거나 다른 방식으로 생성) 삭제 이력조차 git에 남지 않음. 즉 redteam 스위트는 현재 리포지토리 상태에서 **전혀 실행 불가능**.
- 재현: `cmd.exe /c "cd backend && dir tests\redteam"` → `.py` 파일 0개, `__pycache__` 잔재만 확인.
- 참고: 위 backend 전체 실행(§1)의 355 passed에는 redteam 케이스가 전혀 포함되지 않는다(`pytest.ini`의 `testpaths = tests`가 이론상 하위 디렉토리를 포함하지만 소스 부재로 수집 대상이 없었음).

## 3. Realtime 스모크 스위트

```
cmd.exe /c "cd realtime && npm test 2>&1"
cmd.exe /c "cd realtime && npm run client-smoke 2>&1"
cmd.exe /c "cd realtime && npm run presence-smoke 2>&1"
cmd.exe /c "cd realtime && npm run layout-smoke 2>&1"
```

**[PASS]** `npm test` (room.smoke + scene-floor, in-process ephemeral 서버, 라이브 :2567과 무관): room.smoke `30 passed, 0 failed`; scene-floor `13 passed, 0 failed`. 요청: 이동/충돌/근접/재접속/제거/씬 레이아웃 검증. 기대: 전부 PASS. 실제: 43/43 PASS.

**[PASS]** `npm run client-smoke`: `8 passed, 0 failed` (스폰 위치, 이동, roster sync, JWT sub 우선 검증, 잘못된 JWT 거부 포함). 콘솔의 `Error: unauthorized: invalid token` 및 `onError => (4216)`는 마지막 케이스("invalid JWT → join rejected")가 의도한 네거티브 경로 로그이며 실패 아님.

**[PASS]** `npm run presence-smoke`: `6 passed, 0 failed` — presence 배치 POST 경로/메서드/내부 토큰 헤더/레코드 필드/빈 배치 스킵 검증.

**[WARN]** `npm run layout-smoke`: 스크립트 내부 5개 어써션은 전부 `PASS`(`http provider fetched`, `internal token header`, `404 fallback`, `factory empty-url`, `factory url+horizon fallback`)이지만 프로세스가 정상 종료하지 못하고 **`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`**로 크래시, `exit code 9`. 요청: layout-smoke 정상 종료. 기대: exit 0. 실제: 로직상 5/5 PASS이지만 프로세스 종료 시 libuv 어써션 크래시로 비정상 종료 코드 반환 — CI에서 "테스트 실패"로 오탐될 위험.
- 재현: `cmd.exe /c "cd realtime && npm run layout-smoke 2>&1"` (Windows Node 22 + tsx 조합에서 재현; 소스 로직 문제라기보다 tsx/libuv 클린업 타이밍 이슈로 추정).

## 4. Realtime 부하 시뮬레이션 (load-sim)

```
cmd.exe /c "cd realtime && npm run load-sim 2>&1"
```

**[WARN]** 요청: 라이브 서버(:2567) 대상 20인 부하, p95 기록. 기대: 기존에 떠 있는 :2567 인스턴스에 접속. 실제: `realtime/scripts/load-sim-20.ts`가 **자체 in-process 서버를 하드코딩된 포트 `2599`에 새로 기동**(`[load-sim] server up on :2599`, 소스 `const PORT = 2599`)하여 그 서버를 대상으로 테스트함 — 라이브 :2567 서버는 이 스크립트로 부하 시험할 수 없는 구조(스크립트에 대상 서버 URL을 주입하는 옵션이 없음). 즉 "라이브 서버 대상" 요구사항은 현재 스크립트로 충족 불가.
- 측정치(참고용, in-process :2599 대상): 접속 유지 20/20, 프로브 표본 25/25(move_rejected 175건 — 의도된 과속 이동 거부), **E2E p50=104ms, p95=135ms, max=145ms**, 판정 `PASS 20명 동시접속 + p95 < 500ms (D22)`.
- 재현/한계 확인: `cmd.exe /c "cd realtime && npm run load-sim 2>&1"` → 로그 1행 `[load-sim] server up on :2599`로 대상이 라이브 :2567이 아님을 직접 확인 가능. 라이브 :2567 자체를 부하 시험하려면 별도 외부 클라이언트 스크립트(대상 URL 파라미터화)가 필요 — 이번 실행 결과는 라이브 인스턴스의 실측치가 아님.

## 5. Frontend (코드 수정·next build 없음)

```
cmd.exe /c "cd frontend && npx tsc --noEmit 2>&1"
cmd.exe /c "cd frontend && npx vitest run 2>&1"
```

**[PASS]** `npx tsc --noEmit`: 출력 없음 → 타입 오류 0건. 요청: 전체 타입체크. 기대: 오류 0건. 실제: 오류/경고 없이 종료.

**[PASS]** `npx vitest run`: `tests/office2d.test.ts (11 tests)` 전부 통과. Test Files 1 passed(1), Tests 11 passed(11), Duration 2.06s. 요청: vitest 전체 실행. 기대: 전부 PASS. 실제: 11/11 PASS.
- 참고(수리 범위 아님): frontend `tests/`에는 vitest 대상 스펙이 `office2d.test.ts` 1개뿐 — `OfficeViewport2D.tsx`(54KB), `OfficeShell.tsx`(54KB) 등 대형 컴포넌트에 대한 유닛 커버리지는 vitest 스위트에 없음(별도 Playwright/e2e 산출물이 `artifacts/qa/`에 존재하나 이번 회귀 게이트 범위 밖).

## 요약 표

| 스위트 | 결과 | Pass | Fail | Skip | 비고 |
|---|---|---|---|---|---|
| backend 전체 | PASS | 355 | 0 | 85 | skip 전량 `tests/contract/*` 계약 스텁 (conftest 강제 skip) |
| backend redteam | **FAIL** | - | - | - | 소스 `.py` 파일 0개, no tests ran (exit 5) |
| realtime `npm test` | PASS | 43 | 0 | 0 | room.smoke 30 + scene-floor 13 |
| realtime client-smoke | PASS | 8 | 0 | 0 | |
| realtime presence-smoke | PASS | 6 | 0 | 0 | |
| realtime layout-smoke | **WARN** | 5 | 0(어써션상) | 0 | libuv 크래시로 exit code 9 |
| realtime load-sim | **WARN** | 1(D22 판정) | 0 | 0 | 대상이 라이브 :2567이 아닌 자체 :2599 서버 — p50=104ms p95=135ms max=145ms (in-process 측정치) |
| frontend tsc --noEmit | PASS | - | 0 | - | 타입 오류 없음 |
| frontend vitest | PASS | 11 | 0 | 0 | office2d.test.ts만 존재 |

## FAIL/WARN 종합 (오케스트레이터 조치 필요)

1. **[FAIL] backend redteam 스위트 실행 불가** — `backend/tests/redteam/*.py` 소스 전량 부재(19개 파일명 추정, `__pycache__`만 잔존). git 이력에도 없음 → 복구 또는 재작성 필요. 재현: `cmd.exe /c "cd backend && set DATABASE_URL=sqlite+aiosqlite:///:memory:&& .venv\Scripts\python.exe -m pytest tests/redteam -q 2>&1"` → `no tests ran (exit code 5)`.
2. **[WARN] realtime layout-smoke 비정상 종료** — 어써션은 5/5 PASS이나 프로세스가 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`로 크래시, exit code 9. CI 게이트에서 오탐 실패 처리될 위험.
3. **[WARN] load-sim이 라이브 :2567을 대상으로 하지 않음** — `realtime/scripts/load-sim-20.ts`가 하드코딩 포트 2599의 자체 서버를 기동해 테스트. 라이브 인스턴스 실측 p95가 필요하면 대상 URL을 주입할 수 있는 별도 부하 스크립트가 필요(현 스크립트로는 불가능).
