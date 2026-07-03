# 디자인 레퍼런스 — 3D 메인 오피스 (목표 퀄리티 기준)

**작성일**: 2026-07-03
**출처**: 사용자 제공 초기 기획 디자인 시안(2026-07, 원본 이미지)
**대상 화면**: `specs/screens/virtual-office-3d.yaml` (platform: godot-native, layout: split-3d-hud) · `06-screens.md §1`
**용도**: 이 시안이 **제품 목표 시각 퀄리티/UX의 정본 레퍼런스**다. Phase 1 골든 샘플(C1~C7)과 HUD 구현은 이 수준을 기준으로 한다.

> **원본 이미지 저장 위치**: `design/screens/virtual-office-3d-reference.png` (사용자가 원본 PNG를 여기에 저장할 것 — 바이너리는 세션에서 직접 커밋 불가).

---

## 0. 한 줄 요약
Gather.town류의 경량 2.5D가 **아님**. **실사급(photorealistic) 3D 아이소메트릭 오피스** + 다크테마 글래스모피즘 HUD + 인앱 화상통화가 하나의 화면에 통합된 **프리미엄 데스크톱 앱**. PRD 품질기준(Godot 4 Forward+, GTX1650급 60fps, D22)의 시각 목표가 바로 이 시안이다.

---

