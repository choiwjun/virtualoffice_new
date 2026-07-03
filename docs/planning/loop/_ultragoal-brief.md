가상오피스(vituraloffice_new) 백엔드 관리 API 및 운영 로직을 승인된 기획(Ready with Risks, docs/planning/loop/final-planning-approval.md)에 따라 구현한다.

공통 제약 (모든 스토리 적용):
- 정본(SSOT)은 docs/planning/00-decisions.md (D1~D25, F절). 충돌 시 정본이 이긴다.
- 계약 테스트가 수용 기준이다: backend/tests/contract/test_management_api_stubs.py 의 @pytest.mark.skip 을 제거·활성화하고 통과시킨다. 스텁의 assert(상태코드/응답 스키마)를 계약으로 삼되, 스텁이 명세와 어긋나면 명세(docs/api/management-api.yaml + 00-decisions)를 정본으로 고치고 근거를 남긴다.
- TDD: 스텁 활성화 → 구현 → backend/.venv 로 pytest 통과. 기존 32 passed 베이스라인은 절대 회귀하지 않는다.
- 기존 코드 컨벤션 재사용: app/api/*.py 라우터, app/core/security.py(JWT/bcrypt 완비), app/models/tables.py, app/db.py(async SQLAlchemy), app/erp/*. 병렬 컨벤션 금지.
- pytest 실행: `"$(pwd)/backend/.venv/Scripts/python.exe" -m pytest` (cwd=backend). 상대경로 실행은 이 환경에서 실패하므로 절대경로 변수 사용.
- 검증 산출물은 실제 pytest 출력(black-box API test report)을 증거로 사용한다.
- 환경 차단 작업(Godot/GPU/LiveKit/STT/ERP 라이브 DB/도메인)은 이 환경에서 실행 불가이므로 코드로 완결하지 말고 durable blocker로 기록한다.

@goal: 인증 API와 JWT 의존성 배선
POST /auth/login(성공 201 + {token, refresh_token, user}, 실패 401), POST /auth/refresh, GET /auth/me 구현. app/core/security.py 의 create_access_token/decode_access_token/verify_password 재사용. get_current_user 및 역할기반(RBAC) FastAPI 의존성 신설(app/core/deps.py 확장). refresh token 발급/검증 추가. main.py 에 auth 라우터 등록. test_management_api_stubs.py 의 TestAuthAPI 5개 케이스 활성화·통과.

@goal: 직원·팀·조직도 조회 API
GET /employees, GET /employees/{id}, GET /teams, GET /org-groups 구현(ERP 미러 테이블 erp_user/team/org_group 읽기). RBAC 적용, 페이지네이션·필터. 관련 계약 스텁 활성화·통과. ERP 라이브 DB 없이 mock_reader/미러 테이블 기반으로 검증한다.

@goal: 좌석 배정 API (D10)
GET /seats, POST /seats/{id}/assign, POST /seats/{id}/release 구현. 좌석 배타성(seat당 활성 배정 1건, seat.assigned_user_id + seat_assignment_history 이력) 강제. test_management_api_stubs.py 좌석 8개 케이스 활성화·통과.

@goal: 오피스 레이아웃 API + 서버 검증 + 공식 JSON Schema (D12)
GET/POST/PUT 레이아웃 CRUD, 서버측 정밀 검증은 app/services/office_layout_validator.py 경유(ERROR=배포 불가, WARNING만 무시 가능). 공식 스키마 파일 docs/data-model/office-layout.schema.json 생성(현재 미생성, gap C9). 레이아웃 10개 계약 케이스 활성화·통과.

@goal: 회의 + 회의실 예약 API (D23/D24)
회의 CRUD, 회의실 예약 충돌 검증(예약제 유지 + FCFS 병행), 명시적 입장 확인 흐름(입장 토큰 발급은 FastAPI 경유; LiveKit 실연동은 환경 차단이므로 토큰 발급 계약만 구현하고 실제 룸 생성은 stub). 회의 8개 계약 케이스 활성화·통과.

@goal: 회의록 API + STT 스키마 (D5)
회의록 CRUD, meeting_minute.stt_draft/ai_summary 필드 + status 상태머신(draft→published). 수동 입력 폴백 경로. 회의록 5개 계약 케이스 활성화·통과. STT 실 파이프라인은 환경 차단(별도 blocker).

@goal: 업무 기록 API (D14)
work_log CRUD(goal/result_url/next_action 충실도 필드), daily_status. 업무 6개 계약 케이스 활성화·통과.

@goal: KPI API + 이의신청 상태머신 (D14/D15/D16)
kpi_result 조회(롱포맷, period_type/period_key), AI 초안 필드(ai_draft) 자리, 관리자 조정(admin_adjusted_score/admin_note), 이의신청 상태머신(none→submitted→reviewing→resolved, D15), final_score. 정량 점수는 결정론적 코드 계산(D14-e). KPI 12개 계약 케이스 활성화·통과.

@goal: 동기화 모니터링 + 감사 로그 API (D18/D20)
ERP 동기화 상태/수동트리거 엔드포인트, 동기화 실패 알림 표면, audit_log 조회. 동기화 4개 + 감사 3개 계약 케이스 활성화·통과.

@goal: 외부공개 보안 하드닝 + 배치 스케줄러 (D21-r/D17/C2)
로그인 rate-limit + 계정 잠금(brute-force 방어, C2), 보안 수용 기준 테스트. APScheduler 기반 배치: daily_reports push 18:00 KST, KPI AI 초안 21:00, ERP 증분 매시간 + 00:00 전체 대사, metric 단위 멱등 upsert + advisory lock. Caddy/배포 문서(docs/deployment/onprem-docker.md) 정합. 배치·보안 단위 테스트 통과.

@goal: 환경 차단 작업을 durable blocker로 등록
Godot 3D 클라이언트(Phase 1), 헤드리스 실시간 서버 + 클라이언트 WSS 네트워킹(Phase 4), LiveKit 화상 + STT 회의록 런타임(Phase 5), 선행 스파이크 S1~S4, ERP 라이브 read-only DB 접속(OQ10, 계정 대기), 공인 도메인 구매(R-d)를 실행 불가 사유(Godot/GPU/LiveKit/ERP-DB/자격증명 부재)와 함께 docs/planning/loop/blocked-work-registry.md 로 기록하고, human_blocked 로 분류한다. 이 스토리는 문서화가 산출물이며 코드로 완결하지 않는다.
