---
description: 5인 멀티페르소나 스웜 분석. 독립 분석 → 토론 → 합의 → 체인 핸드오프.
---

# /autoresearch predict

멀티페르소나 스웜 분석으로 코드를 다각도에서 사전 분석한다.

## 실행 절차

1. SKILL.md 읽기: `Read .claude/skills/autoresearch/SKILL.md`
2. 레퍼런스 읽기: `Read .claude/skills/autoresearch/references/predict-workflow.md`
3. 대화형 셋업 (Scope, Goal, Depth, Chain) → 8단계 분석 실행

## 플래그

| 플래그 | 설명 |
|--------|------|
| `--depth <level>` | shallow(3인,1라운드), standard(5인,2라운드), deep(8인,3라운드) |
| `--adversarial` | Red Team 페르소나 세트 사용 |
| `--chain <tools>` | 하류 도구 체이닝 (debug, security, fix, ship, scenario) |
| `--fail-on <severity>` | CI/CD 게이팅 |

## 사용 예시

```
/autoresearch predict --scope src/api/** --goal "security and reliability"
/autoresearch predict --depth deep --adversarial
/autoresearch predict --chain debug,fix --scope src/auth/**
```