## 1. 전체 구성 (시안 기준)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [◎ Virtual Office]  [Acme Corp HQ ▾]      [🔍 Search ⌘K] [📅] [🔔•] [👤 Ava ▾] │  ← Top bar
├──────────┬───────────────────────────────────────────────────┬─────────────────┤
│ 🏠 Office │                                                   │ People (29)  ⧉🔍+│  ← Right panel
│ 🚪 Rooms  │         3D 아이소메트릭 오피스 뷰포트              │ ▸ In Office (18)│
│ 👥 People │   ACME 리셉션 · 오픈데스크 · 유리 회의실 ·        │ ▸ In a Meeting(5)│
│ 💬 Chat 2 │   라운지 · 다이닝 · 아바타(이름 pill)             │ ▸ Online (6)    │
│ 📅 Events │   [Design Room 4 in room] [Product Sync 5*glow]   │ ▸ Away (3)      │
│ ▦ Whiteb. │                            (🔵 video FAB)         │                 │
│ 🗎 Files   │                    ┌─────────────────────────┐    │                 │
│ ⚙ Settings│                    │ Product Sync LIVE 24:18 │    │                 │
│           │                    │ [Ava][Noah][Sophia]     │    │ ← 플로팅 화상패널│
│ ┌Floor 1▾┐│                    │ [Liam][Olivia]          │    │                 │
│ │ 미니맵 ││                    │ 🎙🎥🖥😊✋⋯ ⛔          │    │                 │
│ └───────+-┘                    └─────────────────────────┘    │                 │
│ ● 29 Online│      "Walk up to a room and press E to enter"     │                 │
└──────────┴───────────────────────────────────────────────────┴─────────────────┘
```

## 2. 상단 바 (Top bar)
- 좌: 원형 로고 + **"Virtual Office"** 워드마크 → **조직 스위처 "Acme Corp HQ ▾"**(office 드롭다운, spec header-toolbar)
- 우: **검색 `Search… ⌘K`**(직원/팀 검색→아바타 강조+카메라 이동), **캘린더 아이콘**, **알림 벨(배지)**, **유저 칩 `Ava Taylor / ● Online ▾`**(아바타+상태+드롭다운)

## 3. 좌측 내비 레일 (Left nav)
- 아이콘+라벨 수직 메뉴: **Office(활성=파란 하이라이트) · Rooms · People · Chat(배지 2) · Events · Whiteboard · Files** — 구분선 — **Settings**
- 하단: **`Floor 1 ▾` 접이식 카드** = 층 미니맵(평면도 + 컬러 점 = 아바타/좌석) + 줌 `+ / −`
- 최하단: **`● 29 People Online`**
- ⚠️ **spec 대비 신규 항목**: `Events`, `Whiteboard`, `Files` (현재 `virtual-office-3d.yaml` 좌측엔 Floor/Zone/Rooms/People/Chat/Settings만) → §7 델타 참조

## 4. 중앙 3D 뷰포트 (핵심 — 목표 퀄리티)
**렌더 품질**: 실사급 PBR 재질(우드 슬랫 브랜드월, 폴리시드 콘크리트 바닥, 패브릭 소파), 부드러운 그림자/AO, 식물·소품 디테일, 아이소메트릭 카메라.
**공간 요소**(시안에서 식별):
- **ACME CORPORATION 리셉션/브랜드월**(우드 슬랫 + 로고) + 리셉션 데스크(안내 아바타)
- **오픈 좌석**: 모니터·인체공학 의자·파티션·데스크 식물
- **유리벽 회의실 2개**: `Design Room · 4 in room`(라벨 칩), `Product Sync · 5 in room` — **활성 회의는 네온 블루 글로우 아웃라인**
- **라운지**(블루 소파+커피테이블), **다이닝/키친**(우드 테이블+체어)
- **아바타**: 걷는 3D 캐릭터 + **떠 있는 이름 pill(● 녹색 온라인 점)** — Olivia, Liam, Noah, Sophia, Ethan
- **플로팅 화상 FAB**(파란 원형 카메라 버튼)
**하단 중앙 힌트 pill**: `Walk up to a room and press E to enter` — **근접 시 E키 입장**(spec의 "Enter Meeting" 클릭 프롬프트를 키보드 E로 구체화)

## 5. 플로팅 화상통화 패널 (인앱 LiveKit)
- 헤더: `Product Sync · 🔴LIVE · 24:18` + 참석자수(5) + 화면공유/레이아웃 아이콘 + 드래그 핸들
- 비디오 타일: Ava Taylor / Noah Johnson / Sophia Patel(상) · Liam Chen / Olivia Kim(하) — 각 타일 오디오 레벨 바
- 컨트롤 바: 🎙 마이크 · 🎥 카메라 · 🖥 화면공유 · 😊 리액션 · ✋ 손들기 · ⋯ 더보기 · **⛔ 빨강 통화종료**

## 6. 우측 패널 (People)
- 헤더: `People (29)` + 초대/검색/추가 아이콘
- **프레즌스 그룹**(접이식):
  - `In Office (18) ▾` — Ava Taylor(👑 호스트, ●Online), Liam Chen(●Online), Sophia Patel(At desk), Noah Johnson(In a meeting), Olivia Kim(In a meeting) + `View all in office`
  - `In a Meeting (5) ▾` — Product Sync(5 people 🎥), Design Review(4 people 🎥)
  - `Online (6) ▾` — Ethan Wright, Mia Davis + `View all online`
  - `Away (3) ▾`
- 상태 텍스트 다양: Online / At desk / In a meeting / Away, 호스트 왕관(👑) 배지

## 7. 스타일 토큰 (시안에서 추출 — H1 디자인토큰 입력)
- **테마**: 다크(네이비/슬레이트 배경), 글래스모피즘 패널(반투명+블러)
- **액센트**: 블루(#3b82f6 계열) — 활성 메뉴/회의 글로우/FAB/링크
- **상태색**: 온라인=녹색 · 회의=블루 · 자리비움=앰버 · 종료=레드
- **형태**: 라운드 코너(카드/칩/버튼), 부드러운 그림자, pill 라벨
- **타이포**: 산세리프, 위계 명확(제목 볼드 / 보조 뮤트)

## 8. spec ↔ 시안 델타 (구현 시 반영/재정합 필요)
| 항목 | 현재 spec | 시안 | 조치 |
|---|---|---|---|
| 좌측 내비 | Floor/Zone/Rooms/People/Chat/Settings | **+Events · +Whiteboard · +Files** | 신규 3항목 scope 결정(Phase/우선순위) 후 spec 반영 |
| 회의 입장 | "Enter Meeting" 클릭 프롬프트 | **근접 + E키** | 키보드 단축키 UX 명문화 |
| 화상 UI | footer 회의 컨트롤 | **플로팅 드래그 패널(그리드 타일)** | HUD 컴포넌트 스펙 보강 |
| 프레즌스 그룹 | all/online/meeting/focus/away 필터 | **In Office/In a Meeting/Online/Away 섹션 그룹** | 우측 패널 그룹핑 방식 반영 |
| 시각 품질 | "Forward+, 60fps"(텍스트) | **실사급 PBR 레퍼런스(이 이미지)** | 골든샘플 아트 타깃으로 고정 |

## 9. 구현 영향 (→ implementation-handoff.md)
- **C(Godot 3D 골든샘플)**: 이 시안이 아트/HUD 타깃. C1~C7 수용기준에 "레퍼런스 대비 시각 일치" 추가.
- **H(디자인 시스템)**: §7 토큰이 H1 입력. 이 시안이 H2 목업 부재를 해소하는 1차 레퍼런스.
- **E(화상)**: 플로팅 화상 패널 UI가 3D 내 화상 렌더링(E3)의 HUD 목표.
- **A(웹 콘솔)**: 동일 다크테마/토큰을 웹 콘솔에도 일관 적용(브랜딩 통일).
