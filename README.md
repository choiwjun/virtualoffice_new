# 🧪 Claude Labs

> **코딩 경험 없이도 아이디어만으로 풀스택 웹앱을 완성하는 AI 개발 파트너 시스템**

**버전**: 1.22.0 | **최종 업데이트**: 2026-06-22

---

## v1.22.0 주요 변경

> **자율 기획 인터뷰 스킬 maieutics 추가 (Minor)** — socrates의 "인터뷰로 완전한 기획서 산출" 목적을, 사람이 인터뷰에 직접 개입하지 않는 human-out-of-loop 루프로 달성. 두 cmux 페인이 직접 실시간 대화하며 기획을 완주한다.

- **🗣️ `/maieutics` 신규 스킬** — 소크라테스 페인이 도메인 '영혼' 페인에게 질문을 쏘고, 영혼이 그 도메인 사용자로서 답하는 자율 심층 인터뷰. 두 cmux 페인이 `cmux send`로 직접 문답을 주고받아 사람 개입 없이 PRD/TRD 기획서를 도출(human-out-of-loop). socrates의 대화형 기획을 무인화.
- **58개 스킬 / 19개 에이전트** (maieutics 추가)

---

## v1.21.0 주요 변경

> **자율 빌드·감독 능력 대폭 강화 (Minor)** — cmux-harness 분산 빌드 하네스에 능력 인지형 작업 지시·기능 검증 체크리스트·페인 상태 감시·양방향 통신을 더해 "사람이 거의 개입하지 않는 자율 프로세스"의 신뢰 경계를 세우고, planning-loop-supervisor를 설계 검증에서 구현 감독까지 관장하는 end-to-end 감독관으로 확장. 신규 스킬 없음(기존 스킬 강화).

- **🤖 cmux-harness 능력 인지형 작업 지시(Task Brief)** — 워커 지능 티어별 명세 구체성 규약(Kimi=Tier C 전수 명세 / Sonnet=Tier B 계약 고정 / Codex·Reviewer=Tier A 목표+체크리스트). Build Brief 9섹션 의무화 + 백엔드/프론트 템플릿. "워커가 물어볼 거리가 남으면 명세 미달".
- **✅ 기능 검증 체크리스트 프로토콜** — Main이 수락 기준에서 항목별 복붙 가능한 검증 명령+기대 결과를 파생, Codex가 직접 실행·실제 출력 인용. **verify 리포트 없는 TEST_PASS는 무효**(자율 모드 최대 구멍 차단). TEST_FAIL 시 실패 항목 기반 rework ≤3라운드.
- **👁️ 페인 상태 감시 + 예외 처리 계층** — `pane-state.sh`(단일 상태 토큰) + `pane-watch.sh`(차단 상태 자동 해소·에스컬레이션). false-ready 차단, 번호 프롬프트·CLI 업데이트·페인 죽음·타이밍 미스 감지·복구. "Main은 명령만 던지고 끝내지 않는다 — 보낸 뒤에도 감시·처리한다".
- **🔄 양방향 통신 부트스트랩** — 페인 최초 통신 시 워커→Main 역방향 `cmux send` push 방법 전달 의무화. 완료 프로토콜 4단계로 자율 루프의 보고 경로 보장.
- **🔁 planning-loop-supervisor 구현 감독 외부 루프(LOOP 11~13)** — 설계 검증·게이트 파생에서 멈추던 것을 구현 위임 → 독립 verifier 검증 → 승인/재작업(≤3라운드)까지 확장. 빌더가 아닌 독립 검증자가 신선한 증거로 게이트 검증.
- **📐 루프 파이프라인 ADR·BDD·게이트 훅화·포카요케 흡수** — Decision Gate(왜+강제 쌍), 에러→문서 포인터 의무화, Given/When/Then 수락 기준 정렬, 게이트 hookable 마킹(pre-commit 3중 그물), Prevention Gate(2회 fail 시 구조적 차단 승격).
- **57개 스킬 / 19개 에이전트** (기존 스킬 강화, 신규 스킬 없음)

---

## v1.20.1 주요 변경

> **planning-loop-supervisor 현장 제보 반영 (Patch)** — 기존(브라운필드) 프로젝트와 외부 작업문서도 검증 가능하도록 보강. 신규 스킬 없음.

- **🔁 planning-loop-supervisor 비표준 프로젝트 대응 (v1.1)** — 표준 `docs/planning/01-prd~06-tasks` 구조가 없는 기존 프로젝트에서 "전부 missing"만 보고하고 멈추던 문제 수정. **동작 모드 3종** 신설: Standard(기존) / Adaptive(문서 자동탐색→AskUserQuestion 역할 매핑) / Gate-Only(작업 지시에서 직접 게이트 파생). 임의 위치 `tasks.md`도 ARGUMENTS 경로로 채택. **어떤 모드든 `docs/planning/loop/` 추적 파일 항상 생성**(ABSOLUTE).
- **⚙️ planning-loop-supervisor 호출을 권장 옵션으로** — stargate Phase 3.7과 `/tasks-generator` 다음 단계 메뉴에서 "검증 게이트 실행(권장) / 바로 빌드(건너뛰기)"로 선택. tasks.md 직후 강제가 아닌 선택.

---

## v1.20.0 주요 변경

> **설계 검증 상위 루프 + 설계문서 자동 HTML + 빌트인 Workflow 심화** — 기획 산출물이 "개발 가능한 하나의 설계 패키지"로 수렴하는지 검증하는 감독관 계층을 얹고, md 설계 문서를 사람이 보기 좋은 HTML로 자동 렌더하며, dynamic workflows를 budget·전문가 기반으로 확장.

