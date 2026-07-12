# 파생 게이트 (Derived Gates) — 구현 완료 판정 기준

> ⚠️ **실측 재정합 2026-07-11: D27 렌더 게이트(REQ-012/013/014) D28 폐기 반영, 잔여 최대 갭=REQ-004(Colyseus).**

> ✅ **D27 반영(2026-07-09 재파생) — 이 문서는 D27 정본(R3F 웹앱 + 오프라인렌더 깊이합성 + Colyseus 권위 서버) 기준으로 재작성되었다.** D26(WorkAdventure)+Godot 게이트는 폐기·재파생되었으며, 도메인 게이트(KPI·좌석·회의·ERP·개인정보)는 보존한다. 현행 정본 = 00-decisions §H(D27) · 14-virtual-office-spec · 15-realtime-server-spec · 16-render-spike-and-roadmap · 3d-design/{design-style-analysis, photoreal-web-strategy}. 구 Godot/WA/Phaser/OIDC/네이티브빌드 서술은 본 재작성으로 대체됨.

**생성**: 2026-07-02 (planning-loop-supervisor LOOP 9) · **갱신**: 2026-07-09 (D27 재파생) · **소스**: 01-prd MUST 8 + SHOULD 3 (Round 1 수정 반영판) + 00-decisions §H(D27)
**규약**: 다운스트림 빌더/검증자는 이 게이트를 **증거와 함께** 통과하기 전 "구현 완료" 선언 금지.
Hard = 통과/실패 이분법 · Metric = 수치 목표 · Domain = 도메인 원칙 준수 · Evidence = 요구 증거물.

**변경이력**
- 2026-07-09 (D27): REQ-001(구 Godot Forward+ 네이티브 빌드→R3F 웹앱 뷰포트+통합 대시보드 셸 픽셀 재현), REQ-004(구 Godot 헤드리스 권위·GTX1650 60fps→Colyseus 20Hz 권위+이동검증8+p95<500ms), REQ-005/006(구 S1 Godot↔LiveKit 폐기, STT는 외부의존 P6 유지) 재파생. 신규 게이트 REQ-012~015(깊이합성 정확도, 아바타↔배경 조명정합, Blender 파라메트릭 씬 빌더, 단일세션 JWT), REQ-016(공지·KPI 워크플로우 화면) 추가. Phase 정본 = 16 §Part B(P0~P7).
- 2026-07-02: 최초 파생 (LOOP 9, PRD Round 1 반영판).

---

## REQ-001: 3D 가상오피스 클라이언트 — R3F 웹앱 뷰포트 + 통합 대시보드 셸 (MUST #1) 🔄D27
- **추적**: PRD §3 → 06-screens §1 → virtual-office-3d.yaml → 14-virtual-office-spec → 3d-design/design-style-analysis §3
- **Hard**: React Three Fiber(R3F) 웹앱 뷰포트가 오프라인 렌더 배경 + 깊이합성으로 씬을 구성한다(네이티브 빌드 없음, 브라우저 실행). 아바타 이동/좌석 착석/회의실 입장 상호작용 동작. 통합 대시보드 셸(design-style-analysis §3)이 픽셀 단위로 재현된다.
- **Metric**: design-style-analysis §3 셸 골든샘플 대비 픽셀 재현(레이아웃·컬러·타이포 일치). 웹앱 초기 로드·상호작용 프레임 드롭 없음(브라우저 기준).
- **Domain**: 좌석 배정은 layout JSON이 아닌 DB(seat.assigned_user_id) 조회 (D10). 상태 뱃지 D13 7종.
- **Evidence**: 대시보드 셸 픽셀 재현 스크린샷 대조, R3F 뷰포트 렌더 캡처, 조작 데모 영상/GIF, 깊이합성 오클루전 확인(REQ-012 연계).

## REQ-002: ERP read-only 동기화 (MUST #2)
- **추적**: PRD §3 → 03-erp → 백엔드 **[구현됨]**(`erp_sync.py`, pytest) + 12-tasks P1-T4/P1-T6(배선) · P7-T5(실패 알림 훅) → backend/app/erp/
- **Hard**: users/teams/positions 동기화(upsert+soft-delete 멱등) + attendances/leaves read-through. 실 dailylog 연결 시 코드 무변경(ERP_DATABASE_URL만).
- **Metric**: 매시간 증분 + 00:00 전체 대사 스케줄 동작(D18). 동기화 실패 시 알림 훅 발화.
- **Domain**: ERP에 쓰기 0건(read-only), company_id 스코프 전 쿼리 강제, attendance_date 컬럼 사용(updated_at 없음).
- **Evidence**: pytest(현 15종 통과 유지) + 실DB 통합 테스트 1종 + 스케줄 실행 로그. ✅ 부분 선행 구현됨(수동 트리거까지).

