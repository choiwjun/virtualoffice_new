---
description: Karpathy autoresearch 패턴 범용 엔진. 3파일 구조 + Frozen Metric + 2계층 RSI 자율 실험 루프.
argument-hint: "<design | run | rsi | report | resume | plan | security | ship | debug | fix | scenario | predict | learn>"
---

# /autoresearch — 범용 자율 실험 루프

> Karpathy [autoresearch](https://github.com/karpathy/autoresearch) + [uditgoenka/autoresearch](https://github.com/uditgoenka/autoresearch) 패턴 통합.
> 도메인 특화 스킬(frontend, skills)의 코어 엔진이자, 새 도메인의 직접 scaffold 생성기.

---

## 실행 모드

### 코어 루프

| 인자 | 동작 |
|------|------|
| `design` (기본) | 사용자 인터뷰 → 적합성 판별 → 3파일 구조 설계 → scaffold 생성 |
| `run` | Inner Loop 시작 (NEVER STOP) |
| `rsi` | 2계층 RSI — Outer Loop가 전략을 개선하며 Inner Loop 반복 |
| `report` | results.tsv 요약 보고 |
| `resume` | autoresearch.md 기반 세션 이어받기 |

### 확장 서브커맨드 (v3.0)

| 인자 | 동작 |
|------|------|
| `plan` | Goal → 7단계 대화형 셋업 위저드 → 검증된 설정 |
| `security` | STRIDE + OWASP Top 10 자율 보안 감사 |
| `ship` | 코드/콘텐츠/마케팅 등 범용 배포 워크플로우 |
| `debug` | 과학적 방법 기반 자율 버그 헌팅 |
| `fix` | 우선순위 기반 자동 에러 수정 루프 |
| `scenario` | 12차원 엣지케이스/시나리오 탐색기 |
| `predict` | 5인 멀티페르소나 스웜 분석 |
| `learn` | 자율 코드베이스 문서화 엔진 |

---

## 실행 절차

SKILL.md를 반드시 읽은 후 실행:

```
Read .claude/skills/autoresearch/SKILL.md
```

확장 서브커맨드는 해당 레퍼런스 파일도 반드시 읽기:

```
Read .claude/skills/autoresearch/references/{subcommand}-workflow.md
```
