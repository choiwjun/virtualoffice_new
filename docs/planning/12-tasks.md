# 12-tasks.md

> 🟦 **D29 정합(2026-07-12):** 렌더가 2.5D 클린플레이트(DOM 스프라이트, `OfficeViewport2D`)로 전환됨(00-decisions §J) — P2 "Blender 렌더 파이프라인"(P2-T1~T3)은 D28에 이어 **D29에서도 불요/폐기**. **P3 이동서버(Colyseus)는 구현 완료(main)**: `OfficeRoom` 20Hz·이동검증8·근접검증8(LOS)·onAuth JWT·presence 배치. P1 후속 배선(아바타 스프라이트 반영·회의 2m 근접입장·미니맵)·단일세션 축출·공지 스펙(category/게시·만료)·레이아웃 회전충돌(OBB)은 별도 PR.

## 태스크 분해 및 로드맵 실행 계획 (D27 포토리얼 웹임베드)

**프로젝트**: 가상오피스 운영 플랫폼 (vituraloffice_new)
**버전**: v3.0
**생성일**: 2026-07-01
**최종 수정**: 2026-07-09
**최종 목표**: 로드맵 P0~P7 완성 (MVP 컷 없음, 온전한 통합 솔루션 — 사내 도그푸딩 릴리스)
**개발 모델**: 1인 + AI 협업, TDD 기반
**총 Phase**: 8개 (P0 + P1~P7)
**총 Task**: 39개 (P0 완료 2 + P1~P7 구현 30 + Phase 검증 V 7 · 구 Godot/WA 86태스크 편성 폐기). 유형: 신규 스택(Blender/R3F/Colyseus/셸 UI/공지) 약 20 + 백엔드 재사용·배선 약 12
**정본 기준**: `00-decisions.md` §H(D27) · `14-virtual-office-spec` · `15-realtime-server-spec` · `16-render-spike-and-roadmap` §Part B · `3d-design/{design-style-analysis, photoreal-web-strategy}` — 충돌 시 정본이 우선
**스택(D27)**: react-three-fiber(three.js 0.168) + Colyseus(Node/TS) + Blender Cycles(오프라인 렌더) + FastAPI + Next.js. 단일 세션 JWT(콘솔 JWT 그대로 3D 진입, 별도 OIDC 없음).

> **변경 요약 (v3.0, 2026-07-09)** — **D27 전환 재작성**:
> - **D26(WorkAdventure) + Godot 스택 전면 폐기** → D27 포토리얼 웹임베드(2026-07-08 사용자 승인). 구 Phase 1(Godot 골든샘플 3D `.tscn`/`.gd`/Forward+)·Phase 4(Godot 헤드리스 서버 + WSS 게이트웨이)·Phase 0 스파이크 S1~S4(Godot↔LiveKit 등)·데스크톱 draft 뷰어·P5 WebRTC GDExtension 등 **Godot/WA 태스크 전량 폐기·교체**.
> - **Phase 편성 정본 = 16-render-spike-and-roadmap.md §Part B (P0~P7)** 로 재편.
> - **P0 스파이크(깊이합성) = PASS(2026-07-08, commit `b4736b1`)** → 완료 처리. 다음 착수 = P1.
> - **D27 신규 태스크 신설**: Blender 파라메트릭 씬 빌더 + 깊이패스 렌더, R3F 뷰포트 + 깊이합성 셰이더, Colyseus 이동서버(20Hz·이동검증8·근접검증8), 통합 대시보드 셸 UI, 공지 리소스 API + 화면, KPI 워크플로우 화면(관리자 검토·이의신청).
> - **백엔드 도메인 태스크(ERP sync·좌석·회의·KPI 엔진 + AI 초안·consent·EOD·work-log·감사)는 대부분 재사용** — 이미 구현됨(pytest 417+). 태스크에 `[구현됨]`/`[부분구현]` 표기.
> - **주 단위 기간은 스파이크 후 확정**(억지 숫자 금지). 구 45주/58주 간트·86태스크 편성 폐기. 규모는 상대 표기(S/M/L).
>
> **이전 이력 요약**: v2.1(2026-07-02) Godot/WA 기준 86태스크 편성 → D27로 전면 폐기. v3.0에서 P0~P7 D27 편성으로 재생성.

---

## Phase 0: 깊이합성 스파이크 (착수 전 필수 게이트) — ✅ PASS

> ⚠️ **실측 재정합 2026-07-11** — 아래 상태는 코드 전수조사 기준(00-decisions §I D28.2).

> **목적**: Blender Cycles 오프라인 렌더 배경 위 react-three-fiber 실시간 아바타가 가구·유리벽 뒤로 픽셀 단위 정확히 가려지는가(깊이합성 오클루전) 실증. D27 전략의 기술적 성립 여부 게이트.
> **정본**: 16-render-spike-and-roadmap.md §Part A.
> **상태**: ✅ **PASS — 2026-07-08 (commit `b4736b1`)**. 게이트 통과 → 다른 코드 착수 허용. 다음 착수 대상 = P1(셸+데이터연결).

### [x] P0-T1: Blender 최소 오피스 씬 + 직교 아이소 렌더 + 깊이패스 (완료) — (⛔D28에서 미채택·보관)

- **담당**: 3d-engine-specialist
- **의존**: 없음
- **산출물** (완료):
  - ✅ `render-pipeline/build_office.py` — Blender 헤드리스 최소 오피스 씬(바닥·책상 1·유리벽 1), 직교(ortho) 아이소 카메라 렌더
  - ✅ `render-pipeline/generate_test_assets.py`, `render-pipeline/out/`
  - ✅ 패스 export: `office_bg.png`(color) · `office_depth.png`(Z depth 선형화) · `camera.json`(ortho scale·행렬·near/far) → `spikes/depth-composite/public/`
- **완료 조건** (충족):
  - ✅ Blender 5.1 API 대응(depth PNG 2차 렌더 방식, commit `d5ccaf0`)
  - ✅ 직교 카메라 행렬·near/far가 R3F에서 재현 가능한 형식으로 export

