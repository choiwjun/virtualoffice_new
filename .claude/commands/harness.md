---
description: "Harness Architecture — Socrates 기획 → Builder 구현 → Evaluator QA 피드백 루프"
argument-hint: "<앱 설명> | --resume"
---

# /harness — Socrates + Builder + Evaluator 통합

> Anthropic 하네스 아키텍처 + Claude Labs socrates 기획 결합.
> 사용자 프롬프트 → socrates 대화형 기획 → 자율 빌드 → 브라우저 QA 루프.

---

## 실행 절차

사용자 프롬프트: $ARGUMENTS

### Step 1: 스킬 로딩

다음 스킬의 SKILL.md를 **반드시** 읽는다 (1% Rule):
1. `.claude/skills/harness/SKILL.md` — 오케스트레이터
2. `.claude/skills/socrates/SKILL.md` — 기획 (Phase 1)
3. `.claude/skills/harness-builder/SKILL.md` — 빌더 (Phase 3)
4. `.claude/skills/harness-evaluator/SKILL.md` — QA (Phase 4)

### Step 2: 모드 판별

- `$ARGUMENTS`가 `--resume`인 경우:
  - `docs/harness/harness-state.json` 읽기
  - 마지막 완료 Phase부터 재개
  - socrates가 이미 완료되었으면 Phase 2부터

- `$ARGUMENTS`가 앱 설명인 경우:
  - Phase 1 (socrates)부터 실행

### Step 3: 하네스 실행

harness 스킬의 워크플로우를 따라 실행:

```
Phase 1: /socrates "{사용자 프롬프트}" → 대화형 기획
Phase 2: socrates 출력 → harness 아티팩트 변환 (features.json, rubric.json)
Phase 3-4: BUILD-EVAL LOOP (최대 3사이클)
Phase 5: Final Report
```

### Step 4: 결과 보고

`docs/harness/final-report.md`의 요약을 사용자에게 보고.
