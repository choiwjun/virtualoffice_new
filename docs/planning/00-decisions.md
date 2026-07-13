# 00-decisions.md: 확정 결정 로그 (Single Source of Truth)

**프로젝트**: vituraloffice_new (가상오피스 운영 플랫폼)
**버전**: v1.2
**작성일**: 2026-07-02
**최종 갱신**: 2026-07-09 (D27 문서 전면 재정합 완료 + D6 주단위 미확정 갱신 + §H S2 스파이크 P6 이관)
**상태**: 확정 (2026-07-02 사용자 승인 / 2026-07-06 D26 / 2026-07-08 **D27 D26 대체, 사용자 승인**)

> 이 문서는 01~13 모든 기획 문서가 참조하는 **정본(canonical) 결정 모음**이다.
> 다른 문서와 이 문서가 충돌하면 **이 문서가 이긴다**. 결정 변경 시 이 문서를 먼저 수정하고 파급 문서를 갱신한다.

---

## A. 아키텍처 확정 (사용자 승인 4건 포함)

| ID | 결정 | 내용 | 폐기되는 대안 |
|----|------|------|-------------|
| **D1** | 실시간 프로토콜 = **WebSocket(WSS)** | TLS 내장, 재택 근무자 방화벽/VPN 통과 용이. 재접속 시 sequence_num 기반 스냅샷 재수신. OQ4 확정 종결 — **D26: WorkAdventure 내장 WSS 프로토콜로 충족(자체 동기화 프로토콜 구현 없음)** | ENet(UDP), "ENet TCP"(존재하지 않는 조합) |
| **D2** ⚠️보류(D26) | 구현 언어 = **GDScript** | 클라이언트·헤드리스 서버 모두 GDScript. 산출물 확장자 `.gd` — **D26으로 보류: WorkAdventure 전환으로 Godot 클라이언트·헤드리스 서버 노선 중단. 확장 코드는 TypeScript(scripting API)/Python(FastAPI)** | C#(.cs) 표기 전부 |
| **D3** | 게임서버 데이터 접근 = **FastAPI 경유 단일화** | 게임서버는 DB(자체/ERP) 직접 접근 금지. presence는 게임서버 메모리 권위 + 1~5초 주기 배치 push(FastAPI) — **D26: "게임서버"=WA back으로 대체. 원칙 유지 — WA는 자체 상태만 소유, ERP·업무 DB 접근은 FastAPI 단일화. presence는 WA 이벤트(scripting API)→FastAPI 수집으로 계승** | 100ms 주기 PostgreSQL 직접 쓰기, 게임서버의 ERP 직접 조회 |
| **D4** | 인증 = **FastAPI 발급 자체 JWT** | HS256 + **자체 시크릿(ERP와 미공유)**. 게임서버는 WSS 핸드셰이크에서 JWT 검증만. 평문 email/password를 게임서버로 보내지 않음. 핸드셰이크에 `protocol_version` 협상 포함(미지원 버전 거부 + 업데이트 안내) — **D26: WorkAdventure는 OIDC로 연동(oidc.py 브리지). D4 자체 JWT와 공존** | 게임서버 직접 로그인, "HS256 + ERP 공개키 검증"(암호학적 불성립), ERP 시크릿 공유 |
| **D5** | 회의록 = **STT 자동 생성 정식 포함** (사용자 확정) | LiveKit Egress(트랙별 오디오) → STT(화자분리) → 회의록 초안 자동 생성 → 참석자/호스트 검토·확정. 수동 입력은 폴백. PRD "누락률 <5%" 기준 유지, 측정 방법 명시(테스트 회의 N회 대비 수동 전사 대조) | 수동 입력 전용 설계 |
| **D6** ⚠️재산정(D27) | 일정 기준선 = **주 단위 미확정** (D27 Phase 편성 P0~P7, 정본 = 16 §Part B) | **D27(2026-07-09): 45주/2027-05-17 기준선 폐기 — 주 단위는 P0 스파이크(PASS) 이후 P1~P7 실측으로 확정하며 억지 숫자를 기재하지 않는다(10-roadmap v3.1 원칙).** 이력: 원 58주(사용자 확정) → D26 45주(WA 재편) → D27 미확정 재산정. 시작 2026-07-06 유지 | 26주/45주/58주 확정 표기 전부 |

## B. 3D/에셋/레이아웃 확정

