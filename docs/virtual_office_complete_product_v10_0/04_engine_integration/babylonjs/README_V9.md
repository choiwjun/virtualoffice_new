# Babylon.js integration — v9

`VirtualOfficeAssetRuntimeV9` reads `asset-registry-v9.json`, caches `AssetContainer` objects and instantiates models into the scene. Rigged avatar GLBs expose their embedded clips as animation groups; pass those groups to `VirtualOfficeAvatarControllerV9` for crossfaded playback.

The walk clip is in-place. Move the avatar root node from your navigation system. Test transparent meeting-room glass with the final camera and scene order, and use a glow layer only for the blue emissive outline meshes.
