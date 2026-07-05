# 구현 갭 리포트 (Implementation Gap Report)

**작성**: 2026-07-05 · **기준**: `docs/planning/12-tasks.md`(86 태스크) + `docs/planning/loop/08-derived-gates.md`(REQ-001~011) 대비 **실제 코드 상태**
**방법**: 태스크 문서 체크박스(2026-07-02 기준, stale)가 아닌 **실 파일 조사** 기준. 이후 커밋(`339ec51 미구현 전 기능 구현`, `d3b4432 G008/G009 런타임 검증`)으로 백엔드가 대거 채워진 상태를 반영.
**정본 교차참조**: `loop/blocked-work-registry.md`(B-01~B-22)

---

## 요약

| 레이어 | 상태 | 근거 |
|--------|------|------|
| 백엔드 관리 API (FastAPI) | ✅ 대부분 구현 | 라우터 14 + 서비스 9 + 테스트 40+ 파일, ~297 passed |
| Godot 헤드리스 로직 슬라이스 | 🟡 로직만 | client 4 + server 3 GDScript + GUT 테스트 7 |
| Godot 3D 렌더링/에셋/UI | ❌ 전무 | GLB·씬·HUD·아바타 모델 없음 |
| 웹 관리 콘솔 (임시 바닐라 SPA) | 🟡 읽기중심 동작 | `backend/app/static/console.html` 647줄·9뷰 (`/console` 서빙) |
| 프론트엔드 (계획된 Next.js 스택 + 편집기) | ❌ 전무 | `frontend/` 없음. Konva 편집기·React Flow 조직도 없음 |
| 실시간 서버 런타임 / WSS 인프라 | ❌ 미가동 | 계약·로직만, 실행 인프라 없음 |
| LiveKit 화상 / STT 회의록 | ❌ 스텁만 | 입장 토큰 발급만, egress/stt 서비스 없음 |
| AI·ERP 라이브 연동 | 🟡 placeholder | Mock/결정론 stub만 |
| 스파이크 S1~S4 | ❌ 미실행 | `spikes/` 없음 |
| 관측/인프라 하드닝 | ❌ 미구현 | Grafana/Caddy 검증·백업 없음 |

---

## 1. ✅ 구현 완료 (백엔드 관리 API + Godot 로직 슬라이스)

**백엔드 라우터 14종** (`backend/app/api/`): auth, seats, layouts, erp, sync, realtime, presence, team_zones, org_groups, action_items, meetings, kpi, worklogs, audit
**백엔드 서비스 9종** (`backend/app/services/`): office_layout_validator, office_layout_to_godot, kpi_scoring, ai_narrative, audit_service, holidays, livekit_service, scheduler, kpi_push
→ blocked-registry G001~G010 관리 API + B-14~B-18 resolved. 계약/레드팀/architect 3레인 통과.

**Godot 헤드리스 로직** (B-01 부분해소): `godot/scenes/`(avatar, net_client, office_client, office_layout_loader) + `godot/server/`(jwt_verify, server_main, game_server) + GUT 테스트. GPU 없이 검증 가능한 로직만.

---

## 2. ❌ 누락/미구현 상세 (Phase별)

### Phase 1 · 3D 골든 샘플 (REQ-001) — 시각 부분 전무
- 없음: 로비/좌석/회의실 GLB·씬, 아바타 모델 10종·애니메이션 6종, 이름/상태 HUD, 직원정보 패널, 회의 패널, 미니맵, 로그인 씬
- 60fps·골든샘플 룩·조작 데모 증거 게이트 미충족 · 차단: GPU/GLB/에디터 런타임 (B-01)

