---
description: 스킬 자율 개선. SKILL.md 수정 → 테스트 케이스 실행 → 메트릭 측정 → keep/revert 루프.
argument-hint: "<setup | run | rsi | report | gen-tests>"
---

# /autoresearch-skills — 스킬 자율 개선 루프

> SKILL.md를 target 파일로, 테스트 케이스를 Frozen Metric으로 사용하여 스킬 품질을 자율 개선.

## 실행 모드

| 인자 | 동작 |
|------|------|
| `setup` | 대상 스킬 분석 + Tier 판별 + 테스트 케이스 설정 + 베이스라인 |
| `run` | Inner Loop — SKILL.md 수정 → 테스트 실행 → keep/revert (NEVER STOP) |
| `rsi` | 2계층 RSI — Inner N회 후 전략 개선 |
| `report` | 실험 결과 + SKILL.md diff |
| `gen-tests` | 테스트 케이스만 자동 생성 |

SKILL.md를 반드시 읽은 후 실행:

```
Read .claude/skills/autoresearch-skills/SKILL.md
```
