# asset-gen — 2.5D 에셋 프로시저럴 생성기 (D30 v1)

에셋(PNG)과 지오메트리(layout.json)를 **한 소스에서** 생성한다. 정본 스펙 = `docs/planning/17-asset-rework-spec.md`, 결정 = `00-decisions §K(D30)`.

> **v2 플레이트 (2026-07-15)**: 실납품 플레이트 그림의 정본은 Claude Design 산출
> `ai-plate/incoming/horizon-scene.js`(캔버스 렌더러 — layout.json obstacles/seats를 그대로 읽어
> 가구를 앵커링, `.dc.html`로 렌더/재수출). **지오메트리 정본은 여전히 `src/plate.js` →
> `out/layout.json`** — 배치를 바꾸면 plate.js 수정 → 재생성 → horizon-scene.js의 OB/SEATS 블록도
> 동일 값으로 갱신 → PNG 재수출(3344px) → `frontend/public/office2d/plates/horizon.png` 교체.
> **v2.1 오클루전 레이어 (2026-07-15)**: horizon-scene.js의 캡처 모드(`renderHorizonLayers`)로
> 배경 1장 + 가구 스프라이트를 분리 추출(`node extract-layers.js` →
> `frontend/public/office2d/layers/`). 뷰포트가 manifest의 z(바닥 접점 정규 y)로
> 아바타와 동일 규칙(zIndex=z·10000) 합성 → 상호 가림. manifest 없으면 단일 플레이트 폴백.
> 씬 수정 시 재추출 필수(재추출 전 sprites/ 비우기 — 아이템 번호가 밀리면 고아 webp가 남는다).
> 러그 등 평면 아이템은 add(..., true)로 배경에 흡수.
> **그룹 분리 이력**: 의자류(ad83361 — 보드룸·미팅·워크스테이션) + 팬트리 아일랜드
> 벤치/테이블/스툴·폰부스 스툴/패널(2026-07-16) → 현재 57장(WebP 총 0.50MB).
> 원리: 그룹이면 baseline이 최전방 부재로 내려가 뒤 부재가 근접 아바타를 잘못 덮는다.
>
> **캐릭터도 v2 (2026-07-15)**: 그림 정본 = `ai-plate/incoming/horizon-characters.js`
> (`window.drawCharFrame(ctx, charId, state, f)` — 220×460·발 (110,445)·
> idle6/walk8/sit6/**typing6**(2026-07-16 추가, 총 208프레임)).
> 재추출 = `node extract-chars.js`(Playwright 헤드리스, 자동 QA: 투명도·발 접지·bbox)
> → `out/chars-v2/` → typing 등 신규 상태만 frontend/public/office2d/characters/ 복사.
> 주의: 보행 접지 보상 패치(o.bob의 `+19·sin²p` 항)가 통합 시 추가됨 —
> 렌더러 재납품 받으면 이 항 유지 확인. `src/characters.js`는 v1 폴백으로 보존.
> typing 재생은 뷰포트가 착석 중 벽시계 위상 버스트(office2d.ts `typingBurstAt`)로 전환.
> **v2.3 직군 소품 (2026-07-17)**: MANAGER 사각 안경·DESIGNER 라운드 안경(CHARS `glasses`),
> DEVELOPER 오버이어 헤드폰(`headphones`), INTERN 사원증 랜야드(`badge`) — `faceProps()`가
> hairFront 뒤에, badge는 drawTorso 끝에 그린다. 소품 변경 시 해당 직군 26프레임만 재납품.
> **v2.3 씬 소품·브랜드 (2026-07-17)**: NE 벽시계(창 사이 u 0.55~0.60)·아트월 갤러리(u 0.33~0.412,
> 브랜드 월~창1 사이) — 벽면 데코라 배경 레이어에 흡수(스프라이트 57장·manifest 불변).
> 브랜드 월 파라미터 = horizon-scene.js `BRANDS`(HORIZON/ACME/NOVA): `drawScene(opts.brand)` /
> `renderHorizonLayers(brand)` / `<horizon-scene brand="ACME">`, v1 폴백은 `buildPlate({brand})`.
> 브랜드 QA 렌더: `node brand-qa.js` → `out/brand-{acme,nova}-qa.webp`.
> **M0 모듈 카탈로그 (2026-07-17, 18-설계)**: `node extract-modules.js` →
> `frontend/public/office2d/modules/{catalog.json, sprites/}` — 아이템 meta(type/variant/ob/seat,
> horizon-scene.js add() 5번째 인자)로 15타입×33변형 대표 스프라이트 + 인스턴스 57 배치를 산출.
> QA 게이트 = 재합성 diff < 1%(실측 0.296%). 씬 아이템을 추가하면 **meta 태깅 필수**(미태깅 시 추출 실패).

## 파일 맵

| 파일 | 역할 |
|---|---|
| `src/core.js` | 아이소 투영(TILE=51, ORIGIN)·팔레트(PAL)·프리미티브(prism/plant/…) — **톤·시점 정합의 정본** |
| `src/plate.js` | 씬 조립(모듈 6종) + 지오메트리 산출(`buildPlate()` → {svg, geometry}) |
| `src/characters.js` | 8직군 리그 + idle6/walk8/sit6 프레임(`buildFrame`), 콘택트시트 |
| `generate.js` | CLI — 아래 사용법 |
| `compose-qa.js` | 플레이트+캐릭터 합성 QA샷 (`out/composite-qa.png`) |
| `out/layout.json` | **지오메트리 정본** (walkArea/rooms/obstacles/spawns/meetingZones/**seats**, 정규 0~1) |

## 사용법

```bash
cd tools/asset-gen
node generate.js plate            # out/plate-preview.png(836px QA) + out/layout.json
node generate.js chars            # out/chars-sheet.png (8직군 × 6포즈 QA)
node generate.js all --final      # frontend/public/office2d/ 에 실납품 (플레이트 @2x + 160프레임: idle6+walk8+sit6)
node compose-qa.js                # 합성 비율 검증샷
```

## 에셋 수정 → 반영 루프

1. `src/plate.js`(가구·배치) / `src/characters.js`(캐릭터) 편집
2. `node generate.js all --final` — 에셋 + layout.json 재생성
3. **지오메트리 동기** (배치를 바꿨을 때만): layout.json 값을 아래 두 곳에 주입
   - `frontend/lib/office2d.ts` — `WALK_AREA` / `ROOMS` / `OBSTACLES` / `SPAWNS` 리터럴
   - `realtime/src/integration/FloorLayoutProvider.ts` — `HORIZON_WALK_AREA` / `HORIZON_OBSTACLES` / `HORIZON_SPAWN_N`(lobby) / Scene 프로바이더의 `meetingZones`(bbox 미터 = 정규 × [20, 11.256])
   - ⚠ meetingZones는 **SceneFloorLayoutProvider 쪽 블록**에 주입할 것 — Demo 프로바이더에도 같은 모양의 블록이 있다(과거 오주입 사고)
4. 검증: `cd realtime && npm test` (scene-floor가 지오메트리 검사 — 테스트 좌표가 배치 의존이라 배치 변경 시 재캘리브레이션 필요) + `cd frontend && npm run build`

## 주의(함정 기록)

- **루트 `.gitignore`의 `out/` 규칙이 layout.json을 삼킨다** → `git add -f tools/asset-gen/out/layout.json`
- **OneDrive 동기화가 납품 PNG를 잠깐 잠근다**(EUNKNOWN -4094) → generate.js `writeFileRetry`가 파일별 재시도로 흡수. 실패 시 잠시 후 재실행.
- **좌석 DB 시드**: layout.json `seats`(워크스테이션 의자 앵커 8개)가 소스 — `backend/scripts/seed_seats.py`가 미터 환산(×[20, 11.256]) 후 seat 테이블에 upsert(WS-A1=alice 고정, WS-B1=bob 고정). 의자 배치를 바꾸면 재실행.
- 캔버스 계약: 플레이트 1672×941 비율 고정(좌표계 20×11.256m), 캐릭터 220×460·발 기준 (110,445)·우향
- 캐릭터 표시 높이는 `office2d.ts avatarHeightFrac`(현재 0.088~0.102 — 아이소 무원근)
- 이동서버 속도검증: 첫 move는 dt=0.05s 가정 → 허용 ≈0.105m. 봇/스크립트는 소보폭 연속 전송 패턴 사용(`realtime/scripts/load-sim-20.ts` 참조)
