# Lane B Audit — 데이터·API·ERP·KPI 로직

**Worker**: worker-2  
**Timestamp**: $(date -u +%Y-%m-%dT%H:%M:%S)Z  
**Scope**: docs/api/management-api.yaml vs backend/app/api, docs/data-model/erd.md + 04-data-model.md vs backend/app/models/tables.py, docs/erp-integration/contract.md + 03-erp-integration.md vs erp 구현, 08-kpi-logic.md vs services/kpi

---

## Executive Summary

| 카테고리 | 구현 | 부분 | 미구현 | 드리프트 | CRITICAL | HIGH | MED | LOW |
|---------|-----|-----|--------|---------|----------|------|-----|-----|
| **API 계약** | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| **데이터 모델** | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| **ERP 연동** | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| **KPI 로직** | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| **합계** | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

---

## 1. API 계약 검증 (management-api.yaml vs backend/app/api)

| 항목 | 정본 문서/섹션 | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|--------------|----------|----------|--------|------|


### 1.1 인증 (Authentication)

| 항목 | 정본 (management-api.yaml) | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|---------------------------|----------|---------|--------|------|
| POST /auth/login | email/password → JWT (200) | 드리프트 | api/auth.py:138 | MED | 구현 200 vs 명세 미기재(200 암묵) — 일치 |
| POST /auth/refresh | refresh_token → new JWT (200) | 구현 | api/auth.py:182 | LOW | 완전 일치 |
| 로그인 실패 코드 | 401 Unauthorized | 구현 | api/auth.py:43,161 | LOW | 일치, 백오프 5회 잠금 추가 구현 |
| JWT 만료 시간 | 8h (access), 7d (refresh) | 드리프트 | 환경변수 의존 | MED | 명세 8h vs 구현 env.JWT_EXPIRATION_HOURS (기본값 필요 검증) |
| refresh 토큰 envelope | {access_token, refresh_token, expires_in} | 구현 | api/auth.py:216 | LOW | 일치 |

**인증 소결**: 5항목 중 구현 3, 드리프트 2. 백오프 잠금은 추가 보안(긍정). JWT 만료 기본값 명세화 필요.

---

### 1.2 직원·팀 (Employee & Team)

| 항목 | 정본 | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|-----|----------|---------|--------|------|
| GET /users | 권한별 필터, limit/offset, {items, total} envelope | 드리프트 | api/erp.py (경로 /employees) | HIGH | ① 경로: /users → /api/employees ② envelope 미구현(bare 배열) ③ role/team_id 필터 미구현 |
| GET /users/{user_id} | user detail | 구현 | api/erp.py | LOW | /api/employees/{id}, 권한 체크 포함 |
| GET /teams | teams 목록, limit/offset | 부분 | api/directory.py:teams | MED | 구현되나 envelope {items, total} 없음 |
| GET /org-groups | 조직 그룹 계층 | 구현 | api/directory.py:org_groups | LOW | 일치 |

**직원·팀 소결**: 4항목 중 구현 2, 부분 1, 드리프트 1 (HIGH). 명세 /users vs 구현 /employees 경로 불일치 + envelope 미구현이 주요 갭.

---

### 1.3 좌석 배치 (Seat Assignment)

| 항목 | 정본 | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|-----|----------|---------|--------|------|
| GET /seats | 좌석 목록 (floor_id 필터) | 구현 | api/seats.py | LOW | 일치 |
| GET /seats/{seat_id} | 좌석 상세 | 구현 | api/seats.py | LOW | 일치 |
| POST /seat-assignments | 좌석 배정 | 구현 | api/seats.py:assign_seat | LOW | 일치 |
| GET /seat-assignments | 배정 이력·내역 조회 | 미구현 | - | HIGH | 명세 존재, 구현 없음. seat_assignment_history 테이블은 존재 → 즉시 구현 가능 |
| PUT /seat-assignments | 배정 수정 (관리자) | 미구현 | - | MED | 명세 존재, 구현 없음 |
| POST /seat-assignments/{id}/release | 배정 해제 | 드리프트 | api/seats.py | MED | 경로: 명세 {assignment_id} vs 구현 {seat_id} 불일치 |

**좌석 소결**: 6항목 중 구현 3, 미구현 2 (HIGH+MED), 드리프트 1 (MED). 배정 이력 조회 API 누락이 운영 갭.

---

