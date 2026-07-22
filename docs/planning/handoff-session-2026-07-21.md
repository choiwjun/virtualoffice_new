# 핸드오프 — 2026-07-21 세션 (UX 몰입모드 + 공간 진입점 + 에셋 방향 확정 스파이크)

> 선행: handoff-session-2026-07-17.md. 작업은 07-21 주간~07-22 새벽.
> **세션 아크**: 실화면 QA → oVice 경쟁조사 → "복잡함·시각퀄리티 낮음" 판정 → **D33 몰입모드 P0 구현**
> → "메뉴를 공간에 녹여라" → **D34 공간 진입점 Wave1~2 구현** → "에셋으로 퀄 상향 가능한가" →
> **Kenney(동급 판정)→Poly Haven+Mixamo 스파이크로 전체 파이프라인 실증**(가구·캐릭터·배치·오클루전).
> ⚠️ **전부 미커밋** — §2 참조. 다음 세션 첫 작업으로 커밋 정리 권장.

---

## §1. 완료 작업

### A. D33 — /office 몰입 모드 (P0 5건 구현·검증 완료)

- 정본: **19-office-ux-simplify-spec.md**(확정) · 00-decisions **§N D33** · 06-screens §1 D33 배너 · qa-runbook §2 체크리스트
- 구현(파일 2개): `frontend/components/OfficeShell.tsx` + `OfficeViewport2D.tsx`
  1. 사이드바 아이콘 레일(56px, /office 한정, 펼침 토글) + 우측 패널 접힘 기본(가장자리 "구성원 N" 핸들)
  2. 좌상단 배지4+미디어바+회의 오버레이 → **하단 중앙 통합 독**(뷰포트가 `dockSlot` prop으로 셸 세그먼트 주입받음. 연결=점+툴팁, 상태 메뉴 위로 열림, MediaBar는 회의 연결 시에만)
  3. 사이드바 "2F 도면" 위젯 삭제 → 층 전환은 미니맵 헤더로(접기 지원)
  4. 네임플레이트 다이어트(이름+상태점만, 본인=발밑 파란 링, "(나)"·상태텍스트 제거)
  5. 존 바닥 색면(ROOM_TINTS) + 존 라벨 호버/클릭 시만
- **실측 수용기준**: G1 캔버스 92.4%(전 55%) · G3 네임플레이트 16%(기준≤40%) · G5 호버 라벨 ✓
- 검증: tsc 0 · vitest 20/20 · 육안(이동·착석 typing 프레임 진행·재연결·테마 순환·패널 토글)

### B. D34 — 공간 진입점 Wave1~2 (메뉴 기능의 씬 통합)

- 정본: **20-office-spatial-entrypoints-spec.md** · 00-decisions **§O D34**
- 구현(OfficeViewport2D.tsx): **SpotCard** 미니 카드(상단 중앙 288px, on-demand 조회, 신규 API 0)
  - 아바타 클릭=프로필(타인)/내 업무(본인: 오늘 업무+KPI+내 자리로 걷기+**자리 비우기**)
  - 방 라벨 클릭=오늘 일정+예약(+진행중이면 ● 입장하기→onJoinMeeting D24) · Lounge는 general 채널 미리보기
  - 📌 게시판(n 0.615,0.27)=공지 · 🗂️ 서류함(n 0.263,0.35)=보고서 · 배포 존 라벨=존 카드
  - **seatPrompt는 sit 전용화**(구 release 모드는 myseat 카드 releaseSeat로 흡수)
  - 카드 액션 → D29 오버레이 창 라우팅(router.push — 씬/실시간 유지). 빈 곳 클릭 시 카드 닫힘
- 검증: tsc 0 · vitest 20/20 · 육안(게시판·내자리·Board Room·서류함 카드 + 기록추가→/work-log 오버레이 왕복 + D24 근접 프롬프트 회귀)
- **미검증 잔여**: ①타인 프로필 카드(두 번째 유저 접속 필요 — 코드 경로 동일) ②배포 레이아웃 존 카드(dev_qa는 미배포 상태)

### C. 에셋/캐릭터 스파이크 — "Poly Haven(가구)+Mixamo(캐릭터)" 경로 전체 실증

**판정 흐름**: 오픈소스 코드 병합=기각(WA 전례·AGPL·시각상향 없음) → Kenney CC0 재렌더=각도·팔레트 정합 통과했으나 **동급 대체 판정**(사용자) → **Poly Haven CC0(포토리얼급 PBR, 가구 115종 실측)** 로 상향 확정 후보 → Mixamo(Josh)로 캐릭터까지.