## REQ-003: 좌석/배치 편집기 (MUST #3)
- **추적**: PRD §3 → 05-layout → seat-layout-editor.yaml → 12-tasks P7-T3(배치 편집기→재렌더 루프)
- **Hard**: Konva.js 2D 편집(웹 3D 미리보기 없음 — D11). 검증 ERROR 0건일 때만 배포 버튼 활성([무시하고 배포] 없음 — D12). draft→validated→deployed→archived 상태 전이.
- **Metric**: office_layout.schema.json 공식 스키마 검증 통과. 배포 후 웹 뷰포트 draft 프리뷰 반영(06 §3.3.2).
- **Domain**: 좌표 2D top_left 미터(D25), 배정 데이터 layout JSON 비포함(D10).
- **Evidence**: 검증 실패→수정→배포 E2E 시나리오 테스트, WARNING-only 배포 케이스 테스트.

## REQ-004: 실시간 서버 — Colyseus 20Hz 권위 (MUST #4) 🔄D27
- **추적**: PRD §3 → 09-realtime → 15-realtime-server-spec(정본) → 12-tasks P3-T1~T3(Colyseus onAuth·이동검증8·근접검증8) + P3-T5(presence 배치)
- **Hard**: Colyseus 권위 서버(이동 검증·충돌 차단(OQ12 확정)·근접·회의실 점유), 클라이언트 WSS 접속+hello/resume 핸드셰이크(D4), 재접속 5초 내 스냅샷 복원. 이동검증 8종(15-realtime-server-spec 정본) 적용.
- **Metric**: 검증 20명 동시(설계 100명, D22), tick **20Hz 유지**, 아바타 동기화 E2E **p95 < 500ms**(15/09 정본).
- **Domain**: presence는 Colyseus 서버 메모리 권위 + FastAPI 배치 push(D3). presence 좌표 30일 파기(D20-a).
- **Evidence**: 20명 시뮬레이션 부하 리포트, 이동검증 8종 통과 로그, p95 측정 로그, 재접속 테스트.
- **🔴 미구현 — 이동서버 스택 부재(최대 잔여 갭).**

## REQ-005: 회의/화상 (MUST #5) 🔄D27
- **추적**: PRD §3 → 09 §LiveKit → meetings.yaml → 12-tasks P5-T1~T3(명시입장·LiveKit 통합·화상 타일)
- **Hard**: LiveKit self-host(Docker) 화상 연결 — 명시입장(D24): 근접 프롬프트→사용자 확인→join(자동 연결 금지). 예약+FCFS(D23). 외부 접속은 공개 엔드포인트 UDP 직결+TURN-TLS 443 폴백(VPN 없음).
- **Metric**: 사내 LAN 음성 지연 < 200ms / 외부 < 300ms 목표. 동시 2~3방.
- **Domain**: 녹음·STT 동의 배너 필수(D20-b). **선행 결정: OQ13(ERP 회의실 예약 관계) Phase 5 착수 전 확정.**
- **Evidence**: ~~S1 스파이크(Godot↔LiveKit PoC) — D27로 폐기~~. LiveKit↔R3F 웹클라이언트 연결 데모, 지연 측정, 동의 플로우 캡처.

## REQ-006: 회의록 STT 초안 (MUST #5/D5) 🔄D27
- **추적**: PRD §3 → 08/09 → meetings.yaml(stt-draft-review) → 12-tasks P6-T1(Egress+STT+화자분리)·P6-T2(검토·확정 UI)
- **Hard**: 녹음→STT→화자분리→초안이 meeting_minute.stt_draft에 저장, 검토·수정→finalized 흐름. 실패 시 수동 폴백. **STT는 외부 의존(P6) — 외부 STT 서비스/모델 연동.**
- **Metric**: 한국어 발화자·액션아이템 누락률 < 5%(D22, 수동 전사 10회 대조).
- **Domain**: 녹음 파일 90일 보존 후 파기.
- **Evidence**: ~~S2 스파이크 — D27로 폐기(외부의존 전환)~~. 외부 STT 연동 결과, 누락률 측정표, E2E(회의→초안→확정) 테스트.
- **🔴 501 스텁, 외부의존(P6).**