### 1.4 오피스 레이아웃 (Office Layout)

| 항목 | 정본 | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|-----|----------|---------|--------|------|
| GET /office-layouts | 레이아웃 목록 | 구현 | api/office_layouts.py | LOW | 일치 |
| POST /office-layouts | 레이아웃 생성 (draft) | 구현 | api/office_layouts.py | LOW | 일치 |
| PUT /office-layouts/{id} | 레이아웃 수정 | 구현 | api/office_layouts.py | LOW | 일치 |
| DELETE /office-layouts/{id} | 레이아웃 삭제 | 구현 | api/office_layouts.py | LOW | 일치 |
| POST /office-layouts/{id}/validate | 검증 (draft → validated) | 구현 | api/office_layouts.py | LOW | 일치 (D12) |
| POST /office-layouts/{id}/deploy | 배포 (validated → deployed) | 구현 | api/office_layouts.py | LOW | 일치 (D12) |
| POST /office-layouts/{id}/rollback | 롤백 (신규 draft 생성) | 구현 | api/office_layouts.py | LOW | 일치 (D12) |

**레이아웃 소결**: 7항목 전부 구현. D12 상태머신 완전 이행.

---

### 1.5 회의 (Meeting)

| 항목 | 정본 | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|-----|----------|---------|--------|------|
| GET /meetings | 회의 목록 | 구현 | api/meetings.py | LOW | 일치 |
| POST /meetings | 회의 생성 | 구현 | api/meetings.py | LOW | 일치 |
| GET /meetings/{id} | 회의 상세 | 구현 | api/meetings.py | LOW | 일치 |
| PUT /meetings/{id} | 회의 수정 | 드리프트 | api/meetings.py | LOW | 명세 PUT vs 구현 PATCH (기능 동일) |
| DELETE /meetings/{id} | 회의 삭제 | 구현 | api/meetings.py | LOW | 일치 |
| POST /meetings/{id}/join | 회의 참가 | 구현 | api/meetings.py | LOW | 일치 |
| GET /meetings/{id}/participants | 참석자 목록 | 구현 | api/meetings.py | LOW | 일치 |

**회의 소결**: 7항목 중 구현 6, 드리프트 1 (LOW, PUT/PATCH 차이).

---

### 1.6 회의록 (Meeting Minute)

| 항목 | 정본 | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|-----|----------|---------|--------|------|
| GET /meeting-minutes | 회의록 목록 | 구현 | api/meeting_minutes.py | LOW | 일치 |
| POST /meeting-minutes | 회의록 작성 | 구현 | api/meeting_minutes.py | LOW | 일치 |
| GET /meeting-minutes/{id} | 회의록 상세 | 구현 | api/meeting_minutes.py | LOW | 일치 |
| PUT /meeting-minutes/{id} | 회의록 수정 | 드리프트 | api/meeting_minutes.py | LOW | 명세 PUT vs 구현 PATCH |
| DELETE /meeting-minutes/{id} | 회의록 삭제 | 구현 | api/meeting_minutes.py | LOW | 일치 |
| POST /meeting-minutes/{id}/finalize | 회의록 확정 | 구현 | api/meeting_minutes.py | LOW | 일치 |
| GET /meeting-minutes/{id}/stt-draft | STT 자동 초안 (D5) | 미구현 | - | LOW | 명세 존재, 501 스텁만. Phase 5 외부 의존 사항 |

**회의록 소결**: 7항목 중 구현 5, 드리프트 1 (LOW), 미구현 1 (LOW, Phase 5).

---

### 1.7 업무기록 (Work Log)

| 항목 | 정본 | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|-----|----------|---------|--------|------|
| GET /work-logs | 업무 목록 (user_id, date 필터) | 구현 | api/work_logs.py | LOW | 일치 |
| POST /work-logs | 업무 생성 | 구현 | api/work_logs.py | LOW | 일치 |
| GET /work-logs/{id} | 업무 상세 | 구현 | api/work_logs.py | LOW | 일치 |
| PUT /work-logs/{id} | 업무 수정 | 드리프트 | api/work_logs.py | LOW | 명세 PUT vs 구현 PATCH |
| DELETE /work-logs/{id} | 업무 삭제 | 구현 | api/work_logs.py | LOW | 일치 |

**업무기록 소결**: 5항목 중 구현 4, 드리프트 1 (LOW, PUT/PATCH).

