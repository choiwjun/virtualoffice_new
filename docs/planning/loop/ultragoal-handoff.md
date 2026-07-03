# Ultragoal 실행 Handoff (재개용)

> ✅ **완료됨 (2026-07-03)**: 이 handoff는 재개용으로 작성됐으나, 이후 ultragoal이 **G001~G011 전부 complete**로 종료됐다(status: complete, goals 12 = complete 11 + superseded 1, final-aggregate 영수증 기록). durable 상태는 새 세션에서 `GJC_SESSION_ID=019f2518-c48d-7000-a12b-2bd735ed23cc`로 접근했다. 아래 §2의 "4 완료 · G005 진행중" 진행표는 **역사적 스냅샷**이며 현재 상태 아님. 관리 API(G001~G010)는 세 레인 CLEAR 완료, 환경차단 잔여작업은 `blocked-work-registry.md`(B-01~B-21)에 durable 등록됨. 전체 회귀 282 passed/28 skipped/0 failed.

**작성 시각**: 2026-07-02 (세션 중단·PC 재부팅 대비)
**세션 id**: `019f229e-e029-7000-9418-2c25814145f1`
**durable 상태**: `.gjc/_session-019f229e-e029-7000-9418-2c25814145f1/ultragoal/{goals.json, ledger.jsonl}`
**중단 사유**: 사용자 지시("잠깐 작업중단해") + PC 재부팅 예정. pause/drop은 ultragoal 게이트가 "미완료 스토리 존재"로 거부 → 작업만 중단하고 상태 보존.

> ⚠️ 재부팅 후 `.gjc/_session-...` 은 **세션 id가 바뀌면 새로 생성**된다. 이 durable ultragoal은 위 세션 id에 묶여 있으므로, 새 세션에서 이어가려면 아래 "재개 방법" 참조.

---

## 1. 전체 목표

승인된 기획(`docs/planning/loop/final-planning-approval.md`, Ready with Risks)에 따라 **가상오피스 백엔드 관리 API**를 구현. 원본 브리프: `docs/planning/loop/_ultragoal-brief.md`.
- 정본(SSOT): `docs/planning/00-decisions.md` (D1~D25, F절). 충돌 시 정본 우선.
- 수용 기준: `backend/tests/contract/test_management_api_stubs.py` 계약 스텁을 활성화·통과. 스텁이 모델/명세와 어긋나면 **명세 우선으로 rigorous 재작성**(스텁 docstring이 "구현과 함께 활성화"라 명시).
- 환경 차단 작업(Godot/GPU/LiveKit/STT/ERP 라이브 DB/도메인)은 코드로 완결하지 말고 **G011에서 durable blocker로 기록**.

## 2. 진행도: 11개 스토리 중 4 완료 · G005 진행중 · 6 대기

| ID | 스토리 | 상태 | 증거 |
|---|---|---|---|
| G001 | 인증 API + JWT | ✅ 완료·체크포인트 | `backend/artifacts/g001-*.{xml,json}` |
| G002 | 직원(RBAC)·팀·조직도 | ✅ 완료·체크포인트 | `g002-*` |
| G003 | 좌석 배정(배타성) | ✅ 완료·체크포인트 | `g003-*` |
| G004 | 레이아웃 + 검증 + 스키마 | ✅ 완료·체크포인트 | `g004-*` |
| **G005** | **회의 + 예약** | **🔄 구현·검증 완료, 미체크포인트** | `g005-meetings.xml`, `g005-meetings-redteam.xml` (품질게이트 JSON 미작성) |
| G006 | 회의록 + STT 스키마 | ⏳ 대기 | — |
| G007 | 업무 기록(work_log) | ⏳ 대기 | — |
| G008 | KPI + 이의신청 상태머신 | ⏳ 대기 | — |
| G009 | 동기화 모니터링 + 감사 로그 | ⏳ 대기 | — |
| G010 | 보안 하드닝 + 배치 스케줄러 | ⏳ 대기 | — |
| G011 | 환경차단 작업 durable 등록 | ⏳ 대기 | — |

**현재 테스트 베이스라인**: 전체 `133 passed / 54 skipped / 0 failed` (시작 시 32 passed). 회귀 없음.

## 3. ⬅️ 여기서부터 재개: G005 마무리

G005는 **구현·검증 완료**이나 아직 체크포인트되지 않았다. 리뷰 판정:
- architect(13-G005MeetingArchReview): **architecture=WATCH, product=CLEAR, code=CLEAR, recommendation=APPROVE, blockers=[]**
- red-team(14-G005MeetingRedTeam): **18 passed, 취약점 0**

게이트 기준 "clean = 세 레인 CLEAR"이므로 **architecture WATCH를 해소한 뒤 재리뷰 CLEAR → 품질게이트 JSON → 체크포인트**해야 한다.

