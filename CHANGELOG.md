# Changelog

> 모든 주요 변경사항이 이 파일에 기록됩니다.

---

## [Unreleased]

## [v1.22.0] - 2026-06-22

### maieutics — 도메인 영혼 자율 심층 인터뷰 → 기획서 (신규 스킬)

> socrates의 목적(인터뷰로 완전한 기획서 산출)을 사람이 인터뷰에 직접 개입하지 않고 달성하는 human-out-of-loop 루프. 두 cmux 페인이 `cmux send`로 실시간 대화 — 소크라테스 페인이 도메인 '영혼' 페인에게 질문을 쏘고, 영혼이 그 도메인 사용자로서 답한다.

- **자율 인터뷰 루프** — 소크라테스↔영혼 두 페인이 `cmux send`로 직접 문답을 주고받아 사람 개입 없이 기획 인터뷰를 완주. socrates의 대화형 기획을 무인화.
- **산출물** — 인터뷰 트랜스크립트 + seed + 전체 인터뷰 기록에서 PRD/TRD 기획서 도출.
- **58종 스킬 / 19개 에이전트** (maieutics 추가)

## [v1.21.0] - 2026-06-12

### cmux-harness — 양방향 통신 부트스트랩 (워커→Main 역방향 cmux send push 의무화)

> 작가님 지시 — 페인 최초 통신 시 역방향 `cmux send` push 방법을 반드시 전달. 자율 루프에서 워커가 Main에 보고할 경로가 없으면 완료·질의·블로킹 신호가 유실된다.

- **부트스트랩 규약** — Main이 각 페인을 기동·첫 dispatch할 때 워커→Main 역방향 `cmux send` 명령 사용법을 brief에 포함 의무화. 워커가 완료·질의·블로킹을 Main 페인으로 직접 push.
- **완료 프로토콜 4단계** — `cmux-protocol.md`에 부트스트랩 섹션 + 완료 신호 4단계 정립. task-brief 템플릿 2종·verification-checklist·task-briefing §9에 역방향 통신 슬롯 배선. SKILL.md Phase 2 갱신.

### 루프 파이프라인 — ADR 패턴·BDD형 게이트·게이트 훅화·포카요케 흡수 (Cichra "BDD, ADR, PRD" 분석 반영)

> 외부 영상(Michal Cichra, "BDD, ADR, PRD, WTF" — youtube-insight-miner 분석) 17개 claim을 루프 파이프라인과 대조, 실질 갭 2개 + 보강 2개를 전부 반영. 핵심 테제(루프 하나+스킬 렌즈 / 진실의 원천을 컨텍스트 밖에 / 이중 그물)는 기존 설계와 일치 확인 — 외부 검증 근거 확보.

- **Decision Gate (ADR "왜+강제" 쌍)** — gate-derivation LOOP 9에 2b(Decision Extraction: TRD·Convention에서 핵심 아키텍처 결정 DEC-NNN 추출, 3~7개) + 4b(Decision Gate Generation: **왜/강제 수단/위반 시 포인터** 3요소 쌍) 신설. derived-gates 템플릿에 Decision Gate Map 섹션. "문서는 텍스트일 뿐 — 도구가 막아서고 에러가 문서를 가리키면 에이전트가 읽고 자가 수정"(에러→문서→수정 고리).
- **에러→문서 포인터 의무화** — planning-loop rework-request 표에 "근거 문서(먼저 읽어라)" 열 + cmux rework brief에 게이트 문서 경로 필수. Tier C 워커가 증상이 아니라 '왜'를 읽고 고치게 함.
- **G/W/T(BDD형) 수락 기준** — gate-derivation Hard Gate·tasks-generator acceptance_criteria·cmux 체크리스트 전부 Given/When/Then 형식 권장으로 정렬. "마크다운 스펙은 준수 여부를 검증할 수 없다" → PRD 여정→acceptance→게이트→검증 명령이 한 줄 추적, 체크리스트 변환이 기계적.
- **게이트 훅화 (hooks=CI 3중 그물)** — gate-derivation에 `hookable:` 마킹(명령 1줄 기계 검증 게이트) → auto-orchestrate가 첫 Phase 전 대상 프로젝트 pre-commit 훅으로 설치. 에이전트 skip→훅, 훅 우회→품질체인·독립 verifier. "에이전트는 게으르다" 전제 이중 실행.
- **탐지보다 예방 (포카요케)** — gate-derivation §7 신설: 같은 게이트 2회 연속 fail 시 검증 추가 대신 **Prevention Gate(구조적 차단)** 승격("찾을 수 없는 것은 강제할 수 없다"). derived-gates 템플릿 Prevention Gates 표 + rework-request 승격 검토 체크 + implementation-supervision LOOP 13 + cmux task-briefing §3.3 배선.
- **헌법 소비 체인 검증 + 빈틈 수정** — 검증 결과: 00-loop.md(헌법 전문)는 auto-orchestrate·verification-before-completion·stargate가 소비하나 **cmux-harness는 세부 게이트만 연결되고 헌법 미소비**. cmux build 진입 시 00-loop.md read → 완료의 정의를 dispatch 규약으로 삼는 배선 추가. loop-charter 템플릿 §5 게이트 소비 규약에 cmux·훅화·Prevention 갱신.

### cmux-harness — 능력 인지형 작업 지시(Task Brief) + 기능 검증 체크리스트 프로토콜 (자율 모드 신뢰 경계)

> 작가님 보고 — "Kimi는 메인보다 지능이 떨어지므로 아주 구체적으로 작업지시를 해야 한다. 테스트 단계에서 실제 기능 검증도 체크리스트를 만들어 지시하는지 검토하라. 사람이 거의 개입하지 않는 자율 프로세스이므로 아주 신경써서 구현해야 한다." 검토 결과: 기존엔 brief에 '무엇을 어떤 구체성으로 쓸지' 규약이 없었고(→ Kimi가 설계 결정을 임의로 함), 검증은 마커(TEST_PASS)만 정의돼 '무엇을 검증할지' 체크리스트 프로토콜이 부재(→ 워커가 대충 테스트하고 PASS 선언 가능 — 자율 모드 최대 구멍).

- **`references/task-briefing.md` 신설 (SSOT)** — 두 철칙: ① Main이 설계하고 워커는 실행한다(설계 결정 위임 금지) ② 검증은 체크리스트+신선한 증거로만(빌더 "됐다" 보고는 검증 아님). **능력 티어**: Kimi=Tier C(전수 명세 — 파일 경로·시그니처·요청/응답 실값 JSON·DB DDL·에러 경로·의사코드 순서까지. "워커가 물어볼 거리가 남으면 명세 미달" 리트머스) / Sonnet=Tier B(계약 고정+토큰 내 자유) / Codex·Reviewer=Tier A(목표+체크리스트, 증거 강제).
- **Build Brief 9섹션 의무화** — 목표/컨텍스트/산출물/인터페이스 계약/구현 단계/금지 사항/수락 기준/자가 점검/완료 프로토콜. 템플릿 신설: `templates/task-brief-backend.md`(Kimi — 실값 curl 예시·DDL·에러 경로 표 슬롯) / `templates/task-brief-frontend.md`(Sonnet — 4상태 의무·디자인 토큰 고정).
- **기능 검증 체크리스트 프로토콜** — Main이 brief 작성과 동시에 수락 기준→`.cmux-harness/checklists/<id>.md` 파생(항목별 복붙 가능 명령+기대 결과, happy+에러+엣지 전부, `08-derived-gates.md` REQ 게이트 연결). Codex 검증 dispatch에 체크리스트 경로 필수 포함 → 항목별 직접 실행 + 실제 출력 인용을 `.cmux-harness/verify/<id>.md`에 기록 → 전 항목 PASS만 TEST_PASS. **verify 리포트 없는 TEST_PASS는 무효**(증거 없으면 fail — planning-loop LOOP 12 동일 원칙). 템플릿: `templates/verification-checklist.md`.
- **QA 피드백 루프 체크리스트 기반 재작성** — TEST_FAIL 시 실패 항목 ID+증거만 추린 rework brief(`tasks/<id>-rework-N.md`) → 빌더 재dispatch → 재검증(실패 항목+회귀 스모크 1~2개) ≤3라운드, 초과 시만 인간 개입(자율 루프 유일 에스컬레이션).
- **역할 스왑 잔재 5곳 수정** — SKILL.md ABSOLUTE 표(테스트 dispatch Kimi→Codex)·디스패치 알고리즘 slim fallback(Kimi→Codex)·QA 루프 본문(Kimi E2E→Codex)·Dispatch 체크리스트(slim E2E Sonnet→Codex 다운그레이드)·cmux-protocol 브라우저 제어 주체·context-management 예시 행. 2026-06-10 스왑 커밋이 매핑 표만 갱신하고 본문 산문을 놓친 것.
- SKILL.md Phase 4 배선: Main 직접 수행 목록(9단계)·디스패치 알고리즘(brief 티어+체크리스트 파생+검증 단계)·Dispatch 체크리스트(+4항목)·아티팩트 테이블·참고 파일.

### cmux-harness — 페인 상태 감시 + 예외 처리 계층 (타이밍 에러·번호 프롬프트·CLI 업데이트·페인 죽음)

> 작가님 보고 — "메인은 다른 페인 상태를 면밀히 확인해야 한다. 업데이트되면 다시 실행, 사용자에게 번호 누르게 하는 경우, 타이밍 안 맞아 에러 나는 경우를 항상 감시·처리해야 한다. 예외 처리 강화하고 대기하다 다시 처리하는 기능을 보완해줘." 기존엔 `wait-for-ready`가 프롬프트 박스(`╭─╮`)만 보고 "작업 중에도 ready"로 오탐 → 그 상태에 명령을 보내 타이밍 에러가 났고, 번호 프롬프트·업데이트·페인 죽음은 전혀 감지 못 해 무한 타임아웃에 빠졌다.

- **`scripts/pane-state.sh` 신설 (1차 프리미티브)** — 화면 1회 캡처 → 단일 상태 토큰(`READY`/`BUSY`/`PROMPT[:sub]`/`UPDATE`/`ERROR`/`STARTING`). READY는 박스가 있고 **BUSY/PROMPT/UPDATE 신호가 전부 없을 때만** 성립(false-ready 차단). PROMPT 서브타입 9종(TRUST/THEME/CONTINUE/TELEMETRY/YESNO/LOGIN/PERMISSION/UPDATE/MENU). 분류 휴리스틱 14케이스 단위 테스트 통과.
- **`scripts/pane-watch.sh` 신설 (감시·자동해소)** — `resolve`(차단 상태 자동 해소 / 자동 불가 시 에스컬레이션) · `poll --all`(전체 페인 상태 스냅샷 = Main 상시 감시 스윕) · `answer`(사용자가 고른 번호/응답 전달). 보수적 정책: 기동/UX 프롬프트(trust·theme·telemetry·continue·update)만 자동 응답, **위험·미상(번호 메뉴·yes/no·권한·로그인)은 사용자 에스컬레이션** — 무분별한 자동 "yes" 금지. `.cmux-harness/prompt-policy.json`로 오버라이드.
- **`pane-send.sh` 상태 인지형 전면 보강** — (1) 전송 전 `pane-watch resolve`로 차단 프롬프트/업데이트 해소 + 진짜 READY 확보 (2) echo-back 실패 시 줄 비우고 재전송(최대 2회) (3) 폴링 중 매 주기 상태 분류 → PROMPT/UPDATE 자동 해소·에스컬레이션, ERROR 즉시 중단, **타이밍 미스(작업 시작 흔적 없이 idle 지속) 1회 재전송**, BUSY 후 idle은 완료 처리(중복 실행 방지). 종료 코드 규약: `10` 사용자입력 필요 / `11` 업데이트 후 재시작 / `12` 페인 죽음.
- **CLI 업데이트 처리** — "업데이트되면 다시 실행"을 자동화: 업데이트 확인 승인 → 완료·재시작 대기(셸로 떨어지면 `spawn-panes --only` 재기동) → **원 명령 1회 재전송**(작업 유실 복구).
- **`wait-for-ready.sh` 상태 기반 재작성** — 단순 박스 정규식 폐기 → `pane-state` 위임 + 기동 시 흔한 대화형 프롬프트 자동 해소, ERROR fast-fail.
- **SKILL.md Phase 2.5 신설** — "Main은 명령만 던지고 끝내지 않는다. 보낸 뒤에도 면밀히 감시·처리한다"(ABSOLUTE). 4 예외 처리 표 + 3-스크립트 계층 + 종료코드 분기. Dispatch 알고리즘·체크리스트·안전장치·아티팩트·참고 파일에 배선. 신규 서브명령 `/cmux-harness watch`.
- 신규 SSOT 문서: `references/pane-supervision.md`(상태머신·프롬프트 정책·업데이트·대기-재시도·종료코드). cmux-protocol.md 포인터 추가.

### planning-loop-supervisor — 구현 감독 외부 루프 (LOOP 11~13): end-to-end 감독관으로 확장

> 작가님 지적 — "루프는 기획부터 구현 검증까지 관장하는 감독관인데, 지금은 설계 검증에 그치고 실제 구현 파이프라인에 관여 안 한다". 맞는 진단. planning-loop-supervisor가 설계 검증·게이트 파생(LOOP 0~10)에서 멈추던 것을, **구현 위임 → 독립 검증 → 승인/재작업(≤3라운드)** 외부 루프까지 확장.

- **LOOP 11 Delegate Build** — 환경 감지 후 빌더(cmux-harness 무인자 / auto-orchestrate / harness)에 구현 위임. 빌더는 자기 inner loop(per-Phase TDD) 수행.
- **LOOP 12 Independent Verification** — 빌더가 **아닌** 별도 verifier(`Agent` test-specialist 등)가 `08-derived-gates.md`를 신선한 증거로 검증(증거 없으면 fail). 빌더 자기보고 신뢰 금지 = 구현자/검증자 분리. 산출 `build-verification-report.md`.
- **LOOP 13 Approve / Rework** — 전부 pass→승인 / 미달→`rework-request-NN.md`로 빌더 되돌림(실패 범위만), 최대 3라운드. 초과 시 잔존 실패 리스크 명시·완료 선언 금지. 라운드마다 AskUserQuestion + 이해 부채 게이트.
- **inner vs outer 경계 명문화**: auto-orchestrate Gate Consumption = inner(자기 게이트 자기 확인), planning-loop = outer(독립 재검증·승인/재작업). 중복 아니라 layer.
- 신규: `references/implementation-supervision.md` + `templates/rework-request.md` + `templates/build-verification-report.md`. loop-state.json에 `build`(round·gate_results·verdict) 추가. SKILL.md 역할 표·description·다음 단계 재작성(end-to-end 감독관). stargate Phase 3.7·auto-orchestrate 경계 노트. .agents 미러.

### fix: agent-context-injector — updatedInput에 원본 필드 보존 (훅 활성화 회귀)

> 서브에이전트(Agent/Task) 호출 시 `PreToolUse hook for Agent returned updatedInput that failed schema validation: required parameter 'description' is missing` 오류 수정.

- **원인**: `agent-context-injector.js`가 프롬프트에 컨텍스트를 주입하며 `outputUpdatedInput({ prompt })`로 **prompt 필드만** 반환 → Claude Code가 updatedInput을 입력 전체로 대체하면서 Agent 필수 필드 `description`·`subagent_type`이 소실. 직전 "훅 절대경로 require" 수정으로 훅이 비로소 실제 실행되며 잠복 버그가 표면화.
- **수정**: `outputUpdatedInput({ ...toolInput, prompt: updatedPrompt })` — 원본 입력 전체 보존 + prompt만 덮어씀. 재발 방지 주석 추가. 프로젝트 + 글로벌(`~/.claude/hooks/`) 동기화.
- `outputUpdatedInput` 사용 훅은 이 하나뿐 — 동일 패턴 타 훅 없음 확인.

### cmux-harness 페인 역할 스왑 + build 페인 자동 선행 + 루프 빌드 디스패치 보강

- **역할 스왑 (Codex ↔ Kimi)** — 작가님 지시. **Kimi = 백엔드 구현(+DB 겸임)** / **Codex = 검증·테스트·E2E**(full에선 Browser 제어). Sonnet(FE)·Reviewer(Opus 상위 리뷰)·Main(Opus 오케스트레이터)은 그대로. **페인 이름·CLI는 불변**(Codex 페인=codex, Kimi 페인=kimi) — 라우팅되는 역할만 교체. 구현자(Kimi·Sonnet)/검증자(Codex·Reviewer) 모델·세션 분리 유지. SSOT = `references/role-routing.md`. 동기화 파일: role-routing.md·pane-layout.md·context-management.md·SKILL.md(모델표·Phase4 매핑·setup 페인표)·spawn-panes.sh(주석)·tasks-generator(SKILL.md·tasks-rules.md §9)·pipeline-map(skills.html·case-4-build.html).
- **`/cmux-harness build` 페인 부재 → setup 자동 선행 (ABSOLUTE)** — `/tasks-generator → build` 직행 등에서 setup 누락 시 페인 부재로 dispatch 실패하던 빈틈 차단. build 시작 전 위성 페인(Kimi/Sonnet/Codex/Reviewer) 존재 확인 → 없으면 setup 선행 후 build.
- **planning-loop-supervisor 다음 단계 cmux 분기 명시** — 빌드 진행 시 `$CMUX_WORKSPACE_ID` 감지 → 무인자 `/cmux-harness`(setup→build 자동)로, 아니면 auto-orchestrate/harness로. `/cmux-harness build` 직행 금지 안내.

### Loop Discipline — 루프 3대 실패 모드 방어 (「네 겹의 엔지니어링」 5장 근거)

> 「네 겹의 엔지니어링」(Toby-AI, 2026) 5장 Loop Engineering / Addy Osmani 「Loop Engineering」(2026)을 근거로 스킬팩 보강. 책이 정리한 자율 루프의 3대 실패 모드(검증 공백·이해 부채·인지적 항복) 중, 기존에 커버 안 되던 **이해 부채(comprehension debt)** 방어를 신규 추가. (검증 공백=규칙3, 인지적 항복=규칙4로 이미 커버 → 중복 회피)

- **CLAUDE.md §13 규칙 6 신설 (Loop Discipline)** — 자율 루프/자동 생성 스킬은 ① Workflow vs Agent 선판단(루프 남용 방지) ② 종료 조건 ③ **이해 부채 방어**(자동 생성 산출물을 사용자가 이해 못 한 채 다음 단계로 넘기지 않음 — Phase 완료 시 변경 요약 + 재진술/확인 지점, 완전 자동 모드는 "안 본 변경" 가시화)를 지킨다. 적용 체크리스트에 4항목 추가.
- **`/auto-orchestrate`** — Phase 병합 직전 "이해 부채 체크포인트"(변경 파일 수·핵심 결정 1~2줄·주의 지점) + 완전 자동 모드 종료 시 미검토 변경 누적 요약.
- **`/planning-loop-supervisor`** — final-planning-approval에 "이해 게이트"(게이트 통과 ≠ 이해, 사용자가 핵심 결정 재진술 가능해야 빌드 권장).
- **`/harness`** — Build-Eval 라운드 종료 시 변경 요약 + 핵심 결정 1줄(규칙 6 참조).

