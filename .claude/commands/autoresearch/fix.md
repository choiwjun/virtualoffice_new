---
description: 우선순위 기반 자동 에러 수정 루프. Build > Type > Test > Lint 순서로 수정.
---

# /autoresearch fix

에러를 자동 감지하고 우선순위대로 하나씩 수정하는 자율 루프.

## 실행 절차

1. SKILL.md 읽기: `Read .claude/skills/autoresearch/SKILL.md`
2. 레퍼런스 읽기: `Read .claude/skills/autoresearch/references/fix-workflow.md`
3. 대화형 셋업 (Fix What, Guard, Scope, Launch) → 8단계 수정 루프 실행

## 플래그

| 플래그 | 설명 |
|--------|------|
| `--target <command>` | 명시적 검증 커맨드 |
| `--guard <command>` | 회귀 방지 안전망 |
| `--category <type>` | 특정 카테고리만 수정 (test, type, lint, build) |
| `--from-debug` | 최신 debug 세션 결과 기반 수정 |

## 사용 예시

```
/autoresearch fix
/autoresearch fix --guard "npm test" --category type
/autoresearch fix --from-debug Iterations: 30
```
