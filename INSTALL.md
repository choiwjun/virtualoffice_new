# 🧪 Claude Labs 설치 가이드

> 아이디어만으로 풀스택 웹앱을 완성하는 AI 개발 파트너

**버전**: 1.7.6
**최종 업데이트**: 2026-01-28

---

## 설치 방법

### 방법 1: TUI 인터랙티브 설치 (권장)

#### Mac / Linux

```bash
chmod +x install.sh
./install.sh
```

#### Windows (PowerShell)

```powershell
.\install.ps1
```

**TUI 인스톨러 기능:**
- 스킬 카테고리 선택 설치 (Core, Orchestration, Quality 등)
- 프레임워크 헌법 선택 설치 (FastAPI, Next.js, Supabase, Tailwind)
- Slack 웹훅 자동 설정
- Gemini MCP OAuth 인증 + 자동 빌드
- `/socrates` 시작 가이드

### 방법 2: Claude Code에게 맡기기

```bash
# 압축 해제 후 Claude Code 실행
unzip claude-labs-v1.7.6.zip
claude

# Claude Code에게 요청
> 이거 설치해줘
```

### 방법 3: 수동 설치

#### Mac / Linux

```bash
# 전역 설치
rsync -av .claude/ ~/.claude/

# 프로젝트 설치
rsync -av .claude/ ./.claude/
```

#### Windows PowerShell

```powershell
# 전역 설치
Copy-Item -Recurse -Force .\.claude\* $env:USERPROFILE\.claude\

# 프로젝트 설치
Copy-Item -Recurse -Force .\.claude\* .\.claude\
```

### 제거

```bash
# Mac/Linux
./uninstall.sh

# Windows - 수동 삭제
Remove-Item -Recurse -Force $env:USERPROFILE\.claude
```

---

## 포함된 내용

### 스킬 (27개)

**Core 스킬:**
- `/socrates` - 동적 소크라테스 질문으로 6개 기획 문서 생성
- `/screen-spec` - 화면별 상세 명세(YAML v2.0) 생성 (NEW!)
- `/tasks-generator` - TDD + 화면 단위 태스크 + 연결점 검증

**Orchestration 스킬:**
- `/auto-orchestrate` - 의존성 기반 완전 자동화 개발 + Phase Checkpoint
- `/ultra-thin-orchestrate` - 200개 태스크까지 컨텍스트 94% 절감

**Quality 스킬:**
- `/code-review` - 2단계 리뷰 (Spec Compliance → Code Quality)
- `/systematic-debugging` - 4단계 근본 원인 분석
- `/verification-before-completion` - 완료 전 증거 기반 검증

**Utility 스킬:**
- `/project-bootstrap` - AI 에이전트 팀 + 프로젝트 환경 자동 셋업
- `/deep-research` - 5개 검색 API 병렬 리서치
- `/chrome-browser` - Chrome 브라우저 제어 및 웹앱 테스트
- `/design-linker` - 목업 디자인을 TASKS.md에 자동 연결

**Reference 스킬:**
- `/fastapi-latest` - FastAPI 최신 문서 기반 백엔드 개발
- `/react-19` - React 19 최신 문서 기반 프론트엔드 개발
- `/rag` - Context7 MCP 연동 최신 문서 기반 코드 생성

### 에이전트 (16개)

**구현 에이전트:**
- orchestrator (opus) - 전략적 판단, 태스크 분해
- backend-specialist (sonnet) - API 설계, 비즈니스 로직
- frontend-specialist (sonnet) - UI 구현, Gemini 연동
- database-specialist (haiku) - 스키마, 마이그레이션
- test-specialist (haiku) - TDD, 품질 게이트
- 3d-engine-specialist (sonnet) - Three.js, IFC/BIM

**Ultra-Thin 에이전트:**
- task-executor (sonnet) - 개별 Task 자율 실행
- dependency-resolver (haiku) - 의존성 분석

**분석/설계 에이전트:**
- architecture-analyst, requirements-analyst, system-designer
- api-designer, task-planner, impact-analyzer

### Constitutions (헌법) - NEW!

프레임워크별 필수 규칙으로 반복되는 실수 방지:

**FastAPI:**
- `auth.md` - JWT + OAuth2 패턴
- `api-design.md` - Resource-Oriented API Design
- `dotenv.md` - .env 파일 로드 필수

**Next.js:**
- `auth.md` - NextAuth.js 단일 인증 레이어
- `api-design.md` - 화면 비종속 API
- `api-routes.md` - App Router 규칙

**Supabase:**
- `rls.md` - Row Level Security 필수
- `auth-integration.md` - 외부 Auth 연동

**Tailwind CSS:**
- `v4-syntax.md` - v4 문법 규칙 (v3과 다름!)

**Common:**
- `uuid.md` - RFC 4122 UUID 준수
- `seed-validation.md` - Seed ↔ Schema 일치

---

## 빠른 시작

### 1. 아이디어부터 시작 (권장)

```bash
# 소크라테스로 기획 시작
/socrates

# 21개 질문 → 6개 기획 문서 생성
# → /screen-spec 자동 호출
# → /tasks-generator 자동 호출
```

### 2. 기술 스택을 알 때

```bash
# 에이전트 팀 생성
"FastAPI + React로 에이전트 팀 만들어줘"

# 질문 3개 후 프로젝트 환경 셋업
```

### 3. 기존 프로젝트에 적용

```bash
# 코드 분석 후 TASKS.md 생성
/tasks-generator analyze

# 개발 자동화 시작
/auto-orchestrate
```

---

## 새로운 워크플로우 (v1.7.5)

```
/socrates → 06-screens.md (화면 중심 기획)
    ↓
/screen-spec → specs/screens/*.yaml (화면별 상세 명세)
    ↓
/tasks-generator → TASKS.md (화면 단위 + 연결점 검증)
    ↓
/auto-orchestrate → 실행!
```

**핵심 변화:**
- 화면 단위로 Frontend + Backend + Integration 묶음
- 연결점 검증 태스크(P-S-V) 자동 생성
- Constitutions로 프레임워크별 실수 사전 방지

---

## 요구사항

### 필수

- Claude Code CLI (최신 버전)
- Git
- Node.js v18+ (MCP 서버용)

### 스킬별 추가 요구사항

- `/project-bootstrap` - Python 3, Node.js
- `/deep-research` - curl, jq, Python 3
- `/chrome-browser` - Chrome, Claude in Chrome 확장 (v1.0.36+)

---

## MCP 서버 설정

### Gemini MCP (OAuth 인증)

v1.7.5부터 Gemini MCP는 **OAuth 인증**을 사용합니다 (API 키 방식 X):

```bash
# TUI 인스톨러에서 자동 설정
./install.sh
# → "Gemini MCP 설치하시겠습니까?" → 예
# → 브라우저에서 Google 로그인
```

### 기타 MCP 서버

- **context7** - 최신 라이브러리 문서 검색
- **playwright** - 브라우저 자동화, E2E 테스트

---

## 문제 해결

### 스킬이 보이지 않을 때

```bash
# .claude 폴더 확인
ls -la ~/.claude/skills/
```

### Gemini 인증 오류

```bash
# 토큰 초기화
rm -rf ~/.gemini/

# 재인증
./install.sh  # Gemini MCP 선택
```

### Windows에서 gum 없이 설치

PowerShell 인스톨러는 gum 없이도 동작합니다 (텍스트 기반 대체 모드).

---

## 라이선스

MIT License

---

## 문의

- GitHub Issues: [저장소 URL]
- 문서: SKILLS_SUMMARY.md 참조
