import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VIRTUAL_OFFICE_ASSETS, byId } from './virtualOfficeAssets';

export class VirtualOfficeAssetLoader {
  constructor(public baseUrl = '/') {}
  private gltfLoader = new GLTFLoader();
  async loadGLB(assetId: string): Promise<THREE.Object3D> {
    const asset = byId[assetId];
    if (!asset) throw new Error(`Unknown asset: ${assetId}`);
    if (!asset.file.endsWith('.glb')) throw new Error(`${assetId} is not a GLB asset`);
    const gltf = await this.gltfLoader.loadAsync(this.baseUrl + asset.file);
    return gltf.scene;
  }
  async loadHeroScene(): Promise<THREE.Object3D> {
    return this.loadGLB('SCENE_ACME_HQ_HERO_V4_001');
  }
  getAssetsByCategory(category: string) {
    return VIRTUAL_OFFICE_ASSETS.filter(a => a.category === category);
  }
}

export function applyOfficeRenderSettings(renderer: THREE.WebGLRenderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
