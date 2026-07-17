# 18. 런타임 모듈 합성 + 좌석 편집기 layout-JSON 재설계 (설계 정본)

**작성일**: 2026-07-17
**상태**: 설계 승인 → **M0 완료(2026-07-17, 게이트 PASS)** · M1 대기
**범위**: 시안 A안(모듈 개별 스프라이트 런타임 합성) + #14 좌석 편집기 layout-JSON 재설계(P7-T3의 D30 재해석). **반드시 한 묶음**으로 구현한다.
**정본 참조**: 17-asset-rework-spec(D30) · 05-office-layout-schema(D12/D25) · 00-decisions §K · tools/asset-gen/README.md(v2.1~2.3 레이어 합성 실증) · 15-realtime-server-spec

---

## 1. 배경 — 왜 지금 구조인가, 무엇이 문제인가

현행(v2.2) 파이프라인은 **"고정 배치 1종"에 최적화**되어 있다:

| 데이터 | 위치 | 생성 방식 |
|---|---|---|
| 그림(배경+가구 57스프라이트) | `frontend/public/office2d/layers/` | horizon-scene.js 오프라인 캡처(extract-layers.js) |
| 스프라이트 좌표·z | `layers/manifest.json` | 캡처 시 픽셀 산출(바닥 접점) |
| 지오메트리 정본 | `tools/asset-gen/out/layout.json` | plate.js 산출 |
| 프론트 지오메트리 | `frontend/lib/office2d.ts` 리터럴 | **수동 주입** |
| 서버 지오메트리 | `realtime/.../FloorLayoutProvider.ts` 리터럴 | **수동 주입** (meetingZones 오주입 사고 이력) |
| 좌석 DB | `seat` 테이블 | seed_seats.py 수동 실행 |

문제 3가지:
1. **배치 변경 비용이 파이프라인 전체 재수행** — 가구 하나 옮기면 씬 재캡처 + 4곳 수동 동기(handoff 07-16 §2-B가 대형인 이유).
2. **편집기가 없다** — 05-스키마(D12) 기반 admin/office-layout 편집기·검증기(`office_layout_validator.py`)는 존재하지만 2.5D 뷰포트 렌더와 **완전히 분리**되어 있다(편집해도 화면이 안 바뀜 = P7-T3 미구현).
3. **P7-T3 원설계(Blender 재렌더 루프)는 D29/D30로 무효** — 오프라인 배치 재렌더 대신, v2.1~2.3에서 실증된 **레이어 z-합성이 곧 재렌더**다(스프라이트는 그대로, 좌표만 바꾸면 즉시 반영).

## 2. 목표 / 비목표

**목표**
- G1. **모듈 카탈로그**: 가구를 "모듈"(스프라이트 + footprint + 좌석앵커 + baseline 규칙) 단위로 1회 추출·등록.
- G2. **scene-layout v2 JSON**: 층 배치 = 모듈 인스턴스 목록(미터, top_left/D25). 그림·충돌·좌석·회의존이 전부 이 한 파일에서 파생.
- G3. **뷰포트 직접 렌더**: manifest 대신 layout v2를 읽어 (모듈 스프라이트, 배치 좌표, 파생 z)로 합성 — 배치 변경 = JSON 변경 = 즉시 반영.
- G4. **좌석 편집기**: admin 편집기에서 모듈 배치/이동/좌석 지정 → 검증(D12) → 배포 → 뷰포트·이동서버·seat 테이블 자동 동기.
- G5. **B(베이스 씬 배치 변형 3종)의 데이터화**: 변형 = layout v2 파일 3개. 씬 재캡처·재앵커링·수동 동기 소멸.

