# 전체 스킬 워크플로우 가이드

> Claude Code AI 에이전트 팀 스킬 시스템의 전체 동작 흐름

**버전**: 1.11.0 | **최종 업데이트**: 2026-03-15

---

## 워크플로우 계약

- `/tasks-generator`의 표준 출력은 `docs/planning/06-tasks.md`
- `/orchestrate`, `/auto-orchestrate`, `dependency-resolver`는 동일한 `06-tasks.md`를 읽음
- `/planning-loop-supervisor`(상위 루프 게이트)가 `docs/planning/loop/08-derived-gates.md`를 생성하면, 빌드·완료 판정은 `06-tasks.md` + `08-derived-gates.md`(+`00-loop.md`)를 함께 기준으로 삼는다. derived-gates의 Hard/Metric/Domain 게이트를 증거와 함께 통과하기 전까지 "구현 완료" 선언 금지
- 태스크 ID는 `P0-T0.1`, `P{N}-R{M}-T{X}`, `P{N}-S{M}-T{X}`, `P{N}-S{M}-V` 형식을 사용
- Phase 1+는 `git worktree add <worktree> -b <phase-branch> main` 형태의 branch-backed Git Worktree에서 수행하며 subtree는 사용하지 않음
- specialist는 태스크 구현, TDD, 자체 검증, 로컬 커밋까지만 담당하고 `TASK_DONE:{task_id}:{commit_sha}`로 보고
- Phase 리뷰, QA, security 게이트, main 병합, 원격 push, 다음 Phase 전환은 orchestrator가 담당
- 리뷰/QA/security 실패 시 같은 Phase Worktree에서 TDD 루프로 복귀

## 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                        사용자 요청                                   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 0: 탐색 (Spike) ← NEW!                                       │
│  ┌─────────────┐                                                    │
│  │   /spike    │ ──▶ docs/spikes/spike-{date}-{topic}.md            │
│  │ (가설 검증) │     품질 게이트 완화, 빠른 프로토타이핑              │
│  └─────────────┘                                                    │
│  ※ 선택적 — 불확실 영역이 있을 때만 실행                              │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 1: 기획 (Planning)                                           │
│  ┌─────────────┐     ┌──────────────┐     ┌─────────────────┐      │
│  │ /socrates   │ ──▶ │ /screen-spec │ ──▶ │/tasks-generator │      │
│  │ (21개 질문) │     │ (화면 명세)  │     │ (태스크 생성)   │      │
│  └─────────────┘     └──────────────┘     └─────────────────┘      │
│                                                   │                 │
│                                           ┌───────┴────────┐        │
│                                           │ /design-linker │        │
│                                           │ (목업 연결)    │        │
│                                           └────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 1.7: 기획 검증 루프 게이트 (Planning Loop Gate) ← NEW!       │
│  ┌──────────────────────────┐                                       │
│  │ /planning-loop-supervisor │ ─ 감독관 (생산자 아님)               │
│  └──────────────────────────┘                                       │
│   ├── 문서 간 일관성·추적성·갭·13항목 품질 검증                     │
│   ├── 미달 → 해당 스킬 patch 모드 호출 (반자동, ≤3회)               │
│   ├── 프로젝트별 게이트 파생                                        │
│   │     docs/planning/loop/08-derived-gates.md + 00-loop.md         │
│   └── final-planning-approval.md → 개발 착수 readiness 판정         │
│   ※ stargate Phase 3.7에서 자동 호출. 단독 /planning-loop-supervisor│
│   ※ 완료 정의 = 일반 게이트 + 08-derived-gates (빌드가 강제 소비)   │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 2: 프로젝트 셋업 (Setup)                                     │
│  ┌───────────────────┐                                              │
│  │ /project-bootstrap │ ─── 에이전트 팀 + MCP 설정 + 프로젝트 환경  │
│  └───────────────────┘                                              │
│        │                                                            │
│        ├── .claude/agents/ (전문가 에이전트)                        │
│        ├── .claude/commands/ (오케스트레이터)                       │
│        ├── .claude/constitutions/ (프레임워크 헌법) ← NEW!          │
│        ├── .mcp.json (Gemini OAuth)                                 │
│        ├── backend/ (FastAPI, Express 등)                           │
│        ├── frontend/ (React, Next.js 등)                            │
│        └── docker-compose.yml                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 3: 개발 실행 (Execution)                                     │
│  ┌────────────────┐                                                 │
│  │ /orchestrate   │ ─── 반자동화 / 완전 자동화 선택                 │
│  └───────┬────────┘                                                 │
│          │                                                          │
│          ├── 반자동화 ───▶ 태스크별 사용자 지시                     │
│          │                                                          │
│          └── 완전 자동화 (/auto-orchestrate)                        │
│                   │                                                 │
│                   ├── 화면 단위 태스크 분석 ← NEW!                  │
│                   ├── 병렬 실행 (Task 도구 동시 호출)               │
│                   ├── 연결점 검증 태스크 자동 실행                  │
│                   └── Phase 완료 → main 자동 병합                   │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  전문가 에이전트 (Specialists)                                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │  backend-   │ │  frontend-  │ │  database-  │ │    test-    │   │
│  │ specialist  │ │ specialist  │ │ specialist  │ │ specialist  │   │
│  └──────┬──────┘ └──────┬──────┘ └─────────────┘ └─────────────┘   │
│         │               │                                           │
│         │               └── Gemini (디자인 AI) + OAuth              │
│         │                                                           │
│         └── Contract-First TDD + Constitutions 준수                 │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 4: 품질 검증 (Quality)                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │ /vercel-review  │  │ /code-review    │  │/verification-before │ │
│  │ (성능/접근성)   │  │ (2단계 리뷰)   │  │    -completion      │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 5: 감사 (Audit) ← NEW!                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │  Security   │  │   License   │  │   Privacy   │                 │
│  │ (OWASP Top10)│  │ (SPDX 호환) │  │ (GDPR 준수) │                 │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │
│         └────────────────┼────────────────┘                         │
│                          ▼                                          │
│               /audit → docs/audit/audit-report-{date}.md            │
│  ※ 선택적 — 출시 전 감사가 필요할 때 실행                              │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  세션 종료 (Session Report) ← NEW!                                   │
│  ┌──────────────────┐                                               │
│  │ /session-report  │ ──▶ docs/reports/session-{timestamp}.md       │
│  │ (작업 리포트)    │     git 데이터 + 검증 증거 → 구조화 리포트      │
│  └──────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 0. 하이브리드 워크플로우 (`/desktop-bridge`) - NEW!