### [x] P0-T2: R3F 깊이합성 셰이더 데모 + 오클루전 검증 증거 (완료) — (⛔D28에서 미채택·보관)

- **담당**: 3d-engine-specialist
- **의존**: P0-T1
- **산출물** (완료):
  - ✅ `spikes/depth-composite/` — R3F 최소 씬(배경 풀스크린 쿼드 + camera.json 직교 카메라 재현 + 테스트 아바타), 깊이합성 셰이더(아바타 프래그먼트 뷰공간 깊이 vs `office_depth` 샘플 비교 → 뒤면 discard)
  - ✅ 증거: `spikes/depth-composite/evidence/{front,behind,scan_*,diag_*,spike_*}.png` + `EVIDENCE.md`
- **완료 조건** (§A.3 전항목 충족, 2026-07-08):
  - ✅ 아바타 책상 앞 → 온전히 보임 / 책상·유리벽 뒤 → 정확히 가려짐(경계 오차 ≤ 2px)
  - ✅ 카메라 좌표계 정합(발 위치 격자 정합, 좌표 드리프트 없음)
  - ✅ 아바타 조명 배경 톤 정합(IBL/라이트프로브 1차)
  - ✅ 스크린샷 3종(앞/뒤/경계) 증거 저장
- **실패 시 폴백(미발동)**: 부분 실시간 3D / 빌보드 스프라이트 아바타 / 시점 축소.

---

## Phase 1: 통합 대시보드 셸 + 데이터 연결

> **목적**: 확정 디자인 시안(design-style-analysis §3)의 통합 대시보드 셸을 픽셀 재현하고, 기존 백엔드 API(KPI·업무·유저·일정)에 연결. **3D 뷰포트 자리는 placeholder**(P2에서 렌더 배경 주입).
> **산출물**: Next.js 3분할 셸 UI(Header/Left Nav/Center 상하분할/Right Panel) + 디자인 토큰 + 공용 컴포넌트 + 백엔드 데이터 배선.
> **의존**: P0 통과(✅). **선행**: 1인 개발 순차 원칙(R7).
> **재사용 전제**: 백엔드 KPI·업무(work_log)·유저(directory/erp)·좌석·프레즌스 API 대부분 존재(pytest 417+) → 프런트 배선 중심.

### [ ] P1-T1: 디자인 토큰 + Tailwind 테마 + 공용 컴포넌트 카탈로그 [신규] — ✅구현 (frontend/components/ui/*)

- **담당**: frontend-specialist
- **의존**: 없음
- **산출물**:
  - `frontend/styles/tokens.css` — design-style-analysis §1 컬러/타이포/spacing 토큰(CSS 변수)
  - `frontend/tailwind.config.js` `theme.extend.colors` 매핑(--bg-base/surface, --primary, status 7색 등)
  - 공용 컴포넌트: `<Card>`, `<StatusBadge>`(7종 상태색), `<Avatar>`(상태 점), `<KpiGauge>`(도넛), `<ProgressMetric>`, `<ListItem>`, `<MediaBar>` — `frontend/components/ui/`
- **완료 조건**:
  - 다크 퍼스트 토큰 전량 정의, status 7종(online/meeting/external/focus/away/offline + danger) 색·라벨 병기(색맹 대응, §8)
  - 컴포넌트 스토리/스냅샷 렌더 검증, 대비 4.5:1 확인

### [ ] P1-T2: App Shell 레이아웃 (Header / Left Nav / Center 상하분할 / Right Panel) [신규] — ✅구현 (/office 셸 + Sidebar + (protected)/layout)

- **담당**: frontend-specialist
- **의존**: P1-T1
- **산출물**:
  - `frontend/app/(protected)/layout.tsx` — 3분할 셸(Header ~56px / Left Nav ~240px / Center / Right Panel ~320px)
  - `frontend/components/shell/{Header,LeftNav,RightPanel}.tsx`
  - Center: 상단 3D 뷰포트 placeholder(약 55~60% 높이) + 하단 대시보드 3카드 행
  - 반응형: 좁아지면 우측 패널 접기, 3카드 세로 스택(§3)
- **완료 조건**:
  - 시안 구조 픽셀 재현(≥1440 최적), Left Nav 활성 항목 `--primary-soft` + 좌측 인디케이터
  - 하단 내 프로필 카드(아바타+이름+상태+상태변경 버튼)

### [ ] P1-T3: 3D 뷰포트 placeholder 컴포넌트 (`<OfficeViewport>`) [신규] — ✅구현 (실 R3F v10, placeholder 넘어섬)

- **담당**: frontend-specialist + 3d-engine-specialist
- **의존**: P1-T2
- **산출물**:
  - `frontend/components/viewport/OfficeViewport.tsx` — P2 렌더 배경 주입 지점, 현재는 자리표시(로딩/안내 오버레이)
  - 층 선택기·미니맵·미디어바 오버레이 **자리**(§4 컴포넌트 카탈로그, 실제 배선은 P2~P5)
- **완료 조건**:
  - R3F 마운트 지점 격리(P2에서 배경 텍스처만 주입 가능한 인터페이스)
  - placeholder에서 셸 레이아웃 깨짐 없음

### [ ] P1-T4: 대시보드 3카드 데이터 연결 (오늘의 업무 · 나의 KPI · 진행중 화상회의) [배선] — 🟡부분 (실 API 배선됨이나 className="hidden"으로 숨김)

- **담당**: frontend-specialist
- **의존**: P1-T2
- **산출물**:
  - `frontend/components/dashboard/{TodayWorkCard,MyKpiCard,ActiveMeetingsCard}.tsx`
  - 배선: work_log 조회(`/api/work-logs`) · KPI 결과(`/api/kpi-results` 본인) · 회의(`/api/meetings`) — 백엔드 존재 API 연결
- **완료 조건**:
  - `<KpiGauge>`에 본인 KPI 점수 렌더(도넛 게이지, 0~100)
  - 오늘의 업무 목록·진행중 회의 목록 실데이터 표시(로딩/빈 상태 처리)

