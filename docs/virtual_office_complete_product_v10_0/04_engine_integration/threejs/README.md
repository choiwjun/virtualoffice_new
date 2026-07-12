# Three.js Integration

1. Copy this whole package into your public/static asset folder.
2. Install `three`.
3. Import `VirtualOfficeAssetLoader` and call `loadHeroScene()`.

```ts
const loader = new VirtualOfficeAssetLoader('/virtual_office_final_dev_complete_v7_0/');
const office = await loader.loadHeroScene();
scene.add(office);
```

Recommended render settings are included in `threejs-render-settings-v7.json` and `VirtualOfficeAssetLoader.ts`.