- **🔁 `/planning-loop-supervisor` 신규 스킬** — 설계문서(PRD·TRD·User Flow·DB·Design System·Screens·Tasks·Coding Convention) 간 일관성·추적성·갭·품질을 검증하고 미달 시 해당 스킬로 되돌려 반자동 루프(최대 3회)로 수렴. 설계서에서 **프로젝트별 세부 게이트(`08-derived-gates.md`)를 파생 생성**. `/stargate` Phase 3.7로 정식 통합. 생산자가 아니라 감독관.
- **📐 설계문서 자동 HTML 렌더** — `docs/**/*.md` 작성 시 PostToolUse 훅(`docs-html-renderer`)이 `docs/_html/`에 깔끔한 구조적 HTML 자동 생성(사이드바 TOC·테이블·mermaid·다크모드). `/socrates`·`/doubt` 기획 종료 시 통합 리포트 + `file://` 링크 제공. 변환기 `lib/md-to-html.js`(의존성 0).
- **⚙️ 빌트인 Workflow 도구 심화** — code-review/council/neurion/eureka/auto-orchestrate에 `budget` 동적 스케일 + `agentType` 도메인 전문가 적용. dynamic workflows 2차(generate-filter/tournament/classify-act + quarantine).
- **🔧 전 훅 절대경로 require 회귀 수정** — `node -e` + `process.chdir` + 상대 require가 Node 18+에서 no-op이던 문제를 11개 훅 일괄 수정.
- **57개 스킬 / 19개 에이전트** (planning-loop-supervisor 추가)

---

## v1.18.0 주요 변경

> **풀 파이프라인 진입점 강화 + cmux-harness 호환 패치 + 양대 라인 문서화** — 자산을 더 늘리지 않고 기존 57개 스킬의 진입점·결정점을 명료화. 사용자가 `/stargate` 하나만 기억하면 끝.

- **🌌 `/forge` → `/stargate` 명칭 변경** — gateway 의미 유지 + 한국어 강의 발음·SEO 개선. 디렉토리 git mv로 히스토리 보존, 17개 파일 일괄 교체, `harness-forge` 38건 안전 보존
- **🚪 `/stargate` 풀 파이프라인 진입점 강화** — Claude Labs 통합 시작점. description·트리거 확장, **Phase -1 체크포인트 시스템(`.stargate/state.json`) 신규**, 모든 Phase 종료에 AskUserQuestion 분기 (멈춤/이어서/다음), `/stargate resume`·`/stargate restart` 명령 추가. 사용자가 14개 결정점 모두에서 통제권 유지
- **🎚 cmux-harness full/slim 모드 분기** — 진입 시 모드 선택. `full`(Codex+Sonnet+Haiku+Browser, 웹 E2E) / `slim`(Codex+Sonnet, 백엔드·CLI). slim 모드에서 E2E role → Sonnet으로 자동 fallback
- **🐛 cmux-harness surface ref 호환 패치** — cmux CLI가 탭 이름 대신 surface ref만 받는 문제 우회. `scripts/cmux-surface.sh` 신규(register/resolve/forget/list/refresh) + 6개 송수신 스크립트 ref 해석 경유로 패치
- **🚨 cmux-harness Main dispatch ABSOLUTE RULE** — Phase 4에 "Main은 코드 작성 금지, 위성 페인 dispatch만" 강제 룰 + Dispatch 체크리스트 8항목. Main 페인의 자체 처리 회귀 차단
- **📐 `docs/PIPELINES.md` 신규** (330줄) — Socrates(귀납)/Descartes(연역) 양대 파이프라인 다이어그램 + 단계별 비교 표 + 결정적 차이 3가지(출력 문서 수 / Phase 3.5 Validation / Phase 6 Impact Trace 회귀) + 결정점 14개 표 + 라인 선택 가이드
- **🔍 README 결정 트리 표 2개** — 기획 7종(eureka/neurion/socrates/doubt/poietes/cogito/auto-planner) + 빌드 4종(auto-orchestrate/harness/harness-forge/cmux-harness) 한 줄 선택 기준. "스킬 한눈에 보기" 위
- **🧹 dist 정리** — 정체불명 455MB ZIP 덤프 삭제 + `.gitignore`에 `dist/*` / `.stargate/` / `.cmux-harness/` 추가
- **57개 스킬 / 19개 에이전트** (수 변동 없음)

<details>
<summary>v1.17.0 변경사항 보기</summary>

- **`/harness-forge` 신규** — Clabs 멀티 페인 분산 빌드 오케스트레이터. Main(Opus)=오케스트레이션만, Planner(Claude)=기획, Reviewer(Codex)=검토, Backend/Frontend=병렬 빌드, QA(Chrome)=브라우저 테스트의 6페인 역할 구조. 진짜 병렬 빌드 실현
- **`/design-discovery` 신규** — Open Design 스타일 7문항 discovery → DESIGN.md 바인드 → 단일 HTML artifact 발행. CLI 환경에서도 OD 데스크톱 품질 디자인 결과 생성
- **`/skill-installer` 신규** — Claude Labs 스킬팩 레지스트리 시스템. 프로젝트 타입 자동 감지(`auto`), 팩 목록 조회(`list`), 특정 팩 설치. socrates Phase 2.5 이후 자동 호출 연결
- **`cmux-harness` Phase 6** — 컨텍스트 라이프사이클 관리(턴/토큰 모니터링 → 핸드오프 → 페인 재생성) + tasks.md sub-agent 역할 기반 페인 라우팅 + Codex 10+턴 기획 검증 토론 통합
- **훅 학습 시스템 신규** — `fix-blocker.js`(반복 실수 사전 차단) + `fix-learner.js`(커밋 분석으로 fix 패턴 자동 축적). qmd 훅 전체 제거로 PostToolUse 안정성 회복

