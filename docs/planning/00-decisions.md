# 00-decisions.md: 확정 결정 로그 (Single Source of Truth)

**프로젝트**: vituraloffice_new (가상오피스 운영 플랫폼)
**버전**: v1.0
**작성일**: 2026-07-02
**상태**: 확정 (2026-07-02 기획 문서 전면 검토 후 사용자 승인)

> 이 문서는 01~13 모든 기획 문서가 참조하는 **정본(canonical) 결정 모음**이다.
> 다른 문서와 이 문서가 충돌하면 **이 문서가 이긴다**. 결정 변경 시 이 문서를 먼저 수정하고 파급 문서를 갱신한다.

---

## A. 아키텍처 확정 (사용자 승인 4건 포함)

| ID | 결정 | 내용 | 폐기되는 대안 |
|----|------|------|-------------|
| **D1** | 실시간 프로토콜 = **WebSocket(WSS)** | TLS 내장, 재택 근무자 방화벽/VPN 통과 용이. 재접속 시 sequence_num 기반 스냅샷 재수신. OQ4 확정 종결 | ENet(UDP), "ENet TCP"(존재하지 않는 조합) |
| **D2** | 구현 언어 = **GDScript** | 클라이언트·헤드리스 서버 모두 GDScript. 산출물 확장자 `.gd` | C#(.cs) 표기 전부 |
| **D3** | 게임서버 데이터 접근 = **FastAPI 경유 단일화** | 게임서버는 DB(자체/ERP) 직접 접근 금지. presence는 게임서버 메모리 권위 + 1~5초 주기 배치 push(FastAPI) | 100ms 주기 PostgreSQL 직접 쓰기, 게임서버의 ERP 직접 조회 |
| **D4** | 인증 = **FastAPI 발급 자체 JWT** | HS256 + **자체 시크릿(ERP와 미공유)**. 게임서버는 WSS 핸드셰이크에서 JWT 검증만. 평문 email/password를 게임서버로 보내지 않음. 핸드셰이크에 `protocol_version` 협상 포함(미지원 버전 거부 + 업데이트 안내) | 게임서버 직접 로그인, "HS256 + ERP 공개키 검증"(암호학적 불성립), ERP 시크릿 공유 |
| **D5** | 회의록 = **STT 자동 생성 정식 포함** (사용자 확정) | LiveKit Egress(트랙별 오디오) → STT(화자분리) → 회의록 초안 자동 생성 → 참석자/호스트 검토·확정. 수동 입력은 폴백. PRD "누락률 <5%" 기준 유지, 측정 방법 명시(테스트 회의 N회 대비 수동 전사 대조) | 수동 입력 전용 설계 |
| **D6** | 일정 기준선 = **58주** (사용자 확정) | 13-risks 검증 간트를 기준선으로 로드맵 재산정. 시작 2026-07-06, 완성 목표 **2027년 하반기(2027-08 경)**. Phase 5에 STT 파이프라인 포함 재추정. "26주/2026-12-28" 표기 전부 폐기 | 26주 로드맵 |

## B. 3D/에셋/레이아웃 확정

