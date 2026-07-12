# Virtual Office 2.5D Production Pack v1.0

내일 시연과 즉시 개발 투입을 위해 만든 **고해상도 고정 카메라 2.5D 프로덕션 세트**입니다.

## 포함
- 1920×1080 하이파이 오피스 씬 2종
- 투명 PNG 환경 모듈 18종
- 투명 PNG 소품·식물 36종
- 캐릭터 8명 × Idle / Walk / Sit / Typing
- 상태별 프레임 PNG 및 스프라이트시트 JSON
- UI 컴포넌트 9종, 디자인 토큰
- 환경/소품 atlas와 JSON
- 방 hotspot·충돌 구역·spawn point metadata
- 외부 라이브러리 없는 오프라인 인터랙티브 데모

## 실행
```bash
python 08_runtime_demo/run_demo.py
```
`http://127.0.0.1:8765/08_runtime_demo/`

바닥 클릭 이동, 방 라벨 클릭, Space 자동 시연, M 회의 패널, F 전체화면.

## 개발 진입점
- `07_metadata/asset-registry.json`
- `07_metadata/character-registry.json`
- `07_metadata/scene-layout.json`
- `08_runtime_demo/src/`

이 세트는 자유 회전 3D 메시가 아니라, 첨부 디자인의 비주얼을 유지하는 **고정 카메라용 2.5D 투명 스프라이트/씬 렌더 세트**입니다.
