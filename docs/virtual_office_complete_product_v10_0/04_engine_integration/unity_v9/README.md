# Unity v9 Integration

Recommended importer: glTFast or UnityGLTF. Import a rigged GLB from `01_runtime_3d/models/characters_rigged/`. Each model contains 12 named animation clips.

For editor-import workflows:
1. Select the imported animation clips.
2. Run **Virtual Office > Build Animator Controller From Selected Clips**.
3. Add `VirtualOfficeAvatarController` to the avatar root.

For runtime-only glTF loading, use your selected importer's runtime API and bind its imported clips to the same IDs in `VirtualOfficeClipId`.