## [v1.20.1] - 2026-06-10

> planning-loop-supervisor 현장 제보 반영 패치. 신규 스킬 없이 기존 스킬 보강 + 버그 수정 (비표준 프로젝트 대응 + tasks.md 직후 선택 옵션화).

### planning-loop-supervisor를 tasks.md 직후 선택 옵션으로 (강제 게이트 → 권장 옵션)

- **stargate Phase 3 종료 분기** 4종으로: 검증 게이트 실행(권장) / 디자인 연결 / 바로 빌드(게이트 건너뛰기) / 멈춤. "바로 빌드" 경로 추가로 강제성 제거. Phase 3.7은 "검증 게이트 실행" 선택 시에만 실행.
- **`/tasks-generator` 다음 단계 메뉴**(cmux/일반 양쪽)에 `/planning-loop-supervisor 검증 (권장)` 옵션 + Skill 디스패치 매핑 추가. stargate 밖 단독 경로에서도 tasks.md 직후 선택 가능.

### planning-loop-supervisor v1.1 — 비표준·기존 프로젝트 대응 (현장 제보 반영)

> 현장 제보 2건 수정. ① 기존(브라운필드) 프로젝트에 `docs/planning/01-prd~06-tasks` 표준 구조가 없으면 LOOP 0이 "전부 missing"만 보고하고 중단 → AI가 스킬의 "정신만 적용"하고 추적 파일(loop/)을 생략하는 빈틈. ② 외부에서 만든 임의 위치 `tasks.md`를 줘도 표준 경로가 아니라 연결 안 됨.

