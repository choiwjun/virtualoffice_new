# Rigging and Animation Next Step

This full asset pack includes humanoid T-pose meshes and pose reference GLBs. To create final runtime-ready avatar animation clips:

1. Import `models/characters/CHAR_MALE_001.glb` and `CHAR_FEMALE_001.glb` into Mixamo or Blender.
2. Bind a humanoid skeleton and keep the same real-world meter scale.
3. Export skeletal GLB clips using these IDs:
   - `ANIM_IDLE_001`
   - `ANIM_WALK_001`
   - `ANIM_SIT_001`
   - `ANIM_TYPING_001`
4. Preserve bottom-center pivot and Z-up conversion adapter in the runtime import layer.

The current pose-reference GLBs are useful for visual validation, but they are not final skinned skeletal animation clips.
