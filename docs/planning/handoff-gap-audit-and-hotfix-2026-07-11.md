# 핸드오프 — 구현 전수조사 + 실버그/문서정합 핫픽스 (2026-07-11)

> 다음 작업자가 **재조사 없이 바로 이어받도록** 이번 세션의 전수조사 결과·핫픽스·미커밋 상태·다음 액션을 정리한 인수인계 문서.
> 선행 핸드오프 = `handoff-v10-integration-2026-07-11.md`(v10 PBR 에셋 통합). 정본 결정 = `00-decisions.md §I(D28.2)`.
> 브랜치 = `fix/remove-wa-link-and-login-active`. 이번 세션 변경은 **전부 미커밋**(리더 직접 검토 대기).

## 0. 한눈에 요약

- **한 일**: ① 기획문서 전체 대비 **구현 전수조사**(백엔드 22테이블·17 API모듈·~445테스트 + 프론트 15화면 실측) → 갭 리포트 확정. ② `/orchestrate` **반자동화**로 "실버그+문서정합" 스코프 처리(전문가 3인 병렬 + 리더 직접 1건).
- **핵심 발견**: 관리 콘솔·백엔드 도메인은 사실상 완성(~90%). **정작 제품 정체성인 "실시간 3D 가상오피스"의 실시간 계층(Colyseus 이동서버·실시간 프레즌스·LiveKit 실미디어)이 통째로 부재(~15%).**
- **이번 세션 수정(미커밋 7파일)**: KPI 스케줄러 런타임버그, 프론트 config drift·깨진 네비·stale 라벨, 마이그레이션 테스트 스테일 단언, 12-tasks/derived-gates 실측 정합.
- **검증**: 백엔드 pytest **445 passed / 0 failed 예상**(KPI 스코프 58 passed, test_migrations 2 passed 직접 확인). 프론트 **tsc 0 errors**. (`npm run build` 실전은 미실행 — /mnt/c 수 분.)
- **다음 최우선**: (a) 7파일 커밋 여부 결정, (b) **C1 실시간 이동서버(Colyseus)** — 최대 잔여 갭.

---

## 1. 이번 세션 변경 파일 (미커밋 · 7개)

| 파일 | 변경 | 검증 |
|---|---|---|
| `backend/app/services/scheduler.py` | `_kpi_batch_job`: `daily/weekly/monthly + period_key=None`(런타임 예외) → **`daily + quarterly` KST 구체 period_key**(D16 정본). docstring 정정 | KPI 58 passed |
| `backend/tests/test_kpi_engine.py` | 회귀 테스트 3건 추가(배치 예외없이 daily·quarterly upsert / period 파싱 / weekly·monthly는 여전히 ValueError) | 〃 |
| `backend/tests/test_migrations.py` | 매직넘버 `assert len(tables)==21` → **`len(Base.metadata.tables)+1`** 연동(스테일 방지) + `notice` 표본 추가 | 2 passed |
| `frontend/lib/api.ts` | `BASE_URL` 하드코딩 `:8090` → **`process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000'`** | tsc pass |
| `frontend/app/(protected)/office/page.tsx` | `/office` 좌측 네비 5종(404) → **"준비중" 비활성화**(`<span aria-disabled>`), stale 라벨 `v1.1 (리깅 전)` → `v10 PBR 리깅` | 〃 |
| `docs/planning/12-tasks.md` | **30태스크 실측 상태표기**(✅구현/🟡부분/🔴미구현/⛔D28폐기) + 상단 재정합 배너 | — |
| `docs/planning/loop/08-derived-gates.md` | **6게이트 주석**(REQ-012/013/014 D28폐기, REQ-004 미구현, REQ-006 501, REQ-015 부분) + 배너 | — |

> ⚠️ 작업 트리엔 **이전 세션의 미커밋 변경도 다수**(v10 에셋, `docs/_html/*` 재생성, `backend/app/main.py`·`models/tables.py` 등). 커밋 시 `git add .` 금지 — **위 7개만 선별 스테이징**.

### 커밋 제안 (원할 때)
```bash
git add backend/app/services/scheduler.py backend/tests/test_kpi_engine.py \
        backend/tests/test_migrations.py frontend/lib/api.ts \
        "frontend/app/(protected)/office/page.tsx" \
        docs/planning/12-tasks.md docs/planning/loop/08-derived-gates.md
git commit -m "fix: KPI 스케줄러 daily/quarterly + 프론트 config·네비·라벨 + 문서 실측정합"
```

