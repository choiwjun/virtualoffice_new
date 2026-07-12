# 애니메이션 통합 가이드 v9

## 가장 간단한 방식

`01_runtime_3d/models/characters_rigged/`의 GLB를 로드하면 스킨 메시, 18-joint skeleton, 12개 애니메이션이 한 파일 안에 들어 있습니다. 엔진에서 clip name으로 액션을 선택하면 됩니다.

## 별도 clip GLB를 쓰는 방식

`01_runtime_3d/animations/humanoid/ANIM_*.glb`는 메시 없이 skeleton node와 animation만 들어 있습니다. 커스텀 캐릭터에 리타게팅할 때 사용합니다. 본 이름은 `09_rigging_animation/humanoid-rig-v9.json`을 기준으로 맞춥니다.

## 권장 상태 전환

- 이동: idle ↔ walk
- 착석: idle → sit_down → sit
- 업무: sit ↔ typing
- 기립: sit → stand_up → idle
- 회의: meeting_idle ↔ talk / point / clap
- 소셜: wave
- 통화: phone_call
