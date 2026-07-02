# 12-tasks.md

## 태스크 분해 및 로드맵 실행 계획

**프로젝트**: 가상오피스 운영 플랫폼 (vituraloffice_new)  
**버전**: v2.0  
**생성일**: 2026-07-01  
**최종 수정**: 2026-07-02  
**최종 목표**: 로드맵 7단계 완성 (MVP 컷 없음, 온전한 통합 솔루션)  
**개발 모델**: 1인 + AI 협업, TDD 기반  
**총 Phase**: 8개 (Phase 0 + Phase 1~7)  
**총 Task**: 약 70개  
**정본 기준**: `00-decisions.md` (D1~D25, F절) — 충돌 시 정본이 우선

> **변경 요약 (v2.0, 2026-07-02)**: 일정 58주 기준 정합(D6), 산출물 확장자 `.cs`→`.gd` 전면 수정(D2), Phase 병렬 표기 제거·순차 원칙 통일(1인 개발, R7), 성능 수치 설계 100명/검증 20명 통일(D22), 웹 3D 미리보기 제거→2D 편집+데스크톱 draft 모드(D11), Phase 0 스파이크 S1~S4 신설(F절), Phase 5 STT 회의록 태스크 신설(D5)·GDNative→GDExtension, 누락 태스크 신설(이의신청·분기집계·daily_reports push·감사로그·클라 자동업데이트·ERP 동기화 실패 알림·도그푸딩 피드백), ERP 동기화 D18·엔드포인트 `POST /api/kpi-results` 통일, 화상 지연 <200ms.

---

## Phase 0: 계약 & 테스트 설계 + 스파이크

> **목적**: API/데이터/ERP 연동 계약 확정, 통합 테스트 골격, 마이그레이션 전략 수립, **선행 기술 리스크 스파이크(S1~S4, F절)**.  
> **산출물**: API 명세(OpenAPI), DB 스키마(ERD + SQLAlchemy 모델), ERP 연동 계약서, 테스트 프레임워크, Alembic 마이그레이션 초안, 스파이크 리포트 4종.  
> **선행**: 없음. Phase 0 완료 후 **Phase 1~7은 순차 진행**(1인 개발, 병렬 불가 — 13-risks R7).

### [x] P0-T0.1: 3D 클라이언트-서버 API 계약 정의 (WebSocket/WSS 확정, OQ4 종결)

- **담당**: test-specialist
- **의존**: 없음
- **산출물**: 
  - OpenAPI 스펙: `docs/api/realtime-server-api.yaml`
  - 엔드포인트: **WebSocket(WSS) 프로토콜**(D1 확정, ENet 폐기) + REST fallback 정의
  - 메시지 스키마: 아바타 이동, 회의실 점유, 근접 감지, 상태 변경. 재접속 시 sequence_num 스냅샷 재수신, 핸드셰이크 `protocol_version` 협상(D4)
- **완료 조건**:
  - WebSocket 메시지 타입 12개 이상 정의 (avatar_move, presence_update, meeting_room_enter/leave, 등)
  - 동시성 제약 명시 (**설계 100명 / 도그푸딩 검증 20명**, D22 — 500명 표기 폐기), seat 점유 배타성
  - 에러 코드 정의 (충돌, 권한, 타임아웃, 미지원 protocol_version 거부)
  - **OQ4(프로토콜 선택) 확정 종결 명시** — WebSocket(WSS)

### [x] P0-T0.2: 관리·업무·KPI API 계약 정의

- **담당**: test-specialist
- **의존**: 없음
- **산출물**: 
  - OpenAPI 스펙: `docs/api/management-api.yaml`
  - REST 엔드포인트: 직원/팀/좌석/회의/KPI CRUD + 벌크 작업
  - 인증/권한: JWT(24h) + role-based 접근
- **완료 조건**:
  - 엔드포인트 25개 이상 정의
  - Request/Response 스키마 JSON Schema 형식
  - 에러 응답 표준화 (400/401/403/404/500)

### [x] P0-T0.3: 데이터 모델 및 ERD 정의

- **담당**: database-specialist
- **의존**: P0-T0.2
- **산출물**: 
  - ERD(Mermaid): `docs/data-model/erd.md` ✅
  - SQLAlchemy 모델 스켈레톤: `backend/app/models/tables.py` (주요 엔티티 클래스) ✅
  - 마이그레이션 전략 문서: `docs/data-model/migration-strategy.md` ✅
- **완료 조건**:
  - 13개 주요 테이블 정의 완료 (erp_user, org_group, team_zone, office, floor, office_layout, room, seat, presence, meeting, meeting_minute, work_log, kpi_result) ✅
  - 인덱스/제약조건 설계 ✅
  - 초기 데이터(fixtures) 생성 계획 ✅

### [x] P0-T0.4: ERP 연동 계약 & 인증 설계

- **담당**: test-specialist
- **의존**: 없음
- **산출물**: 
  - ERP 연동 계약서: `docs/erp-integration/contract.md`
  - 서비스계정 정책: `docs/erp-integration/service-account-policy.md`
  - Alembic 마이그레이션(ERP dev 브랜치용): `migrations/alembic/versions/0001_kpi_results_table.py`
- **완료 조건**:
  - read-only 동기화 대상 5개 정의 (users, teams, job_positions, attendances, leaves)
  - 쓰기 전송 스펙 확정 (daily_reports via POST /api/reports, kpi_results via 신규 엔드포인트)
  - ERP dev 브랜치명: `feature/virtual-office-integration` (명시)
  - JWT 서비스계정 갱신 주기: 24h (확정)

### [x] P0-T0.5: 3D 씬 구조 및 asset 레지스트리 설계

- **담당**: 3d-engine-specialist
- **의존**: 없음
- **산출물**: 
  - Godot 씬 구조 다이어그램: `docs/3d-design/scene-structure.md`
  - Asset 레지스트리 명세: `docs/3d-design/asset-registry.md`
  - 리소스 최적화 기준: `docs/3d-design/optimization-criteria.md`
- **완료 조건**:
  - 주요 씬 노드 계층 정의 (RootScene → Office → Floor[n] → Zone[m] → Seats, Rooms, etc.)
  - asset 테이블 스키마 (asset_id, asset_name, asset_type, source_url, license, commercial_allowed, 등)
  - 에셋 파이프라인 명시: glb(raw) → Godot 임포트 최적화(VRAM BC 압축·자동 LOD) → `.tscn` pak 동봉 (D8 — gltfpack/Draco 압축 금지, 07 §5.2 정합)

### [x] P0-T0.6: office_layout 스키마 & 검증 로직 설계

- **담당**: backend-specialist
- **의존**: P0-T0.3, P0-T0.5
- **산출물**: 
  - office_layout JSON 스키마: `docs/data-model/office-layout-schema.json` (JSON Schema 형식)
  - 검증 함수 스켈레톤: `backend/app/services/office_layout_validator.py`
  - 변환 함수 스켈레톤: `backend/app/services/office_layout_to_godot.py`
- **완료 조건**:
  - office_layout 구조: `{version, floors: [{level, name, zones, rooms, seats, collision_map}]}`
  - 검증 항목: 좌표 범위, 좌석 수, 중복 제거, 접근성 경로
  - Godot 변환: JSON → Godot resource 파이프라인 명시

### [x] P0-T0.7: 통합 테스트 프레임워크 & CI/CD 초안

- **담당**: test-specialist
- **의존**: P0-T0.1, P0-T0.2
- **산출물** (완료):
  - ✅ `docs/testing/test-strategy.md` — 테스트 레이어 정의 + Phase별 활성화 계획
  - ✅ `backend/tests/conftest.py` — pytest 구성 (async, TestClient, JWT 팩토리, 시드 픽스처)
  - ✅ `backend/tests/contract/test_management_api_stubs.py` — 관리 API 스텁 (61개 케이스, 9개 리소스)
  - ✅ `backend/tests/contract/test_realtime_api_stubs.py` — WebSocket 스텁 (17개 케이스)
  - ✅ `godot/tests/test_avatar_movement.gd` — GUT 템플릿 (18개 케이스)
  - ✅ `.github/workflows/test-phase.yaml` — CI/CD 파이프라인 + 배포 게이트
- **완료 조건**:
  - ✅ 테스트 레이어 정의 (unit, integration, e2e) → test-strategy.md
  - ✅ API 테스트 스튜브 작성 (모든 P0 계약 엔드포인트 테스트 케이스) → 96개 테스트 케이스
  - ✅ 배포 게이트 정책 명시 → test-phase.yaml + test-strategy.md

### [ ] P0-T0.8: 스파이크 S1 — Godot ↔ LiveKit PoC (최우선, F절)

- **담당**: 3d-engine-specialist
- **의존**: 없음
- **산출물**: 
  - PoC: `spikes/s1_livekit/` (GDScript + WebRTC GDExtension으로 LiveKit 룸 접속)
  - 리포트: `spikes/s1_livekit/report.md` (오디오/비디오 수신 결과, Rust SDK 래핑 대안 평가)
- **완료 조건**:
  - LiveKit 룸 접속 + 오디오/비디오 수신 성공 여부 판정
  - **실패 시 폴백 확정**: 회의 화면만 임베디드 브라우저/외부 창 분리

### [ ] P0-T0.9: 스파이크 S2 — STT 파이프라인 PoC (F절)