| ID | 결정 | 내용 | 폐기되는 대안 |
|----|------|------|-------------|
| **D7** | 라이팅 = **실시간 직접광 + ReflectionProbe + SSAO** | 라이트맵 베이킹 배제(JSON 동적 씬과 양립 불가). SDFGI는 고사양 PC용 옵션 토글. 기준 사양: **GTX 1650급 60fps / 내장그래픽(Iris Xe급) 30fps** | 라이트맵 베이크 파이프라인, "RTX 4060 최소" 요구 |
| **D8** | 에셋 전달 = **클라이언트 빌드(pak) 동봉** | 에셋 카탈로그는 클라이언트에 포함(임포트 최적화·VRAM 압축·LOD 적용). layout JSON은 `asset_id` 참조만. 신규 에셋 추가 = 클라이언트 자동 업데이트 채널로 배포. 산출물 포맷 `.tscn`(임포트 완료본) | 런타임 glb 다운로드/CDN, Draco·meshopt 압축(Godot 미지원) |
| **D9** | room = **파라메트릭 생성** | 벽 세그먼트 + **door opening(문 개구부) 필드 신설** — 방 콜리전에 출입구 구멍 정의. 프리팹은 가구·소품만 | 회의실 골조 프리팹(고정 크기), 개구부 없는 solid box 콜리전 |
| **D10** | 좌석 배정 = **layout JSON에서 분리** | layout JSON은 공간 구조만(좌석 위치·타입·방향). 좌석↔직원 배정은 DB(`seat.assigned_user_id` 현재값 + `seat_assignment_history` 이력) — 04 정본과 명명 통일(2026-07-02). 배정 변경은 레이아웃 재배포 불필요. seat에 `facing`(도 단위) 필드 추가, seat↔furniture 상호 참조(`furniture_id`) 추가 | 배정 포함 blob 전체 재배포 |
| **D11** (⚠️ **D31이 부분 대체** 2026-07-05) | 웹 3D 미리보기 = **제거** | 편집기는 Konva.js 2D 전용(유지). 정밀 확인은 저장 후 **데스크톱 클라이언트 draft 모드**로 열람(유지). ~~WASM/HTML5 export 미사용~~ → **D31로 폐기: Godot WASM을 웹 대시보드에 임베드 채택** | Godot HTML5 export iframe(→D31로 채택됨), WebSocket 픽셀 스트리밍 |
| **D12** | 레이아웃 검증 = **서버(FastAPI) 단일 정밀 검증** | 공식 JSON Schema 파일 제공. 도달성(A*) 포함 정밀 검증은 서버 1곳. 웹 편집기는 경량 체크(범위/겹침)만. **ERROR는 배포 불가**(`[무시하고 배포]` 버튼 제거), WARNING만 무시 가능 | 웹/서버/Godot 3중 검증 구현 |
| **D25** | 좌표계 = **top_left 단일 고정, 미터 단위** | `coordinate_origin`은 `top_left` 하나만 허용. Godot 매핑: `Vector3(x, floor_height, y)` (+X 동, +Z 남). 회전·facing 단위는 **도(degree), 시계방향, 기준축 +X**. 층별 `floor_height` 오프셋 규칙 명시 | origin 3종 허용, 단위/방향 미정의 |

## C. 데이터/KPI/ERP 확정

