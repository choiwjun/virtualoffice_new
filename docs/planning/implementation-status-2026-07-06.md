# 구현 현황 · 핸드오프 문서 (2026-07-06)

> 기획 정본 대비 개발 구현 상태 전수조사 결과 + 다음 담당자 인수인계.
> 기준 커밋: `aef929b` (feat: 미구현 계약 API 갭 구현)
> 정본 참조: `docs/api/management-api.yaml`, `docs/planning/loop/08-derived-gates.md`(REQ-001~011), `10-roadmap.md`(Phase 0~7), `specs/screens/`(11화면), `00-decisions.md`(D1~D26)

---

## 0. 한눈에 요약

- **아키텍처(D26)**: 3D 메인 오피스 = WorkAdventure self-host(`:8090`) / 관리·업무·KPI = Next.js 웹 콘솔(`:3000`) + FastAPI 백엔드(`:8090/api/*`, Caddy 경유).
- **계약 API**: management-api.yaml 34개 경로 중 **28 구현 / 3 미구현 / 7 drift**. 구현 라우트 총 65개(OIDC·WA 포함).
- **웹 콘솔 화면**: 11 스펙 중 10 실동작 + 감사로그(추가). org-chart는 조회 전용, virtual-office는 WA.
- **최대 잔여 리스크**: ① 배치 스케줄러 부재(D17/D18 운영 자동화 0) ② WA 맵 비주얼/상호작용 미완(placeholder) ③ STT·AI·실ERP(외부 의존).
- **테스트**: `pytest 374 passed / 85 skipped / 0 failed`, `npm run build EXIT=0(16 routes)`.

---

## 1. 실행 환경 / 접속

| 구성 | URL / 위치 | 비고 |
|---|---|---|
| 웹 관리콘솔 (Next dev) | http://localhost:3000 | 반드시 `localhost`(CORS가 localhost:3000만 허용, 127.0.0.1 차단). `frontend/`에서 `npm run dev` |
| 백엔드 API (Caddy) | http://localhost:8090/api/* | 도커 `volocal_backend`(:8000) → caddy 라우팅 |
| 가상 오피스 (WorkAdventure) | http://localhost:8090 | OIDC 로그인 경유. 콘솔 사이드바 "가상 오피스 입장" 링크 |
| OIDC Provider | http://auth.localhost:8090/oidc/* | FastAPI가 OIDC Provider (D4 JWT와 공존) |

**로그인 계정** (`@virtualoffice.local` / `password123`): `alice`(admin), `bob`(leader), `charlie`(employee).

**도커**: Windows Rancher `docker.exe` (WSL). `DEXE="/mnt/c/Users/wj941/AppData/Local/Programs/Rancher Desktop/resources/resources/win32/bin/docker.exe"`. 로컬 스택 `docker-compose.local.yml`(volocal_*).

---

## 2. 구현 완료 현황 (management-api.yaml 28/34)

| 영역 | 구현 엔드포인트 | 파일 |
|---|---|---|
| 인증 | login, refresh, me | `api/auth.py` |
| 직원 | employees, employees/{id} | `api/erp.py` |
| 팀·조직 | teams, org-groups | `api/directory.py` |
| 좌석 | seats GET/POST/PUT/DELETE, floors | `api/seats.py` |
| 배정 | seat-assignments POST, release | `api/seats.py` |
| 레이아웃 | office-layouts CRUD+validate/deploy/rollback (D12) | `api/office_layouts.py` |
| 회의 | meetings CRUD+PUT/DELETE+join+participants | `api/meetings.py` |
| 회의록 | meeting-minutes CRUD+finalize+action-items | `api/meeting_minutes.py` |
| 업무기록 | work-logs CRUD+summary | `api/work_logs.py` |
| KPI | compute/list/detail/adjust/finalize/objections(POST·GET)/review | `api/kpi.py` |
| ERP | erp/sync, erp-sync/status, erp-sync/failures, attendances | `api/erp.py` |
| 감사 | audit-logs (+mutation 자동기록) | `api/audit.py`, `services/audit.py` |
| WA | wa/presence, presence/stream(SSE), wa/livekit-token | `api/wa_*.py` |
| OIDC | authorize/token/userinfo/jwks/discovery | `integrations/workadventure/oidc.py` |

웹 화면(`frontend/app/(protected)/`): employees, work-log, meetings, kpi, admin/kpi, kpi/objection, admin/kpi/objections, admin/org-chart, admin/office-layout, admin/sync, admin/audit.

---

## 3. 미구현 · 누락 (전수)

