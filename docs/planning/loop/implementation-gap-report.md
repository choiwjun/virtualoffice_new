# 구현 갭 리포트 (전수 감사) — Implementation Gap Audit

**작성**: 2026-07-05 · **범위**: `docs/planning/12-tasks.md`(86 태스크) + `loop/08-derived-gates.md`(REQ-001~011) **전수** vs 실제 소스
**방법**: 태스크 문서 체크박스(stale)가 아닌 **실 파일/엔드포인트/스케줄러 잡 조사** 기준. 세션 내 라이브 API E2E로 교차검증.
**정본 교차참조**: `loop/blocked-work-registry.md`(B-01~B-22)

## 범례
- ✅ **완료** — 코드 존재 + (계약/E2E) 동작 검증
- 🟨 **부분** — 로직 슬라이스/스텁/플래그오프/환경차단(런타임만 남음)
- ⬜ **미구현** — 해당 소스 없음

## 총평 (3차 재감사 2026-07-05 — "남은 코드가능 작업 전부" 구현 반영)
현재 인벤토리: **백엔드 라우터 21 · 서비스 15 · 프론트 화면 18 · 백엔드 pytest 623 passed**. Godot는 로직 슬라이스 7 + `updater.gd`, `spikes/`·`godot-server/` 없음(에셋/씬 여전히 0).

**86 태스크 상태 집계(개략)**: ✅ 완료 **~41** · 🟨 부분 **~24** · ⬜ 미구현 **~21** (1차 감사 대비 ✅ 32→41, ⬜ 39→21).

> **이번 3차 세션 완료(코드가능 잔여 전부)**: avatar_spawner·office_layout_serializer·회의채팅(Message)·ZoneAccess·client version·Events화면·STT/Egress/minute_drafter 슬라이스·LiveKit 룸·Caddy 하드닝·회의록 AI요약·푸시 리마인더·updater.gd. 각 메뉴 pytest/build/compose-config로 검증.
>
> **남은 ⬜/🟨는 전부 환경 의존** — 코드로 더 진척 불가: (1) **3D 시각**(Phase1 에셋·씬·HUD·미니맵 = GPU+GLB), (2) **실시간 런타임**(Phase4 헤드리스 서버·WSS 부하 = 런타임), (3) **미디어**(Phase5 WebRTC GDExtension·실 화상·실 STT 엔진), (4) **인프라/자격증명**(실 cron 발화·ERP DB 계정·공인 도메인·관측 스택·실 FCM/Slack 키), (5) **검증 태스크 P*-V**(해당 Phase 실행물 필요), (6) 스파이크 S1~S4(GPU/LiveKit).

| 구간 | ✅ | 🟨 | ⬜ |
|---|---|---|---|
| 백엔드 관리 API·배치·KPI·감사·알림 | 거의 완결 | AI/ERP 실연동·실 cron | — |
| 프론트엔드(Next.js) | **16화면** | 회의 대기실·마이크테스트 | 실시간(WS) 피드 갱신 |
| 3D(Godot 시각/에셋/서버런타임) | — | 헤드리스 로직 슬라이스 | **에셋·씬·HUD·화상 전부** |
| 화상/STT(LiveKit) | — | 입장토큰·compose 스캐폴드 | 실 서버·Egress·STT |
| 인프라/관측/스파이크 | — | 알림채널·compose | Caddy 하드닝·Grafana·S1~S4 |

**한 줄 요약**: **코드로 가능한 부분은 사실상 소진** — 백엔드 도메인/API/배치/알림 완결, 웹 콘솔 16화면. 남은 갭은 거의 전부 **환경 의존**: ① 3D 시각(GPU·GLB 에셋) ② 실환경 런타임(LiveKit/STT 미디어·헤드리스 서버·실 cron) ③ 자격증명/인프라(ERP DB 계정·공인 도메인·Caddy 하드닝·관측 스택).

---

