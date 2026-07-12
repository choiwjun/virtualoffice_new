# Virtual Office Complete Runtime v10

이 폴더는 전체 에셋을 실제로 배치하고 캐릭터를 이동시키는 Three.js 실행 앱입니다.

## 실행

패키지 루트에서 가장 간단한 방법:

```bash
python run_virtual_office_v10.py
```

브라우저에서 `http://localhost:8765`을 엽니다.

소스 개발:

```bash
cd 11_complete_runtime_app
npm install
npm run dev
```

## 포함 기능

- 개별 GLB 에셋 카탈로그 및 즉시 배치
- 이동/회전/복제/삭제
- 0.25m 그리드 스냅 및 15도 회전 스냅
- 레이아웃 브라우저 저장/불러오기 및 JSON 내보내기
- 남녀 리깅 캐릭터와 12개 애니메이션 클립
- 바닥 클릭 이동, A* 경로 탐색, 가구 충돌 회피
- 좌석/업무 앵커 접근 후 앉기·타이핑
- PBR 텍스처 내장 GLB 우선 로드
- ACES 톤매핑, 소프트 섀도, 환경광, 블룸

멀티플레이 서버, 로그인, 채팅, WebRTC 영상회의는 에셋 제품의 범위를 넘어서는 애플리케이션 백엔드 기능이므로 포함하지 않습니다.
