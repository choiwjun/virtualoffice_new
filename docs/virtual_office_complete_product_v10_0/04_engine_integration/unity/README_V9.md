# Unity integration — v9

1. Import the GLB files with the glTF importer selected by your project.
2. Confirm the avatar mesh, skin and 18-joint hierarchy import together.
3. Expose/import the 12 clips with the exact names used in `VirtualOfficeClipId`.
4. Select the clips and run **Assets → Virtual Office v9 → Create Animator Controller From Selected Clips**.
5. Assign the generated controller to the avatar `Animator` and add `VirtualOfficeAvatarControllerV9`.
6. Import `asset-registry-v9.json` as a `TextAsset` when using `VirtualOfficeRegistryLoaderV9`.

The clips are in-place; move the avatar GameObject using your navigation or networking layer. Align seated avatars with `seat_anchor` and `work_anchor` metadata rather than hard-coded offsets. Transparent glass and emissive blue room outlines need to be recreated with the project render pipeline's material/shader settings after GLB import.
