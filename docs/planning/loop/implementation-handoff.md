# 미구현 작업 Handoff (전체 — 프론트·백엔드·3D·실시간·화상)

**작성일**: 2026-07-03
**목적**: 승인 기획(58주, Phase 0~7) 대비 **실제 구현 현황**과 **남은 전 작업**을 한 문서로 재개 가능하게 정리한다.
**정본 참조(SSOT)**: `docs/planning/00-decisions.md`(D1~D25) · `01-prd.md` · `10-roadmap.md` · `12-tasks.md`(태스크 ID) · `06-screens.md`(웹 화면) · `specs/screens/*.yaml` · `specs/shared/*.yaml` · `docs/data-model/office-layout-schema.json`
**관련 문서**: `blocked-work-registry.md`(환경/사람 차단 B-01~B-22) · `ultragoal-handoff.md`(백엔드 관리 API 구현 이력)
**🎨 디자인 목표 퀄리티(정본 레퍼런스)**: `design/screens/virtual-office-3d-reference.md` (+ 원본 시안 `design/screens/virtual-office-3d-reference.png`) — 실사급 3D 아이소메트릭 오피스 + 다크테마 글래스모피즘 HUD + 인앱 화상. Phase 1 골든샘플·HUD·디자인토큰의 **아트/UX 기준**.

> **한 줄 요약**: 태스크 86개 중 실질 완료는 **백엔드 관리 API + 계약/설계**뿐. **웹 프론트엔드(Next.js) 전체와 Godot 3D 클라·실시간 서버·화상/STT는 미구현**이다. 그동안의 "완료" 보고는 백엔드 API 범위였다.

---

## 0. 현재 구현 현황 스냅샷 (재작업 금지 — 이미 있음)

### ✅ 실제 구현·테스트 통과 (백엔드)
| 영역 | 산출물 | 위치 | 상태 |
|---|---|---|---|
| 관리 API 라우터 9종 | auth, erp(직원명부), seats, layouts, meetings, work-logs, kpi, sync, audit | `backend/app/api/*.py` | ✅ 341 테스트 통과 |
| 레이아웃 검증(D12) | JSON Schema + 의미/도달성/성능 파생 | `backend/app/services/office_layout_validator.py` | ✅ |
| 서비스 | kpi_scoring, scheduler(APScheduler·미발화), audit_service, holidays, livekit_service(토큰) | `backend/app/services/*.py` | ✅(일부 stub) |
| 인증/보안 | JWT HS256, bcrypt, 계정잠금, rate-limit 준비 | `backend/app/core/*.py`, `config.py` | ✅ |
| DB | Alembic 0001, 모델 21테이블 | `backend/alembic/`, `models/tables.py` | ✅ |
| 배포 | Docker Compose(사내 서버, Caddy) | `docker-compose.yml`, `docs/deployment/` | ✅ 설정 |

### ⚠️ 코드만 존재·실행 미검증 (Godot — GPU/에디터 부재)
| 산출물 | 위치 | 상태 |
|---|---|---|
| 아바타 이동/충돌/좌석/근접/A* | `godot/scenes/avatar.gd` | ⚠️ GUT 테스트 작성, **렌더 미검증** |
| office_layout 로더(3D 씬+nav 파생) | `godot/scenes/office_layout_loader.gd` | ⚠️ 정적 검증만 |
| OfficeClient(로드→스폰→백엔드 페치) | `godot/scenes/office_client.gd` | ⚠️ 정적 검증만 |
| JWT HS256 검증기 | `godot/server/jwt_verify.gd` | ⚠️ |

### 🆕 임시 산출물 (정식 아님)
| 산출물 | 위치 | 비고 |
|---|---|---|
| 정적 관리 콘솔(로그인+직원명부+레이아웃 2D 등) | `backend/app/static/console.html` | **임시** — 정식 Next.js 아님. 데모/확인용 |

---

## 1. 미구현 작업 — 영역별 (재개 단위)

> 우선순위 표기: 🔴=핵심경로(제품 성립 필수) · 🟠=주요 · 🟡=고도화
> 차단 표기: [ENV]=환경(GPU/서버/엔진) · [HUMAN]=사람 조치(계정·도메인) · [READY]=지금 착수 가능

### A. 🔴 웹 프론트엔드 (Next.js) — **전체 미구현** [READY]
정본: `06-screens.md`, `specs/screens/*.yaml`, `specs/shared/{components,rbac,types}.yaml`, 11-tech-stack
스택: Next.js(App Router)+TypeScript+TailwindCSS, Konva.js(좌석2D), React Flow(조직도)
**🎨 디자인 언어**: `design/screens/virtual-office-3d-reference.md` §7 토큰(다크테마·블루 액센트·글래스모피즘·상태색)을 웹 콘솔에도 일관 적용 — 3D 클라와 브랜딩 통일. 임시 `console.html`이 톤 참고용(정식 대체 아님).