---

### 1.8 KPI 평가 (KPI Result)

| 항목 | 정본 | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|-----|----------|---------|--------|------|
| POST /kpi-results/compute | KPI 계산 (정량 metric) | 구현 | api/kpi.py:168 | LOW | services/kpi_engine.py 결정론적 계산 (D14-e) |
| GET /kpi-results | KPI 목록 (user_id, period 필터) | 구현 | api/kpi.py:204 | LOW | 일치 |
| GET /kpi-results/{id} | KPI 상세 | 구현 | api/kpi.py:238 | LOW | 일치 |
| POST /kpi-results/{id}/adjust | 관리자 조정 (±10%) | 드리프트 | api/kpi.py:251 | MED | 명세 PUT vs 구현 POST |
| POST /kpi-results/{id}/finalize | 확정 (final_score 설정) | 구현 | api/kpi.py:286 | LOW | 일치, finalized_at 설정 + audit_log |
| POST /kpi-results/{id}/objections | 이의신청 제출 | 구현 | api/kpi.py:345 | LOW | 일치, objection_status 상태머신 (D15) |
| GET /kpi-results/{id}/objections | 이의신청 내역 조회 | 구현 | api/kpi.py:491 | LOW | 일치 |
| POST /kpi-results/{id}/objections/review | 이의신청 검토 (관리자) | 드리프트 | api/kpi.py:417 | MED | 명세 PUT vs 구현 POST |

**KPI 소결**: 8항목 중 구현 6, 드리프트 2 (MED, HTTP 메서드 불일치). 기능 완전 구현, 명세 정렬 필요.

---

### 1.9 ERP 동기화 (ERP Integration)

| 항목 | 정본 | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|-----|----------|---------|--------|------|
| GET /erp-sync/status | 동기화 상태 조회 | 구현 | api/erp.py | LOW | 일치 |
| POST /erp/sync | 수동 동기화 트리거 | 드리프트 | api/erp.py | MED | 명세 /erp-sync/trigger vs 구현 /erp/sync 경로 불일치 |
| GET /erp-sync/failures | 실패 이력 조회 | 구현 | api/erp.py | LOW | 일치 |

**ERP 소결**: 3항목 중 구현 2, 드리프트 1 (MED, 경로). 기능 완전, 경로 표준화 필요.

---

### 1.10 감사 로그 (Audit Log)

| 항목 | 정본 | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|-----|----------|---------|--------|------|
| GET /audit-logs | 감사 로그 조회 (필터, 페이징) | 구현 | api/audit.py | LOW | 일치, 자동 기록 (services/audit.py) |

**감사 로그 소결**: 1항목 구현. 자동 mutation 기록 완전.

---

## 1. API 계약 종합

| 범주 | 구현 | 드리프트 | 미구현 | 합계 |
|-----|-----|---------|--------|------|
| 인증 | 3 | 2 | 0 | 5 |
| 직원·팀 | 2 | 1 | 0 | 4 |
| 좌석 | 3 | 1 | 2 | 6 |
| 레이아웃 | 7 | 0 | 0 | 7 |
| 회의 | 6 | 1 | 0 | 7 |
| 회의록 | 5 | 1 | 1 | 7 |
| 업무기록 | 4 | 1 | 0 | 5 |
| KPI | 6 | 2 | 0 | 8 |
| ERP | 2 | 1 | 0 | 3 |
| 감사 | 1 | 0 | 0 | 1 |
| **합계** | **39** | **10** | **3** | **53** |

### 심각도 분포 (API)

- **CRITICAL**: 0건
- **HIGH**: 2건 (직원 목록 envelope, 좌석 배정 이력 조회)
- **MED**: 7건 (경로 불일치, HTTP 메서드 불일치)
- **LOW**: 44건 (구현 완료 또는 경미한 차이)

---


## 2. 데이터 모델 검증 (erd.md + 04-data-model.md vs tables.py)

### 2.1 ERP 미러 계층

