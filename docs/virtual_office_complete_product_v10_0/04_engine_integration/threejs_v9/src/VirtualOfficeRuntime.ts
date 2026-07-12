import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type ClipId =
  | 'ANIM_IDLE_001' | 'ANIM_WALK_001' | 'ANIM_SIT_001'
  | 'ANIM_SIT_DOWN_001' | 'ANIM_STAND_UP_001' | 'ANIM_TYPING_001'
  | 'ANIM_TALK_001' | 'ANIM_WAVE_001' | 'ANIM_MEETING_IDLE_001'
  | 'ANIM_POINT_001' | 'ANIM_PHONE_CALL_001' | 'ANIM_CLAP_001';

export interface LoadedAvatar {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<ClipId, THREE.AnimationAction>;
  play: (clip: ClipId, fade?: number) => void;
  update: (dt: number) => void;
  dispose: () => void;
}

export class VirtualOfficeRuntime {
  private loader = new GLTFLoader();
  constructor(public baseUrl = '/') {}

  async loadScene(relativeUrl: string): Promise<THREE.Object3D> {
    const gltf = await this.loader.loadAsync(this.baseUrl + relativeUrl);
    return gltf.scene;
  }

  async loadAvatar(relativeUrl: string): Promise<LoadedAvatar> {
    const gltf = await this.loader.loadAsync(this.baseUrl + relativeUrl);
    const root = SkeletonUtils.clone(gltf.scene);
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<ClipId, THREE.AnimationAction>();
    for (const clip of gltf.animations) {
      actions.set(clip.name as ClipId, mixer.clipAction(clip));
    }
    let active: THREE.AnimationAction | undefined;
    const play = (clipId: ClipId, fade = 0.18) => {
      const next = actions.get(clipId);
      if (!next) throw new Error(`Animation not found: ${clipId}`);
      if (active === next) return;
      if (active) active.fadeOut(fade);
      next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
      active = next;
    };
    const dispose = () => {
      mixer.stopAllAction();
      root.traverse((obj: THREE.Object3D) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const mat of mats) mat.dispose();
      });
    };
    return { root, mixer, actions, play, update: (dt) => mixer.update(dt), dispose };
  }
}

export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