### [ ] P1-T5: 공지 리소스 API (announcement) [신규 — 백엔드] — ✅구현 (backend/app/api/notices.py + Notice 모델)

- **담당**: backend-specialist
- **의존**: 없음(04-data-model §2.7 정본)
- **산출물**:
  - 모델: `backend/app/models/tables.py::Announcement` (04-data-model §2.7 스키마: id, company_id, title, body(md), category[system|notice|info], pinned, author_user_id(FK erp_user RESTRICT), published_at, expires_at, created_at)
  - API: `backend/app/api/announcements.py` — `GET /api/announcements`(활성·핀 우선 최신순), `POST`(admin), `PUT/{id}`, `DELETE/{id}`(soft)
  - 감사 훅: `announcement_published/updated/deleted` → audit_log(구현됨)
- **완료 조건**:
  - 활성/만료/핀 필터 정확성(published_at·expires_at·pinned), company_id 스코프
  - 게시·수정·삭제 audit_log 기록, 만료 공지 소프트 보존(물리 삭제 금지)

### [ ] P1-T6: Right Panel — 사용자 목록 · 일정 · 공지사항 배선 [배선] — 🟡부분 (배선됨, 단 프레즌스는 1회성 fetch=실시간 아님)

- **담당**: frontend-specialist
- **의존**: P1-T2, P1-T5
- **산출물**:
  - `frontend/components/shell/panels/{UserListPanel,SchedulePanel,AnnouncementPanel}.tsx`
  - 배선: 유저(`/api/directory`) · 일정/회의(`/api/meetings`) · 공지(`/api/announcements`)
- **완료 조건**:
  - 리스트형 카드 스택(사용자→일정→공지), 상태 뱃지·핀 공지 상단 노출
  - "접속중 N명" 카운트 표기(§7 마이크로카피)

### [ ] P1-V: 셸 + 데이터 연결 통합 검증

- **담당**: test-specialist
- **의존**: P1-T1 ~ P1-T6
- **산출물**: `docs/verification/phase-1-report.md`
- **수용기준**:
  - 시안 3분할 셸 픽셀 재현(≥1440), 3D 뷰포트 placeholder 정상
  - 3카드 + 우측 패널 실데이터 배선(KPI·업무·유저·일정·공지) E2E 로드 성공
  - 공지 API CRUD + 감사 기록 통과, 다크 대비·색맹 대응 확인

---

## Phase 2: 렌더 파이프라인 (layout JSON → Blender 배경 + 깊이 → R3F 뷰포트)

> **목적**: office_layout JSON을 Blender 파라메트릭 씬으로 빌드하여 1개 층 포토리얼 배경 + 깊이패스를 자동 생성하고, R3F 뷰포트에 배경으로 표시. P0 스파이크의 최소본을 **파라메트릭·프로덕션 파이프라인**으로 확장.
> **산출물**: `build_office.py` 파라메트릭 씬 빌더 + 배경/깊이 렌더 산출물 + R3F `<OfficeViewport>` 배경 표시.
> **의존**: P0 통과(✅) + P1(셸 뷰포트 자리). 순차 원칙.
> **정본**: photoreal-web-strategy.md, design-style-analysis §5(아트 디렉션).

### [ ] P2-T1: office_layout JSON → Blender 파라메트릭 씬 빌더 [신규] — ⛔D28폐기 (오프라인렌더+깊이합성 노선 폐기, 실시간 R3F로 대체 — 미구현이 아니라 불필요)

- **담당**: 3d-engine-specialist + backend-specialist
- **의존**: P0-T1
- **산출물**:
  - `render-pipeline/build_office.py` 확장 — office_layout JSON(좌석/벽/회의실/문/구역, 좌표계 top_left 미터 D25) → Blender 파라메트릭 씬 자동 구성
  - 에셋 라이브러리: 책상·유리 회의실·소파·식물·브랜드월 프로시저럴/임포트
- **완료 조건**:
  - 임의 office_layout JSON 1건 → 씬 자동 빌드(좌석/벽/개구부 배치 정합)
  - 아이소메트릭 30~35° 부감 카메라, PBR 재질(유리 반사·목재·패브릭·금속·식물)

### [ ] P2-T2: 1개 층 포토리얼 배경 렌더 + 깊이패스 + camera.json 자동생성 [신규] — ⛔D28폐기 (오프라인렌더+깊이합성 노선 폐기)

- **담당**: 3d-engine-specialist
- **의존**: P2-T1
- **산출물**:
  - 렌더 배치: `render-pipeline/` — `office_bg.png`(Cycles color) + `office_depth.png`(선형 Z) + `camera.json`(직교 행렬) 자동 산출
  - 조명: 따뜻한 키라이트 + 회의실 쿨 블루 네온 엣지(--accent-cyan) + AO/소프트 섀도우(design §5)
- **완료 조건**:
  - 1개 층 layout → 배경/깊이/카메라 3종 자동 생성(수동 개입 없이)
  - 깊이 정밀도가 깊이합성 오클루전(경계 ≤2px)에 충분

### [ ] P2-T3: R3F 뷰포트 배경 표시 + 깊이 텍스처 로드 [신규] — ⛔D28폐기 (오프라인렌더+깊이합성 노선 폐기)

- **담당**: 3d-engine-specialist + frontend-specialist
- **의존**: P2-T2, P1-T3
- **산출물**:
  - `frontend/components/viewport/OfficeViewport.tsx` 확장 — office_bg 풀스크린 쿼드 + camera.json 직교 카메라 재현 + office_depth 텍스처 로드(P3 아바타 합성 대비)
  - 스파이크 `spikes/depth-composite/` 셰이더 이식
- **완료 조건**:
  - 셸 중앙 뷰포트에 포토리얼 배경 표시(placeholder 대체)
  - 층 선택 시 해당 층 배경/깊이/카메라 스왑(다층은 P7)

### [ ] P2-V: 렌더 파이프라인 통합 검증

