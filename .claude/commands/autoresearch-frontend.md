---
description: 프론트엔드 autoresearch. Chrome MCP로 DOM+콘솔+폼 테스트 → Frozen Metric → keep/revert 자율 루프.
argument-hint: "<setup | run | rsi | report>"
---

# /autoresearch-frontend — 프론트엔드 자율 개선 루프

> agent-browser(Chrome MCP)로 "눈으로 봐야 아는 것"을 메트릭화하여 프론트엔드 자율 개선.

## 실행 모드

| 인자 | 동작 |
|------|------|
| `setup` | 프로젝트 설정 + test-routes.json 생성 + 베이스라인 |
| `run` | Inner Loop — 코드 수정 → Chrome 테스트 → keep/revert (NEVER STOP) |
| `rsi` | 2계층 RSI — Inner N회 후 전략 자체를 개선 |
| `report` | 실험 결과 요약 |

SKILL.md를 반드시 읽은 후 실행:

```
Read .claude/skills/autoresearch-frontend/SKILL.md
```