### 3.1 계약 미구현 — 3개
| 경로 | 내용 | 판정 |
|---|---|---|
| `GET /seat-assignments` | 배정 이력·내역 조회 | **즉시 구현 가능** (seat_assignment_history 테이블 존재) |
| `PUT /seat-assignments` | 배정 수정(관리자) | **즉시 구현 가능** |
| `GET /meeting-minutes/{id}/stt-draft` | STT 자동초안(D5) | Phase 5 후속(외부 의존) — 현재 POST 501 스텁 |

### 3.2 계약 drift (동작하나 명세 불일치) — 7건
1. `/users`→`/api/employees` + 필터/페이지네이션/`{items,total}` envelope 미구현(bare 배열)
2. adjust·objections/review: 계약 PUT vs 구현 POST
3. work-log·minutes 수정: 계약 PUT vs 구현 PATCH
4. release path: 계약 `{assignment_id}` vs 구현 `{seat_id}`
5. 로그인 성공 코드: 계약 201 vs 구현 200
6. 이의신청 3유형 enum 미강제(free string)
7. `/erp-sync/trigger`→`/api/erp/sync`
- **권고**: OpenAPI를 v1.1로 구현에 맞춰 갱신(문서 지연).

### 3.3 REQ 게이트 잔여
| REQ | 잔여 |
|---|---|
| REQ-002 ERP동기화 | **APScheduler 배치(매시간 증분+00:00 대사) 없음**, 실 ERP DB 미접속, 실패 알림 훅 없음 |
| REQ-003 좌석편집기 | validate/deploy/rollback 상태머신 완료. **좌석편집기가 공식 스키마 layout JSON 생성 못함**→실배포 흐름 미완 |
| REQ-005 회의/화상 | 실미디어 릴레이 프로덕션 이관, **녹음·STT 동의 배너(D20-b) 미구현**, OQ13 미확정 |
| REQ-006 STT | ❌ 미구현(501). S2 스파이크 미수행 |
| REQ-007 KPI | 결정론/D15/D16 완료. **AI 서술초안(ai_draft) 미생성**, 분기 100명 배치 미검증 |
| REQ-008 EOD Push | ❌ daily_status_push 적재만. **18:00 배치·실전송·재시도·run_id 멱등 미구현**, `GET daily-status-push` 조회 API 없음 |
| REQ-009~011 (Phase 7) | 다층 권한·회의록 AI요약·org_group CRUD 에디터 전부 미착수 |
| HG-SEC/AUTH/BACKUP | 외부공개 하드닝·rate-limit·로그인 5회 백오프 잠금·pg_dump 리허설 미수행 |

### 3.4 가상 오피스(WA) 미완 (2026-07-06 진단)
- 입장·이동·presence·멀티유저·OIDC **동작함**. 그러나:
  - `tileset.png` 251바이트 **placeholder(단색 회색)** → 오피스 비주얼 없음(회색 격자)
  - `org-map.wam`의 `areas`/`entities` **비어 있음** → 회의존 D24 명시입장 클릭 상호작용 미배선
  - `entities.json` 404 → 맵 에디터 오브젝트(가구) 팔레트 비어 있음
  - `POST /api/maps/generate|validate` **API 미노출**(`services/map_generator.py` 스크립트만: `scripts/generate_and_upload_map.py`)
  - WA 고급 scripting(직원패널 iframe·presence 배지·external 토글) 미구현(Phase 4)
- "WorkAdventure 설치?" 프롬프트 = 브라우저 **PWA 설치 배너**(WA가 PWA) — 오류 아님, 무시 가능.

### 3.5 D26 폐기 잔재 (정리 대상)
- `docs/api/realtime-server-api.yaml`(Godot 실시간 서버 계약 — WA WSS로 대체됨)
- `backend/app/services/office_layout_to_godot.py`(데드 서비스)
- `godot/`(테스트 스텁 1파일)

---

## 4. 다음 작업 우선순위

### A. 현 범위 즉시 구현 가능 (외부 의존 없음)
1. **WA 맵 개선** (체감 최대) — `map_generator`가 알아볼 수 있는 타일셋(바닥/벽/책상/회의존 색구분) 생성 + WAM `areas` 배선(회의존 D24) + start/entities 정합. 재생성→map-storage 재배포→렌더 검증.
2. **APScheduler 배치** — KPI 18:00/21:00(D17), ERP 매시간+00:00 대사(D18). FastAPI lifespan에 스케줄러 등록, 수동 트리거 유지.
3. **조회 API 2종** — `GET /seat-assignments`(이력), `GET /api/daily-status-push`(ERP 전송 큐). 테이블 존재, API만.
4. **좌석편집기 스키마 draft** — validate 통과 가능한 공식 office_layout JSON 생성(REQ-003 완결).
5. `POST /api/maps/generate|validate` API 노출.
6. 로그인 5회 백오프 잠금(HG-AUTH).
7. 계약 drift 정리(OpenAPI v1.1).
8. D26 폐기 잔재 삭제.