- **동작 모드 3종 신설** — LOOP 0에서 자동 판별, "missing만 보고하고 중단" 금지:
  - **Standard**: 표준 문서 ≥2 → 기존 LOOP 0~10 그대로.
  - **Adaptive**: 표준 구조 없음 → 문서 자동 탐색(docs/**·루트 *.md·specs/**·README + **ARGUMENTS 경로 최우선**) → 파일명·헤딩 키워드로 역할 추정 → AskUserQuestion 매핑 확정 → **ad-hoc document map**(`loop-state.json.document_map`)으로 루프 수행. missing 역할은 스킵+명시.
  - **Gate-Only**: 설계문서 사실상 0 + 구체 작업 지시(ARGUMENTS) 있음 → LOOP 9만 단독 실행, 작업 지시에서 REQ 추출 → 게이트 파생.
- **ARGUMENTS 처리 명문화** — 파일 경로 포함 시 표준 경로 아니어도 소스로 직접 채택(외부 tasks.md 연결 문제 해결). 구체 작업 지시는 요구사항 소스로.
- **🚨 추적 파일 항상 생성 (ABSOLUTE)** — 어떤 모드든(blocked 포함) `docs/planning/loop/loop-state.json`(+ 08-derived-gates·00-loop·리포트)을 반드시 생성. "스킬의 정신만 적용하고 형식 파일 생략" 금지 — 제보의 핵심 빈틈 봉인.
- loop-state.json 스키마에 `mode`/`document_map`/`missing_roles` 추가. frontmatter description에 브라운필드·Gate-Only 트리거 추가.
- 수정 파일: SKILL.md(동작 모드 섹션) / references/loop-protocol.md(LOOP 0 모드 판별) / planning-document-map.md(Ad-hoc 매핑) / gate-derivation.md(Gate-Only 단독 실행) / .agents 미러.

## [v1.20.0] - 2026-06-09

> 설계 검증 상위 루프(planning-loop-supervisor) + 설계문서 자동 HTML 렌더 + dynamic workflows 빌트인 도구 심화 + 전 훅 회귀 수정. 신규 스킬 1종(planning-loop-supervisor) → 57종.

### docs HTML 자동 렌더 — md 설계 문서를 깔끔한 구조적 HTML로 (훅 + socrates/doubt 리포트)

> 사용자가 docs/ 의 md 설계 문서를 직접 읽기 불편한 문제 해결. md를 작성할 때마다 훅이 자동으로 보기 좋은 HTML을 생성하고, 기획(소크라테스/데카르트)이 끝나면 결과를 단일 구조적 리포트로 묶어 file:// 링크를 제공한다.

- **`lib/md-to-html.js` 신규** — 의존성 0 순수 Node Markdown→HTML 변환기. 사이드바 TOC·테이블·코드·체크박스·**mermaid 다이어그램**(CDN, graceful fallback)·다크/라이트 자동. 4모드: 단일 / `--dir`(일괄+index) / `--bundle`(여러 md→1리포트) / `--index`. 코드스팬은 런타임 null 센티넬로 보호(본문 숫자와 충돌 0, 소스는 순수 ASCII).
- **`docs-html-renderer.js` 신규 훅 (PostToolUse[Write|Edit])** — `docs/**/*.md` 작성/수정 시 `docs/_html/` 미러로 조용히 HTML 생성 + index.html 갱신. 비차단(항상 exit 0), `_html`/`node_modules`/`.claude`/`.agents` 제외. settings.json PostToolUse에 node→bash→exit0 폴백 패턴으로 등록(CLAUDE.md §12 준수).
- **socrates / doubt 종료 스텝** — 기획 문서 생성 직후 `--bundle`로 통합 리포트(`docs/_html/planning-report.html`) + `--dir`로 인덱스 발행 후 **사용자에게 file:// 링크 출력** (다음 단계 AskUserQuestion 이전). 변환기 없으면 조용히 스킵.
- **`.gitignore`에 `docs/_html/` 추가** — 자동 생성 HTML은 재생성 가능하므로 git 비추적(노이즈 방지). 훅은 로컬에서 항상 최신 생성.
- **🔧 기존 11개 훅 일괄 수정 (회귀 버그)** — 모든 훅이 쓰던 `node -e "...process.chdir(h);require('./x.js')..."` 1차 패턴이 Node 18+에서 **MODULE_NOT_FOUND**(chdir이 `-e` require 해석을 안 바꿈) + `catch{exit 0}`가 에러를 삼켜 bash 폴백도 안 돌아 **훅이 조용히 no-op**였음. 전 훅(SessionStart/UserPromptSubmit/PreToolUse×3/PostToolUse×3/PostToolUseFailure/Stop)을 **절대경로 require**(`require(path.join(os.homedir(),'.claude','hooks','x.js'))`)로 교체 — 프로젝트 + 글로벌 settings.json. CLAUDE.md §12 규칙2 갱신.
- 패키징 시 `.claude/hooks/`(변환기+훅) 동기화 + settings.json hook 등록 확인.

### planning-loop-supervisor — 설계문서 상위 루프 감독관 + Project-Specific Gate Derivation (신규 스킬)

> 기존 기획 스킬 인벤토리(socrates/doubt가 번들 생성하는 PRD·TRD·User Flow·DB·Design System·Screens·Coding Convention + screen-spec 명세 + tasks-generator Tasks) 위에 **상위 루프 계층**을 추가. 개별 스킬은 문서를 만들고, 이 감독관은 문서들이 함께 "개발 가능한 하나의 제품 설계"로 수렴했는지 검증·수렴시킨다. [출처 트윗](https://x.com/0x_rody/status/2063722061126651935).

- **`/planning-loop-supervisor` 신규 스킬** — 생산자가 아니라 **감독관**. LOOP 0~10: Inventory → Collection → Role → Consistency → Gap → Quality(13항목 루브릭, 핵심 7항목 ≥4 + 하드페일 8조건) → Routing → **반자동 Patch**(revision-request → AskUserQuestion → 해당 스킬 patch 모드 호출) → Re-eval(≤3회) → **Gate Derivation** → Final Approval. references 8개 + templates 6개.
- **Project-Specific Gate Derivation (LOOP 9)** — 검토에서 멈추지 않고 설계 산출물에서 요구사항(REQ-NNN)을 추출 → 추적성 매핑 → REQ별 **Hard/Metric/Rubric/Domain/Evidence** 게이트 생성 → 게이트 자체 품질 검증 → `docs/planning/loop/08-derived-gates.md` + `00-loop.md` 발행.
- **Integration Rule (완료 정의 변경)** — 다운스트림 빌드/품질 루프는 `00-loop.md` + `08-derived-gates.md`를 함께 완료 기준으로 삼는다. **08-derived-gates의 Hard/Metric/Domain 게이트를 증거와 함께 통과하기 전까지 "구현 완료" 선언 불가.** `/auto-orchestrate` 품질 체인(5단계)과 `/verification-before-completion`에 "Gate Consumption" 규약 배선.
- **stargate Phase 3.7 정식 통합** — specs/tasks 완료 후 build 진입 전 양 라인(socrates/doubt) 공통 게이트로 자동 호출. state.json `current_phase`에 `"3.7"` + `artifacts.planning_loop`/`derived_gates` 추가. Phase 3 종료 분기·Phase 4 진입 경유 갱신.
- **핵심 4개 producer 스킬 Loop Compatibility** — socrates·doubt·screen-spec·tasks-generator에 patch 모드 규약 추가(전체 재인터뷰 금지, 지목 섹션만 수정, 나머지 보존) + Loop Metadata 블록. **본래 trigger·목적 무손상(추가만).**
- **문서 동기화** — `docs/PIPELINES.md`(Phase 3.7 다이어그램·비교표·설명·흐름), `WORKFLOW.md`(아키텍처 Phase 1.7 + 전용 섹션 4.5 + 워크플로우 계약), `README.md`(스킬 카탈로그 + 명세→빌드 게이트 안내). 패키지 버전 bump는 `/packaging` 시 사용자 확인 후(CLAUDE.md §11).

### dynamic workflows — 빌트인 Workflow 도구 심화 (budget 동적 스케일 + agentType 전문가)

> 기존 7종 워크플로우가 빌트인 `Workflow` 도구 기능의 **절반만** 쓰던 것을 보강. 7종 전체를 도구 규약 기준으로 정적 스캔(결정론 위반 0 / TS 문법 0 / Node API 접근 0)해 정합을 확인한 뒤, **신규 파일 없이** 5종에 `budget` 동적 스케일 + `agentType` 커스텀 에이전트를 역적용. 토큰 타깃(`+500k` 등)이 없으면 전부 기존(v1.19) 동작과 100% 동일하게 폴백.

- **`code-review`** — finding 당 적대적 verifier 를 budget 에 따라 **1→최대 3명**으로 스케일(서로 다른 반박 각도 → perspective-diverse 다수결로 false positive 제거 강화). 품질 차원 finder 를 **도메인 전문가**로 기동(security→`security-specialist`, performance→`database-specialist`, tests→`test-specialist`, architecture→`backend-specialist`). **I-2 교훈 보존**: 검증 실패(전원 크래시) ≠ 적대적 반박, critical/important 는 1표라도 isReal 이면 확정(누락 > FP), minor 만 다수결로 적극 컷
- **`council`** — 리뷰어 풀을 budget 에 따라 기본 3인(CTO/UX/Security) → +Data/Product/Ops 로 확장(perspective-diverse). 도메인무관 페르소나라 agentType 미사용
- **`neurion`** — 발산 렌즈(= 병렬 generator)를 budget 에 따라 기본 5 → +inversion/extreme-user/tech-shift (Osborn "양 중심" 정합)
- **`eureka`** — 토너먼트 진출 후보를 budget 으로 제어(기본 4후보=6매치 → 최대 6후보=15매치). pairwise O(n²) 폭발을 cap 으로 통제, "3-4 제안" 철학 유지
- **`auto-orchestrate`** — 06-tasks.md `담당`(Specialist)을 `agentType` 으로 받아 구현을 도메인 전문가 worktree 로 기동. `reviewerType`(구현자와 다른 전문가) 분리 시 self-preferential bias 추가 차단
- **`harness`·`cost-router` 의도적 미적용** — harness verify 는 실제 dev server 클릭테스트라 N명 동시 접속 시 **상태 간섭 위험**(파일 주석 경고) → budget 투표 부적합. cost-router 는 classifier 수가 입력 태스크 수에 고정 → budget·agentType 둘 다 무의미. over-engineering 회피
- **정합성**: 7종 전체 async-wrap 문법 통과 · 결정론 위반 0(다양성은 Math.random 대신 인덱스 변주) · budget 글로벌 방어 헬퍼(미정의 시 `{total:null}` 폴백) · 사용 agentType 4종 `.claude/agents/` 실재 확인. 각 SKILL.md workflow 모드 섹션에 budget/agentType 안내 동기화. **실제 Workflow 실행 검증은 미실시**(1·2차와 동일 한계 — 비용)

### dynamic workflows 2차 확산 — 미적용 3패턴 + quarantine (0xCodez 정리판 흡수)

> [0xCodez, "How to master Dynamic Workflows in Claude Code: 6 patterns and 14 steps"](https://x.com/0xCodez/status/2062127385923776831) — v1.19.0에서 흡수한 Thariq/Sid 원본의 **14단계·6패턴 정리·확장판**. v1.19.0이 이미 적용한 3패턴(fan-out-and-synthesize / adversarial verification / loop-until-done) 외에 **미적용 3패턴 + quarantine 안전장치**를 추가 흡수. 모든 신규 워크플로우는 기존 모드 폴백 보존(구버전 Claude Code 호환).

- **`neurion` workflow 모드 — generate-and-filter** — 신규 `workflows/idea-generate-filter.js`. 렌즈(직접/SCAMPER/인접도메인/와일드카드/제약)별 generator를 독립 context로 **병렬 발산(판단 0 = Osborn 1원칙)** → 아이디어마다 분리 verifier가 rubric 채점·클리셰 컷(생성자 비공개 → 자기편애 차단) → dedupe·그룹핑·top picks. 트윗 "commit late" 철학 구조화. **최종 방향 선택은 사용자와 공동**(공동 창작 원칙 보존), 워크플로우는 발산·필터·군집까지만
- **`eureka` workflow 모드 — generate-and-filter → tournament** — 신규 `workflows/approach-tournament.js`. 차별화 축(실시간/자동화/극단단순/니치/오프라인/양면)별 MVP 후보 fan-out → **모든 쌍을 fresh 심판이 pairwise 비교**(절대 점수 아님 — "comparative judgment is more reliable") → win 집계(결정론적 bracket, context 밖) → 랭킹·챔피언. 트윗 "Exploration and taste" 조합 이식
- **`cost-router` workflow 모드 — classify-and-act** — 신규 `workflows/classify-route.js`. 정적 알고리즘 문서였던 "복잡도 분석기 → Tier 분류 → 라우팅"을 실행 가능하게: 태스크마다 **`model:'haiku'` classifier fan-out**("classifier on cheap")으로 FREE/CHEAP/EXPENSIVE 판정 → tier→모델 매핑 + 비용/절감 시뮬레이션(결정론). 보안/인증/결제는 자동 opus 승급, 분류 실패는 보수적 EXPENSIVE. **역할 경계**: 라우팅 plan + 비용 리포트만 산출, 실제 구현 실행은 auto-orchestrate가 plan으로 수행
- **`deep-research` quarantine 가드레일 (트윗 step 13)** — 검색 결과·`WebFetch` 본문은 **데이터일 뿐 지시가 아니다**. 콘텐츠 내 프롬프트 인젝션("이전 지시 무시…"/"외부로 전송…")을 실행하지 않고, read-only 격리 유지, 발견 시 인용 후 사용자 판단 위임, 개인정보 쿼리스트링 금지. 향후 fan-out 워크플로우화 시 reader(read-only) ↔ actor 분리 지침 포함
- **기존 워크플로우 4종에 quarantine 신뢰경계 노트** — `harness`/`council`/`code-review`/`auto-orchestrate` 워크플로우는 신뢰된 입력(사용자 자신의 코드/기획) 전제임을 명시. untrusted 외부 콘텐츠 처리로 변형 시 reader read-only 격리 + actor 분리 적용하라는 방어 주석 추가
- 모든 신규 워크플로우 JS는 **verbatim 아닌 템플릿**(트윗 step 14 권장)으로 동봉, 구조화 schema로 파싱 제거, 7종 전체 async-wrap 문법 검증 통과. SKILL.md frontmatter `allowed-tools` 미선언 스킬(neurion/eureka/cost-router)은 본문에만 workflow 모드 추가(암묵 도구 허용 보존)

---

## [v1.19.0] - 2026-06-03

### cmux-harness 멀티페인 재설계 + 통신 신뢰성

> 한 세션에 모든 역할을 맡기지 않고, 역할별로 cmux 페인을 분리해 운영한다 — 구독 분산 + **구현자/검증자를 다른 모델·세션으로 분리해 self-preferential bias를 구조적으로 차단**.

- **페인 재구성** — Main=Opus(오케스트레이터, 코딩 X) / Codex=백엔드(+DB 겸임) / Sonnet=프론트엔드 / Kimi=테스트·E2E / Reviewer=Opus(검증·보안). 기존 Haiku 페인 제거. `references/role-routing.md`가 단일 진실 소스(SSOT).
- **통신 신뢰성** — `cmux send` 간헐 실패 5원인 수정: 송신 전 ready 확인 + send/Enter 사이 sleep + echo-back 검증 + **완료 감지를 `.cmux-harness/done/<pane>.done` 파일 1순위로 전환**(화면 마커가 스크롤 위로 밀려 유실되던 무한 타임아웃 해결). `pane-send.sh`/`wait-for-ready.sh`(Kimi 패턴 추가).
- **tasks-generator 페인 라우팅** — 각 태스크에 `담당`(Specialist) 필수 + cmux 환경(`$CMUX_WORKSPACE_ID`) 시 `Pane` 병기. 매핑 변경 시 role-routing만 고치고 재생성.
- 주의: Kimi CLI 권한 플래그·ready 패턴·context limit은 추정값 — 실제 cmux+kimi 환경에서 확인 후 정밀화 필요.

### dynamic workflows — 오케스트레이션 4종 적용 (Thariq/Sid 트윗 흡수)

> [Thariq Shihipar & Sid Bidasaria, "A harness for every task: dynamic workflows in Claude Code"](https://x.com/trq212/status/2061907337154367865) (Anthropic, 2026-06)의 동적 워크플로우 개념을 `harness`·`council`·`code-review`·`auto-orchestrate`에 workflow 0순위 모드로 적용. 기존 모드는 폴백 보존.

- **`harness` 0순위 실행 모드 추가 — workflow 모드** — 기존 분산(clabs 페인)/단일(Agent 순차) 모드 위에, `Workflow` 도구 가용 시 Build-Eval 루프를 동적 워크플로우로 실행. 자동 감지 순서: workflow → 분산 → 단일 (구버전 Claude Code 폴백 보존)
- **신규 템플릿 `workflows/build-eval-loop.js`** — 트윗 3패턴을 harness 루프에 매핑: `loop-until-done`(round 루프) + `adversarial verification`(builder와 분리된 회의적 verifier) + `fan-out-and-synthesize`(rubric 기준마다 verifier 1명 병렬 → synthesize barrier). 구조화 출력 스키마로 파싱 제거
- **self-preferential bias 구조적 제거** — 기존 단일/분산 모드는 Evaluator 1명이 전 기준 채점(자기 결과 편애 위험). workflow 모드는 `one verifier per rule`로 독립 context 병렬화하여 편향 차단. agentic laziness·goal drift도 함께 방어
- **가드레일** — builder agent worktree 격리 금지(dev server 경로 공유 보호), `max_cycles==1` 프로토타입은 단일 모드 폴백(토큰 낭비 방지), 병렬 verifier 상태 격리 주의 명시

#### 확산 1차 — council + code-review (adversarial verification)

- **`council` workflow 모드** — 신규 `workflows/panel-review.js`. 단일세션 모드의 "3 리뷰어 병렬 + 멀티턴 교차검증"을 동적 워크플로우로: Review(fan-out) → Cross-examine(각 리뷰어가 타 리뷰어 지적 반박/방어) → Synthesize(합의/개선/쟁점). 각 리뷰어 독립 context로 self-preferential bias 차단. 감지 순서 workflow→분산→단일
- **`code-review` workflow 모드** — 신규 `workflows/dimension-review.js`. 트윗 본문 canonical `review-changes` 예제 이식: Iron Law(Spec gate)=barrier → 품질 차원(arch/security/perf/tests/quality) fan-out(pipeline) → finding마다 adversarial verifier가 반박 시도 → refute 시 drop. `droppedFalsePositives` 카운트로 "그럴듯하지만 틀린 지적"을 리포트에서 제거. Standard/Deep 깊이에서만(Lite는 기존 2-Stage)
- 세 스킬 모두 구버전 Claude Code 폴백 보존 (기존 분산/단일/2-Stage 모드 유지)

#### 확산 2차 — auto-orchestrate (worktree fan-out + adversarial review)

- **`auto-orchestrate` workflow 모드(`--workflow`)** — 신규 `workflows/phase-group.js`. 트윗 "Migrations and refactors" 절 이식: Phase 내 병렬 그룹의 태스크를 `isolation:'worktree'`로 동시 TDD 구현(자원 집약 명령 자제) → 구현마다 adversarial 리뷰어 → critical 시 approved=false. pipeline(barrier 없음)으로 태스크 A 리뷰 중 태스크 B 계속 구현
- **역할 경계 엄수** — 의존성 분석·main 병합·push는 **메인**, 워크플로우는 **구현+리뷰까지만**(트윗 "orchestrator only merge" + 본 스킬 MUST NOT 준수). 각 구현 agent는 worktree cleanup과 무관하게 레포에 남는 task-branch commitSha 반환 → 메인이 그 sha로 병합
- CLI `--workflow` 옵션 + 참조 라우팅 추가. 기존 Task/cmux/tmux/ultra-thin 모드 폴백 보존
- 적용 범위: `harness`·`council`·`code-review`·`auto-orchestrate` 4종. `deep-research`(공식 /deep-research가 이미 workflow 기반) 확산은 별도 검토

#### 실행 검증 + verifier 자기 발견 수정

> `code-review` workflow를 본 PILOT 커밋(eeec594) 자체 diff에 실제 실행해 동작을 검증. 워크플로우가 자기 자신을 리뷰해 자기 버그(I-2)를 찾아냈다.

- **첫 실행 검증** — 18 agents / 1.45M subagent tokens / 7.8분. fan-out → schema 반환 → adversarial verify → Iron Law gate 전 경로 동작 확인. 13 candidate → 3 confirmed + **10 dropped(false positive)** 로 adversarial verification 효과 실측 입증
- **I-1 수정** — `code-review/SKILL.md` allowed-tools에 `Workflow` 누락(harness frontmatter엔 추가됐으나 code-review 본문 선언엔 빠진 비일관). `Workflow` 추가
- **I-2 수정 (워크플로우 자기 발견 버그)** — `dimension-review.js`에서 verifier 크래시/null이 "적대적 반박당한 false positive"로 **묵음 drop**되던 결함. `verdict` 유무로 verified/unverified 분리, 검증 실패한 critical/important는 보수적 구제(`verificationFailed` 표기) + refuted와 별도 리포트 섹션. 동일 `filter(Boolean)` 패턴이 council/harness/auto-orchestrate에선 null→FAIL/재작업(안전 방향)이라 미적용
- 비용 노트: 9파일 diff에 1.45M 토큰 — 트윗 "often use more tokens" 실례. 소규모 diff는 기존 2-Stage, workflow 모드는 대규모/고위험 변경에 사용 권장(실측 확인)

---

## [v1.18.0] - 2026-05-19

### 풀 파이프라인 진입점 강화 + cmux-harness 호환 패치 + 양대 라인 문서화

> 자산 추가 없이 기존 57개 스킬의 진입점·결정점을 명료화. 사용자가 `/stargate` 하나만 기억하면 끝. 호환 패치(cmux surface ref) + 회귀 차단(Main dispatch ABSOLUTE) + 양대 라인 공식 문서(PIPELINES.md)까지 한 묶음.

### cmux-harness — surface ref 호환 + 모드 분기 + Main dispatch 강제

> 사용자 환경에서 발견된 두 가지 회귀 + 한 가지 개선을 한 번에 처리.

- **🐛 surface ref 호환 패치** — cmux CLI가 `--surface`에 탭 이름을 받지 않고 surface ref(`surface:7` 등)만 받는 문제를 우회. 신규 `scripts/cmux-surface.sh` 헬퍼가 `.cmux-harness/pane-refs.json` 캐시 + `cmux tree` 파싱 폴백으로 변환. spawn 시점에 자동 register. `pane-send.sh` / `wait-for-ready.sh` / `pane-reset.sh` / `pane-spawn-dynamic.sh` / `context-monitor.sh` / `spawn-panes.sh` 6종 모두 ref 해석 경유로 패치
- **🎚 두 가지 모드 분기 — full / slim** — 진입 시 `AskUserQuestion`으로 모드 선택. `full`은 기존 5페인(Main/Codex/Sonnet/Haiku/Browser), `slim`은 Haiku/Browser 생략(Main/Codex/Sonnet). slim 모드에서 E2E role 태스크는 Sonnet으로 fallback(단위 테스트 다운그레이드) 또는 SKIP. 대시보드/웹앱은 `full`, 백엔드/데이터/CLI/라이브러리는 `slim`. `.cmux-harness/mode` 파일에 영속 (`spawn-panes.sh --no-e2e`)
- **🚨 Main dispatch ABSOLUTE RULE** — Main 페인이 자체적으로 코드/테스트를 작성하는 회귀를 차단. SKILL.md Phase 4에 "Main은 dispatch만, 위성 페인이 실제 작업" 원칙을 강제 룰 + 체크리스트로 명시. role_routing 매핑 → `pane-send.sh <pane>` 호출 외의 모든 자체 Edit/Write 금지. 유일한 예외: `orchestrator` / `task-planner` role 또는 사용자가 명시적으로 Main 직접 처리 지시한 경우

### 🌌 `/forge` → `/stargate` 명칭 변경

> 한국어 강의 시 "포-지" 발음의 거친 자음군이 안 좋고 영어권에서도 의미가 모호하다는 사용자 피드백에 따라 명칭 교체. **별의 관문(stargate)** = 아이디어 차원에서 완성품 차원으로 건너가는 통로. gateway 의미는 유지하고 발음·인지 모두 개선.

- `.claude/skills/forge/` → `.claude/skills/stargate/` 디렉토리 rename (`git mv`로 히스토리 보존)
- frontmatter `name: forge` → `name: stargate`
- 본문 메타포 "대장간" → "별의 관문" 교체
- 17개 파일의 `/forge`·`Forge`·`.forge/` 일괄 교체 (perl + negative lookbehind로 `harness-forge` 38건 안전 보존)
- `.gitignore`의 `.forge/` → `.stargate/`
- 메모리·docs/PIPELINES.md·README "언제 뭐 쓰나" 전체 동기화
- 후방 호환: 기존 `/forge` 명령은 인식되지 않음 (의도된 단방향 변경). 강의 자료 갱신 권장

### 구조 정리 — 결정 트리 + /stargate 디스패치 + dist 정리

> 57개 스킬·19개 에이전트가 쌓이면서 "어느 걸 언제 쓰나" 선택 비용이 커진 문제 해소. 새 스킬 추가 없이 기존 자산의 진입점을 명료화.

- **README "언제 뭐 쓰나" 결정 트리 표 2개 신규** — 기획 7종(eureka/neurion/socrates/doubt/poietes/cogito/auto-planner) + 빌드 오케스트레이터 4종(auto-orchestrate/harness/harness-forge/cmux-harness) 각각 한 줄 선택 기준. "스킬 한눈에 보기" 바로 위에 배치
- **`/stargate` Phase 1 4선택 디스패치** — 기획 진입 시 AskUserQuestion으로 socrates(귀납)/doubt(연역)/eureka·neurion(브레인스토밍)/auto-planner(비대화) 4종 중 자동 라우팅. 사용자가 7개 스킬을 외울 필요 없음
- **`/stargate` Phase 4 환경 감지 빌드 디스패치** — `$CMUX_WORKSPACE_ID` + `docs/planning/06-tasks.md` 존재 여부로 cmux-harness / harness-forge / auto-orchestrate / harness 4종 중 추천 옵션 자동 표시
- **🧹 dist/ 정리** — 정체불명 455MB 임시 ZIP 덤프(`dist/ziab9UWt`) 삭제. `.gitignore`에 `dist/*` 패턴 추가(`!dist/*.md`, `!dist/.gitkeep` 예외)로 미래 임시 빌드 덤프도 자동 무시
- **📐 `docs/PIPELINES.md` 신규** — Socrates(귀납·확장) / Descartes(연역·검증) 양대 파이프라인을 기획→명세→빌드→테스트→검증→자가개선→출시까지 한 문서로 정리. ASCII 다이어그램 + 단계별 비교 표 + 결정적 차이 3가지(출력 문서 수 / Phase 3.5 Validation / Phase 6 Impact Trace 회귀) + 라인 선택 가이드. README "언제 뭐 쓰나" 섹션과 `/stargate` SKILL.md 상단에서 본 문서로 링크
- **🚪 `/stargate` 풀 파이프라인 진입점 강화** — Claude Labs의 통합 시작점으로 부각. 4가지 보강을 한 번에 적용:
  1. **description·트리거 확장** — "처음부터", "어디서부터 시작", "전체 자동", "풀 사이클", "처음부터 끝까지" 자연어 트리거 추가. `/stargate resume` / `/stargate restart` 명시적 옵션 신설
  2. **Phase -1 체크포인트 시스템** — `.stargate/state.json` 신규. 매 Phase 진입·종료 시 갱신. 재진입 시 "이어서/특정 Phase로 점프/처음부터/상태만 보기" 4선택 AskUserQuestion
  3. **모든 Phase 분기 일관화** — Phase 3 종료(디자인 연결/빌드/멈춤), Phase 3.5(doubt 라인만 Validation), Phase 4 종료(검증/자가개선/멈춤), Phase 5 종료(추가 모드/리포트/멈춤), Phase 6 종료(세션 리포트/패키징/종료) 모두 AskUserQuestion 박힘
  4. **재진입 패턴 명시** — "여기서 멈춤" 옵션이 모든 분기에 존재. state 저장 후 종료 → 다음 진입 시 자동 재개. `.gitignore`에 `.stargate/` + `.cmux-harness/` 추가 (사용자별 상태 추적 X)

### 차후 작업 큐 — 신규 스킬 4종 (다음 세션)

> 갭 분석에서 식별된 미완 영역. 키워드가 다른 스킬에 산재하지만 전용 워크플로우 부재.

- 🟥 **`/migrate` (HIGH)** — 프레임워크/라이브러리/DB 스키마 마이그레이션 (Next 14→15, React 18→19, Python 3.10→3.12, Postgres 메이저, OpenAPI v3)
- 🟥 **`/observability` (HIGH)** — Sentry / OpenTelemetry / PostHog 자동 셋업 + 알람 라우팅
- 🟧 **`/repro` (MED)** — 버그 리포트 → 최소 재현 코드 + 회귀 테스트 자동 생성 (systematic-debugging의 앞 단계)
- 🟧 **`/perf` (MED)** — LCP/CLS/INP + 백엔드 p95 latency 결정 고리

상세 기획·우선순위는 본 세션 마지막에 생성된 메모리 항목 참조.

---

## [v1.17.0] - 2026-05-15

### Harness Stargate + Design Discovery + Skill Installer + cmux-harness Phase 6 + 훅 학습 시스템

> **멀티 페인 분산 빌드 오케스트레이터 신규 + Open Design 스타일 디자인 발굴 스킬 신규 + 스킬팩 레지스트리 인스톨러 신규 + cmux 하네스 컨텍스트 라이프사이클 + 반복 실수 차단 훅.**

- **`/harness-forge` 신규** — Clabs 멀티 페인 분산 빌드 오케스트레이터. Main(Opus) = 오케스트레이션만, Planner(Claude) = 기획, Reviewer(Codex) = 검토, Backend/Frontend = 병렬 빌드, QA(Chrome) = 브라우저 테스트의 6페인 역할 구조. 기획→리뷰→빌드(병렬)→QA 피드백 루프
- **`/design-discovery` 신규** — Open Design 데스크톱의 discovery → 디자인 생성 3턴 아크를 Claude Code CLI 표준 스킬로 이식. `AskUserQuestion`으로 7문항(output/platform/audience/tone/brand/scale/constraints) 수집 → DESIGN.md 바인드 → 시드 템플릿 채워 단일 HTML artifact 발행
- **`/skill-installer` 신규** — Claude Labs 스킬팩 레지스트리 시스템. `/skill-installer auto`로 프로젝트 타입 자동 감지, `/skill-installer list`로 팩 목록, `/skill-installer [pack]`으로 특정 팩 설치. socrates Phase 2.5 이후 자동 호출 연결
- **`cmux-harness` Phase 6** — 컨텍스트 라이프사이클 관리(턴/토큰 모니터링 → 핸드오프 → 페인 재생성) + tasks.md sub-agent 역할 기반 페인 라우팅 + Codex 10+턴 기획 검증 토론 통합. 모든 CLI는 권한 완전 허용 모드로 기동
- **훅 학습 시스템 신규 — `fix-blocker.js` / `fix-learner.js`** — 커밋 자동 학습으로 반복 실수 차단. PreToolUse(Edit|Write)에서 동일 실수 패턴 사전 차단, PostToolUse(Bash)에서 git 커밋 분석으로 fix 패턴 자동 축적
- **qmd 훅 전체 제거** — `PostToolUse hook error` 원인이던 qmd 관련 훅 제거하여 hook 안정성 회복
- **`harness-forge` 사용자 가이드** — packaging/10-harness-forge-guide.md 신규. 6페인 역할 구조, 페인 세팅 방법, 트러블슈팅 포함
- **`/stargate` 풀 파이프라인 통합** — 6단계 오케스트레이터(eureka/neurion → socrates → council → screen-spec/tasks-generator → auto-orchestrate/harness → autoresearch). harness-forge가 빌드 페이즈 옵션으로 편입
- **57개 스킬 / 19개 에이전트**

---

## [v1.16.0] - 2026-04-27

### Socrates v3.1 균형판 + 인스톨러 hooks 등록 버그 수정

> **socrates의 철학 편향 해소 + 사용자 레벨에 톤 강제 + 인스톨러가 훅 설정을 등록하지 않던 치명 버그 수정.**

- **socrates v3.1 — 제품 기획 균형판** — Phase 0.5(Ontological Inquiry) + 0.6(Aporia)을 "Problem Framing" 한 Phase로 통합, 화면 매핑(Phase 2)을 Phase 1 직후로 이동하여 추상→추상 대화 차단
- **JTBD 페르소나 도입** — 페르소나의 1순위 필수가 "When X, I want Y, so I can Z" JTBD 한 줄로 변경. Scene/Emotion은 보조 (persona-deep-dive.md 재설계)
- **MoSCoW + Won't 강제** — Phase 1에서 Must 2~4개 + **Won't(이번 버전 OUT) 최소 2개 강제**. Won't 없으면 Phase 2 진입 불가 (feature-deep-dive.md)
- **Value Ladder L3/L4 옵션화** — A→C→V(가치)까지가 기본. Fear/Identity는 L3/L4 + 사용자가 가치 단어를 본인 입으로 꺼냈을 때만 사용 (value-ladder.md)
- **Reflection Loop 단순화** — 기본은 단순 재진술(Mode A). 심층 해석(과거 Interpretive Mirror)은 L3/L4 + 모순 명확 감지 시 세션당 1~2회만 (reflection-loop.md)
- **대화 스타일 강제 규칙(§0-A) 신설** — 철학 용어(존재론/Aporia/Identity/Value Ladder 등) + 영문 라벨 사용자 노출 금지. 사용자 레벨에 강제로 톤·길이 매칭(L1 3문장 / L2 5문장 / L3 7문장). 상담/치료 톤 차단 (conversation-rules.md)
- **🐛 install.sh / install.ps1 hooks 등록 버그 수정** — 인스톨러가 `.claude/hooks/*.js`는 복사하면서 `.claude/settings.json`의 `hooks` 섹션을 `~/.claude/settings.json`에 병합하지 않아 **훅이 전혀 실행되지 않던 치명 버그**. `merge_hooks_settings()` (bash, jq) / `Merge-HooksSettings` (PowerShell) 함수 신설로 사용자 설정(mcpServers, permissions, slack_webhook 등) 보존하면서 hooks 섹션만 안전 병합 + 자동 백업

---

## [v1.15.1] - 2026-04-10

### Superpowers 패턴 도입 — 프롬프트 강제력 강화

> **obra/superpowers에서 검증된 행동 강제 패턴을 Claude Labs에 이식. 기술적 인프라 위에 프롬프트 강제력을 얹는다.**

- **Red Flag Self-Check 패턴** — socrates, code-review에 합리화 차단용 Red Flag 테이블 추가. "이런 생각이 들면 STOP" 자기검증 리스트
- **Iron Law 패턴** — code-review에 "Stage 1 통과 없이 Stage 2 진행 금지" 철칙 추가
- **프로세스 선언 패턴** — 4개 핵심 스킬(socrates, code-review, systematic-debugging, verification-before-completion)에 "I'm using the X skill to..." 명시적 선언 강제. Phase 전환 시에도 선언
- **Use when 패턴** — skill-router.js의 핵심 스킬 description을 "Use when [트리거 조건]" 형식으로 개선. Claude의 스킬 검색 정확도 향상
- **hookSpecificOutput.hookEventName 수정** — lib/utils.js의 outputContext/outputDecision/outputUpdatedInput 함수에 hookEventName 필드 추가 (최신 Claude Code hook 스펙 준수)
- **훅 호출부 5개 수정** — post-edit-analyzer, error-recovery-advisor, context-guide-loader, git-commit-checker, agent-context-injector의 hookEventName 명시

---

## [v1.15.0] - 2026-04-03

### `/doubt` — 데카르트 방법적 회의 기반 풀스케일 기획 스킬 신규

> **`/socrates`와 대칭을 이루는 양대 기획 스킬. 연역적 확신(Top-down)으로 코기토에서 기능을 도출하고, 코기토와 무관한 것은 전부 기각한다.**

- **`/doubt` 스킬 신규** — 데카르트 방법적 회의 6단계: Praeparatio(준비) → Genius Malignus(악마의 심문) → Dubito(체계적 해체) → Cogito(핵심 발견) → Clara et Distincta(명석판명 연역) → Reconstructio(체계적 재건) → Meditatio(문서화+검증). 30-50개 동적 질문
- **Certitudo 수렴 엔진** — 8차원 확실성 측정(의심 철저성/코기토 명확성/연역 체인/문제 정밀도/기능 필연성/기각 엄밀성/재건 무결성/악마 내성). Ouroboros의 데카르트 대응물
- **9개 기획 문서 출력** — 01~07은 socrates 호환(/screen-spec, /tasks-generator 무수정 연동), 08-cogito-chain.md(연역 체인), 09-doubt-audit.md(의심 감사 보고서) 고유 문서 2개 추가
- **악마의 질문 패턴 5종** — 역전(Inversion), 기원 도전(Origin Challenge), 필요성 시험(Necessity Test), 악마의 속삭임(Demon's Whisper), 벗겨진 현실(Stripped Reality)
- **병리 패턴 4종** — 조기 확신, 의심 마비, 연역 단절, 향수 편향 자동 감지 + 대응
- **`/cogito` 연동** — cogito-statement.md 존재 시 Phase 2 스킵 가능, /doubt Phase 2에서 cogito-statement.md 부산물 생성
- **20개 reference 파일** — SKILL.md + references/ 20개 파일로 구성
- **56개 스킬 / 19개 에이전트**

---

## [v1.14.0] - 2026-03-30

### Stargate 파이프라인 + Socrates v2 + 스킬 경량화

> **`/stargate` 한 줄로 아이디어→완성 앱. Socrates v2로 기획 깊이 2배. 미사용 스킬 6개 정리하여 55개로 경량화.**

- **`/stargate` 풀 파이프라인 신규** — 6단계 오케스트레이터: 브레인스토밍(/eureka·/neurion) → 심층기획(/socrates v2) → 리뷰(/council) → 명세(/screen-spec·/tasks-generator) → 빌드(/auto-orchestrate 또는 /harness) → 자가개선(/autoresearch). 모든 Phase 전환점에 사용자 선택권
- **Socrates v2 기획 강화** — 10개 명확성 차원(경쟁환경/페르소나/비즈니스/기능엣지 4개 추가), Ambiguity 0.15 임계값(was 0.2), Phase 0.7/0.8/0.9/1.5 신규 4단계, 9개 기획 문서(08-competitive-analysis.md, 09-personas.md 추가), 4개 신규 레퍼런스
- **Council v2 단일세션 모드** — $CLABS_SOCKET 없이 Agent 서브에이전트 3명(CTO/UX/Security) 병렬 리뷰. 분산/단일 자동 감지. single-session-personas.md 레퍼런스 추가
- **Harness v2** — tasks.md 통합(task-feature-map.json 브릿지), Build-Eval 사이클수(1/3/5/커스텀) + 루브릭 임계값(관대5/기본7/엄격8) 사용자 설정. harness-builder Tasks-Aware Mode, harness-evaluator Configurable Thresholds
- **미사용 스킬 6개 삭제** — a2a, goal-setting, guardrails, movin-design-system, paperfolio-design, ralph-loop (사용 흔적 분석 기반)
- **스킬 코스 가이드 신규** — packaging/09-skill-courses.md: 7개 코스(풀파이프라인/브레인스토밍/기획/프로토타입/기존개선/디버깅/보안배포) + 8개 레시피 + 선택 플로우차트
- **install.sh/ps1 버그 수정** — 9개 스킬 누락(stargate/council/harness계/autoresearch계), COPY_OK 카운팅 로직, PS1 카테고리 13개 매핑
- **autoresearch 품질 평가표** — 5개 카테고리 100점 Frozen Metric + bash 자동 측정 스크립트
- **eureka/neurion /stargate 연결** — 다음 단계에 "/stargate 풀 파이프라인 (권장)" 옵션 추가

---

## [v1.13.1] - 2026-03-29

### Council 스킬 + 핵심 스킬 5종 강화

> **멀티 에이전트 기획 리뷰 위원회(council) 신규 + socrates/autoresearch/audit/code-review/vercel-review 대폭 개선.**

- **`/council` 스킬 신규** — 멀티 에이전트 기획 리뷰 위원회. 다양한 관점에서 기획 결과를 검토하여 완성도 향상
- **`/socrates` 강화** — ouroboros convergence 패턴 추가. conversation-rules, dynamic-questions, phase-details, socratic-method 레퍼런스 대폭 개선
- **`/autoresearch` v3.0** — uditgoenka/autoresearch에서 8개 서브커맨드(security/predict/plan/ship/learn/fix/debug/scenario) + Guard + Chain 패턴 이식. 서브커맨드 디렉토리 구조 도입
- **`/audit` 강화** — 감사 모듈 정밀화
- **`/code-review` 강화** — 2단계 리뷰 시스템 정밀화
- **`/vercel-review` 강화** — 성능 최적화 가이드라인 확장
- **에이전트 19개** — task-executor 추가
- **총 60개 스킬** (packaging 제외)

---

## [v1.13.0] - 2026-03-26

### Harness Architecture 도입 — Socrates + Builder + Evaluator 3-에이전트 시스템

> **[Anthropic Harness Architecture](https://www.anthropic.com/engineering/harness-architecture) 구현. GAN 영감의 Generator-Evaluator 피드백 루프로 풀스택 앱 자율 생성.**

- **`/harness` 오케스트레이터 신규** — Socrates 기획 → Builder 구현 → Evaluator QA를 하나의 커맨드로 체인. Build-Eval 피드백 루프 최대 3사이클. `docs/harness/harness-state.json`으로 상태 관리, `--resume` 재개 지원
- **`harness-builder` 스킬 신규** — spec 기반 자유형 연속 빌더. TASKS.md 없이 socrates 기획 문서에서 직접 빌드. 전문가 에이전트(backend/frontend/database-specialist) 위임. features.json 우선순위(P0→P1→P2) 순서 구현. 피드백 사이클에서 BLOCKING issues 우선 수정. `implementation-map.json` + `self-eval.md` 출력
- **`harness-evaluator` 스킬 신규** — Chrome MCP로 실행 중인 앱을 실제 클릭하며 테스트하는 독립 QA 에이전트. 루브릭 4기준(Design Quality/Functionality/Craft/Data Integrity) 채점. **회의적 기본값** — "기능이 작동하지 않는다"가 기본 가정, 증거로 증명해야 통과. AI Slop 10패턴 감점. `eval-scores-{N}.json` + `feedback-{N}.md` 출력
- **`auto-planner` 스킬 신규** — 1-4문장 프롬프트를 5분 내 풀 제품 사양으로 자동 확장. socrates 없이 빠른 프로토타이핑용 경량 플래너. 제품 유형별 루브릭 프리셋 6종(SaaS/대시보드/이커머스/포트폴리오/게임/소셜). 사양 확인 체크포인트 포함
- **커맨드 1개 추가** — `harness.md` (`/harness "앱 설명"`)
- **두 파이프라인 공존** — 기존 `socrates → screen-spec → tasks-generator → auto-orchestrate`(정교한 기획)과 `/harness`(빠른 프로토타이핑) 병렬 경로. 전문가 에이전트/품질 스킬 공유
- **References 7개 추가** — rubric-templates.md, skeptical-qa-rules.md, scoring-guide.md, browser-test-protocol.md, self-eval-protocol.md, specialist-delegation.md, loop-protocol.md

---

## [v1.12.0] - 2026-03-15

### AutoResearch 스킬 패밀리 도입 — 3파일 구조 + Frozen Metric + 2계층 RSI

> **[karpathy/autoresearch](https://github.com/karpathy/autoresearch) 패턴을 범용화. 코어 엔진 + 2개 도메인 특화 스킬로 구성된 autoresearch 패밀리 편입.**

- **`/autoresearch` 코어 v2.0** — 범용 자율 실험 루프 엔진. 3파일 원칙(prepare+target+program.md), Frozen Metric 철학, 2계층 RSI(Inner+Outer Loop) 아키텍처. 5개 실행 모드(design/run/rsi/report/resume). 도메인 특화 스킬 자동 라우팅
- **`/autoresearch-frontend` 신규** — Chrome MCP(claude-in-chrome) 기반 프론트엔드 자율 개선. DOM 접근성 + 콘솔 에러 + 폼 성공률 + 시각 정합성 복합 메트릭. test-routes.json 기반 경로별 테스트. 2계층 RSI로 전략 자체도 자율 개선
- **`/autoresearch-skills` 신규** — SKILL.md를 target 파일로 사용하는 스킬 자율 개선 엔진. 테스트 케이스 기반 Frozen Metric(assertion 통과율 + 엣지케이스 + 포맷 준수). Tier 1/2/3 적합성 판별. gen-tests 모드로 테스트 케이스 자동 생성
- **Frozen Metric 계층 분리** — Level 0(meta_eval/절대불변) → Level 1(outer/Outer만수정) → Level 1.5(eval/고정) → Level 2(target/Inner만수정)
- **커맨드 3개 추가** — `autoresearch.md`, `autoresearch-frontend.md`, `autoresearch-skills.md`
- **기존 스킬 연계**: 3회 crash → `/systematic-debugging`, 아이디어 고갈 → `/deep-research`, 완료 후 → `/evaluation`

---

## [v1.11.0] - 2026-03-15

### Alfred Dev 장점 흡수 — 3개 신규 스킬 + 기존 강화

> **Alfred Dev 분석 결과 식별된 핵심 기능 3가지를 신규 스킬로 추가하고, 기존 verification 스킬을 강화하여 파이프라인에 편입.**

- **`/spike` 스킬 신규** — 불확실 영역 탐색 전용 모드. 품질 게이트 완화 + 빠른 프로토타이핑 → `docs/spikes/spike-{date}-{topic}.md` 결과 리포트. Phase 0(socrates 이전) 또는 독립 실행
- **`/audit` 스킬 신규** — 보안(OWASP Top 10)/라이선스(SPDX 호환성)/개인정보(GDPR) 3모듈 감사 + `docs/audit/audit-report-{date}.md` 구조화 리포트. Phase 5(품질 검증 이후) 또는 독립 실행
- **`/session-report` 스킬 신규** — git log/diff + 세션 데이터 + 검증 증거 → 카테고리별 변경 분석 + 메트릭 요약 → `docs/reports/session-{timestamp}.md` 리포트
- **verification-before-completion 강화** — 자동 증거 추적(`.claude/cache/verification-evidence.json`), 3회 연속 실패 감지 → systematic-debugging 자동 권장, session-report 연동
- **WORKFLOW.md Phase 0/5 추가** — Phase 0(`/spike` 탐색) + Phase 5(`/audit` 감사) 아키텍처 다이어그램 편입, Section 15-17 신규
- **skill-router.js 3개 스킬 라우팅** — spike(priority 8), audit(priority 7), session-report(priority 6) 키워드 매칭 추가
- **install.sh/install.ps1 52개 스킬 커버리지** — Core에 spike, Quality에 audit, Utility에 session-report 추가

---

## [v1.10.2] - 2026-03-15

### 파이프라인 검증 & 갭 수정

> **스킬 파이프라인(socrates→screen-spec→tasks-generator→auto-orchestrate→품질 체인)의 문서 갭을 수정하고 누락된 체크포인트를 추가.**

- **Pipeline Context 추가 (7개 스킬)** — socrates, screen-spec, tasks-generator, auto-orchestrate, code-review, evaluation, verification-before-completion에 입력 소스/출력 대상/체크포인트 참조 테이블 추가
- **master-pipeline.md 신규** — 전체 파이프라인 다이어그램, 데이터 아티팩트 흐름, 체크포인트 유형, 전문가 에이전트 매핑, 실패 복구 경로 참조 문서
- **checkpoint-workflow.md 보강** — 체크포인트 유형 테이블 (Phase/핸드오프/ICV/품질게이트), powerqa 실패 복구 연동 섹션 추가
- **screen-spec Phase 4 체크포인트** — 도메인 커버리지 검증 완료 후 AskUserQuestion으로 명세 요약 확인
- **tasks-generator ICV + Phase 4 체크포인트** — Interface Contract Validation 결과 확인 + 태스크 구조 요약 확인
- **quality-chain.md powerqa 공식화** — verification/evaluation/code-review/security 실패 시 powerqa 자동 호출, 동일 에러 3회 시 systematic-debugging 전환
- **orchestrator 에이전트 테이블 완성** — docs-specialist, task-executor, electron-main/renderer/test-specialist 5개 추가
- **database-specialist 토큰 최적화** — frontmatter에 `skills: token-optimizer` 추가
- **install.sh 49개 스킬 커버리지** — Philosophy (eros, eureka, cogito, odysseus, poietes, the-fool), Language Pro (golang-pro, python-pro, typescript-pro), DevOps (kubernetes-specialist, terraform-engineer, database-optimizer) 3개 신규 카테고리 + Quality/Utility 확장
- **validate_skills.py 추가** — 스킬팩 구조 검증 스크립트 (frontmatter, 에이전트 설정, 훅 참조, 교차 참조)

---

## [Unreleased] - 2026-03-09

### 오케스트레이션 워크플로우 계약 정렬

> **`.claude` 오케스트레이션 문서 전반의 실행 계약을 단일 기준으로 정리. 경로, 태스크 ID, Worktree 브랜치 전략, Phase 병합 책임자를 일관화.**

- **태스크 문서 경로 통일** - 오케스트레이터, dependency-resolver, docs/task-planner, `/orchestrate`가 `docs/planning/06-tasks.md`를 표준 입력/출력으로 사용하도록 정리
- **v2 태스크 ID 반영** - `P0-T0.1`, `P{N}-R{M}-T{X}`, `P{N}-S{M}-T{X}`, `P{N}-S{M}-V` 형식을 오케스트레이션 템플릿과 파서 예시에 반영
- **브랜치 기반 Worktree 정책 통일** - Phase 1+에서 `git worktree add <worktree> -b <phase-branch> main` 형태를 표준으로 명시
- **병합 책임 분리** - specialist는 `TASK_DONE`/`FAIL`만 보고하고, Phase 품질 게이트와 병합은 orchestrator만 수행하도록 계약 정리
- **bootstrap 참고본 동기화** - `project-bootstrap/references/*`의 orchestrator/specialist/orchestrate-command 템플릿도 동일 계약으로 보정

### auto-orchestrate 구현 워크플로우 정밀화

> **사용자 기대 순서인 `구현 → Git Worktree → TDD → review → QA/security → main 병합 → commit/push`를 canonical contract로 명문화.**

- **Git Worktree 용어 명확화** - `/auto-orchestrate`는 subtree가 아니라 branch-backed Git Worktree를 표준으로 사용한다고 명시
- **specialist 완료 조건 강화** - backend/frontend/database/test/security/3d specialist가 Worktree에서 검증 후 로컬 커밋을 만들고 `TASK_DONE:{task_id}:{commit_sha}`로 보고하도록 정리
- **품질 체인 확장** - verification → evaluation → code-review → security-review → frontend-review 순서를 명문화하고, 실패 시 같은 Phase 브랜치에서 TDD 루프로 재진입하도록 보강
- **merge/push 책임 일원화** - main 병합과 `git push origin main`은 orchestrator 전용 책임으로 고정

## [v1.10.1] - 2026-02-21

### Eros/Poietes HYOGOOK V6 통합

> **AFO Kingdom의 HYOGOOK V6 S-Score를 Eros와 Poietes 스킬에 통합. 6덕목 기하평균으로 인식 사이클의 품질을 정량화.**

- **`/eros` S-Score 통합** — Phase 6 Athanasia에 HYOGOOK S-Score 자가 평가 추가 (eros-analysis.md 템플릿에 S-Score 섹션 포함)
- **`/eros` AFO 페르소나 명명** — Diotima Ladder 각 Layer에 AFO 페르소나 추가 (JUNIOR/EXPLORE/ORACLE/ATLAS/PROMETHEUS/SOUL_ENGINE)
- **`/eros` 태그라인** — *"Coding ends not in Syntax, but in Poiesis." — AFO Kingdom* 추가
- **`/poietes` S-Score 통합** — Phase 4 Athanasia 불멸 검증 5항목으로 확장 (기존 4요건 + S-Score 간략 산출)
- **신규 파일** — `eros/references/hyogook-scoring.md` — HYOGOOK 6덕목 기하평균 스코어링 상세 가이드 (Trinity Score와 별도 공존)

---

## [v1.10.0] - 2026-02-20

### Poietes 스킬 신규 + tmux 병렬 모드

> **에로스 사이클 기반 기획 컨설팅 스킬 + auto-orchestrate/ultra-thin tmux 독립 프로세스 병렬 실행.**

- **Poietes 스킬 신규** (`/poietes`) - 소크라테스 21개 질문을 에로스 사이클(결핍→욕망→다이몬→출산)로 재배열한 기획 컨설팅 v2
- **4 Phase 에로스 워크플로우** - Phase 1 결핍 인식(Aporia) → Phase 2 욕망 발동(Eros) → Phase 3 다이몬 중재(Daimon) → Phase 4 출산과 불멸(Poiesis)
- **미니 디오티마 사다리** - Phase 2에서 욕망을 Level 1(실행)→Level 5(의도)로 계층 상승
- **불멸 검증** - Phase 4에서 망하는 기획 4요건(벤치마킹, 가설/사실, 타협, 실험) 검사
- **tmux 병렬 모드** (`--tmux`) - auto-orchestrate, ultra-thin-orchestrate에 독립 tmux 패널 기반 병렬 실행 추가
- **파일 기반 통신** - /tmp/task-N.done 완료 신호 + /tmp/task-N-result.md 결과 취합
- **프로세스 격리** - 각 태스크가 독립 Claude CLI 프로세스로 실행, 중첩 제한 없음

---

## [v1.9.8] - 2026-02-20

### 에이전트/훅 안정화 + 패키징 유지보수

> **전문가 에이전트, 훅 시스템, Progressive Disclosure references 전반 품질 개선 및 배포 스크립트 최신화.**

- **에이전트 품질 개선** - backend-specialist, frontend-specialist, orchestrator, task-executor, dependency-resolver 에이전트 정의 보강
- **훅 시스템 안정화** - agent-context-injector, context-guide-loader, error-recovery-advisor, session-memory-loader 등 9개 훅 개선
- **Progressive Disclosure 확대** - auto-orchestrate references 4개 파일 신규 (error-handling, merge-workflow, phase-execution, quality-chain)
- **Socrates references 보강** - output-documents, question-framework, screen-mapping 3개 파일 신규
- **hook-runner.sh 크로스플랫폼** - NVM/fnm/Homebrew 폴백 체인으로 Node.js 탐색 안정화
- **패키징 스크립트 최신화** - install.sh, install.ps1 배포 메타데이터 갱신

---

## [v1.9.7] - 2026-02-20

### Eros 스킬 신규 + Socrates 양방향 연동

> **플라톤 향연의 에로스 알고리즘 + 소크라테스 기획 스킬과의 양방향 연동. 결핍 인식 → 디오티마 사다리 6계층 추상화 → 창작 → 불사 보존.**

- **Eros 스킬 신규** (`/eros`) - 6 Phase 인식 프레임워크 (결핍 인식 → 욕망 발동 → 다이몬 중재 → 디오티마 사다리 → 창작 Poiesis → 불사 보존)
- **디오티마 사다리 6계층** - Layer 0(구체) → Layer 1(패턴) → Layer 2(규칙) → Layer 3(전이) → Layer 4(메타) → Layer 5(이데아), 건너뛰기 금지
- **4가지 결핍 유형** - explicit-gap, hidden-gap, assumed-known(던닝-크루거), boundary-gap 자동 스캔
- **Socrates 양방향 연동** - 소크라테스 완료 후 `/eros` 기획 검증 옵션 + 에로스 완료 후 `/socrates` 기획 시작 옵션
- **skill-router 훅 등록** - "에로스", "결핍 인식", "디오티마", "추상화 사다리" 키워드 자동 감지
- **Big/Small Cycle** - 새 결핍 발견 시 Phase 1 복귀(Big), 추상 재상승 필요 시 Layer 복귀(Small)

---

## [v1.9.6] - 2026-02-20

### Eros 스킬 신규 — 플라톤 향연의 에로스 알고리즘

> **결핍 인식 → 디오티마 사다리 6계층 추상화 → 창작 → 불사 보존. AI 에이전트의 던닝-크루거 방지 + 체계적 인식 상승 프레임워크.**

- **Eros 스킬 신규** (`/eros`) - 6 Phase 인식 프레임워크 (결핍 인식 → 욕망 발동 → 다이몬 중재 → 디오티마 사다리 → 창작 Poiesis → 불사 보존)
- **디오티마 사다리 6계층** - Layer 0(구체) → Layer 1(패턴) → Layer 2(규칙) → Layer 3(전이) → Layer 4(메타) → Layer 5(이데아), 건너뛰기 금지
- **4가지 결핍 유형** - explicit-gap, hidden-gap, assumed-known(던닝-크루거), boundary-gap 자동 스캔
- **Big/Small Cycle** - 새 결핍 발견 시 Phase 1 복귀(Big), 추상 재상승 필요 시 Layer 복귀(Small)
- **스킬 연동** - `/common-ground` → Phase 1 입력, `/the-fool` → Phase 4 가정 검증, `/systematic-debugging` → 3회 실패 시 전환

---

## [v1.9.5] - 2026-02-19

### project-bootstrap-supabase 스킬 신규 + project-bootstrap 자동 위임

> **Next.js + Supabase + Vercel CI/CD 풀스택 프로젝트를 원커맨드로 셋업하는 전용 스킬 추가. 기존 project-bootstrap에서 조합 감지 시 자동 전환.**

- **project-bootstrap-supabase 스킬 신규** - 4 Phase 자동 셋업 (create-next-app → supabase start → SSR 보일러플레이트 → GitHub Actions CI/CD)
- **project-bootstrap 자동 위임 규칙** - 프론트엔드=Next.js + DB=Supabase 조합 감지 시 전용 스킬로 자동 전환
- **발동 조건 가드 강화** - 프로젝트 생성 의도가 명확한 요청에만 반응, 단순 Supabase 사용법 질문에는 미반응

---

## [v1.9.4] - 2026-02-15

### Jeffallan 기술 6가지 도입 + 전문가 스킬 6개 추가

> **Jeffallan/claude-skills 분석 결과 발견한 6가지 핵심 기술을 Claude Labs에 도입. Progressive Disclosure로 토큰 50-70% 절감.**

---

### Phase 1: Progressive Disclosure Architecture

- **표준 문서 신규** - `.claude/docs/progressive-disclosure.md` (2-tier 스킬 구조 표준)
- **auto-orchestrate 리팩토링** - 458줄 → 132줄 (71% 축소) + references/ 3개 파일 분리
- **socrates 리팩토링** - 332줄 → 122줄 (63% 축소) + references/ 3개 파일 분리

### Phase 2: Common Ground (AI 가정 투명화)

- **common-ground 스킬 신규** - 4가지 가정 유형, 3단계 신뢰 등급, 4가지 모드 (대화형/--list/--check/--graph)
- **common-ground 커맨드 신규** - `/common-ground` 슬래시 커맨드

### Phase 3: Behavioral Engineering Patterns

- **CLAUDE.md 섹션 13 추가** - 1% Rule, Agreement Theater 금지, Verification Discipline, 3회 실패 임계값

### Phase 4: The Fool (비판적 사고)

- **the-fool 스킬 신규** - 5가지 비판적 추론 모드 (가정 노출, 반대 논증, 실패 모드, 레드팀, 증거 검증)

### Phase 5: allowed-tools 제한

- **5개 스킬에 도구 제한 추가** - code-review, reverse, evaluation, sync, deep-research

### Phase 6: 전문가 스킬 6개 (Progressive Disclosure 적용)

- **python-pro** - Python 3.11+ 전문가 (타입 힌트, async/await, pytest)
- **typescript-pro** - TypeScript 5.x 전문가 (제네릭, 유틸리티 타입, satisfies)
- **golang-pro** - Go 동시성 전문가 (goroutine, channel, 인터페이스)
- **kubernetes-specialist** - K8s 워크로드, 서비스, Helm, GitOps
- **terraform-engineer** - Terraform IaC, 멀티 클라우드, 모듈 패턴
- **database-optimizer** - 인덱스 전략, 쿼리 최적화, EXPLAIN 분석

### 훅 시스템 안정화

- **Node.js 미설치 환경 호환** - 모든 훅 커맨드에 `command -v node` 가드 추가
- **settings.local.json 배포 제외** - ZIP에서 개인 설정 파일 제외

---

## [v1.9.3] - 2026-02-07

### install.sh 스킬 설치 안정화 (gum spin + set -e 버그 수정)

- **`gum spin` 연속 호출 버그 수정** - 스킬별 개별 `gum spin` 호출 제거 → `copy_dir()` 헬퍼 함수 기반으로 전환
- **`copy_dir()` 헬퍼 도입** - rsync 실패 시 `cp -R` 자동 폴백, 소스 디렉토리 없어도 `return 0`으로 `set -e` 안전
- **`install_category()` 헬퍼 도입** - 카테고리별 루프 기반 설치, 설치 성공 카운트 표시 `✓ (4/4)`
- **Hybrid 카테고리 설치 누락 수정** - `desktop-bridge` 스킬이 선택 메뉴에는 있으나 설치 로직에서 빠져있던 버그 수정
- **install_constitutions() 안정화** - 헌법 설치도 `copy_dir()` 기반으로 전환

---

## [v1.9.2] - 2026-02-07

### install.ps1 gum confirm 제거 + 패키징 경로 통일

- **install.ps1 gum confirm 완전 제거** - `gum confirm` 4개소를 `Read-Host` 기반으로 교체 (PowerShell 네이티브 호환)
- **ZIP 출력 경로 통일** - 패키징 ZIP을 `dist/` 폴더에 생성하도록 CLAUDE.md, SKILL.md 업데이트
- **패키징 규칙 추가** - "규칙 3: ZIP은 반드시 dist/ 폴더에 생성" 추가, 기존 규칙 번호 재정렬

---

## [v1.9.1] - 2026-02-07

### 배포 방식 변경 + 설치 스크립트 수정

- **DMG/EXE 배포 제거** - 스크립트 기반 설치 전용으로 전환 (install.sh / install.ps1 / 수동 rsync)
- **install.ps1 gum confirm 수정** - `gum confirm`이 stdout 대신 exit code를 반환하는 PowerShell 호환성 버그 수정 (4개소)
- **UserPromptSubmit hook timeout 증가** - 5초 → 10초 (VibeMem qmd 연동 시 타임아웃 방지)
- **패키징 스킬 업데이트** - DMG/EXE 참조 제거, mcp-servers/ ZIP 포함, ZIP 구조 다이어그램 추가
- **CLAUDE.md 업데이트** - 패키징 규칙에서 DMG/EXE 관련 항목 제거 및 간소화

---

## [v1.9.0] - 2026-02-06

### Hook 시스템 도입: 컨텍스트 40~60% 절감

> **Claude Code Hook API를 활용한 자동 컨텍스트 주입 시스템으로 세션 효율성 대폭 향상**

---

### 핵심 변경사항

```
┌─────────────────────────────────────────────────────────────────────┐
│  Hook System - 자동 컨텍스트 주입 인프라                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Phase 1: 핵심 인프라 + 고효율 훅                                   │
│  ├── session-memory-loader (SessionStart)                          │
│  │   └── 메모리 자동 로드 → Read() 3~5회 제거                     │
│  ├── skill-router (UserPromptSubmit)                               │
│  │   └── 키워드 기반 스킬 자동 감지 → 탐색 왕복 제거               │
│  ├── context-guide-loader (PreToolUse[Edit|Write])                 │
│  │   └── Constitution 자동 주입 → 수동 로드 제거                   │
│  └── session-summary-saver (Stop)                                  │
│      └── 세션 요약 저장 + 미완료 TODO 차단                         │
│                                                                     │
│  Phase 2: 서브에이전트 최적화 + 품질 훅                             │
│  ├── agent-context-injector (PreToolUse[Task])                     │
│  │   └── 에이전트 프롬프트에 컨텍스트 자동 주입                     │
│  ├── post-edit-analyzer (PostToolUse[Write|Edit])                  │
│  │   └── 위험 패턴 감지 + 보안 경고                                │
│  ├── git-commit-checker (PreToolUse[Bash])                         │
│  │   └── 커밋 메시지 품질 + 위험 명령 차단                         │
│  └── error-recovery-advisor (PostToolUseFailure)                   │
│      └── 에러 KB 기반 복구 제안 + 학습                             │
│                                                                     │
│  Phase 3: AI 훅                                                     │
│  ├── Stop AI 훅 → 세션 코칭 (패턴 분석)                           │
│  └── PostToolUse AI 훅 → OWASP Top 10 보안 스캔                   │
│                                                                     │
│  예상 절감: 일반 세션 40~60%, 오케스트레이션 25~35% 추가           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 새로운 파일

| 파일 | 내용 |
|------|------|
| `.claude/hooks/lib/utils.js` | 공통 유틸리티 (stdin JSON 파싱, 출력 헬퍼) |
| `.claude/hooks/session-memory-loader.js` | SessionStart: 메모리 + 기술 스택 자동 로드 |
| `.claude/hooks/skill-router.js` | UserPromptSubmit: 35+ 스킬 키워드 매칭 |
| `.claude/hooks/context-guide-loader.js` | PreToolUse[Edit\|Write]: Constitution 자동 주입 |
| `.claude/hooks/agent-context-injector.js` | PreToolUse[Task]: 에이전트 컨텍스트 보강 |
| `.claude/hooks/git-commit-checker.js` | PreToolUse[Bash]: 커밋 품질 + 위험 명령 차단 |
| `.claude/hooks/post-edit-analyzer.js` | PostToolUse[Write\|Edit]: 코드 패턴 분석 |
| `.claude/hooks/error-recovery-advisor.js` | PostToolUseFailure: 에러 복구 제안 |
| `.claude/hooks/session-summary-saver.js` | Stop: 세션 요약 + TODO 차단 |

---

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `.claude/settings.json` | 전체 hooks 구조 교체 (6개 이벤트, 9개 훅) |
| `install.sh` | .claude/hooks/ 복사 + 퍼미션 설정 추가 |
| `install.ps1` | .claude/hooks/ 복사 로직 추가 |

---

### 훅별 절감 효과

| 훅 | 제거되는 동작 | 절감 토큰 | 빈도 |
|----|-------------|----------|------|
| session-memory-loader | Read() 3~5회 → 0회 | 2K~5K | 매 세션 |
| skill-router | 스킬 탐색 왕복 제거 | 1K~3K | 매 프롬프트 |
| context-guide-loader | Constitution 수동 로드 제거 | 1K~3K | 파일 수정 시 |
| agent-context-injector | 반복 지시 제거 | ~500 | 태스크당 |
| session-summary-saver | 다음 세션 재설명 제거 | 3K~8K | 매 세션 |
| error-recovery-advisor | 반복 실패 시도 제거 | ~1K | 에러 시 |

---

## [v1.8.3] - 2026-02-03

### 버전 동기화 및 패키징 업데이트

> **스킬팩과 Clabs 앱 버전 통일 (v1.8.3)**

---

### 핵심 변경사항

- 스킬팩 버전과 Clabs GUI 앱 버전 동기화
- 패키징 워크플로우 안정화
- Mac/Windows 플랫폼별 배포 패키지 생성

### 버전 동기화된 파일

- `README.md` - v1.8.3
- `install.sh` - v1.8.3
- `install.ps1` - v1.8.3
- `clabs/package.json` - v1.8.3

---

## [v1.8.1] - 2026-02-01

### Desktop Bridge: 하이브리드 워크플로우 스킬 추가

> **Claude Desktop(설계) + Claude Code CLI(구현)를 GitHub Issue로 연결하는 하이브리드 워크플로우**

---

### 핵심 변경사항

```
┌─────────────────────────────────────────────────────────────────────┐
│  Desktop Bridge - 하이브리드 워크플로우                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [Claude Desktop]         [GitHub]          [Claude Code CLI]       │
│  ┌─────────────────┐     ┌─────────┐       ┌─────────────────┐     │
│  │ /socrates       │     │ Issue   │       │ /auto-orchestrate│     │
│  │ /neurion        │ ────▶ #123    │──────▶│ 완전 자동화     │     │
│  │ /screen-spec    │     │         │       │ 코드 생성       │     │
│  └─────────────────┘     └─────────┘       └─────────────────┘     │
│                                                                     │
│  장점:                                                              │
│  ├── Desktop: 시각적 대화, 다이어그램 첨부, 풍부한 UI              │
│  ├── GitHub: 버전 관리, 협업, 히스토리 추적, 코드 리뷰 연동         │
│  └── CLI: 에이전틱 코드 작성, 파일 시스템 접근, 테스트 실행         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 새로운 스킬

| 스킬 | 설명 |
|------|------|
| `/desktop-bridge` | Desktop↔CLI 하이브리드 워크플로우 |

---

### /desktop-bridge - 두 가지 모드

#### 1. `publish` 모드 (Desktop → GitHub)

```bash
/desktop-bridge publish
```

**동작**:
1. specs/, docs/planning/ 기획 문서 수집
2. GitHub Issue 자동 생성
   - 제목: `[Design] {프로젝트명} - 아키텍처 및 화면 명세`
   - 본문: 기획 요약 + 화면 목록(체크박스) + 기술 스택
   - 라벨: `design`, `from-desktop`
3. Issue 번호 반환 → CLI에서 참조

#### 2. `implement` 모드 (GitHub → CLI)

```bash
/desktop-bridge implement #123
```

**동작**:
1. GitHub Issue #123 내용 로드
2. 설계 문서 파싱 및 로컬 복원
3. TASKS.md 자동 생성 (/tasks-generator 연동)
4. 구현 진행 시 Issue 코멘트로 진행 상황 자동 업데이트
5. 완료 시 Issue 자동 닫기

---

### GitHub 연동

| 방식 | 우선순위 | 확인 방법 |
|------|---------|----------|
| GitHub MCP | 1순위 | MCP 도구 존재 여부 |
| gh CLI | 2순위 (폴백) | `which gh` + `gh auth status` |

---

### 워크플로우 체인

```
[Desktop 환경]
/neurion (브레인스토밍)
    ↓
/socrates (21개 질문)
    ↓
/screen-spec (화면 명세)
    ↓
────────────────────────────────────────
      /desktop-bridge publish
────────────────────────────────────────
    ↓
[GitHub Issue #123 생성]
    ↓
────────────────────────────────────────
      /desktop-bridge implement #123
────────────────────────────────────────
    ↓
[CLI 환경]
/tasks-generator (자동 호출)
    ↓
/project-bootstrap (환경 셋업)
    ↓
/auto-orchestrate (완전 자동화)
    ↓
Issue 코멘트로 진행상황 업데이트
    ↓
PR 생성 및 Issue 연결
    ↓
Issue 자동 닫기
```

---

### 새로운 파일

| 파일 | 내용 |
|------|------|
| `skills/desktop-bridge/SKILL.md` | 스킬 정의 |
| `skills/desktop-bridge/references/publish-flow.md` | publish 모드 상세 |
| `skills/desktop-bridge/references/implement-flow.md` | implement 모드 상세 |
| `skills/desktop-bridge/templates/issue-template.md` | Issue 생성 템플릿 |
| `skills/desktop-bridge/templates/comment-template.md` | 진행 코멘트 템플릿 |

---

### 상태 파일

```json
// .claude/desktop-bridge-state.json
{
  "project_name": "my-project",
  "github_repo": "owner/repo",
  "issue_number": 123,
  "issue_url": "https://github.com/owner/repo/issues/123",
  "mode": "implement",
  "screens": {
    "product-list": { "status": "completed", "synced": true },
    "cart": { "status": "in_progress", "synced": false }
  }
}
```

---

## [v1.8.0] - 2026-01-30

### SDD Tool + HyoDo 통합: Trinity, Reverse, Sync, Cost Router

> **외부 도구들의 핵심 기능을 Claude Labs에 통합하여 워크플로우 완성도 향상**

---

### 핵심 변경사항

```
┌─────────────────────────────────────────────────────────────────────┐
│  SDD Tool (JakeB-5/sdd-tool) + HyoDo (lofibrainwav/HyoDo) 통합      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  From HyoDo:                                                        │
│  ├── /trinity - 五柱(眞善美孝永) 철학 기반 코드 품질 평가           │
│  ├── /cost-router - AI 비용 40-70% 절감 라우팅                     │
│  ├── 4-Gate CI Protocol (Pyright → Ruff → pytest → SBOM)          │
│  └── 三 Strategists (장영실, 이순신, 신사임당)                      │
│                                                                     │
│  From SDD Tool:                                                     │
│  ├── /reverse - 기존 코드에서 명세 역추출                          │
│  ├── /sync - 명세-코드 동기화 검증                                 │
│  └── 드리프트 감지 알고리즘                                        │
│                                                                     │
│  통합 워크플로우:                                                   │
│  기존 코드 → /reverse → 명세 추출                                  │
│  개발 중간 → /sync → 동기화 검증                                   │
│  개발 완료 → /trinity → 품질 평가                                  │
│  실행 최적화 → /cost-router → 비용 절감                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 새로운 스킬 4개

| 스킬 | 출처 | 설명 |
|------|------|------|
| `/trinity` | HyoDo | 五柱(眞善美孝永) 철학 기반 코드 품질 평가, Trinity Score |
| `/reverse` | SDD Tool | 기존 코드에서 명세 역추출 (scan → extract → finalize) |
| `/sync` | SDD Tool | 명세-코드 동기화 검증, 드리프트 감지 |
| `/cost-router` | HyoDo | AI 비용 최적화 라우팅 (FREE/CHEAP/EXPENSIVE Tier) |

---

### /trinity - 五柱 코드 품질 평가

```
Trinity Score = 0.35×眞 + 0.35×善 + 0.20×美 + 0.08×孝 + 0.02×永

眞 (Truth)     35% - 타입 안전성, 테스트 커버리지
善 (Goodness)  35% - 보안, 안정성, 에러 처리
美 (Beauty)    20% - 코드 명확성, 문서화
孝 (Serenity)   8% - 유지보수성, 인지 부하
永 (Eternity)   2% - 장기 지속가능성
```

**4-Gate CI Protocol:**
```
Gate 1: Pyright/tsc (眞) → 타입 체크
Gate 2: Ruff/ESLint (美) → 린트 + 포맷
Gate 3: pytest/vitest (善) → 테스트 커버리지
Gate 4: SBOM (永) → 보안 씰
```

**三 Strategists:**
- 장영실 - 기술 아키텍처 (眞)
- 이순신 - 보안 & 안정성 (善)
- 신사임당 - UX & 명확성 (美)

---

### /reverse - 코드 → 명세 역추출

```bash
/reverse scan      # 프로젝트 구조 스캔
/reverse extract   # 명세 초안 추출
/reverse review    # 추출된 명세 리뷰
/reverse finalize  # 명세 확정 + 갭 분석
```

**추출 대상:**
- 도메인 리소스 (SQLAlchemy, Prisma, Django ORM)
- API 계약 (FastAPI, Express)
- 화면 명세 (React, Next.js, Vue)

**신뢰도 시스템:** 각 추출 항목에 0.0-1.0 신뢰도 부여

---

### /sync - 명세-코드 동기화 검증

```bash
/sync              # 전체 동기화 검증
/sync domain users # 특정 도메인 검증
/sync --fix        # 자동 수정 제안
/sync --ci --threshold 80  # CI 모드
```

**드리프트 유형:**
- 추가 드리프트: 코드에만 있고 명세에 없음
- 삭제 드리프트: 명세에만 있고 코드에 없음
- 수정 드리프트: 명세와 코드가 다름

---

### /cost-router - AI 비용 최적화

```
┌─────────────────────────────────────────┐
│  Tier Classification                     │
├─────────────────────────────────────────┤
│  FREE     - 읽기 전용, 검색     ($0)    │
│  CHEAP    - 단순 편집, 포맷팅   (haiku) │
│  EXPENSIVE - 새 기능, 리팩토링  (opus)  │
└─────────────────────────────────────────┘

절감 효과: 40-70% AI 비용 절감
```

**auto-orchestrate 연동:**
- 각 태스크 실행 전 복잡도 분석
- 적절한 Tier/모델 자동 선택
- 실시간 비용 모니터링

---

### 워크플로우 확장

```
기존:
/neurion → /socrates → /screen-spec → /tasks-generator → /auto-orchestrate

확장:
                                                          ↓
기존 프로젝트 시작 ──────────────────────────────→ /reverse
                                                          ↓
개발 중간 ────────────────────────────────────────→ /sync
                                                          ↓
Phase 완료 ───────────────────────────────────────→ /trinity
                                                          ↓
전체 실행 ────────────────────────────────────────→ /cost-router (자동)
```

---

### 새로운 파일

| 파일 | 내용 |
|------|------|
| `skills/trinity/SKILL.md` | 五柱 코드 품질 평가 |
| `skills/trinity/references/pillar-weights.md` | 가중치 조정 가이드 |
| `skills/reverse/SKILL.md` | 코드 → 명세 역추출 |
| `skills/reverse/references/extraction-rules.md` | 추출 규칙 |
| `skills/sync/SKILL.md` | 명세-코드 동기화 |
| `skills/sync/references/drift-detection.md` | 드리프트 감지 |
| `skills/cost-router/SKILL.md` | AI 비용 최적화 |
| `skills/cost-router/references/tier-classification.md` | Tier 분류 |

---

### 통합 출처

- **HyoDo**: https://github.com/lofibrainwav/HyoDo
- **SDD Tool**: https://github.com/JakeB-5/sdd-tool

---

## [v1.7.7] - 2026-01-29

### 🧠 Neurion 브레인스토밍 + Gemini MCP Node.js 전환

> **아이디어가 없어도 OK! AI와 함께 브레인스토밍 + Gemini MCP 안정화**

---

### ⚙️ Gemini MCP Node.js 전환 (중요!)

> **Rust 의존성 제거, Node.js 순수 구현으로 Windows/Mac/Linux 모두 안정 지원**

```
┌─────────────────────────────────────────────────────────────────┐
│  변경 전 (Rust):                                                │
│  ├── Rust + Cargo 필수 설치                                    │
│  ├── cargo build --release (1-2분 소요)                        │
│  └── Windows에서 빌드 실패 이슈                                │
│                                                                 │
│  변경 후 (Node.js):                                            │
│  ├── Node.js만 있으면 OK (이미 Claude Code에 필수)             │
│  ├── 빌드 없이 파일 복사만으로 설치                            │
│  └── 플랫폼 무관 동일 동작                                     │
│                                                                 │
│  ⚠️ OAuth 인증 유지: gemini CLI가 OAuth 담당 (API 키 사용 금지)  │
└─────────────────────────────────────────────────────────────────┘
```

| 항목 | Rust 버전 (이전) | Node.js 버전 (현재) |
|------|-----------------|---------------------|
| 의존성 | Rust + Cargo | Node.js (이미 설치됨) |
| 빌드 시간 | 1-2분 | 0초 (복사만) |
| 인증 | OAuth (gemini CLI) | OAuth (gemini CLI) |
| 바이너리 | gemini-mcp.exe | index.js |

**변경된 파일:**

| 파일 | 변경 내용 |
|------|----------|
| `install.ps1` | Rust 빌드 → Node.js 복사 방식 |
| `install.sh` | 동일하게 Node.js 방식으로 통일 |
| `mcp-servers/gemini-mcp/` | Node.js MCP 서버 (신규) |
| `CLAUDE.md` | Gemini OAuth 규칙 명시 (API 키 금지) |

**설치 흐름 (3단계):**
```
[1/3] gemini CLI 확인/설치 (npm install -g @google/gemini-cli)
[2/3] OAuth 인증 (브라우저에서 Google 로그인)
[3/3] MCP 서버 복사 & 등록
```

---

### 🧠 Neurion - AI 공동 브레인스토밍 스킬

> **아이디어가 없어도 OK! AI와 함께 브레인스토밍하여 기획안 생성**

---

### 핵심 변경사항

```
┌─────────────────────────────────────────────────────────────────┐
│  Neurion - AI + 사용자 공동 브레인스토밍                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  /neurion                                                        │
│       ↓                                                          │
│  Phase 0: 워밍업 (4 페르소나 소개)                               │
│  Phase 1: 자기 발견 (선택 - 아이디어 없을 때)                    │
│  Phase 2: 아이디어 폭발 (15-20개 아이디어!)                      │
│  Phase 3: 그룹핑 & 방향 선택                                     │
│  Phase 4: neurion-proposal.md 생성                               │
│       ↓                                                          │
│  /socrates (자동 감지하여 기획안 활용)                            │
│                                                                  │
│  특징:                                                           │
│  ├── Osborn 4원칙 (판단 금지, 양 중심, 엉뚱함 환영, 조합)       │
│  ├── 4 AI 페르소나 (🎯진행자 💡제안자 👏응원자 🔗연결자)         │
│  ├── SCAMPER 기법으로 아이디어 확장                              │
│  └── neurion-proposal.md → /socrates 자동 연동                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 새로운 스킬

| 스킬 | 설명 |
|------|------|
| `/neurion` | AI + 사용자 공동 브레인스토밍. Osborn 4원칙 기반, 비판 금지, 4명의 AI 페르소나 |

### 워크플로우 체인 확장

```
[백지 상태] → /neurion → /socrates → /screen-spec → /tasks-generator → ...
```

| 스킬 | 역할 | 차이 |
|------|------|------|
| `/eureka` | AI 혼자 내부 사고 | 사용자 개입 최소 |
| `/neurion` (NEW) | AI + 사용자 공동 창작 | 비판 금지, 긍정만 |
| `/socrates` | 사용자 인터뷰 | 검증/비판 포함 |

### Socrates 통합

- Phase 0에 `neurion-proposal.md` 자동 감지 로직 추가 (Step 0.5)
- 기획안의 핵심 기능/타겟 사용자를 사전 세팅하여 질문 효율화
- Socratic 검증은 그대로 수행 (기획안을 무조건 수용하지 않음)

### 문서 업데이트

- `workflow-chain.md`: /neurion 체인 추가, 데이터 흐름, TaskCreate 템플릿
- `workflow-overview.md`: 파이프라인 다이어그램에 /neurion 추가

---

## [v1.7.6] - 2026-01-29

### 🧪 Claude Labs 브랜딩 + Eureka 아이디에이션 + PowerQA 자동 QA 사이클링 + Stitch MCP 인스톨러 개선

> **프로젝트명 변경: "Claude Code Skills Pack" → "Claude Labs"**
> 바이브랩스 채널과 일관된 브랜딩으로 통일

---

### 브랜딩 변경

| 항목 | 이전 | 이후 |
|------|------|------|
| 프로젝트명 | Claude Code Skills Pack | **Claude Labs** |
| 슬로건 | AI 코딩 에이전트를 위한 스킬 & 헌법 모음 | **아이디어만으로 풀스택 웹앱을 완성하는 AI 개발 파트너** |
| ZIP 파일 | claude-skills-v*.zip | **claude-labs-v*.zip** |

---

### Eureka 아이디에이션 + PowerQA 자동 QA 사이클링

> **추상적 아이디어 → AI 재귀적 사고 → 3-4개 구체적 MVP 제안 → 자동 개발 진행**

---

### 핵심 변경사항

```
┌─────────────────────────────────────────────────────────────────┐
│  Eureka - AI 재귀적 사고 기반 아이디에이션                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  /eureka "여행 일정 공유 서비스"                                │
│       ↓                                                         │
│  AI 재귀적 사고 (Expand → Research → Evolve → Validate)        │
│       ↓                                                         │
│  3-4개 구체적 MVP 제안 카드 (⭐ MVP 추천 포함)                  │
│       ↓                                                         │
│  사용자 선택 → /screen-spec → /tasks-generator 자동 진행       │
│                                                                 │
│  특징:                                                          │
│  ├── WebSearch로 실시간 시장 조사                               │
│  ├── 기존 솔루션 분석 및 차별점 도출                            │
│  ├── 복잡도 기반 MVP 추천                                       │
│  └── 선택 후 개발 파이프라인 자동 연결                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  PowerQA - 자동 QA 사이클링 워크플로우                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  /powerqa --tests    → 테스트 통과까지 자동 수정                │
│  /powerqa --build    → 빌드 성공까지 자동 수정                  │
│  /powerqa --lint     → 린트 에러 0까지 자동 수정                │
│  /powerqa --all      → 전부 통과까지 자동 수정                  │
│                                                                 │
│  특징:                                                          │
│  ├── 최대 5사이클 (무한루프 방지)                               │
│  ├── 동일 실패 3회 시 조기 종료                                 │
│  ├── 언어/프레임워크 자동 감지                                  │
│  └── 기존 specialist 에이전트 활용                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 새로운 스킬

| 스킬 | 설명 |
|------|------|
| `/eureka` | AI 재귀적 사고로 추상적 아이디어를 구체적 MVP 제안으로 변환 |
| `/powerqa` | 자동 QA 사이클링 - 테스트, 빌드, 린트, 타입체크 자동화 |

### screen-spec 자동 모드

| 기능 | 설명 |
|------|------|
| 자동 모드 (기본) | 중간 질문 없이 전체 프로세스 완료 |
| 대화형 모드 | `--interactive` 플래그로 각 단계 확인 |

### tasks-generator 워크플로우 연결 (버그 수정)

| 수정 | 설명 |
|------|------|
| 다음 단계 제안 추가 | TASKS.md 생성 후 `/project-bootstrap` 또는 `/auto-orchestrate` 선택 제안 |
| 권장 워크플로우 명시 | `/socrates` → `/screen-spec` → `/tasks-generator` → `/project-bootstrap` → `/auto-orchestrate` |

### 스킬 슬림화 (Skill Slimming)

> **SKILL.md 파일 크기를 60-70% 감소시켜 Claude가 워크플로우 연결을 놓치지 않도록 개선**

| 스킬 | 변경 전 | 변경 후 | 감소율 |
|------|---------|---------|--------|
| `socrates` | 849줄 | 178줄 | **79%** |
| `screen-spec` | 408줄 | 162줄 | **60%** |
| `tasks-generator` | 436줄 | 151줄 | **65%** |
| `project-bootstrap` | 580줄 | 166줄 | **71%** |

**슬림화 전략:**
- SKILL.md: 워크플로우 개요 + 핵심 원칙 + 다음 단계만 유지
- 상세 내용: `references/phase-details.md`로 분리
- 워크플로우 허브: `.claude/docs/workflow-chain.md` 신규 생성

### 새로운 파일

| 파일 | 내용 |
|------|------|
| `docs/workflow-chain.md` | 스킬 간 워크플로우 연결 허브 |
| `skills/socrates/references/phase-details.md` | Phase별 상세 가이드 (분리) |
| `skills/screen-spec/references/phase-details.md` | Phase별 상세 가이드 (분리) |
| `skills/tasks-generator/references/phase-details.md` | Phase별 상세 가이드 (분리) |
| `skills/project-bootstrap/references/phase-details.md` | 단계별 상세 가이드 (분리) |
| `skills/eureka/SKILL.md` | Eureka 아이디에이션 메인 스킬 |
| `skills/eureka/references/thinking-process.md` | 재귀적 사고 프로세스 상세 |
| `skills/eureka/references/proposal-template.md` | 제안 카드 템플릿 및 출력 포맷 |
| `skills/powerqa/SKILL.md` | PowerQA 메인 스킬 |
| `skills/powerqa/references/verification-commands.md` | 언어별 검증 명령어 |
| `skills/powerqa/references/error-patterns.md` | 에러 패턴 매핑 |

---

### Stitch MCP 인스톨러 워크플로우 개선

> **3단계 가이드로 Stitch MCP 설정 완전 자동화 (Mac/Windows 모두 지원)**

```
┌─────────────────────────────────────────────────────────────────┐
│  기존: API Key만 입력 → Stitch MCP 연결 실패                    │
│  개선: 5단계 워크플로우 → 완벽한 설정 가이드                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Step 5-1: GCP 프로젝트 ID 입력                                │
│     → console.cloud.google.com 링크 안내                       │
│                                                                 │
│  Step 5-2: gcloud CLI 설치 + ADC 인증                          │
│     → Mac: brew install google-cloud-sdk                       │
│     → Windows: winget install Google.CloudSDK                  │
│     → gcloud auth application-default login 실행               │
│                                                                 │
│  Step 5-3: Stitch API 활성화 (NEW!)                            │
│     → gcloud beta services mcp enable stitch.googleapis.com    │
│                                                                 │
│  Step 5-4: IAM 권한 부여 (NEW!)                                │
│     → roles/serviceusage.serviceUsageConsumer 자동 부여        │
│                                                                 │
│  Step 5-5: Stitch API Key 입력 (선택)                          │
│     → stitch.withgoogle.com/settings 링크 안내                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**변경된 파일:**

| 파일 | 변경 내용 |
|------|----------|
| `install.sh` | 3단계 Stitch MCP 워크플로우 + gcloud 자동 설치 (Mac/Linux) |
| `install.ps1` | 3단계 Stitch MCP 워크플로우 + winget/choco gcloud 설치 (Windows) |

**해결된 문제:**

| 문제 | 해결 |
|------|------|
| API Key만으로 Stitch 연결 안 됨 | GCP Project ID + ADC 인증 추가 |
| gcloud 미설치 시 인증 실패 | 자동 설치 가이드 추가 |
| 설정 과정 불명확 | 단계별 안내 메시지 추가 |

**MCP 설정 결과:**

```json
"stitch": {
  "command": "npx",
  "args": ["-y", "stitch-mcp"],
  "env": {
    "GOOGLE_CLOUD_PROJECT": "your-project-id",
    "STITCH_API_KEY": "your-api-key"
  }
}
```

---

## [v1.7.5] - 2026-01-26

### 소크라테스 개인화 기능 강화

> **사용자 프로필 시스템 도입으로 반복 질문 제거**

---

### 핵심 변경사항

```
┌─────────────────────────────────────────────────────────────────┐
│  문제: 매 세션마다 레벨 측정 질문(3개) 반복 → 사용자 피로감     │
│  해결: 사용자 프로필 시스템으로 학습 정보 영속화                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Before:                                                        │
│  ❌ 매번 "프로그래밍 경험이 있으신가요?" 질문                   │
│  ❌ 매번 "기획 경험은요?" 질문                                  │
│  ❌ 사용자 정보가 세션 간 유지되지 않음                         │
│                                                                 │
│  After:                                                         │
│  ✅ 첫 세션에서 레벨 측정 → 프로필 저장                         │
│  ✅ 다음 세션부터 "다시 만나서 반가워요!" 인사                  │
│  ✅ 레벨 재측정은 사용자 요청 시에만                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 새로운 기능

| 기능 | 설명 |
|------|------|
| `user-profile.md` | 사용자 레벨, 선호, 히스토리 저장 |
| 기존 사용자 인식 | 프로필 확인 후 레벨 측정 스킵 |
| 레벨 재측정 옵션 | 사용자가 원할 때만 재측정 |
| 프로젝트 히스토리 | 이전 프로젝트 기록 및 이어하기 |

---

### 사용자 프로필 구조

```markdown
.claude/memory/user-profile.md

# User Profile

## 기본 정보
| 항목 | 값 |
|------|-----|
| 사용자명 | 철수 |
| 첫 만남 | 2026-01-15 |
| 마지막 세션 | 2026-01-27 |

## 레벨 정보
| 항목 | 점수 | 선택 |
|------|------|------|
| IT 경험 | 2 | 조금 경험 |
| 기획 경험 | 1 | 처음이에요 |
| 동기 명확성 | 3 | 꽤 명확해요 |
| **레벨** | L2 | 일반인 |

## 히스토리
| 날짜 | 프로젝트 | 상태 |
|------|----------|------|
| 2026-01-15 | 가계부 앱 | 완료 |
```

---

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `socrates/SKILL.md` | Phase 0에 프로필 확인 로직 추가 |
| `socrates/references/level-assessment.md` | 프로필 시스템 전체 명세 |
| `socrates/references/conversation-rules.md` | v2.1 - 개인화 규칙 추가 |
| `memory/SKILL.md` | user-profile.md 구조 추가 |
| `memory/references/templates.md` | user-profile.md 템플릿 추가 |

---

### 워크플로우 변경

```
Before:
/socrates 시작 → 레벨 측정 (3개 질문) → 기획 시작

After:
/socrates 시작
    ↓
┌─────────────────────────────┐
│ .claude/memory/user-profile.md │
│ 존재 + 레벨 유효?            │
└─────────────────────────────┘
    ↓ Yes              ↓ No
"다시 만나서        레벨 측정 (3개 질문)
반가워요!"              ↓
    ↓               프로필 저장
바로 기획 시작          ↓
                   기획 시작
```

---

## [v1.7.5] - 2026-01-26

### 화면 중심 태스크 구조 + Constitutions 시스템 + TUI 인스톨러

> **vibeShop 실패 사례를 기반으로 연결점 검증 강화, 프레임워크별 헌법 추가, 인터랙티브 설치 지원**

---

### 핵심 변경사항

```
┌─────────────────────────────────────────────────────────────────┐
│  문제: 각 파트는 개별 작동하지만, 파트 간 연결점 검증 안 됨     │
│  해결: 화면 중심 태스크 구조 + 연결점 검증 태스크 자동 생성     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  프런트엔드 디지안 적용 실패 사례:                                      │
│  ❌ Auth 불일치: NextAuth + Supabase Auth 혼용 → 500 에러       │
│  ❌ Seed-Schema 불일치: UUID 형식 오류 → Zod 검증 실패          │
│  ❌ Link-Page 불일치: Footer 13개 링크, 0개 페이지 구현         │
│                                                                 │
│  해결책:                                                        │
│  ✅ 화면 단위 태스크: Frontend + Backend + Integration 묶음     │
│  ✅ 연결점 검증 태스크: API/네비게이션/Auth/타입 자동 검증      │
│  ✅ Constitutions: 프레임워크별 필수 규칙 위반 사전 방지        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 새로운 스킬

| 스킬 | 설명 |
|------|------|
| `/screen-spec` | 화면별 상세 명세(YAML) 생성 - 컴포넌트, API, 연결점 정의 + **Stitch MCP 연동** |

---

### Google Stitch MCP 연동 (NEW!)

> YAML 화면 명세에서 AI 디자인 목업을 자동 생성

**주요 기능:**

| 도구 | 설명 |
|------|------|
| `generate_screen_from_text` | YAML → Stitch 프롬프트 → 디자인 생성 |
| `fetch_screen_image` | PNG 목업 이미지 추출 |
| `fetch_screen_code` | HTML/CSS 코드 추출 |
| `analyze_accessibility` | WCAG 2.1 접근성 검사 |
| `generate_design_tokens` | 디자인 토큰 자동 생성 (CSS/Tailwind) |

**워크플로우:**

```
/screen-spec Phase 5: Stitch 디자인 생성 (선택)
    ↓
1️⃣ YAML → Stitch 프롬프트 변환
2️⃣ 디자인 목업 자동 생성
3️⃣ 결과 추출 (PNG, HTML, 토큰)
4️⃣ YAML에 design_reference 추가
    ↓
design/screens/*.png     (목업 이미지)
design/html/*.html       (HTML 코드)
specs/design-tokens.yaml (디자인 토큰)
```

**새로운 Reference 파일:**

| 파일 | 설명 |
|------|------|
| `stitch-prompt-builder.md` | YAML → Stitch 프롬프트 변환 규칙 |
| `stitch-integration.md` | MCP 도구 호출 가이드 |

**인스톨러 업데이트:**

- `install.sh` - Stitch MCP npm 설치 + gcloud 인증 설정
- `install.ps1` - Windows용 Stitch MCP 설정

---

### 개선된 스킬

| 스킬 | 변경 내용 |
|------|----------|
| `/socrates` | 화면 중심 기획 + **레벨별 기술 스택 제안** (Phase 2.5 추가) |
| `/tasks-generator` | 화면 단위 태스크 + 연결점 검증(P-S-V) 태스크 자동 생성 |

---

### 레벨별 기술 스택 제안 (NEW!)

사용자 레벨에 따라 기술 스택 결정 방식이 달라집니다:

| 레벨 | 전략 | 설명 |
|------|------|------|
| **L1** | 자동 제안 | AI가 선택, 확인만 요청 |
| **L2** | 추천 + Yes/No | AI 추천 + 간단한 동의 |
| **L3** | 선택지 제공 | 3-4개 옵션 + 장단점 |
| **L4** | 트레이드오프 | 질문으로 시작, 자유 선택 |

**참조 파일:** `socrates/references/tech-stack-recommendation.md`

---

### TUI 인터랙티브 인스톨러 (NEW!)

Mac/Linux와 Windows를 위한 인터랙티브 설치 스크립트:

```bash
# Mac/Linux
./install.sh

# Windows PowerShell
.\install.ps1
```

**기능:**
- 스킬 카테고리 선택 설치 (Core, Orchestration, Quality 등)
- 프레임워크 헌법 선택 설치 (FastAPI, Next.js, Supabase, Tailwind)
- Slack 웹훅 자동 설정
- Gemini MCP OAuth 인증 + 자동 빌드
- `/socrates` 시작 가이드

**설치 방법 3가지:**
1. TUI 인스톨러 실행
2. Claude Code에게 "이거 설치해줘" 요청
3. 수동 복사 (`rsync` 또는 `Copy-Item`)

---

### 새로운 문서

| 문서 | 설명 |
|------|------|
| `.claude/docs/workflow-overview.md` | 전체 워크플로우 작동 체계 문서 |
| `.claude/docs/design-philosophy.md` | Screen-First, Domain-Guarded 설계 철학 |

---

### 새로운 폴더: `.claude/constitutions/`

프레임워크별 필수 규칙(헌법)을 정의하여 반복되는 실수 방지:

```
.claude/constitutions/
├── README.md
├── nextjs/
│   ├── auth.md              # NextAuth.js 단일 인증 레이어
│   └── api-routes.md        # App Router API 규칙
├── supabase/
│   ├── rls.md               # Row Level Security 필수
│   └── auth-integration.md  # 외부 Auth와 통합 시 규칙
├── fastapi/
│   ├── auth.md              # JWT + OAuth2 패턴
│   └── dependencies.md      # Dependency Injection 규칙
└── common/
    ├── uuid.md              # RFC 4122 UUID 준수
    └── seed-validation.md   # Seed ↔ Schema 일치 검증
```

---

### 새로운 파이프라인

```
/socrates → 06-screens.md (화면 중심 기획)
    ↓
/screen-spec → specs/screens/*.yaml (화면별 상세 명세)
    ↓
[선택] Stitch MCP → design/screens/*.png, design/html/*.html
    ↓
/tasks-generator → TASKS.md (화면 단위 태스크 + 검증)
    ↓
/auto-orchestrate → 실행
```

---

### 연결점 검증 유형

| 유형 | 검증 내용 |
|------|----------|
| API 연결 | 엔드포인트 존재, 응답 타입 일치 |
| 네비게이션 | 타겟 라우트 존재, 파라미터 전달 |
| Auth | 인증 라이브러리 일관성 (하나만 사용) |
| 데이터 타입 | TypeScript ↔ Zod ↔ 시드 일치 |
| 공통 컴포넌트 | Header/Footer 렌더링, 내부 링크 유효성 |

---

## [v1.7.4] - 2026-01-25

### Ultra-Thin 모드 무중단 실행 수정

> **`--ultra-thin` 모드에서 Phase 완료 시 사용자에게 묻지 않고 끝까지 자동 실행**

---

### 핵심 변경사항

```
┌─────────────────────────────────────────────────────────────────┐
│  문제: Ultra-Thin 모드에서도 Phase 완료 시 AskUserQuestion 호출 │
│  수정: Ultra-Thin은 ALL_DONE까지 무중단 실행                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ❌ 수정 전: Phase 완료 → "다음 Phase 할까요?" 질문             │
│  ✅ 수정 후: Phase 완료 → 바로 다음 Phase 시작 (질문 없음)      │
│                                                                 │
│  Ultra-Thin의 핵심: 200개 태스크도 컴팩팅 없이 자동 완료!       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `auto-orchestrate/SKILL.md` | 모드별 분기 (일반 vs Ultra-Thin) |
| `ultra-thin-orchestrate/SKILL.md` | AskUserQuestion 금지 규칙 명시 |

---

## [v1.7.3] - 2026-01-24

### 소크라테스 스킬 강화: SocratiQ + Roast Me 모드

> **논문 기반 질문 유형 확장 + 직설적 도전 모드 추가**

---

### 핵심 변경사항

```
┌─────────────────────────────────────────────────────────────────┐
│  기존: 3가지 기법 (아이러니, 산파술, 논박)                        │
│  변경: 6가지 질문 유형 + Roast Me 모드                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  + 근거 탐색: "그걸 어떻게 아세요?"                              │
│  + 결과 탐색: "그렇다면 어떤 결과가?"                            │
│  + 대안적 관점: "다른 시각에서 보면?"                            │
│  + 🔥 Roast Me: "솔직히 말할게요..."                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 1. SocratiQ 확장 (논문 기반)

> 출처: [Socratic-Tutoring-LLM](https://arxiv.org/html/2409.05511v1)

| # | 유형 | 핵심 | 사용 시점 |
|---|------|------|----------|
| 1 | 아이러니 | 확신 흔들기 | 확신에 찰 때 |
| 2 | 산파술 | 지식 끌어내기 | 모호할 때 |
| 3 | 논박 | 모순 드러내기 | 모순 발견 시 |
| 4 | **근거 탐색** | 증거 요구 | 추측할 때 |
| 5 | **결과 탐색** | 귀결 추적 | 결과를 못 볼 때 |
| 6 | **대안적 관점** | 시야 확장 | 시야가 좁을 때 |

### 2. Roast Me 모드 추가

**활성화 방법:**
```
/socrates Roast me
/socrates 솔직하게 말해줘
/socrates 봐주지 마
```

**톤 변화:**
| 일반 모드 | Roast 모드 |
|----------|-----------|
| "흥미롭네요" | "그래서요?" |
| "좋은 생각이에요" | (칭찬 없음) |
| "모순이 있는 것 같아요" | "말이 안 맞잖아요" |

### 3. 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `socrates/SKILL.md` | 6가지 질문 유형 테이블, Roast Me 모드 섹션 추가 |
| `socrates/references/socratic-method.md` | SocratiQ 확장, Roast Me 상세 패턴 추가 |

---

## [v1.7.0] - 2026-01-21

### Ultra-Thin Orchestrate 모드 추가

> **200개 태스크도 오토 컴팩팅 없이 처리!** 메인 에이전트 컨텍스트 76% 절감

---

### 핵심 변경사항

```
┌─────────────────────────────────────────────────────────────────┐
│  기존 방식: 50개 태스크 → 컨텍스트 포화 → /compact 필요         │
│  Ultra-Thin: 200개 태스크 → 38K 토큰만 사용 → 컴팩팅 불필요     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  절감율: 76% (태스크당 3,200 토큰 → 190 토큰)                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 1. 새로운 에이전트 2개 추가

| 에이전트 | 역할 | 모델 |
|----------|------|------|
| `task-executor` | 개별 Task 완전 자율 수행, 10회 자동 재시도 | sonnet |
| `dependency-resolver` | TASKS.md 파싱, 의존성 분석, 실행 가능 Task 계산 | haiku |

### 2. 새로운 스킬 추가

| 스킬 | 파일 |
|------|------|
| `ultra-thin-orchestrate` | `.claude/skills/ultra-thin-orchestrate/SKILL.md` |
| 상태 파일 스키마 | `references/state-schema.md` |
| 통신 프로토콜 | `references/protocol.md` |

### 3. 기존 스킬 수정 (최소 변경)

| 파일 | 변경 내용 |
|------|----------|
| `auto-orchestrate/SKILL.md` | `--ultra-thin` 옵션 추가, Ultra-Thin 섹션 추가 |
| `commands/orchestrate.md` | Ultra-Thin 모드 선택 옵션 추가 |

### 4. CLI 옵션

```bash
# 기본 Ultra-Thin 실행
/auto-orchestrate --ultra-thin

# 특정 Phase만 실행
/auto-orchestrate --ultra-thin --phase 2

# 중단 후 재개
/auto-orchestrate --ultra-thin --resume

# 최대 병렬 실행 수 제한
/auto-orchestrate --ultra-thin --parallel 3
```

### 5. 통신 프로토콜 (컨텍스트 절약 핵심)

```
요청: "TASK_ID:T1.3" (15자)
응답: "DONE:T1.3" (10자)

vs 일반 모드:
요청: 2,000+ 토큰 상세 프롬프트
응답: 1,000+ 토큰 상세 보고

→ 99% 절감!
```

### 6. 모드 선택 가이드

| Task 수 | 권장 모드 | 명령어 |
|---------|----------|--------|
| 1-30개 | 일반 모드 | `/auto-orchestrate` |
| 30-50개 | RALPH 모드 | `/auto-orchestrate --ralph` |
| **50-200개** | **Ultra-Thin** | `/auto-orchestrate --ultra-thin` |
| 200개+ | Ultra-Thin + 분할 | `--ultra-thin --phase N` |

### 7. 호환성

```
✅ 기존 전문가 에이전트 7개 → 변경 없음
✅ 기존 TASKS.md 형식 → 그대로 사용
✅ 기존 /auto-orchestrate → 여전히 동작
🆕 --ultra-thin 옵션 → 새 모드 활성화
```

### 8. 파일 구조

```
.claude/
├── agents/
│   ├── task-executor.md       (NEW)
│   └── dependency-resolver.md (NEW)
├── skills/
│   ├── ultra-thin-orchestrate/
│   │   ├── SKILL.md           (NEW)
│   │   └── references/
│   │       ├── state-schema.md (NEW)
│   │       └── protocol.md     (NEW)
│   └── auto-orchestrate/
│       └── SKILL.md           (--ultra-thin 옵션 추가)
├── commands/
│   └── orchestrate.md         (Ultra-Thin 선택 추가)
└── docs/
    └── ULTRA_THIN_USER_MANUAL.md (NEW)
```

### 9. 사용자 매뉴얼

상세 사용법은 `docs/ULTRA_THIN_USER_MANUAL.md` 참조

---

## [v1.6.9] - 2026-01-20

### Demo-Driven Development (DDD) 통합

> 프론트엔드 태스크마다 데모 페이지를 필수화하고, 스크린샷 검증을 통과해야 태스크 완료로 인정

---

### 변경 전 → 변경 후

```
❌ 이전: TDD 통과 ✅ → 빌드 성공 ✅ → 실제 화면? 없음
✅ 현재: TDD 통과 ✅ → 데모 페이지 ✅ → 스크린샷 검증 ✅ → 완료
```

---

### 1. tasks-rules.md

**프론트엔드 태스크 템플릿 확장:**

| 필드 | 설명 | 필수 |
|------|------|------|
| 담당 | frontend-specialist | ✅ |
| 파일 | 테스트 → 구현 경로 | ✅ |
| 스펙 | 구현할 기능 요약 | ✅ |
| **데모** | 데모 페이지 경로 | ✅ 신규 |
| **데모 상태** | 테스트할 상태 목록 | ✅ 신규 |

**체크리스트에 DDD 항목 추가** (섹션 6)

---

### 2. frontend-specialist.md

**📺 데모 페이지 생성 (필수!)** 섹션 추가:

- 데모 페이지 필수 요소 (상태 선택기, 렌더링, 상태 정보)
- 데모 페이지 템플릿 (TSX)
- 데모 폴더 구조
- 체크리스트

---

### 3. auto-orchestrate/SKILL.md

**3-B단계: 스크린샷 검증** 추가:

```
UI 태스크 완료 (테스트 통과)
    ↓
1️⃣ 데모 페이지 존재 확인
2️⃣ 개발 서버 확인
3️⃣ Chrome 스크린샷 검증 (상태별)
4️⃣ 검증 결과 판정
```

**Demo Reflection 루프** (Ralph Wiggum 스타일):
- Critique → Identify → Improve → Re-verify
- 동일 에러 3회 연속 시 중단

---

### 4. chrome-browser/SKILL.md

**📺 데모 페이지 스크린샷 검증** 섹션 추가:

- 검증 워크플로우
- 검증 기준 (렌더링, 레이아웃, 콘솔)
- MCP 도구 호출 순서
- 실패 시 행동

---

### 예상 효과

| Before | After |
|--------|-------|
| TDD만 통과하면 완료 | TDD + 실제 렌더링 확인 |
| 마지막에 빈 화면 발견 | Phase마다 동작 확인 |
| 컴포넌트 문서 없음 | 데모 페이지 = 살아있는 문서 |
| 수동 UI 테스트 | 자동 스크린샷 검증 |

---

## [v1.6.8] - 2026-01-18

### RALPH 루프, Gemini MCP Rust 서버, 슬랙 웹훅 통합

> Geoffrey Huntley의 RALPH 패턴 도입, Gemini MCP 고성능 구현, 슬랙 웹훅 JSON 통합

---

### 0. Gemini MCP Rust 서버 (신규!)

**고성능 Rust 기반 Gemini MCP 서버 추가**

| 항목 | Node.js MCP | Rust MCP |
|------|-------------|----------|
| 바이너리 크기 | ~50MB | **1.0MB** |
| 시작 시간 | ~500ms | **~10ms** |
| 메모리 사용 | ~50-100MB | **~5-10MB** |

**주요 변경:**
- `gemini-mcp-rs/` - Rust MCP 서버 구현
- `--yolo` 플래그로 비대화형 모드 지원
- 모델: `gemini-3-pro-preview` (Context7로 확인)
- `setup_mcp.py` 플랫폼별 자동 감지 (macOS/Windows/Linux)

**빌드:**
```bash
cd gemini-mcp-rs && cargo build --release
```

---

### 1. RALPH 루프 개선 (공식 플러그인 방식!)

**이전 → 현재:**
```
❌ 이전: 3회 실패 → 건너뛰기 → 미완료 태스크 누적
✅ 현재: 50회까지 반복 → 완료될 때까지 → 대부분 완료!
```

**새 CLI 옵션:**
```bash
/auto-orchestrate --ralph --max-iterations 50 --completion-promise "TASK_DONE"
```

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--max-iterations` | 50 | 최대 반복 횟수 |
| `--completion-promise` | "TASK_DONE" | 완료 신호 텍스트 |

**핵심 메커니즘 (공식 Ralph Wiggum 방식):**
- 이전 출력 → 다음 입력에 포함 (자기 참조)
- AI가 자신의 에러를 읽고 자동 수정
- 완료 신호 나올 때까지 끝까지 반복

---

### 1-1. RALPH 핵심 원칙 (기존)

| 파일 | 변경 내용 |
|------|----------|
| **auto-orchestrate/SKILL.md** | RALPH 패턴 전체 구현 |
| **commands/orchestrate.md** | RALPH 모드 옵션 추가 |

```
┌─────────────────────────────────────────────────────────────────┐
│  RALPH = 매 반복마다 깨끗한 컨텍스트 + 학습 전달                  │
├─────────────────────────────────────────────────────────────────┤
│  1. 단일 태스크 집중: 한 번에 하나의 스토리만 구현               │
│  2. 깨끗한 컨텍스트: 태스크 완료 후 /compact 또는 새 세션       │
│  3. 학습 전달: progress.txt로 이전 반복의 교훈 전달             │
│  4. 상태 추적: TASKS.md [x] 체크 + orchestrate-state.json      │
│  5. 즉각적 검증: 테스트/타입체크 통과해야 커밋                   │
└─────────────────────────────────────────────────────────────────┘
```

**CLI 옵션:**
```bash
/auto-orchestrate --ralph    # RALPH 모드 (태스크별 컴팩팅)
/auto-orchestrate            # 일반 모드 (Phase 단위)
```

### 1-2. 슬랙 웹훅 저장 통합

**변경 사항:**
- 슬랙 웹훅 URL을 `.claude/orchestrate-state.json`에 JSON으로 저장
- 기존 `.claude/slack-webhook-url.txt` 방식 제거

**영향 스킬:**
| 스킬 | 변경 내용 |
|------|----------|
| `socrates` | URL 입력 시 orchestrate-state.json에 저장 |
| `auto-orchestrate` | orchestrate-state.json의 slack_webhook_url 필드에서 읽기 |

**JSON 형식:**
```json
{
  "project": "my-project",
  "slack_webhook_url": "https://hooks.slack.com/services/...",
  "completed_tasks": [...],
  ...
}
```

**해결된 문제:**
- 소크라테스에서 받은 URL이 auto-orchestrate로 전달되지 않던 버그 수정
- 세션 간 슬랙 알림 설정 유지

---

### 2. 대용량 스킬 토큰 최적화

| 스킬 | 이전 | 이후 | 절감률 |
|------|------|------|--------|
| **fastapi-latest** | 64K words | ~500 words | **99%** |
| **react-19** | 16K words | ~500 words | **97%** |

**방법**: 핵심 패턴만 유지 + Context7 MCP로 상세 문서 조회

```
mcp__context7__query-docs({
  libraryId: "/tiangolo/fastapi",  # 또는 "/facebook/react"
  query: "{구체적인 질문}"
})
```

### 3. tasks-generator 6종 문서 레퍼런스 복구

| 추가 섹션 | 파일 |
|----------|------|
| **0. 6종 기획 문서 참조 (필수!)** | tasks-rules.md |
| **🔴 문서 기반 모드** | SKILL.md |

```
Step 1: 모든 기획 문서 읽기
─────────────────────────────────
Read("01-prd.md")       → 기능 목록, 우선순위
Read("02-trd.md")       → 기술 스택, API 설계
Read("03-user-flow.md") → 마일스톤, 의존성
Read("04-database.md")  → DB 태스크
Read("05-design.md")    → UI 태스크
Read("06-convention.md")→ 코딩 규칙
```

### 4. 중복 스킬 정리

| 제거 | 이유 |
|------|------|
| `skills/orchestrate/` | `commands/orchestrate.md`와 중복 |

### 5. progress.txt 학습 전달 시스템

```markdown
# .claude/progress.txt

## 2026-01-18 10:30 - T0.1 완료
- SQLAlchemy async: expire_on_commit=False 필수
- Alembic 마이그레이션 후 서버 재시작 필요

## 2026-01-18 11:15 - T1.1 완료
- JWT 토큰: HttpOnly 쿠키로 저장
- Refresh 토큰 race condition 주의
```

### 6. 파일 구조

```
.claude/
├── skills/
│   ├── fastapi-latest/SKILL.md  (간소화됨)
│   ├── react-19/SKILL.md        (간소화됨)
│   ├── auto-orchestrate/SKILL.md (RALPH 추가)
│   └── tasks-generator/
│       ├── SKILL.md             (6종 문서 참조 추가)
│       └── references/tasks-rules.md
├── commands/
│   └── orchestrate.md           (RALPH 옵션 추가)
└── progress.txt                 (NEW - 학습 전달용)
```

---

## [v1.6.7] - 2026-01-18

### 슬랙 웹훅 파일 기반 저장

> 환경변수 의존성 제거, 파일 기반으로 전환

| 변경 | 내용 |
|------|------|
| 웹훅 URL 저장 | `.claude/slack-webhook-url.txt` 파일 |
| 읽기 방식 | `Read()` → Bash curl에서 직접 사용 |

---

## [v1.6.6] - 2026-01-18

### Superpowers 기반 품질 강화 업데이트

> obra/superpowers 프로젝트 분석 후 핵심 패턴 도입

---

### 1. 새로운 스킬 3개 추가

| 스킬 | 명령어 | 설명 |
|------|--------|------|
| **Systematic Debugging** | `/systematic-debugging` | 4단계 근본 원인 분석 기반 체계적 디버깅 |
| **Verification Before Completion** | 자동 | 완료 주장 전 증거 기반 검증 필수화 |
| **Code Review** | `/code-review` | 2단계 리뷰 시스템 (Spec Compliance → Code Quality) |

### 2. Systematic Debugging 스킬

```
┌─────────────────────────────────────────────────────────────┐
│  ⛔ 철칙: 근본 원인 조사 없이 수정 금지                       │
│                                                              │
│  Phase 1: Root Cause Investigation (근본 원인 조사)         │
│  Phase 2: Pattern Analysis (패턴 분석)                      │
│  Phase 3: Hypothesis Testing (가설 검증)                    │
│  Phase 4: Implementation (구현)                             │
│                                                              │
│  📁 references/root-cause-tracing.md - 역방향 추적 기법     │
│  📁 references/defense-in-depth.md - 4레이어 검증 패턴      │
└─────────────────────────────────────────────────────────────┘
```

### 3. Verification Before Completion 스킬

```
⛔ 새로운 검증 증거 없이 완료 주장 금지

Gate Function:
1. IDENTIFY: 증명 명령어 식별
2. RUN: 전체 명령어 실행
3. READ: 출력, exit code 확인
4. VERIFY: 주장 확인 여부 판정
5. ONLY THEN: 주장하기
```

### 4. Code Review 스킬 (2단계 리뷰 시스템)

```
Stage 1: Spec Compliance Review
├── 요구사항 일치 확인
├── 누락 기능 검사
└── YAGNI 위반 검사

Stage 2: Code Quality Review
├── SOLID 원칙
├── 코드 품질
├── 에러 처리
├── 테스트 커버리지
└── 보안 취약점

이슈 심각도: Critical / Important / Minor
```

### 5. 에이전트 강화

| 에이전트 | 추가 내용 |
|---------|----------|
| **test-specialist** | TDD Anti-Rationalization 패턴 - "너무 단순해서", "나중에" 등 변명 방지 |
| **security-specialist** | Defense-in-Depth 4레이어 검증 패턴 추가 |

### 6. Auto-Orchestrate 강화

```
Phase 완료 → 품질 게이트 통과 → Two-Stage Code Review → main 병합

새로운 4-2단계 추가:
├── Stage 1: Spec Compliance Review
├── Stage 2: Code Quality Review
├── Critical/Important 이슈 → Reflection 루프로 자동 수정
└── 통과 시 main 병합
```

### 7. 파일 구조

```
.claude/
├── skills/
│   ├── systematic-debugging/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── root-cause-tracing.md
│   │       └── defense-in-depth.md
│   ├── verification-before-completion/
│   │   └── SKILL.md
│   ├── code-review/
│   │   ├── SKILL.md
│   │   └── references/
│   │       └── review-checklist.md
│   └── auto-orchestrate/
│       └── SKILL.md (Two-Stage Review 추가)
├── agents/
│   ├── test-specialist.md (TDD Anti-Rationalization 추가)
│   └── security-specialist.md (Defense-in-Depth 추가)
```

---

## [v1.6.5] - 2026-01-18

### Socrates 스킬 대규모 업그레이드

> "망하는 기획 4가지 요건" 검증 시스템 추가로 기획 품질 향상

---

### 1. 새로운 Reference 파일

| 파일 | 내용 |
|------|------|
| `failing-planning-checklist.md` | 망하는 기획 4가지 요건 체크리스트 |

### 2. SKILL.md 추가 내용

| 기능 | 설명 |
|------|------|
| 벤치마킹 질문 영역 | 유사 서비스 분석 강제 |
| 검증 질문 영역 | 가설 vs 사실 구분 |
| 타협 추적 질문 영역 | 핵심 가치 보존 확인 |
| 실험 질문 영역 | 빠른 실패 전략 수립 |
| **Phase 3.5 검증 단계** | 문서 생성 후 4요건 자동 검증 |

### 3. PRD 템플릿 필수 섹션 추가

| 섹션 | 목적 |
|------|------|
| 1.5 벤치마킹 분석 | "자기 생각에 대한 애착" 방지 |
| 6.1 가설 vs 사실 | "추측을 통한 의사 결정" 방지 |
| 8. 타협 기록 | "현실적인 타협" 추적 |
| 9. 실패 대응 계획 | "시행착오에 대한 두려움" 극복 |

### 4. 망하는 기획 4요건 체크리스트

```
┌─────────────────────────────────────────────────────────────────┐
│  1️⃣ 자기 생각에 대한 애착                                       │
│     └── 해독제: 벤치마킹 강제 (유사 서비스 3개 분석)             │
│                                                                  │
│  2️⃣ 추측을 통한 의사 결정                                       │
│     └── 해독제: 가설 vs 사실 테이블 필수                         │
│                                                                  │
│  3️⃣ 현실적인 타협                                               │
│     └── 해독제: 타협 기록 + 복구 계획                            │
│                                                                  │
│  4️⃣ 시행착오에 대한 두려움                                      │
│     └── 해독제: MVP 정의 + 피벗 옵션                             │
└─────────────────────────────────────────────────────────────────┘
```

### 5. Phase 3.5 검증 플로우

```
Phase 3 (문서 생성 완료)
    ↓
Phase 3.5 (자동 검증)
    ├── 벤치마킹 검사
    ├── 가설/사실 검사
    ├── 타협 검사
    └── 실험 검사
    ↓
❌ 미충족 → AskUserQuestion 보완
    ↓
✅ 통과 → Phase 4 (tasks-generator)
```

---

## [v1.6.4] - 2026-01-18

### Auto-Orchestrate 대규모 업데이트

> LangGraph/CrewAI 수준의 상태 관리로 100개 이상 태스크도 누락 없이 실행

---

### 1. SKILL.md 추가 내용

| 기능 | 설명 |
|------|------|
| `--phase N` | 특정 Phase만 실행 후 정지 |
| `--verify` | TASKS.md vs 실행 결과 교차 검증 |
| 슬랙 웹훅 설정 가이드 | AskUserQuestion / 환경변수 / 상태파일 |
| 태스크 누락 방지 시스템 | LangGraph/CrewAI 수준 상태 관리 |
| Claude Code vs LangGraph 비교 | 차이점 및 해결책 설명 |

### 2. SKILLS_SUMMARY.md 추가 내용

| 섹션 | 내용 |
|------|------|
| Auto Orchestrate 섹션 | CLI 옵션, 대규모 프로젝트 가이드, Phase Checkpoint |
| **전체 워크플로우 매뉴얼** | 소크라테스 → auto-orchestrate 6단계 가이드 |
| 태스크 수별 실행 전략 | 20/50/100개 기준 권장 방법 |
| 문제 해결 가이드 | 세션 종료, 누락 의심, 컨텍스트 과부하 대응 |

### 3. 전체 워크플로우 요약

```
Step 1: /socrates          → 21개 질문, 6개 문서 생성
Step 2: /tasks-generator   → TASKS.md 자동 생성
Step 3: /design-linker     → 목업 연결 (선택)
Step 4: /project-bootstrap → 에이전트 팀 + 환경 셋업
Step 5: /auto-orchestrate  → 태스크 수에 따라 실행
Step 6: --verify           → 누락 검증
```

### 4. CLI 옵션 상세

```bash
# 전체 자동 실행
/auto-orchestrate

# 특정 Phase만 실행
/auto-orchestrate --phase 2

# 중단된 작업 재개
/auto-orchestrate --resume

# Phase N 중간에서 재개
/auto-orchestrate --phase 2 --resume

# 누락 검증
/auto-orchestrate --verify
```

### 5. 대규모 프로젝트 권장 실행 방법

| 태스크 수 | 권장 방법 |
|----------|----------|
| 1-20개 | `/auto-orchestrate` 한번에 |
| 20-50개 | 자동 + Phase 완료 시 선택적 컴팩팅 |
| 50-100개 | `--phase N` Phase별 실행 |
| **100개+** | **반드시 Phase별 + 매 Phase 컴팩팅** |

### 6. 태스크 누락 방지 시스템

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Code + Phase Checkpoint (이 시스템):                    │
│  ├── orchestrate-state.json으로 영구 저장                       │
│  ├── 태스크 완료 즉시 상태 저장                                 │
│  ├── Phase 단위 체크포인트 + 컴팩팅 권장                        │
│  ├── CLAUDE.md에 진행 상황 기록                                 │
│  ├── --verify로 누락 검증                                       │
│  └── ✅ LangGraph/CrewAI 수준의 안정성 확보                     │
└─────────────────────────────────────────────────────────────────┘
```

### 7. 슬랙 웹훅 설정 방법

| 방법 | 설명 | 우선순위 |
|------|------|----------|
| AskUserQuestion | 시작 시 URL 입력 | 1순위 (권장) |
| orchestrate-state.json | `slack_webhook_url` 필드 | 2순위 |
| 환경변수 | `SLACK_WEBHOOK_URL` | 3순위 |

### 8. Phase Checkpoint 시스템

```
Phase N 완료
    ↓
1️⃣ orchestrate-state.json 저장
    ↓
2️⃣ CLAUDE.md 진행 상황 업데이트
    ↓
3️⃣ 슬랙 알림 (컴팩팅 권장)
    ↓
4️⃣ AskUserQuestion 체크포인트
    ┌─────────────────────────────────┐
    │ [1] /compact 후 계속 (권장)     │
    │ [2] 바로 다음 Phase 시작        │
    │ [3] 여기서 중단                 │
    └─────────────────────────────────┘
```

### 9. 문제 해결 가이드

| 상황 | 해결 방법 |
|------|----------|
| Phase 중간에 세션 종료 | `/auto-orchestrate --resume` |
| 특정 Phase만 다시 실행 | `/auto-orchestrate --phase N` |
| 태스크 누락 의심 | `/auto-orchestrate --verify` |
| 컨텍스트 과부하 | `/compact` 후 `--resume` |
| 슬랙 알림 안 옴 | 웹훅 URL 확인, 환경변수 체크 |

---

## [v1.6.3] - 2026-01-17

### 추가된 기능
- FastAPI Latest, React 19 스킬 문서화 추가
- Agentic Design Patterns 완전 반영 - Reflection 루프 추가 (품질 게이트 실패 시 자동 개선)
- Ralph Wiggum Loop 통일 - frontend-specialist에 누락된 패턴 추가
- A2A 스킬 추가 - 에이전트 간 구조화된 통신 프로토콜
- Reasoning 스킬 추가 - Chain of Thought, Tree of Thought, ReAct 추론 기법
- Goal Setting 스킬 추가 - TASKS.md 기반 목표 관리 및 진행 상황 모니터링
- Evaluation 스킬 추가 - 코드 품질/에이전트 성능/비용 메트릭 측정

---

## [v1.6.2] - 2026-01-17

### 추가된 기능
- 동적 소크라테스 기능
- Git Worktree 통일
- 보안 강화

---

## [v1.6.1] - 2026-01-16

### 추가된 기능
- Memory 스킬 - 세션 간 학습 지속
- Guardrails 스킬 - 입출력 안전 검증
- RAG 스킬 - Context7 MCP 연동
- Reflection 스킬 - 자기 성찰 패턴

---

## [v1.6.0] - 2026-01-15

### 추가된 기능
- 비용 최적화: 에이전트별 모델 배치 (opus/sonnet/haiku)
- MoAI ADK 통합: TAG System 도입
- TRUST 5 품질 원칙 추가
- Security Specialist 신규 생성
- 커버리지 강제 게이트 추가
- 병렬 진단 추가 (3.75배 빠름)
- Vercel Review 스킬 추가
- Frontend Specialist 대폭 업그레이드

---

## [v1.5.0] - 2026-01-14

### 추가된 기능
- Auto Orchestrate 스킬 추가
- 실행 모드 선택 (반자동화 vs 완전 자동화)
- 심층 인터뷰 기능 (Q21 완료 후)
- 세렌디피티 기능 (Q7 완료 후)

---

## [v1.4.0] - 2026-01-12

### 추가된 기능
- Design Linker 스킬 추가
- Chrome Browser 스킬 추가
- 환경 체크 기능 추가
- 크로스 플랫폼 지원
- 슬랙 웹훅 알림 기능

---

## [v1.0.0] - 2026-01-11

### 초기 버전
- Socrates 스킬
- Tasks Generator 스킬
- Project Bootstrap 스킬
- Deep Research 스킬
