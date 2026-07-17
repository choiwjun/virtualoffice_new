# RBAC 경계 QA 리포트 (live backend http://127.0.0.1:8000)

실행 시각: 2026-07-17T09:15:15.096Z

요약: PASS 25 / FAIL 0 / WARN 0 (총 25건)

계정: alice=admin(1001), bob=leader, charlie=employee(1003)

## 검사 결과

### [1] kpi-results/compute — admin 허용 — **PASS**
- 요청: POST /api/kpi-results/compute (alice/admin) {"user_id":1001,"period_type":"daily","period_key":"2026-07-17"}
- 기대: 200
- 실제: 200 {"computed":8,"results":[{"id":"65063d1e-8b07-4a77-bb76-9880bec06b60","user_id":1001,"period_type":"daily","period_key":"2026-07-17","metric":"work_completed_count","value":0,"unit":"count","source":"virtual_office","ai_…

### [1b] kpi-results/compute — leader 거부 — **PASS**
- 요청: POST /api/kpi-results/compute (bob/leader) {"user_id":1001,"period_type":"daily","period_key":"2026-07-17"}
- 기대: 403
- 실제: 403 {"detail":"admin_required"}

### [1c] kpi-results/compute — employee 거부 — **PASS**
- 요청: POST /api/kpi-results/compute (charlie/employee) {"user_id":1001,"period_type":"daily","period_key":"2026-07-17"}
- 기대: 403
- 실제: 403 {"detail":"admin_required"}

### [2a] kpi adjust — admin_note 30자 미만 거부 — **PASS**
- 요청: POST /api/kpi-results/151bb43b-3dbe-4b02-92d8-93d06b7253bd/adjust (alice) note.length<30
- 기대: 422
- 실제: 422 {"detail":[{"type":"string_too_short","loc":["body","admin_note"],"msg":"String should have at least 30 characters","input":"짧은사유","ctx":{"min_length":30}}]}

### [2b] kpi adjust — ±10% 초과 거부 — **PASS**
- 요청: POST /api/kpi-results/151bb43b-3dbe-4b02-92d8-93d06b7253bd/adjust (alice) score far out of ±10%
- 기대: 422/400
- 실제: 422 {"detail":"adjusted_score_out_of_range"}

### [2c] kpi adjust — leader 타팀 대상 거부 — **PASS**
- 요청: POST /api/kpi-results/151bb43b-3dbe-4b02-92d8-93d06b7253bd/adjust (bob/leader, target=charlie/1003)
- 기대: 403
- 실제: 403 {"detail":"team_scope_violation"}

### [3a] kpi objections — 타인 결과 접수 거부 — **PASS**
- 요청: POST /api/kpi-results/151bb43b-3dbe-4b02-92d8-93d06b7253bd/objections (alice, result owner=charlie)
- 기대: 403
- 실제: 403 {"detail":"forbidden"}

### [3b] kpi objections — 잘못된 category 거부 — **PASS**
- 요청: POST /api/kpi-results/151bb43b-3dbe-4b02-92d8-93d06b7253bd/objections (charlie, category=not_a_category)
- 기대: 422
- 실제: 422 {"detail":"invalid_objection_category"}

### [4] kpi objections/review — leader 거부(admin 전용) — **PASS**
- 요청: POST /api/kpi-results/151bb43b-3dbe-4b02-92d8-93d06b7253bd/objections/review (bob/leader)
- 기대: 403
- 실제: 403 {"detail":"admin_required"}

### [5a] notices 작성 — employee 거부 — **PASS**
- 요청: POST /api/notices (charlie/employee)
- 기대: 403
- 실제: 403 {"detail":"insufficient_permissions"}

### [5b] notices 작성 — leader 거부 — **PASS**
- 요청: POST /api/notices (bob/leader)
- 기대: 403
- 실제: 403 {"detail":"insufficient_permissions"}

### [5c] notices 작성 — admin 허용 — **PASS**
- 요청: POST /api/notices (alice/admin)
- 기대: 201/200
- 실제: 201 {"id":"2c30db66-903f-4a53-9796-fb2e23be8a60","title":"QA 테스트 공지 1784279714762","body":"RBAC QA 테스트용 공지 본문입니다.","author":"공지","category":"notice","pinned":false,"published_at":"2026-07-17T09:15:14.779395+00:00","expires_a…

### [6] audit-logs — employee 거부 — **PASS**
- 요청: GET /api/audit-logs (charlie/employee)
- 기대: 403
- 실제: 403 {"detail":"insufficient_permissions"}

### [7a] integrations — 계정 간 격리(본인 목록만) — **PASS**
- 요청: GET /api/integrations (alice/bob/charlie 각각)
- 기대: 200, 각자 본인 목록만(배열)
- 실제: alice=200:[] bob=200:[] charlie=200:[]

### [7b] integrations — 토큰 없이 401 — **PASS**
- 요청: GET /api/integrations (no auth)
- 기대: 401
- 실제: 401 {"detail":"Not authenticated"}

### [7c] integrations — PUT /jira 404(미지원 provider) — **PASS**
- 요청: PUT /api/integrations/jira (alice)
- 기대: 404
- 실제: 404 {"detail":"unknown provider: jira (github|figma)"}

### [8] trips — employee 본인 승인 시도 거부 — **PASS**
- 요청: PATCH /api/trips/d05d37b3-1dff-4519-8995-449488de4ce0 status=approved (charlie, 본인 출장)
- 기대: 403
- 실제: 403 {"detail":"insufficient_permissions"}

### [9] reports?user_id=1001 — employee 타인조회 시도(본인 스코프 강제) — **PASS**
- 요청: GET /api/reports?user_id=1001 (charlie/employee, user_id=1001은 alice)
- 기대: 200(본인것만 반환, user_id 파라미터 무시) 또는 403
- 실제: 403 {"detail":"insufficient_permissions"}

### [10a] presence/batch — 인증 없이 401 — **PASS**
- 요청: POST /api/presence/batch (no auth)
- 기대: 401
- 실제: 401 {"detail":"missing internal token"}

### [10b] presence/batch — 일반 사용자 토큰 거부 — **PASS**
- 요청: POST /api/presence/batch (charlie user JWT, not internal token)
- 기대: 403
- 실제: 403 {"detail":"invalid internal token"}

### [11] realtime/floor-layout — 내부 토큰 없이 거부 — **PASS**
- 요청: GET /api/realtime/floor-layout (no auth)
- 기대: 401/403
- 실제: 401 {"detail":"missing internal token"}

### [12a] work-logs — status=xx(비정상 enum) 거부 — **PASS**
- 요청: POST /api/work-logs (charlie) status=xx
- 기대: 422
- 실제: 422 {"detail":[{"type":"enum","loc":["body","status"],"msg":"Input should be 'started', 'completed' or 'aborted'","input":"xx","ctx":{"expected":"'started', 'completed' or 'aborted'"}}]}

### [12b] notices — 제목 256자 거부 — **PASS**
- 요청: POST /api/notices (alice) title.length=256
- 기대: 422
- 실제: 422 {"detail":[{"type":"string_too_long","loc":["body","title"],"msg":"String should have at most 255 characters","input":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA…

### [12c] kpi-results/compute — period_type=weekly 거부 — **PASS**
- 요청: POST /api/kpi-results/compute (alice) period_type=weekly
- 기대: 400/422
- 실제: 422 {"detail":"period_type must be 'daily' or 'quarterly'"}

### [13] 인증 — 위조 토큰(Bearer aaa.bbb.ccc) 거부 — **PASS**
- 요청: GET /api/kpi-results?user_id=1001&period_type=daily (Bearer aaa.bbb.ccc)
- 기대: 401
- 실제: 401 {"detail":"invalid_credentials"}

## 생성 데이터 정리 로그

- DELETE /api/notices/2c30db66-903f-4a53-9796-fb2e23be8a60 (QA 테스트 공지 정리) → 204
- PATCH /api/trips/d05d37b3-1dff-4519-8995-449488de4ce0 status=cancelled (QA 생성 출장 정리) → 200
