---
description: 코드/콘텐츠/마케팅 등 범용 배포 워크플로우. 8단계 프로세스.
---

# /autoresearch ship

9가지 배포 유형을 지원하는 범용 배포 워크플로우.

## 실행 절차

1. SKILL.md 읽기: `Read .claude/skills/autoresearch/SKILL.md`
2. 레퍼런스 읽기: `Read .claude/skills/autoresearch/references/ship-workflow.md`
3. 대화형 셋업 (What, Mode, Monitor) → 8단계 프로세스 실행

## 플래그

| 플래그 | 설명 |
|--------|------|
| `--dry-run` | 검증만 수행, 실제 배포 안 함 |
| `--auto` | 에러 없으면 자동 승인 |
| `--rollback` | 마지막 배포 롤백 |
| `--monitor N` | 배포 후 N분 모니터링 |

## 사용 예시

```
/autoresearch ship
/autoresearch ship --type code-pr --auto
/autoresearch ship --dry-run --type deployment
```