| ID | 결정 | 내용 | 폐기되는 대안 |
|----|------|------|-------------|
| **D13** | 프레즌스 상태 = **7종 확정** | `offline / online / working / meeting / focus / away / external`. GPS 기반 `trip_moving`·`trip_arrived`·`returning` **삭제**(데스크톱에 GPS 없음). `external`(외근/출장)은 수동 전환. away 자동 전이 = **5분**(설정 가능 기본값) | 6종/8종/10종 혼재, GPS 자동 상태 전환, 60초 전이 |
| **D14** | KPI 공식 재작성 원칙 (반감시 원칙 정합) | (a) 시간 비례 점수 **제거**(`est_minutes/100` 폐기) → 완료 work_log 건수 + 충실도(goal·result_url·next_action 작성도) 기반. (b) 회의 **참석 기본점·주관자 가점 제거** → 회의록 작성 기여 + 액션아이템 이행률만. (c) 액션아이템 **생성 가점 제거** → 완료·기한준수만. (d) 근태 보정(±5%) **제거** — ERP가 attendance를 별도 반영하므로 이중 반영 금지. (e) **정량 점수는 결정론적 코드로 계산**, AI는 서술(강점/개선/근거)만 생성 | 시간당 1점, 회의당 2점, 생성 +0.5점, AI 정량 산출 |
| **D15** | ERP에는 **관리자 확정 점수(final_score) 전송** | 이의신청 상태머신: 평가 공개 → 이의접수(7일) → 재검토 → 확정 → ERP push. 정정 발생 시 재push(upsert)로 반영. `ai_draft`는 ERP 미전송 | 미조정 원값 전송(이의신청 무의미화), ai_draft 전송 |
| **D16** | kpi_result 스키마 정본 = **04-data-model.md** | metric별 롱포맷. `period` NULL 금지 → `period_type`(daily/quarterly) + `period_key`('2026-07-01'/'2026-Q3') 분리. UNIQUE(user_id, period_type, period_key, metric). 리뷰 필드 인라인: `ai_draft JSONB, admin_adjusted_score, admin_note, admin_user_id, objection_status, final_score, finalized_at`. **kpi_result_review 테이블 폐기**. metric 어휘 사전 단일화(04에 정의, 03·08은 참조). ERP 엔드포인트 정본: **`POST /api/kpi-results`**(단건/배치 동일) | 3문서 3벌 스키마, `/api/kpi/results`, `/api/kpi/ingest`, period NULL |
| **D17** | 배치 스케줄 확정 | daily_reports push = **매일 18:00 KST**(18:00 이후 활동은 익일 귀속, 주말·공휴일 스킵). KPI AI 초안 생성 = **21:00 야간 배치**(검토 대기 상태로 저장). kpi_results ERP push = **관리자 확정 이벤트 + 분기 마감 배치**(D15). 멱등성: metric 단위 upsert + 배치 `run_id` + advisory lock(동시 실행 방지). ERP kpi_results 미준비 시: feature flag OFF → 로컬 적재 → 준비 후 backfill | 18:00 생성↔18:00 검토완료분 push 순환, 월 단위 덮어쓰기 |
| **D18** | ERP 동기화 = **매시간 증분 + 매일 00:00 KST 전체 대사** | 전체 대사에서 하드 삭제 감지 → `is_active=false` **soft-delete**. 미러 FK는 `ON DELETE CASCADE` 제거 → RESTRICT + soft-delete(평가 기록 영구성 보장). 동기화 실패 시 자동 알림(관리자 콘솔 + 알림 채널). 팀 이동 이력: `user_team_history` 신설(분기 중 팀 이동자의 KPI 벤치마크 왜곡 방지) | updated_at 증분만(삭제 미감지), CASCADE 연쇄 삭제 |
| **D19** | 타임존 = **저장 UTC, 표시 KST** | 배치 경계(18:00 등)는 KST로 계산하되 저장은 UTC. 컬럼 주석의 "(KST)" 저장 표기 전부 정정 | KST 저장 혼용 |
| **D23** | 회의실 예약 = **예약 시스템 유지 + 즉석(FCFS) 병행** | A7 "예약 불필요" 가정 폐기, OQ11 확정 종결. 예약 충돌 검증 유지 | FCFS 전용 |
| **D24** | 회의 입장 = **명시적 입장 확인** | 자동 연결 금지(입장 다이얼로그 → 클릭 → LiveKit 토큰 발급). LiveKit 룸 생성은 FastAPI 경유 단일화 | @RoomEnter 자동 접속, 클라이언트/게임서버의 LiveKit 직접 생성 |

## D. 컴플라이언스 확정 (신설)

| ID | 결정 | 내용 |
|----|------|------|
| **D20** | 개인정보·노동 컴플라이언스 원칙 | (a) **근로자 모니터링 고지·동의**: 도입 시 수집 항목·목적·보존기간 서면 고지 및 동의 취득. presence 좌표(x,y)는 KPI 산출에 미사용, 보존 30일 후 삭제. (b) **회의 녹음·STT**: 회의 시작 시 전원 고지 배너 + 참여 의사 확인(거부 시 오디오 미수집). 녹음 원본 보존 90일, 회의록 텍스트는 평가 데이터로 관리. (c) **GPS 수집 기능 삭제**(D13 연동). ERP lat/lng/radius 미러링 금지. (d) **외부 AI(Claude API) 전송**: 실명 → 사번 가명화 후 전송, 처리위탁·국외이전 고지 문서화. (e) **보존 기한**: 평가 데이터(kpi_result·work_log) 5년 보존 후 파기/익명화("영구 보관" 폐기), audit_log 5년. (f) **ERP 미러링 최소수집**: 컬럼 화이트리스트 VIEW 경유(slack_user_id·github_username·jira_email 등 불필요 컬럼 제외) |

## E. 인프라/운영/성능 확정