- [ ] **A0. Next.js 앱 스캐폴드** — `frontend/` 신설(package.json, App Router, Tailwind, tsconfig), API 클라이언트(JWT 저장/자동 refresh/401 session-expired), 레이아웃(사이드바+헤더), RBAC 가드(`specs/shared/rbac.yaml`)
- [ ] **A1. 로그인/세션** (`auth.yaml`, 태스크 P2-R2-T0 프론트분) — `/login`, 401 처리, 세션만료 복구, 성공 시 직원명부 랜딩
- [ ] **A2. 직원명부** (`employee-directory.yaml`) — `/admin/employees` 랜딩, 팀/상태 필터, 검색, CSV, 상세 슬라이드, 마지막 동기화 시각
- [ ] **A3. 좌석 배치 편집기** (`seat-layout-editor.yaml`, P3-R2-T1/T3) — `/admin/office-layout`, **Konva.js 2D 전용**(벽/좌석/회의실/문개구부/구역), Undo/Redo, 경량검증(범위/겹침) 즉시표시, 서버 정밀검증(D12) ERROR 배포차단, 층 단위 버전/배포/롤백, [데스크톱에서 열기(draft)]
- [ ] **A4. 조직도 편집기** (`org-chart-editor.yaml`, P7-R1-T4) — `/admin/org-chart`, **React Flow** 노드그래프(본부/부서/파트/팀), org_group CRUD(팀=리프 read-only), 순환검증
- [ ] **A5. KPI 대시보드** (`kpi-dashboard.yaml`, P6-R3-T1) — `/admin/kpi`(관리자 검토·확정)·`/kpi`(본인 열람) 라우팅 분리, AI 초안 표시, 조정·확정(final_score), ERP push 상태
- [ ] **A6. KPI 이의신청** (`kpi-objection.yaml`, P6-R3-T4) — 제출(사유필수·7일창) + 관리자 재검토, 상태머신 none→submitted→reviewing→resolved(D15)
- [ ] **A7. 회의 & 회의록** (`meetings.yaml`, P5-R2-T1/P5-R3-T2) — `/meetings`, 캘린더(일/주/월), 상세·참석자, 회의록(결정/액션/노트), STT 초안 검토·확정, 액션아이템 대시보드, 동의 배너(D20-b)
- [ ] **A8. 업무기록** (`work-log.yaml`, P6-R1-T3) — `/work-log`, 일별 기록(범주/시간/결과물/이슈), 일일 상태 리포트, 기간 요약
- [ ] **A9. 동기화 모니터링** (`sync-monitoring.yaml`, P7-R3-T3 프론트분) — `/admin/sync`, ERP동기화·EOD·KPI배치 상태 테이블, 실패이력, 수동 재시도(관리자 전용)

> ⚠️ 백엔드 API는 A2/A3/A5/A6/A7/A8/A9 전부 **이미 구현·동작** — 프론트만 붙이면 됨. A1은 백엔드 `/auth/*` 완비.

### B. 🟠 백엔드 — 남은 것
- [ ] **B1. AI KPI 서술 초안 실 생성 (Claude)** (P6-R2-T2, blocker B-11) — 현재 결정론 placeholder(`ai_draft_pending`). Claude API 연동, 실명→사번 가명화(D20). [ENV: AI 키]
- [ ] **B2. ERP 라이브 push** (P6-R3-T3a/c, blocker B-12/B-19) — daily_reports 18:00 / kpi_results 확정+분기마감 실 전송. 현재 mock. [HUMAN: OQ10 ERP DB 계정]
- [ ] **B3. ERP 라이브 read-only 접속** (blocker B-05) — `ERP_DATABASE_URL` 설정 시 `PostgresErpReader` 전환. 현재 `MockErpReader`. [HUMAN]
- [ ] **B4. 스케줄러 실 cron 발화 관측** (P6-R3-T3a/b, blocker B-16) — 배선·부팅·재시작 검증됨. 실 18:00/21:00 발화는 배포 후 관측만. [ENV: 상시 배포]
- [ ] **B5. 실시간 WSS 게이트웨이** (P4-R1-T2) — Python asyncio WebSocket 게이트웨이(아바타 이동/프레즌스 중계). Phase 4. [ENV/후속]
- [ ] **B6. presence 좌표 30일 파기 배치** (P4-R3-T3, D20-a) — 미구현.
- [ ] **B7. 감사로그 5년 보존/파기** (D20-e, Phase 2, 파괴적) — 정책 대기.