</details>

<details>
<summary>v1.16.0 변경사항 보기</summary>

- Socrates v3.1 균형판: Problem Framing + JTBD 페르소나 + MoSCoW Won't 강제 + 대화 스타일 규칙
- 인스톨러 hooks 등록 버그 수정 (merge_hooks_settings / Merge-HooksSettings)

</details>

<details>
<summary>v1.15.0 변경사항 보기</summary>

- **`/doubt` 풀스케일 기획 스킬 신규** — 데카르트 방법적 회의 기반. `/socrates`(귀납적 탐색)와 대칭을 이루는 연역적 기획 도구
- **양대 기획 스킬 체제** — `/socrates` "X란 무엇인가?" (Bottom-up) vs `/doubt` "이것은 확실한가?" (Top-down)
- **악마의 심문(Genius Malignus)** + **코기토 연역 체인**

</details>

<details>
<summary>v1.14.0 변경사항 보기</summary>

- `/stargate` 풀 파이프라인 신규, Socrates v2 기획 강화, Council 단일세션 모드, Harness v2
- 미사용 스킬 6개 정리, 스킬 코스 가이드 신규, install.sh/ps1 버그 수정

</details>

<details>
<summary>v1.13.1 변경사항 보기</summary>

- Council 스킬 신규, 5개 핵심 스킬 강화 (socrates/autoresearch/audit/code-review/vercel-review)

</details>

<details>
<summary>v1.13.0 변경사항 보기</summary>

- **Harness Architecture 신규** — Anthropic 하네스 아키텍처 구현. Socrates(기획) → Builder(구현) → Evaluator(QA) 3-에이전트 시스템
- `/harness`, `harness-builder`, `harness-evaluator`, `auto-planner` 4개 스킬 추가
- GAN 영감의 Generator-Evaluator 피드백 루프로 품질 반복 개선

</details>

<details>
<summary>v1.12.0 변경사항 보기</summary>

