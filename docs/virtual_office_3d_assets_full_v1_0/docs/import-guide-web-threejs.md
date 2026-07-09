# Web / Three.js Import Guide

Recommended runtime loading pattern:

1. Load `registry/asset-registry.json`.
2. Preload GLBs referenced by each `asset.file`.
3. Read `prefabs/*.json` and spawn instances using `position`, `rotation`, and `scale`.
4. Use `metadata/*.meta.json` for collision boxes and anchors.
5. For glass assets, use alpha sorting / transparent render queue validation.

Coordinate system: package assets are authored as Z-up. If your Three.js pipeline uses Y-up, apply an import adapter consistently.