### C. 🔴 Godot 3D 클라이언트 (Phase 1 골든샘플) — **미구현** [ENV: GPU/에셋]
정본: `07-3d-visual-asset-pipeline.md`, `06-screens.md §1`, `virtual-office-3d.yaml`, 태스크 P1-*
**🎨 아트/HUD 타깃**: `design/screens/virtual-office-3d-reference.md`(실사급 PBR 3D 오피스 + 다크 HUD). C1~C7 수용기준에 **"레퍼런스 대비 시각 일치"** 추가.
- [ ] **C1. 로비/브랜드월/공개영역 모델링** (P1-S1-T1)
- [ ] **C2. 좌석영역(Open/Fixed/Free) 3D 표현** (P1-S1-T2)
- [ ] **C3. 회의실 2개 + 라운지/집중실/폰부스** (P1-S1-T3)
- [ ] **C4. 아바타 모델·애니메이션(5~10)** (P1-S1-T4)
- [ ] **C5. 이름/상태 HUD + 우측 직원정보 패널** (P1-S1-T5)
- [ ] **C6. 하단 회의패널 + 미니맵** (P1-S1-T6)
- [ ] **C7. 골든샘플 통합검증 (60fps GTX1650, 로딩<5s + 레퍼런스 시각 일치)** (P1-S1-V) [ENV]
- [ ] **C8. 로그인 씬** (`godot/scenes/ui/login.tscn`)
- [ ] **C9. 데스크톱 draft 뷰어** (P3-R2-T2, `layout_draft_viewer.tscn`)
- [ ] **C10. 클라이언트 WSS 네트워킹·원격아바타 동기화** (P4-R1-T3, blocker B-02) [ENV]
> ⚠️ 이동/충돌/좌석/근접/A*·레이아웃 로더·OfficeClient·JWT는 **코드 완성**(§0). 실 GLB 에셋·렌더·네트워킹만 남음.

### D. 🔴 실시간 서버 (Phase 4) — **미구현** [ENV]
정본: `09-realtime-collaboration.md`, `docs/api/realtime-server-api.yaml`, P4-*
- [ ] **D1. Godot 헤드리스 서버 프로젝트·에센셜 로직** (P4-R1-T1)
- [ ] **D2. 아바타 이동 권위 검증(서버)** (P4-R2-T1)
- [ ] **D3. 근접 감지·상호작용 트리거** (P4-R2-T2)
- [ ] **D4. 회의실 점유·진입/퇴장 검증** (P4-R2-T3)
- [ ] **D5. 프레즌스 동기화(위치→DB)·상태전환** (P4-R3-T1/T2)

### E. 🔴 화상회의 + STT 회의록 (Phase 5) — **토큰 stub만** [ENV]
정본: `09`, D5/D24, `_livekit-slice-brief.md`, P5-*, blocker B-03/B-09/B-10
- [ ] **E1. LiveKit + coturn self-host 설치·통합** (P5-R1-T2) — compose 스캐폴드만 존재. [ENV]
- [ ] **E2. WebRTC GDExtension 통합** (P5-R2-T2a, S1 승계) [ENV]
- [ ] **E3. 3D 내 화상 렌더링·참석자 패널** (P5-R2-T2b) [ENV]
- [ ] **E4. 오디오 Egress 수집** (P5-R4-T1) [ENV]
- [ ] **E5. STT + 화자분리 + 회의록 초안** (P5-R4-T2, D5) [ENV]
- [ ] **E6. STT 정확도 측정(누락률<5%)** (P5-R4-T3, D22) [ENV]
> ✅ 회의 입장 토큰(실 AccessToken 조건부 발급) + compose opt-in은 완료(B-07).

### F. 🟠 선행 스파이크 S1~S4 (Phase 0) — **미착수** [ENV]
- [ ] **S1. Godot↔LiveKit PoC** (P0-T0.8, 최우선) [ENV]
- [ ] **S2. STT 파이프라인 PoC** (P0-T0.9) [ENV]
- [ ] **S3. 헤드리스 서버 부하** (P0-T0.10) [ENV]
- [ ] **S4. 동적 씬 라이팅 룩 검증** (P0-T0.11) [ENV]

### G. 🟠 3D 에셋 파이프라인 — **미구현** [ENV]
정본: `07-3d-visual-asset-pipeline.md`, `docs/3d-design/asset-registry.md`
- [ ] **G1. GLB 에셋 제작(Blender)·최적화·asset 테이블 등록** — office_layout `asset_id` 참조 대상 실물.
- [ ] **G2. office_layout → Godot 씬 변환 파이프라인** (P3-R3-T2)

