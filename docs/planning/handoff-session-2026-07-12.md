# 핸드오프 — handoff-gap-audit 후속 6대 태스크 실행 (2026-07-12)

> 선행 핸드오프 = `handoff-gap-audit-and-hotfix-2026-07-11.md`. 그 문서의 P0~P2 액션(§4)을 이번 세션에 **전부 실행·검증·커밋**했다.
> 브랜치 = `fix/remove-wa-link-and-login-active`. 이번 세션 산출은 **커밋 완료**(아래 §1). 리모트 push는 미실행(리더 결정 대기).

## 0. 한눈에 요약

- 선행 핸드오프의 우선순위 6건을 순서대로 처리: **① 7파일 커밋 ② /office mock 정리 ③ seats 인증+OIDC구멍 제거 ④ WA 전면제거+asset 리네임 ⑤ Colyseus 이동서버(C1) ⑥ 아바타 커스터마이징(C4)**.
- **검증**: 백엔드 pytest **264 passed / 85 skipped / 0 failed**(WA 제거로 베이스라인 446→258, 아바타로 +6=264). 프론트 **tsc 0 errors**. Colyseus **스모크 25/0 + tsc build 클린 + 라이브 부팅 성공**.
- **최대 성과**: 제품 정체성인 **실시간 이동서버(C1) 착수** — greenfield `realtime/` Colyseus 서버 최소동작(20Hz·이동검증8·근접검증8 LOS·reconnect). 3대 기술부채 중 **WA 잔재 완전 제거**.

---

## 1. 이번 세션 커밋 (7개, 브랜치 위 순서대로)

| 커밋 | 내용 | 검증 |
|---|---|---|
| `bc6e2ae` | (선행 P0) 이전 세션 7파일 실측정합 + 죽은 glb 8개 정리 | 백엔드 445 / tsc 0 |
| `c538bb1` | /office mock 정리(화상오버레이 실데이터화·미니맵 가짜점 제거·비기능버튼 준비중) | tsc 0 |
| `ebed9f2` | GET /api/seats 인증 부착 + asset.tscn_path→gltf_path 리네임 | 28 pass |
| `7b631fe` | **WorkAdventure 잔재 전면 제거**(소스8·테스트6·wa_maps·스크립트2 삭제, main.py·혼재테스트3 편집) | 258 pass, WA live-ref 0 |
| `d3afa42` | **Colyseus 이동서버(C1) 최소동작** (`realtime/` 신규) | 스모크 25/0, build 클린 |
| `ebd8bcf` | **아바타 커스터마이징(C4)** (user_avatar 모델+API+화면) | 264 pass, tsc 0 |

> ⚠️ **미커밋 보존**: 이전 세션의 `docs/_html/*` 재생성, `docs/planning/*.md` 편집, `backend/app/models/__init__.py`, `.claude/commands/orchestrate.md`, `docs/virtual_office_3d_assets_full_v1_0/*` 삭제 등은 **손대지 않고 보존**. 커밋은 항상 파일 선별(never `git add .`).

## 2. 상세 변경

### 2.1 WA 전면 제거 (P7-T1 완료)
- 삭제(소스): `wa_livekit`·`wa_presence`·`presence_stream`·`maps`·`map_generator`·`integrations/workadventure/`(oidc·presence).
- 삭제(테스트6·기타): `test_wa_*`·`test_maps_api`·`test_map_generator`, `wa_maps/`, `scripts/generate_and_upload_map`·`generate_tileset`.
- 편집: `main.py`(WA 라우터·OIDC discovery 별칭·미사용 import 제거), `test_lane_a_features`·`test_med_items`·`test_presence_store`(WA 부분만 외과 제거, 유지기능 테스트 보존).
- **보존**: `presence_store` 서비스·`Presence` 모델·LiveKit 설정·`meetings`. → Colyseus가 향후 presence writer.
- **보안 효과**: OIDC client_secret 미검증·`/api/maps` 미인증·`/api/wa/*` 미인증 구멍 **소멸**(HG-SEC 대부분 해소).

