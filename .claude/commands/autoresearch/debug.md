---
description: 과학적 방법 기반 자율 버그 헌팅 루프. 가설 → 실험 → 증명/반증 → 반복.
---

# /autoresearch debug

과학적 방법 기반 자율 버그 헌팅 루프.

## 실행 절차

1. SKILL.md 읽기: `Read .claude/skills/autoresearch/SKILL.md`
2. 레퍼런스 읽기: `Read .claude/skills/autoresearch/references/debug-workflow.md`
3. 대화형 셋업 (Issue, Scope, Depth, After) → 7단계 루프 실행

## 플래그

| 플래그 | 설명 |
|--------|------|
| `--fix` | 발견 후 /autoresearch fix로 자동 연결 |
| `--scope <glob>` | 조사 범위 제한 |
| `--symptom "<text>"` | 증상 사전 입력 |

## 사용 예시

```
/autoresearch debug
/autoresearch debug --fix --scope src/api/**
/autoresearch debug --symptom "API returns 500 on POST /users" Iterations: 20
```