- **담당**: test-specialist
- **의존**: P2-T1 ~ P2-T3
- **산출물**: `docs/verification/phase-2-report.md`
- **수용기준**:
  - office_layout JSON → 배경/깊이/카메라 자동 생성 재현
  - R3F 뷰포트에 배경 표시 + 깊이 텍스처 로드 성공, 스파이크 오클루전 정합 유지

---

## Phase 3: 실시간 이동서버 (Colyseus) + 깊이합성 아바타

> **목적**: 자체 실시간 이동서버(Colyseus 이식, 15-realtime-server-spec)로 아바타 이동·좌표동기화(20Hz)·이동검증 8항목·근접검증 8항목 구현. 아바타 GLTF+애니메이션을 뷰포트에 깊이합성 렌더.
> **산출물**: Colyseus `OfficeRoom` + 프로토콜 + 검증 + R3F 멀티유저 아바타(깊이합성) + presence 배치 push 배선.
> **의존**: P2 완료(뷰포트 배경/깊이). 순차 원칙.
> **정본**: 15-realtime-server-spec, 09-realtime-collaboration §5, D1/D3/D4/D22.
> **재사용**: FastAPI presence 수집(`presence_store`/`presence_stream`)·좌석·JWT 존재 → Colyseus에서 호출.

### [ ] P3-T1: Colyseus 서버 + OfficeRoom(층 단위) + JWT onAuth [신규] — 🔴미구현 (Colyseus 서버 자체 부재 = 최대 갭)

- **담당**: backend-specialist(Node/TS)
- **의존**: P2 (레이아웃 콜라이더 필요)
- **산출물**:
  - `realtime-server/` (Node/TS Colyseus) — `OfficeRoom({office_id, floor_id})`, `OfficeState{players: Map<sessionId, Player>}`(Schema binary delta)
  - `onAuth`: FastAPI JWT 검증(콘솔 세션 재사용, 별도 로그인 없음, D4)
  - 컨테이너화(WA 스택 대체), Caddy `/ws/office/*` WSS 라우팅
- **완료 조건**:
  - JWT join → 초기 snapshot 전송, 20Hz tick 루프
  - 룸=층 단위 격리, players Schema delta 브로드캐스트

### [ ] P3-T2: 이동 검증 8항목 + reconcile [신규] — 🔴미구현 (Colyseus 서버 부재)

- **담당**: backend-specialist(Node/TS)
- **의존**: P3-T1
- **산출물**:
  - `move_request{target_pos, seq}` 서버 검증(15 §4): ①company_id ②office_id ③floor_id ④좌표·충돌(office_layout colliders AABB/polygon) ⑤속도 제한 ⑥권한(spawn/zone) ⑦좌석 점유 충돌 ⑧회의실 정원
  - 실패 시 서버 권위 위치 되돌림(reconcile), 예측 >0.5m 차 → Lerp 5프레임 보정
- **완료 조건**:
  - 벽/유리벽 통과·속도 초과·권한 없는 zone 진입 거부 테스트
  - reconcile 정합, `world_update{server_seq, players[delta]}` 20Hz 송신

### [ ] P3-T3: 근접 상호작용 검증 8항목 (LOS 광선 포함) [신규] — 🔴미구현 (Colyseus 서버 부재)

- **담당**: backend-specialist(Node/TS)
- **의존**: P3-T2
- **산출물**:
  - `interact_request` 8항목 검증(15 §5): company/office/floor 일치 · 거리<5m · **벽/유리벽 LOS 광선(가림 시 불가)** · 상대 status≠offline · 쿨다운 1초 · 방해금지/집중모드 미활성
- **완료 조건**:
  - 유리벽 뒤 상대 근접 차단(LOS), 쿨다운·집중모드 존중
  - 근접 메뉴 응답 <200ms(D22)

### [ ] P3-T4: 아바타 GLTF + 애니메이션 + 깊이합성 렌더 [신규] — 🟡부분 (v8.0 리깅+애니 통합 완료 — Colyseus 의존 부분만 미구현)

- **담당**: 3d-engine-specialist
- **의존**: P3-T1, P2-T3
- **산출물**:
  - 아바타 GLTF + idle/walk 애니, R3F 멀티유저 인스턴싱
  - 깊이합성: 아바타 프래그먼트 vs office_depth 비교(가구·유리벽 뒤 자연 가림), Lerp 보간 이동(design §6)
  - 머리 위 이름+상태 HUD 라벨(반투명 pill)
- **완료 조건**:
  - 멀티유저 아바타 이동 부드러움(Lerp), 깊이합성 오클루전 정확
  - HUD 빌보드 유지, 20명 렌더 프레임 예산 확인

### [ ] P3-T5: presence 배치 push 배선 (Colyseus → FastAPI → DB) [배선] — 🔴미구현 (Colyseus 서버 부재)

- **담당**: backend-specialist
- **의존**: P3-T2
- **산출물**:
  - Colyseus 메모리 권위 → 1~5초 주기 변경분 → FastAPI `POST /api/presence/batch` → DB(D3)
  - 자동전이: 좌석도착→working, 회의입장→meeting, 5분 무입력→away(서버 타이머), 로그아웃→offline + 좌석 자동반납
  - **재사용**: FastAPI `presence_store`/`presence_stream` 존재(구현됨) → 배치 엔드포인트 연결·보강
- **완료 조건**:
  - presence DB 반영(±1m), 자동전이 D13 상태전이표 통과
  - 재접속 `last_seq` 스냅샷 재수신

### [ ] P3-V: 실시간 이동서버 통합 검증

- **담당**: test-specialist
- **의존**: P3-T1 ~ P3-T5
- **산출물**: `docs/verification/phase-3-report.md`
- **수용기준**:
  - 멀티유저 이동·좌표동기화 20Hz, 이동검증 8·근접검증 8 통과
  - 깊이합성 아바타 오클루전 정확, presence DB 배치 push 반영
  - 성능: 아바타 E2E p95 <500ms, 도그푸딩 20명(설계 100명) — 부하검증은 P7

---

