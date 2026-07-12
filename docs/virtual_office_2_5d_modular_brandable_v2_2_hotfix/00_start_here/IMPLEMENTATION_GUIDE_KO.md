# 개발 적용 요약

## 브랜드 변경
`scene.brand` 또는 UI에서 `companyName`, `subtitle`, `color`, `logoUrl`을 변경합니다. 텍스트 로고와 업로드 로고 모두 지원합니다.

## 레이아웃 변경
- 하이파이 프리셋: 배경 플레이트 + 동적 오버레이
- 모듈 프리셋: `modules[]`의 `file`, `x`, `y`, `scale`을 변경
- 모든 좌표는 0~1 정규화 좌표

## 깊이 정렬
`zIndex = round((y + depthOffset) * 10000)`

## 새 회사 추가
1. 중립 클린 플레이트를 추가
2. `brand-anchors.json`에 로고 영역 추가
3. 새 `05_layouts/*.json` 생성
4. `scene-registry.json`에 등록

## 새 구조 추가
동일 부감 카메라로 공간 모듈을 투명 PNG로 렌더한 뒤 `03_modules/environment/`에 넣고 `module-catalog.json`에 등록합니다.