**비목표**
- 다층/층전환(P7-T2)은 스키마만 대비(floor_id 필드)하고 구현하지 않는다.
- 시안 A안의 픽셀 occlusion 마스크: 현행 "바닥 접점 baseline" 규칙으로 충분함이 실증됨(v2.1~2.2). 부분 겹침 아티팩트가 실측되면 후속.
- 멀티테넌트·브랜드별 층(#21 연동)은 유보.

## 3. 아키텍처

### 3.1 모듈 카탈로그 (`frontend/public/office2d/modules/catalog.json` + 스프라이트)

horizon-scene.js의 아이템 클로저를 **모듈 타입별 로컬 캔버스 캡처**로 확장한다(extract-modules.js 신설, extract-layers.js 유지).

```jsonc
{
  "version": 1,
  "modules": {
    "workstation-desk": {
      "variants": { "v+": {"src": "workstation-desk.v+.webp", "w": 2.0, "h": 1.3,
        "anchorPx": [0.5, 0.93],        // 스프라이트 내 바닥 접점(정규) — z 산출 기준
        "baselineDy": 0.0 }},
      "footprint": [[0,0],[2.0,0],[2.0,1.3],[0,1.3]],   // 모듈-로컬 미터 폴리곤(충돌)
      "seats": [{ "id": "s1", "at": [1.0, 1.72], "back": "v+" }], // 로컬 좌석앵커(의자 모듈 자동 페어)
      "flat": false
    },
    "office-chair": { "variants": { "v-": {...}, "v+": {...}, "u-": {...}, "u+": {...} }, "footprint": null },
    "rug-lounge":   { "flat": true, ... }   // flat=배경층 흡수(아바타 비가림) — 현행 규칙 유지
  }
}
```

핵심 계약:
- **변형(variant) = 사전 렌더**: 아이소 고정 시점이라 임의 회전 대신 렌더러가 이미 갖고 있는 방향 파라미터(officeChair back 4종, sofa backAt 2종 등)를 변형으로 캡처. 편집기는 변형 중 선택만 한다.
- **z 규칙 불변**: 인스턴스 z = (배치 y_m + anchor 오프셋) → 정규 y → `zIndex = z·10000`. 아바타와 동일(변경 없음).
- **그룹 분리 원칙 승계**(README "세분화 원리"): 아바타가 부재 사이에 설 수 있는 구성은 모듈을 쪼갠다. 카탈로그 단위가 이미 분리 단위.

### 3.2 scene-layout v2 (`GET /api/realtime/floor-layout` 확장 페이로드)

05-스키마(D12)와 **별도 문서가 아니라 확장**이다: `furniture[]` 항목이 `asset_id` 대신 `module_id`+`variant`를 갖는 profile을 정의한다(スキーマ_version=2). 단위는 미터·top_left(D25 그대로).

```jsonc
{
  "metadata": { "schema_version": 2, "scene": "HORIZON_OPEN_PLAN", "brand": "HORIZON" },
  "dimensions": { "width_m": 20.0, "height_m": 11.256 },
  "background": { "src": "/office2d/layers/background.webp" },  // 벽·바닥·창·브랜드월(모듈 아님)
  "walk_area": [[x,y],...],                                     // 미터
  "modules": [
    { "id": "ws-a1-desk", "module": "workstation-desk", "variant": "v+", "at": [6.9, 4.55] },
    { "id": "ws-a1-chair", "module": "office-chair", "variant": "v+", "at": [7.9, 5.35],
      "seat": { "code": "WS-A1", "fixed_user": "alice" } }
  ],
  "rooms": [...], "meeting_zones": [...], "spawns": {...}
}
```

파생 규칙(단일 소스 → 3소비처):
- **obstacles** = Σ 모듈 footprint(at으로 평행이동). office2d.ts `OBSTACLES`/`WALK_AREA` 리터럴과 FloorLayoutProvider의 `HORIZON_*` 리터럴은 **파생 코드젠 산출물**로 대체(§3.4).
- **seats** = seat 필드 가진 모듈 인스턴스 → `seed_seats.py`가 layout v2를 직접 읽도록 변경(현 layout.json 의존 제거).
- **meetingZones** = rooms 중 회의존 마킹 → SceneFloorLayoutProvider 주입(오주입 사고 원천 차단).

### 3.3 뷰포트 렌더 경로 (OfficeViewport2D)

```
loadSceneLayout() ──존재─→ 모듈 합성 렌더(카탈로그 스프라이트 + at→normToMeters 역변환 + z 파생)
        └──없음/구버전─→ 현행 manifest 폴백 → 단일 플레이트 폴백   (3단 폴백, ASSETS_READY 계약 유지)
```
- 스프라이트 DOM 노드 수는 현행(57)과 동급 — 성능 예산 변화 없음.
- 시간대 테마(SCENE_THEMES)·typing 버스트는 렌더 경로와 직교 — 변경 없음.

### 3.4 지오메트리 동기 — 수동 주입 소멸

**빌드타임 코드젠**(런타임 fetch보다 리스크 낮음, 1단계):
`tools/asset-gen/gen-geometry.js` — layout v2 → ① `frontend/lib/office2d.generated.ts`(WALK_AREA/OBSTACLES/SPAWNS/ROOMS) ② `realtime/src/integration/floorLayout.generated.ts`(HORIZON_* 상수). 리뷰 가능한 diff로 남는다.
**2단계(편집기 배포 연동 후)**: FloorLayoutProvider가 이미 지원하는 deployed-layout API 로드로 전환, 코드젠은 dev 폴백.

### 3.5 편집기 (admin/office-layout 확장)

- 모듈 팔레트(카탈로그) + 드래그 배치 + grid_snap(10cm) + 변형 선택 + 좌석 코드/고정배정 입력.
- 저장 → `office_layout_validator.py` 확장 검증: 기존 D12 규칙(경계·중첩·도달성 A*) + v2 신규 규칙(모듈 footprint 중첩 금지, 좌석앵커→최근접 보행점 도달성 = seat-reach-qa 로직 서버 이식, WAYPOINT_EPS 0.06/클리어런스 0.07 불변식 준수).
- 배포 → `layout_updated`(Colyseus) + 뷰포트 재로드 + seat upsert. **Blender/재캡처 없음 — 이것이 P7-T3 "편집→재렌더 루프"의 D30 이행 완성형.**

## 4. 마이그레이션 단계 (각 단계 독립 검증·롤백 가능)

| 단계 | 산출물 | 검증 게이트 |
|---|---|---|
| **M0 ✅(2026-07-17)** | extract-modules.js + catalog.json — **실측: 15타입 × 33변형**(대표 0.25MB = 기존 57장 0.50MB 대비 -50%), 인스턴스 57, 산출 `frontend/public/office2d/modules/` | 재합성 픽셀 diff **0.296%** < 1% **PASS** + 기존 extract-layers 산출물 바이트 불변(무회귀) |
| **M1** | scene-layout v2 생성기(plate.js geometry → v2 변환) + 뷰포트 v2 렌더 경로(플래그) | 실화면 QA: 현행과 동일 프레임(z-순서 회귀 0) — v2.2 QA 절차 재사용 |
| **M2** | gen-geometry.js 코드젠 + office2d/FloorLayoutProvider 리터럴 대체 | `realtime npm test`(scene-floor) + frontend build + seat-reach-qa 그린 |
| **M3** | 편집기 팔레트·배치 UI + validator v2 규칙 + 배포·동기 루프 | E2E: 모듈 이동 → 배포 → 뷰포트/이동서버 반영, 잘못된 배치 reject |
| **M4** | 배치 변형 3종(B) layout v2 데이터 + seed_seats v2 | 변형별 scene-floor 파라미터라이즈 테스트 |

## 5. 리스크 · 오픈 퀘스천

| # | 내용 | 대응 |
|---|---|---|
| R1 | 모듈-로컬 캡처 시 그림자·바닥광 절단(현 스프라이트는 씬 문맥 포함) | 캡처 pad에 그림자 여백 포함, 러그·바닥광은 flat 모듈로 분리(현행 규칙) |
| R2 | scene-floor 테스트가 좌표 하드코딩 — v2 전환 시 대량 재캘리브레이션 | M2에서 테스트를 layout 파생값 기반으로 재작성(하드코딩 제거가 목적의 일부) |
| R3 | 편집기 자유 배치가 경로탐색 그리드(0.1m)·doorway 폭 가정 깨뜨림 | validator에 도달성·개구부 최소폭(1.2m) 규칙 — reject가 정답, 런타임 방어 아님 |
| OQ1 | 벽·창·브랜드월도 모듈화할가? | 1차 아니오 — 배경 1장 유지(배치 변형은 배경 N장). 벽 개편 수요 생기면 후속 |
| OQ2 | 좌석앵커를 의자 모듈에 둘까 책상 모듈에 둘까 | 의자 모듈(착석 스냅 대상이 의자) + 책상 페어링은 편집기 편의 기능 |

## 6. 착수 전 필요 승인

- 스키마 확장 방향(05 v2 profile) 승인 — 05-office-layout-schema.md에 §7 "schema_version 2 (2.5D 모듈 프로파일)" 추가는 M1에서.
- M0~M4 순차 진행, 단계별 커밋. 예상 규모: M0~M2 = 파이프라인/렌더(중형), M3 = 편집기(대형), M4 = 데이터(소형).

---
*이 문서 승인 후 M0 착수. B(배치 변형)는 M4로 흡수되어 별도 대형 작업이 소멸한다.*