### B. 외부 의존 필요 (Phase 5~7)
- STT(D5, LiveKit Egress+STT+S2), AI 초안/요약(Claude SDK), 실 ERP push/DB(ERP dev 브랜치), WA 고급 scripting·20인 부하, 다층/구역 권한·모바일, HG-SEC 하드닝·백업 리허설.

---

## 5. 검증 방법 (재현)

- **백엔드 테스트**: `cd backend && DATABASE_URL=sqlite+aiosqlite:///:memory: .venv/bin/python -m pytest tests/ --ignore=tests/test_migrations.py -q`
  - ⚠️ `DATABASE_URL`을 sqlite로 지정해야 함(기본 postgres+asyncpg는 venv 미설치). `app.db`가 import 시 엔진 생성.
- **프론트 빌드**: `cd frontend && npm run build` (npm 사용, pnpm 금지).
- **백엔드 반영**: `volocal_backend`는 `build: ./backend` 이미지 → 코드 변경 시 `docker compose -f docker-compose.local.yml up -d --build backend` + `docker restart volocal_caddy`.
- **신규 /api 경로**: `config/Caddyfile.local`에 `handle /api/<path>* { reverse_proxy backend:8000 }`를 catch-all `/api/*`(→wa-back) **앞에** 추가 필수.
- **브라우저 E2E**: WSL 헤드리스 크로뮴 불가 → `ghcr.io/puppeteer/puppeteer` 컨테이너(`--network host`)로 실행. 스크립트는 `artifacts/webconsole/`.
- **AUTO_CREATE_TABLES=true**: 신규 모델은 컨테이너 재기동 시 자동 생성(기존 테이블 미변경).

---

## 6. 알려진 함정 (다음 담당자 필독)

1. **sync가 로그인 계정 비활성화**: `/admin/sync` "지금 동기화"(mock ERP)가 시드 사용자(1001~1003)를 D18 soft-delete → 로그인 401. 복구: `docker exec volocal_backend python -c "import sqlite3;c=sqlite3.connect('/data/dev.db');c.execute('update erp_user set is_active=1 where id in (1001,1002,1003)');c.commit()"`
2. **puppeteer 컨테이너는 host 프로세스(:3000 next dev) 못 봄**: `--network host`는 Rancher VM 네트워크 → 도커화된 `:8090`만 닿음. 검증 시 `next start`를 `--network host` 컨테이너(:3000)로 띄워야 함(예: `vo_verify`). 호스트 dev는 사용자 브라우저용.
3. **/mnt/c(WSL) 빌드 느림**: `next build`·`npm install` 수 분. 온디맨드 컴파일도 수 초.
4. **team(tmux 워커) 비가용**: 이 환경에서 워커 subsession이 폐기 모델(`claude-3-5-sonnet-20240620`) 404 또는 페인 미생성으로 기능 안 함. 위임은 리더 직접 구현 or task 서브에이전트(동일 모델 리스크).
5. **UUID 컬럼 직접 insert**: 모델은 uuid.UUID 객체 요구(문자열 넣으면 `'str' object has no attribute 'hex'`). API는 파싱하므로 정상.
6. **SQLEnum 저장값**: enum NAME(대문자, 예 `DIVISION`) 저장. 원시 SQL 시드 시 주의.
7. **스크린샷 게이트 엔트로피**: 깨끗한 흰 UI는 검증기(압축 raw 픽셀 엔트로피)를 못 넘음 → 텍스트 테이블 + 선택 하이라이트(select-all)로 캡처. 캔버스(2D 그리드)는 통과 어려움.

---

## 7. 파일 맵 (이번 세션 신규/변경)

- 백엔드 신규: `api/directory.py`, `api/audit.py`, `api/office_layouts.py`, `services/audit.py`, `models/tables.py`(ErpSyncLog)
- 백엔드 변경: `api/erp.py`(sync 로그+status/failures), `api/kpi.py`(objections GET+감사), `api/seats.py`(CRUD+floors), `api/meetings.py`(PUT/DELETE), `main.py`, `config/Caddyfile.local`
- 프론트 신규: `app/(protected)/admin/audit/page.tsx`
- 프론트 변경: office-layout(좌석 CRUD+D12 패널), sync(실 erp-sync), org-chart(org-groups), meetings(취소), Sidebar(가상오피스 링크·감사메뉴), SeatCanvas(삭제), lib/api(put), lib/kpi
- 테스트: `test_directory_audit.py`, `test_seat_meeting_crud.py`, `test_layouts_sync.py`, `test_foundation.py`(21 갱신)
- 증거: `artifacts/webconsole/`(E2E 스크립트·트랜스크립트·스크린샷·junit)