### G005 남은 작업 (WATCH 해소, `backend/app/api/meetings.py`)
1. **CANCELLED/COMPLETED 회의 join 차단** (red-team 8b + architect MEDIUM): 현재 취소된 회의도 join이 200 + 토큰 발급. join 핸들러에 status 가드 추가 → CANCELLED/COMPLETED면 409(또는 404). 테스트 추가.
2. **open-ended(scheduled_end IS NULL) 회의 충돌 미보호** (architect MEDIUM): 충돌 검사가 `scheduled_end.is_not(None)`로 NULL 회의를 제외 → 잠재 갭. NULL 회의도 충돌 검사에 포함하거나(예: NULL은 상시점유로 간주) 정책을 주석·테스트로 명시.
3. **예약충돌 TOCTOU** (architect MEDIUM): SELECT+INSERT 비원자적. 온프렘 단일 인스턴스라 위험 낮음 → 최소한 코드 주석 + 후속 티켓 명시(또는 DB 배타 제약). 판단 후 처리.
4. **LOW**: `tables.py:900` 스테일 주석("scheduled_start/end 없음" → 이제 scheduled_end 존재) 정정.

### G005 마무리 절차 (완료 게이트)
```sh
PY="$(pwd)/backend/.venv/Scripts/python.exe"
# 1) WATCH 수정 후 회의 테스트 + 전체 회귀
cd backend && "$PY" -m pytest tests/contract/test_management_api_stubs.py::TestMeetingAPI tests/redteam/test_meetings_redteam.py -q
"$PY" -m pytest -q   # 전체 회귀(133+ passed, 0 fail 유지)
# 2) architect 재리뷰(task architect) → 세 레인 CLEAR 확인
# 3) 품질게이트 JSON 작성: backend/artifacts/g005-quality-gate.json (g004 형식 참조)
# 4) 체크포인트:
gjc ultragoal checkpoint --goal-id G005 --status complete \
  --evidence "G005 회의+예약 완료. 계약 8 + 레드팀 18, 전체 회귀 0 fail. CANCELLED join 가드·open-ended 충돌 처리. architect 세 레인 CLEAR." \
  --quality-gate-json backend/artifacts/g005-quality-gate.json
```

## 4. 남은 스토리 G006~G011 (체크포인트 후 순차)

각 스토리 계약 테스트 클래스 위치(`backend/tests/contract/test_management_api_stubs.py`):
- **G006 회의록**: `TestMeetingMinuteAPI` (5) — `meeting_minute.stt_draft/ai_summary` 필드 + status(draft→published/finalized) 상태머신. STT 실파이프라인은 환경차단(G011). ⚠️ 모델 `MeetingMinuteStatus`는 현재 DRAFT/FINALIZED만 — stt_draft/ai_summary/published 필드가 04/코드에 없으면 **모델 컬럼 추가 필요**(gap C5).
- **G007 업무기록**: `TestWorkLogAPI` (6) — work_log CRUD(goal/result_url/next_action), daily_status.
- **G008 KPI**: `TestKPIResultAPI` (12) — kpi_result 조회(롱포맷 period_type/period_key), ai_draft, 관리자 조정, **이의신청 상태머신(none→submitted→reviewing→resolved, D15)**, final_score, 결정론적 점수(D14-e). 가장 큰 스토리.
- **G009 동기화+감사**: `TestSyncAPI`(4) + `TestAuditLogAPI`(3) — ERP 동기화 상태/트리거, 실패 알림, audit_log 조회.
- **G010 보안+스케줄러**: 계약 스텁 없음 → 전용 테스트. 로그인 rate-limit + **계정잠금**(G001에서 `auth_credential.failed_attempts/locked_until` 컬럼만 준비됨, 여기서 로직 구현). APScheduler 배치(daily_reports 18:00 KST, KPI 초안 21:00, ERP 증분 매시간+00:00 대사, 멱등 upsert+advisory lock, D17). Caddy/배포문서 정합.
- **G011 환경차단 등록**: `docs/planning/loop/blocked-work-registry.md` 작성 — Godot 3D 클라(Phase1), 실시간 서버+클라 WSS(Phase4), LiveKit+STT 런타임(Phase5), 스파이크 S1~S4, ERP 라이브 DB(OQ10), 도메인(R-d)를 실행 불가 사유와 함께 human_blocked로 기록. 문서화가 산출물.

`TestIntegrationAPIFlow`(1, 전체 워크플로우 login→meeting→minute→kpi)는 G008 이후 크로스컷 검증으로 활성화 검토.

## 5. 환경 & 규약 (필수 숙지)

