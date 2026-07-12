# Three.js v9 Integration

1. Copy the package so the repository root is served as a static directory.
2. Run `npm install` in this folder.
3. Load `03_scene_prefabs/SCENE_ACME_HQ_RIGGED_RUNTIME_V9_001.json` with `loadRiggedOffice`.
4. Call every avatar's `update(deltaSeconds)` in the render loop.

The rigged character GLBs already contain all 12 animation clips. Separate clip-only GLBs are also provided for retargeting workflows.