- **담당**: backend-specialist
- **의존**: 없음
- **산출물**: 
  - PoC: `spikes/s2_stt/` (LiveKit Egress → STT 화자분리 → 회의록 초안)
  - 리포트: `spikes/s2_stt/report.md` (한국어 초안 품질, 발화자·액션아이템 누락률 측정)
- **완료 조건**:
  - 한국어 회의록 초안 발화자·액션아이템 누락률 측정치 확보(수동 전사 대조, D22 <5% 목표)
  - **실패 시 폴백 확정**: 수동 회의록 + AI 요약으로 격하(PRD 기준 하향 재협의)

### [ ] P0-T0.10: 스파이크 S3 — 헤드리스 서버 부하 (F절)

- **담당**: 3d-engine-specialist
- **의존**: 없음
- **산출물**: 
  - PoC: `spikes/s3_headless_load/` (GDScript 헤드리스 + PhysicsServer3D, 20명 시뮬레이션)
  - 리포트: CPU/메모리 측정
- **완료 조건**:
  - 검증 20명 시뮬레이션에서 tick 20Hz 유지 시 CPU/메모리 여유 확인
  - **실패 시 폴백 확정**: tick 하향(10Hz), 물리 간소화

### [ ] P0-T0.11: 스파이크 S4 — 동적 씬 라이팅 룩 검증 (F절)

- **담당**: 3d-engine-specialist
- **의존**: 없음
- **산출물**: 
  - PoC: `spikes/s4_lighting/` (실시간광 + ReflectionProbe + SSAO, D7)
  - 리포트: 골든 샘플 룩 스크린샷 + 기준 사양(GTX 1650급) fps 측정
- **완료 조건**:
  - 동적 씬 골든 샘플 룩 승인 (라이트맵 베이킹 배제, D7)
  - **실패 시 폴백 확정**: SDFGI 옵션 기본화 + 기준 사양 상향 재협의

---

## Phase 1: 프리미엄 골든 샘플 3D

> **목적**: 브랜드 품질의 3D 환경 1개 구현. 다양한 좌석/회의실/아바타 상호작용 시연.  
> **산출물**: Godot 프로젝트 + 에셋 + 3D 로비 씬.  
> **의존**: Phase 0 완료 (계약 P0-T0.1~0.7 + 스파이크 S1~S4).  
> **순차 원칙**: 1인 개발이므로 Phase는 순차 진행(병렬 불가, R7).

### [ ] P1-S1-T1: 로비/브랜드월/공개 영역 모델링

- **담당**: 3d-engine-specialist
- **의존**: P0-T0.5, P0-T0.6
- **산출물**: 
  - Godot 씬: `godot/scenes/office/lobby.tscn`
  - GLB 에셋: `godot/assets/models/lobby_structure.glb`
  - 조명/머티리얼: `godot/scenes/materials/lobby_materials.tres`
- **Worktree**: `worktree/phase-1-golden-3d`
- **브랜치**: `phase-1-golden-3d`
- **완료 조건**:
  - 로비 크기: 50m × 30m (실제 사무실 스케일)
  - 브랜드월(3m × 5m) + 안내 데스크 + 대기 영역
  - Forward+ 렌더러 품질 확인 (퀄리티 기준)
  - 로딩 시간 < 3초

### [ ] P1-S1-T2: 좌석 영역(Open, Fixed, Free) 3D 표현

- **담당**: 3d-engine-specialist
- **의존**: P1-S1-T1, P0-T0.6
- **산출물**: 
  - Godot 씬: `godot/scenes/office/seating_area.tscn`
  - 좌석 프리팹: `godot/prefabs/seat_desk.tscn` (Fixed), `godot/prefabs/free_seat.tscn`
  - 마킹 시스템: 점유/비점유/예약 시각화
- **Worktree**: `worktree/phase-1-golden-3d`
- **브랜치**: `phase-1-golden-3d`
- **완료 조건**:
  - 좌석 30개 이상 배치
  - 각 좌석에 이름/부서/상태 HUD 부착
  - 점유 실시간 표색 (Green=비어있음, Blue=점유, Red=예약)

### [ ] P1-S1-T3: 회의실 2개 + 라운지/집중실/폰부스 모델링

- **담당**: 3d-engine-specialist
- **의존**: P1-S1-T1
- **산출물**: 
  - Godot 씬: `godot/scenes/office/meeting_rooms.tscn`
  - 프리팹: `godot/prefabs/meeting_room_glass.tscn`, `godot/prefabs/lounge.tscn`, `godot/prefabs/focus_room.tscn`, `godot/prefabs/phone_booth.tscn`
  - 침입 감지(Trigger): 각 실의 enter/leave 콜라이더
- **Worktree**: `worktree/phase-1-golden-3d`
- **브랜치**: `phase-1-golden-3d`
- **완료 조건**:
  - 회의실 2개(각 10인 수용) + 라운지 + 집중실 + 폰부스 1개
  - 유리/투명성 시각 차별화
  - 용도별 색상/조명 다양화

### [ ] P1-S1-T4: 아바타 모델 및 애니메이션(5~10명) 제작

- **담당**: 3d-engine-specialist
- **의존**: 없음
- **산출물**: 
  - 아바타 베이스 모델: `godot/assets/models/avatar_base.glb` (Rigged, 중성 외형)
  - 색상/의류 variant: `godot/assets/models/avatar_variant_{1..10}.glb`
  - 애니메이션: idle, walk, run, interact, sit, stand_talk (6가지 이상)
  - Godot GDScript: `godot/scripts/avatar.gd` (D2)
- **Worktree**: `worktree/phase-1-golden-3d`
- **브랜치**: `phase-1-golden-3d`
- **완료 조건**:
  - 아바타 5~10명 시각 차별화
  - 애니메이션 부드러움(30 FPS 이상)
  - 성능: 10명 동시 렌더링 < 60ms @ 60Hz (Forward+)

### [ ] P1-S1-T5: 이름/상태 HUD + 우측 직원 정보 패널

- **담당**: 3d-engine-specialist
- **의존**: P1-S1-T4
- **산출물**: 
  - 아바타 머리 위 HUD 라벨: `godot/scripts/avatar_hud.gd` (이름, 부서, 상태 아이콘, D2)
  - 우측 패널 UI: `godot/scenes/ui/employee_panel.tscn` (선택된 아바타 정보)
  - 상태 아이콘: offline, online, working, meeting, focus, away, external (7종, D13)
- **Worktree**: `worktree/phase-1-golden-3d`
- **브랜치**: `phase-1-golden-3d`
- **완료 조건**:
  - HUD는 카메라 방향 항상 유지 (Billboard 방식)
  - 패널: 이름/부서/역할/상태/최근 회의/근무시간 표시
  - 폰트 가독성(한글 포함) 검증

### [ ] P1-S1-T6: 하단 회의 패널 + 미니맵 프로토타입

- **담당**: 3d-engine-specialist
- **의존**: P1-S1-T3, P1-S1-T5
- **산출물**: 
  - 하단 회의 패널 UI: `godot/scenes/ui/meeting_panel.tscn` (현재 진행 회의 목록, join 버튼)
  - 미니맵 씬: `godot/scenes/ui/minimap.tscn` (top-down 오피스 뷰, 아바타 마커)
  - 마우스 진입 감지: Raycast 기반
- **Worktree**: `worktree/phase-1-golden-3d`
- **브랜치**: `phase-1-golden-3d`
- **완료 조건**:
  - 미니맵 스케일: 실시간 동적 업데이트(아바타 위치)
  - 회의 목록: 시뮬레이션 데이터로 3~5개 항목 표시

### [ ] P1-S1-V: 골든 샘플 3D 통합 검증

- **담당**: test-specialist
- **의존**: P1-S1-T1 ~ P1-S1-T6
- **수용기준**:
  - Godot 씬 로드 성공 (에러/경고 0개)
  - 아바타 10명 동시 렌더링 + HUD 표시 + 미니맵 업데이트 시뮬레이션 성공
  - 성능 기준: 60 FPS 유지, 메모리 < 2GB
  - 사용자/관리자 육안 검증: 브랜드 품질 충족 확인

---

## Phase 2: ERP 동기화 & 좌석 배정

> **목적**: ERP 직원·조직·근태 데이터 읽기, 좌석·구역 우리 DB 구축, 아바타 시작위치 매핑.  
> **산출물**: 동기화 배치, 좌석 관리 API, 조직-팀-구역 계층.  
> **의존**: Phase 1 완료 (순차 원칙, R7).

### [ ] P2-R1-T1: ERP 직원/조직/근태 read-only 동기화 배치

- **담당**: backend-specialist
- **의존**: P0-T0.4, P0-T0.3
- **산출물**: 
  - 배치 스크립트: `backend/app/tasks/erp_sync_worker.py` (APScheduler 기반)
  - 모델: `backend/app/models/tables.py::ErpUser, ErpTeam, ErpAttendance`
  - 동기화 로그: `backend/app/services/erp_sync_log.py`
- **Worktree**: `worktree/phase-2-erp-integration`
- **브랜치**: `phase-2-erp-integration`
- **완료 조건**:
  - 읽기 대상 5개 테이블: users, teams, job_positions, attendances, leaves (읽기 전용 DB 스코프)
  - 동기화 주기: **매시간 증분(updated_at) + 매일 00:00 KST 전체 대사**(D18)
  - 전체 대사에서 하드 삭제 감지 → `is_active=false` **soft-delete**(미러 FK는 RESTRICT + soft-delete, D18)
  - 에러 처리 + 재시도 로직(exponential backoff), **동기화 실패 시 자동 알림**(관리자 콘솔 + 알림 채널, D18)
  - 로그 기록 (what, when, who, status)