### 목적
Claude Desktop(시각적 설계)과 Claude Code CLI(에이전틱 구현)를 GitHub Issue로 연결

### 핵심 개념
- **Desktop**: 시각적 대화, 다이어그램 첨부, 풍부한 UI로 설계
- **GitHub**: 버전 관리, 협업, 히스토리 추적, 코드 리뷰 연동
- **CLI**: 파일 시스템 접근, 에이전틱 코드 생성, 테스트 실행

### GitHub 연동 설정 (필수)

> `/desktop-bridge` 사용 전 GitHub 연동이 필요합니다.

**방법 1: gh CLI 사용 (권장)**
```bash
# 설치
brew install gh        # Mac
winget install GitHub.cli  # Windows
sudo apt install gh    # Linux

# 인증
gh auth login
# → 브라우저에서 GitHub 계정 로그인
```

**방법 2: GitHub MCP 사용**
```bash
# install.sh 실행 시 GitHub MCP 선택
./install.sh
# → GitHub Personal Access Token 입력
# → https://github.com/settings/tokens 에서 생성
```

**연동 확인:**
```bash
gh auth status
# ✓ Logged in to github.com as {username}
```

### 두 가지 모드

#### 1. `publish` 모드 (Desktop → GitHub)

```bash
/desktop-bridge publish
```

**워크플로우**:
```
Phase 1: 기획 문서 수집
├── specs/screens/*.yaml 읽기
├── docs/planning/*.md 읽기
└── 문서 검증
    ↓
Phase 2: Issue 내용 구성
├── 제목: [Design] {프로젝트명} - 아키텍처 및 화면 명세
├── 본문: 요약 + 화면 체크리스트 + 기술 스택
└── 라벨: design, from-desktop
    ↓
Phase 3: GitHub Issue 생성
├── gh issue create 실행
└── Issue 번호 획득
    ↓
Phase 4: 연결 정보 저장
└── .claude/desktop-bridge-state.json
```

#### 2. `implement` 모드 (GitHub → CLI)

```bash
/desktop-bridge implement #123
```

**워크플로우**:
```
Phase 1: Issue 내용 로드
├── gh issue view #{N} 실행
└── 본문 파싱 (화면 목록, 기술 스택)
    ↓
Phase 2: 로컬 명세 생성
├── specs/screens/*.yaml 복원
└── docs/planning/*.md 복원
    ↓
Phase 3: TASKS.md 생성
├── /tasks-generator 연동
└── Issue 화면 체크리스트 → Task 변환
    ↓
Phase 4: 구현 준비 완료
└── /project-bootstrap 또는 /auto-orchestrate 선택
```

### 진행 상황 동기화

```
구현 진행 중:
├── Phase 완료 시 → Issue 코멘트 자동 추가
├── 화면 완료 시 → Issue 체크박스 자동 체크
└── 전체 완료 시 → Issue 자동 닫기 + PR 연결
```

