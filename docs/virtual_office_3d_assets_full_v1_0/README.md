# Virtual Office 3D Assets Full v1.0

제작일: 2026-07-09

이 패키지는 사용자가 제공한 **3D 에셋 제작 매니페스트 전체 목록**을 기준으로 만든 가상오피스 개발용 3D 에셋 풀 패키지입니다. MVP 항목뿐 아니라 Later 항목까지 모두 포함합니다.

## 포함 수량

- 유니크 개발용 모델 GLB: 76개
- 캐릭터 기본형: 2개
- 캐릭터 의상/헤어 변형: 5개
- 정적 포즈/애니메이션 레퍼런스 GLB: 8개
- 바닥 PBR 재질: 3종
- Prefab/Kit JSON: 10개
- 예시/검수 씬 GLB: 3개
- 에셋별 metadata JSON: 76개
- 매니페스트 커버리지 리포트: `qa/manifest-coverage.csv`, `qa/manifest-coverage.json`

## 공통 제작 규격

- 형식: `.glb` / glTF 2.0 binary
- 오브젝트 1개당 파일 1개
- 스케일: 실제 미터 단위
- 좌표계: Z-up
- Pivot: bottom center
- 바닥 기준: z=0 안착
- 재질: PBR baseColor / normal / roughness / metallic 또는 PBR factor 포함
- baseColor/albedo에 조명·그림자 baked 없음
- 개발용 metadata에 collision / interaction / anchor 포함

## 주요 파일

- `registry/asset-registry.json` — 전체 에셋 정본 레지스트리
- `registry/prefab-registry.json` — 재사용 키트 정본
- `qa/manifest-coverage.csv` — 매니페스트 항목별 포함 여부
- `qa/polycount-report.csv` — 폴리곤/치수/QA 리포트
- `scenes/SCENE_FULL_OFFICE_FLOOR_001.glb` — 전체 구역 조립 예시 씬
- `scenes/SCENE_ASSET_GALLERY_FULL_001.glb` — 모든 에셋 쇼케이스 씬
- `asset-contact-sheet.png` — 전체 썸네일 컨택트시트

## 캐릭터/애니메이션 주의사항

캐릭터는 이번 패키지에서 T-pose/variant GLB와 idle/walk/sit/typing 정적 포즈 레퍼런스를 제공합니다. 실제 서비스용 skeletal animation은 Mixamo, Blender 또는 엔진 리타게팅으로 리깅 후 `ANIM_IDLE_001`, `ANIM_WALK_001`, `ANIM_SIT_001`, `ANIM_TYPING_001` 클립 ID를 유지해 교체하는 구조입니다.

## 권장 사용 방식

런타임에서는 `SCENE_FULL_OFFICE_FLOOR_001.glb`를 그대로 쓰기보다 `asset-registry.json` + `prefab-registry.json` + layout JSON을 읽어 GLB를 인스턴싱하는 방식을 권장합니다. 같은 책상/의자/소품을 여러 번 복제해야 하므로 이 방식이 성능과 관리에 유리합니다.