### [ ] P2-R1-T2: erp_user 마이그레이션 & 조인 키(ERP users.id) 저장

- **담당**: database-specialist
- **의존**: P0-T0.3, P0-T0.4
- **산출물**: 
  - Alembic 마이그레이션: `backend/migrations/versions/0002_erp_user_sync.py`
  - 스키마: erp_user(id(FK users.id), company_id, email, name, erp_team_id, role, position, position_id, manager_id, slack_user_id, github_username, jira_email, work_type, work_hours, last_synced_at)
  - 인덱스: (company_id, email) unique, erp_team_id
- **Worktree**: `worktree/phase-2-erp-integration`
- **브랜치**: `phase-2-erp-integration`
- **완료 조건**:
  - erp_user 테이블 생성 + 데이터 마이그레이션 성공
  - 중복/null 검증 통과

### [ ] P2-R1-T3: 조직 그룹(org_group) 계층 구축

- **담당**: backend-specialist
- **의존**: P2-R1-T2
- **산출물**: 
  - 마이그레이션: `backend/migrations/versions/0003_org_group.py`
  - 모델: `backend/app/models/tables.py::OrgGroup`
  - 스키마: id, name, type[division|department|part], parent_id(FK), color, sort_order
  - API: GET /api/org-groups, POST, PUT, DELETE (admin만)
- **Worktree**: `worktree/phase-2-erp-integration`
- **브랜치**: `phase-2-erp-integration`
- **완료 조건**:
  - 표본 조직 3단계 트리 생성 및 테스트
  - CRUD 엔드포인트 전량 구현 및 테스트

### [ ] P2-R2-T1: team_zone 매핑 (ERP 팀 ↔ 3D 구역)

- **담당**: backend-specialist
- **의존**: P2-R1-T3, P0-T0.6
- **산출물**: 
  - 마이그레이션: `backend/migrations/versions/0004_team_zone.py`
  - 모델: `backend/app/models/tables.py::TeamZone`
  - 스키마: id, erp_team_id, org_group_id, office_id, floor_id, zone_label, color, polygon(좌표 blob)
  - API: GET, POST /api/team-zones (office_id 스코프)
- **Worktree**: `worktree/phase-2-erp-integration`
- **브랜치**: `phase-2-erp-integration`
- **완료 조건**:
  - 5개 팀 × 2개 구역 테스트 데이터 생성
  - Polygon 좌표 검증(범위, 중첩)

### [ ] P2-R2-T2: seat 테이블 & 좌석 배정 로직

- **담당**: database-specialist
- **의존**: P2-R2-T1
- **산출물**: 
  - 마이그레이션: `backend/migrations/versions/0005_seat.py`
  - 모델: `backend/app/models/tables.py::Seat`
  - 스키마: id, floor_id, team_zone_id, type[fixed|free|temp|partner], assigned_user_id(FK erp_user.id), coords(x,y), facing(도 단위, D25), status[available|occupied|reserved|maintenance] (D13 통일)
  - 테이블: seat_assignment_history(id, seat_id, user_id, assigned_at, released_at)
- **Worktree**: `worktree/phase-2-erp-integration`
- **브랜치**: `phase-2-erp-integration`
- **완료 조건**:
  - 좌석 100개 테스트 데이터 생성
  - 배정 이력 추적 (언제 누가 어느 좌석)

### [ ] P2-R2-T3: 좌석 배정 API (할당/예약/해제)

- **담당**: backend-specialist
- **의존**: P2-R2-T2
- **산출물**: 
  - API: 
    - POST /api/seats/{seat_id}/assign - 고정 배정
    - POST /api/seats/{seat_id}/reserve - 예약
    - DELETE /api/seats/{seat_id}/assign - 해제
    - GET /api/seats?floor_id=&status= - 조회
  - 스크립트: `backend/app/services/seat_assignment.py`
- **Worktree**: `worktree/phase-2-erp-integration`
- **브랜치**: `phase-2-erp-integration`
- **완료 조건**:
  - 배정 충돌 방지(unique constraint) 검증
  - 배정/예약/해제 트랜잭션 정확성
  - 이력 자동 기록

### [ ] P2-R3-T1: 아바타 시작 위치 매핑 (assigned_seat → 3D coords)

- **담당**: backend-specialist
- **의존**: P2-R2-T3, P0-T0.6
- **산출물**: 
  - API: GET /api/users/{user_id}/avatar-spawn-location
  - 함수: `backend/app/services/avatar_spawner.py::get_spawn_location(user_id, office_id, floor_id)`
  - 로직: assigned_seat.coords → 3D 씬 좌표 변환
- **Worktree**: `worktree/phase-2-erp-integration`
- **브랜치**: `phase-2-erp-integration`
- **완료 조건**:
  - 좌석 좌표 → 3D 씬 좌표 변환 테스트 통과
  - 로비/기본 지점 폴백 로직

### [ ] P2-R3-T2: presence 테이블 & 실시간 상태 기반 계설

- **담당**: database-specialist
- **의존**: 없음 (Phase 2 내 독립 Task — P2-R2와 별개로 진행 가능)
- **산출물**: 
  - 마이그레이션: `backend/migrations/versions/0006_presence.py`
  - 모델: `backend/app/models/tables.py::Presence`
  - 스키마: user_id(FK), office_id, floor_id, x, y, status[offline|online|working|meeting|focus|away|external] (7종 확정, D13), updated_at
  - 인덱스: (user_id, office_id) unique, updated_at
- **Worktree**: `worktree/phase-2-erp-integration`
- **브랜치**: `phase-2-erp-integration`
- **완료 조건**:
  - 테이블 생성 + 샘플 데이터 20명
  - 상태 전환 유효성 검증

### [ ] P2-R3-V: ERP 동기화 및 좌석/구역 통합 검증

- **담당**: test-specialist
- **의존**: P2-R1-T3, P2-R2-T3, P2-R3-T1, P2-R3-T2
- **수용기준**:
  - ERP 동기화 배치 실행 성공 (직원 10명 이상 동기화)
  - 좌석 배정 → 아바타 시작위치 매핑 E2E 테스트 통과
  - 조직 그룹 4단계 트리 생성 및 조회 성공
  - 성능: 배치 동기화 < 5초(100명 기준)

---

## Phase 3: 사무실 배치 편집기

> **목적**: 사무실 구조(floor/zone/seat/room) 2D 시각 편집 + 3D 미리보기 + 검증 + 배포/롤백.  
> **산출물**: Next.js 웹 UI + Konva.js 2D 캔버스 + 데스크톱 draft 모드 열람 + office_layout JSON 생성 (웹 3D 미리보기 제거, D11).  
> **의존**: Phase 2 완료 (좌석/구역 정의, 순차 원칙).

### [ ] P3-R1-T1: office/floor/room 관리 API

- **담당**: backend-specialist
- **의존**: P0-T0.3
- **산출물**: 
  - 마이그레이션: `backend/migrations/versions/0007_office_floor_room.py`
  - 모델: `backend/app/models/tables.py::Office, Floor, Room`
  - API:
    - POST /api/offices - 사무실 생성
    - GET /api/offices/{office_id}/floors - 층 조회
    - POST /api/floors - 층 생성
    - POST /api/rooms - 회의실 등 생성
- **Worktree**: `worktree/phase-3-layout-editor`
- **브랜치**: `phase-3-layout-editor`
- **완료 조건**:
  - CRUD 엔드포인트 전량 구현
  - office_id 스코프 검증
  - 테스트 데이터: 1 office × 3 floors × 10 rooms

### [ ] P3-R1-T2: office_layout 버전 관리 & 검증 API

- **담당**: backend-specialist
- **의존**: P0-T0.6, P3-R1-T1
- **산출물**: 
  - 마이그레이션: `backend/migrations/versions/0008_office_layout.py`
  - 모델: `backend/app/models/tables.py::OfficeLayout`
  - 스키마: id, office_id, floor_id, version(int), status[draft|validated|deployed|archived], json(blob), created_by, created_at, validated_at
  - API:
    - POST /api/office-layouts - draft 생성
    - PUT /api/office-layouts/{id} - JSON 업데이트
    - POST /api/office-layouts/{id}/validate - 검증 실행
    - POST /api/office-layouts/{id}/deploy - deployed로 전환 + 이전 버전 archived
- **Worktree**: `worktree/phase-3-layout-editor`
- **브랜치**: `phase-3-layout-editor`
- **완료 조건**:
  - JSON 검증 함수 정확성 (좌표 범위, 좌석 수, 중복 제거)
  - 버전 관리 로직(이전 버전 자동 archive)
  - 배포 원자성(all-or-nothing)

### [ ] P3-R2-T1: Next.js 2D 편집 UI (Konva.js 기반)

- **담당**: frontend-specialist
- **의존**: P3-R1-T1
- **산출물**: 
  - 페이지: `frontend/app/(admin)/layout-editor/page.tsx`
  - 컴포넌트: `frontend/components/LayoutEditor.tsx`, `frontend/components/FloorsPanel.tsx`, `frontend/components/SeatsPanel.tsx`
  - Konva 스크립트: `frontend/lib/konva-helpers.ts` (드래그, 스냅 그리드, 좌표 계산)