### 트리거
```
/desktop-bridge publish    # Desktop에서 GitHub Issue 생성
/desktop-bridge implement #123  # CLI에서 Issue 기반 구현 시작
```

---

## 1. 기획 스킬 (`/socrates`)

### 목적
아이디어를 21개 질문으로 정제하여 6개 기획 문서 생성

### v1.7.5 주요 변경
- **레벨별 기술 스택 제안**: 입문자/중급자/고급자에 따라 다른 방식으로 기술 스택 제안
- **동적 질문 구성**: 사용자 레벨에 맞춰 질문 깊이 조절

### 트리거
```
"기획 시작해줘"
"프로젝트 기획해줘"
/socrates
```

### 워크플로우
```
1. 환경 체크 (Git, curl)
       ↓
2. 슬랙 웹훅 URL 질문 (선택)
       ↓
3. Q1~Q21 순차 질문 (AskUserQuestion)
   └── Q3: 사용자 레벨 파악 (입문/중급/고급)
       ↓
4. Q7 완료 후 세렌디피티 (랜덤 도메인 연결 제안)
       ↓
5. Q21 완료 후 심층 인터뷰 (Deep Dive)
       ↓
6. 6개 문서 생성 (docs/planning/)
   └── 06-screens.md (화면 중심 기획) ← NEW!
       ↓
7. /screen-spec 자동 호출 ← NEW!
       ↓
8. /tasks-generator 자동 호출
```

### 생성 문서
```
docs/planning/
├── 01-prd.md              # 제품 요구사항 정의서
├── 02-trd.md              # 기술 요구사항 정의서
├── 03-user-flow.md        # 사용자 흐름도
├── 04-database-design.md  # 데이터베이스 설계
├── 05-design-system.md    # 디자인 시스템
├── 06-screens.md          # 화면 목록 (NEW!)
└── project-summary.md     # 프로젝트 요약
```

---

## 2. 화면 명세 스킬 (`/screen-spec`) - NEW!

### 목적
소크라테스 결과를 기반으로 화면별 상세 명세(YAML v2.0) 생성

### 핵심 개념
- **화면이 주도하되, 도메인이 방어한다**
- `data_requirements`로 화면이 필요한 데이터만 선언
- 백엔드 API와 느슨한 결합 유지

### 트리거
```
/socrates 완료 후 자동 호출
/screen-spec
"화면 명세 만들어줘"
```

### 워크플로우
```
1. docs/planning/06-screens.md 읽기
       ↓
2. 화면별 YAML 생성 (100줄/화면 목표)
   ├── data_requirements (필요 데이터)
   ├── components (UI 구성요소)
   └── tests (필수 시나리오 3-5개)
       ↓
3. specs/screens/*.yaml 저장
       ↓
4. [선택] Stitch MCP 연동 ⭐ NEW!
   ├── YAML → Stitch 프롬프트 변환
   ├── 디자인 목업 자동 생성
   ├── 결과 추출 (PNG, HTML, 토큰)
   └── YAML에 design_reference 추가
```

### 생성 파일
```yaml
# specs/screens/product-list.yaml
version: "2.0"
screen:
  name: 상품 목록
  route: /products
  layout: sidebar-main
  auth: false

data_requirements:
  - resource: products
    needs: [id, name, price, thumbnail]

components:
  - id: product_grid
    data_source: { resource: products }
```

---

## 3. 태스크 생성 스킬 (`/tasks-generator`)

### 목적
기획 문서 또는 코드베이스를 분석하여 화면 단위 TASKS.md 생성

### v1.7.5 주요 변경
- **화면 단위 태스크 구조**: `P{Phase}-S{Screen}-T{Task}`
- **연결점 검증 태스크**: `P{Phase}-S{Screen}-V`
- **Domain-Guarded 검증**: 화면 요구사항 vs 리소스 제공 필드 검증

### 트리거
```
/screen-spec 완료 후 자동 호출
/tasks-generator
/tasks-generator analyze
```

### 새 워크플로우 (v1.7.5)
```
Phase 0: Domain Resources 확인
  └── specs/domain/resources.yaml 읽기
       ↓
Phase 1: Screen 명세 + data_requirements 추출
  └── specs/screens/*.yaml 읽기
       ↓
Phase 2: Interface Contract Validation
  └── 화면 요구사항 vs 리소스 필드 검증
  └── 불일치 발견 시 사용자에게 알림
       ↓
Phase 3: Backend Resource 태스크 생성
  └── P{Phase}-R{Resource}-T{Task}
       ↓
Phase 4: Frontend Screen 태스크 생성
  └── P{Phase}-S{Screen}-T{Task}
       ↓
Phase 5: Verification 태스크 생성
  └── P{Phase}-S{Screen}-V
```

