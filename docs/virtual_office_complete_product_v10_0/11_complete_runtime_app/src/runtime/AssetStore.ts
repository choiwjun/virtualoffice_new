import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetRecord, AssetRegistry } from '../types.js';

export class AssetStore {
  readonly loader = new GLTFLoader();
  readonly records = new Map<string, AssetRecord>();
  private cache = new Map<string, THREE.Object3D>();

  async initialize(): Promise<void> {
    const response = await fetch('/05_registries/asset-registry-v10.json');
    if (!response.ok) throw new Error(`asset registry load failed: ${response.status}`);
    const registry = await response.json() as AssetRegistry;
    for (const asset of registry.assets) this.records.set(asset.asset_id, asset);
  }

  get(assetId: string): AssetRecord {
    const asset = this.records.get(assetId);
    if (!asset) throw new Error(`Unknown asset: ${assetId}`);
    return asset;
  }

  list(): AssetRecord[] {
    return [...this.records.values()].filter((asset) => asset.file.endsWith('.glb') && !asset.category.includes('animation'));
  }

  async instantiate(assetId: string): Promise<THREE.Object3D> {
    const record = this.get(assetId);
    let template = this.cache.get(record.file);
    if (!template) {
      const gltf = await this.loader.loadAsync(`/${record.file}`);
      template = gltf.scene;
      this.cache.set(record.file, template);
    }
    const hasSkin = template.getObjectByProperty('type', 'SkinnedMesh') !== undefined;
    const root = hasSkin ? cloneSkeleton(template) : template.clone(true);
    root.name = assetId;
    root.userData.assetId = assetId;
    root.userData.assetRecord = record;
    root.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        const std = material as THREE.MeshStandardMaterial;
        if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
        if (std.emissiveMap) std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        std.needsUpdate = true;
      }
    });
    return root;
  }
}