### H. 🟡 디자인 시스템 / 시각 목업 — **부분 해소(레퍼런스 확보)** [READY]
정본: `specs/shared/types.yaml`(design_tokens), 갭 리포트 A2-20, **`design/screens/virtual-office-3d-reference.md`(신규 시각 레퍼런스)**
- [ ] **H1. 디자인 토큰 확정** — 현재 "Tailwind 기본 테마=정본" + 상태색만. 레퍼런스 §7(다크테마·블루 액센트·상태색·라운드·글래스모피즘)을 팔레트/타이포/간격으로 구체화(또는 tokens.yaml). **웹 콘솔·3D HUD 공통 적용(브랜딩 통일)**.
- [x] **H2. 시각 목업/레퍼런스** — ✅ 3D 메인 오피스 고해상 시안 확보(`design/screens/virtual-office-3d-reference.{md,png}`). 나머지 웹 9화면 시안은 미확보(레퍼런스 토큰 기반 파생 가능).
- [x] **H3. spec ↔ 시안 델타 scope 확정** — ✅ **결정 완료**(`loop/scope-decisions-2026-07-03.md`, 00-decisions **D26~D30**): 좌측 내비 MVP=Office/Rooms/People/Chat(제한)/Settings, Phase7=Events·Whiteboard(디지털), **Files=MVP 제외**. E키 입장(D27)·플로팅 화상 HUD(D28)·People 상태 그룹핑(D29)·실사급 아트타깃(D30). `virtual-office-3d.yaml` 반영. ⏳ 후속 propagate: PRD §3 범위표·12-tasks Phase7 태스크·06-screens 서술.

### I. 🟡 DevOps / 배포 하드닝
- [ ] **I1. 외부 공개 하드닝** (P2-R4-T1, D21-r) — Caddy 단일진입/rate-limit/fail2ban. compose 일부만.
- [ ] **I2. 클라이언트 자동 업데이트 채널** (P7-R3-T2, D8)
- [ ] **I3. 공인 도메인 구매** (blocker B-06) [HUMAN]

---

## 2. 환경/사람 차단 요약 (`blocked-work-registry.md` 참조)
- **[HUMAN]**: B-05(ERP DB 계정), B-06(도메인), B-12·B-19(ERP push=B-05 종속), AI 키(B-1).
- **[ENV]**: Godot GPU/엔진(C·D·S1·S3·S4·G), LiveKit 서버·STT 엔진(E·S2).
- **[READY 즉시 착수]**: **웹 프론트엔드 전체(A)** ← 백엔드 API 완비, 디자인 토큰(H1).

---

## 3. 권장 재개 순서
1. **웹 프론트엔드(A)** — 백엔드가 이미 동작하므로 가장 빠르게 "보이는 제품" 확보. A0 스캐폴드 → A1 로그인 → A2 직원명부 → A3 좌석편집기(Konva) → A5 KPI → A7 회의 → 나머지.
2. **디자인 토큰(H1)** — A0와 함께 확정.
3. **AI 서술(B1)** — 키 확보 시. **ERP 라이브(B2/B3)** — OQ10 계정 확보 시.
4. **Godot/실시간/화상(C·D·E·S)** — GPU·LiveKit·STT 환경 확보 후. Phase 순차(1→4→5).

---

## 4. 실행 환경 규약 (필수)
```sh
# 백엔드 venv/pytest (Windows, 절대경로 필수)
PY="$(pwd)/backend/.venv/Scripts/python.exe"
cd backend && "$PY" -m pytest -q -p no:cacheprovider   # 회귀 무회귀(341 passed 기준)

# 로컬 개발 서버(SQLite, 프론트 개발용 API)
DATABASE_URL="sqlite+aiosqlite:///./dev.db" AUTO_CREATE_TABLES=true ENVIRONMENT=development \
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
#  → http://127.0.0.1:8000/docs (API), /console (임시 콘솔), 시드계정 admin@vo.local/Admin123!

# Godot(에디터/GPU 필요 — 이 환경 미가용): GUT
# godot --headless --path godot -s addons/gut/gut_cmdln.gd -gdir=res://tests -gexit
```
- 회귀 베이스라인 **341 passed / 25 skipped / 0 failed** 는 회귀 금지.
- 프론트 신규 시 `frontend/` 디렉터리 + `.gitignore`에 `node_modules/`·`.next/` (이미 있음).
- Godot 실행 불가 항목은 코드/테스트만 작성하고 **에디터 실행 검증은 사용자 몫**으로 표기.