## REQ-007: KPI 산출+AI 초안+검토·이의신청 (MUST #6)
- **추적**: PRD §3 → 08-kpi → kpi-dashboard/kpi-objection.yaml → 12-tasks P6-T4(KPI 워크플로우 화면 — 엔진·AI초안·EOD는 [구현됨] 재사용)
- **Hard**: 결정론적 코드가 정량 계산(같은 입력=같은 점수), AI는 서술 초안만(D14-e). 이의신청 none→submitted→reviewing→resolved(D15) 상태머신 동작. D16 스키마(period_type/period_key/final_score).
- **Metric**: 분기 100명 배치 완료. 이의신청 7일 창 강제.
- **Domain**: 접속시간·채팅수 지표 사용 금지(결과물 중심). work_completed_count=완료 전건(D14-a).
- **Evidence**: 동일 입력 반복 계산 재현성 테스트, 상태머신 전이 테스트, AI 초안이 점수를 변경하지 않음 증명.

## REQ-008: EOD ERP Push (MUST #6)
- **추적**: PRD §3 → 03-erp §5 → 백엔드 **[구현됨]**(`eod_push.py`·`scheduler.py`, 12-tasks P6-T4 재사용분 — ERP 실수신 폐쇄루프 검증은 P6)
- **Hard**: 18:00 KST daily_status push(D17, run_id 멱등) + KPI 확정분 POST /api/kpi-results(ERP dev 브랜치 신설분). 실패 재시도+알림 훅.
- **Metric**: push 성공률 추적, 실패 시 익일 보정.
- **Domain**: ERP 쓰기는 이 두 경로만. daily_status_push.status 추적 테이블 기록.
- **Evidence**: 멱등성 테스트(중복 run_id), ERP 수신 확인 로그.

## REQ-009~011 (SHOULD, Phase 7): 층/구역 권한 · 회의록 AI 요약 · 조직도 에디터
- **Hard**: 각 기능 동작(다층 내비게이션 3층, 구역 role 제한, ai_summary 생성, org_group CRUD — ERP 팀=리프 불변).
- **Evidence**: Phase 7 검증 리포트(docs/verification/phase-7-report.md).

---

## D27 신규 게이트 (렌더 파이프라인·실시간 셸) 🆕D27

## REQ-012: 깊이합성 정확도 (신규, Phase 0 스파이크 승계)
- **추적**: 16-render-spike-and-roadmap §A.3 → 3d-design/photoreal-web-strategy → spikes/depth-composite
- **Hard**: 오프라인 렌더 배경 depth PNG + R3F 아바타 실시간 렌더의 깊이합성 오클루전이 정확히 동작(아바타가 책상/기둥 뒤로 올바르게 가려짐).
- **Metric**: **경계 오차 ≤ 2px**. 스파이크 PASS(2026-07-08, 커밋 b4736b1).
- **Domain**: 배경/깊이/camera.json은 layout에서 파생(REQ-014 연계), 클라이언트는 배경을 렌더하지 않고 합성만 수행.
- **Evidence**: 깊이합성 스파이크 리포트(경계 오차 측정), 오클루전 골든샘플 대조 스크린샷.
- **⛔ D28 폐기(2026-07-11 재정합) — 오프라인렌더+깊이합성 노선 폐기, 실시간 단일 R3F 렌더가 오클루전·조명정합을 자동 충족. 이 게이트는 비활성.**

## REQ-013: 아바타↔배경 조명 정합 (IBL) (신규)
- **추적**: 3d-design/{design-style-analysis, optimization-criteria} → 14-virtual-office-spec
- **Hard**: R3F 아바타가 오프라인 렌더 배경과 동일한 IBL(Image-Based Lighting) 환경으로 조명되어, 실시간 아바타와 배경의 광원·톤이 정합한다(붕 뜬 느낌 없음).
- **Metric**: 배경 렌더 환경맵과 아바타 IBL 소스 동일. 조명 방향/색온도 일치 육안 검증 PASS.
- **Domain**: 환경맵/조명 파라미터는 Blender 씬 빌더 산출물(REQ-014)과 동일 소스에서 도출.
- **Evidence**: 아바타+배경 합성 골든샘플 대조, IBL 환경맵 산출 로그.
- **⛔ D28 폐기(2026-07-11 재정합) — 오프라인렌더+깊이합성 노선 폐기, 실시간 단일 R3F 렌더가 오클루전·조명정합을 자동 충족. 이 게이트는 비활성.**

