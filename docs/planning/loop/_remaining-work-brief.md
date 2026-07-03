가상오피스 백엔드 관리 API의 승인 기획(docs/planning/00-decisions.md D1~D25, docs/planning/loop/final-planning-approval.md, docs/api/management-api.yaml, docs/planning/12-tasks.md) 대비, 이 개발 환경(Windows 로컬, PostgreSQL/실 ERP/GPU/Godot/LiveKit 부재)에서 실행·검증 가능한 잔여/누락 작업만 마감한다. 관리 API 본체(G001~G011)와 감사 생산자 훅(B-14)은 이미 완료됨.

공통 제약 (모든 스토리 적용):
- 정본(SSOT): docs/planning/00-decisions.md. 충돌 시 정본 우선.
- 수용 기준: backend/tests/contract/test_management_api_stubs.py 의 해당 @pytest.mark.skip 스텁을 활성화·통과. 스텁이 명세/모델과 어긋나면 명세·모델 정본 우선 rigorous 재작성(근거 기록).
- venv/pytest: PY="$(pwd)/backend/.venv/Scripts/python.exe"; cd backend && "$PY" -m pytest -q -p no:cacheprovider. 상대경로 exe 직접 실행은 이 환경서 실패하므로 절대경로 변수 필수.
- 기존 코드 컨벤션 재사용(app/api/*.py 라우터, app/services/*, app/erp/*, app/models/tables.py). 병렬 컨벤션 금지.
- 회귀 베이스라인 298 passed / 28 skipped / 0 failed 는 절대 회귀하지 않는다.
- 환경/후속 Phase 차단 및 정책 대기 작업은 이 브리프 범위 밖이며 docs/planning/loop/blocked-work-registry.md 에 durable 등록되어 있다: Godot 3D(Phase1)·실시간 WSS(Phase4)·LiveKit+STT(Phase5)·STT 정확도 측정(S2)·ERP 라이브 DB(OQ10)·공인 도메인(R-d)·감사로그 5년 보존 파기(D20-e, Phase2, 파괴적)·레거시 POST /api/erp/sync deprecation(API 오너 정책 결정). 이들을 코드로 억지 완결하지 않는다.
- 각 스토리 완료 게이트: 타깃 검증 → ai-slop 정리 스윕 → architect 3-레인 리뷰(CLEAR) → executor 레드팀/QA → 전체 회귀 무회귀 → 품질게이트 JSON → checkpoint.

@goal: 루트 migrations 스테일 alembic 트리 정리
루트 `migrations/alembic/versions/0001_kpi_results_table.py` 는 alembic.ini/env.py 러너 없이 orphaned 상태이며, 생성 테이블명이 `kpi_results`(복수)로 모델 정본 `kpi_result`(단수, backend/app/models/tables.py) 및 실제 스키마 관리 경로 backend/alembic/versions/0001_initial_schema.py 와 불일치하는 스테일 사(死)artifact다. 실제 DB 스키마는 backend/alembic 로만 관리된다. 이 orphaned 루트 migrations 트리가 어떤 코드/설정/CI에서도 참조되지 않음을 확인한 뒤 정본과 충돌 없이 제거하고, 제거가 백엔드 마이그레이션/부트/테스트를 깨지 않음을 검증한다(전체 회귀 무회귀). 참조가 발견되면 제거 대신 정본(kpi_result 단수, backend/alembic) 정합으로 조정하고 근거를 기록한다. 산출물: 정리 + 근거.

@goal: KPI 분기 집계 엔드포인트 활성화
POST /kpi/aggregate?period=<YYYY-Q#> 를 202 스텁(batch_scheduler_not_implemented_g010)에서 실제 관리자 트리거 동기 집계로 활성화한다. 기존 app/services/kpi_scoring.py 의 aggregate_user_period + period_key_to_range 를 재사용해, 지정 기간에 데이터가 있는 사용자별 quarterly KpiResult(period_type=QUARTERLY, period_key)를 멱등 upsert 로 산출한다(재호출 시 중복 생성 금지). 실 cron 스케줄 발화는 여전히 환경차단(G011 B-16)이며 여기서는 admin 동기 트리거만 활성화한다. RBAC(admin/super_admin 전용, 그 외 403) 유지. backend/tests/contract/test_management_api_stubs.py::TestKPIResultAPI::test_kpi_quarterly_aggregation 스텁을 실제 계약(집계 결과·멱등·RBAC)으로 rigorous 재작성·활성화·통과.

@goal: ERP 동기화 전략 검증 활성화
backend/tests/contract/test_management_api_stubs.py::TestSyncAPI::test_sync_incremental_plus_daily_full 스텁을 활성화해, 기존 app/services/scheduler.py 의 erp_incremental_sync(증분)·erp_full_reconciliation(전체 대사) + app/erp/sync.py sync_users 의 soft-delete 전략(D18: 하드삭제 감지 시 is_active=false, FK RESTRICT+soft-delete)을 MockErpReader 기반으로 검증한다. 새 엔드포인트 신설 없이 기존 서비스 함수 계약을 실증한다(증분 재실행 멱등, 전체 대사 시 미존재 사용자 soft-delete). 스텁이 미구현 batch를 가정하면 실제 서비스 계약 기준으로 재작성.

@goal: 통합 워크플로우 e2e 활성화
backend/tests/contract/test_management_api_stubs.py::TestIntegrationAPIFlow::test_full_workflow_login_to_kpi 스텁을 활성화해, 로그인 → 회의 생성/입장(토큰 발급) → 회의록 작성/확정 → KPI 조회/이의신청 크로스컷 e2e 를 기존 구현 엔드포인트로 실증한다. LiveKit 실 룸 생성·실 ERP push 는 환경차단이므로 계약 표면(결정적 room_name/토큰, 모의)까지만 검증한다. 각 단계 상태 전이·RBAC 정합을 단일 워크플로우로 확인한다.