### 프론트엔드 — 임시 콘솔은 있으나 계획된 편집기 UI가 없음 🔴 최대 갭
- **있음**: `backend/app/static/console.html`(단일 파일 바닐라 JS SPA, `/console` 동일오리진 서빙). 9뷰: 직원명부·조직도·좌석배치·레이아웃·KPI·회의·업무기록·동기화·감사로그. 로그인·Bearer 토큰·읽기 테이블 + 일부 액션(KPI adjust/confirm/이의신청, 레이아웃 deploy/rollback)은 `prompt()`/`confirm()` 기반으로 동작.
- **없음 (스펙 대비)**:
  - **Konva.js 2D 좌석/배치 편집기**(P3) — 콘솔은 배포본 평면도 **읽기 전용** 캔버스 + 버전 배포/롤백만. 드래그 편집·draft 생성·스냅 그리드·검증 ERROR 게이팅 없음 → **REQ-003 미충족**
  - **React Flow 조직도 편집기**(P7-R1-T4) — 콘솔은 읽기 테이블만
  - 계획된 **Next.js(TS)+Tailwind** 앱 자체 부재. 전용 화면(work-log 작성폼, KPI 검토 카드/슬라이더, 이의신청 상태머신 UI, dashboard, activity-feed, meetings 대기실, feedback) 미구현
→ 백엔드 API는 완비. 임시 콘솔이 읽기/기본액션을 커버하나, **편집기급 UI(REQ-003)와 세련된 검토 UX(REQ-007)는 갭.**

### Phase 4 · 실시간 서버 (REQ-004) — 런타임 미가동
- 코드 슬라이스만, 헤드리스 서버 실행·WSS 상시가동·20명 부하 p95<500ms 검증 없음 (B-02)

### Phase 5 · 화상/STT (REQ-005/006) — 스텁만
- 없음: egress_service, stt_service, minute_drafter, LiveKit 실 룸 생성, Godot 화상 렌더, STT 정확도 측정
- 있음: 입장 토큰 조건부 발급(B-07)만. stt_draft 저장 계약만, 실 STT NULL (B-09/B-10)

### Phase 6 · KPI/ERP push (REQ-007/008) — AI·ERP 실연동 없음
- 정량 KPI·이의신청·배치는 코드 완결. 실 LLM 미연동(ai_draft placeholder, B-11), 실 ERP push 미연동(Mock만, B-12/B-19 human_blocked)

### Phase 7 · 고도화
- push_notification, 피드백 API, 클라 자동업데이트(updater.gd+버전 API), ERP 실패 알림 채널, 관측 스택(Grafana/Prometheus/Loki/Uptime Kuma) 미구현

### Phase 0 스파이크 — S1~S4 전부 미실행 (`spikes/` 없음, B-04)

---

## 3. 🔒 사람 조치 대기 (human_blocked)
- B-05: ERP dailylog read-only DB 계정 미발급 (OQ10) → Mock만
- B-06: 공인 도메인 미구매 → Caddy TLS/외부공개 확정 불가
- HG-SEC/HG-BACKUP 게이트: 외부공개 하드닝·백업 복원 리허설 미완 (도그푸딩 전 필수)

---

## 4. 착수 우선순위 (현 환경=코드만 가능 기준)

1. **[1차 착수 완료 2026-07-05] 프론트엔드(Next.js 웹콘솔)** — `frontend/` 신규 부트스트랩(Next.js 14 App Router + TS + Tailwind + Konva). `npm run build`·`tsc --noEmit`·런타임 스모크(3라우트 200) 통과.
   - 구현: `/login`(JWT·401/423 잠금 안내 = HG-AUTH), `/kpi-review`(카드·AI초안·조정슬라이더·확정·이의신청 모달 = REQ-007), `/seat-editor`(Konva 2D 드래그·스냅 0.5m·**검증 ERROR 배포 게이팅** = REQ-003).
   - 후속: 직원명부·조직도(React Flow)·회의·업무기록·동기화·감사로그 화면 이관(현재 임시 console.html 커버). 실 데이터 E2E는 백엔드 기동 + 시드 후 검증 필요.
2. 3D 시각/에셋 — GPU 환경 필요 (phase_blocked)
3. 화상/STT·실시간 런타임 — LiveKit/서버 인프라 필요 (phase_blocked)
4. ERP 계정·도메인 확보 (human_blocked)
