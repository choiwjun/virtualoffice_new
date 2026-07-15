# AI 플레이트 생성 킷 (A안 — HORIZON 씬 포토리얼 교체)

> 목적: `frontend/public/office2d/plates/horizon.png`(현 프로시저럴 렌더)를 시안 계열
> 포토리얼 아이소메트릭 렌더로 교체. **지오메트리(layout.json)는 불변** — 이미지의
> 가구 배치가 현 플레이트와 일치해야 충돌/좌석/문이 그대로 동작한다.
>
> 담당 분담: 이미지 생성 = 사용자(시안 제작에 쓴 도구), 프롬프트·검수·정합·납품 = Claude.

---

## 방법 1 (권장): img2img — 배치 잠그고 스타일만 교체

1. 레퍼런스 이미지: `frontend/public/office2d/plates/horizon.png` (3344×1882)
2. 도구의 이미지 참조/img2img 기능에 위 파일을 넣고 아래 프롬프트 적용
3. 변형 강도(denoise/strength): **0.45~0.6** — 낮으면 벡터 느낌이 남고, 높으면 배치가 흐트러짐.
   0.5에서 시작해 배치가 밀리면 낮추고, 스타일이 안 바뀌면 올리기
4. 출력: 가로 3344px 이상(최소 1672), **비율 1672:941(≈16:9) 유지**, PNG

### 메인 프롬프트 (EN)

```
Photorealistic isometric 3D render of a modern open-plan office, true dimetric 2:1
isometric camera angle (exactly matching the reference image composition — keep every
piece of furniture in the same position and same footprint as the reference).
Warm minimal style: light oak wood furniture, navy blue sofas and chairs, warm gray
walls, beige large-format tile floor. Soft daylight from the upper-left, gentle ambient
occlusion, subtle contact shadows, physically based materials (wood grain, brushed
fabric, frosted glass partitions with thin aluminum frames).
The scene contains: a reception counter with a wood-slat brand wall reading "HORIZON"
on the upper-right wall; a lounge with two navy sofas and a coffee table; two
workstation clusters of four light-wood desks each with monitors, keyboards and ergonomic
task chairs; a glass-walled board room on the right with a long wood table and eight
chairs and a wall-mounted TV; a small glass meeting room below it with a four-person
table; a pantry island with stools on the left; a café corner with a round table on a
navy rug at the lower left; a glass phone booth at the lower right; potted plants
throughout; three windows on the upper-left wall and two on the upper-right wall showing
soft sky.
Empty office, no people, no characters, no text labels, no UI elements, no name tags.
Clean architectural visualization quality, octane render, high detail, 8k.
```

### 네거티브 프롬프트

```
people, person, human, character, avatar, name tag, label, UI, icons, text overlay,
watermark, logo (except the HORIZON brand wall), fisheye, perspective distortion,
tilted camera, cartoon outline, flat vector style, blurry, low resolution
```

---

## 방법 2 (대안): 텍스트 단독 생성

img2img가 안 되는 도구면 위 메인 프롬프트만으로 생성하되, **배치가 반드시 어긋나므로**
여러 장 생성해 배치가 가장 근접한 것을 고른다. 이 경우 Claude가 이미지에 맞춰
지오메트리를 재캘리브레이션해야 함(그리드 오버레이 실측 — 반나절 작업, 비권장).

---

## 수용 기준 (Claude가 검수)

- [ ] 카메라: 2:1 아이소(다이메트릭), 원근 왜곡 없음
- [ ] 배치: 워크스테이션 2클러스터·보드룸·미팅룸·리셉션·라운지·팬트리·카페·폰부스가
      레퍼런스와 동일 위치·동일 크기(오버레이 대조로 판정, 허용 오차 ±2%)
- [ ] **문 개구부**: 보드룸 전면 유리(우하단 변)와 미팅룸 전면 유리에 열린 구간 존재
- [ ] **인물·이름표·라벨·UI 없음** (과거 팩 사고 1순위 체크)
- [ ] 배경: 단색(웜 페이퍼 톤) 또는 투명 — 뷰포트 밖 여백
- [ ] 해상도: 가로 ≥1672px (권장 3344), 비율 1672:941
- [ ] HORIZON 브랜드월 텍스트 판독 가능

## 납품 방법

생성 이미지를 `tools/asset-gen/ai-plate/incoming/` 에 저장하고 Claude에게 알리기.
Claude가 수행: ① layout.json 폴리곤 오버레이 대조(육안+좌표) ② 크롭/스케일 보정
③ `frontend/public/office2d/plates/horizon.png` 교체 ④ 실화면 확인 안내.
지오메트리·이동·착석·좌석은 코드 변경 없음(이미지 교체만).

## 캐릭터(2단계, 별도)

플레이트 합격 후 착수. 캐릭터는 프레임 일관성(14~20프레임 동일 인물)이 과거 실패
지점이라, 우선 현행 벡터 캐릭터를 유지하고 포토리얼 플레이트와의 톤 이질감을 실화면에서
평가한 뒤 진행 여부 결정.
