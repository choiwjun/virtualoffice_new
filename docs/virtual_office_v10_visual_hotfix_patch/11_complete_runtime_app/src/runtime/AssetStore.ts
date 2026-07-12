import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetRecord, AssetRegistry } from '../types.js';

interface CachedAsset {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export interface InstantiatedAsset {
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export class AssetStore {
  readonly loader = new GLTFLoader();
  readonly records = new Map<string, AssetRecord>();
  private cache = new Map<string, CachedAsset>();

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
    return (await this.instantiateBundle(assetId)).root;
  }

  async instantiateBundle(assetId: string): Promise<InstantiatedAsset> {
    const record = this.get(assetId);
    let template = this.cache.get(record.file);
    if (!template) {
      const gltf = await this.loader.loadAsync(`/${record.file}`);
      template = { scene: gltf.scene, animations: gltf.animations };
      this.cache.set(record.file, template);
    }

    const hasSkin = template.scene.getObjectByProperty('type', 'SkinnedMesh') !== undefined;
    const root = hasSkin ? cloneSkeleton(template.scene) : template.scene.clone(true);
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
        const name = (std.name || '').toUpperCase();

        // Color textures are sRGB. Data textures must stay linear / NoColorSpace.
        if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
        if (std.emissiveMap) std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        if (std.normalMap) std.normalMap.colorSpace = THREE.NoColorSpace;
        if (std.roughnessMap) std.roughnessMap.colorSpace = THREE.NoColorSpace;
        if (std.metalnessMap) std.metalnessMap.colorSpace = THREE.NoColorSpace;
        if (std.aoMap) std.aoMap.colorSpace = THREE.NoColorSpace;

        std.envMapIntensity = 0.55;

        // Clamp the source pack's very strong emissive values.
        if (name.includes('NEON') || name.includes('EMISSIVE')) {
          std.emissiveIntensity = name.includes('BLUE') ? 0.82 : 0.48;
        } else if (name.includes('SCREEN') || name.includes('DISPLAY') || name.includes('TV')) {
          std.emissiveIntensity = 0.35;
        } else {
          std.emissiveIntensity = Math.min(std.emissiveIntensity ?? 1, 1);
        }

        // Temporary physically-plausible profiles. Proper authored PBR maps are still
        // required for final visual quality.
        if (name.includes('SKIN')) {
          std.metalness = 0.0;
          std.roughnessMap = null;
          std.roughness = 0.68;
        } else if (name.includes('MARBLE')) {
          std.metalness = 0.0;
          std.roughnessMap = null;
          std.roughness = 0.40;
        } else if (name.includes('CONCRETE')) {
          std.metalness = 0.0;
          std.roughnessMap = null;
          std.roughness = 0.76;
        } else if (name.includes('PLASTIC')) {
          std.metalness = 0.0;
          std.roughnessMap = null;
          std.roughness = 0.56;
        } else if (name.includes('LEATHER')) {
          std.metalness = 0.0;
          std.roughnessMap = null;
          std.roughness = 0.48;
        }

        if (name.includes('GLASS') && (std as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
          const glass = std as THREE.MeshPhysicalMaterial;
          glass.color.set(0xd9ebf4);
          glass.metalness = 0.0;
          glass.roughness = 0.08;
          glass.transmission = 0.90;
          glass.thickness = 0.02;
          glass.ior = 1.45;
          glass.opacity = 1.0;
          glass.transparent = true;
          glass.depthWrite = false;
          glass.side = THREE.DoubleSide;
        }

        std.needsUpdate = true;
      }
    });

    return { root, animations: template.animations };
  }
}
