---
description: 자율 코드베이스 문서화 엔진. Scout → Analyze → Generate → Validate → Fix 루프.
---

# /autoresearch learn

코드베이스를 스카웃하고 학습하여 문서를 자율 생성/업데이트하는 엔진.

## 실행 절차

1. SKILL.md 읽기: `Read .claude/skills/autoresearch/SKILL.md`
2. 레퍼런스 읽기: `Read .claude/skills/autoresearch/references/learn-workflow.md`
3. 대화형 셋업 (Mode, Scope, Depth, Launch) → 8단계 문서화 실행

## 4가지 모드

| 모드 | 설명 |
|------|------|
| `init` | 코드베이스 처음 학습, 전체 문서 생성 |
| `update` | 변경분 학습, 기존 문서 갱신 |
| `check` | 읽기 전용 건강 진단 |
| `summarize` | 빠른 코드베이스 요약 |

## 플래그

| 플래그 | 설명 |
|--------|------|
| `--mode <mode>` | init, update, check, summarize |
| `--scope <glob>` | 학습 범위 제한 |
| `--depth <level>` | quick, standard, deep |
| `--no-fix` | 검증-수정 루프 건너뛰기 |

## 사용 예시

```
/autoresearch learn
/autoresearch learn --mode init --depth deep
/autoresearch learn --mode update --file system-architecture.md
/autoresearch learn --mode check
```