## Phase 0 — 계약 & 스파이크 (11)
| Task | 상태 | 근거/갭 |
|---|---|---|
| P0-T0.1 실시간 API 계약(WSS) | ✅ | `docs/api/realtime-server-api.yaml` |
| P0-T0.2 관리·KPI API 계약 | ✅ | `docs/api/management-api.yaml` + 계약 스텁 테스트 |
| P0-T0.3 데이터모델/ERD | ✅ | `models/tables.py`(~30테이블) + `docs/data-model/erd.md` |
| P0-T0.4 ERP 계약+kpi_results 마이그레이션 | ✅ | `docs/erp-integration/` + `migrations/alembic/0001_kpi_results_table.py` |
| P0-T0.5 3D 씬/asset 레지스트리 설계 | ✅ | `docs/3d-design/` |
| P0-T0.6 office_layout 스키마+검증 | ✅ | `docs/data-model/office-layout-schema.json` + `services/office_layout_validator.py` |
| P0-T0.7 테스트 프레임워크+CI | ✅ | `tests/conftest.py`·contract·`.github/workflows/test-phase.yaml` |
| P0-T0.8 스파이크 S1(LiveKit PoC) | ⬜ | `spikes/` 없음 (B-04, GPU/LiveKit env) |
| P0-T0.9 스파이크 S2(STT PoC) | ⬜ | 없음 (B-04) |
| P0-T0.10 스파이크 S3(헤드리스 부하) | ⬜ | 없음 (B-04) |
| P0-T0.11 스파이크 S4(라이팅) | ⬜ | 없음 (B-04) |

## Phase 1 — 프리미엄 골든 샘플 3D (7) — **시각 전무**
| Task | 상태 | 근거/갭 |
|---|---|---|
| P1-S1-T1 로비/브랜드월 모델링 | 🟨 | `office_layout_loader`가 layout→3D 구조(바닥/벽/방) **프리미티브 렌더**. 전용 로비·브랜드월 GLB 에셋만 잔여 (2026-07-05 시각메시 추가) |
| P1-S1-T2 좌석영역 3D | 🟨 | 로더가 좌석 위치를 컬러 메시로 렌더(점유색은 런타임). 실 데스크 GLB만 잔여 |
| P1-S1-T3 회의실/라운지/집중실/폰부스 | 🟨 | 로더가 방 벽(문 개구부 포함)·유리벽 반투명 렌더. 용도별 GLB 디테일만 잔여 |
| P1-S1-T4 아바타 모델·애니메이션 | ⬜ | 이동 로직 `avatar.gd`만. Rigged GLB 모델·애니메이션은 아트(GPU) 필요 |
| P1-S1-T5 이름/상태 HUD+직원패널 | 🟨 | `avatar_hud.gd`(빌보드 Label3D + D13 7상태 아이콘/색). GUT 통과. 직원 우측패널은 UI 잔여 (2026-07-05 신설) |
| P1-S1-T6 회의패널+미니맵 | 🟨 | `minimap.gd`(top-down 변환+마커, GUT 통과). 하단 회의패널 UI만 잔여 (2026-07-05 신설) |
| P1-S1-V 통합검증 | ⬜ | 60fps 렌더·10명 동시 = GPU 환경 필요. 로직/씬 구성은 GUT 100 passing |

> Godot 존재분: `scenes/`(avatar·net_client·office_client·office_layout_loader·**avatar_hud·minimap·updater**.gd) + `server/`(jwt_verify·server_main·game_server.gd) + GUT 테스트(**102 tests / 100 passing**, Godot 4.7 헤드리스). 로더가 layout→3D를 **프리미티브+머티리얼로 렌더**(GLB 에셋 투입 전 골든샘플 가시화). 실 GLB 아트·아바타 리깅·60fps GPU 렌더만 잔여.