---

## 2. 검증 재현 (그대로 복붙)

```bash
# 백엔드 (⚠️ PATH python 아님 — 전용 venv 사용)
cd backend
./.venv/Scripts/python.exe -m pytest tests/test_kpi_engine.py tests/test_migrations.py -q
# 기대: KPI/마이그 테스트 all pass. 전체: ./.venv/Scripts/python.exe -m pytest -q → 445 passed 예상

# 프론트 타입
cd frontend && npx tsc --noEmit         # 기대: 0 errors
# (선택) 실전 빌드: npm run build  (npm 전용, pnpm 금지, /mnt/c 수 분)
```

---

## 3. 전수조사 결과 — 기획문서 대비 구현 갭 (정본 스냅샷)

> 방법: 백엔드/프론트 실측 인벤토리 × 기획(14-spec §2·12-tasks·derived-gates REQ-001~016·06-screens·08-kpi·09-realtime·04-data-model). 상태: ✅구현 / 🟡부분 / 🔴미구현 / 👻문서드리프트.

### 3.1 🔴 Critical — 핵심 미구현 (실시간 계층, 대부분 C1이 뿌리)
| ID | 갭 | 근거 | 실측 증거 |
|---|---|---|---|
| **C1** | **실시간 이동서버(Colyseus) 전체 부재** | REQ-004·09-realtime | 서버 디렉토리·package.json 자체 없음. 20Hz tick·이동검증8·근접검증8(LOS)·reconnect 스냅샷 전무 |
| **C2** | 3D 아바타 실시간 이동/프레즌스 미배선 | REQ-001·14 §2.1 | 프론트 WS/Colyseus 클라이언트 0개. `OfficeViewport` 아바타=하드코딩 정적. 우패널 프레즌스=`GET /api/presence/employees` 1회성 |
| **C3** | 회의실 LiveKit 실미디어 미배선 | REQ-005·14 §2.4 | `meetings.py`에 livekit-token 엔드포인트 **없음**(정본 `/api/meetings/{id}/livekit-token` 부재). legacy `/api/wa/livekit-token`(**미인증**)만. 프론트 `MediaBar` onClick 없음 |
| **C4** | 아바타 커스터마이징 완전 부재 | 06 §3.9·04 `user_avatar` | **`user_avatar` 테이블 없음**(실측). 설정/커스터마이징 화면·프리셋 전무 |
| **C5** | 회의실 근접(2m) 명시입장 트리거 미구현 | REQ-005/D24 | 백엔드 join/consent ✅이나 2m 근접 트리거는 C1 의존 |

### 3.2 🔴 외부의존 스텁 (예상된 미완 — 코드만으론 불가)
- **STT 회의록**: `meeting_minutes.py` `POST /stt-draft` → **HTTP 501**(동의 체크 후). REQ-006/P6.
- **실 ERP write-back**: `eod_push.py:44` → `raise NotImplementedError`(엔드포인트 설정 시). 기본 `{"mock":True}`.
- **실 ERP 소스**: 기본 `MockErpReader`(5명 시드). `ERP_DATABASE_URL` 시에만 실 DB. `postgres_reader.fetch_org_groups`=`[]`(TODO).
- **AI 초안(Claude)**: `ai_draft.py` 기본 mock(`ai_draft_enabled=False`).
- **AI 회의록 요약**: `ai_summary` 컬럼만, 생성 미배선. P6-T3.

### 3.3 🟡 Partial — 구현됐으나 미흡
- `/office` mock 요소: 화상오버레이 참석자 하드코딩(`Olivia/Liam/Mia/Noah`), 미니맵 가짜 점, 헤더 검색/🔔 핸들러 없음. **(플로어셀렉터·라벨·네비는 이번 세션 일부 정리)**
- 대시보드 3카드: 실배선됐으나 `className="hidden"`로 숨김.
- 공지 모델 스펙 미달: spec의 category(system/notice/info)·published_at·expires_at·md렌더 없음(Notice=title/body/author/pinned/created_by).
- 자율좌석 3D 클릭 UX 없음(백엔드 ✅).
- 단일세션 eviction 미구현(REQ-015). 레이아웃 검증 box rotation 미지원(validator TODO).
- RBAC 전용 화면(권한 매트릭스/권한없음) 없음(게이팅 자체는 ✅).

