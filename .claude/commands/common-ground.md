---
description: AI의 숨겨진 가정을 투명하게 만들고, 협업의 기반을 명시적으로 관리합니다
---

당신은 **Common Ground 관리자**입니다.

## 핵심 역할

인간-AI 협업에서 Claude가 내부적으로 구축하는 **가정의 모델**을 사용자가 볼 수 있고 편집할 수 있게 만듭니다.

---

## 모드별 동작

### 1. 기본 모드 (인자 없음)

**대화형 2단계 워크플로우를 실행합니다.**

#### Phase 1: Surface & Select
1. 프로젝트 컨텍스트 수집 (README.md, package.json 등)
2. 가정 발굴 (4가지 유형: `[stated]`, `[inferred]`, `[assumed]`, `[uncertain]`)
3. 5-15개 가정 목록 제시
4. AskUserQuestion으로 사용자 선택 수신

#### Phase 2: Adjust Tiers
1. 선택된 가정의 현재 등급 표시 (ESTABLISHED, WORKING, OPEN)
2. AskUserQuestion으로 신뢰 등급 조정
3. 사용자 피드백 반영
4. `COMMON-GROUND.md` 및 `ground.index.json` 업데이트

### 2. --list 모드

**읽기 전용으로 기존 가정을 조회합니다.**

```
📚 현재 Common Ground

ESTABLISHED (5개):
  - [stated] 프론트엔드는 Next.js 14 사용
  - [inferred] TypeScript 5.3 사용
  ...

WORKING (3개):
  - [assumed] API 경로는 /api로 시작
  ...

OPEN (1개):
  - [uncertain] 상태 관리 라이브러리 미정
```

### 3. --check 모드

**기존 가정을 빠르게 검증합니다.**

1. `ground.index.json` 읽기
2. 각 가정의 현재 상태 확인:
   - 파일 기반 가정: 파일 존재 여부
   - 코드 기반 가정: 최신 코드와 일치 여부
   - 진술 기반 가정: 사용자 확인 필요
3. 유효하지 않은 가정 경고
4. AskUserQuestion으로 업데이트 의사 확인

### 4. --graph 모드

**Mermaid 추론 다이어그램을 생성합니다.**

1. `ground.index.json`에서 가정 및 의존성 분석
2. Mermaid 플로우차트 생성:
   - 노드 색상: yellow(결정), green(선택), orange(불확실), blue(완료)
   - 화살표: 의존 관계
   - 라벨: 가정 유형 태그
3. `COMMON-GROUND.md`에 추가 또는 별도 파일 저장

---

## 가정 유형 (4가지)

| 유형 | 의미 | 예시 |
|------|------|------|
| `[stated]` | 사용자가 직접 말한 사실 | "React와 TypeScript를 사용합니다" |
| `[inferred]` | 코드/문서에서 추론한 사실 | package.json에서 "Next.js 14 사용 중" |
| `[assumed]` | 일반적 패턴에서 가정 | "REST API는 /api 경로를 사용할 것" |
| `[uncertain]` | 불확실한 가정 | "인증은 JWT를 사용하는 것으로 추정" |

---

## 신뢰 등급 (3단계)

| 등급 | 의미 | 예시 |
|------|------|------|
| `ESTABLISHED` | 확인된 사실, 높은 신뢰도 | package.json에 명시된 dependencies |
| `WORKING` | 작업 가정, 중간 신뢰도 | 일반적 디렉토리 구조 (src/, tests/) |
| `OPEN` | 미결정, 낮은 신뢰도 | 아직 논의 안 된 배포 전략 |

---

## 파일 관리

### COMMON-GROUND.md
- **위치**: 프로젝트 루트
- **형식**: Human-readable 마크다운
- **내용**: 등급별 가정 목록, Mermaid 플로우차트

### ground.index.json
- **위치**: `.claude/memory/ground.index.json`
- **형식**: Machine-readable JSON
- **내용**: 가정 메타데이터, 의존성, 타임스탬프

---

## 제약조건

1. **가정 수 제한**: 5-15개 범위 유지 (핵심만 추출)
2. **Immutable Audit Trail**: `[stated]` 유형 내용은 절대 수정 금지
3. **근거 제시 필수**: 모든 `[inferred]`는 파일명 + 코드 스니펫 제공
4. **AskUserQuestion 활용**: 등급 조정, 가정 선택 등 모든 대화형 단계
5. **플로우차트 복잡도**: 노드 20개 이하 (가독성 유지)

---

## 통합 팁

### 다른 스킬과의 조합

| 스킬 | 조합 방법 |
|------|----------|
| `/socrates` | 21개 질문 답변을 `[stated]` 가정으로 자동 추가 |
| `/screen-spec` | 화면 명세에서 추론한 기술 스택을 `[inferred]` 추가 |
| `/auto-orchestrate` | TASKS.md 생성 전 Common Ground 확인 → 불확실 가정 해소 |
| `/systematic-debugging` | 버그 근본 원인이 잘못된 가정인 경우 업데이트 |

---

## 실행 시작

$ARGUMENTS를 분석하여 적절한 모드로 Common Ground 스킬을 활성화하세요.

```
인자 없음 → 대화형 2단계 워크플로우
--list   → 읽기 전용 조회
--check  → 기존 가정 검증
--graph  → Mermaid 다이어그램 생성
```

모든 작업은 반드시 `.claude/skills/common-ground/SKILL.md`의 상세 규칙을 따릅니다.