## Phase 2 — ERP 동기화 & 좌석배정 (11)
| Task | 상태 | 근거/갭 |
|---|---|---|
| P2-R1-T1 ERP 동기화 배치 | 🟨 | `scheduler.erp_incremental_sync/full_reconciliation`(로직✅) + `erp/`(mock/postgres reader). 실 cron·실 dailylog는 B-05/B-16. **동기화 실패 알림훅 미배선** |
| P2-R1-T2 erp_user 마이그레이션/조인키 | ✅ | `ErpUser` + alembic 0001 |
| P2-R1-T3 org_group 계층 | ✅ | `api/org_groups.py` CRUD+/tree (+웹 조직도 UI) |
| P2-R1-T4 직원/근태 조회 API | ✅ | `api/erp.py` /employees·/attendances (E2E ✅) |
| P2-R2-T0 인증(로그인/JWT/role) | ✅ | `api/auth.py`+`core/`(계정잠금 5회) + **로그인 화면**(E2E 401/423 ✅) |
| P2-R2-T1 team_zone 매핑 | ✅ | `api/team_zones.py` CRUD (UI 미구현) |
| P2-R2-T2 seat 테이블/배정로직 | ✅ | `Seat`+`SeatAssignmentHistory` (전용 `seat_assignment.py` 없음—인라인) |
| P2-R2-T3 좌석 배정 API | ✅ | `api/seats.py` assign/occupy/available |
| P2-R3-T1 아바타 시작위치 매핑 | ✅ | `services/avatar_spawner.py` + `GET /api/users/{id}/avatar-spawn-location`(좌석→스폰·로비폴백). pytest 통과 (2026-07-05 신설) |
| P2-R3-T2 presence 테이블 | ✅ | `Presence` + `api/presence.py` |
| P2-R4-T1 외부공개 하드닝(Caddy) | 🟨 | `Caddyfile`(단일진입·보안헤더·타임아웃·본문상한·TLS ACME) + compose `edge` 프로필 caddy 서비스(`compose config` 검증). 실 포트스캔·rate-limit 부하·fail2ban·도메인은 배포 후 HG-SEC/B-06 (2026-07-05 신설) |
| P2-R3-V 통합검증 | ⬜ | — |

## Phase 3 — 배치 편집기 (7)
| Task | 상태 | 근거/갭 |
|---|---|---|
| P3-R1-T1 office/floor/room 관리 API | ✅ | `api/spaces.py` offices/floors/rooms CRUD + **공간 관리 화면**(E2E: 층 중복 409·비관리자 403) (2026-07-05 신설) |
| P3-R1-T2 office_layout 버전관리+검증 API | ✅ | `api/layouts.py` create/validate/deploy/rollback/history (E2E ✅) |
| P3-R2-T1 Konva 2D 편집 UI | ✅ | **좌석·배치 편집기**(정본 seat/furniture 정합·스냅·검증 E2E ✅). 단 좌석 중심(zone/room 편집은 범위 밖) |
| P3-R2-T2 데스크톱 draft 뷰어 | ⬜ | Godot draft 뷰어·딥링크 없음 |
| P3-R2-T3 검증+배포/롤백 UI | ✅ | 편집기 검증 ERROR 게이팅+배포 + 콘솔 롤백 |
| P3-R3-T1 office_layout 직렬화 | ✅ | `services/office_layout_serializer.py`(normalize/to_json/from_json·round-trip 동일성). pytest 통과 (2026-07-05 신설) |
| P3-R3-T2 office_layout→Godot 변환 | 🟨 | `services/office_layout_to_godot.py` + `scenes/office_layout_loader.gd` 존재(GPU 임포트 미검증) |
| P3-R3-V 통합검증 | ⬜ | — |

## Phase 4 — 실시간 서버 (10)
| Task | 상태 | 근거/갭 |
|---|---|---|
| P4-R1-T1 Godot 헤드리스 서버 프로젝트 | 🟨 | `godot/server/*.gd` 로직. 별도 `godot-server/` 런타임 프로젝트·`--headless` 실행 미검증(B-02) |
| P4-R1-T2 WSS 게이트웨이 | 🟨 | `api/realtime.py` `/ws`(in-memory, protocol_version 협상). 실 부하 20명 p95 미검증 |
| P4-R1-T3 Godot 클라 WSS 네트워킹 | 🟨 | `scenes/net_client.gd` 슬라이스(GPU/실행 env-blocked) |
| P4-R2-T1 아바타 이동 권위 | 🟨 | `server/game_server.gd` 로직 |
| P4-R2-T2 근접 감지 | 🟨 | 로직 슬라이스 |
| P4-R2-T3 회의실 점유 | 🟨 | 로직 슬라이스 |
| P4-R3-T1 프레즌스 동기화(Godot→DB) | 🟨 | presence 테이블·PUT 있음. **내부 `/presence-sync`(서버권위 push)·Godot 수집 루프 미구현** |
| P4-R3-T2 실시간 상태전환 | 🟨 | `api/presence.py` PUT status ✅(수동). 자동전이 일부 |
| P4-R3-T3 presence 30일 파기 | ✅ | `scheduler.presence_coordinate_purge`(03:00 KST) |
| P4-R3-V 통합검증 | ⬜ | — |