### Task ID 형식
| 형식 | 용도 | 예시 |
|------|------|------|
| `P{N}-R{M}-T{X}` | Backend Resource | P2-R1-T1: Products API |
| `P{N}-S{M}-T{X}` | Frontend Screen | P2-S1-T1: Product List UI |
| `P{N}-S{M}-V` | Screen Verification | P2-S1-V: 연결점 검증 |

### 생성 문서
```
docs/planning/
└── 06-tasks.md   # 화면 단위 태스크 + 연결점 검증
```

---

## 4. 디자인 연결 스킬 (`/design-linker`)

### 목적
design/ 폴더의 목업을 TASKS.md의 태스크에 연결

### 트리거
```
"디자인 연결해줘"
"목업 연결해줘"
/design-linker
```

### 워크플로우
```
1. design/ 폴더 스캔
       ↓
2. 목업 파일 분류 (HTML, PNG)
       ↓
3. 06-tasks.md 파싱
       ↓
4. Phase/Task ↔ 목업 매핑
       ↓
5. 레퍼런스 섹션 추가
```

---

## 4.5. 기획 검증 루프 게이트 (`/planning-loop-supervisor`) - NEW!

### 목적
개별 기획 스킬들이 만든 설계문서(PRD·TRD·User Flow·DB·Design System·Screens·Tasks·Coding Convention)가 **서로 일관되고 누락 없이 연결되어 개발 가능한 하나의 설계 패키지**로 수렴했는지 검증하고, 미달이면 해당 스킬로 되돌려 보완하며, 설계서에서 **프로젝트별 세부 게이트를 파생 생성**하는 상위 루프 **감독관**(생산자 아님).

### 트리거
```
"기획 문서 검토해줘"
"설계 일관성·추적성 검사"
"개발 가능한지 확인"
/planning-loop-supervisor
※ /stargate Phase 3.7에서 자동 호출
```

### 워크플로우
```
LOOP 0 Inventory → 1 Collection → 2 Role → 3 Consistency → 4 Gap → 5 Quality(13항목)
→ 6 Routing → 7 Patch(반자동: revision-request → 사용자 확인 → 스킬 patch 모드 호출)
→ 8 Re-eval(≤3회) → 9 Gate Derivation(REQ 추출 → 추적성 → Hard/Metric/Rubric/Domain/Evidence
                                     → 게이트 자가검증) → 10 Final Approval
```

### 생성 문서 (docs/planning/loop/)
```
loop-state.json / planning-loop-report.md / document-gap-report.md
revision-request-NN.md / 00-loop.md / 08-derived-gates.md / final-planning-approval.md
```

### 완료 정의 변경 (Integration Rule)
다운스트림 빌드/품질 루프는 `00-loop.md` + `08-derived-gates.md`를 **함께** 완료 기준으로 삼는다. **08-derived-gates.md의 Hard/Metric/Domain 게이트를 증거와 함께 통과하기 전까지 "구현 완료"를 선언할 수 없다** (`/auto-orchestrate`·`/verification-before-completion`이 강제).

---

## 5. 프로젝트 부트스트랩 스킬 (`/project-bootstrap`)

### 목적
AI 에이전트 팀 + 프로젝트 환경 자동 구성

### v1.7.5 주요 변경
- **Constitutions 자동 설치**: 프레임워크별 헌법 파일 복사
- **Gemini OAuth**: API 키 대신 OAuth 인증 사용

### 트리거
```
"에이전트 팀 만들어줘"
"에이전트 팀 구성해줘"
/project-bootstrap
```

### 워크플로우

#### 1단계: 기술 스택 확인
```
기술 스택 명시됨?
    ├── 예 → 2단계로 진행
    └── 아니오 → /socrates 자동 발동
```

#### 2단계: 세부 질문 (AskUserQuestion)
```
질문 2-1: 데이터베이스 선택
    1. PostgreSQL (권장)
    2. MySQL
    3. SQLite
    4. MongoDB
    5. MariaDB
    6. Supabase
    7. Firebase

질문 2-2: 인증 포함 여부
    1. 예 (권장) - JWT 인증
    2. 아니오

질문 2-3: 추가 기능 선택 (다중)
    1. 벡터 DB (PGVector)
    2. Redis 캐시
    3. 3D 엔진 (Three.js)
    4. 없음

질문 2-4: MCP 서버 선택 (다중)
    1. Gemini (권장) - OAuth 인증
    2. GitHub - API 연동
    3. PostgreSQL - DB 쿼리
    4. 기본값만

질문 3: 프로젝트 셋업 범위
    1. 예 (권장) - 전체 환경
    2. 에이전트 팀만
```