| 항목 | 정본 (04 §2.1) | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|---------------|----------|---------|--------|------|
| erp_user 테이블 | 필드 17개: id/company_id/email/name/erp_team_id/role/position/position_id/manager_id/work_type/work_hours/is_active/last_synced_at/created_at/updated_at | 구현 | tables.py:232-311 | LOW | 전 필드 일치. soft-delete (is_active) 포함 (D18) |
| PK: id (BIGINT) | ERP users.id 원본 타입 | 구현 | tables.py:248 | LOW | 일치 |
| FK: manager_id → erp_user(id) | self, nullable, ON DELETE SET NULL | 구현 | tables.py:276 | LOW | 일치 |
| UNIQUE(company_id, email) | 멀티테넌트 스코프 | 구현 | tables.py:310 (UniqueConstraint) | LOW | 일치 |
| INDEX(erp_team_id) | 회의/업무/KPI 조인 | 구현 | tables.py:306 | LOW | 일치 |
| INDEX(role) | 관리자 필터 | 구현 | tables.py:307 | LOW | 일치 |
| INDEX(is_active) | 활성 직원 필터 | 구현 | tables.py:67 (SoftDeleteMixin) | LOW | 일치 |
| 미러링 최소수집 (D20-f) | slack_user_id/github_username/jira_email/lat/lng/radius 제외 | 구현 | tables.py:235 주석 명시 | LOW | 일치, 명세 준수 |

**erp_user 소결**: 8항목 전부 구현. 스키마 완전 일치.

---

### 2.2 조직·구역·공간 계층

| 항목 | 정본 (04 §2.2) | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|---------------|----------|---------|--------|------|
| org_group 테이블 | id/company_id/name/type/parent_id/color/sort_order/created_at/updated_at | 구현 | tables.py:318-353 | LOW | 전 필드 일치 |
| org_group.type | enum: division/department/part | 구현 | tables.py:148-152 (OrgGroupType) | LOW | 일치 |
| FK: parent_id → org_group(id) | self, nullable | 구현 | tables.py:344 | LOW | 일치 |
| team_zone 테이블 | id/erp_team_id/org_group_id/office_id/floor_id/zone_label/color/polygon/created_at/updated_at | 구현 | tables.py:356-396 | LOW | 전 필드 일치 |
| FK: erp_team_id | ERP teams 참조 (직접 읽기) | 구현 | tables.py:370 (BigInteger, 주석 명시) | LOW | 일치 |
| UNIQUE(erp_team_id, office_id, floor_id) | 중복 배치 방지 | 구현 | tables.py:395 | LOW | 일치 |
| office 테이블 | id/company_id/name/description/address/created_at/updated_at | 구현 | tables.py:399-412 | LOW | 전 필드 일치 |
| floor 테이블 | id/office_id/level/name/minimap_config/created_at/updated_at | 구현 | tables.py:414-438 | LOW | 전 필드 일치 |
| UNIQUE(office_id, level) | 층 번호 중복 방지 | 구현 | tables.py:437 | LOW | 일치 |
| office_layout 테이블 | id/office_id/floor_id/version/status/json/created_by/validated_by/deployed_at/deployment_notes/created_at/updated_at | 구현 | tables.py:441-502 | LOW | 전 필드 일치 |
| office_layout.status | enum: draft/validated/deployed/archived | 구현 | tables.py:113-118 (OfficeLayoutStatus) | LOW | 일치 (D12) |
| UNIQUE(office_id, floor_id, version) | 버전 번호 중복 방지 | 구현 | tables.py:495 | LOW | 일치 |
| room 테이블 | id/floor_id/type/name/capacity/coords/enter_trigger/livekit_room/status/created_at/updated_at | 구현 | tables.py:505-547 | LOW | 전 필드 일치. enter_trigger 추가 (D25 정렬) |
| room.type | enum: lobby/meeting/lounge/focus/phonebooth | 구현 | tables.py:155-161 (RoomType) | LOW | 일치 |
| coords & enter_trigger | JSON, 2D top_left 원점·미터 단위 (D25) | 구현 | tables.py:529-533 주석 명시 | LOW | 일치, 명세 준수 |

**조직·공간 소결**: 14항목 전부 구현. 스키마 완전 일치.

---

### 2.3 좌석·현위치 계층

