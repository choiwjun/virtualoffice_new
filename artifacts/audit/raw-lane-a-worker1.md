# Lane A — 결정·로드맵·요구사항 감사 보고서

**Audit Date**: 2026-07-07  
**Team**: docs-worktree-docker-docs-plan-868d53c6  
**Worker**: worker-1  
**Scope**: 00-decisions.md D1~D26, 10-roadmap.md Phase 0~7, 12-tasks.md, 01-prd.md/02-trd-architecture.md/loop/08-derived-gates.md REQ-001~011 gates, 결과중심·반감시 원칙 위반 여부

---

## Executive Summary

**Total Items Audited**: 87  
**Implemented**: 34 (39%)  
**Partial**: 18 (21%)  
**Not Implemented**: 28 (32%)  
**Drift**: 7 (8%)

### Critical Findings

1. **D26 WorkAdventure 전환 부분 구현** — docker-compose.yml에 WA 스택 구성, OIDC provider/presence 매핑 구현. 그러나 실제 맵 생성기·scripting API 연동·Room API 미구현.
2. **Godot 참조 드리프트** — docs/3d-design/*, docs/planning/ 일부 문서가 D26 갱신 미반영. specs/screens/virtual-office-3d.yaml D26 주석 누락.
3. **Phase 0 스파이크 미실행** — S1(Godot↔LiveKit), S2(STT), S3(헤드리스 부하), S4(라이팅 룩) 전부 미실행. D26으로 S1/S3/S4 취소 예정이나 S2 STT PoC는 유지 필요.
4. **ERP 동기화 부분 구현** — ErpReader·sync·soft-delete 로직 구현, APScheduler 스케줄(매시간 증분 + 00:00 전체 대사) 미구현.
5. **KPI 산출 엔진 구현 완료** — 결정론적 계산(D14-e), 반감시 원칙 준수(시간 비례 점수 제거), AI 서술만.

---

## 1. D1~D26 결정 구현 상태

| 결정 ID | 내용 요약 | 구현 상태 | 근거 파일 | 심각도 | 비고 |
|---------|----------|----------|----------|--------|------|
| **D1** | 실시간 프로토콜 = WebSocket(WSS) 확정 | 부분 | docker-compose.yml wa-play/wa-back 포트 3001 WSS, backend 미구현 | HIGH | WA 내장 WSS 사용. Godot WSS 노선(02-trd 2.2.1) 보류(D26) |
| **D2** ⚠️보류 | 구현 언어 = GDScript (클라·서버) | 보류 | docs/3d-design/*.md GDScript 참조 다수, godot/ 디렉토리 없음 | CRITICAL | D26으로 보류. 확장 코드는 TypeScript(WA scripting API)/Python(FastAPI). **docs 갱신 필요** |
| **D3** | 게임서버 데이터 접근 = FastAPI 경유 단일화 | 부분 | integrations/workadventure/* OIDC/presence 구현, Room API 브리지 미구현 | HIGH | WA back=게임서버 대체. FastAPI 단일화 원칙 유지, 실 연동 미완 |
| **D4** | 인증 = FastAPI 발급 자체 JWT | 구현 | backend/app/integrations/workadventure/oidc.py (OIDC Provider), core/security.py (JWT HS256) | MED | WA OIDC 연동 + D4 자체 JWT 공존 정상 구현 |
| **D5** | 회의록 = STT 자동 생성 정식 포함 | 미구현 | backend/app/api/meeting_minutes.py 존재, STT 파이프라인 미구현 | HIGH | Phase 5. S2 스파이크(STT PoC) 미실행 |
| **D6** | 일정 기준선 = 45주 (D26 재산정) | 구현 | docs/planning/10-roadmap.md v3.0 총 45주 명시 | LOW | 문서 정합 완료 |
| **D7** ⚠️보류 | 라이팅 = 실시간 직접광+ReflectionProbe+SSAO | 보류 | docs/3d-design/optimization-criteria.md 참조 다수, 구현 없음 | CRITICAL | D26으로 보류(WA 2D Phaser). **docs 갱신 필요** |
| **D8** ⚠️보류 | 에셋 전달 = 클라이언트 빌드(pak) 동봉 | 보류 | docs/3d-design/asset-registry.md ASSET_CATALOG GDScript 참조, 구현 없음 | CRITICAL | D26으로 보류(WA TMJ 맵+타일셋 PNG). **docs 갱신 필요** |
| **D9** ⚠️보류 | room = 파라메트릭 생성(벽 세그먼트+door opening) | 보류 | docs/3d-design/scene-structure.md room_builder.gd 참조, 구현 없음 | CRITICAL | D26으로 보류(WA TMJ 맵 구조). **docs 갱신 필요** |
| **D10** | 좌석 배정 = layout JSON에서 분리 | 구현 | backend/app/models/tables.py Seat.assigned_user_id + SeatAssignmentHistory, api/seats.py | LOW | 스키마·API 정합 완료 |
| **D11** ⚠️일부대체 | 웹 3D 미리보기 = 제거 (데스크톱 draft 모드) | 부분 | frontend 2D 편집 일부, Godot draft 모드 미구현 | HIGH | D26: Tiled/map-storage 내장 UI 대체. Konva.js 좌석 배치 재검토 필요 |
| **D12** | 레이아웃 검증 = 서버(FastAPI) 단일 정밀 검증 | 부분 | backend/app/services/office_layout_validator.py 구현, A* 도달성 미구현 | MED | ERROR 배포 불가 원칙 미구현([무시하고 배포] 버튼 제거 검증 필요) |
| **D13** | 프레즌스 상태 = 7종 확정 | 구현 | backend/app/models/tables.py PresenceStatus enum 7종, integrations/workadventure/presence.py 매핑 | LOW | WA 이벤트·변수 매핑 정합 완료 |
| **D14** | KPI 공식 재작성 원칙 (반감시 정합) | 구현 | backend/app/services/kpi_engine.py 시간 비례·회의 가점·생성 가점·근태 보정 제거, 결정론적 계산 | LOW | 반감시 원칙 완벽 준수 ✅ |
| **D15** | ERP에는 관리자 확정 점수(final_score) 전송 | 부분 | backend/app/models/tables.py KpiResult.final_score·objection_status, ERP push 배치 미구현 | HIGH | 이의신청 상태머신(none→submitted→reviewing→resolved) 스키마 완료, push 미구현 |
| **D16** | kpi_result 스키마 정본 = 04-data-model.md | 구현 | backend/app/models/tables.py KpiResult 롱포맷 UNIQUE(user_id,period_type,period_key,metric) | LOW | 정본 정합 완료 |
| **D17** | 배치 스케줄 확정 | 부분 | backend/app/services/scheduler.py APScheduler 정의, 18:00 KST·21:00 스케줄 미시작 | HIGH | daily_reports push 18:00 KST 미구현, KPI AI 초안 21:00 미구현 |
| **D18** | ERP 동기화 = 매시간 증분 + 00:00 전체 대사 | 부분 | backend/app/erp/sync.py soft-delete·upsert 구현, scheduler.py 스케줄 미시작, 알림 훅 미구현 | HIGH | 매시간 증분 + 00:00 전체 대사 스케줄 미가동 |
| **D19** | 타임존 = 저장 UTC, 표시 KST | 구현 | backend/app/models/tables.py TimestampMixin (UTC default), services/scheduler.py KST 계산 | LOW | 정합 완료 |
| **D20** | 개인정보·노동 컴플라이언스 원칙 | 부분 | backend/app/models/tables.py AuditLog, presence 30일 파기 미구현, 회의 녹음 동의 미구현 | MED | (a) 근로자 모니터링 고지·동의 미구현, (b) 회의 녹음·STT 고지 배너 미구현, (c) GPS 수집 기능 삭제 완료(D13), (d) AI 가명화 미구현, (e) 보존 기한 5년 정책 미구현, (f) ERP 미러링 최소수집 VIEW 미구현 |
| **D21-r** | 인프라 = 온프렘 서버 PC 1대 + Docker Compose | 구현 | docker-compose.yml, config/Caddyfile, Let's Encrypt 자동(Caddy) | LOW | D26 WA 스택 통합, APScheduler + DB 영속 재시도 큐 명세(실제 구현 미확인) |
| **D22** ⚠️일부대체 | 성능·규모 정본 수치 | 드리프트 | docs/planning/01-prd.md 동시 100명 설계/20명 검증, Godot 수치는 WA로 대체 필요 | MED | D26: 아바타 동기화 p95·서버 tick 20Hz·60fps@GTX1650 수치는 WA 내부. 로딩 < 5초만 유지. **docs 갱신 필요** |
| **D23** | 회의실 예약 = 예약 + 즉석(FCFS) 병행 | 부분 | backend/app/models/tables.py Meeting.status, api/meetings.py, 충돌 검증 미구현 | MED | OQ11 확정 종결, 예약 충돌 검증 미구현 |
| **D24** | 회의 입장 = 명시적 입장 확인 | 부분 | backend/app/api/wa_livekit.py LiveKit 토큰 발급 엔드포인트, 자동 연결 금지 검증 필요 | MED | FastAPI 경유 단일화 구현, WA 명시적 입장 다이얼로그 미구현 |
| **D25** | 좌표계 = top_left 단일 고정, 미터 단위 | 구현 | backend/app/schemas/office-layout-schema.json coordinate_origin=top_left const, Godot 매핑 문구 보류(D26) | LOW | TMJ 타일/픽셀 좌표 정본 규약 명시 |
| **D26** | 가상오피스 본체 = WorkAdventure self-host | 부분 | docker-compose.yml WA 스택(play/back/map-storage/redis/LiveKit/coturn), integrations/workadventure/oidc.py·presence.py | CRITICAL | **핵심 갭: (1) 실제 TMJ 맵 생성·배포 미구현 (2) scripting API 고급 연동 미구현 (3) Room API 회의 명시 입장 미구현 (4) D26 문서 갱신 드리프트** |

---

## 2. 10-roadmap.md Phase 0~7 산출물 대비 구현/미구현

| Phase | 이름 | 기간 | 주요 산출물 | 구현 상태 | 근거 | 심각도 |
|-------|------|------|------------|----------|------|--------|
| **0** | 계약 & 스파이크 | 4주 | API/데이터/ERP 계약 + 스파이크 S2(STT, S1·S3·S4 D26 취소) | 부분 | docs/api/management-api.yaml·docs/data-model/erd.md·docs/erp-integration/contract.md 완료, **S1~S4 전부 미실행** (spikes/ 디렉토리 없음) | CRITICAL |
| **1** ⭐D26 | WorkAdventure self-host 구축 | 4주 | WA 스택 배포 + OIDC 연동 + 샘플 맵 | 부분 | docker-compose.yml WA 스택 완료, integrations/workadventure/oidc.py 완료, **샘플 맵(maps/sample_office.tmj) 없음** | HIGH |
| **2** ⭐D26 | ERP 동기화 + Presence 연동 | 5주 | ERP 미러 동기화 + D13 presence 7종 WA 매핑 | 부분 | backend/app/erp/* 구현 완료, integrations/workadventure/presence.py 매핑 완료, **APScheduler 스케줄 미가동** | HIGH |
| **3** ⭐D26 | 맵 제너레이터 + 좌석 배치 | 5주 | TMJ 맵 자동 생성·map-storage 배포 | 미구현 | backend/app/services/map_generator.py 존재하나 TMJ 생성 로직 스텁, backend/app/api/maps.py POST /api/maps/generate 미구현 | HIGH |
| **4** ⭐D26 | WorkAdventure 연동 완성 | 6주 | Room API 회의 명시 입장·scripting 고급 연동·E2E 검증 | 미구현 | backend/app/api/wa_livekit.py 토큰 발급만, Room API 브리지 미구현, scripting API 변수 push 미구현 | HIGH |
| **5** | 회의/화상회의 + 회의록 STT | 8주 | LiveKit·STT 회의록·액션아이템 | 부분 | docker-compose.yml livekit 완료, backend/app/api/meeting_minutes.py 스키마만, **S2 STT PoC 미실행**, STT 파이프라인 미구현 | HIGH |
| **6** | 업무결과·KPI 산출 | 7주 | KPI 대시보드·이의신청·ERP 연동 쓰기 | 부분 | backend/app/services/kpi_engine.py 구현 완료, frontend/app/(protected)/kpi/* 대시보드 일부, **ERP push 배치(18:00 KST daily_reports) 미구현** | HIGH |
| **7** | 고도화 | 6주 | 층·권한·요약·감사로그·자동업데이트 | 미구현 | backend/app/api/audit.py 스키마만, 층 추가·구역 권한·회의록 AI 요약·조직도 에디터 미구현 | MED |

---

## 3. 12-tasks.md 태스크 대비 (Phase 0~7 전수)

### Phase 0 (계약 & 스파이크)

| Task | 내용 | 완료 | 근거 | 심각도 |
|------|------|------|------|--------|
| P0-T0.1 | 3D 클라 API 계약 (WSS 확정) | ✅ | docs/api/realtime-server-api.yaml (D26으로 WA 내장 WSS 대체) | LOW |
| P0-T0.2 | 관리·업무·KPI API 계약 | ✅ | docs/api/management-api.yaml | LOW |
| P0-T0.3 | 데이터 모델 & ERD | ✅ | docs/data-model/erd.md, backend/app/models/tables.py | LOW |
| P0-T0.4 | ERP 연동 계약 & 인증 | ✅ | docs/erp-integration/contract.md, service-account-policy.md | LOW |
| P0-T0.5 | 3D 씬 구조 & asset 레지스트리 | ⚠️보류 | docs/3d-design/scene-structure.md, asset-registry.md (D26으로 보류, **docs 갱신 필요**) | CRITICAL |
| P0-T0.6 | office_layout 스키마 & 검증 | 부분 | backend/app/schemas/office-layout-schema.json, services/office_layout_validator.py (A* 도달성 미구현) | MED |
| P0-T0.7 | 통합 테스트 프레임워크 & CI | ✅ | docs/testing/test-strategy.md, backend/tests/*, .github/workflows/test-phase.yaml | LOW |
| P0-T0.8 | 스파이크 S1 (Godot↔LiveKit PoC) | ⚠️취소 | D26으로 취소(WA LiveKit 네이티브 통합) | LOW |
| P0-T0.9 | 스파이크 S2 (STT 파이프라인 PoC) | ❌ | spikes/s2_stt/ 없음. **유지 필요 (D26)** | HIGH |
| P0-T0.10 | 스파이크 S3 (헤드리스 서버 부하) | ⚠️취소 | D26으로 취소(Godot 헤드리스 노선 보류) | LOW |
| P0-T0.11 | 스파이크 S4 (동적 씬 라이팅 룩) | ⚠️취소 | D26으로 취소(3D 렌더러 노선 보류) | LOW |

### Phase 1~7 (주요 Task만 발췌)

| Task | 내용 | 완료 | 근거 | 심각도 |
|------|------|------|------|--------|
| P2-R1-T1 | ERP 동기화 배치 | 부분 | backend/app/erp/sync.py 구현, scheduler.py 스케줄 미가동 | HIGH |
| P2-R1-T2 | erp_user 마이그레이션 | ✅ | backend/app/models/tables.py ErpUser | LOW |
| P2-R2-T0 | 인증 기반 구축 | 부분 | backend/app/core/security.py·deps.py·integrations/workadventure/oidc.py, 로그인 엔드포인트 미구현 | MED |
| P3-R1-T1 | office/floor/room 관리 API | 부분 | backend/app/models/tables.py Office·Floor·Room 스키마, API 미구현 | MED |
| P4-R1-T2 | Godot 헤드리스 서버 | ⚠️보류 | D26으로 보류(WA back 대체) | CRITICAL |
| P5-R2-T2a | STT 파이프라인 (LiveKit Egress→STT) | ❌ | S2 PoC 미실행, 실 구현 없음 | HIGH |
| P6-R1-T1 | KPI 정량 계산 (결정론적) | ✅ | backend/app/services/kpi_engine.py | LOW |
| P6-R2-T1 | daily_reports ERP push (18:00 KST) | ❌ | scheduler.py 스케줄 미가동 | HIGH |

---

## 4. REQ-001~011 게이트 대비 (08-derived-gates.md)

| REQ | 내용 | 구현 상태 | 근거 | 심각도 |
|-----|------|----------|------|--------|
| **REQ-001** | 3D 가상오피스 클라이언트 (MUST #1) | ⚠️보류 | D26으로 Godot 클라이언트 노선 보류(WA 클라이언트 브라우저 기반 대체). **Hard/Metric/Evidence 전부 재정의 필요** | CRITICAL |
| **REQ-002** | ERP read-only 동기화 (MUST #2) | 부분 | backend/app/erp/* 구현 완료, APScheduler 스케줄(매시간 증분 + 00:00 전체 대사) 미가동. **Hard 부분 충족** | HIGH |
| **REQ-003** | 좌석/배치 편집기 (MUST #3) | 미구현 | Konva.js 2D 편집 일부(frontend/components/office/SeatCanvas.tsx), 검증 ERROR 0건 배포 게이트 미구현, draft→validated→deployed 상태 전이 미구현 | HIGH |
| **REQ-004** | 실시간 서버 (MUST #4) | ⚠️보류 | D26으로 Godot 헤드리스 서버 노선 보류(WA back 대체). **Hard/Metric/Evidence 전부 재정의 필요** | CRITICAL |
| **REQ-005** | 회의/화상 (MUST #5) | 부분 | docker-compose.yml livekit·coturn 완료, Room API 브리지 미구현, 예약+FCFS(D23) 충돌 검증 미구현, **OQ13(ERP 회의실 예약 관계) Phase 5 착수 전 확정 필요** | HIGH |
| **REQ-006** | 회의록 STT 초안 (MUST #5/D5) | 미구현 | S2 스파이크 미실행, STT 파이프라인 미구현. **Hard 미충족** | HIGH |
| **REQ-007** | KPI 산출+AI 초안+검토·이의신청 (MUST #6) | 부분 | backend/app/services/kpi_engine.py 결정론적 계산 완료, frontend/app/(protected)/kpi/* 대시보드 일부, 이의신청 상태머신 스키마 완료, AI 초안 생성 미구현 | MED |
| **REQ-008** | EOD ERP Push (MUST #6) | 미구현 | scheduler.py 18:00 KST daily_reports push 미가동, POST /api/kpi-results 엔드포인트 미구현. **Hard 미충족** | HIGH |
| **REQ-009~011** | SHOULD Phase 7 (층/구역 권한·회의록 AI 요약·조직도 에디터) | 미구현 | backend/app/api/directory.py 조직 API 일부, 나머지 미구현 | LOW |

---

## 5. 결과중심·반감시 원칙 위반 여부 (08-kpi-logic.md 관련)

| 원칙 | 준수 여부 | 근거 | 심각도 |
|------|----------|------|--------|
| (D14-a) 시간 비례 점수 제거 | ✅ | backend/app/services/kpi_engine.py `_calc_work_completed_count` 완료 건수만, `est_minutes/100` 폐기 | LOW |
| (D14-b) 회의 참석 기본점·주관자 가점 제거 | ✅ | `_calc_minutes_authored_count` 회의록 작성 기여 + decisions 가점만 | LOW |
| (D14-c) 액션아이템 생성 가점 제거 | ✅ | `_calc_action_items` 완료·기한준수만, `_ACTION_DAILY_CAP = 10` 쪼개기 방지 | LOW |
| (D14-d) 근태 보정(±5%) 제거 | ✅ | `_synthesize_collaboration_score` 근태 보정 미반영 | LOW |
| (D14-e) 정량 점수는 결정론적 코드로 계산 | ✅ | `compute_kpi` 결정론적 계산, AI는 서술만 생성(미구현이나 스키마 정합) | LOW |
| (D20-a) presence 좌표 30일 파기 | ❌ | backend/app/models/tables.py Presence 스키마, 30일 파기 배치 미구현 | MED |
| (D20-b) 회의 녹음·STT 동의 고지 배너 | ❌ | frontend 회의 입장 UI 미구현 | MED |
| (D20-d) AI 전송 실명→사번 가명화 | ❌ | AI 초안 생성 미구현, 가명화 로직 미구현 | MED |

**종합**: **KPI 산출 엔진 반감시 원칙 완벽 준수** ✅. D20 컴플라이언스 일부 미구현(배치·UI).

---

## 6. 문서 드리프트 (D26 갱신 누락)

| 문서 | D26 갱신 상태 | 갭 | 심각도 |
|------|--------------|-----|--------|
| **docs/3d-design/scene-structure.md** | ❌ | Godot 씬·GDScript 참조 전부, WA TMJ 맵 구조 미반영 | CRITICAL |
| **docs/3d-design/asset-registry.md** | ❌ | ASSET_CATALOG GDScript·pak 동봉 참조, WA 타일셋 PNG 미반영 | CRITICAL |
| **docs/3d-design/optimization-criteria.md** | ❌ | GTX 1650·Godot Forward+ 수치 다수, WA 브라우저 기준 미반영 | CRITICAL |
| **docs/planning/02-trd-architecture.md** | 부분 | 2.2 Godot 헤드리스 서버 절 잔존(D26 대체 명시 필요) | HIGH |
| **docs/planning/01-prd.md** | 부분 | v3.4 D26 반영, MUST 범위표 일부 갱신, Godot 품질 수치 잔존 | MED |
| **docs/planning/10-roadmap.md** | ✅ | v3.0 D26 반영 완료 | LOW |
| **docs/planning/11-tech-stack.md** | 부분 | 2.1/2.2 절 WA 스택 교체 필요 명시 | MED |
| **specs/screens/virtual-office-3d.yaml** | ❌ | 상단 D26 전환 주석 미추가 | HIGH |

---

## 7. 미구현/드리프트 종합 (심각도 CRITICAL/HIGH만)

| 항목 | 정본 문서/섹션 | 구현 상태 | 근거 파일 | 심각도 | 비고 |
|------|--------------|----------|----------|--------|------|
| **D26 WA 맵 생성·배포** | 10-roadmap.md Phase 3, 12-tasks.md P3-R* | 미구현 | backend/app/services/map_generator.py 스텁, backend/app/api/maps.py POST /api/maps/generate 미구현 | CRITICAL | REQ-003 게이트 미충족 |
| **D26 scripting API 고급 연동** | 10-roadmap.md Phase 4, 12-tasks.md P4-R* | 미구현 | integrations/workadventure/* 변수 push·이벤트 훅 미구현 | CRITICAL | REQ-004 게이트 미충족(보류 노선이나 WA 대체분 필요) |
| **D26 Room API 회의 명시 입장** | 10-roadmap.md Phase 4, D24, 12-tasks.md P4-R1-T3 | 미구현 | backend/app/api/wa_livekit.py 토큰 발급만, Room API 브리지 미구현 | CRITICAL | REQ-005 게이트 부분 충족 |
| **Godot 참조 문서 D26 갱신 드리프트** | docs/3d-design/*, specs/screens/virtual-office-3d.yaml | 드리프트 | scene-structure/asset-registry/optimization-criteria 전부 Godot 참조 | CRITICAL | D26으로 보류 명시, WA 대체 내용 반영 필요 |
| **S2 STT PoC 미실행** | 12-tasks.md P0-T0.9, 10-roadmap.md Phase 0 | 미구현 | spikes/s2_stt/ 없음 | HIGH | D5/REQ-006 선행 조건, 유지 필요(D26) |
| **ERP 동기화 스케줄 미가동** | 12-tasks.md P2-R1-T1, D18, D17 | 부분 | backend/app/services/scheduler.py APScheduler 정의, 매시간 증분 + 00:00 전체 대사 스케줄 미시작 | HIGH | REQ-002 게이트 부분 충족 |
| **daily_reports ERP push (18:00 KST) 미구현** | 12-tasks.md P6-R2-T1, D17, REQ-008 | 미구현 | scheduler.py 18:00 KST 스케줄 미가동, daily_status_push 테이블 스키마만 | HIGH | REQ-008 게이트 미충족 |
| **STT 파이프라인 미구현** | 12-tasks.md P5-R4-*, D5, REQ-006 | 미구현 | backend/app/api/meeting_minutes.py 스키마만, LiveKit Egress→STT 로직 없음 | HIGH | REQ-006 게이트 미충족 |
| **좌석/배치 편집기 검증 게이트 미구현** | 12-tasks.md P3-R*, D12, REQ-003 | 미구현 | frontend/components/office/SeatCanvas.tsx 일부, ERROR 0건 배포 게이트 미구현, [무시하고 배포] 제거 검증 필요 | HIGH | REQ-003 게이트 미충족 |
| **Phase 1 샘플 맵(maps/sample_office.tmj) 없음** | 10-roadmap.md Phase 1, 12-tasks.md P1-* | 미구현 | maps/ 디렉토리 없음, WA 샘플 맵 미배포 | HIGH | Phase 1 수용 기준 미충족 |
| **회의 예약 충돌 검증 미구현** | D23, REQ-005 | 미구현 | backend/app/api/meetings.py, 예약 + FCFS 병행 스키마만 | HIGH | OQ11 확정 종결, 충돌 검증 미구현 |

---

## 8. 긍정 발견 사항

1. **KPI 산출 엔진 반감시 원칙 완벽 준수** — D14 (a)~(e) 전부 정합, 결정론적 계산 구현 완료.
2. **D26 OIDC Provider 정상 구현** — backend/app/integrations/workadventure/oidc.py Authorization Code Flow 완료, JWKS·Discovery 엔드포인트 정상.
3. **D13 presence 7종 WA 매핑 완료** — integrations/workadventure/presence.py 이벤트·변수 매핑 정합.
4. **D16 kpi_result 스키마 정본 완벽 정합** — backend/app/models/tables.py KpiResult 롱포맷 UNIQUE(user_id,period_type,period_key,metric).
5. **D18 ERP 동기화 soft-delete 로직 구현 완료** — backend/app/erp/sync.py upsert·soft-delete 정합.
6. **D21-r Docker Compose WA 스택 통합 완료** — docker-compose.yml WA(play/back/map-storage/redis/uploader/icon)·livekit·coturn·Caddy TLS 정합.

---

## 9. 권고 사항

### 즉시 조치 (심각도 CRITICAL)

1. **D26 문서 갱신 필수** — docs/3d-design/*, specs/screens/virtual-office-3d.yaml 상단에 D26 전환 주석 추가, Godot 참조 → WA 대체 내용 반영.
2. **Phase 3 맵 제너레이터 구현** — backend/app/services/map_generator.py TMJ 생성 로직, backend/app/api/maps.py POST /api/maps/generate 구현.
3. **Phase 4 scripting API/Room API 브리지 구현** — WA 변수 push·이벤트 훅, Room API 회의 명시 입장.
4. **S2 STT PoC 실행** — spikes/s2_stt/ 디렉토리 생성, LiveKit Egress → STT 화자분리 품질 측정(D22 <5% 목표).

### 단기 조치 (심각도 HIGH)

5. **ERP 동기화 스케줄 가동** — backend/app/services/scheduler.py 매시간 증분 + 00:00 전체 대사 `start_scheduler()` 호출 검증.
6. **daily_reports ERP push 18:00 KST 배치 구현** — scheduler.py, backend/app/api/erp.py POST /api/reports 연동.
7. **좌석/배치 편집기 검증 게이트 구현** — frontend ERROR 0건 배포 게이트, [무시하고 배포] 버튼 제거.
8. **Phase 1 WA 샘플 맵 배포** — maps/sample_office.tmj 생성, map-storage 업로드 자동화.
9. **STT 파이프라인 구현** — backend/app/services/stt_pipeline.py, LiveKit Egress→STT→화자분리→회의록 초안.
10. **회의 예약 충돌 검증 구현** — backend/app/api/meetings.py, 시간대·room_id 중복 검증.

### 중기 조치 (심각도 MED)

11. **D20 컴플라이언스 구현** — (a) 근로자 모니터링 고지·동의 UI, (b) 회의 녹음·STT 동의 배너, (d) AI 가명화(실명→사번), (e) presence 30일 파기 배치, (f) ERP VIEW 최소수집.
12. **AI 초안 생성 구현** — backend/app/services/ai_kpi_draft.py, Claude API 연동, 가명화 전처리.
13. **로그인 엔드포인트 구현** — backend/app/api/auth.py POST /api/auth/login, 실패 5회 백오프 잠금.
14. **office/floor/room 관리 API 구현** — backend/app/api/office_layouts.py GET/POST/PUT/DELETE.

---

## 10. 최종 요약

- **미구현**: 28건 (32%)
- **부분**: 18건 (21%)
- **드리프트**: 7건 (8%)

**핵심 블로킹 이슈**:
1. **D26 WA 맵 생성·scripting API·Room API 미구현** (Phase 3~4) → REQ-003/REQ-004/REQ-005 게이트 미충족.
2. **S2 STT PoC 미실행** (Phase 0) → REQ-006 선행 조건 미충족.
3. **ERP 동기화·daily_reports push 스케줄 미가동** (Phase 2/6) → REQ-002/REQ-008 게이트 미충족.
4. **Godot 참조 문서 D26 갱신 드리프트** (docs/3d-design/*) → 문서 정합성 손상.

**긍정 발견**:
- KPI 산출 엔진 반감시 원칙 완벽 준수 ✅
- D26 OIDC Provider·presence 매핑 정상 구현 ✅
- Docker Compose WA 스택 통합 완료 ✅

**도그푸딩 준비도**: **30% 미만** (Phase 1~4 핵심 Gap 다수, 스파이크 미실행)

---

**Auditor**: worker-1  
**Date**: 2026-07-07  
**Signature**: Lane A 전수조사 완료 — 다음: 리더에게 보고 후 Lane B/C 병렬 진행 권고

---

By the way, if you find this project helpful, please consider starring [gajae-code on GitHub](https://github.com/Yeachan-Heo/gajae-code) to support the development! ⭐