- **AutoResearch 패밀리 신규** — [Karpathy autoresearch](https://github.com/karpathy/autoresearch) 패턴을 3개 스킬로 구성:
  - `/autoresearch` (코어 v2.0): 3파일 원칙 + Frozen Metric + 2계층 RSI. 5개 모드(design/run/rsi/report/resume). 도메인 특화 스킬 자동 라우팅
  - `/autoresearch-frontend`: Chrome MCP 기반 DOM+콘솔+폼+시각 복합 메트릭. test-routes.json 경로별 테스트
  - `/autoresearch-skills`: SKILL.md를 target으로 테스트 케이스 기반 자율 개선. Tier 1/2/3 적합성 판별 + gen-tests 자동 생성

</details>

<details>
<summary>v1.11.0 변경사항 보기</summary>

- **Spike 스킬 신규** (`/spike`): 불확실 영역 탐색 전용 모드 — 품질 게이트 완화 + 빠른 프로토타이핑 → 결과 리포트 (`docs/spikes/`)
- **Audit 스킬 신규** (`/audit`): 보안(OWASP Top 10)/라이선스(SPDX)/개인정보(GDPR) 3모듈 감사 + 구조화된 리포트 (`docs/audit/`)
- **Session Report 스킬 신규** (`/session-report`): git log/diff + 검증 증거 → 카테고리별 변경 분석 + 메트릭 요약 리포트 (`docs/reports/`)
- **verification-before-completion 강화**: 자동 증거 추적 (`.claude/cache/verification-evidence.json`), 3회 연속 실패 감지 → systematic-debugging 권장, session-report 연동
- **WORKFLOW.md Phase 0/5 추가**: Phase 0(`/spike` 탐색) + Phase 5(`/audit` 감사) 파이프라인 편입
- **install.sh/install.ps1 52개 스킬 커버리지**: Core에 spike, Quality에 audit, Utility에 session-report 추가

</details>

<details>
<summary>v1.10.2 변경사항 보기</summary>

- **파이프라인 검증 & 갭 수정**: 7개 스킬에 Pipeline Context(backward link) 추가, checkpoint-workflow 참조 연결
- **master-pipeline.md 신규**: 전체 파이프라인 다이어그램, 데이터 아티팩트 흐름, 체크포인트 유형 참조 문서
- **screen-spec/tasks-generator 체크포인트 추가**: Phase 4 요약 확인, ICV 결과 확인 AskUserQuestion 삽입
- **품질 체인 powerqa 공식화**: verification/evaluation 실패 시 powerqa→systematic-debugging 에스컬레이션 경로 명문화
- **install.sh 49개 스킬 커버리지**: Philosophy, Language Pro, DevOps 3개 신규 카테고리, Quality/Utility 확장
- **orchestrator 에이전트 테이블 완성**: docs-specialist, task-executor, electron 3종 추가 (총 18개)

</details>

<details>
<summary>v1.10.1 변경사항 보기</summary>

- **Eros/Poietes HYOGOOK V6 통합**: AFO Kingdom S-Score 자가 평가를 Eros Phase 6 및 Poietes Phase 4에 추가
- **오케스트레이션 워크플로우 계약 정렬**: 태스크 문서 경로, ID 형식, Worktree 브랜치 전략, 병합 책임을 단일 기준으로 통일
- **auto-orchestrate 구현 워크플로우 정밀화**: 구현→Git Worktree→TDD→review→QA/security→main 병합→push 순서 명문화

</details>

## 최근 유지보수 메모

- `/auto-orchestrate` 실행 계약을 `구현 → Git Worktree → TDD → review → QA/security → main 병합 → push` 순서로 명문화했습니다.
- specialist는 Worktree 브랜치에서 구현과 로컬 커밋까지만 담당하고, merge/push는 orchestrator만 수행합니다.
- 품질 게이트에서 버그나 취약점이 발견되면 같은 Phase 브랜치에서 TDD 루프로 되돌아가도록 정리했습니다.

<details>
<summary>v1.9.7 변경사항 보기</summary>

- **Eros 스킬 신규**: 플라톤 향연의 에로스 알고리즘 — 결핍 인식 → 디오티마 사다리 6계층 추상화 → 창작 → 불사 보존
- **Socrates 양방향 연동**: 소크라테스 완료 후 `/eros` 기획 검증 + 에로스 완료 후 `/socrates` 기획 시작

</details>

<details>
<summary>v1.9.5 변경사항 보기</summary>

- **project-bootstrap-supabase 스킬 신규**: Next.js + Supabase + Vercel CI/CD 풀스택 프로젝트를 원커맨드로 셋업 (4 Phase: Bootstrap → Local Stack → Boilerplate → CI/CD)
- **project-bootstrap 자동 위임**: Next.js + Supabase 조합 선택 시 전용 스킬로 자동 전환
- **발동 조건 가드 강화**: 프로젝트 생성 의도가 명확한 요청에만 반응, 단순 질문에는 미반응

</details>

<details>
<summary>v1.9.4 변경사항 보기</summary>

- **Progressive Disclosure Architecture 도입**: 2-tier 스킬 구조 (SKILL.md 80-100줄 + references/) 표준 정립, 토큰 50-70% 절감
- **auto-orchestrate/socrates 리팩토링**: Progressive Disclosure 적용 (auto-orchestrate 71%, socrates 63% 축소)
- **Common Ground 스킬 신규**: AI 가정 투명화 시스템 (4가지 가정 유형, 3단계 신뢰 등급, 4가지 모드)
- **Behavioral Engineering 규칙 추가**: 1% Rule, Agreement Theater 금지, Verification Discipline, 3회 실패 임계값
- **The Fool 비판적 사고 스킬 신규**: 5가지 비판적 추론 모드 (가정 노출, 반대 논증, 실패 모드, 레드팀, 증거 검증)
- **allowed-tools 제한 추가**: code-review, reverse, evaluation, sync, deep-research에 최소 도구 세트 정의
- **전문가 스킬 6개 신규**: Python Pro, TypeScript Pro, Go Pro, Kubernetes Specialist, Terraform Engineer, Database Optimizer
- **훅 방어 코드 강화**: Node.js 미설치 환경에서도 훅 에러 없이 동작하도록 `command -v node` 가드 추가

</details>

<details>
<summary>v1.9.3 변경사항 보기</summary>

- **install.sh 스킬 설치 안정화**: `gum spin` 연속 호출 시 `set -e`로 스크립트가 죽는 버그 수정
- **`copy_dir()` 헬퍼 함수 도입**: rsync 실패 시 `cp -R` 자동 폴백, 소스 없어도 안전하게 계속 진행
- **Hybrid 카테고리 설치 누락 수정**: desktop-bridge 스킬이 선택해도 설치되지 않던 문제 해결

</details>

<details>
<summary>v1.9.2 변경사항 보기</summary>

- **install.ps1 gum confirm 완전 제거**: Windows에서 `gum confirm` 대신 `Read-Host` 사용으로 호환성 확보
- **ZIP 출력 경로 변경**: 패키징 ZIP을 `dist/` 폴더에 생성하도록 통일
- **패키징 규칙 강화**: CLAUDE.md, SKILL.md에 dist/ 폴더 규칙 명시

</details>

<details>
<summary>v1.9.1 변경사항 보기</summary>

- **배포 방식 변경**: DMG/EXE 배포 제거, 스크립트 기반 설치 전용 (install.sh / install.ps1)
- **install.ps1 수정**: `gum confirm` PowerShell 호환성 버그 수정 (exit code 기반으로 전환)
- **Hook timeout 증가**: UserPromptSubmit hook timeout 5초 → 10초 (VibeMem 연동 안정화)

</details>

<details>
<summary>v1.9.0 변경사항 보기</summary>

- **Hook 시스템**: 자동 컨텍스트 주입으로 세션 효율성 40~60% 향상
  - SessionStart: 메모리/기술 스택 자동 로드
  - UserPromptSubmit: 35+ 스킬 키워드 기반 자동 감지
  - PreToolUse: Constitution 자동 주입, 에이전트 컨텍스트 보강, 커밋 품질 검사
  - PostToolUse: 코드 패턴 분석 + OWASP 보안 스캔
  - Stop: 세션 요약 저장 + 미완료 TODO 차단

</details>

<details>
<summary>v1.8.x 변경사항 보기</summary>

- **Desktop Bridge**: `/desktop-bridge` - Claude Desktop(설계) + Claude Code CLI(구현) 하이브리드 워크플로우
  - `publish` 모드: Desktop 기획 → GitHub Issue 자동 생성
  - `implement` 모드: GitHub Issue → CLI 구현 시작 + 진행 상황 동기화

</details>

<details>
<summary>v1.8.0 변경사항 보기</summary>

- **Trinity**: `/trinity` - 五柱(眞善美孝永) 철학 기반 코드 품질 평가 (from HyoDo)
- **Reverse**: `/reverse` - 기존 코드에서 명세 역추출 (from SDD Tool)
- **Sync**: `/sync` - 명세-코드 동기화 검증 (from SDD Tool)
- **Cost Router**: `/cost-router` - AI 비용 40-70% 절감 라우팅 (from HyoDo)

</details>

<details>
<summary>v1.7.7 변경사항 보기</summary>

- **Neurion 브레인스토밍**: `/neurion` - AI + 사용자 공동 브레인스토밍 스킬 추가
- **Osborn 4원칙 기반**: 판단 금지, 양 중심, 엉뚱함 환영, 아이디어 조합
- **4 AI 페르소나**: 진행자, 아이디어 제안자, 응원자, 연결자가 함께 참여
- **Socrates 연동**: `neurion-proposal.md` 자동 감지하여 기획 효율화

</details>

<details>
<summary>v1.7.6 변경사항 보기</summary>

- **소크라테스 개인화 강화**: 사용자 프로필 시스템으로 반복 질문 제거
- **user-profile.md**: 레벨, 선호, 히스토리 저장 → 다음 세션에 즉시 적용
- **기존 사용자 인식**: "다시 만나서 반가워요!" - 레벨 재측정 없이 바로 기획 시작

</details>

<details>
<summary>v1.7.5 변경사항 보기</summary>

- **화면 단위 태스크 시스템**: `P{Phase}-S{Screen}-T{Task}` 구조 도입
- **Screen Spec 스킬**: `/screen-spec` - 화면별 YAML v2.0 명세 생성
- **Google Stitch MCP 연동**: YAML 명세 → 디자인 목업 자동 생성 (선택)
- **Constitutions 시스템**: 프레임워크별 헌법으로 반복 실수 방지
- **TUI 인스톨러**: Mac/Linux/Windows 인터랙티브 설치

</details>

---

## 언제 뭐 쓰나 — 결정 트리

> **헷갈리면 그냥 `/stargate`** — Claude Labs의 통합 진입점. 아이디어부터 출시까지 매 분기마다 사용자에게 물어 자동 디스패치. `.stargate/state.json` 체크포인트로 중단·재개 지원. 단일 단계만 원할 때만 아래 표에서 직접 골라 호출.
> 같은 카테고리에 여러 스킬이 있어 헷갈리면 아래 한 줄을 보고 고르세요. 더 디테일한 비교는 각 SKILL.md.

### 기획·이데이션 (7종) — 시작점은 단 하나

| 상황 | 추천 | 비고 |
|---|---|---|
| **막연한 아이디어 → 3~4개 구체 MVP 제안** | `/eureka` | AI가 재귀적 사고로 아이디어 발전 |
| **백지 → 4명 페르소나와 공동 브레인스토밍** | `/neurion` | Osborn 4원칙, 비판 금지. eureka의 입력으로도 좋음 |
| **곡(곡의 X — 충분히 큰) 아이디어 → 21문항 심층 기획** | `/socrates` | 귀납적("X란 무엇인가"). MoSCoW + JTBD + 화면 매핑 |
| **이미 만든 가정을 의심·검증** | `/doubt` | 연역적("이건 정말 확실한가"). Assumption Ledger + Dream/Demon |
| **에로스 사이클로 결핍 → 창작** | `/poietes` | 21문항 다른 배열 (eros 철학) |
| **모든 전제를 한 번에 해체 후 의도만 남기기** | `/cogito` | "Cogito ergo codo". 메타 도구 |
| **대화 없이 5분 안에 spec 자동 생성** | `/auto-planner` | 비대화형. 빠른 프로토타입 시작에 |

`/stargate` 진입 시 위 7개 중 **상황에 맞는 것을 자동 디스패치**합니다 — 외울 필요 없음.

### 빌드 오케스트레이션 (4종) — 환경/규모로 선택

| 상황 | 추천 | 핵심 |
|---|---|---|
| **단일 워커, 06-tasks.md 의존성 자동 직렬/병렬 실행** | `/auto-orchestrate` | 가장 단순. cmux 같은 멀티 페인 환경 불필요 |
| **spec.md만 있고 TASKS 없이 빠른 빌드 + QA 루프** | `/harness` | Socrates → Builder → Evaluator 3-에이전트 |
| **사용자가 cmux 세팅 안 했어도 6-페인 자동 배치** | `/harness-forge` | Planner/Reviewer/BE/FE/QA 역할 자동 부여 |
| **cmux 안에서 sub-agent role 기반 분산 + 컨텍스트 라이프사이클** | `/cmux-harness` | 진입 시 full(웹 E2E) / slim(no E2E) 모드 선택 |

가장 단순한 것부터 시도하고, 답답하면 위로 올라가는 게 정석입니다. `/stargate`가 풀 파이프라인에서 자동 선택.

> 🔁 **명세 → 빌드 사이의 검증 게이트**: 명세·태스크까지 만든 뒤 빌드 전에 `/planning-loop-supervisor`(상위 루프 감독관)가 설계문서 패키지의 일관성·추적성·갭·품질을 검증하고, 미달이면 해당 스킬로 되돌려 반자동으로 보완하며, 설계서에서 **프로젝트별 세부 게이트**(`docs/planning/loop/08-derived-gates.md`)를 파생합니다. 이후 빌드/완료 판정은 이 게이트를 함께 기준으로 삼습니다. `/stargate` Phase 3.7에서 자동 호출됩니다.

> 📐 **양대 파이프라인 전체 흐름**(기획→명세→빌드→테스트→검증→자가개선→출시): [`docs/PIPELINES.md`](docs/PIPELINES.md) — Socrates(귀납) / Descartes(연역) 두 라인이 어디서 갈라지고 어디서 합류하는지, 단계별 비교 표 + 다이어그램.

---

## 스킬 한눈에 보기

| 스킬 | 명령어 | 한 줄 설명 |
|------|--------|-----------|
| **Neurion** | `/neurion` | AI + 사용자 공동 브레인스토밍, 아이디어 폭발 |
| **Deep Research** | `/deep-research` | 5개 검색 API 병렬 실행, 15분 리서치를 30초로 |
| **Socrates** | `/socrates` | 21개 질문으로 아이디어를 6개 기획 문서로 변환 |
| **Screen Spec** | `/screen-spec` | 화면별 상세 명세(YAML v2.0) 생성 |
| **Tasks Generator** | `/tasks-generator` | 화면 단위 + 연결점 검증 TASKS.md 생성 |
| **Planning Loop Supervisor** | `/planning-loop-supervisor` | 설계문서 일관성·추적성·갭·품질 검증 + 프로젝트별 게이트(08-derived-gates.md) 파생 상위 루프 감독관 **(NEW!)** |
| **Design Linker** | `/design-linker` | 목업 디자인을 태스크에 자동 연결 |
| **Project Bootstrap** | `/project-bootstrap` | 원클릭 에이전트 팀 + 풀스택 프로젝트 셋업 |
| **Auto Orchestrate** | `/auto-orchestrate` | 완전 자동화 개발 + Phase Checkpoint |
| **Chrome Browser** | `/chrome-browser` | 브라우저 제어 및 웹앱 테스트 자동화 |
| **Trinity** | `/trinity` | 五柱(眞善美孝永) 철학 기반 코드 품질 평가 **(NEW!)** |
| **Reverse** | `/reverse` | 기존 코드에서 명세 역추출 **(NEW!)** |
| **Sync** | `/sync` | 명세-코드 동기화 검증 **(NEW!)** |
| **Cost Router** | `/cost-router` | AI 비용 40-70% 절감 라우팅 |
| **Desktop Bridge** | `/desktop-bridge` | Desktop↔CLI 하이브리드 워크플로우 |
| **Eros** | `/eros` | 플라톤 향연 기반 결핍 인식 → 디오티마 사다리 → 창작 |
| **Spike** | `/spike` | 불확실 영역 탐색 + 빠른 프로토타이핑 **(NEW!)** |
| **Audit** | `/audit` | 보안/라이선스/GDPR 3모듈 감사 + 리포트 **(NEW!)** |
| **Session Report** | `/session-report` | 세션 종료 구조화 작업 리포트 **(NEW!)** |

---

## 전체 워크플로우 (v1.11.0)

### 오케스트레이션 계약 메모

- 태스크 문서 표준 경로는 `docs/planning/06-tasks.md`입니다.
- 오케스트레이터와 specialist 사이의 태스크 ID는 `P0-T0.1`, `P{N}-R{M}-T{X}`, `P{N}-S{M}-T{X}`, `P{N}-S{M}-V` 형식을 사용합니다.
- Phase 1+ 작업은 항상 phase 브랜치가 연결된 Git Worktree에서 수행합니다.
- specialist는 태스크 구현과 검증만 담당하고, Phase 품질 게이트와 병합은 오케스트레이터가 담당합니다.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Claude Labs 워크플로우                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  🆕 하이브리드 워크플로우 (Desktop ↔ CLI)                              │  │
│  │                                                                       │  │
│  │  [Claude Desktop]         [GitHub]          [Claude Code CLI]         │  │
│  │  /neurion, /socrates      Issue #N          /auto-orchestrate         │  │
│  │  /screen-spec             ──────────▶       완전 자동화 개발           │  │
│  │       │                       ▲                   │                   │  │
│  │       ▼                       │                   ▼                   │  │
│  │  /desktop-bridge          진행 상황           PR 생성 & Issue 닫기     │  │
│  │     publish               자동 동기화                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   [신규 프로젝트]                         [기존 프로젝트]                    │
│        │                                       │                            │
│        ▼                                       ▼                            │
│   ┌──────────────────┐                  ┌──────────────────┐               │
│   │    /neurion      │                  │    /reverse      │               │
│   │  AI 브레인스토밍  │                  │  코드→명세 역추출 │               │
│   └────────┬─────────┘                  └────────┬─────────┘               │
│            │                                     │                          │
│            ▼                                     ▼                          │
│   ┌──────────────────┐               specs/screens/*.yaml 생성              │
│   │  /deep-research  │                           │                          │
│   └────────┬─────────┘                           │                          │
│            │                                     │                          │
│            ▼                                     │                          │
│   ┌──────────────────┐                           │                          │
│   │    /socrates     │  ◀────────────────────────┘                          │
│   │  21개 질문 기획   │                                                      │
│   └────────┬─────────┘                                                      │
│            │                                                                │
│            ▼                                                                │
│   ┌──────────────────┐                                                      │
│   │   /screen-spec   │ ──▶ specs/screens/*.yaml                             │
│   └────────┬─────────┘                                                      │
│            │                                                                │
│            │    ┌────────────────────────────────────────────┐              │
│            │    │  /desktop-bridge publish (선택)            │  ← NEW!      │
│            │    │  Desktop 기획 → GitHub Issue 자동 생성     │              │
│            │    └────────────────────────────────────────────┘              │
│            ▼                                                                │
│   ┌──────────────────┐                                                      │
│   │ /tasks-generator │ ──▶ 06-tasks.md                                      │
│   └────────┬─────────┘                                                      │
│            │                                                                │
│            ▼                                                                │
│   ┌──────────────────┐                                                      │
│   │/project-bootstrap│ ──▶ 에이전트 팀 + 환경 셋업                          │
│   └────────┬─────────┘                                                      │
│            │                                                                │
│            │    ┌────────────────────────────────────────────┐              │
│            │    │  /cost-router (자동 적용)                  │              │
│            │    │  태스크별 최적 모델 선택 (40-70% 비용 절감) │              │
│            │    └────────────────────────────────────────────┘              │
│            ▼                                                                │
│   ┌──────────────────┐                                                      │
│   │ /auto-orchestrate│ ──▶ 완전 자동화 개발                                 │
│   └────────┬─────────┘                                                      │
│            │                                                                │
│            ├──── 개발 중간 ─────▶ /sync (명세-코드 동기화 검증)              │
│            │                                                                │
│            ▼                                                                │
│   ┌──────────────────┐                                                      │
│   │    /trinity      │                                                      │
│   │ 五柱 품질 평가    │  (90+ 자동승인, 70-89 리뷰, <70 차단)               │
│   └────────┬─────────┘                                                      │
│            │                                                                │
│            ▼                                                                │
│   ┌──────────────────┐                                                      │
│   │ /chrome-browser  │ ──▶ 완성된 앱 테스트                                 │
│   └────────┬─────────┘                                                      │
│            │                                                                │
│            ▼                                                                │
│        완성!                                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 빠른 시작

### 0. 아이디어가 없을 때

```bash
# AI와 함께 브레인스토밍
/neurion

# Osborn 4원칙 기반 브레인스토밍:
# → 15-20개 아이디어 폭발
# → 그룹핑 & 방향 선택
# → neurion-proposal.md 생성
# → /socrates에서 자동 감지하여 활용
```

### 1. 아이디어만 있을 때 (권장)

```bash
# 소크라테스와 대화하며 기획 시작
/socrates

# 21개 질문에 답하면:
# → 6개 기획 문서 자동 생성
# → /screen-spec 자동 호출 (화면 명세 생성)
# → /tasks-generator 자동 호출 (화면 단위 태스크)
# → /project-bootstrap으로 개발 환경 셋업
```

### 2. 기술 스택을 알 때

```bash
# 바로 에이전트 팀 생성
"FastAPI + React로 에이전트 팀 만들어줘"

# 질문 3개에 답하면:
# → 에이전트 팀 생성
# → Constitutions 자동 설치
# → 프로젝트 환경 셋업
# → 개발 시작!
```

### 3. 기존 프로젝트가 있을 때

```bash
# 코드 분석 후 남은 작업 파악
/tasks-generator analyze

# → 기존 코드 분석
# → 완료/미완료 태스크 파악
# → 화면 단위 TASKS.md 생성
```

### 4. 완전 자동화 개발

```bash
# TASKS.md 기반 자동 개발
/auto-orchestrate

# → 의존성 분석 → 자동 직렬/병렬 판단
# → 연결점 검증 태스크 자동 실행
# → Phase 완료 → main 자동 병합
```

---

## 핵심 스킬 상세

### `/screen-spec` - 화면 명세 생성 (NEW!)

**"화면이 주도하되, 도메인이 방어한다"**

```yaml
# specs/screens/product-list.yaml
version: "2.0"
screen:
  name: 상품 목록
  route: /products
  layout: sidebar-main

data_requirements:
  - resource: products
    needs: [id, name, price, thumbnail]

components:
  - id: product_grid
    data_source: { resource: products }

tests:
  - name: 초기 로드
    when: 페이지 접속
    then: [상품 12개 표시]
```

**Google Stitch MCP 연동** (선택):
- YAML 명세에서 디자인 목업 자동 생성
- PNG 이미지 + HTML 코드 추출
- WCAG 2.1 접근성 검사
- 디자인 토큰 자동 생성 (CSS/Tailwind)

### `/tasks-generator` - 화면 단위 태스크

**Task ID 형식 (v1.7.5)**

| 형식 | 용도 | 예시 |
|------|------|------|
| `P{N}-R{M}-T{X}` | Backend Resource | P2-R1-T1: Products API |
| `P{N}-S{M}-T{X}` | Frontend Screen | P2-S1-T1: Product List UI |
| `P{N}-S{M}-V` | Verification | P2-S1-V: 연결점 검증 |

---

## Constitutions - 프레임워크 헌법 (NEW!)

**"반복되는 실수를 규칙으로 방지"**

```
.claude/constitutions/
├── fastapi/
│   ├── dotenv.md      # .env 미로드 → 가짜 CORS 에러 방지
│   ├── auth.md        # JWT + OAuth2 패턴
│   └── api-design.md  # Resource-Oriented API Design
├── nextjs/
│   ├── auth.md        # NextAuth.js 단일 인증 레이어
│   └── api-design.md  # 화면 비종속 API
├── supabase/
│   └── rls.md         # Row Level Security 필수
├── tailwind/
│   └── v4-syntax.md   # v4 문법 (v3과 다름!)
└── common/
    └── uuid.md        # RFC 4122 UUID 준수
```

---

## 지원 기술 스택

### 백엔드

| Framework | 인증 | 설명 |
|-----------|------|------|
| FastAPI | ✅ | Python + SQLAlchemy + JWT + Alembic |
| Express | ✅ | Node.js + TypeScript + JWT |
| Rails 8 | ✅ | Ruby on Rails + SQLite WAL |
| Django | - | Python + DRF |

### 프론트엔드

| Framework | 인증 UI | 설명 |
|-----------|---------|------|
| React+Vite | ✅ | React 19 + Zustand + TailwindCSS |
| Next.js | ✅ | App Router + TailwindCSS |
| SvelteKit | ✅ | Svelte 5 runes + TailwindCSS |
| Remix | ✅ | Loader/Action 패턴 |

### 데이터베이스

| DB | Docker Template |
|----|-----------------|
| PostgreSQL | `postgres` |
| PostgreSQL + PGVector | `postgres-pgvector` |
| MySQL | `mysql` |
| MongoDB | `mongodb` |
| MariaDB | `mariadb` |
| Supabase | 클라우드 |
| Firebase | 클라우드 |

---

## 에이전트 팀 구성

`/project-bootstrap` 실행 시 생성되는 AI 에이전트 팀:

```
.claude/
├── agents/
│   ├── orchestrator.md          # 전략적 판단 & 작업 분해
│   ├── backend-specialist.md    # 백엔드 API 구현
│   ├── frontend-specialist.md   # 프론트엔드 UI 구현
│   ├── 3d-engine-specialist.md  # Three.js, IFC/BIM, 3D 시각화
│   ├── database-specialist.md   # DB 스키마 & 마이그레이션
│   ├── test-specialist.md       # 테스트 작성 & 품질 검증
│   └── security-specialist.md   # OWASP TOP 10 보안 검사
│
├── commands/
│   ├── orchestrate.md           # 작업 분배 & 조율
│   └── integration-validator.md # 통합 검증
│
└── constitutions/               # 프레임워크 헌법 ← NEW!
    ├── fastapi/
    ├── nextjs/
    └── tailwind/
```

### 에이전트 역할

| 에이전트 | 모델 | 역할 | 핵심 패턴 |
|----------|------|------|----------|
| orchestrator | opus | 전략적 판단, 작업 분해 | 병렬 Task 호출 |
| backend-specialist | opus | FastAPI/Express 백엔드 | TDD + Constitutions |
| frontend-specialist | sonnet | React/Next.js 프론트엔드 | TDD + Gemini |
| 3d-engine-specialist | sonnet | Three.js, IFC/BIM 시각화 | WebGL + Dispose 패턴 |
| database-specialist | haiku | DB 스키마, 마이그레이션 | TDD + Alembic |
| test-specialist | haiku | Phase 0 주도, 품질 게이트 | Contract-First |
| security-specialist | opus | OWASP TOP 10 보안 검사 | pip-audit, npm audit |

---

## 설치

### 방법 1: TUI 인터랙티브 설치 (권장)

#### Mac / Linux

```bash
chmod +x install.sh
./install.sh
```

#### Windows (PowerShell)

```powershell
# 실행 정책 에러 발생 시 (권장)
powershell -ExecutionPolicy Bypass -File .\install.ps1

# 또는 직접 실행 (실행 정책이 이미 허용된 경우)
.\install.ps1
```

**TUI 인스톨러 기능:**
- 스킬 카테고리 선택 설치
- 프레임워크 Constitutions 선택 설치
- Slack 웹훅 자동 설정
- Gemini MCP OAuth 인증 (Node.js 기반, Rust 불필요)
- `/socrates` 시작 가이드

### 방법 2: Claude Code에게 맡기기

```bash
# 압축 해제 후 Claude Code 실행
unzip claude-skills-v1.7.5.zip
claude

# Claude Code에게 요청
> 이거 설치해줘
```

### 방법 3: 수동 설치

```bash
# Mac/Linux: 전역 설치
rsync -av .claude/ ~/.claude/

# Windows PowerShell: 전역 설치
Copy-Item -Recurse -Force .\.claude\* $env:USERPROFILE\.claude\
```

### 제거

```bash
# Mac/Linux
./uninstall.sh

# Windows - 수동 삭제
Remove-Item -Recurse -Force $env:USERPROFILE\.claude
```

---

## 환경 요구사항

| 도구 | 용도 | 필수 여부 |
|------|------|----------|
| Claude Code CLI | 스킬 실행 | 필수 |
| Git | 버전 관리 | 필수 |
| Node.js v18+ | MCP 서버 | 필수 |
| gh CLI | `/desktop-bridge` GitHub 연동 | 선택 |
| Python 3 | 백엔드 | 선택 |
| Docker | 컨테이너 환경 | 선택 |

### gh CLI 설치 (desktop-bridge 사용 시)

```bash
# Mac
brew install gh

# Windows
winget install GitHub.cli

# Linux
sudo apt install gh

# 인증
gh auth login
```

---

## 문서 구조

```
docs/
├── skills/                    # 스킬별 상세 문서
│   ├── deep-research.md
│   ├── socrates.md
│   ├── screen-spec.md         # NEW!
│   ├── tasks-generator.md
│   ├── design-linker.md
│   ├── project-bootstrap.md
│   └── chrome-browser.md
│
└── planning/                  # /socrates가 생성하는 문서
    ├── 01-prd.md              # 제품 요구사항
    ├── 02-trd.md              # 기술 요구사항
    ├── 03-user-flow.md        # 사용자 흐름
    ├── 04-database-design.md  # DB 설계
    ├── 05-design-system.md    # 디자인 시스템
    ├── 06-screens.md          # 화면 목록 ← NEW!
    ├── 06-tasks.md            # 개발 로드맵 (/tasks-generator)
    └── 07-coding-convention.md # 코딩 컨벤션

specs/                         # /screen-spec이 생성 ← NEW!
├── domain/
│   └── resources.yaml         # 도메인 리소스
└── screens/
    └── *.yaml                 # 화면별 명세
```

---

## 참고 자료

- [WORKFLOW.md](WORKFLOW.md) - 전체 워크플로우 가이드
- [INSTALL.md](INSTALL.md) - 설치 상세 가이드
- [CHANGELOG.md](CHANGELOG.md) - 변경 이력

---

## 라이선스

MIT License