**산출물**(전부 미커밋, `frontend/public/spike-kenney/`):
- `index.html` — Kenney 합성 비교(토글: 숨김/CSS보정/★Blender 재렌더) + `kenney/`, `kenney-rr/`
- **`ph.html` — 메인 데모**: CSS matrix 아이소 바닥/벽 + **배치 데이터만으로 12인↔24인 토글** + 캐릭터 애니
- `ph/` — PH 모듈 스프라이트: ws-desk·ws-chair(분리)·meeting·sofa·coffee_table·plant_big/small·shelf + **occupied-typing(24f)·occupied-sit(12f)**(책상+캐릭터 합성)
- `char/` — Mixamo Josh 프레임: walk16·sit12·typing24·idle12
- 스크립트(레포로 복사 완료): **`tools/asset-gen/spike-scripts/`** — ph_download.py(PH 다운로더, UA 필요)·rr_render.py(Kenney 팔레트 리매핑)·ph_render.py(PH 모듈)·ph_render_ws.py(desk/chair 분리)·char_render.py(Cycles, 폐기 경로)·**char_render_eevee.py(캐릭터 정본)**·**char_desk_render.py(점유 합성 정본)**·char_diag.py
- 원본 에셋: PH gltf 9종은 ph_download.py로 재취득(세션 scratchpad는 휘발) · **Mixamo FBX 4종은 `C:\Users\wj941\Downloads\`**(Walking/Seated Idle/Typing/Idle.fbx, 각 ~52MB) — 레포 밖이므로 보존 주의

### D. 부수

- 오전 실화면 QA: 이동·착석·멀티유저(bob 스크립트)·고스트세션·재연결·테마 전부 통과. 발견=탭 백그라운드 rAF 정지(버그 아님, 메모리 기록)
- oVice 경쟁조사 리포트(대화 내). 회사 2020 설립·시리즈B 440억(2022)·이후 펀딩 없음·한국법인 6명
- **vitest 환경 수리**: rollup-win32 optional dep 누락 → `npm i --no-save @rollup/rollup-win32-x64-msvc` (node_modules 재설치 시 재발 가능)

## §2. 미커밋 상태 (git status 실측)

```
M  docs/planning/00-decisions.md            ← §N D33 + §O D34 신설
M  docs/planning/06-screens.md              ← §1 D33 몰입모드 배너
M  docs/planning/realtime-qa-runbook.md     ← §2 D33 G1~G5 + D34 체크리스트
M  frontend/components/OfficeShell.tsx      ← 레일·패널·독 세그먼트(meetingDock)
M  frontend/components/OfficeViewport2D.tsx ← 독·틴트·네임플레이트·미니맵·SpotCard·핫스팟
?? docs/planning/19-office-ux-simplify-spec.md
?? docs/planning/20-office-spatial-entrypoints-spec.md
?? docs/planning/handoff-session-2026-07-21.md (본 문서)
?? frontend/public/spike-kenney/            ← 스파이크 전체(페이지 2·스프라이트 ~110장)
?? tools/asset-gen/spike-scripts/           ← Blender 파이프라인 스크립트 8종
M  artifacts/qa/shots-roles/*.png, backend/dev_qa.db  ← QA 부수(이전 세션부터)
M  docs/_html/** 다수                        ← HTML 미러 스테일(이번 세션 무관, 재생성 대상)
```

**커밋 제안(3분할)**: ① `feat(office): D33 몰입 모드 …`(셸·뷰포트 D33분+19-spec+00/06/runbook D33분) ② `feat(office): D34 공간 진입점 SpotCard …`(뷰포트 D34분+20-spec+00/runbook D34분) ③ `spike(assets): Poly Haven+Mixamo 파이프라인 실증`(spike-kenney/+spike-scripts/). 파일이 얽혀 있어 ①②를 합쳐 2분할도 무방.

## §3. 다음 작업

1. **(권장 선행) 커밋 정리** — §2안대로
2. **D35 결정 대기**: "Poly Haven 가구 + Mixamo 캐릭터를 M1 소스로 확정" — 사용자 구두 흐름상 사실상 승인 분위기이나 **명시 확정 없음**. 확정 시 00-decisions §P 등재
3. **M1 본작업**(18-module 설계 이행, 스파이크 자산 재사용):
   - PH 모델 확장 선별(~30종) + **의자 4방향 variant** + 모듈러 벽 세트(ambientCG 재질)
   - 모듈 카탈로그 `catalog.json` — **desk/chair 분리 원칙**(§5 함정4) + occupied 합성 모듈(캐릭터×책상 조합)
   - 뷰포트 layout v2 직접 렌더(18-spec G3) + 좌석 편집기 연동(G4)
   - 캐릭터 스프라이트 교체: `frontend/public` 교체 + `lib/office2d.ts` AVATAR_ANIM 프레임 수(walk16/sit12/typing24/idle12) 수정. 다인 캐릭터는 Mixamo 추가 다운로드(캐릭터만 바꾸면 애니 재사용)
4. P1(프로필 사진 배지)·P2(씬 라이팅) 게이트는 유지 — M1이 사실상 P2를 흡수하는 방향
5. 잔여 검증: 타인 프로필 카드·배포 존 카드(§1-B)

## §4. 재현/기동

- **dev 스택**: realtime-qa-runbook.md §1 그대로(backend는 반드시 `DATABASE_URL=sqlite+aiosqlite:///./dev_qa.db` — 없으면 기본 PostgreSQL로 붙어 로그인 500). 로그인 alice@virtualoffice.local / password123
- **스파이크 페이지**: 프론트 기동 후 `http://localhost:3000/spike-kenney/ph.html`(메인 데모) · `/spike-kenney/index.html`(Kenney 비교)
- **렌더 파이프라인**(Blender 5.1 = `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`):
  ```powershell
  # PH 에셋 재다운로드(스크래치 휘발 시)
  python tools/asset-gen/spike-scripts/ph_download.py   # OUT 경로는 스크립트 내 OUT 상수 확인
  # 가구 모듈(Cycles):    blender -b --factory-startup -P ph_render.py    -- <ph_dir> <out_dir>
  # 분리 워크스테이션:    blender -b --factory-startup -P ph_render_ws.py -- <ph_dir> <out_dir>
  # 캐릭터 프레임(EEVEE): blender -b --factory-startup -P char_render_eevee.py -- <fbx_dir> <out_dir> [--probe]
  # 점유 합성(EEVEE):     blender -b --factory-startup -P char_desk_render.py  -- <ph_dir> <fbx_dir> <out_dir> [--probe]
  ```
  로그 규약: `MODULE/CHAR/OCC <name> ortho <m> anchor <top%>` — 페이지 SIZES/ANCHOR에 그대로 기입

## §5. 함정·실측값 정본 (재발 방지)

1. **Mixamo×Cycles: 몸 투명 렌더**(속눈썹만 남음) — 알파 강제로도 불가. **캐릭터는 EEVEE**(`BLENDER_EEVEE`, 5.1 enum). 가구=Cycles 이원화. EEVEE는 섀도캐처 없음→접지 그림자는 CSS 블롭
2. **스킨 메시 bound_box=레스트 포즈** — 반드시 evaluated `to_mesh()` 버텍스 샘플링 bbox + 전프레임 통합 bbox로 카메라 고정
3. **FBX 아마추어(-90X·scale.01)에 로컬 Z회전 = 물구나무** — 빈 피벗 부모로 월드 Z 회전. **rot_z=0이 정면-좌하**(우리 기본, 반대는 런타임 scaleX 플립)
4. **일체형 워크스테이션 모듈=착석 오클루전 불가**("다리가 책상 위") — desk/chair 분리+z샌드위치. 단 "손은 상판 위"까지는 분리로도 불가 → **착석 상태는 책상+캐릭터 합성 베이크(occupied-*)** 가 정답
5. **Mixamo 피벗≠메시 중심**(책상 끝 착석 증상) — 실측 bbox 중심 자동 정렬(char_desk_render.py 반영)
6. **그림자 잘림** — 프레임 margin 1.7~1.8 + 태양 고도 상향(rot X 32°, angle 14°) + 앵커는 카메라 투영 산출
7. 소소: PH API 403→브라우저 UA 필요 · PS 파이프가 stdout 일부 유실(로그는 flush=True + 파일 grep)

**실측 메타**(표시폭=ortho×K×1.41, K=페이지 px/m):
| 모듈 | ortho(m) | anchor(top%) | | 캐릭터 | n | ortho | anchor |
|---|---|---|---|---|---|---|---|
| ws-desk | 3.200 | 68.0 | | walk | 16 | 2.576 | 79.9 |
| ws-chair | 1.739 | 75.5 | | sit | 12 | 2.018 | 79.9 |
| meeting | 4.908 | 59.0 | | typing | 24 | 1.944 | 79.9 |
| sofa | 2.671 | 62.9 | | idle | 12 | 2.586 | 79.9 |
| occupied-typing/sit | 3.000 | 74.3/75.3 | | 의자 오프셋 | | desk+(0.25,−0.55) | 캐릭터 x−0.30 |

## §6. 포인터

- 결정: 00-decisions §N(D33)·§O(D34) / 스펙: 19·20-spec / 설계 기반: **18-module-composition-and-seat-editor.md**(M0 완료·M1 대기 — 다음 본작업의 정본)
- 메모리: feedback-office-ux-gap-2026-07-21 · game-asset-candidates-2026-07-21 · mixamo-char-bake-pipeline · browser-qa-tab-background-raf
- 경쟁조사 근거 링크는 07-21 대화 내 oVice 리포트 참조(시리즈B·라이선스 출처 포함)
