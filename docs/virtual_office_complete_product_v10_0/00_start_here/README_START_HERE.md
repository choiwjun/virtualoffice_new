# Virtual Office Final Development Complete Asset Set v7.0

이 패키지는 첨부 디자인 시안의 가상오피스 구현을 바로 개발에 붙일 수 있도록 정리한 통합 에셋 세트입니다.

## 바로 사용할 핵심 파일

- `01_runtime_3d/scenes/SCENE_ACME_HQ_HERO_V4_001.glb` — 전체 오피스 히어로 씬
- `01_runtime_3d/models/` — 카테고리별 개별 GLB 에셋
- `02_ui_overlay_assets/` — 좌측 메뉴, 우측 People 패널, 이름표, 룸 라벨, 화상회의 카드 UI PNG/SVG
- `03_scene_prefabs/KIT_FULL_OFFICE_HQ_READY_V7_001.json` — 전체 씬 조립용 프리팹/앵커 정의
- `05_registries/asset-registry-v7.json` — 전체 에셋 정본 레지스트리
- `04_engine_integration/threejs/` — Three.js 로더/렌더 세팅
- `04_engine_integration/unity/` — Unity 임포트 가이드/카탈로그 스크립트

## 포함 수량

- 전체 등록 에셋: 109개
- 개별 3D GLB 모델: 92개
- 씬 GLB: 6개
- UI PNG/SVG: 11개

## 개발 기준

- 단위: meter
- GLB 중심 워크플로우
- 피벗/앵커/충돌/상호작용 metadata 포함
- Three.js / Babylon.js / Unity 개발 예제 포함
- 디자인 레퍼런스와 포스터/컨택트시트 포함

## 중요

최종 런칭 화면 품질은 GLB 자체뿐 아니라 엔진 렌더링 세팅이 크게 좌우됩니다. `threejs-render-settings-v7.json`의 ACES tonemapping, bloom, SSAO, soft shadow, blue emissive outline 세팅을 적용해야 첨부 디자인과 가까워집니다.


## v8.0 Rigging & Animation Upgrade

This package now includes rigged humanoid characters and animation clips for immediate development integration.

Key additions:
- `01_runtime_3d/models/characters_rigged_v8/*.glb`: skinned humanoid character models with all clips embedded.
- `01_runtime_3d/animations/humanoid/ANIM_*.glb`: standalone retargetable humanoid animation clip files.
- `01_runtime_3d/animations/humanoid/animation-manifest-v8.json`: animation metadata.
- `01_runtime_3d/animations/humanoid/HUMANOID_RIG_MAP_V8.json`: rig mapping.
- `04_engine_integration/threejs/src/VirtualOfficeCharacterAnimator.ts`: Three.js animation helper.
- `04_engine_integration/unity/VirtualOfficeAvatarAnimationDriver.cs`: Unity animation helper.

Included clips: idle, walk, sit, sit_down, stand_up, typing, talk, wave, meeting_idle, point, phone_call, clap.
