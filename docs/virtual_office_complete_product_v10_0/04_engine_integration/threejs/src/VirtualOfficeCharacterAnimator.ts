import * as THREE from "three";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type VirtualOfficeClipId =
  | "ANIM_IDLE_001"
  | "ANIM_WALK_001"
  | "ANIM_SIT_001"
  | "ANIM_TYPING_001"
  | "ANIM_TALK_001"
  | "ANIM_WAVE_001"
  | "ANIM_MEETING_IDLE_001"
  | "ANIM_STAND_UP_001"
  | "ANIM_SIT_DOWN_001"
  | "ANIM_POINT_001"
  | "ANIM_PHONE_CALL_001"
  | "ANIM_CLAP_001";

export class VirtualOfficeCharacterAnimator {
  mixer: THREE.AnimationMixer;
  actions = new Map<string, THREE.AnimationAction>();

  constructor(public root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
  }

  play(clipId: VirtualOfficeClipId, fade = 0.18) {
    const next = this.actions.get(clipId);
    if (!next) throw new Error(`Missing animation clip: ${clipId}`);
    for (const action of this.actions.values()) {
      if (action !== next) action.fadeOut(fade);
    }
    next.reset().fadeIn(fade).play();
  }

  update(deltaSec: number) {
    this.mixer.update(deltaSec);
  }
}

export async function loadRiggedAvatar(url: string) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url) as GLTF;
  const animator = new VirtualOfficeCharacterAnimator(gltf.scene, gltf.animations);
  return { gltf, scene: gltf.scene, animations: gltf.animations, animator };
}
