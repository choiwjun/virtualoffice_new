# 프론트 명세(specs/screens) 대비 구현 정합 분석 (2026-07-06)

> `specs/screens/*.yaml`(10화면)·`specs/shared/components.yaml`를 프론트 구현과 컴포넌트 단위로 대조.
> 기준 커밋 `7f9b591`. 후속 작업 계획(A그룹)은 §3.

## 1. 화면별 정합 요약

| 화면 | 상태 | 주요 갭 |
|---|---|---|
| auth | ✅ | 로그인/세션 동작 |
| employee-directory | 🟡 | 컬럼 드리프트: **좌석/presence상태/행별 last_synced 누락**(email·role·work_type로 교체), **status 필터 없음** |
| work-log | 🟡 | **daily-status-form(일일리포트)·report-summary-card·progress-bar·어제복사 미구현**, date-tabs 부분(지난주/연간 없음) |
| kpi-dashboard(/admin/kpi) | 🟡 | **ai-draft-display·metric-progress-bars·team-summary(팀랭킹)·tab-navigation·erp-push-indicator 미구현**, 조정 UI가 prompt |
| kpi(/kpi 본인) | 🟡 | ai_draft·progress-bar 없음(objection 배지만) |
| kpi-objection | ✅ | 제출(7일/사유/카테고리)+관리자 재검토 |
| meetings | 🟡 | **캘린더(일/주/월)·action-item 대시보드·녹화동의배너 미구현**, minute 폼 notes/액션생성 없음 |
| sync-monitoring | 🟡 | **수동 재시도·daily_status_push/KPI배치 job-table 미구현**(erp_sync만) |
| org-chart-editor | 🟡 | **검증/배포 스텁(토스트), org_group CRUD 모달·순환검증·배포 API 없음** |
| seat-layout-editor | 🔴 | 좌석 전용 — **벽/방/구역/문 도구·undo/redo·속성/레이어 패널 미구현**(스키마는 지원, 빌더는 빈배열) |
| virtual-office-3d | ⚪ | D26으로 WA 대체(웹 3D N/A) |

## 2. 디자인 시스템
- badge/empty-state/error-state/details-panel/table/card 패턴은 페이지별 Tailwind 재구현 — 공용 컴포넌트 라이브러리 없음(동작 무방, 아키텍처 부채).

## 3. 후속 작업(A그룹) — 현 범위 구현 가능

- **G001 work-log**: 일일 상태 리포트 폼(오늘할일/진행중/블로커/내일계획 → POST /api/daily-status-push) + report-summary-card + progress-bar + 어제복사
- **G002 employee-directory**: presence 상태 필터+컬럼 + 좌석 컬럼(백엔드 employees presence/seat 조인)
- **G003 kpi-dashboard**: ai-draft 표시 + metric progress-bar + 팀랭킹 탭 + ERP push 버튼
- **G004 meetings**: 캘린더 뷰(일/주/월) + action-item 대시보드 + 회의록 notes/액션 생성
- **G005 sync-monitoring**: 수동 재시도 + daily_status_push/KPI 배치 job-status-table
- **G006 seat-layout-editor**: 벽/방/구역/문 도구 + undo/redo + 속성 패널
- **G007 org-chart-editor**: org_group CRUD 모달 + 검증(순환/미매핑) + 배포 API

## 4. 외부 의존(B그룹, Phase 5~7)
- STT(D5), AI 서술 초안/회의록 요약(Claude SDK), 실 ERP DB/push, 녹화 Egress+동의, 다층/구역 권한, HG-SEC 하드닝·백업.