### 2.2 Colyseus 이동서버 (C1, `realtime/`)
- 스택: Colyseus 0.15.57 + @colyseus/schema 2.0.37, TS, 포트 **2567**(env `PORT`).
- `OfficeRoom`(office_id·floor_id 키, filterBy), 20Hz 틱, `OfficeState{players:Map<Player>}`.
- 이동검증 8종(범위·충돌·속도·좌석·권한 등)·근접검증 8종(거리5m·LOS 벽차단 등) 각각 순수함수. reconnect(allowReconnection+last_seq 스냅샷).
- **스텁(TODO)**: 실 레이아웃 fetch(`FloorLayoutProvider`), 실 presence push(`PresenceSink`), onAuth JWT 검증, 충돌메시, LiveKit 핸드셰이크, 20동접 부하테스트. 상세 = `realtime/README.md`.
- 실행: `cd realtime && npm i && npm run build && npm run smoke`(25/0), `npm start`(부팅).

### 2.3 아바타 커스터마이징 (C4)
- `UserAvatar` 모델(user_id PK→erp_user 1:1, preset_id·top/bottom_color·show_nameplate). 테이블 총수 **24**.
- `GET/PUT /api/avatar`(본인 전용, 색상 #RRGGBB 검증). `test_avatar` 6건.
- 프론트 `/settings` 아바타 화면(프리셋·색상 팔레트·이름표·미리보기·저장), office 좌내비 "설정" 활성화, 콘솔 Sidebar 항목 추가.

### 2.4 /office mock 정리
- 화상오버레이: 하드코딩 참석자 → `GET /api/meetings` 실 in_progress 데이터(없으면 미표시).
- 미니맵: 가짜 아바타 점 제거 → 정적 도면+준비중(실위치는 C1 연동 후).
- 헤더 검색/📅/🔔: 준비중 비활성 표기.
- 3카드 hidden 블록: 리더 의도(`복원하려면 hidden 제거`) 보존.

---

## 3. 다음 액션 (남은 갭)

| 순위 | 작업 | 근거 |
|---|---|---|
| **P0** | **C2: 프론트 Colyseus 클라이언트 배선** — `realtime/` 서버에 R3F 아바타 연결(이동/프레즌스 실시간) | C1 완료 → 다음은 클라 통합 |
| **P0** | Colyseus 스텁 실체화: `FloorLayoutProvider`(FastAPI office-layout fetch)·`PresenceSink`(POST /api/presence/batch)·onAuth JWT | realtime/README TODO |
| **P1** | **C3: LiveKit 실미디어** — `POST /api/meetings/{id}/livekit-token`(정본) 신설 + 프론트 MediaBar 배선 | WA livekit 제거됨, 정본 경로 필요 |
| **P1** | C5: 회의실 2m 근접 명시입장 트리거(Colyseus enter_meeting→클라 프롬프트→join) | C1 위에서 배선 |
| **P1** | 아바타 3D 반영: `OfficeViewport`가 user_avatar 색상/프리셋 실제 적용 | 백엔드/화면 완료, 뷰포트 배선만 남음 |
| **P2** | 공지 모델 스펙 보강(category/published_at/expires_at/md), 단일세션 eviction(REQ-015), RBAC 전용화면 | 선행 핸드오프 §3.3 |
| **Later** | STT 회의록·실 ERP write-back·AI 초안/요약 | 외부 리소스 확보 후 |

---

## 4. 함정 / 환경 (선행 핸드오프에서 계승 + 갱신)

1. 백엔드 python = `backend/.venv/Scripts/python.exe` (PATH 아님). 전체 pytest ~75s(/mnt/c).
2. 백엔드 포트 **8000**. (8090 WA/Caddy 프록시는 제거 대상 — 이번에 WA 코드 제거, docker-compose.local.yml의 wa-*/caddy 서비스 정리는 **미완**, 다음 P2).
3. npm 전용(pnpm 금지). Colyseus는 `realtime/`에서 별도 `npm i`.
4. 커밋은 항상 파일 선별. 트리에 이전 세션 미커밋 다수 보존됨.
5. **테이블 카운트 트립와이어**: `test_foundation.py::test_all_tables_registered`가 `len(Base.metadata.tables)==24` 하드코딩 — 모델 추가/삭제 시 이 숫자와 `test_migrations`(동적) 함께 확인.
6. 3D 뷰포트 육안 QA(실브라우저)는 여전히 미수행 — 빌드/타입/스모크만 통과.
7. `docker-compose.local.yml` 아직 wa-*/caddy 참조 잔존(코드는 제거됨) → 인프라 정리 필요.