| ID | 결정 | 내용 | 폐기되는 대안 |
|----|------|------|-------------|
| **D7** ⚠️보류(D26) | 라이팅 = **실시간 직접광 + ReflectionProbe + SSAO** | 라이트맵 베이킹 배제(JSON 동적 씬과 양립 불가). SDFGI는 고사양 PC용 옵션 토글. 기준 사양: **GTX 1650급 60fps / 내장그래픽(Iris Xe급) 30fps** — **D26으로 보류: WorkAdventure 2D(Phaser) 기반. 3D 렌더러 불필요** | 라이트맵 베이크 파이프라인, "RTX 4060 최소" 요구 |
| **D8** ⚠️보류(D26) | 에셋 전달 = **클라이언트 빌드(pak) 동봉** | 에셋 카탈로그는 클라이언트에 포함(임포트 최적화·VRAM 압축·LOD 적용). layout JSON은 `asset_id` 참조만. 신규 에셋 추가 = 클라이언트 자동 업데이트 채널로 배포. 산출물 포맷 `.tscn`(임포트 완료본) — **D26으로 보류: WorkAdventure는 TMJ 맵+타일셋 PNG 에셋 구조** | 런타임 glb 다운로드/CDN, Draco·meshopt 압축(Godot 미지원) |
| **D9** ⚠️보류(D26) | room = **파라메트릭 생성** | 벽 세그먼트 + **door opening(문 개구부) 필드 신설** — 방 콜리전에 출입구 구멍 정의. 프리팹은 가구·소품만 — **D26으로 보류: WorkAdventure는 Tiled JSON(TMJ) 맵 구조로 대체** | 회의실 골조 프리팹(고정 크기), 개구부 없는 solid box 콜리전 |
| **D10** | 좌석 배정 = **layout JSON에서 분리** | layout JSON은 공간 구조만(좌석 위치·타입·방향). 좌석↔직원 배정은 DB(`seat.assigned_user_id` 현재값 + `seat_assignment_history` 이력) — 04 정본과 명명 통일(2026-07-02). 배정 변경은 레이아웃 재배포 불필요. seat에 `facing`(도 단위) 필드 추가, seat↔furniture 상호 참조(`furniture_id`) 추가 | 배정 포함 blob 전체 재배포 |
| **D11** ⚠️일부대체(D26) | 웹 3D 미리보기 = **제거** | 편집기는 Konva.js 2D 전용. 정밀 확인은 저장 후 **데스크톱 클라이언트 draft 모드**로 열람. WASM/HTML5 export 미사용(PRD WON'T 준수) — **D26으로 일부 대체: 맵 편집기는 Tiled 또는 map-storage 내장 UI로 대체. Konva.js 좌석 배치 파트 재검토** | Godot HTML5 export iframe, WebSocket 픽셀 스트리밍 |
| **D12** | 레이아웃 검증 = **서버(FastAPI) 단일 정밀 검증** | 공식 JSON Schema 파일 제공. 도달성(A*) 포함 정밀 검증은 서버 1곳. 웹 편집기는 경량 체크(범위/겹침)만. **ERROR는 배포 불가**(`[무시하고 배포]` 버튼 제거), WARNING만 무시 가능 | 웹/서버/Godot 3중 검증 구현 |
| **D25** ⚠️일부보류(D26) | 좌표계 = **top_left 단일 고정, 미터 단위** | `coordinate_origin`은 `top_left` 하나만 허용. ~~Godot 매핑: `Vector3(x, floor_height, y)`~~ — **D26으로 Godot 매핑 문구 보류. TMJ 타일/픽셀 좌표(orthogonal, right-down)가 맵 제너레이터 정본 규약**. 회전·facing 단위는 **도(degree), 시계방향, 기준축 +X** 유지 | origin 3종 허용, 단위/방향 미정의 |

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
| **D22** ⚠️일부대체(D26) | 성능·규모 정본 수치 | 동시접속: **설계 100명 / 도그푸딩 검증 20명** 유지. 화상 음성 지연 < 200ms(사내망), 회의록 누락률 < 5%(수동 전사 대조) 유지 — **D26: 아바타 동기화 p95·서버 tick 20Hz·60fps@GTX1650 등 Godot 클라이언트/서버 수치는 WA 내부 구현으로 대체(브라우저 기준 로딩 < 5초만 유지). WA 20명 동시접속 부하는 도그푸딩에서 실측** | 10/100/500 혼재, 측정 방법 없는 수치 |

## F. Phase 0 스파이크 (신설 필수)

> ⚠️ **D26 갱신**: S1·S3·S4는 D26(WorkAdventure 전환)으로 취소. S2(STT 파이프라인)는 유지.

| 순번 | 스파이크 | 검증 내용 | 실패 시 폴백 | D26 상태 |
|------|---------|----------|-------------|---------|
| S1 | **Godot ↔ LiveKit PoC** | GDScript + WebRTC GDExtension으로 LiveKit 룸 접속·오디오/비디오 수신 검증. Rust SDK 래핑 대안 포함 | 회의 화면만 임베디드 브라우저/외부 창 분리 | **취소** (WorkAdventure LiveKit 네이티브 통합) |
| S2 | STT 파이프라인 PoC | LiveKit Egress → STT(화자분리) → 회의록 초안 품질 측정(한국어) | 수동 회의록 + AI 요약으로 격하(PRD 기준 하향 재협의) | **유지** |
| S3 | 헤드리스 서버 부하 | GDScript 헤드리스 + PhysicsServer3D, 20명 시뮬레이션 CPU/메모리 측정 | tick 하향(10Hz), 물리 간소화 | **취소** (Godot 헤드리스 노선 보류) |
| S4 | 동적 씬 라이팅 룩 검증 | D7 조합(실시간광+ReflectionProbe+SSAO)으로 골든 샘플 룩 확인 | SDFGI 옵션 기본화 + 기준 사양 상향 재협의 | **취소** (3D 렌더러 노선 보류) |

---

## G. WorkAdventure 전환 (D26, 2026-07-06)

| ID | 결정 | 내용 | 폐기되는 대안 |
|----|------|------|-------------|
| **D26** | 가상오피스 본체 = **WorkAdventure self-host** | AGPL-3.0+Commons Clause. 사내 도그푸딩 한정 적법, B2B 판매 시 Enterprise 라이선스 또는 재구현 필요. Godot 네이티브 클라이언트·헤드리스 서버(D2/D7/D8/D9/D11 일부) 노선 **보류**. 확장은 scripting API/iframe/OIDC/Room API만 사용, WorkAdventure 소스 직접 수정 금지. | Godot 4 네이티브 3D 클라이언트, Godot 헤드리스 서버 |

### D26 연동 보류/폐기 결정 목록

| 결정 ID | 원 내용 요약 | 상태 | 사유 |
|---------|------------|------|------|
| **D2** | 구현 언어 = GDScript (클라이언트·헤드리스 서버) | **보류** | WorkAdventure 전환. 확장 코드는 TypeScript(scripting API)/Python(FastAPI 연동) |
| **D7** | 라이팅 = 실시간 직접광+ReflectionProbe+SSAO | **보류** | WorkAdventure 2D(Phaser) 기반. 3D 렌더러 불필요 |
| **D8** | 에셋 전달 = 클라이언트 빌드(pak) 동봉 | **보류** | WorkAdventure는 TMJ 맵+타일셋 PNG 에셋 구조 |
| **D9** | room = 파라메트릭 생성(벽 세그먼트+door opening) | **보류** | WorkAdventure는 Tiled JSON(TMJ) 맵 구조로 대체 |
| **D11(일부)** | 편집기 = Konva.js 2D 전용, 데스크톱 draft 모드 | **대체** | 맵 편집기는 Tiled 또는 map-storage 내장 UI. Konva.js 좌석 배치 파트 재검토 |
| **F-S1** | Godot ↔ LiveKit PoC | **취소** | WorkAdventure가 LiveKit 네이티브 통합하므로 PoC 불필요 |
| **F-S3** | 헤드리스 서버 부하 PoC | **취소** | Godot 헤드리스 노선 보류 |
| **F-S4** | 동적 씬 라이팅 룩 검증 | **취소** | 3D 렌더러 노선 보류 |

---

## H. 포토리얼 웹임베드 전환 (D27, 2026-07-08) — **D26 대체**

> 사용자 확정 디자인 시안 재확인 결과, WorkAdventure(2D 픽셀·별도 앱)는 목표 품질·통합성과 불일치 → **D26을 D27로 대체**.
> 정본: [3d-design/design-style-analysis.md], [3d-design/photoreal-web-strategy.md], [14-virtual-office-spec.md].

| ID | 결정 | 내용 | 폐기되는 대안 |
|----|------|------|-------------|
| **D27** | 가상오피스 = **웹 임베드 포토리얼(R3F) + 오프라인렌더 깊이합성** | 단일 통합 웹앱(시안) 안의 뷰포트로 가상오피스 임베드. **Blender Cycles 오프라인 렌더 배경 + react-three-fiber 실시간 아바타 깊이합성**(고정 아이소 2.5D). 실시간 이동서버 = **SkyOffice 이식(Colyseus 권위 서버, 20Hz)**. 단일 세션(콘솔 JWT 그대로 3D 진입, 별도 OIDC 로그인 없음). **D26(WorkAdventure) 전면 대체.** | WorkAdventure self-host(별도 앱·2D 픽셀·OIDC 이중로그인), Godot 실시간(품질 40%·용량과다), 자유시점 풀3D(고정 아이소 채택) |

### D27로 인한 D26 폐기/부활 목록
| 결정 | D26 상태 | D27 상태 | 사유 |
|---|---|---|---|
| **D26** WorkAdventure self-host | 확정 | **폐기** | 별도앱·2D·이중로그인이 시안(통합·포토리얼)과 불일치 |
| **D7** 3D 라이팅 | 보류 | **부활(변형)** | 오프라인 Blender Cycles로 구움(실시간 아님) |
| **D8** 에셋 전달 | 보류 | **부활(변형)** | CC0 에셋 + Blender 씬. 런타임은 렌더 이미지+경량 아바타 GLTF |
| **D9** room 파라메트릭 | 보류 | **부활** | layout JSON→Blender 파라메트릭 씬 빌더 |
| **D1** WSS | WA 내장 | **SkyOffice/Colyseus 자체** | 20Hz tick·이동검증 자체 구현(09 정본 부활) |
| WA docker 스택·OIDC 브리지·"가상오피스 입장" 외부링크 | 운영 | **정리 대상** | 신규 구조 확정 후 제거 |

### D27 착수 전 필수 스파이크 (Phase 0)
| 스파이크 | 검증 | 상태 |
|---|---|---|
| **깊이합성 검증** | Blender 직교카메라 행렬 export→R3F 재현→아바타가 가구/유리벽 뒤 픽셀정확 가림. 실패 시 전략 재검토(빌보드 스프라이트/부분 실시간 3D) | ✅ **PASS(2026-07-08, commit b4736b1)** |
| ~~S2 STT 파이프라인~~ | ~~(D26에서 유지) 한국어 화자분리 STT~~ — **P6 외부의존으로 이관(2026-07-09)**: STT는 D27 착수 게이트가 아니라 P6(STT·AI) 단계의 외부 리소스 확보 항목이다(16 §Part B, 12-tasks P6, derived-gates REQ-006 정합). 수동 회의록 폴백 유지 | ➡️ P6 이관 |

---

## I. 스타일라이즈드 실시간 R3F 피벗 (D28, 2026-07-09) — **D27 렌더 방식 대체**

> Phase 0 이후 실측: 사용자가 직접 제작한 저폴리 스타일라이즈드 에셋팩(v1.1)으로 **실시간 R3F 씬 + 이동 캐릭터 실증 성공**(앱 내 `/office` 통합, 2026-07-09). D27의 오프라인렌더+깊이합성 노선은 3대 난제(깊이합성 정합·유리 투과·아바타 조명매칭)를 안고 있었고, 실시간 스타일라이즈드는 이를 **원천 제거**하면서 목표(통합 웹 3D 오피스)를 충족 → **D27의 "렌더 방식"만 D28로 대체**한다. 임베드·단일세션·Colyseus 이동서버·고정 아이소 등 D27의 나머지 골격은 유지.

| ID | 결정 | 내용 | 폐기되는 대안 |
|----|------|------|-------------|
| **D28** | 가상오피스 렌더 = **실시간 스타일라이즈드 R3F** (오프라인렌더·깊이합성 폐기) | react-three-fiber로 저폴리 스타일라이즈드 씬(glb)을 **실시간 렌더**. 고정 아이소 직교 카메라. 아바타 = 동일 씬 내 실시간 3D(같은 렌더러라 **오클루전 자동** → 깊이합성 불필요, 배경·아바타 조명 자동 일치). 에셋 = 사용자 제작 스타일 glb(**Blender 오프라인 굽기 불필요**). | D27 오프라인 Blender Cycles 렌더 배경 + 깊이합성, 유리 2레이어 스파이크, 포토리얼 라이팅 |

### D28로 인한 D27 항목 조정
| 결정/항목 | D27 상태 | D28 상태 | 사유 |
|---|---|---|---|
| **D27 렌더 방식** | 오프라인렌더+깊이합성 | **대체(실시간 스타일라이즈드)** | 3대 난제 제거·아트 부담↓·즉시 실증됨 |
| **깊이합성 스파이크** | ✅ PASS(b4736b1) | **보관(미채택)** | 기술은 성립하나 실시간 단일 렌더가 더 단순 → 사용 안 함 |
| **D7** 라이팅(Blender Cycles 굽기) | 부활(변형) | **재보류** | 실시간 R3F 직접광으로 충분(굽기 불필요) |
| **D8** 에셋(Blender 씬 렌더 이미지) | 부활(변형) | **변형** | 런타임 = 스타일 glb 실시간. Blender 씬/렌더 산출 불필요 |
| **임베드·단일세션·Colyseus·고정아이소** | 확정 | **유지** | 렌더 방식과 무관 — D27 골격 계속 |

### D28 영향 문서 (렌더 서술은 D28 기준으로 읽을 것)
- `07-3d-visual-asset-pipeline`(Blender/Cycles 파이프라인 → 실시간 glb로 대체), `02-trd`·`11-tech-stack`의 렌더 절, `16-render-spike-and-roadmap`(깊이합성 스파이크 = 보관). → 상단 D28 배너 부착.
- `04-data-model`의 `tscn_path→gltf_path` 마이그레이션은 D28에서도 유효(gltf_path 사용). 단 "배경 렌더 산출" 전제는 불필요.

### D28.1 — 런타임 에셋 v8.0 리깅·품질 업그레이드 (2026-07-10)

> D28의 **렌더 방식(실시간 R3F)은 그대로**, 그 위에서 돌던 **저폴리 스타일라이즈드 에셋팩(v1.1)을 v8.0 통합 개발본으로 교체**한다. 사유: v1.1은 씬 저폴리·캐릭터가 **정적 포즈(리깅 없음)**라 화면 품질과 동세가 부족했다. v8.0은 (1) 고밀도 히어로 씬과 (2) **스킨 리깅+애니메이션 내장 휴머노이드**를 제공 → 캐릭터가 실제로 idle/walk 등으로 움직인다. 렌더러·좌표(Z-up→Y-up)·오클루전 자동·임베드 골격은 D28 그대로 유지.

| ID | 결정 | 내용 | 대체되는 것 |
|----|------|------|-------------|
| **D28.1** | 런타임 에셋 = **v8.0 final dev complete 패키지** (`docs/virtual_office_final_dev_complete_v8_0/`) | **씬** = `SCENE_ACME_HQ_HERO_V4_001.glb`(13.5MB · 노드 381 · 메시 1689 · 머티리얼 32, 실측 검증). **캐릭터** = `characters_rigged_v8/*.glb`(18본 휴머노이드 · 스킨 · **애니 12클립 내장**: idle/walk/sit/typing/talk/wave/point/phone_call/clap 등). 정본 레지스트리 = `05_registries/asset-registry-v8.json`. Three.js 통합 헬퍼(`VirtualOfficeCharacterAnimator.ts`) 동봉. | v1.1 저폴리 씬(`scene.glb` 1.0MB) + 정적 포즈 캐릭터(리깅 없음) |

- **바뀌지 않는 것(D28 유지)**: react-three-fiber 실시간 렌더, 고정 아이소 직교 카메라, glb Z-up→three.js Y-up(-90°X) 보정, 같은 렌더러 오클루전 자동, DOM HUD 오버레이.
- **바뀌는 것**: 캐릭터를 정적 `<primitive>`에서 **`AnimationMixer` 기반 클립 재생**으로 전환. 씬 용량 13.5MB → 웹 로딩용 **Draco/meshopt 압축 권장**(optimization-criteria 참조).

### D28.2 — 런타임 에셋 v10.0 완제품(PBR 강화) 업그레이드 (2026-07-11)

> D28의 **렌더 방식(실시간 R3F)·D28.1의 rig 골격은 그대로**, 런타임 에셋을 **v8.0 → v10.0 완제품 패키지로 교체**한다. 사유: v8.0 GLB는 씬 토폴로지·rig는 충분했으나 캐릭터 GLB에 **텍스처가 임베드되지 않았고(씬도 54장)** 화면 재질감이 부족했다. v10.0은 모든 모델/씬 GLB를 **PBR(BaseColor·Normal·Metallic-Roughness) 내장본으로 재빌드**했다(실측: 114개 GLB 전부 텍스처 임베드, 2127장, 합계 177MB). **토폴로지·rig·클립명이 v8과 동일**하므로 프론트는 파일 교체만으로 즉시 품질이 오르는 drop-in 업그레이드다.

| ID | 결정 | 내용 | 대체되는 것 |
|----|------|------|-------------|
| **D28.2** | 런타임 에셋 = **v10.0 complete product 패키지** (`docs/virtual_office_complete_product_v10_0/`) | **씬** = `01_runtime_3d/scenes_pbr_v10/SCENE_ACME_HQ_HERO_V4_001.glb`(**노드 381·메시 1689·머티리얼 32 = v8 동일**, 텍스처 54→**114장 내장**, 13.5→**22.4MB**, 실측 검증). **캐릭터** = `01_runtime_3d/models_pbr_v10/characters_rigged/*.glb`(**동일 V8 rig 18조인트·동일 12클립명** `ANIM_IDLE_001`…`ANIM_CLAP_001`, PBR 텍스처 0→15~24장 내장, ~1.6MB). 정본 레지스트리 = `05_registries/asset-registry-v10.json`(137 에셋). QA=PASS(`06_quality_reports/validation-report-v10.json`). | D28.1 v8.0 런타임 에셋(텍스처 미임베드 캐릭터 626/133KB, 씬 54장) |

- **바뀌지 않는 것(D28/D28.1 유지)**: react-three-fiber 실시간 렌더, 고정 아이소 직교 카메라, glb Z-up→three.js Y-up(-90°X) 보정, 같은 렌더러 오클루전 자동, `AnimationMixer` 12클립 재생, DOM HUD. **OfficeViewport 로직 변경 0**(clip `findByName` 정확매칭·`UPPER_ARM_R/L` 본명 보정 그대로 동작).
- **바뀌는 것**: `frontend/public/office/*.glb` 8종(씬 + 리깅 캐릭터 7종) v10 PBR 본으로 스왑 완료. `OfficeViewport.tsx` 헤더/레지스트리 참조 v10 갱신.
- **추가(Later 범위)**: v10 패키지에는 독립 실행형 Three.js 런타임 앱(`11_complete_runtime_app/`: 자유배치 레이아웃 에디터 + A* 이동 + 좌석 앵커), 레이아웃 프리셋 3종(`12_layout_presets/`), 에셋 팔레트가 포함된다. 이는 **Next.js/R3F 프론트와 별개 스택**이라 이번엔 씬/캐릭터만 통합하고 레이아웃 에디터 이식은 Later.
- **예산 주의**: PBR 내장으로 개별 GLB가 커졌다(씬 22.4MB, 캐릭터 ~1.6MB×7). 웹 첫 로딩 부담 → **Draco/meshopt 지오메트리 압축 + KTX2 텍스처 압축 권장**(`3d-design/optimization-criteria.md` 참조).


## J. 2.5D 클린플레이트 렌더 피벗 (D29, 2026-07-12) — **D28 실시간 3D R3F 대체**

> D28(실시간 스타일라이즈드 3D R3F)·D28.1(v8 rig)·D28.2(v10 PBR)로 3D 노선을 강화했으나, 실측상 (1) v10 PBR GLB의 웹 첫 로딩 부담(씬 22.4MB), (2) 3D 리깅 캐릭터의 팔 포즈·조명정합·오클루전 튜닝 부담, (3) 고정 아이소 뷰에서 실시간 3D 이점 대비 비용 과다 → 사용자 제작 **2.5D 클린플레이트 프로덕션 팩**으로 렌더 방식을 전환한다. 임베드·단일세션·Colyseus 이동서버·고정 아이소·좌표계 등 D27~D28 골격은 유지하며 **"렌더 방식"만 D29로 대체**한다.

| ID | 결정 | 내용 | 대체되는 것 |
|----|------|------|-------------|
| **D29** | 가상오피스 렌더 = **2.5D 클린플레이트 + DOM 스프라이트 아바타** (실시간 3D R3F·GLB 폐기) | 배경 = 고정 아이소 클린플레이트 PNG(`docs/virtual_office_2_5d_modular_brandable_v2_2_hotfix` 팩 → `frontend/public/office2d/plates/horizon.png`). 아바타 = DOM `<img>` 프레임 스프라이트(idle 6f/walk 8f, `office2d/characters/{id}/`) + 깊이 기반 원근 스케일·y기반 z-정렬. 렌더러 = **`OfficeViewport2D`**(three.js/R3F 제거, DOM 합성). 좌표계 = 20×11.256m top_left 미터(`lib/office2d.ts` = realtime `SceneFloorLayoutProvider` HORIZON과 동일). | D28/D28.1/D28.2 실시간 3D R3F(three.js·GLB·Draco·AnimationMixer), `OfficeViewport.tsx`, v10 PBR GLB 8종 |

### D29로 인한 D28 계열 조정
| 결정/항목 | D28.2 상태 | D29 상태 | 사유 |
|---|---|---|---|
| **렌더 방식** | 실시간 3D R3F(v10 PBR GLB) | **대체(2.5D 클린플레이트 PNG + DOM 스프라이트)** | 웹 로딩·3D 튜닝 부담 제거, 고정 아이소에 충분 |
| three.js/R3F/postprocessing/Draco 의존 | 사용 | **프론트에서 제거** | DOM 합성으로 대체 |
| v8/v10 3D GLB 에셋 패키지 | 런타임 정본 | **런타임 미사용(문서 아카이브 보존)** | 2.5D 팩으로 대체. 3D 팩은 `docs/`에 이력 보존 |
| **임베드·단일세션·Colyseus 20Hz·고정아이소·좌표계(D25)·office_layout(D12)** | 확정 | **유지** | 렌더 방식과 무관 — D27~D28 골격 계속 |

- **바뀌지 않는 것**: 통합 대시보드 셸, 단일세션 JWT(Colyseus onAuth), Colyseus 권위 이동서버(20Hz·이동검증8·근접검증8 LOS), presence 7종, 회의 D24 명시입장, office_layout(D12)·좌표계(D25), 미니맵·이름표·상태 뱃지.
- **바뀌는 것(코드, 이미 main 반영)**: `OfficeViewport`(R3F) → `OfficeViewport2D`(DOM 2.5D), `three`/`@react-three/*`/draco 의존 제거, `public/office/*.glb`(3D) → `public/office2d/`(클린플레이트+프레임 스프라이트), `lib/office2d.ts` 좌표 정본. 커밋: `aac4fca`(R3F 제거·2.5D 전환) · `f2a9e20`(v10 3D 팩 폐기·2.5D 프로덕션 팩 v1.0~v2.2 도입) · `a4c98f4`(realtime HORIZON 2.5D 씬 플로어).
- **오클루전**: D28의 "같은 렌더러 자동 오클루전"은 D29에서 **y좌표 기반 z-정렬 + 보행폴리곤/가구충돌 클램프**로 대체(깊이합성 셰이더 불필요). 아바타는 가구 위로 걷지 못하고, 화면 아래(가까움)일수록 앞에 그려진다.
- **D29 영향 문서(렌더 서술은 D29 기준으로 읽을 것)**: `14-virtual-office-spec` · `16-render-spike-and-roadmap` · `07-3d-visual-asset-pipeline` · `11-tech-stack §2.1` · `3d-design/{design-style-analysis §5, photoreal-web-strategy, scene-structure, optimization-criteria, asset-registry}` → 상단 D29 배너 부착.
- **D29 이후 실시간 배선(P1/P2, PR 진행 중)**: 아바타 커스터마이징 2.5D 스프라이트 반영(preset→스프라이트·이름표색), 회의 2m 근접 명시입장 클라 배선(D24), 미니맵 실시간 위치, 단일세션 축출, 공지 스펙(category/게시·만료), 레이아웃 회전충돌(OBB/SAT).

---

## K. 에셋 전면 리셋 — 2.5D 신규 재작업 (D30, 2026-07-13)

> 사용자 판단: "3D를 고집한 나머지 오히려 퀄리티가 더 안 좋아졌다." 3D 노선(D27~D28)에서
> 파생된 기존 에셋 산출물(2.5D 팩 포함)을 **전량 폐기**하고, 2.5D 방향은 유지하되
> **에셋을 처음부터 제대로 재작업**한다. 엔진 계층(뷰포트 코드·Colyseus·좌표계)은
> 검증 완료 상태라 유지 — 에셋만 교체 가능하게 분리한다.

| ID | 결정 | 내용 | 대체되는 것 |
|----|------|------|-------------|
| **D30** | 에셋 전면 리셋 — **기존 에셋 전량 삭제 + 2.5D 신규 에셋 재작업** | ① 저장소에서 삭제(git 이력으로만 보존): 2.5D 팩 5종(`docs/virtual_office_2_5d_*`), 3D 전략 문서(`docs/3d-design/`), 렌더 파이프라인(`render-pipeline/`), 깊이합성 스파이크(`spikes/`), 런타임 에셋(`frontend/public/office2d/` 전체). ② 엔진 유지: `OfficeViewport2D`·`lib/office2d.ts` 좌표 계약(20×11.256m)·보행/방/장애물 폴리곤·Colyseus 이동서버 — 신규 에셋 납품 시 파일 배치 + `ASSETS_READY=true` 전환만으로 복원. ③ 전환기 렌더 = **플레이스홀더**(단색 플레이트 + 좌표 계약 시각화 + 도트 아바타). ④ 신규 에셋 요구 스펙 = **17-asset-rework-spec.md** (신설 정본) | D29의 클린플레이트 v2.2 팩·캐릭터 v1 frames, D27~D28 잔여 산출물 전부 |

- **바뀌지 않는 것**: 2.5D 방향 자체(D29 렌더 방식론), 좌표계·보행/장애물 폴리곤(이동서버 검증 계약), Colyseus·프레즌스·회의 D24·콘솔 전 기능.
- **바뀌는 것**: 에셋 파일 전부(플레이트 PNG·캐릭터 프레임), 그리고 그것을 참조하던 문서 팩·파이프라인 유산.
- **복원 절차(신규 팩 납품 시)**: `frontend/public/office2d/plates/`·`characters/` 배치 → `lib/office2d.ts ASSETS_READY=true` → (지오메트리 변경 시) WALK_AREA/ROOMS/OBSTACLES + realtime HORIZON 폴리곤 동기 갱신.
- ✅ **v1 팩 납품 완료 (2026-07-13, 당일)**: `tools/asset-gen` 프로시저럴 생성기(아이소 SVG→PNG, 시안 정합 팔레트) — 플레이트+캐릭터 8직군×14프레임+layout.json 단일 소스. ASSETS_READY=true 복원, realtime HORIZON v1 지오메트리 동기(scene-floor 12 PASS). 상세 = 17-asset-rework-spec.md.

---

## 문서별 반영 체크리스트

> ⚠️ **아래 [x]는 D26(WorkAdventure)까지의 반영 현황이다. D27(포토리얼 웹임베드, 2026-07-08) 반영은 별도 — 하단 "D27 반영 현황"을 정본으로 본다.** 아래 체크리스트의 [x]를 D27 완료로 오독하지 말 것.

- [x] 01-prd.md — D5(회의록 STT), D6(일정), D22(수치+측정방법), WON'T 표(WASM 유지·미리보기 예외 불필요해짐)
- [x] 02-trd-architecture.md — D1, D3, D4, D7, D13, D17, D21, D22, D24
- [x] 03-erp-integration.md — D15, D16, D17, D18, D19, D20(f)
- [x] 04-data-model.md — D10, D16(정본), D18, D19, D20(e)
- [x] 05-office-layout-schema.md — D9, D10, D12, D25, 샘플 JSON 자체 검증 통과
- [x] 06-screens.md — D11, D12, D5(회의록 화면), 이의신청·로그인·권한·자율좌석 화면 신설
- [x] 07-3d-visual-asset-pipeline.md — D7, D8, D9, 시간 재추정
- [x] 08-kpi-logic.md — D14, D15, D16, D17, D20
- [x] 09-realtime-collaboration.md — D1, D3, D4, D13, D24, D22
- [x] 10-roadmap.md — D6(58주 재산정), D5(STT 태스크), F(스파이크), GDScript / **D26 반영**: Phase 1~4를 WorkAdventure 연동 4~6주로 재편, STT·KPI Phase 유지
- [x] 11-tech-stack.md — D1, D2, D21, 버전 표기 정정(FastAPI 0.115+, PyJWT 등) / **D26 반영**: 2.1(3D 클라이언트)/2.2(실시간 서버) 절을 WorkAdventure 스택으로 교체
- [x] 12-tasks.md — D6, F(Phase 0 스파이크), GDScript, D22, 누락 태스크(이의신청·분기집계·감사로그·STT)
- [x] 13-risks-open-questions.md — OQ4/OQ11 확정 종결, 신규 리스크(LiveKit 통합·STT·개인정보/노동법), 스테일 OQ 정리
- [x] specs/screens/virtual-office-3d.yaml — D26 전환 주석 (본문 D27 전환은 2026-07-09 완료 — 아래 D27 현황 참조, 구 "부분 잔존" 주석 철회)

### D27 반영 현황 (2026-07-08 전환 — 정본)

> D27 = D26(WorkAdventure) 전면 폐기 → 포토리얼 웹임베드(R3F + Blender 오프라인렌더 깊이합성) + SkyOffice/Colyseus 이동서버 + 단일세션. §H 참조.

**✅ D27 반영 완료(정본):** 00-decisions §H(D27) · 04-data-model §2.5/§2.7 · 10-roadmap §D27섹션 · 14-virtual-office-spec · 15-realtime-server-spec · 16-render-spike-and-roadmap · 3d-design/{design-style-analysis, photoreal-web-strategy}

**✅ D27 재작성 완료 (2026-07-09) — 18개 문서 전량:**
- [x] **기초**: 01-prd v4.0 · 02-trd v2.0 · 11-tech-stack v3.0
- [x] **화면/태스크**: 06-screens v2.0(통합 셸+공지+KPI워크플로우 신설) · 12-tasks v3.0(P0~P7, 39태스크) · specs/screens/{index, virtual-office-3d}.yaml
- [x] **3D/렌더**: 07-3d-visual-asset-pipeline v2.0 · 3d-design/{scene-structure, optimization-criteria, asset-registry} v2.0 · 05-office-layout §5(부분, 스키마 본체 보존)
- [x] **실시간/메타**: 09-realtime v2.0 · 13-risks v4.0 · 10-roadmap v3.1(헤더/간트) · loop/08-derived-gates(REQ 재파생) · deployment/onprem-docker v2.0 · testing/test-strategy v2.0
- [x] **erd.md**: 부분개정 완료(2026-07-09 교차감사 교정) — 🟡 배너, Godot 잔존 정정, 카운트 18, enum·필드매핑 #18 반영

### 교차 정합성 감사 + 일괄 교정 (2026-07-09, 2차)

> 재작성 18종에 대해 5차원 교차감사(실시간 계약·3D 렌더 계약·Phase/게이트·KPI/화면·배너/참조) 수행 후 발견 전량 교정 완료.

**해소된 실질 충돌(정본 확정):**
1. 회의 join = **2단계 D24 명시입장**(Colyseus enter_meeting=검증·통지 → 사용자 확인 → 클라→FastAPI `POST /api/meetings/join`). 15 §3 정본 개정, 09/02 전파.
2. 근접 화상/음성 = **PeerJS(≤4명)**, 회의실=LiveKit. 09의 "LiveKit 1:1" 폐기.
3. KPI 권한 = **조정: leader(자기 팀)·admin / 확정: admin 전용**(08 §7.1 정본). 06 §3.10·rbac.yaml·kpi-dashboard/workflow.yaml 정합.
4. asset 스키마 정본 = **3d-design/asset-registry §1.1**(gltf_path NULL허용 + asset_delivery 판별자 + CHECK). 07 DDL은 참조로 강등, 04 §2.6 출처 단일화.
5. P7 부하 = **20명 도그푸딩 실측**(100명=설계 목표, P7 이후). 13-risks 정정.
6. Colyseus 포트 **2567** 15 §8 확정(onprem/02와 일치). 메시지 필드 정본 = last_seq/room_id/target_user_id.
7. 렌더 산출물 경로 단일 규약 = `frontend/public/assets/3d/scenes/{floor}/{layout_version}/`(+models/{slug}/{slug}.glb). 07/registry/onprem/04 동기화.
8. 아바타 폴리곤 = 8K~15K/명·20명 ≤300K(optimization-criteria 정본). S2 STT 스파이크 = P6 이관(§H). D6 = 주 단위 미확정.

**⚠️ 후속 정합:**
1. 🔴 **asset 테이블 마이그레이션 필요(코드)** — backend `tables.py` asset.`tscn_path`(Godot)가 실측 존재. D27 문서(07·asset-registry·04 §2.6)는 `gltf_path`+배경 렌더 산출 기준 → **Alembic 마이그레이션(tscn_path→gltf_path) 필요.** (04 §2.6에 노트 추가됨)
2. [x] 06-screens §3.4 KPI 지표어휘 → 08 정본 메트릭으로 통일(2026-07-09). §3.13 이의신청은 kpi-objection.yaml 소관으로 경계 정리.
3. [x] HTML 미러(docs/_html/) 전체 재생성 — 35개(2026-07-09).
4. [x] specs/screens/{announcement, kpi-workflow}.yaml 상세 스펙 생성 + resources.yaml에 announcement 도메인 리소스 추가(2026-07-09).

**📦 아카이브 대상(D27 이전 스냅샷):** audit-2026-07-07.md · implementation-status-2026-07-06.md · spec-conformance-2026-07-06.md · loop/{document-gap-report, planning-loop-report, final-planning-approval}.md