## Phase 4: 프레즌스 · 좌석 (실시간 시각화)

> **목적**: 7종 상태 HUD·미니맵·우패널 실시간 시각화, 자율좌석 클릭 점유/반납. 백엔드 좌석·프레즌스 존재분을 실시간 UI에 배선.
> **산출물**: presence 라이브 시각화 + 미니맵 + 좌석 클릭 상호작용.
> **의존**: P3 완료(이동·presence). 순차 원칙.
> **재사용**: 좌석(`/api/seats`)·프레즌스 API + presence 7종(D13) 백엔드 구현됨.

### [ ] P4-T1: 7종 상태 HUD + 우패널 실시간 프레즌스 [배선] — 🟡부분 (StatusBadge 있음, 실시간 아님)

- **담당**: frontend-specialist
- **의존**: P3-T4, P3-T5
- **산출물**:
  - 아바타 HUD 상태 점 + 우패널 사용자 목록 실시간(presence_event 구독)
  - 상태 7종 색(online/meeting/external/focus/away/offline, D13/design §1.3)
- **완료 조건**:
  - presence 변경 시 HUD·우패널 실시간 갱신, 색+라벨 병기
  - "회의중 N명·접속중 N명" 카운트

### [ ] P4-T2: 미니맵 (조감 + 컬러 점 아바타/회의실) [신규] — 🟡부분 (하드코딩 가짜 아바타 점)

- **담당**: frontend-specialist + 3d-engine-specialist
- **의존**: P3-T4
- **산출물**:
  - `frontend/components/viewport/Minimap.tsx` — 좌하단 오버레이 카드, 조감 라인 + 컬러 점(아바타/회의실), 확대/축소(design §4)
- **완료 조건**:
  - 아바타 위치 실시간 반영, 회의실 점유 색점, 클릭 시 카메라 팬(§6)

### [ ] P4-T3: 자율좌석 클릭 점유/반납 [배선] — 🟡부분 (백엔드 ✅, 3D 클릭 UX 미구현)

- **담당**: frontend-specialist + backend-specialist
- **의존**: P3-T2
- **산출물**:
  - 좌석 클릭 → Colyseus `sit_request{seat_id}` → FastAPI 좌석 점유 위임(구현됨 `/api/seats`) → working·facing
  - 로그아웃/이석 시 자동 반납(P3-T5 연동)
- **완료 조건**:
  - 좌석 점유 배타성(충돌 방지), 반납 정확성, 점유 시 status=working 전이

### [ ] P4-V: 프레즌스 · 좌석 통합 검증

- **담당**: test-specialist
- **의존**: P4-T1 ~ P4-T3
- **산출물**: `docs/verification/phase-4-report.md`
- **수용기준**:
  - 7종 상태 실시간 HUD·우패널·미니맵 반영
  - 좌석 클릭 점유/반납 E2E, 점유 배타성·자동반납 통과

---

## Phase 5: 회의 · 화상 (D24 명시입장 + LiveKit)

> **목적**: 회의실 근접(2m 트리거) 명시적 입장(D24), LiveKit 오디오/영상, 동의 배너(consent 구현됨), 화상 타일 UI.
> **산출물**: 회의 입장 흐름 + LiveKit 통합 + 화상 타일 그리드 + 동의 배너 배선.
> **의존**: P4 완료(프레즌스·좌석). 순차 원칙.
> **재사용**: 회의 API(`/api/meetings`)·consent(`/api/consent`, `backend/app/api/consent.py`)·wa_livekit·egress·meeting_minutes 백엔드 구현됨 → LiveKit 실미디어 배선·프런트 중심.

### [ ] P5-T1: 회의실 명시입장 (2m 근접 트리거 + 동의 배너) [배선] — 🟡부분 (백엔드 join/consent ✅, 2m 근접 트리거는 이동서버 의존 → 미구현)

- **담당**: frontend-specialist + backend-specialist
- **의존**: P4-T1, P3-T3
- **산출물**:
  - 회의실 2m 근접 트리거 → 명시입장 다이얼로그(자동 접속 금지, D24) → 클릭 → LiveKit 토큰 발급
  - 동의 배너: 녹음·STT 고지·동의(consent 구현됨 — `backend/app/api/consent.py`) 확인 후 입장
  - Colyseus `enter_meeting{room_id}` 근접·정원 검증 → FastAPI join + LiveKit 토큰
- **완료 조건**:
  - 명시입장 흐름(다이얼로그→클릭→토큰), 동의 거부 시 미수집(D20)
  - 정원 초과·중복 진입 거부, status=meeting 전이

### [ ] P5-T2: LiveKit 오디오/영상 통합 (실미디어) [배선] — 🔴미구현 (정본 `/api/meetings/{id}/livekit-token` 부재, legacy `/api/wa/livekit-token`만; 프론트 MediaBar 비기능)