#### 3단계: 자동 생성
```
[에이전트 팀 생성]
    .claude/agents/
        ├── backend-specialist.md
        ├── frontend-specialist.md
        ├── database-specialist.md
        └── test-specialist.md
    .claude/commands/
        ├── orchestrate.md
        └── integration-validator.md

[Constitutions 설치] ← NEW!
    .claude/constitutions/
        ├── fastapi/
        │   ├── dotenv.md
        │   ├── auth.md
        │   └── api-design.md
        ├── nextjs/
        │   └── auth.md
        └── common/
            └── uuid.md

[MCP 설정] (Gemini 선택 시)
    .mcp.json
        └── gemini: OAuth 인증

[Docker Compose]
    docker-compose.yml

[백엔드 생성]
    backend/ (FastAPI, Express 등)

[프론트엔드 생성]
    frontend/ (React+Vite, Next.js 등)

[Git 초기화]
    .gitignore + Initial commit
```

---

## 6. 오케스트레이션 (`/orchestrate`)

### 목적
TASKS.md 기반으로 전문가 에이전트를 조율하여 개발 실행

### 트리거
```
/orchestrate
"개발 시작해줘"
```

### 실행 모드 선택
```
┌─────────────────────────────────────────────┐
│  실행 모드를 선택하세요                       │
│                                             │
│  1. 반자동화 (Recommended)                  │
│     - 태스크별 사용자 지시                  │
│     - 세밀한 제어 가능                      │
│                                             │
│  2. 완전 자동화                             │
│     - 화면 단위 태스크 분석 → 자동 실행     │
│     - Phase 완료 → main 자동 병합           │
└─────────────────────────────────────────────┘
```

### 완전 자동화 모드 (`/auto-orchestrate`)
```
1. TASKS.md 파싱
       ↓
2. 화면 단위 의존성 그래프 구축
       ↓
3. 실행 큐 생성
       ↓
4. Round 실행
    ├── 독립 화면 → 병렬 실행
    └── 의존 화면 → 선행 완료 대기
       ↓
5. 연결점 검증 (P-S-V) 자동 실행 ← NEW!
       ↓
6. Phase 완료
    ├── Constitutions 위반 검사 ← NEW!
    ├── 테스트 실행
    ├── 빌드 확인
    └── main 자동 병합
       ↓
7. 다음 Phase
       ↓
(전체 완료까지 반복)
```

---

## 7. Constitutions 시스템 - NEW!

### 목적
프레임워크별 필수 규칙으로 반복되는 실수 방지

### 헌법 목록
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
    ├── uuid.md        # RFC 4122 UUID 준수
    └── seed-validation.md
```

### 동작 방식
```
1. 에이전트가 코드 생성 전 관련 헌법 읽기
       ↓
2. 헌법 규칙에 맞게 코드 생성
       ↓
3. Phase 완료 시 위반 검사
       ↓
4. 위반 발견 시 자동 수정 또는 경고
```

---

## 8. 전문가 에이전트

### backend-specialist
- **역할**: 서버 사이드 로직, API 엔드포인트, DB 접근
- **도구**: Read, Edit, Write, Bash, Grep, Glob
- **TDD**: Contract-First 워크플로우
- **Constitutions**: fastapi/*.md, common/*.md 준수

### frontend-specialist
- **역할**: UI 컴포넌트, 스타일링, 레이아웃, 애니메이션
- **도구**: Read, Edit, Write, Bash, Grep, Glob, `mcp__gemini__*`
- **Constitutions**: tailwind/*.md, nextjs/*.md 준수
- **하이브리드 모델**:
  ```
  ┌─────────────────────────────────────────┐
  │  Gemini → 디자인 코딩 생성              │
  │       ↓                                 │
  │  Claude → 통합/TDD/품질 검증            │
  │       ↓                                 │
  │  Anti-AI 체크리스트 적용                │
  └─────────────────────────────────────────┘
  ```

### database-specialist
- **역할**: 스키마 설계, 마이그레이션, DB 제약조건
- **도구**: Read, Edit, Write, Bash, Grep, Glob
- **Constitutions**: supabase/*.md, common/*.md 준수

### test-specialist
- **역할**: Contract-First TDD, 테스트 작성, 품질 게이트
- **도구**: Read, Edit, Write, Bash, Grep, Glob
- **Phase 0 담당**: 계약 정의, 테스트 작성, 목 생성

---

## 9. 품질 검증 스킬

### `/code-review` - 2단계 코드 리뷰
- **Stage 1**: Spec Compliance Review (요구사항 일치)
- **Stage 2**: Code Quality Review (SOLID, 테스트, 보안)
- **Constitutions 위반 검사 포함**

### `/vercel-review` - 프론트엔드 품질 보장
- **45개 React/Next.js 성능 규칙** 자동 검사
- **100+ 웹 인터페이스 가이드라인** 준수 확인
- **Anti-Patterns 자동 감지**

### `/verification-before-completion` - 완료 전 검증
- 커밋이나 PR 전에 반드시 검증 명령어 실행
- 출력 확인 후 증거와 함께 결과 보고

---

## 10. 전체 사용 흐름 예시

### 하이브리드 워크플로우 (Desktop ↔ CLI) - NEW!
```
[Claude Desktop에서 시작]
사용자: "/socrates"
    ↓
