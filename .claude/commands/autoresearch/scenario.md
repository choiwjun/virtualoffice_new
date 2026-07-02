---
description: 12차원 엣지케이스/시나리오 탐색기. 시드 시나리오에서 상황, 실패 모드, 파생 시나리오 자율 발견.
---

# /autoresearch scenario

12개 탐색 차원으로 엣지케이스와 시나리오를 자율 생성하는 탐색 엔진.

## 실행 절차

1. SKILL.md 읽기: `Read .claude/skills/autoresearch/SKILL.md`
2. 레퍼런스 읽기: `Read .claude/skills/autoresearch/references/scenario-workflow.md`
3. 대화형 셋업 (Scenario, Domain, Depth 등) → 7단계 탐색 루프 실행

## 플래그

| 플래그 | 설명 |
|--------|------|
| `--domain <type>` | software, product, business, security, marketing |
| `--depth <level>` | shallow(10), standard(25), deep(50+) |
| `--format <type>` | use-cases, user-stories, test-scenarios, threat-scenarios |
| `--focus <area>` | 특정 차원 우선 (edge-cases, failures, security, scale) |

## 사용 예시

```
/autoresearch scenario
/autoresearch scenario --domain software --depth deep
Scenario: User attempts checkout with multiple payment methods
```