| 항목 | 정본 (04 §2.3) | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|---------------|----------|---------|--------|------|
| seat 테이블 | id/floor_id/team_zone_id/type/assigned_user_id/status/coords/seat_number/created_at/updated_at | 구현 | tables.py:554-616 | LOW | 전 필드 일치 |
| seat.type | enum: fixed/free/temp/partner | 구현 | tables.py:89-94 (SeatType) | LOW | 일치 |
| seat.status | enum: available/occupied/disabled/reserved | 구현 | tables.py:97-102 (SeatStatus) | LOW | 일치 |
| seat_assignment_history 테이블 | id/seat_id/user_id/assigned_at/unassigned_at/assigned_by/reason | 구현 | tables.py:619-680 | LOW | 전 필드 일치 |
| user_team_history 테이블 | id/user_id/erp_team_id/valid_from/valid_to/created_at/updated_at | 구현 | tables.py:683-730 | LOW | 전 필드 일치 (D18 신설) |
| presence 테이블 | user_id(PK)/office_id/floor_id/x/y/z/status/updated_at | 구현 | tables.py:733-794 | LOW | 전 필드 일치 |
| presence.status | enum 7종: offline/online/working/meeting/focus/away/external | 구현 | tables.py:78-86 (PresenceStatus) | LOW | 일치 (D13) |
| INDEX(office_id, floor_id) | 실시간 조회 (Godot/WA 서버) | 구현 | tables.py:789 | LOW | 일치 |
| INDEX(status) | presence 상태 필터 | 구현 | tables.py:790 | LOW | 일치 |

**좌석·현위치 소결**: 9항목 전부 구현. D13(presence 7종), D18(user_team_history) 완전 반영.

---

### 2.4 협업·회의 계층

| 항목 | 정본 (04 §2.4) | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|---------------|----------|---------|--------|------|
| meeting 테이블 | id/room_id/host_user_id/title/scheduled_at/started_at/ended_at/status/livekit_room/recording_url/created_at/updated_at | 구현 | tables.py:801-871 | LOW | 전 필드 일치 |
| meeting.status | enum: scheduled/in_progress/completed/cancelled | 구현 | tables.py:105-110 (MeetingStatus) | LOW | 일치 |
| meeting ↔ meeting_minute | 단방향 FK (minute.meeting_id → meeting.id) | 구현 | tables.py:951 (meeting_id unique FK) | LOW | 일치, 순환 참조 방지 (04 §2.4 주석) |
| meeting_participant 테이블 | id/meeting_id/user_id/invited_at/joined_at/left_at/role | 구현 | tables.py:874-925 | LOW | 전 필드 일치 |
| meeting_participant.role | enum: host/participant | 구현 | tables.py:197-201 (MeetingParticipantRole) | LOW | 일치 |
| meeting_minute 테이블 | id/meeting_id(unique)/title/summary/decisions/action_items_summary/created_by/reviewed_by/status/created_at/updated_at | 구현 | tables.py:928-986 | LOW | 전 필드 일치 |
| meeting_minute.status | enum: draft/finalized | 구현 | tables.py:191-194 (MeetingMinuteStatus) | LOW | 일치 |
| action_item 테이블 | id/meeting_id/assignee_user_id/title/description/due_date/priority/status/completed_at/created_at/updated_at | 구현 | tables.py:989-1043 | LOW | 전 필드 일치 |
| action_item.status | enum: open/in_progress/completed/cancelled | 구현 | tables.py:177-182 (ActionItemStatus) | LOW | 일치 |
| action_item.priority | enum: high/medium/low | 구현 | tables.py:204-208 (ActionItemPriority) | LOW | 일치 |

**회의 소결**: 10항목 전부 구현. 단방향 FK 설계 완전 반영.

---

### 2.5 업무·KPI·연동 계층

