# Virtual Office Production Assets v3.0 — Hero Quality Rebuild

작성일: 2026-07-09

이 패키지는 이전 v2.0 프로토타입 패키지를 폐기하고, 첨부 디자인 시안의 방향성에 맞춰 **히어로 씬 중심**으로 재제작한 가상오피스 3D 에셋 세트입니다.

## 포함 수량

- 개별 GLB 에셋: 84개
- 히어로 씬 GLB: 1개
- Vertical Slice GLB: 1개
- Asset Gallery GLB: 1개
- Prefab JSON: 5개
- 에셋별 metadata JSON: 84개
- UI PNG/SVG: 3종
- PBR material registry: 37종

## 핵심 개선점

- 리셉션/유리 회의실/워크스테이션/라운지/탕비실을 별도 히어로 모듈로 재구성
- 목재 슬랫, 대리석 데스크, 유리 파티션, 네온 룸 아웃라인, 소품 밀도 강화
- 씬 단위 프리뷰와 UI 오버레이 프리뷰 제공
- 모든 에셋에 `asset_id`, `metadata`, `collision`, `anchor`, `interaction` 정보 포함

## 주의

캐릭터 GLB는 현재 **unrigged T-pose / Mixamo-ready mesh**입니다. 최종 서비스에서 `idle`, `walk`, `sit`, `typing`, `talk`, `wave` 애니메이션을 쓰려면 Mixamo 또는 Blender/Unity 리타겟팅 단계가 필요합니다.

## 주요 파일

- `scenes/SCENE_ACME_HQ_HERO_V3_001.glb`
- `previews/hero-office-preview-v3.png`
- `previews/asset-contact-sheet-v3.png`
- `previews/characters/character-contact-sheet-v3.png`
- `registry/asset-registry.json`
- `registry/prefab-registry.json`