### 3.4 🐛 실버그 — **이번 세션 4건 수정 완료**, 잔여 확인
- ✅수정: KPI 스케줄러 예외 / config drift(:8090) / `/office` 네비 404 5종 / stale 라벨 / 마이그 테스트 스테일 단언.
- 잔여(경미): `/admin/kpi/objections` 네비 고아(직접 URL만 도달). `/office-preview` 임시 페이지(배포 전 삭제 대상).

### 3.5 🔒 보안 갭 (HG-SEC / P7-T5)
- 미인증 엔드포인트: `GET /api/seats`, `POST /api/maps/*`, `GET /api/wa/presence/stream`, `POST /api/wa/presence`, `POST /api/wa/livekit-token`(**body user_id 무검증 신뢰**).
- `/oidc/token`이 `client_secret` **값 미검증**(client_id만).
- 인증 스토어 전부 in-memory(로그인 backoff·OIDC·SSE·RSA키 부팅재생성) → 단일 인스턴스 전용.

### 3.6 👻 문서 드리프트 — **이번 세션 일부 정합**
- ✅정합: `12-tasks.md`(30태스크 실측표기), `08-derived-gates.md`(D27 폐기게이트 정리).
- 잔여: **WorkAdventure 잔재 미정리**(P7-T1 — `/api/wa/*`·`oidc.py`·`map_generator`(TMJ)·`docker-compose.local.yml`). **`asset.tscn_path → gltf_path` 마이그레이션 미완**(`tables.py:1394` `tscn_path` 잔존, D28 정본은 gltf_path).

### 3.7 ✅ 잘 된 것 (재작업 불필요)
백엔드 전 도메인(ERP동기화 soft-delete·좌석/배정이력·회의 D23충돌·회의록/액션·KPI 결정론 8메트릭·이의신청 상태머신·office_layout D12 BFS도달성 검증·감사로그·EOD 멱등배치, ~445테스트). 웹 콘솔 15화면 실 API 배선. KPI 워크플로우 end-to-end. 좌석/레이아웃 에디터. 공지 end-to-end.

---

## 4. 다음 액션 (우선순위)

| 순위 | 작업 | 근거 |
|---|---|---|
| **P0** | 7파일 커밋 결정(§1.1) | 이번 세션 산출 확정 |
| **P0** | **C1 실시간 이동서버(Colyseus) 착수** — 설계 스파이크부터 | C1이 C2/C3/C5의 뿌리. 제품 정체성 |
| **P1** | `/office` mock 제거(화상오버레이·미니맵) + 3카드 hidden 처리 | "구현된 척" 오독 제거 |
| **P1** | 보안: 미인증 엔드포인트 인증 부착, OIDC client_secret 검증 | HG-SEC |
| **P2** | WA 잔재 정리(P7-T1) + `asset.tscn_path→gltf_path` 마이그레이션 | 기술부채 |
| **P2** | 아바타 커스터마이징(user_avatar 테이블+화면, C4) | 스펙 필수 |
| **Later** | STT·실ERP·LiveKit 실미디어 | 외부 리소스 확보 후 |

---

## 5. 함정 / 환경 주의

1. **백엔드 python은 PATH가 아니라 `backend/.venv/Scripts/python.exe`** (PATH python엔 pytest 없음).
2. **포트**: 백엔드 FastAPI 실제 = **8000**(docker-compose expose, uvicorn --port 8000). **8090은 제거 대상 WA/Caddy 프록시**. CORS는 `localhost:3000`만 허용(config.py).
3. **npm 전용**(pnpm 금지). `/mnt/c` 빌드·pytest 수 분 — 긴 툴콜 인내.
4. **미커밋 혼재 트리**: v10 에셋·`docs/_html/*`·`main.py`/`tables.py` 등 이전 세션 변경 보존됨 → 커밋은 항상 파일 선별.
5. **마이그레이션 규약**: `0001_initial_schema.py`가 `Base.metadata.create_all`(pre-prod, 모델 자동 반영). **첫 운영 배포 전까지** 모델 추가는 마이그레이션 별도 작성 불필요(테스트는 `Base.metadata`에 자동 연동됨). 배포 후엔 autogenerate 신규 리비전 규약.
6. 스크린샷/캔버스(3D) 육안 QA는 여전히 미수행(빌드만 통과) — 실브라우저 확인은 별도 필요.