- **Worktree**: `worktree/phase-3-layout-editor`
- **브랜치**: `phase-3-layout-editor`
- **완료 조건**:
  - 캔버스 렌더: 층/존/좌석 2D 표현
  - 상호작용: 드래그 이동, 리사이징, 스냅 그리드(1m 단위)
  - 우클릭 메뉴: 삭제, 복제, 속성 편집
  - 마우스 좌표 실시간 표시

### [ ] P3-R2-T2: 데스크톱 draft 모드 열람 (웹 3D 미리보기 제거, D11)

- **담당**: 3d-engine-specialist
- **의존**: P1-S1-V, P3-R1-T2
- **산출물**: 
  - Godot draft 뷰어 씬/스크립트: `godot/scenes/layout_draft_viewer.tscn`, `godot/scripts/layout_loader.gd` (`--draft` 플래그로 저장된 office_layout 버전 로드)
  - Next.js 안내 컴포넌트: `frontend/components/DraftOpenGuide.tsx` (저장 후 데스크톱 draft 모드 열람 안내 + 딥링크)
- **Worktree**: `worktree/phase-3-layout-editor`
- **브랜치**: `phase-3-layout-editor`
- **완료 조건**:
  - 웹 3D 미리보기(HTML5/WASM export) **미사용**(PRD WON'T 준수, D11)
  - 데스크톱 클라이언트 draft 모드에서 office_layout JSON으로 동적 좌석/개구부 배치 확인
  - draft 로딩 시간 < 5초

### [ ] P3-R2-T3: 검증 + 배포/롤백 UI

- **담당**: frontend-specialist
- **의존**: P3-R1-T2, P3-R2-T2
- **산출물**: 
  - 대화상자: `frontend/components/LayoutValidationDialog.tsx`, `frontend/components/DeploymentDialog.tsx`
  - 로직: 검증 결과 표시(에러/경고 목록), 배포 확인, 진행 중 상태 표시
- **Worktree**: `worktree/phase-3-layout-editor`
- **브랜치**: `phase-3-layout-editor`
- **완료 조건**:
  - 검증 실행 후 에러/경고 명확히 표시
  - 배포 전 스냅샷 자동 생성
  - 롤백: 이전 버전으로 원클릭 복구

### [ ] P3-R3-T1: office_layout JSON 직렬화/역직렬화

- **담당**: backend-specialist
- **의존**: P0-T0.6, P3-R2-T1
- **산출물**: 
  - 함수: `backend/app/services/office_layout_serializer.py::to_json(office_obj), from_json(json_blob, office_id)`
  - 스키마: Python dataclass 또는 Pydantic BaseModel
- **Worktree**: `worktree/phase-3-layout-editor`
- **브랜치**: `phase-3-layout-editor`
- **완료 조건**:
  - Round-trip 테스트: Python object → JSON → Python object 동일성
  - 호환성: 버전별 마이그레이션 로직(v1→v2 예상)

### [ ] P3-R3-T2: office_layout → Godot 씬 변환 파이프라인

- **담당**: backend-specialist + 3d-engine-specialist
- **의존**: P0-T0.6, P1-S1-T2, P3-R3-T1
- **산출물**: 
  - 함수: `backend/app/services/office_layout_to_godot.py::generate_godot_resource(office_layout_json, output_path)`
  - 출력: `.tres` (Godot Resource) / 임포트 완료본 `.tscn` (D8)
  - Godot 로더 스크립트: `godot/scripts/office_layout_loader.gd` (D2)
- **Worktree**: `worktree/phase-3-layout-editor`
- **브랜치**: `phase-3-layout-editor`
- **완료 조건**:
  - office_layout JSON → Godot 좌석/존/충돌맵 자동 생성
  - 성능: 변환 < 1초 (100 seats 기준)

### [ ] P3-R3-V: 사무실 배치 편집기 통합 검증

- **담당**: test-specialist
- **의존**: P3-R1-T2, P3-R2-T3, P3-R3-T2
- **수용기준**:
  - 2D 편집: 좌석 50개 드래그 이동 + 저장 성공
  - 데스크톱 draft 모드: 편집 내용 저장 후 열람 반영 확인 (웹 3D 미리보기 없음, D11)
  - 서버 정밀 검증(D12) 실행 후 ERROR 0개 통과 (ERROR는 배포 불가, WARNING만 무시 가능)
  - 배포 후 Godot 씬 로드 성공
  - 롤백: 이전 버전 복구 성공

---

## Phase 4: 실시간 가상오피스 (Godot 헤드리스 서버)

> **목적**: 멀티플레이어 기능의 서버 권위 구현. 아바타 이동·충돌·근접·회의실 점유 검증. 프레즌스 동기화.  
> **산출물**: Godot 헤드리스 서버 + WebSocket(WSS) 게이트웨이 + 실시간 프레즌스 동기화.  
> **의존**: Phase 3 완료 (좌석·3D 씬·office_layout, 순차 원칙).

### [ ] P4-R1-T1: Godot 헤드리스 서버 프로젝트 생성 & 에센셜 로직

- **담당**: 3d-engine-specialist
- **의존**: P1-S1-V, P0-T0.6
- **산출물**: 
  - 프로젝트: `godot-server/` (별도 repo 또는 subdirectory)
  - 메인 씬: `godot-server/scenes/server_main.tscn`
  - GDScript: `godot-server/scripts/server_manager.gd` (초기화, 플레이어 관리, D2)
  - 설정: `godot-server/project.godot` (headless 렌더러 비활성화)
- **Worktree**: `worktree/phase-4-realtime-server`
- **브랜치**: `phase-4-realtime-server`
- **완료 조건**:
  - `godot-server --headless` 실행 가능
  - 기본 회피(Panic) 없이 정상 종료
  - 로그: `print()` → 파일로 리다이렉트 확인

### [ ] P4-R1-T2: WebSocket 게이트웨이 (Python asyncio 기반)

- **담당**: backend-specialist
- **의존**: P0-T0.1, P0-T0.2
- **산출물**: 
  - 모듈: `backend/app/websocket/gateway.py` (FastAPI WebSocket endpoint)
  - 클래스: `WebSocketManager` (연결 관리, 메시지 라우팅)
  - API: `/ws/virtual-office/{user_id}` (클라이언트 연결점, WSS)
  - 메시지 라우팅: **in-memory**(게임서버 메모리 권위, D3). 영속 재시도가 필요한 배치성 작업은 APScheduler + DB 영속 큐 사용(Redis 미사용, D21)
- **Worktree**: `worktree/phase-4-realtime-server`
- **브랜치**: `phase-4-realtime-server`
- **완료 조건**:
  - 클라이언트 10개 동시 연결 성공
  - 메시지 브로드캐스트 < 100ms 지연
  - 연결 해제 시 깔끔한 cleanup

### [ ] P4-R2-T1: 아바타 이동 권위 검증 (Godot 서버)

- **담당**: 3d-engine-specialist
- **의존**: P4-R1-T1, P2-R2-T2
- **산출물**: 
  - GDScript: `godot-server/scripts/avatar_controller.gd` (위치 업데이트, 충돌 검사, D2)
  - 로직: 클라이언트 요청 위치 → Godot 씬 PhysicsBody 검사 → 유효 위치만 승인
  - 메시지: `avatar_move_request` → 검증 → `avatar_moved` 브로드캐스트
- **Worktree**: `worktree/phase-4-realtime-server`
- **브랜치**: `phase-4-realtime-server`
- **완료 조건**:
  - 벽 통과 시도 거부 검증
  - 금지 영역(collapse wall) 진입 거부
  - 승인된 이동만 클라이언트에 전송

### [ ] P4-R2-T2: 근접(Proximity) 감지 & 상호작용 트리거

- **담당**: 3d-engine-specialist
- **의존**: P4-R2-T1
- **산출물**: 
  - GDScript: `godot-server/scripts/proximity_detector.gd` (D2)
  - 로직: 아바타 5m 이내 다른 아바타 감지 → `nearby_users` 이벤트 발생
  - 메시지: `user_nearby`, `user_far_away` (자동 감지)
- **Worktree**: `worktree/phase-4-realtime-server`
- **브랜치**: `phase-4-realtime-server`
- **완료 조건**:
  - 근접 거리 임계값: 5m (설정 가능)
  - 감지 업데이트 주기: 1Hz
  - 성능: 설계 100명 아바타 근접 계산 < 50ms (도그푸딩 검증 20명, D22)

### [ ] P4-R2-T3: 회의실 점유 & 진입/퇴장 검증

- **담당**: 3d-engine-specialist
- **의존**: P4-R2-T1, P1-S1-T3
- **산출물**: 
  - GDScript: `godot-server/scripts/room_occupancy.gd` (D2)
  - 로직: 회의실 Trigger Area → 진입/퇴장 감지 → capacity 검사
  - 메시지: `room_enter_request` → 검증(capacity) → `room_entered` or `room_full` 응답
- **Worktree**: `worktree/phase-4-realtime-server`
- **브랜치**: `phase-4-realtime-server`
- **완료 조건**:
  - capacity 초과 거부 검증
  - 중복 진입 방지
  - 퇴장 시 상태 정리

### [ ] P4-R3-T1: 프레즌스 동기화 (아바타 위치 → DB)

- **담당**: backend-specialist
- **의존**: P2-R3-T2, P4-R2-T1
- **산출물**: 
  - 배치 작업: `backend/app/tasks/presence_sync_worker.py`
  - 로직: Godot 서버에서 1초마다 모든 아바타 위치 수집 → presence 테이블 업데이트
  - API: POST /api/internal/presence-sync (내부용, 서버 권위 인증)
- **Worktree**: `worktree/phase-4-realtime-server`
- **브랜치**: `phase-4-realtime-server`
- **완료 조건**:
  - 배치 주기: 1~5초 (설정 가능, D3: 게임서버 메모리 권위 + 주기 배치 push)
  - 정확도: ±1m (3D 좌표)
  - 성능: 설계 100명 presence 업데이트 < 2초 (도그푸딩 검증 20명, D22)

### [ ] P4-R3-T2: 실시간 상태 전환 (online → meeting → away 등)

- **담당**: backend-specialist
- **의존**: P2-R3-T2, P4-R2-T3
- **산출물**: 
  - 로직: 회의실 진입 → status=meeting, 근무 완료 → status=offline
  - 메시지: `status_changed` 이벤트 (자동 또는 수동)
  - API: PUT /api/presence/{user_id}/status (수동 상태 변경)
- **Worktree**: `worktree/phase-4-realtime-server`
- **브랜치**: `phase-4-realtime-server`
- **완료 조건**:
  - 상태 전환 유효성 검증 (로직 정의)
  - 상태 이력 기록

### [ ] P4-R3-V: 실시간 가상오피스 통합 검증

- **담당**: test-specialist
- **의존**: P4-R1-T2, P4-R2-T3, P4-R3-T2
- **수용기준**:
  - Godot 헤드리스 서버 시작 및 10명 클라이언트 연결 성공
  - 아바타 이동 권위 검증: 벽 통과 거부 확인
  - 근접 감지: 5m 이내 사용자 감지 확인
  - 회의실 점유: capacity 초과 거부 확인
  - 프레즌스 동기화: DB presence 테이블 실시간 업데이트 확인
  - 성능: 도그푸딩 검증 20명(설계 100명) 동시 처리, 아바타 동기화 E2E p95 < 500ms (서버 tick 20Hz, D22)

---

## Phase 5: 회의/화상회의 + 회의록 STT

> **목적**: LiveKit 통합(FastAPI 경유 룸 생성, D24), 회의실 예약(+즉석 FCFS 병행, D23)/명시적 입장(D24)/진행, **회의록 STT 자동 생성(정식 범위, D5)**, 액션아이템 기록.  
> **산출물**: 회의 관리 API + STT 회의록 파이프라인 + 검토 UI + LiveKit 통합.  
> **의존**: Phase 4 완료 (실시간 프레즌스, 순차 원칙) + Phase 0 스파이크 S1(Godot↔LiveKit)·S2(STT).

### [ ] P5-R1-T1: 회의 관리 API (예약/시작/종료)

- **담당**: backend-specialist
- **의존**: P0-T0.2, P1-S1-T3, P2-R1-T1
- **산출물**: 
  - 마이그레이션: `backend/migrations/versions/0009_meeting.py`
  - 모델: `backend/app/models/tables.py::Meeting, MeetingParticipant`
  - API:
    - POST /api/meetings - 회의 생성/예약 (예약 + 즉석 FCFS 병행, D23)
    - PUT /api/meetings/{id}/start - 시작 (**FastAPI 경유 LiveKit 룸 생성**, D24)
    - POST /api/meetings/{id}/join - **명시적 입장**(고지·동의 확인 후 LiveKit 토큰 발급, 자동 연결 금지, D24)
    - PUT /api/meetings/{id}/end - 종료 (Egress 종료 트리거)
    - GET /api/meetings?office_id=&date= - 조회
- **Worktree**: `worktree/phase-5-meeting`
- **브랜치**: `phase-5-meeting`
- **완료 조건**:
  - CRUD 엔드포인트 전량 구현
  - 예약 충돌 검증 (회의실 중복 예약 거부, D23)
  - 명시적 입장 다이얼로그 → 클릭 → 토큰 발급 흐름 (자동 접속 금지, D24)
  - 참석자 자동 기록

### [ ] P5-R1-T2: LiveKit + coturn self-host 설치 & 통합 (사내 VM, D21)

- **담당**: backend-specialist (인프라 겸임)
- **의존**: P5-R1-T1 (같은 Phase 내 선행)
- **산출물**: 
  - Docker Compose: `docker-compose.yaml` (**사내 VM**, LiveKit + coturn 서비스 정의, D21 — Kubernetes/클라우드 SaaS 배제)
  - 설정: `livekit.yaml` (RTC port, API key, 사내 PKI TLS 등)
  - 통합 스크립트: `backend/app/services/livekit_client.py` (**FastAPI 경유** room 생성/삭제, D24)
- **Worktree**: `worktree/phase-5-meeting`
- **브랜치**: `phase-5-meeting`
- **완료 조건**:
  - `docker-compose up` 성공 (사내 VM)
  - LiveKit 서버 health check 통과
  - API 키 발급 및 JWT 토큰 생성 확인 (룸 생성은 FastAPI 단일화)

### [ ] P5-R2-T1: 회의 UI (Next.js 대기실/참석자 목록)

- **담당**: frontend-specialist
- **의존**: P5-R1-T1
- **산출물**: 
  - 페이지: `frontend/app/(main)/meetings/page.tsx`
  - 컴포넌트: `frontend/components/MeetingLobby.tsx`, `frontend/components/MeetingParticipants.tsx`
  - 상태: 예약/대기/진행/종료
- **Worktree**: `worktree/phase-5-meeting`
- **브랜치**: `phase-5-meeting`
- **완료 조건**:
  - 회의 목록 표시 + join 버튼
  - 참석자 목록 실시간 업데이트
  - 마이크/카메라 테스트 UI

### [ ] P5-R2-T2: 화상 화면 (LiveKit 통합, Godot 클라이언트, S1 기반)

- **담당**: 3d-engine-specialist
- **의존**: P5-R1-T2, P4-R2-T3, P0-T0.8(S1)
- **산출물**: 
  - GDScript: `godot/scripts/meeting_room_view.gd` (화상 렌더링, D2)
  - **WebRTC GDExtension** 플러그인 (GDNative는 Godot 4에서 폐기, GDExtension으로 정정). 실패 시 임베디드 브라우저 폴백(S1)
  - 회의실 3D 인터페이스: 참석자 비디오 패널
- **Worktree**: `worktree/phase-5-meeting`
- **브랜치**: `phase-5-meeting`
- **완료 조건**:
  - 명시적 입장 후(D24) 화상 활성화
  - 자신 + 상대방 비디오 표시 (2명 기준)
  - 오디오 송수신 확인, 음성 지연 < 200ms (사내망, D22)

### [ ] P5-R3-T1: 회의록 저장 (STT 확정본: 결정사항/액션아이템)

- **담당**: backend-specialist
- **의존**: P5-R1-T1
- **산출물**: 
  - 마이그레이션: `backend/migrations/versions/0010_meeting_minute.py`
  - 모델: `backend/app/models/tables.py::MeetingMinute, ActionItem` (초안/확정 구분 필드 포함)
  - API:
    - POST /api/meeting-minutes - 회의록 저장 (수동 폴백)
    - PUT /api/action-items/{id} - 액션아이템 진행 상태 업데이트
    - GET /api/meetings/{id}/minutes - 조회
- **Worktree**: `worktree/phase-5-meeting`
- **브랜치**: `phase-5-meeting`
- **완료 조건**:
  - STT 초안 검토·확정본 또는 수동 폴백 회의록 저장 (결정사항, 액션아이템 목록)
  - 액션아이템 할당자/기한 지정
  - 이력 추적

### [ ] P5-R4-T1: 회의 오디오 Egress 수집 (LiveKit)

- **담당**: backend-specialist
- **의존**: P5-R1-T2
- **산출물**: 
  - 서비스: `backend/app/services/egress_service.py` (LiveKit Egress 트랙별 오디오 수집)
  - 트리거: 회의 시작 시 Egress 시작, 종료 시 정지
- **Worktree**: `worktree/phase-5-meeting`
- **브랜치**: `phase-5-meeting`
- **완료 조건**:
  - 트랙별(참석자별) 오디오 파일 저장 성공
  - 녹음 원본 보존 90일 정책 반영(D20), 동의 거부자 오디오 미수집(D20)

### [ ] P5-R4-T2: STT + 화자분리 + 회의록 초안 생성 (D5, S2 기반)

- **담당**: backend-specialist
- **의존**: P5-R4-T1, P0-T0.9(S2)
- **산출물**: 
  - 서비스: `backend/app/services/stt_service.py` (STT, 한국어), `backend/app/services/minute_drafter.py` (화자분리 → 회의록 초안 + 액션아이템 후보 추출)
  - API: POST /api/meetings/{id}/transcribe (내부), GET /api/meetings/{id}/minute-draft
- **Worktree**: `worktree/phase-5-meeting`
- **브랜치**: `phase-5-meeting`
- **완료 조건**:
  - Egress 오디오 → STT → 발화자별 텍스트 + 액션아이템 후보 초안 자동 생성
  - 외부 STT/LLM 전송 시 실명→사번 가명화(D20)
  - **폴백**: S2 실패 시 수동 회의록 + AI 요약으로 격하

### [ ] P5-R4-T3: 회의록 초안 검토·확정 UI + 정확도 측정

- **담당**: frontend-specialist + backend-specialist
- **의존**: P5-R4-T2
- **산출물**: 
  - 페이지/컴포넌트: `frontend/app/(main)/meetings/[id]/minute-review/page.tsx`, `frontend/components/MinuteDraftEditor.tsx`
  - API: POST /api/meetings/{id}/minute-confirm (참석자/호스트 검토·확정)
  - 정확도 측정 스크립트: 테스트 회의 N회 대비 **수동 전사 대조** (발화자·액션아이템 누락률, D22)
- **Worktree**: `worktree/phase-5-meeting`
- **브랜치**: `phase-5-meeting`
- **완료 조건**:
  - 발화자별 초안 편집 + 확정 → meeting_minute 확정본 저장
  - 발화자·액션아이템 누락률 < 5% (수동 전사 대조 측정, D22)

### [ ] P5-R3-T2: 회의록 UI (Next.js 편집/조회)

- **담당**: frontend-specialist
- **의존**: P5-R3-T1
- **산출물**: 
  - 컴포넌트: `frontend/components/MeetingMinuteEditor.tsx`, `frontend/components/ActionItemList.tsx`
  - 페이지: `frontend/app/(main)/meetings/{id}/minutes/page.tsx`
- **Worktree**: `worktree/phase-5-meeting`
- **브랜치**: `phase-5-meeting`
- **완료 조건**:
  - 회의록 작성/편집 UI
  - 액션아이템 체크리스트
  - 마크다운 또는 WYSIWYG 에디터

### [ ] P5-R3-T3: 메시지/채팅 저장소 (선택, Phase 5.5)

- **담당**: backend-specialist
- **의존**: P5-R3-T1
- **산출물**: 
  - 마이그레이션: `backend/migrations/versions/0011_message.py`
  - 모델: `backend/app/models/tables.py::Message`
  - API: GET /api/meetings/{id}/messages
- **Worktree**: `worktree/phase-5-meeting`
- **브랜치**: `phase-5-meeting`
- **완료 조건**:
  - 채팅 메시지 저장 및 조회
  - 타임스탬프 기록

### [ ] P5-R3-V: 회의/화상회의 + STT 회의록 통합 검증

- **담당**: test-specialist
- **의존**: P5-R2-T2, P5-R3-T2, P5-R4-T3
- **수용기준**:
  - 회의 예약 → **명시적 입장**(D24) → 화상 참석 → **STT 회의록 초안 → 검토·확정** E2E 성공
  - FastAPI 경유 LiveKit 룸 생성/해제 정상 (D24)
  - 참석자 2명 비디오/오디오 송수신 확인
  - STT 회의록(결정사항/액션아이템) 초안 생성·확정 및 조회 성공
  - STT 정확도: 발화자·액션아이템 누락률 < 5% (수동 전사 대조, D22)
  - 성능: 화상 음성 지연 < 200ms(사내망, D22), 회의록 조회 < 500ms

---

## Phase 6: KPI 산출 & AI 초안 & 관리자 검토 & EOD ERP Push

> **목적**: 협업 결과(회의/업무/완료도) 기반 KPI 산출, AI 초안 생성, 관리자 검토, ERP push.  
> **산출물**: KPI 산출 로직(결정론적, D14) + AI 서술 초안 + 관리자 검토·이의신청 상태머신 + daily_reports/KPI 배치(D17).  
> **의존**: Phase 5 완료 (회의록 신호, 순차 원칙) + ERP dev 브랜치.

### [ ] P6-R1-T1: 업무 기록 (work_log) 저장소 설계

- **담당**: database-specialist
- **의존**: P0-T0.3
- **산출물**: 
  - 마이그레이션: `backend/migrations/versions/0012_work_log.py`
  - 모델: `backend/app/models/tables.py::WorkLog`
  - 스키마: id, user_id, work_date, category, title, goal, related_project, url, est_minutes, status[started|completed], result_url, attachments(JSON), issues, next_action, created_at
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - 테이블 생성 + 샘플 데이터 20개 업무 기록

### [ ] P6-R1-T2: work_log CRUD API

- **담당**: backend-specialist
- **의존**: P6-R1-T1
- **산출물**: 
  - API:
    - POST /api/work-logs - 업무 기록 작성
    - PUT /api/work-logs/{id} - 편집
    - GET /api/work-logs?user_id=&date= - 조회 (본인/관리자)
    - DELETE /api/work-logs/{id}
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - CRUD 엔드포인트 전량 구현
  - 권한 검증 (본인 또는 관리자만 접근)

### [ ] P6-R2-T1: KPI 산출 로직 (회의·완료도·협업 기반)

- **담당**: backend-specialist
- **의존**: P6-R1-T2, P5-R3-T1, P4-R3-T2
- **산출물**: 
  - 모듈: `backend/app/services/kpi_calculator.py` (**정량 점수는 결정론적 코드로 계산**, AI 미개입, D14)
  - 함수: `calculate_kpi_for_user(user_id, period_date)` → dict with metrics
  - 지표 (08-kpi-logic.md 준수, D14):
    - 협업도: 회의록 작성 기여 + 액션아이템 **완료·기한준수 이행률** (회의 참석 기본점·주관자 가점 제거, 생성 가점 제거)
    - 업무충실도: 완료 work_log 건수 + 충실도(goal·result_url·next_action 작성도) (시간 비례 점수 `est_minutes/100` 폐기)
  - **제외**: 접속시간/근무시간, 채팅, 근접, 화상요청 (반감시 정책). **근태 보정(±5%) 제거** — ERP가 attendance 별도 반영, 이중 반영 금지(D14)
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - 지표 계산 정확성 테스트 (5명 샘플 데이터), 결정론적(동일 입력 → 동일 출력)
  - 점수 정규화 (0~100)
  - 08-kpi-logic 신호 정의에 따른 점수 산출 검증 (근태 보정·시간 비례·참석 기본점 미포함)

### [ ] P6-R2-T2: AI 초안 생성 (Claude 기본)

- **담당**: backend-specialist
- **의존**: P6-R2-T1
- **산출물**: 
  - 모듈: `backend/app/services/kpi_ai_summarizer.py`
  - 함수: `generate_ai_narrative(user_id, period_date, kpi_metrics)` → str (**서술만: 강점/개선/근거**, 정량 점수 산출 금지, D14)
  - 프롬프트: 결정론적 KPI 지표 + 회의록/업무기록 요약 → "협업 잘함, 액션아이템 미완료 3개, 개선: 회의 후 follow-up 강화" 등
  - 모델: Claude(기본)
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - AI 호출 성공
  - 응답 예: 50~200자 사유 텍스트
  - 오류 처리 (API timeout 등)

### [ ] P6-R2-T3: KPI 결과 저장소 (kpi_result)

- **담당**: database-specialist
- **의존**: P0-T0.3
- **산출물**: 
  - 마이그레이션: `backend/migrations/versions/0013_kpi_result.py`
  - 모델: `backend/app/models/tables.py::KpiResult` (정본 스키마 = 04-data-model.md, D16)
  - 스키마(D16 롱포맷): id, user_id(FK erp_user.id), **period_type**(daily|quarterly), **period_key**('2026-07-01'|'2026-Q3'), metric(VARCHAR), value(FLOAT 0~100), source(=virtual_office), **ai_draft(JSONB), admin_adjusted_score, admin_note, admin_user_id, objection_status, final_score, finalized_at**, created_at
  - 제약: **UNIQUE(user_id, period_type, period_key, metric)** (upsert 키). period NULL 금지. `kpi_result_review` 테이블 폐기(인라인)
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - 테이블 생성 (period_type/period_key 분리, 리뷰 필드 인라인)
  - 샘플 데이터 10명 × 10일 = 100 KPI records

### [ ] P6-R3-T1: 관리자 KPI 검토 UI (Next.js)

- **담당**: frontend-specialist
- **의존**: P6-R2-T3
- **산출물**: 
  - 페이지: `frontend/app/(admin)/kpi-review/page.tsx`
  - 컴포넌트: `frontend/components/KpiReviewCard.tsx` (AI 초안 표시 + 조정 UI)
  - 형태: 카드 목록 (사용자 × 날짜), AI 사유 표시, 점수 조정 슬라이더, 메모 추가
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - 100개 KPI 카드 UI 렌더링 성공
  - 점수 조정(0~100) 및 메모 저장

### [ ] P6-R3-T2: KPI 검토/조정 API

- **담당**: backend-specialist
- **의존**: P6-R2-T3
- **산출물**: 
  - API: PUT /api/kpi-results/{id}/review
    - payload: `{admin_adjusted: INT, note: TEXT}`
    - response: updated kpi_result with reviewed_at timestamp
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - 권한 검증 (admin/leader only)
  - 변경 이력 기록

### [ ] P6-R3-T3a: daily_reports push 배치 (매일 18:00 KST, D17)

- **담당**: backend-specialist
- **의존**: P0-T0.4, P6-R1-T2
- **산출물**: 
  - 배치 스크립트: `backend/app/tasks/daily_reports_push_worker.py`
  - 로직: **매일 18:00 KST** work_log/daily_status 요약 → ERP daily_reports push (18:00 이후 활동은 익일 귀속, 주말·공휴일 스킵)
  - 로그: `backend/app/models/tables.py::DailyStatusPush`
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - APScheduler 18:00 KST 스케줄, ERP push 성공, 전송 이력 기록
  - 멱등성: 배치 run_id + advisory lock (D17)

### [ ] P6-R3-T3b: KPI AI 초안 야간 배치 (21:00 KST, D17)

- **담당**: backend-specialist
- **의존**: P6-R2-T1, P6-R2-T2, P6-R2-T3
- **산출물**: 
  - 배치 스크립트: `backend/app/tasks/kpi_ai_draft_worker.py`
  - 로직: **21:00 야간 배치** → 결정론적 metrics 계산 + AI 서술 초안 생성 → kpi_result upsert(objection_status="draft", 검토 대기)
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - metric 단위 upsert (UNIQUE 키, D16), advisory lock 동시 실행 방지 (D17)
  - 관리자 리뷰 대기 알림 발송

### [ ] P6-R3-T3c: kpi_results ERP push (관리자 확정 이벤트 + 분기 마감 배치, D15/D17)

- **담당**: backend-specialist
- **의존**: P0-T0.4, P6-R3-T2
- **산출물**: 
  - 서비스/핸들러: `backend/app/services/erp_kpi_pusher.py::push_finalized_kpi()`
  - 로직: **관리자 확정(objection_status="finalized") 이벤트** → 즉시 `POST /api/kpi-results`(**final_score만**, ai_draft 미전송, D15). 분기 마감 시 일괄 push
  - ERP 미준비 시: feature flag OFF → 로컬 적재 → 준비 후 backfill (D17)
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - ERP `POST /api/kpi-results` 성공 (서비스계정 JWT, upsert 멱등)
  - 정정 발생 시 재push(upsert)로 반영 (D15)
  - **ERP 동기화 실패 시 자동 알림** (관리자 콘솔 + 알림 채널, D18)

### [ ] P6-R3-T4: 직원 평가 열람 + 이의신청 상태머신 (D15)

- **담당**: frontend-specialist + backend-specialist
- **의존**: P6-R3-T2
- **산출물**: 
  - 페이지: `frontend/app/(main)/kpi-results/page.tsx`
  - 컴포넌트: `frontend/components/KpiSelfReview.tsx` (AI 초안/관리자 조정 열람, 이의신청 폼)
  - **이의신청 상태머신**(D15): 평가 공개 → 이의접수(**7일**) → 재검토 → 확정 → ERP push. API: 이의 접수(POST /api/kpi-results/{id}/objection), 재검토 상태 전환(PUT .../objection-status), 확정 시 ERP 재push 트리거
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - 상태 전이(draft→published→objected→re_reviewing→finalized) 유효성 검증
  - 이의접수 7일 창 처리, 확정 후 final_score만 ERP 재push(D15)
  - UI 렌더링 + 이의신청 제출/처리 E2E

### [ ] P6-R4-T1: 분기 KPI 집계 + ERP 분기평가 E2E 검증

- **담당**: backend-specialist + test-specialist
- **의존**: P6-R3-T3c
- **산출물**: 
  - 집계 로직: `backend/app/services/quarterly_kpi_aggregator.py` (일간 → 분기 period_type=quarterly, period_key='2026-Q3')
  - `user_team_history` 반영: 분기 중 팀 이동자 벤치마크 왜곡 방지 (D18)
  - E2E 테스트: 분기 집계 → 확정 → ERP push → ERP 분기평가 수집 확인
- **Worktree**: `worktree/phase-6-kpi`
- **브랜치**: `phase-6-kpi`
- **완료 조건**:
  - 분기 집계 정확성 (일간 확정 점수 → 분기 롤업)
  - ERP 분기평가 자료 수집 폐쇄루프 E2E 통과

### [ ] P6-R3-V: KPI 산출·검토·ERP 푸시 통합 검증

- **담당**: test-specialist
- **의존**: P6-R3-T3a, P6-R3-T3b, P6-R3-T3c, P6-R3-T4, P6-R4-T1
- **수용기준**:
  - KPI 정량 산출: 10명 × 10일 **결정론적** 계산 성공, 점수 0~100 범위 내 (D14)
  - AI 서술 초안: 문장 생성 성공 (강점/개선/근거, 정량 미산출)
  - 배치(D17): daily_reports **18:00 KST** / KPI AI 초안 **21:00** 정상 실행, 전송 이력 기록
  - kpi_results ERP push: **관리자 확정 이벤트 + 분기 마감**, final_score만 POST /api/kpi-results (D15)
  - 이의신청 상태머신: 공개→이의접수 7일→재검토→확정→재push E2E (D15)
  - 분기 집계 → ERP 분기평가 수집 폐쇄루프 E2E 통과

---

## Phase 7: 고도화 (MultiFloor, 권한, 요약, 모바일)

> **목적**: 확장성 및 사용성 개선. 다층 건물, 구역별 권한, AI 요약, 모바일 알림 등.  
> **산출물**: 다층 UI + 권한 시스템 + 고급 AI 기능 + 모바일 푸시 알림.  
> **의존**: Phase 1~6 완료.  
> **비고**: B2B/멀티테넌트는 이 이후로 미룸.

### [ ] P7-R1-T1: 다층(MultiFloor) 내비게이션 UI

- **담당**: 3d-engine-specialist + frontend-specialist
- **의존**: P1-S1-V, P3-R3-T2
- **산출물**: 
  - 3D 층 전환: 엘리베이터/계단 스폿 클릭 → 층 로딩
  - 웹 UI: 좌측 층 탭, floor_id 선택
  - API: GET /api/offices/{office_id}/floors/{floor_id} (층별 레이아웃)
- **Worktree**: `worktree/phase-7-advanced`
- **브랜치**: `phase-7-advanced`
- **완료 조건**:
  - 3층 이상 건물 시뮬레이션
  - 층 전환 로딩 시간 < 2초
  - 층 간 이동 충돌 검증

### [ ] P7-R1-T2: 구역별 접근 권한 (zone-based access control)

- **담당**: backend-specialist
- **의존**: P2-R2-T1
- **산출물**: 
  - 모델: `backend/app/models/tables.py::ZoneAccess` (zone_id, role/user_id, permission[view|enter|manage])
  - API: GET /api/zones/{zone_id}/access-control, POST (admin)
  - 로직: 사용자 진입 시 권한 검증 (room enter 차단 가능)
- **Worktree**: `worktree/phase-7-advanced`
- **브랜치**: `phase-7-advanced`
- **완료 조건**:
  - 특정 구역 제한 테스트 (e.g., CEO 오피스 제외)
  - 권한 없는 진입 차단 검증

### [ ] P7-R1-T3: 회의록 AI 요약 (선택, Phase 7.5)

- **담당**: backend-specialist
- **의존**: P5-R3-T2, P6-R2-T2
- **산출물**: 
  - 함수: `backend/app/services/meeting_ai_summarizer.py::summarize_meeting(meeting_id)` → str (회의 핵심 요약)
  - 트리거: 회의 종료 후 자동 또는 수동
  - 저장: MeetingMinute.ai_summary 필드
- **Worktree**: `worktree/phase-7-advanced`
- **브랜치**: `phase-7-advanced`
- **완료 조건**:
  - 회의록 요약 생성 성공
  - 길이: 100~300자

### [ ] P7-R2-T1: 모바일 푸시 알림 (중요 회의/액션아이템)

- **담당**: devops-specialist + backend-specialist
- **의존**: P5-R1-T1, P6-R1-T1
- **산출물**: 
  - 모듈: `backend/app/services/push_notification.py` (Firebase Cloud Messaging 또는 Slack)
  - 트리거: 회의 30분 전, 액션아이템 기한 24h 전
  - 로직: user 선호도 존중 (opt-in/opt-out)
- **Worktree**: `worktree/phase-7-advanced`
- **브랜치**: `phase-7-advanced`
- **완료 조건**:
  - FCM 또는 Slack 통합 성공
  - 알림 전송 지연 < 10초

### [ ] P7-R2-T2: 개인화된 대시보드 (요약/통계)

- **담당**: frontend-specialist
- **의존**: P6-R3-T1
- **산출물**: 
  - 페이지: `frontend/app/(main)/dashboard/page.tsx`
  - 카드: 주간 KPI 평균, 회의 참석률, 업무 완료도, 근무 시간
  - 그래프: 시계열 차트(Chart.js/D3)
- **Worktree**: `worktree/phase-7-advanced`
- **브랜치**: `phase-7-advanced`
- **완료 조건**:
  - 대시보드 렌더링 < 2초
  - 통계 계산 정확성 테스트

### [ ] P7-R2-T3: 실시간 협업 스트림 (피드)

- **담당**: backend-specialist + frontend-specialist
- **의존**: P5-R3-T1, P6-R1-T2
- **산출물**: 
  - 페이지: `frontend/app/(main)/activity-feed/page.tsx`
  - 항목: "A와 B가 회의 시작", "C가 액션아이템 완료", "D의 KPI 검토됨" 등
  - 실시간: WebSocket으로 새 항목 자동 갱신
- **Worktree**: `worktree/phase-7-advanced`
- **브랜치**: `phase-7-advanced`
- **완료 조건**:
  - 피드 항목 10개 이상 표시
  - 실시간 업데이트 지연 < 1초

### [ ] P7-R3-T1: 감사 로그 (audit_log)

- **담당**: backend-specialist
- **의존**: P6-R3-T2
- **산출물**: 
  - 마이그레이션/모델: `audit_log` (action, actor_user_id, target_entity, target_id, changes(JSONB), timestamp)
  - 서비스: `backend/app/services/audit_service.py` (주요 액션 훅: login, layout_deployed, kpi_adjusted/finalized, objection 처리 등)
- **Worktree**: `worktree/phase-7-advanced`
- **브랜치**: `phase-7-advanced`
- **완료 조건**:
  - 주요 액션 기록 + 변경 전후 diff
  - 보존 기한 5년(D20)

### [ ] P7-R3-T2: 클라이언트 자동 업데이트 채널 (D8)

- **담당**: backend-specialist + 3d-engine-specialist
- **의존**: P1-S1-V
- **산출물**: 
  - API: GET /api/client/version (latest/current/url/required)
  - 배포 채널: 신규 에셋(pak)·클라이언트 빌드 배포 (D8: 에셋은 클라이언트 빌드 동봉, 자동 업데이트 채널로 배포)
  - 클라이언트 GDScript: `godot/scripts/updater.gd` (버전 체크 + 다운로드, 사내 도메인/PKI)
- **Worktree**: `worktree/phase-7-advanced`
- **브랜치**: `phase-7-advanced`
- **완료 조건**:
  - 버전 체크 API 응답 + 강제/선택 업데이트 분기
  - 사내 도메인 배포(사내 PKI TLS, D21), 서명·체크섬 검증

### [ ] P7-R3-T3: ERP 동기화 실패 자동 알림 + 관측 (D18/D21)

- **담당**: backend-specialist
- **의존**: P2-R1-T1, P6-R3-T3c
- **산출물**: 
  - 알림: read 동기화(매시간/00:00 대사) 및 KPI push 실패 시 자동 알림 (관리자 콘솔 + 알림 채널 1개, D18)
  - 관측: Grafana + Prometheus + Loki + Uptime Kuma 대시보드/알림 규칙 (D21)
- **Worktree**: `worktree/phase-7-advanced`
- **브랜치**: `phase-7-advanced`
- **완료 조건**:
  - 동기화/push 실패 주입 시 알림 발송 확인
  - 재시도 큐(APScheduler + DB 영속 큐, D21) 동작 확인

### [ ] P7-R3-T4: 도그푸딩 피드백 수집 체계 (주 1회)

- **담당**: frontend-specialist + backend-specialist
- **의존**: P1-S1-V
- **산출물**: 
  - API: POST /api/feedback (type[bug|feature|general], title, description, screenshot_url, user_context)
  - 페이지: `frontend/app/(main)/feedback/report.tsx`
  - 운영: **주 1회 피드백 수집·리뷰** 루틴 (01-prd 사용성 성공 기준 연동)
- **Worktree**: `worktree/phase-7-advanced`
- **브랜치**: `phase-7-advanced`
- **완료 조건**:
  - 피드백 제출/조회 동작
  - 주간 피드백 리포트 집계

### [ ] P7-R2-V: 고도화 기능 통합 검증

- **담당**: test-specialist
- **의존**: P7-R1-T3, P7-R2-T2, P7-R3-T1, P7-R3-T2, P7-R3-T3, P7-R3-T4
- **수용기준**:
  - 다층 내비게이션: 3층 건물 이동 성공
  - 구역 권한: 제한된 구역 진입 거부 확인
  - AI 회의록 요약: 문장 생성 성공, 가독성 확인
  - 푸시 알림: 회의/액션아이템 알림 수신 확인
  - 대시보드: 통계 표시 및 정확성 검증
  - 피드: 실시간 항목 업데이트 확인
  - 감사 로그·클라이언트 자동 업데이트·ERP 동기화 실패 알림·도그푸딩 피드백 동작 확인

---

## 교차 참조 및 의존성 요약

### 문서 계층 구조
```
01-prd.md
  ├→ 03-erp-integration.md
  ├→ 04-data-model.md
  ├→ 05-office-layout-schema.md
  ├→ 06-screens.md
  └→ 12-tasks.md (본 문서)
```

### 권장 순차 빌드 (1인 개발 현실 기준)

**1인 개발 + AI 협업**: Godot 3D + FastAPI + Next.js 삼중 스택의 동시 개발은 불가능 (13-risks-open-questions.md R7 참조).  
따라서 **Phase는 순차 빌드**를 원칙으로 한다(Phase 병렬화 없음). 각 Phase 내부의 개별 Task는 의존성이 없으면 함께 진행할 수 있으나, Phase 경계는 순차.

| Phase | 예상 기간 | 의존 | 비고 |
|-------|---------|------|------|
| 0 | 4주 | 없음 | API 계약 + 스파이크 S1~S4 (F절) |
| 1 | 12주 | P0 | 골든 샘플 3D (품질 기준) |
| 2 | 7주 | P1 | ERP 동기화 + 좌석/구역 |
| 3 | 6주 | P2 | 2D 편집기 + 데스크톱 draft 모드 |
| 4 | 8주 | P3 | 헤드리스 서버 + 멀티플레이어(WSS) |
| 5 | 8주 | P4 | 회의 + LiveKit + STT 회의록 |
| 6 | 7주 | P5 + ERP dev브랜치 | KPI 산출 + AI 서술 + ERP push |
| 7 | 6주 | P6 | 고도화 (다층, 권한, 감사로그, 자동업데이트) |

**총 예상 기간**: **58주** (시작 2026-07-06 → 완성 2027-08-16, 2027년 하반기) — 10-roadmap.md v2.0과 동일 (13-risks 검증 간트 기준선, 15% 버퍼 포함, D6)

### Phase 간 의존성 (순차 원칙)

- Phase 0 완료 → Phase 1 시작 (계약 + 스파이크 S1~S4 통과 후 3D 품질 기준 확정)
- Phase 1 완료 → Phase 2 시작
- Phase 2 완료 → Phase 3 시작
- Phase 3 완료 → Phase 4 시작 (실시간 서버는 P1, P3 산출물 필요)
- Phase 4 완료 → Phase 5 시작 (회의실 점유 state 필요)
- Phase 5 완료 → Phase 6 시작 (회의록 신호 필요)
- Phase 6 완료 → Phase 7 시작

---

## Open Questions & Assumptions

### Open Questions
- ERP dev 브랜치(`feature/virtual-office-integration`) 착수 타이밍? (git 접근권한 보유로 자체 작업 — Phase 6 착수 시점 확정 필요)
- 모바일 앱: Phase 7 이후인가? (현재 Godot 데스크톱 + Next.js 웹 기준)

> 확정 종결: 실시간 프로토콜=WebSocket(WSS, D1), KPI AI=Claude 기본(D 참조), LiveKit=사내 VM self-host(D21), 회의실 예약=예약+FCFS(D23), 회의 입장=명시적 확인(D24).

### Assumptions
- 단일 회사(company_id=1) 기준이므로 멀티테넌트 로직 미포함.
- Phase별 Worktree는 순차 생성 (Phase 병렬화 없음, R7).
- 모든 Task는 branch-per-phase 정책 (rebase 병합 권장).
- ERP read-only 동기화는 Postgres direct access (API 없음).
- 3D 최고품질 목표 우선, 웹 WASM export 배제.

### Validation Criteria (모든 Phase)
- P0: 모든 계약 & 테스트 케이스 작성 완료
- P1~P7: 각 Phase 마지막 Verification Task 통과

---

## Loop Metadata

### Upstream Documents Referenced
- `01-prd.md`: 사용자 기획 v3.2 (로드맵 7단계, KPI 원칙)
- `03-erp-integration.md`: ERP 연동 계약 (read-only sync, KPI push)
- `04-data-model.md`: 데이터 모델 설계
- `05-office-layout-schema.md`: office_layout 스키마
- `06-screens.md`: 화면 스펙 (참조 예정)
- `08-kpi-logic.md`: KPI 산출 규칙 (신호 정의, 평가 항목, 반감시 원칙)
- `10-roadmap.md`: 총 58주 로드맵(v2.0, 시작 2026-07-06 → 완성 2027-08-16), 순차 빌드 원칙
- `00-decisions.md`: 정본 결정 로그(D1~D25, F절) — 최우선 기준
- `13-risks-open-questions.md`: 1인 개발 리스크(R7: Phase 병렬화 불가)

### Downstream Documents Affected
- API 명세 생성 (각 Phase별 OpenAPI YAML)
- 테스트 계획 (pytest, Godot tests)
- 배포 가이드 (Docker, Godot server setup)
- CI/CD 워크플로우 (.github/workflows)

### Risks
- **R1**: Godot 4 네이티브 멀티플레이어 성능 미검증 (Phase 4 초반 POC 필수)
- **R2**: ERP 연동 JWT 갱신 로직 복잡도 (24h 주기, 만료 전 갱신)
- **R3**: AI KPI 초안 품질 편차 (프롬프트 튜닝 필요)
- **R4**: LiveKit self-host 운영비 & 확장성 (현재 사내용 OK, B2B 시 재검토)

### Success Metrics
- Phase 0 완료: API 계약 100% 정의, 테스트 구조 수립
- Phase 1 완료: 골든 샘플 3D 60 FPS 유지
- Phase 2 완료: ERP 동기화 정확성 99.9%
- Phase 6 완료: EOD KPI push 성공률 100%
- Phase 7 완료: 최종 사내 도그푸딩 만족도 >= 4.5/5

---

**Last Updated**: 2026-07-02 (v2.0 — 00-decisions.md D1~D25/F절 정합)  
**Author**: Documentation Specialist (Claude Code)  
**Status**: Draft → Ready for Phase 0 Kickoff