- **담당**: backend-specialist(인프라 겸임)
- **의존**: P5-T1
- **산출물**:
  - LiveKit + coturn self-host(사내 VM, D21), `livekit.yaml`(Let's Encrypt/Caddy TLS)
  - FastAPI 경유 룸 생성/삭제(구현분 `wa_livekit.py` → `livekit_client` 정리), 토큰 발급
  - ≤4명 PeerJS 폴백 옵션 / >4명·회의실 LiveKit(15 §1)
- **완료 조건**:
  - `docker-compose up` 성공, health check, 오디오/영상 송수신
  - 음성 지연 <200ms(사내망, D22)

### [ ] P5-T3: 화상 타일 UI (참석자 그리드 + 미디어바) [신규] — 🟡부분 (mock 참석자)

- **담당**: frontend-specialist
- **의존**: P5-T2
- **산출물**:
  - `frontend/components/meeting/{VideoTileGrid,MediaBar}.tsx` — 참석자 2×2 그리드, 타일 하단 이름·상태, 컨트롤(마이크·카메라·화면공유·나가기 빨강)(design §4)
  - 뷰포트 하단 중앙 미디어 컨트롤 필 바
- **완료 조건**:
  - 자신+상대 비디오 표시(2명 기준), 마이크/카메라 토글·음소거 색 구분
  - 회의실 헤더 라벨("대회의실 · N명 회의중")

### [ ] P5-V: 회의 · 화상 통합 검증

- **담당**: test-specialist
- **의존**: P5-T1 ~ P5-T3
- **산출물**: `docs/verification/phase-5-report.md`
- **수용기준**:
  - 근접(2m)→명시입장(D24)→동의→화상 참석 E2E, FastAPI 경유 룸 생성/해제 정상
  - 참석자 2명 비디오/오디오 송수신, 음성 지연 <200ms
  - 동의 거부자 미수집(D20)

---

## Phase 6: STT · AI (외부 의존)

> **목적**: LiveKit Egress → 한국어 STT → 회의록 초안, AI 요약. KPI AI 초안(배선됨). 외부 리소스(한국어 화자분리 STT, 실 LiveKit Egress, Claude) 의존.
> **산출물**: STT 회의록 파이프라인 + 검토·확정 UI + KPI 워크플로우 화면.
> **의존**: P5 완료(회의·Egress). 순차 원칙 + 외부 리소스 준비.
> **재사용**: `egress_service`·`meeting_minutes`·`ai_draft`·`kpi_engine`·`pseudonymize`·`eod_push`·`scheduler` 백엔드 구현됨(pytest 417+).

### [ ] P6-T1: 회의 오디오 Egress 수집 + STT + 화자분리 회의록 초안 [배선] — 🔴미구현 (`meeting_minutes.py` 501 스텁, 외부의존)

- **담당**: backend-specialist
- **의존**: P5-T2
- **산출물**:
  - Egress 트랙별 오디오 수집(구현분 `egress_service.py`) → 한국어 STT 엔진 연동 → 화자분리 → 회의록 초안 + 액션아이템 후보
  - 외부 전송 가명화(실명→사번, `pseudonymize.py` 구현됨, D20)
  - 녹음 원본 보존 90일·동의 거부자 미수집(D20)
- **완료 조건**:
  - Egress→STT→발화자별 텍스트+액션아이템 초안 자동 생성
  - **폴백**: STT 실패 시 수동 회의록 + AI 요약 격하

### [ ] P6-T2: 회의록 초안 검토·확정 UI + 정확도 측정 [신규 UI + 배선] — 🟡부분 (`/meetings` 회의록/액션 UI 있음, STT 정확도측정 미구현)

- **담당**: frontend-specialist + backend-specialist
- **의존**: P6-T1
- **산출물**:
  - `frontend/app/(protected)/meetings/[id]/minute-review/page.tsx`, `frontend/components/MinuteDraftEditor.tsx`
  - API: `/api/meeting-minutes` 확정(구현분 `meeting_minutes.py`) — 발화자별 초안 편집→확정본 저장
  - 정확도: 테스트 회의 N회 수동 전사 대조(발화자·액션아이템 누락률, D22)
- **완료 조건**:
  - 초안 편집→확정 저장, 누락률 <5%(수동 전사 대조, D22)

### [ ] P6-T3: 회의록 AI 요약 [배선] — 🔴미구현 (`ai_summary` 컬럼만)

- **담당**: backend-specialist
- **의존**: P6-T2
- **산출물**:
  - 회의 종료 후 요약 생성(구현분 `ai_draft.py` 계열 활용) → MeetingMinute.ai_summary
- **완료 조건**:
  - 요약 100~300자 생성, Claude 기본, 오류 처리

### [ ] P6-T4: KPI 워크플로우 화면 (관리자 검토 + 이의신청 상태머신) [신규 UI + 배선] — ✅구현 (`/admin/kpi`, `/admin/kpi/objections`, `/kpi/objection`)

- **담당**: frontend-specialist + backend-specialist
- **의존**: P1-T4
- **산출물**:
  - 관리자 검토: `frontend/app/(protected)/kpi-review/page.tsx`, `<KpiReviewCard>`(AI 초안 표시 + 점수 조정 슬라이더 + 메모)
  - 직원 열람 + 이의신청: `frontend/app/(protected)/kpi-results/page.tsx`, `<KpiSelfReview>`
  - **이의신청 상태머신**(D15 정본): objection_status none→submitted(7일)→reviewing→resolved → 확정 시 ERP 재push
  - **재사용**: 결정론적 KPI 산출(`kpi_engine.py`)·AI 서술 초안(`ai_draft.py`)·검토/조정 API·EOD/ERP push(`eod_push.py`)·야간 배치(`scheduler.py`) 구현됨(배선됨). 14 §2.8.2 위임분.
- **완료 조건**:
  - 관리자 점수 조정·메모 저장(admin/leader 권한), AI 서술 초안 표시
  - 이의신청 전이(none→submitted→reviewing→resolved, 7일 창) 유효성, 확정 후 final_score만 ERP 재push(D15)

### [ ] P6-V: STT · AI · KPI 워크플로우 통합 검증

- **담당**: test-specialist
- **의존**: P6-T1 ~ P6-T4
- **산출물**: `docs/verification/phase-6-report.md`
- **수용기준**:
  - Egress→STT→회의록 초안→검토·확정 E2E, 누락률 <5%
  - AI 요약 생성, KPI 관리자 검토·이의신청 상태머신 E2E(D15)
  - 결정론적 KPI 산출(D14) + ERP push 폐쇄루프

---

## Phase 7: 정리 · 부하 · 하드닝 (도그푸딩 릴리스)

> **목적**: 구 스택 잔재 제거, 다층 렌더, 20명 부하검증, 보안 하드닝, 편집기→재렌더 루프. 사내 도그푸딩 릴리스.
> **산출물**: WA 스택 제거 + 다층 배경 렌더 + 부하검증 + 하드닝 + 배치 편집기.
> **의존**: P1~P6 완료.
> **정본**: 16 §B.3(정리 대상), 15 §7(부하), onprem-docker.

### [ ] P7-T1: 구 WA/Godot 스택 정리 [신규] — 🔴미구현 (`/api/wa/*`·`oidc.py`·`map_generator`·docker-compose WA 잔존)

- **담당**: backend-specialist(인프라 겸임)
- **의존**: P5(LiveKit 유지 확인)
- **산출물**:
  - docker WA 스택 제거(wa-back/play/map-storage/uploader/icon/redis), WA OIDC 브리지·Sidebar "가상 오피스 입장" 외부링크·관련 Caddy 라우팅 제거(16 §B.3)
  - `wa_livekit.py`/`wa_presence.py` → D27 명칭·경로로 정리
- **완료 조건**:
  - WA 컨테이너·라우팅 잔재 0, Colyseus/LiveKit만 잔존
  - 회귀 테스트 통과(기존 pytest 417+ 유지)

### [ ] P7-T2: 다층 렌더 + 층 전환 UI [신규] — 🔴미구현 (다층/편집기 재렌더 미구현)

- **담당**: 3d-engine-specialist + frontend-specialist
- **의존**: P2-T3, P4-T1
- **산출물**:
  - 다층 배경/깊이 렌더(층별 office_bg/depth/camera), 층 선택기(4F/3F/2F/1F/B1F 세로 탭, design §4)
  - 층 전환 크로스페이드(§6), Colyseus 룸=층 스왑
- **완료 조건**:
  - 3층 이상 층 전환, 전환 로딩 <2초, 층 간 이동·룸 스왑 정합

### [ ] P7-T3: 배치 편집기 → 재렌더 루프 (2D 편집 + 배포) [신규] — 🔴미구현 (편집기 재렌더 루프 미구현)

- **담당**: frontend-specialist + backend-specialist
- **의존**: P2-T1, P7-T2
- **산출물**:
  - office_layout 2D 편집 UI(Konva) → 저장 → 검증(D12, `office_layout_validator.py` 구현됨) → 배포 → **Blender 재렌더 트리거**(P2 파이프라인) → 뷰포트/Colyseus `layout_updated` 재로드
  - **재사용**: office_layouts API·검증기 구현됨
- **완료 조건**:
  - 편집→저장→검증(ERROR 0)→배포→재렌더→뷰포트 반영 E2E
  - 롤백(이전 버전) 성공

### [ ] P7-T4: 20명 부하검증 [신규] — 🔴미구현 (부하검증 미시행)

- **담당**: test-specialist
- **의존**: P3-V, P5-V
- **산출물**:
  - 20명 동시 이동 시뮬레이션(15 §7), tick 20Hz 유지·E2E p95 <500ms 측정
  - LiveKit 회의 동시성 측정
- **완료 조건**:
  - 20명(도그푸딩) tick 20Hz 유지, p95 <500ms, CPU/메모리 여유 리포트

### [ ] P7-T5: 보안 하드닝 + 관측 + 알림 [신규 + 배선] — 🔴미구현 (보안 하드닝 미완)

- **담당**: backend-specialist(인프라 겸임)
- **의존**: P7-T1
- **산출물**:
  - Caddy 단일 진입(Let's Encrypt TLS), rate-limit/fail2ban/포트 최소화(onprem-docker §3.3)
  - 관측: Grafana + Prometheus + Loki + Uptime Kuma, ERP sync/KPI push 실패 알림 채널 1개(D18/D21)
  - **재사용**: audit_log(`audit.py`)·ERP sync(`erp_sync.py`) 구현됨 → 알림 훅 연결
- **완료 조건**:
  - onprem §3.3 체크리스트 전 항목(인터넷 공개 배포 게이트)
  - 실패 주입 시 알림 발송·재시도 큐 동작

### [ ] P7-T6: 도그푸딩 피드백 수집 [신규] — 🔴미구현 (피드백 수집 UI 미구현)

- **담당**: frontend-specialist + backend-specialist
- **의존**: P1-V
- **산출물**:
  - `POST /api/feedback`(type[bug|feature|general]…), `frontend/app/(protected)/feedback/page.tsx`, 주 1회 리뷰 루틴(01-prd 사용성 기준)
- **완료 조건**:
  - 제출→조회→관리자 열람 E2E, 주간 피드백 리포트 집계

### [ ] P7-V: 정리 · 부하 · 하드닝 통합 검증 (도그푸딩 릴리스 게이트)

- **담당**: test-specialist
- **의존**: P7-T1 ~ P7-T6
- **산출물**: `docs/verification/phase-7-report.md`
- **수용기준**:
  - WA 스택 잔재 0, 다층 전환 성공, 편집기→재렌더 루프 E2E
  - 20명 부하 tick 20Hz·p95 <500ms, 하드닝(§3.3)·관측·알림 동작
  - 도그푸딩 피드백 수집 동작 → **사내 인터넷 공개 배포 게이트 통과**

---

## 교차 참조 및 의존성 요약

### 문서 계층 구조 (D27 정본)
```
00-decisions.md §H(D27) ── 최우선 정본
  ├→ 14-virtual-office-spec.md (기능 스펙)
  ├→ 15-realtime-server-spec.md (Colyseus 이동서버)
  ├→ 16-render-spike-and-roadmap.md §Part B (P0~P7 편성 정본)
  ├→ 3d-design/design-style-analysis.md (셸 UI·디자인 토큰·아트 디렉션)
  ├→ 3d-design/photoreal-web-strategy.md (렌더 파이프라인)
  ├→ 04-data-model.md §2.5/§2.7 (좌석·프레즌스·공지)
  └→ 12-tasks.md (본 문서)
```

### 규모 표기 (주 단위 확정 보류)

> **주 단위 기간은 스파이크·초기 P1~P2 실측 후 확정**(억지 숫자 금지). 구 45주/58주 간트 폐기. 아래는 상대 규모(S/M/L)만 제시.

| Phase | 범위 | 상대 규모 | 의존 | 신규/재사용 |
|-------|------|:---:|------|------|
| P0 | 깊이합성 스파이크 | — | 없음 | ✅ **PASS(2026-07-08)** |
| P1 | 셸 + 데이터 연결 | M | P0 | 신규 UI + 백엔드 대부분 재사용 |
| P2 | 렌더 파이프라인 | L | P0·P1 | 신규(Blender 파라메트릭) |
| P3 | 이동서버(Colyseus) | L | P2 | 신규(Colyseus) + presence 재사용 |
| P4 | 프레즌스·좌석 | M | P3 | 배선(백엔드 재사용) |
| P5 | 회의·화상 | M | P4 | LiveKit 배선 + consent 재사용 |
| P6 | STT·AI·KPI 워크플로우 | M | P5 + 외부 리소스 | STT 외부의존 + KPI 엔진 재사용 |
| P7 | 정리·부하·하드닝 | M | P1~P6 | 정리 + 신규 다층/부하 |

### Phase 간 의존성 (순차 원칙, R7)

- **P0 완료(✅ PASS) → P1 시작** (셸 착수)
- P1 완료 → P2 시작 (뷰포트 placeholder에 배경 주입)
- P2 완료 → P3 시작 (배경/깊이 위 아바타 깊이합성)
- P3 완료 → P4 시작 (이동·presence 위 시각화)
- P4 완료 → P5 시작 (프레즌스 위 회의 근접)
- P5 완료 → P6 시작 (회의·Egress 위 STT)
- P1~P6 완료 → P7 시작 (정리·부하·하드닝)

---

## Open Questions & Assumptions

### Open Questions
- 한국어 화자분리 STT 엔진 선정(외부 의존, P6 착수 전 확정 필요).
- 실 ERP DB 접근·ERP dev 브랜치(`feature/virtual-office-integration`) 착수 타이밍(KPI push 폐쇄루프, P6).
- Blender 렌더 파이프라인 CI 자동화 범위(수동 배치 vs 배포 트리거 재렌더, P2/P7-T3).
- 100명 설계 부하 검증 시점(도그푸딩 20명 이후, P7 후).

> 확정 종결: 실시간 이동서버=**Colyseus 이식**(D27, 20Hz), 렌더=**Blender Cycles 오프라인 + R3F 깊이합성**(D27), 인증=**단일 세션 JWT**(콘솔 JWT 그대로 3D 진입, 별도 OIDC 없음), 회의 입장=**명시적 확인**(D24), LiveKit=**사내 VM self-host**(D21).

### Assumptions
- 단일 회사(company_id=1) 기준, 멀티테넌트 로직 미포함(B2B는 P7 이후).
- Phase는 순차 빌드(1인 개발, 병렬화 없음, R7).
- 백엔드 도메인(ERP sync·좌석·회의·KPI 엔진·consent·EOD·work-log·감사)은 **구현됨(pytest 417+)** — Phase 태스크는 배선·프런트·신규 스택(Colyseus/Blender/R3F) 중심.
- 고정 아이소메트릭 2.5D 시점(자유시점 풀3D 배제, D27).

### Validation Criteria (모든 Phase)
- P0: ✅ 깊이합성 오클루전 게이트 PASS(2026-07-08, commit `b4736b1`).
- P1~P7: 각 Phase 마지막 Verification(V) 태스크 통과. P7-V = 도그푸딩 인터넷 공개 배포 게이트.

---

## Loop Metadata

### Upstream Documents Referenced (D27 정본)
- `00-decisions.md` §H(D27): 정본 결정 로그 — 최우선 기준
- `14-virtual-office-spec.md`: 가상오피스 기능 스펙(D27)
- `15-realtime-server-spec.md`: Colyseus 이동서버 스펙(프로토콜·검증 8+8·SLA)
- `16-render-spike-and-roadmap.md` §Part B: P0~P7 편성 정본
- `3d-design/design-style-analysis.md`: 통합 셸 UI·디자인 토큰·아트 디렉션
- `3d-design/photoreal-web-strategy.md`: 렌더 파이프라인 전략
- `04-data-model.md` §2.5/§2.7: 좌석·프레즌스·공지(announcement)
- `08-kpi-logic.md`: KPI 산출 규칙(결정론, 반감시)
- `13-risks-open-questions.md`: 1인 개발 리스크(R7 순차)

### Downstream Documents Affected
- `specs/screens/virtual-office-3d.yaml` v3.0(D27 반영)
- `06-screens.md`(셸 3카드·공지·KPI 워크플로우 화면)
- `10-roadmap.md`(주 단위 재산정 — 스파이크 결과 반영)
- API 명세(공지·presence batch·LiveKit), 배포 가이드(Colyseus/LiveKit docker, Caddy)

### Risks (D27)
- **R1(신규)**: Blender 파라메트릭 렌더 파이프라인 자동화 난이도 + 렌더 시간(P2).
- **R2(신규)**: R3F 깊이합성 정밀도 다층·다양 레이아웃 일반화(P2·P3).
- **R3(신규)**: Colyseus 이동서버 신규 구축량(검증된 SkyOffice MIT 패턴이라 난이도보다 실행량, 15 §9).
- **R4**: 한국어 화자분리 STT 품질·외부 의존(P6, 폴백=수동+AI 요약).
- **R5**: LiveKit self-host 운영·확장(사내 OK, B2B 재검토).

### Success Metrics
- P0: ✅ 깊이합성 오클루전 게이트 PASS.
- P1: 시안 셸 픽셀 재현 + 실데이터 배선.
- P2: office_layout→배경/깊이 자동생성 + 뷰포트 표시.
- P3: 멀티유저 이동 20Hz + 깊이합성 아바타, p95 <500ms.
- P6: STT 회의록 누락률 <5%, KPI ERP push 폐쇄루프.
- P7: 20명 부하 tick 20Hz 유지, 도그푸딩 만족도 ≥ 4.5/5.

---

**Last Updated**: 2026-07-09 (v3.0 — D27 포토리얼 웹임베드 전환 재작성, Godot/WA 태스크 전량 폐기·P0~P7 재편)
**Author**: Documentation Specialist (Claude Code)
**Status**: Draft → Ready for P1 Kickoff (P0 PASS)