**venv/pytest** (Windows Git Bash, 공백·유니코드 경로):
```sh
PY="$(pwd)/backend/.venv/Scripts/python.exe"   # 상대경로 exe 직접실행은 이 환경서 실패 → 절대경로 변수 필수
cd backend && "$PY" -m pytest -q -p no:cacheprovider
```
- venv 위치: `backend/.venv/` (fastapi/pytest/jsonschema 등 설치 완료). 재부팅 후에도 유지됨.
- **jsonschema>=4.21**를 `requirements.txt`에 추가·설치함(D12 스키마 검증 활성).

**라우터 경로 규약**:
- 계약테스트 엔드포인트(auth/seats/layouts/meetings + G006~)는 **root prefix 없음**(`/auth`, `/seats`, ...). 각 라우터 모듈 docstring에 이탈 근거 명시(외부공개 시 Caddy `/api/*`→`/*`, D21-r).
- `erp.py`(직원/팀/조직도)만 `/api` prefix(ERP 파생 리소스). 신규 라우터는 계약테스트 경로를 따름.

**완료 게이트 프로세스**(스토리마다 반복):
구현(inline 또는 executor 위임) → 실제 pytest → executor 레드팀(별도 `backend/tests/redteam/test_*_redteam.py`) → architect 3-레인 리뷰 → WATCH/발견사항 수정 → 재리뷰 CLEAR·APPROVE → 품질게이트 JSON(`backend/artifacts/g00N-quality-gate.json`) → `gjc ultragoal checkpoint --goal-id GN --status complete --quality-gate-json ...`.
- 큰 스토리(3+파일/200+줄)는 executor에 위임, 리더가 검증·게이트 소유.
- 계약 스텁이 모델과 불일치하면 rigorous 재작성(스텁 값 → 실제 모델 필드/UUID).

**이번 세션에서 추가한 스키마 변경**(모델 확장은 필요 시 정당):
- `auth_credential` 테이블 신설(G001, 로컬 크리덴셜). 테이블 수 20→21. `test_migrations.py`(==22), `test_foundation.py`(==21), `0001_initial_schema.py` docstring 정합됨.
- `Meeting.scheduled_end` 컬럼 신설(G005, 예약충돌 [start,end) 구간). 테이블 수 불변.
- 마이그레이션 규약: `0001_initial_schema.py`가 `Base.metadata.create_all`(pre-prod, 모델 자동 반영). 운영 첫 배포 후엔 신규 리비전.

**이번 세션에서 고친 실제 버그**:
- `/auth/refresh` 토큰 타입 미검증 → `type=refresh` 강제(G001).
- `office_layout_validator._CollisionGrid.cell`(float 속성)이 동명 메서드를 섀도잉 → 스폰포인트 있는 레이아웃 배포검증 크래시. `coord_to_cell`로 개명(G004). 회귀테스트 `backend/tests/services/test_office_layout_validator.py`.

## 6. 재개 방법

**옵션 A — 같은 세션 계속(재부팅 없이 대화 이어갈 때)**: "계속해"라고 지시 → G005 WATCH 수정부터 이어감.

**옵션 B — 재부팅 후 새 세션**:
1. 이 저장소에서 새 GJC 세션 시작.
2. 이 문서(`docs/planning/loop/ultragoal-handoff.md`)와 `docs/planning/loop/_ultragoal-brief.md`를 읽게 한 뒤 "이 handoff대로 ultragoal 이어서 진행" 지시.
3. 기존 durable 상태는 이전 세션 id(`019f229e-...`)에 묶여 있음. 새 세션에서 그 상태를 계승하려면:
   - `gjc ultragoal status` 로 현재 세션 상태 확인(새 세션이면 missing).
   - 계승이 안 되면, 이 handoff의 "완료 4 + G005 진행" 사실을 근거로 **G005부터 재구성**(코드는 이미 디스크에 있으므로, 새 ultragoal 브리프를 G005~G011로 좁혀 재생성 후 진행하는 것이 가장 단순).
4. 어떤 경우든 **코드/테스트/아티팩트는 디스크에 보존**되어 유실 없음. 전체 회귀 `cd backend && "$PY" -m pytest -q`로 133 passed 확인 후 이어가면 됨.

## 7. 산출물 인벤토리 (디스크)

- 라우터: `backend/app/api/{auth,layouts,seats,meetings}.py`, RBAC 강화 `erp.py`
- 모델: `auth_credential`·`Meeting.scheduled_end` (`backend/app/models/tables.py`)
- 보안/설정: `backend/app/core/{security,deps}.py`, `config.py`(prod 시크릿 가드), `main.py`(라우터 등록)
- 테스트: `backend/tests/{test_directory_api.py, redteam/*, services/*}`, `conftest.py`(test_user 픽스처·blanket-skip 제거), `contract/test_management_api_stubs.py`(auth/directory/seats/layouts/meetings 활성화)
- 게이트 증거: `backend/artifacts/g001~g005-*.{xml,json}`
- 의존성: `backend/requirements.txt`(+jsonschema)
