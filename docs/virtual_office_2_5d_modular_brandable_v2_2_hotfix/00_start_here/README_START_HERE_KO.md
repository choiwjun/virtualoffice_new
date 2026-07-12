# Virtual Office 2.5D Modular & Brandable v2.0

## 목적
고품질 고정 카메라 씬의 비주얼을 유지하면서 회사명, 로고, 방 라벨, 블루 글로우, 캐릭터와 일부 공간 구성을 런타임에서 교체합니다.

## 가장 빠른 실행
```bash
python run_demo.py
```
브라우저가 `http://127.0.0.1:8765/07_runtime/`을 엽니다.

## 이번 버전에서 해결된 항목
- HORIZON/ACME 텍스트를 제거한 브랜드 중립 클린 플레이트 2장
- 회사명/부제/색상/로고 파일의 런타임 교체
- 이름칩, 방 라벨, 블루 글로우를 배경과 분리
- HORIZON/ACME 완성 프리셋과 모듈 편집용 Sandbox
- 투명 PNG 환경·가구·소품·캐릭터 자산을 기존 2.5D 팩에서 통합
- 모듈 드래그, 삭제, 레이아웃 JSON 내보내기
- 화면 좌표, 깊이 정렬, 스폰 포인트, 방 폴리곤 JSON

## 중요한 사용 원칙
1. 내일 시연은 `HORIZON_OPEN_PLAN` 또는 `ACME_EXECUTIVE` 프리셋을 사용하세요. 이 두 프리셋이 최고 비주얼입니다.
2. 회사명은 배경에 포함되지 않으며 `brand-anchors.json` 기준으로 별도 렌더됩니다.
3. 완전히 새로운 구조는 `MODULAR_SANDBOX`에서 조합할 수 있습니다. 모듈은 동일한 카메라 계열로 제작된 2.5D PNG이므로 자유 3D 회전은 지원하지 않습니다.
4. 레이아웃을 제품화할 때는 각 신규 구조마다 동일 카메라의 중립 베이스 플레이트를 1장 추가하면, 브랜딩·라벨·캐릭터 시스템은 그대로 재사용됩니다.

## 개발 핵심 파일
- `06_metadata/asset-registry-v2.json`
- `06_metadata/scene-registry.json`
- `06_metadata/brand-anchors.json`
- `06_metadata/module-catalog.json`
- `05_layouts/*.json`
- `07_runtime/app.js`
