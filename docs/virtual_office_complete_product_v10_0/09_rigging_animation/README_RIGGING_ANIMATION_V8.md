# Virtual Office v8 Rigging & Animation Upgrade

v8 adds full developer handoff support for characters:

- Rigged humanoid character GLBs: **8**
- Embedded animation clips per rigged character: **12**
- Separate retargetable animation clip GLBs: **12**
- Humanoid bone map: `01_runtime_3d/animations/humanoid/HUMANOID_RIG_MAP_V8.json`
- Animation manifest: `01_runtime_3d/animations/humanoid/animation-manifest-v8.json`

## Included clips
- ANIM_IDLE_001
- ANIM_WALK_001
- ANIM_SIT_001
- ANIM_SIT_DOWN_001
- ANIM_STAND_UP_001
- ANIM_TYPING_001
- ANIM_TALK_001
- ANIM_WAVE_001
- ANIM_MEETING_IDLE_001
- ANIM_POINT_001
- ANIM_PHONE_CALL_001
- ANIM_CLAP_001

## Runtime use
Load any file from `01_runtime_3d/models/characters_rigged_v8/*.glb`; it contains both the skinned mesh and all animation clips.

The package also keeps the original static character GLBs and office/furniture/prop assets from v7.