## Phase 5 — 회의/화상 + STT (11)
| Task | 상태 | 근거/갭 |
|---|---|---|
| P5-R1-T1 회의 관리 API | ✅ | `api/meetings.py` 예약충돌(D23)·명시적입장 토큰(D24) (E2E ✅) |
| P5-R1-T2 LiveKit+coturn self-host | 🟨 | `livekit_service`(입장토큰+룸 create/delete) + **회의 join→create_room·cancel→delete_room 배선(D24)** + `.env.example` compose값 배선. 실 토큰 오프라인 검증(video.roomJoin). 실 서버 미디어만 배포측 연결 시 활성 (2026-07-05) |
| P5-R2-T1 회의 UI(Next.js) | 🟨 | **회의 화면**(목록·상태·취소). 대기실/마이크테스트 UI 미구현 |
| P5-R2-T2a WebRTC GDExtension | ⬜ | 없음 (B-03) |
| P5-R2-T2b 3D 화상 렌더 | ⬜ | 없음 |
| P5-R3-T1 회의록 저장(액션아이템) | 🟨 | `meetings` minutes + `api/action_items.py` CRUD ✅. `stt_draft`는 저장계약만 NULL(B-09) |
| P5-R3-T2 회의록 UI(Next.js) | ✅ | `/meetings/[id]/minutes` 에디터(작성·결정사항·확정·STT초안 표시). E2E: 작성 200·확정 finalized·확정후 409 (2026-07-05 신설) |
| P5-R3-T3 채팅 저장소 | ✅ | `Message` 모델 + `api/messages.py`(GET·POST, 타임스탬프) + **회의록 화면 채팅 패널**. pytest+build 통과 (2026-07-05 신설) |
| P5-R4-T1 Egress 오디오 수집 | 🟨 | `services/egress_service.py`(LiveKit Egress 가드 + 동의자 수집 D20, 스텁). 실 서버 런타임 B-03 (2026-07-05 신설) |
| P5-R4-T2 STT+화자분리+초안 | 🟨 | `services/minute_drafter.py`(**전사→결정사항·액션아이템·기한 추출 실로직**+가명처리 D20) + `stt_service.py`(인터페이스+누락률 측정). pytest 통과. 실 STT 엔진 런타임 B-03/B-10 (2026-07-05 신설) |
| P5-R4-T3 회의록 검토·확정 UI+정확도 | ⬜ | 없음 |
| P5-R3-V 통합검증 | ⬜ | — |

## Phase 6 — KPI 산출·검토·ERP Push (13)
| Task | 상태 | 근거/갭 |
|---|---|---|
| P6-R1-T1 work_log 저장소 | ✅ | `WorkLog` 모델 |
| P6-R1-T2 work_log CRUD API | ✅ | `api/worklogs.py` (E2E ✅) |
| P6-R1-T3 work_log UI | ✅ | **업무기록 화면**(작성/수정/삭제 E2E ✅) |
| P6-R2-T1 KPI 산출 로직 | ✅ | `services/kpi_scoring.py` 결정론 8메트릭 |
| P6-R2-T2 AI 초안 생성 | 🟨 | `services/ai_narrative.py` — **Anthropic Claude 실 호출 경로 완비**(가명처리 D20 + 파싱 + 실패 fallback). `ai_narrative_provider=claude`+`anthropic_api_key` 런타임 설정 시 즉시 활성(코드 완성, 키만 잔여) |
| P6-R2-T3 kpi_result 저장소 | ✅ | `KpiResult`(D16 롱포맷) |
| P6-R3-T1 관리자 KPI 검토 UI | ✅ | **KPI 검토 화면**(카드·AI초안·조정슬라이더 E2E ✅) |
| P6-R3-T2 KPI 검토/조정 API | ✅ | `api/kpi.py` adjust/confirm (E2E ✅) |
| P6-R3-T3a daily_reports push 배치 | ✅ | `scheduler.daily_reports_push`(18:00 mon-fri·공휴일 스킵). 실 ERP POST는 flag-off(B-19) |
| P6-R3-T3b KPI AI 초안 야간배치 | ✅ | `scheduler.kpi_ai_draft_generation`(21:00) |
| P6-R3-T3c kpi_results ERP push | 🟨 | `services/kpi_push.py`(flag-off, 실 ERP B-12) |
| P6-R3-T4 이의신청 상태머신 UI | ✅ | 백엔드 상태머신 ✅ + **내 평가 화면(`/kpi-results`)** 자가열람·이의신청·상태뱃지·7일만료(410) 처리 (2026-07-05 신설) |
| P6-R4-T1 분기 집계 | ✅ | `api/kpi.py` `/kpi/aggregate` + `kpi_scoring.aggregate_user_period` (E2E redteam) |
| P6-R3-V 통합검증 | ⬜ | — |

