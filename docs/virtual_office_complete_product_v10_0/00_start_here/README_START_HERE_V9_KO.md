# Virtual Office Complete Rigged Asset Set v9.0

가상오피스 개발용 통합 패키지입니다. 기존 환경·가구·소품·씬·UI 에셋에 더해, **스킨이 적용된 휴머노이드 캐릭터 8종**, **캐릭터당 내장 애니메이션 12종**, **별도 리타게팅용 애니메이션 GLB 12종**, **엔진 연동 코드**를 한 패키지로 정리했습니다.

## 핵심 수량

- 전체 GLB: 126개
- 모델 GLB: 108개
- 씬 GLB: 6개
- 리깅·스킨 캐릭터: 8개
- 별도 애니메이션 클립: 12개
- 캐릭터별 내장 애니메이션: 12개
- 휴머노이드 조인트: 18개
- UI 오버레이 파일: 11개

## 바로 시작할 파일

1. `03_scene_prefabs/SCENE_ACME_HQ_RIGGED_RUNTIME_V9_001.json`
2. `01_runtime_3d/scenes/SCENE_ACME_HQ_HERO_V4_001.glb`
3. `01_runtime_3d/models/characters_rigged/*.glb`
4. `05_registries/asset-registry-v9.json`
5. `05_registries/animation-registry-v9.json`
6. `09_rigging_animation/animation-state-machine-v9.json`
7. `06_quality_reports/validation-report-v9.json`

## 애니메이션 12종

`idle`, `walk`, `sit`, `sit_down`, `stand_up`, `typing`, `talk`, `wave`, `meeting_idle`, `point`, `phone_call`, `clap`

## 엔진 연동

- Three.js: `04_engine_integration/threejs_v9/`
- React Three Fiber: `04_engine_integration/react_three_fiber_v9/`
- Babylon.js: `04_engine_integration/babylonjs_v9/`
- Unity: `04_engine_integration/unity_v9/`
- Godot 4: `04_engine_integration/godot_v9/`

## 품질 범위

`07_visual_reference/v9_concept_targets/`의 PNG는 첨부 시안 기반 **비주얼 목표 이미지**입니다. 실제 런타임 GLB는 패키지에 포함된 개발 베이스라인이며, 컨셉 이미지 자체가 3D 모델이나 텍스처로 변환된 것은 아닙니다. 리깅·스킨·애니메이션·파일 구조·엔진 연동 여부는 `validation-report-v9.json`에서 검증했습니다.