| ID | 결정 | 내용 | 폐기되는 대안 |
|----|------|------|-------------|
| **D21-r** (2026-07-02 개정) | 인프라 = **온프렘 사내 서버 PC 1대 + Docker Compose(Linux)** | 웹 프론트 포함 전부 서버 PC 1대에 Docker Compose 배포. **VPN 없음 → 인터넷 공개**. 공인 고정 IP + 공인 도메인(추후 구매, 그 전 임시 Caddy 내부 CA) + **Let's Encrypt 자동(Caddy)**. 관측: **Grafana + Prometheus + Loki** + Uptime Kuma + 알림 채널 1개(1인 운영 규모). 배치/큐: **APScheduler + DB 영속 재시도 큐**. 시크릿: .env 파일 권한 제한(600) + 반기 로테이션 정책 문서화. **정본: docs/deployment/onprem-docker.md**. ~~(구버전 D21: 사내 VM 단일화 · 사내 도메인 + 사내 PKI(자체 CA) TLS · 폐기: Let's Encrypt)~~ | 사내 PKI(.internal), Vercel, ELK/Jaeger/온콜 에스컬레이션, Celery+RabbitMQ, 메모리 큐 |
| **D22** | 성능·규모 정본 수치 | 동시접속: **설계 100명 / 도그푸딩 검증 20명**(500명 표기 전부 삭제). 아바타 동기화: E2E(입력→원격 표시) **p95 < 500ms**, 서버 tick 20Hz. 대역폭: 브로드캐스트 팬아웃 O(N²) 명시, 100명 초과 시 AOI 필터링+바이너리 직렬화 도입 검토. 화상 음성 지연 < 200ms(사내망). 클라이언트: 60fps@GTX1650(최소 30fps@내장), 로딩 < 5초. 회의록: 자동 초안 발화자·액션아이템 누락률 < 5%(수동 전사 대조 측정) | 10/100/500 혼재, 측정 방법 없는 수치 |

## F. Phase 0 스파이크 (신설 필수)

| 순번 | 스파이크 | 검증 내용 | 실패 시 폴백 |
|------|---------|----------|-------------|
| S1 | **Godot ↔ LiveKit PoC** (최우선) | GDScript + WebRTC GDExtension으로 LiveKit 룸 접속·오디오/비디오 수신 검증. Rust SDK 래핑 대안 포함 | 회의 화면만 임베디드 브라우저/외부 창 분리 |
| S2 | STT 파이프라인 PoC | LiveKit Egress → STT(화자분리) → 회의록 초안 품질 측정(한국어) | 수동 회의록 + AI 요약으로 격하(PRD 기준 하향 재협의) |
| S3 | 헤드리스 서버 부하 | GDScript 헤드리스 + PhysicsServer3D, 20명 시뮬레이션 CPU/메모리 측정 | tick 하향(10Hz), 물리 간소화 |
| S4 | 동적 씬 라이팅 룩 검증 | D7 조합(실시간광+ReflectionProbe+SSAO)으로 골든 샘플 룩 확인 | SDFGI 옵션 기본화 + 기준 사양 상향 재협의 |

## G. 화면/기능 범위 확정 (2026-07-03 — 3D 메인 오피스 시안 반영)

> 근거: `design/screens/virtual-office-3d-reference.md`(목표 퀄리티 시안) + `loop/scope-decisions-2026-07-03.md`(범위 분석). 원칙: PRD "운영 허브, 기능 과적 지양" + 린 MVP.

