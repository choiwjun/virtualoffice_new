# asset-gen — 2.5D 에셋 프로시저럴 생성기 (D30 v1)

에셋(PNG)과 지오메트리(layout.json)를 **한 소스에서** 생성한다. 정본 스펙 = `docs/planning/17-asset-rework-spec.md`, 결정 = `00-decisions §K(D30)`.

## 파일 맵

| 파일 | 역할 |
|---|---|
| `src/core.js` | 아이소 투영(TILE=51, ORIGIN)·팔레트(PAL)·프리미티브(prism/plant/…) — **톤·시점 정합의 정본** |
| `src/plate.js` | 씬 조립(모듈 6종) + 지오메트리 산출(`buildPlate()` → {svg, geometry}) |
| `src/characters.js` | 8직군 리그 + idle6/walk8 프레임(`buildFrame`), 콘택트시트 |
| `generate.js` | CLI — 아래 사용법 |
| `compose-qa.js` | 플레이트+캐릭터 합성 QA샷 (`out/composite-qa.png`) |
| `out/layout.json` | **지오메트리 정본** (walkArea/rooms/obstacles/spawns/meetingZones, 정규 0~1) |

## 사용법

```bash
cd tools/asset-gen
node generate.js plate            # out/plate-preview.png(836px QA) + out/layout.json
node generate.js chars            # out/chars-sheet.png (8직군 × 5포즈 QA)
node generate.js all --final      # frontend/public/office2d/ 에 실납품 (플레이트 @2x + 112프레임)
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
- 캔버스 계약: 플레이트 1672×941 비율 고정(좌표계 20×11.256m), 캐릭터 220×460·발 기준 (110,445)·우향
- 캐릭터 표시 높이는 `office2d.ts avatarHeightFrac`(현재 0.088~0.102 — 아이소 무원근)
- 이동서버 속도검증: 첫 move는 dt=0.05s 가정 → 허용 ≈0.105m. 봇/스크립트는 소보폭 연속 전송 패턴 사용(`realtime/scripts/load-sim-20.ts` 참조)