[21개 질문 진행]
    ↓
[기획 문서 생성]
    ↓
사용자: "/screen-spec"
    ↓
[화면 명세 YAML 생성]
    ↓
사용자: "/desktop-bridge publish"
    ↓
[GitHub Issue #123 생성]
    ↓
────────────────────────────────
[Claude Code CLI로 전환]
사용자: "/desktop-bridge implement #123"
    ↓
[Issue 내용 로드 + TASKS.md 자동 생성]
    ↓
사용자: "/project-bootstrap"
    ↓
[에이전트 팀 + 환경 셋업]
    ↓
사용자: "/auto-orchestrate"
    ↓
[완전 자동화 개발]
    ↓
[Issue에 진행 상황 자동 코멘트]
    ↓
[PR 생성 + Issue 연결]
    ↓
[Issue 자동 닫기]
    ↓
[완료!]
```

### 신규 프로젝트 (CLI만 사용)
```
사용자: "에이전트 팀 만들어줘"
    ↓
(기술 스택 없음 → /socrates 자동 발동)
    ↓
[21개 질문 진행 + 레벨별 기술 스택 제안]
    ↓
[6개 기획 문서 생성]
    ↓
[/screen-spec 자동 호출]
    ↓
[화면별 YAML 명세 생성]
    ↓
[/tasks-generator 자동 호출]
    ↓
[화면 단위 TASKS.md 생성]
    ↓
[/project-bootstrap 재개]
    ↓
[질문 2-1 ~ 2-4 진행]
    ↓
[프로젝트 환경 + Constitutions 설치]
    ↓
사용자: "/auto-orchestrate"
    ↓
[완전 자동화 + 연결점 검증]
    ↓
[완료!]
```

### 기존 프로젝트 (코드 분석)
```
사용자: "/tasks-generator analyze"
    ↓
[코드베이스 분석]
    ↓
[화면 단위 TASKS.md 생성]
    ↓
사용자: "/auto-orchestrate"
    ↓
[완전 자동화 실행]
    ↓
[/code-review 호출]
    ↓
[/vercel-review 호출]
    ↓
[완료!]
```

---

## 11. TUI 인스톨러

### 목적
인터랙티브하게 스킬과 Constitutions 설치

### 실행 방법
```bash
# Mac/Linux
chmod +x install.sh
./install.sh

# Windows
.\install.ps1
```

### 기능
- 스킬 카테고리 선택 설치 (Core, Orchestration, Quality 등)
- 프레임워크 Constitutions 선택 설치
- Slack 웹훅 자동 설정
- Gemini MCP OAuth 인증 (Node.js 기반)
- `/socrates` 시작 가이드

### v1.7.7 Gemini MCP 설치 변경

**Node.js 기반으로 전환** (Rust 의존성 제거)

```
기존 (v1.7.6 이전):
  Rust/Cargo 필요 → anthropic-quickstarts 빌드

변경 (v1.7.7):
  Node.js 기반 MCP 서버 → Rust 불필요
```

**설치 흐름**:
```
[1/3] gemini CLI 설치 확인
      └── npm install -g @google/gemini-cli

[2/3] OAuth 브라우저 인증
      └── gemini 명령어로 브라우저 팝업

[3/3] MCP 서버 설정
      └── mcp-servers/gemini-mcp → ~/.gemini-mcp/ 복사
      └── .mcp.json 등록 (node 명령어)
```

**주요 변경 파일**:
```
mcp-servers/gemini-mcp/
├── index.js       # 순수 Node.js MCP 서버
└── package.json   # type: "module", 의존성 없음
```

> ⚠️ **절대 규칙**: Gemini MCP는 OAuth 인증만 사용. API 키 방식 절대 금지.

---

## 12. 파일 구조 요약

```
프로젝트/
├── .claude/
│   ├── agents/              # 전문가 에이전트
│   │   ├── backend-specialist.md
│   │   ├── frontend-specialist.md
│   │   ├── database-specialist.md
│   │   └── test-specialist.md
│   ├── commands/            # 오케스트레이터/검증기
│   │   ├── orchestrate.md
│   │   └── integration-validator.md
│   ├── constitutions/       # 프레임워크 헌법 ← NEW!
│   │   ├── fastapi/
│   │   ├── nextjs/
│   │   ├── supabase/
│   │   └── tailwind/
│   └── settings.json
├── .mcp.json                # MCP 서버 설정 (Gemini OAuth)
├── docs/planning/           # 기획 문서
│   ├── 01-prd.md
│   ├── 02-trd.md
│   ├── 03-user-flow.md
│   ├── 04-database-design.md
│   ├── 05-design-system.md
│   ├── 06-screens.md        # 화면 목록 ← NEW!
│   └── 06-tasks.md          # 화면 단위 태스크
├── specs/                   # 명세 파일 ← NEW!
│   ├── domain/
│   │   └── resources.yaml
│   └── screens/
│       └── *.yaml
├── backend/                 # 백엔드 코드
├── frontend/                # 프론트엔드 코드
├── design/                  # 목업 (Google Stitch)
└── docker-compose.yml
```

---

## 13. 새로운 통합 스킬 (v1.8.0) - NEW!

### `/reverse` - 코드 → 명세 역추출

기존 프로젝트에서 명세를 자동 추출하여 Claude Labs 워크플로우에 통합합니다.

```
/reverse scan      # 프로젝트 구조 스캔
/reverse extract   # 명세 초안 추출
/reverse review    # 추출된 명세 리뷰
/reverse finalize  # 명세 확정 + 갭 분석
```

**추출 대상:**
- 도메인 리소스 (SQLAlchemy, Prisma, Django ORM)
- API 계약 (FastAPI, Express, Django)
- 화면 명세 (React, Next.js, Vue)

**워크플로우:**
```
기존 코드베이스
    ↓
/reverse scan → 구조 분석
    ↓
/reverse extract → 명세 역추출
    ├── specs/domain/resources.yaml
    ├── specs/screens/*.yaml
    └── specs/api/*.yaml
    ↓
/reverse finalize → 갭 분석
    ↓
/tasks-generator → 남은 작업 TASKS.md
```

---

### `/sync` - 명세-코드 동기화 검증

명세와 코드 사이의 **드리프트(drift)**를 감지하고 일관성을 유지합니다.

```
/sync              # 전체 동기화 검증
/sync domain users # 특정 도메인 검증
/sync --fix        # 자동 수정 제안
/sync --ci --threshold 80  # CI 모드
```

**드리프트 유형:**
| 유형 | 설명 | 심각도 |
|------|------|--------|
| 추가 드리프트 | 코드에만 있고 명세에 없음 | Low |
| 삭제 드리프트 | 명세에만 있고 코드에 없음 | High |
| 수정 드리프트 | 명세와 코드가 다름 | Medium |

**동기화율 계산:**
```
동기화율 = (일치 + 0.5×부분일치) / 전체 × 100%
```

---

### `/trinity` - 五柱 코드 품질 평가

HyoDo의 五柱(眞善美孝永) 철학 기반 코드 품질 평가 시스템입니다.

```
/trinity            # 전체 프로젝트 평가
/trinity --quick    # 빠른 평가 (眞善만)
/trinity --ci       # CI 모드
```

**五柱 가중치:**
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

**Score별 조치:**
| Score | 상태 | 조치 |
|-------|------|------|
| 90+ | Excellent | 자동 승인 가능 |
| 70-89 | Good | 리뷰 권장 |
| 50-69 | Needs Work | 개선 필수 |
| <50 | Critical | 병합 차단 |

**三 Strategists:**
- 장영실 - 기술 아키텍처 (眞)
- 이순신 - 보안 & 안정성 (善)
- 신사임당 - UX & 명확성 (美)

---

### `/cost-router` - AI 비용 최적화 라우팅

태스크 복잡도에 따라 최적의 모델을 자동 선택하여 **40-70% 비용 절감**을 달성합니다.

```
┌─────────────────────────────────────────┐
│  Tier Classification                     │
├─────────────────────────────────────────┤
│  FREE     - 읽기 전용, 검색     ($0)    │
│  CHEAP    - 단순 편집, 포맷팅   (haiku) │
│  EXPENSIVE - 새 기능, 리팩토링  (opus)  │
└─────────────────────────────────────────┘
```

**auto-orchestrate 연동:**
- 각 태스크 실행 전 복잡도 분석
- 적절한 Tier/모델 자동 선택
- 실시간 비용 모니터링
- 실패 시 자동 업그레이드 (haiku → sonnet → opus)

**비용 리포트:**
```
┌─────────────────────────────────┐
│  Cost Router Report             │
├─────────────────────────────────┤
│  총 태스크: 15                  │
│  실제 비용: $4.50               │
│  절감 비용: $5.50               │
│  절감률: 55%                    │
└─────────────────────────────────┘
```

---

## 14. 확장된 워크플로우 (v1.11.0)

### 신규 프로젝트 흐름
```
아이디어 → /spike(선택) → /neurion → /socrates → /screen-spec → /tasks-generator
    ↓
/project-bootstrap → /auto-orchestrate (+ /cost-router 자동)
    ↓
개발 중간 → /sync (동기화 검증)
    ↓
Phase 완료 → /trinity (품질 평가) → /audit(선택)
    ↓
/session-report → 완성!
```

### 기존 프로젝트 흐름
```
기존 코드베이스
    ↓
/reverse scan → /reverse extract → /reverse finalize
    ↓
specs/screens/*.yaml 생성
    ↓
/tasks-generator analyze → 갭 분석 TASKS.md
    ↓
/auto-orchestrate → /trinity → /audit → /session-report → 완성!
```

---

## 15. Spike Workflow (`/spike`) - NEW!

### 목적
불확실한 영역을 탐색하는 전용 모드. 품질 게이트를 완화하여 빠른 프로토타이핑으로 가설을 검증한다.

### 트리거
```
/spike
"탐색해봐", "프로토타이핑", "실험", "가능한지 봐"
```

### 워크플로우
```
Step 1: Scope 정의
├── 탐색 질문/가설 명확화
├── 시간 제한 설정 (기본 30분)
└── 성공 기준 정의
    ↓
Step 2: 탐색 모드 활성화
├── 품질 게이트 완화 (린트/테스트 건너뛰기 허용)
└── git branch spike/{topic} 생성
    ↓
Step 3: 빠른 프로토타이핑
├── 최소한의 코드로 가설 검증
└── POC 작성
    ↓
Step 4: 결과 리포트
└── docs/spikes/spike-{date}-{topic}.md 생성
    ├── 결론, 발견사항, 권장사항
    └── 코드 스니펫
    ↓
Step 5: 정리
├── 브랜치 삭제/유지 결정
└── /socrates 또는 /tasks-generator에 연결
```

### 파이프라인 위치
```
Phase 0 (탐색) — socrates 이전 또는 독립 실행
/spike → (결과 확인) → /socrates → /screen-spec → ...
```

---

## 16. Audit Workflow (`/audit`) - NEW!

### 목적
보안(OWASP Top 10), 라이선스(SPDX), 개인정보(GDPR) 관점에서 프로젝트를 체계적으로 감사한다.

### 트리거
```
/audit                  # 전체 감사
/audit security         # 보안만
/audit license          # 라이선스만
/audit gdpr             # GDPR만
"보안 감사", "라이선스 확인", "취약점 스캔"
```

### 워크플로우
```
Module 1: Security (보안)
├── 의존성 취약점 스캔 (npm audit / pip-audit)
├── OWASP Top 10 코드 스캔
├── 시크릿 탐지
└── 심각도별 분류 (Critical/High/Medium/Low)
    ↓
Module 2: License (라이선스)
├── 의존성 라이선스 수집
├── SPDX 호환성 검증
└── Copyleft 감염 위험 체크
    ↓
Module 3: Privacy (개인정보)
├── PII 데이터 흐름 분석
├── GDPR 체크리스트 검증
└── 개인정보 리스크 리포트
    ↓
리포트 생성
└── docs/audit/audit-report-{date}.md
```

### 파이프라인 위치
```
Phase 5 (감사) — 품질 검증 이후
... → /trinity → /audit → /session-report
```

---

## 17. Session Report (`/session-report`) - NEW!

### 목적
세션에서 수행한 작업을 체계적으로 분석하여 구조화된 리포트를 생성한다.

### 트리거
```
/session-report
"세션 리포트", "작업 정리", "오늘 뭐했는지", "세션 요약"
```

### 워크플로우
```
Step 1: 데이터 수집
├── git log/diff (세션 시작 이후 커밋)
├── last-session.json (이전 세션 연속성)
└── verification-evidence.json (검증 증거)
    ↓
Step 2: 변경 분석
├── 카테고리별 그룹핑 (기능/버그/테스트/문서/리팩토링)
└── 영향도 분석
    ↓
Step 3: 메트릭 요약
├── 정량 메트릭 (커밋 수, 파일 수, 라인 수)
└── 품질 메트릭 (테스트 통과율, 수정 사이클)
    ↓
Step 4: 리포트 생성
└── docs/reports/session-{timestamp}.md
```

### 연동
- `verification-before-completion` → 검증 증거를 품질 메트릭에 반영
- `session-summary-saver.js` (Stop 훅) → 세션 메타데이터 활용

---

**문서 생성일**: 2026-03-15
**버전**: 1.11.0 (Spike + Audit + Session Report)
