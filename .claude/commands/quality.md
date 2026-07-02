---
description: 멀티모드 품질 검증. /quality check|review|security|full 로 원하는 검증 수준 선택.
argument-hint: "<mode: check|review|security|full>"
---

# /quality — 멀티모드 품질 검증

> pm-skills의 멀티모드 커맨드 패턴 적용. 하나의 진입점으로 여러 품질 검증 수준 선택.

---

## 사용법

```bash
/quality check      # 빠른 검증 (테스트 + 린트 + 빌드)
/quality review      # 코드 리뷰 (check + 2단계 리뷰)
/quality security    # 보안 검사 (check + OWASP + 시크릿 스캔)
/quality full        # 전체 (check + review + security + 커버리지)
/quality             # 모드 선택 UI 표시
```

---

## 모드 선택 (인수 없이 실행 시)

```json
{
  "questions": [{
    "question": "품질 검증 모드를 선택하세요",
    "header": "🛡 Quality Gate",
    "options": [
      {"label": "⚡ check — 빠른 검증", "description": "테스트 + 린트 + 빌드 + 타입체크 (1-2분)"},
      {"label": "📝 review — 코드 리뷰", "description": "check + Spec/Quality 2단계 리뷰 (3-5분)"},
      {"label": "🔒 security — 보안 검사", "description": "check + OWASP TOP 10 + 시크릿 + 의존성 (3-5분)"},
      {"label": "🏆 full — 전체 검증", "description": "check + review + security + 커버리지 (5-10분)"}
    ],
    "multiSelect": false
  }]
}
```

---

## 모드별 실행 체인

### ⚡ check (빠른 검증)

`verification-before-completion` 스킬 실행:

```bash
# 백엔드 감지 시
pytest --tb=short -q && ruff check . 2>&1 | head -20

# 프론트엔드 감지 시
npm test -- --reporter=dot 2>&1 | tail -20 && tsc --noEmit 2>&1 | head -20 && npm run build 2>&1 | tail -20
```

**CLI 출력 압축 규칙 적용** (token-optimizer 연동):
- `pytest --tb=short -q` (94% 절감)
- `tsc --noEmit 2>&1 | head -20` (80% 절감)
- grep 필터 금지 (한글 에러 누락 방지)

**체크포인트**: 결과 요약 후 다음 단계 제안

---

### 📝 review (코드 리뷰)

1. **check** 실행 (위 동일)
2. `code-review` 스킬 실행:
   - Stage 1: Spec Compliance (명세 적합성)
   - Stage 2: Code Quality (코드 품질)

**체크포인트**: 리뷰 결과 표시 → "수정 후 재리뷰" / "통과" 선택

---

### 🔒 security (보안 검사)

1. **check** 실행 (위 동일)
2. `security-specialist` 에이전트 호출:
   - OWASP TOP 10 코드 스캔
   - 민감정보 유출 검사 (하드코딩된 시크릿)
   - 의존성 취약점 (`pip-audit 2>&1 | tail -10`, `npm audit 2>&1 | tail -10`)

**체크포인트**: 취약점 발견 시 → "수정" / "수용(낮은 위험)" 선택

---

### 🏆 full (전체 검증)

`auto-orchestrate` 품질 체인 순서 그대로:

```
1. verification-before-completion (테스트/린트/빌드)
    ↓
2. evaluation (커버리지/복잡도 메트릭)
    ↓
3. code-review (Spec + Quality 2단계)
    ↓
4. security-review (OWASP + 시크릿 + 의존성)
    ↓
5. frontend-review (프론트엔드 Phase만, vercel-review 포함)
```

**체크포인트**: 각 단계 결과 요약 → 실패 시 수정 루프

---

## 기존 스킬 연계

| 모드 | 호출 스킬 | 연동 |
|------|----------|------|
| check | `verification-before-completion` | 직접 실행 |
| review | `code-review` | Skill 도구 호출 |
| security | `security-specialist` | Task 도구 (에이전트) |
| full | 위 전체 + `evaluation` + `vercel-review` | 순차 체인 |

## auto-orchestrate 연계

`/auto-orchestrate` Phase 완료 시 품질 체인은 `/quality full`과 동일합니다.
차이점: auto-orchestrate는 자동 실행, `/quality`는 수동 트리거.

```
/quality check   = 커밋 전 빠른 확인
/quality review  = PR 전 코드 리뷰
/quality security = 릴리즈 전 보안 검사
/quality full    = Phase 완료 품질 게이트
```

---

## 출력 형식

```markdown
## 🛡 Quality Gate 결과

**모드**: full
**대상**: backend/ + frontend/

### ⚡ Check
- 테스트: 42/42 통과 ✅
- 린트: 0 errors ✅
- 빌드: 성공 ✅
- 타입: 0 errors ✅

### 📝 Review
- Spec Compliance: 통과 ✅
- Code Quality: 2 suggestions (minor)

### 🔒 Security
- OWASP: 0 critical, 0 high ✅
- 시크릿: 0 leaks ✅
- 의존성: 1 medium (lodash@4.17.20)

### 📊 Metrics
- 커버리지: 78% (목표: 70%) ✅
- 복잡도: 평균 4.2 (양호)

---
🏆 Quality Gate 통과 — 병합/배포 가능
```
