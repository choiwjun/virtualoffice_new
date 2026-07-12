# Delivery Notes

이 패키지는 `한 번에 모든 종류의 에셋을 개발 진행 가능한 형태`로 묶은 최종 개발 통합본입니다.

개발팀은 다음 순서로 시작하면 됩니다.

1. `05_registries/asset-registry-v7.json` 로드
2. `01_runtime_3d/scenes/SCENE_ACME_HQ_HERO_V4_001.glb` 씬 로드
3. `02_ui_overlay_assets/png`의 UI 오버레이 연결
4. `03_scene_prefabs/KIT_FULL_OFFICE_HQ_READY_V7_001.json`의 spawn point, room trigger, UI anchor 적용
5. 엔진별 렌더 세팅 적용

검수는 `06_quality_reports/validation-report-v7.json` 기준으로 진행합니다.
