# HORIZON ai-plate 납품 패키지

## 렌더
- `horizon-office-plate_3344x1882.png` — 클린 플레이트 (1672:941, 2:1 다이메트릭, 무인, bg #EDEAE3)
- `horizon-office-plate_QA-overlay.png` — layout.json 충돌 폴리곤/시트 앵커 오버레이 (검수용)

## control/ — img2img·ControlNet 입력
지오메트리는 전부 layout.json에서 파생 (플레이트와 픽셀 정합).

- `depth.png` — 뎁스 근사 (밝을수록 카메라에 가까움, MiDaS 컨벤션) → ControlNet Depth
- `lineart.png` — 은선 제거 라인아트 → ControlNet Lineart/Canny/MLSD
- `segmentation.png` — 클래스별 플랫 컬러 → ControlNet Seg (팔레트: legend.json)
- `occlusion-mask.png` — 화이트=가림 지오메트리 (캐릭터 합성 시 오클루전 소스)
- `legend.json` — segmentation 클래스 → hex 매핑

## 권장 워크플로
1. 구조: depth + lineart (또는 seg)를 ControlNet에 걸고
2. 스타일: 기존 시안 이미지를 IP-Adapter / img2img 레퍼런스로
3. 생성 결과를 QA-overlay와 대조 (허용 오차 ±2%)
4. 프롬프트에 "empty office, no people, no text except HORIZON wall lettering" 고정

## 소스
- `horizon-scene.js` / `HORIZON Office Scene.dc.html` — 렌더 소스 (배치 수정 시 컨트롤 맵 재생성 가능)
