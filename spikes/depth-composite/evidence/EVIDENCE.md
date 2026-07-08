# Phase 0 스파이크 — 수용기준 증거

> docs/planning/16-render-spike-and-roadmap.md §A.3

## 판정 상태: PASS (2026-07-08)

깊이합성 오클루전 셰이더가 Python 더미 에셋으로 검증됨.
Playwright headless(SwiftShader) 자동 픽셀 검증 통과.

---

## 체크리스트

| 항목 | 기준 | 파일 | 판정 |
|------|------|------|------|
| A | 아바타 책상 앞(s<0) → 온전히 보임 | evidence/front.png | PASS |
| B | 아바타 책상 뒤(s>0) → 하반신 가려짐 | evidence/behind.png | PASS |
| C | 배경 office_bg.png 풀스크린 표시 | (CSS background-size:cover) | PASS |
| D | 스크린샷 2종 자동 저장 | evidence/front.png, behind.png | PASS |

---

## 픽셀 검증 결과 (2026-07-08)

검증 스크립트: `scan_screen.mjs` + `verify_final.mjs` (Playwright)

### 정량 결과

| 측정 항목 | 값 | 판정 |
|-----------|-----|------|
| FRONT(s=-2) 아바타 픽셀 수 | 6,297px | PASS (>=400) |
| BEHIND(s=+2) 아바타 픽셀 수 | 4,580px | — |
| 아바타 픽셀 감소율 | **27.3%** | PASS (>=15%) |
| 겹침 영역(663,316) 아바타 가려짐 | 배경색(40,40,50) | PASS |
| 아바타 하단(663,330) 가려짐 | 배경색(40,40,50) | PASS |

### 오클루전 전환 포인트

X=630 컬럼, Y=255~365 구간에서 23개의 명확한 전환 확인:
- FRONT(s=-2): `AV`(파란색 아바타)
- BEHIND(s=+2): `OTHER`(배경/책상 R=92,66,43)

X=780 컬럼, Y=180~265 구간에서 아바타 상단(책상 위)은 s=+2에서도 가시 — 정상.

---

## 기술 요약

- **배경**: CSS `background-image: cover` (div, zIndex=0)
- **Canvas**: alpha:true, toneMapping=NoToneMapping (zIndex=1)
- **셰이더**: `if (avatarDepth > bgDepth + uDepthBias) discard;`
- **depthBias**: 0.001 (near=0.1, far=100 씬에서 충분)
- **아바타 경로**: Three.js `[0, 0, -1.2 - 0.6*s]` — Z축 이동
  - s<0: Z>-1.2 (카메라 가까운 쪽, 앞) → 책상 depth보다 낮음 → 가려지지 않음
  - s>0: Z<-1.2 (카메라 먼 쪽, 뒤) → 책상 depth보다 높음 → 가려짐

---

## 재현 명령

```bash
# 1. 테스트 에셋 생성
python render-pipeline/generate_test_assets.py

# 2. 의존성 설치 및 개발 서버
cd spikes/depth-composite
npm install
npm run dev
# → http://localhost:5174

# 3. Playwright 자동 검증
node verify_final.mjs   # (scratchpad에 있음)
```

---

## Blender 없을 때 더미 에셋 한계

- `office_bg.png`: 간이 아이소 투영으로 그린 씬 (포토리얼 아님)
- `office_depth.png`: Python 역투영 계산 (Cycles Z-pass 아님)
- 깊이합성 원리 자체는 동일하게 검증됨

실제 Blender Cycles 렌더 후 동일 데모에서 재검증 권장.
