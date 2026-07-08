# Phase 0 스파이크 — 수용기준 증거

> docs/planning/16-render-spike-and-roadmap.md §A.3

## 판정 상태: 육안확인필요

Blender가 이 환경에 설치되어 있지 않아 (blender.exe NOT FOUND)
더미 에셋(generate_test_assets.py)으로 R3F 데모를 구성했습니다.

---

## 체크리스트 (스크린샷 촬영 후 기입)

| 항목 | 기준 | 파일 | 판정 |
|------|------|------|------|
| A | 아바타 책상 앞 → 온전히 보임 | evidence/A_front.png | 미촬영 |
| B | 아바타 책상/유리벽 뒤 → 정확히 가려짐 (경계 ≤2px) | evidence/B_behind.png | 미촬영 |
| C | 아바타 발 위치 = 배경 바닥 정합 | evidence/C_feet.png | 미촬영 |

---

## 재현 명령

```bash
# 1. 테스트 에셋 생성
python render-pipeline/generate_test_assets.py

# 2. 의존성 설치
cd spikes/depth-composite
npm install

# 3. 개발 서버 실행
npm run dev
# → http://localhost:5174

# 4. 단위 테스트
npm test

# 5. Blender 설치 후 실제 렌더 (선택)
# "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" \
#   --background --python render-pipeline/build_office.py
```

---

## Blender 없을 때 더미 에셋 한계

- `office_bg.png`: 간이 아이소 투영으로 그린 씬 (포토리얼 아님)
- `office_depth.png`: 근사 깊이값 (Cycles Z-pass 아님)
- 깊이합성 경계 정확도: 더미 깊이맵의 품질에 종속됨

실제 Blender Cycles 렌더 후 동일 데모에서 재검증해야 합니다.