## REQ-014: Blender 파라메트릭 씬 빌더 (신규)
- **추적**: photoreal-web-strategy → 16-render-spike-and-roadmap(render-pipeline) → spikes/depth-composite/public/{office_bg.png, office_depth.png, camera.json}
- **Hard**: office_layout JSON을 입력받아 Blender가 배경 이미지 + depth PNG + camera.json을 결정론적으로 산출한다(layout→배경/깊이/camera). Blender 5.1 API 대응(2차 렌더 방식, 커밋 d5ccaf0).
- **Metric**: 동일 layout 입력 = 동일 산출물(재현성). depth PNG가 REQ-012 오클루전 기준 충족.
- **Domain**: 좌석 배정 데이터는 산출물에 비포함(D10) — 씬 지오메트리만. 좌표 2D top_left 미터(D25).
- **Evidence**: layout→산출물 파이프라인 실행 로그, 재현성 테스트(동일 입력 반복), camera.json 스키마 검증.
- **⛔ D28 폐기(2026-07-11 재정합) — 오프라인렌더+깊이합성 노선 폐기, 실시간 단일 R3F 렌더가 오클루전·조명정합을 자동 충족. 이 게이트는 비활성.**

## REQ-015: 단일 세션 JWT (Colyseus onAuth) (신규)
- **추적**: 15-realtime-server-spec → 00-decisions §H(D27) → HG-AUTH 연계
- **Hard**: Colyseus **onAuth**가 JWT를 검증하여 인증된 접속만 룸 입장 허용. 단일 세션 강제(동일 사용자 신규 접속 시 기존 세션 해제).
- **Metric**: 무효/만료 JWT 접속 거부 100%. 중복 로그인 시 기존 세션 축출 동작.
- **Domain**: JWT 24h + role 가드(HG-AUTH 정합). presence 좌표 30일 파기(D20-a).
- **Evidence**: onAuth 거부/승인 테스트, 단일 세션 축출 E2E 테스트.
- **🟡 JWT 로그인 ✅ / Colyseus onAuth·단일세션 eviction 미구현.**

## REQ-016: 공지·KPI 워크플로우 화면 (신규)
- **추적**: 06-screens → design-style-analysis §3(통합 대시보드 셸) → 08-kpi/09-realtime
- **Hard**: 통합 대시보드 셸 내 공지(announcement) 워크플로우 화면 + KPI 워크플로우 화면(산출→검토→이의신청) 동작. REQ-007 KPI 상태머신과 연동.
- **Metric**: 공지 CRUD+게시 동작, KPI 워크플로우 화면이 REQ-007 상태(none→submitted→reviewing→resolved) 반영.
- **Domain**: KPI 화면은 결정론적 계산 결과만 표시, AI 초안은 서술만(D14-e). 접속시간·채팅수 지표 표시 금지(D14-a).
- **Evidence**: 공지 워크플로우 E2E, KPI 워크플로우 화면 상태 반영 캡처.

---

## 공통 게이트 (전 Phase)

| 게이트 | 기준 | 증거 |
|---|---|---|
| **HG-SEC 외부 공개 하드닝** | onprem-docker §3.3 체크리스트 전항목 — **도그푸딩 시작 전 완료 필수** (12-tasks P7-T5) | 포트 스캔 결과, rate-limit 동작 테스트 |
| HG-AUTH 인증 | 로그인+JWT 24h+role 가드, 실패 5회 백오프 잠금 | 401/403/잠금 테스트 |
| HG-TEST 테스트 | 각 Phase pytest green + 계약 스텁 해제분 통과 | pytest 출력 |
| HG-DATA 마이그레이션 | pre-prod 0001 규약 / 운영 후 autogenerate 리비전 | alembic 이력 |
| HG-BACKUP | pg_dump 일일 백업 + 복원 리허설 1회 (도그푸딩 전) | 복원 성공 로그 |

## 게이트 자가검증
- [x] 모든 MUST REQ에 Hard+Evidence 존재
- [x] 각 게이트 문서 추적 링크 보유 (D27 정본 기준 — 14/15/16, design-style-analysis, photoreal-web-strategy)
- [x] 이분법 판정 가능 (모호 표현 없음 — 측정치/파일경로/테스트 명시)
- [x] 선행 결정 의존 명시 (OQ13→REQ-005, D27 깊이합성 스파이크 PASS(2026-07-08)→REQ-012)
- [x] D27 재파생 완료 (REQ-001/004/005/006 Godot 게이트 제거, 신규 REQ-012~016 추가, 도메인 게이트 보존)
