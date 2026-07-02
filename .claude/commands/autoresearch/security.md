---
description: STRIDE + OWASP Top 10 자율 보안 감사. 위협 모델 생성 → 자율 벡터 탐색 → 심각도별 리포트.
---

# /autoresearch security

STRIDE 위협 모델링 + OWASP Top 10 기반 자율 보안 감사 루프.

## 실행 절차

1. SKILL.md 읽기: `Read .claude/skills/autoresearch/SKILL.md`
2. 레퍼런스 읽기: `Read .claude/skills/autoresearch/references/security-workflow.md`
3. 대화형 셋업 (Scope, Depth, Action) → 보안 감사 루프 실행

## 플래그

| 플래그 | 설명 |
|--------|------|
| `--diff` | 변경된 파일만 델타 감사 |
| `--fix` | 확인된 Critical/High 자동 수정 |
| `--fail-on <severity>` | CI/CD 게이팅 (exit code 1) |

## 사용 예시

```
/autoresearch security
/autoresearch security --diff --fail-on critical
/autoresearch security --fix Iterations: 15
```