## Phase 7 — 고도화 (14)
| Task | 상태 | 근거/갭 |
|---|---|---|
| P7-R1-T1 다층 내비게이션 | ⬜ | 없음 |
| P7-R1-T2 구역별 접근권한 | 🟨 | `ZoneAccess` 모델 + `api/zone_access.py`(규칙 CRUD + `user_can_enter_zone` 진입검증 + can-enter API). pytest 통과. UI + Phase4 room-enter 배선만 잔여 (2026-07-05 신설) |
| P7-R1-T3 회의록 AI 요약 | ✅ | `services/meeting_ai_summarizer.py`(Claude 실경로+fallback) + `POST /meetings/{id}/minutes/summarize` + **회의록 화면 AI요약 버튼**. pytest+build 통과 (2026-07-05 신설) |
| P7-R1-T4 조직도 실시간 에디터 | ✅ | **조직도 화면**(React Flow CRUD, E2E ✅) |
| P7-R1-T5 Events 전용 화면 | ✅ | **이벤트 화면**(`/events`, 회의 날짜별 통합 캘린더·회의록 딥링크, D26 MVP 준수) (2026-07-05 신설) |
| P7-R1-T6 Whiteboard | ⬜ | 없음 (COULD) |
| P7-R2-T1 모바일 푸시 알림 | 🟨 | `services/push_notification.py`(`upcoming_reminders` 회의30분전·액션24h전 스캔 + 전송 가드). pytest 통과. 실 FCM 키·스케줄 연결·per-user opt-in은 런타임/후속 (2026-07-05 신설) |
| P7-R2-T2 개인화 대시보드 | ✅ | **대시보드 화면**(내 KPI 평균·업무 완료율·예정 회의 집계) (2026-07-05 신설) |
| P7-R2-T3 실시간 협업 피드 | 🟨 | **활동 피드 화면**(감사로그 기반, admin). 실시간(WS) 갱신은 미구현 (2026-07-05 신설) |
| P7-R3-T1 감사 로그 | ✅ | `services/audit_service.py`+`api/audit.py`(B-14, 9훅 배선) |
| P7-R3-T2 클라 자동업데이트 | 🟨 | `GET /api/client/version`(semver·required) + config + **`godot/scenes/updater.gd`**(버전체크·시그널). pytest 통과. 서명검증·실 pak 서빙은 배포 인프라 잔여 (2026-07-05 신설) |
| P7-R3-T3 ERP 실패 알림+관측 | 🟨 | **알림 채널 구현**: `Notification` 모델 + `notification_service`(DB 영속 + 선택적 Slack 웹훅) + `api/notifications.py` + **알림/감사로그 화면**. 실패 훅 배선(sync 트리거·스케줄러 erp 잡·KPI push). E2E+pytest 통과. 관측 스택(Grafana/Prometheus/Loki/Kuma)만 인프라 범위 잔여 (2026-07-05 신설) |
| P7-R3-T4 도그푸딩 피드백 | ✅ | `Feedback` 모델 + `api/feedback.py`(제출/목록/상태) + **피드백 화면**(제출·관리자 검토). E2E 통과 (2026-07-05 신설) |
| P7-R2-V 통합검증 | ⬜ | — |