| 항목 | 정본 (04 §2.5) | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|---------------|----------|---------|--------|------|
| work_log 테이블 | id/user_id/work_date/category/title/goal/status/est_minutes/actual_minutes/result_url/result_description/next_action/created_at/updated_at | 구현 | tables.py:1050-1106 | LOW | 전 필드 일치 |
| work_log.status | enum: started/completed | 구현 | tables.py:185-188 (WorkLogStatus) | LOW | 일치 |
| kpi_result 테이블 (정본, D16) | id/user_id/period_type/period_key/metric/value/unit/source/ai_model/ai_draft/ai_draft_generated_at/admin_adjusted_score/admin_note/admin_user_id/admin_reviewed_at/objection_status/objection_detail/objection_submitted_at/objection_resolved_at/final_score/finalized_at/pushed_to_erp/pushed_at/created_at/updated_at | 구현 | tables.py:1109-1234 | LOW | 전 필드 일치. 롱포맷 (1행 = 1 user + 1 period + 1 metric) |
| kpi_result.period_type | enum: daily/quarterly | 구현 | tables.py:121-124 (KpiPeriodType) | LOW | 일치 (D16, weekly 폐기) |
| kpi_result.metric | 8종: work_completed_count/work_quality_score/minutes_authored_count/action_items_completed/action_items_ontime_rate/report_fidelity_score/collaboration_score/quarterly_total | 구현 | tables.py:1150 (String 255, enum 미강제) | MED | metric enum 검증 부재. kpi_engine.py가 정확 어휘 사용하나 DB 제약 없음 |
| kpi_result.objection_status | enum: none/submitted/reviewing/resolved | 구현 | tables.py:127-132 (KpiObjectionStatus) | LOW | 일치 (D15) |
| kpi_result.source | enum: virtual_office | 구현 | tables.py:135-137 (KpiSource) | LOW | 일치 |
| UNIQUE(user_id, period_type, period_key, metric) | metric 단위 행 유니크 | 구현 | tables.py:1233 | LOW | 일치 |
| daily_status_push 테이블 | id/user_id/push_date/target/status/payload/pushed_at/run_id/error/created_at/updated_at | 구현 | tables.py:1237-1293 | LOW | 전 필드 일치 |
| daily_status_push.target | enum: erp_daily_reports/erp_kpi_results | 구현 | tables.py:164-167 (DailyStatusPushTarget) | LOW | 일치 |
| daily_status_push.status | enum: pending/sent/failed | 구현 | tables.py:170-174 (DailyStatusPushStatus) | LOW | 일치 |

**업무·KPI 소결**: 11항목 중 구현 10, 부분 1 (MED, metric enum 미강제). DB는 완전하나 제약 강화 권고.

---

### 2.6 자산·감사 계층

| 항목 | 정본 (04 §2.6 + 07 §5.3 v1.1) | 구현 상태 | 근거 파일 | 심각도 | 상세 |
|-----|------------------------------|----------|---------|--------|------|
| asset 테이블 | asset_id(PK)/asset_name/asset_type/source_blend_path/glb_path/license/attribution/modified_by/modified_at/downloaded_at/metadata | 구현 | tables.py:1300-1379 | LOW | 전 필드 일치 (07 §5.3 v1.1 정본) |
| asset.asset_type | enum: furniture/decorative/electronics/nature/environment | 구현 | tables.py:218-225 (AssetType) | LOW | 일치 |
| audit_log 테이블 | id/user_id/action/entity_type/entity_id/old_value/new_value/created_at | 구현 | tables.py:1382-1430 | LOW | 전 필드 일치. created_at만 (updated_at 없음, 불변) |
| audit_log 보존 정책 | 5년 보존 (D20-e) | 부분 | - | MED | 스키마 존재, 자동 파기 로직 미구현 (운영 배치 필요) |
| erp_sync_log 테이블 | id/sync_type/status/synced_count/run_id/error/started_at/finished_at | 구현 | tables.py:1433-1453 | LOW | 전 필드 일치 (management-api 대응) |

**자산·감사 소결**: 5항목 중 구현 4, 부분 1 (MED, audit_log 파기 로직). 스키마 완전.

---

## 2. 데이터 모델 종합

| 계층 | 항목 수 | 구현 | 부분 | 미구현 | 심각도 분포 |
|-----|--------|-----|-----|--------|------------|
| ERP 미러 | 8 | 8 | 0 | 0 | LOW 8 |
| 조직·공간 | 14 | 14 | 0 | 0 | LOW 14 |
| 좌석·현위치 | 9 | 9 | 0 | 0 | LOW 9 |
| 회의 | 10 | 10 | 0 | 0 | LOW 10 |
| 업무·KPI | 11 | 10 | 1 | 0 | LOW 10, MED 1 |
| 자산·감사 | 5 | 4 | 1 | 0 | LOW 4, MED 1 |
| **합계** | **57** | **55** | **2** | **0** | **LOW 55, MED 2** |

### 데이터 모델 심각도 요약

- **CRITICAL**: 0건
- **HIGH**: 0건
- **MED**: 2건 (metric enum 검증 부재, audit_log 파기 로직 미구현)
- **LOW**: 55건 (완전 구현)

**데이터 모델 총평**: 57개 항목 중 55개 완전 구현 (96.5%). 2건 MED는 운영 강화 권고 사항으로 기능 차단 없음.

---

