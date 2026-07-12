# Unity Import Guide

Recommended pipeline:

1. Import all `.glb` files via UnityGLTF or glTFast.
2. Keep the folder path structure unchanged.
3. Add `asset-registry-v7.json` to a Resources/StreamingAssets path.
4. Use `VirtualOfficeAssetCatalog.cs` to read metadata.
5. Use HDRP or URP with Bloom, Ambient Occlusion, Reflection Probes, and ACES tonemapping.

The GLB files use meter scale, Z-up source convention, bottom-center pivots, and metadata for anchors/collisions.