| ID | 결정 | 내용 | 폐기/이연되는 대안 |
|----|------|------|-------------------|
| **D26** | 3D 클라 좌측 내비 확정 | MVP 노출 = **Office · Rooms · People · Chat(제한: 회의메모/근접DM) · Settings**. Phase 7 추가 = **Events(전용 화면) · Whiteboard(디지털 협업보드, COULD)**. **Files = 58주 MVP 제외(WON'T)** — 파일은 `work_log.result_url`+웹콘솔로 대체, 완성 후 재검토. 상단바 조직스위처·⌘K 검색·알림 벨 채택 | 8종 내비 전부 MVP 동시 노출, 범용 파일 저장소 MVP |
| **D27** | 회의 입장 UX = **근접 + E키** | D24(명시적 입장) 유지, 트리거 구체화: "Walk up + press **E** → 입장 다이얼로그 → 확인 → LiveKit 토큰(D24)". 클릭 병행 | 자동 접속(D24 위반) |
| **D28** | 인앱 화상 HUD = **플로팅 드래그 패널** | 그리드 비디오 타일 + 컨트롤바(마이크/카메라/화면공유/리액션/손들기/종료). 06 footer 회의 컨트롤을 이 패널로 구체화(Phase 5, E3). 회의록 **작성**은 여전히 웹(D5 경계) | 고정 footer 전용 |
| **D29** | 우측 People 패널 = **상태 섹션 그룹핑** | 필터(all/online/meeting/focus/away)를 섹션 그룹(**In Office / In a Meeting / Online / Away**)으로 표현 + 호스트 왕관 배지 | 단일 목록+필터만 |
| **D30** | 시각 품질 기준(아트 타깃) = **시안 레퍼런스** | `design/screens/virtual-office-3d-reference.md`(실사급 PBR + 다크 글래스모피즘 HUD)를 Phase 1 골든샘플 수용기준으로 고정(D22 60fps와 병행). 웹 콘솔·3D HUD 디자인토큰 공통 | 텍스트 품질기준만 |
| **D31** (2026-07-05 — 사용자 지시로 D11 부분 대체) | 웹 3D = **Godot 엔진 WASM/HTML5 임베드 채택** (Three.js 재구현 아님) | 사용자가 시안 퀄리티의 3D를 **웹 대시보드 중앙에 임베드**하도록 방향 전환. Godot Web export(nothreads, WebGL2/Compatibility)를 `frontend/public/office/`로 산출 → Next.js가 `/office/index.html` iframe으로 임베드. 씬은 **데이터 기반**(`office_layout_loader`가 layout JSON에서 구조·콜리전, `office_visuals`가 CC0 GLB 가구/의자/화분·외곽벽·리셉션·목재마루·HDRI IBL 배치) → 좌석·조직 배치 변경 시 자동 반영. 좌석 편집기 정밀 확인용 데스크톱 draft(D11)는 유지, 웹 임베드는 뷰어·대시보드 용도. 성능: iframe 지연 로드(입장 클릭), 데스크톱 Forward+ > 웹 Compatibility 품질차 수용. **D11의 "WASM/HTML5 export 미사용" 조항만 폐기**, 편집기 Konva 2D 전용(D11)·서버 단일 검증(D12)은 유지 | ~~D11: WASM/HTML5 export 전면 미사용~~, Three.js 웹 재구현, WebSocket 픽셀 스트리밍 |

---

## 문서별 반영 체크리스트

- [x] 01-prd.md — D5(회의록 STT), D6(일정), D22(수치+측정방법), WON'T 표(WASM 유지·미리보기 예외 불필요해짐)
- [x] 02-trd-architecture.md — D1, D3, D4, D7, D13, D17, D21, D22, D24
- [x] 03-erp-integration.md — D15, D16, D17, D18, D19, D20(f)
- [x] 04-data-model.md — D10, D16(정본), D18, D19, D20(e)
- [x] 05-office-layout-schema.md — D9, D10, D12, D25, 샘플 JSON 자체 검증 통과
- [x] 06-screens.md — D11, D12, D5(회의록 화면), 이의신청·로그인·권한·자율좌석 화면 신설
- [x] 07-3d-visual-asset-pipeline.md — D7, D8, D9, 시간 재추정
- [x] 08-kpi-logic.md — D14, D15, D16, D17, D20
- [x] 09-realtime-collaboration.md — D1, D3, D4, D13, D24, D22
- [x] 10-roadmap.md — D6(58주 재산정), D5(STT 태스크), F(스파이크), GDScript
- [x] 11-tech-stack.md — D1, D2, D21, 버전 표기 정정(FastAPI 0.115+, PyJWT 등)
- [x] 12-tasks.md — D6, F(Phase 0 스파이크), GDScript, D22, 누락 태스크(이의신청·분기집계·감사로그·STT)
- [x] 13-risks-open-questions.md — OQ4/OQ11 확정 종결, 신규 리스크(LiveKit 통합·STT·개인정보/노동법), 스테일 OQ 정리