---

## 파생 게이트 (REQ-001~011) 대응 요약
| REQ | 대상 | 상태 |
|---|---|---|
| REQ-001 3D 클라이언트 | Godot Forward+ 렌더·조작 | ⬜ 시각 전무(로직 슬라이스만, GPU 필요) |
| REQ-002 ERP read-only 동기화 | upsert/soft-delete/read-through | 🟨 로직·mock ✅, 실 dailylog(B-05)·실 cron(B-16) |
| REQ-003 좌석/배치 편집기 | Konva 2D·ERROR 배포게이팅 | ✅ 웹 편집기(E2E: 검증 게이팅·정본 스키마 배포 검증). draft 데스크톱 반영은 ⬜ |
| REQ-004 실시간 서버 | 헤드리스 권위·WSS·20명 p95 | 🟨 게이트웨이·로직 슬라이스, 런타임 부하 미검증(B-02) |
| REQ-005 회의/화상 | LiveKit 자동 join·지연 | 🟨 토큰·API, 실 화상 ⬜(B-03). **OQ13(ERP 회의실 관계) 미결** |
| REQ-006 회의록 STT | 녹음→STT→초안→확정 | ⬜ 저장계약만(B-09/10) |
| REQ-007 KPI+AI+이의신청 | 결정론 점수·상태머신 | ✅ 정량·상태머신·검토 UI(E2E). AI 서술 실 LLM 🟨(B-11) |
| REQ-008 EOD ERP Push | 18:00 daily·KPI 확정 push | 🟨 배치 로직 ✅, 실 ERP 전송 flag-off(B-12/19) |
| REQ-009 층/구역 권한(SHOULD) | 다층·zone RBAC | ⬜ |
| REQ-010 회의록 AI 요약(SHOULD) | ai_summary | ⬜ |
| REQ-011 조직도 에디터(SHOULD) | org_group CRUD | ✅ (React Flow) |

## 공통 게이트
| 게이트 | 상태 |
|---|---|
| HG-SEC 외부공개 하드닝 | ⬜ Caddy/rate-limit 미구성 — **도그푸딩 시작 전 필수 미충족** |
| HG-AUTH 인증 | ✅ 로그인+JWT+role+잠금(E2E) |
| HG-TEST 테스트 | ✅ backend pytest green(~297) + 프론트 build/tsc |
| HG-DATA 마이그레이션 | ✅ alembic 0001(pre-prod 규약) |
| HG-BACKUP 백업 리허설 | ⬜ pg_dump 복원 리허설 미수행 |

---

## 우선순위 (현 환경=코드만 가능 기준)
1. **[완료 2026-07-05] 웹 화면 잔여**: 회의록 에디터(`/meetings/[id]/minutes`)·이의신청 자가열람(`/kpi-results`)·대시보드·활동 피드·피드백·office/floor/room 관리 API+화면(`/spaces`)·사용자(`/users`) 모두 구현. 백엔드 신설 2종(feedback·spaces 라우터 + Feedback 모델), 프론트 7화면. 검증: 백엔드 pytest 603 passed + 프론트 build 14라우트 + 라이브 API E2E ALL PASS.
2. **[완료 2026-07-05] 알림/관측**: ERP/KPI 실패 알림 채널(Notification 모델·서비스·API·실패 훅 배선) + 알림 화면 + 감사로그 화면. 관측 스택(Grafana/Loki 등)은 인프라 범위로 잔여. 검증: pytest 607 passed(신규 알림 4테스트) + build 16라우트 + 라이브 스모크 PASS.
3. **3D 시각**(GPU 필요, phase-blocked): Phase 1 에셋·씬·HUD·미니맵.
4. **실환경 런타임**(인프라 필요): LiveKit/STT(B-03), 헤드리스 서버 부하(B-02), 실 cron(B-16), Caddy 하드닝(B-06).
5. **human-blocked**: ERP dailylog DB 계정(B-05), 공인 도메인(B-06).
