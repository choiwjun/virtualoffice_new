import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ClipId } from '../types.js';
import { GridNav } from './GridNav.js';

export class AvatarController {
  root = new THREE.Group();
  mixer?: THREE.AnimationMixer;
  actions = new Map<ClipId, THREE.AnimationAction>();
  active?: THREE.AnimationAction;
  path: THREE.Vector3[] = [];
  speed = 1.35;
  moving = false;
  seated = false;
  private loader = new GLTFLoader();

  constructor(public nav: GridNav) { this.root.name = 'PlayerAvatar'; }

  async load(file = '/01_runtime_3d/models_pbr_v10/characters_rigged/CHAR_FEMALE_RIGGED_HERO_V8_001.glb'): Promise<void> {
    const gltf = await this.loader.loadAsync(file);
    const model = cloneSkeleton(gltf.scene);
    this.root.clear();
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      this.actions.set(clip.name as ClipId, this.mixer.clipAction(clip));
    }
    this.play('ANIM_IDLE_001');
    model.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
    });
  }

  play(id: ClipId, fade = 0.16): void {
    const next = this.actions.get(id);
    if (!next || next === this.active) return;
    next.reset();
    if (id === 'ANIM_SIT_DOWN_001' || id === 'ANIM_STAND_UP_001' || id === 'ANIM_WAVE_001' || id === 'ANIM_POINT_001' || id === 'ANIM_CLAP_001') {
      next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    if (this.active) this.active.fadeOut(fade);
    next.fadeIn(fade).play();
    this.active = next;
  }

  moveTo(target: THREE.Vector3): boolean {
    if (this.seated) return false;
    const path = this.nav.findPath(this.root.position, target);
    if (!path.length) return false;
    this.path = path.slice(1);
    this.moving = this.path.length > 0;
    if (this.moving) this.play('ANIM_WALK_001');
    return this.moving;
  }

  stop(): void {
    this.path = []; this.moving = false;
    if (!this.seated) this.play('ANIM_IDLE_001');
  }

  sitAt(position: THREE.Vector3, yawRadians: number, typing = false): void {
    this.stop();
    this.root.position.copy(position);
    this.root.rotation.z = yawRadians;
    this.seated = true;
    this.play(typing ? 'ANIM_TYPING_001' : 'ANIM_SIT_001');
  }

  stand(): void {
    this.seated = false;
    this.play('ANIM_STAND_UP_001');
    window.setTimeout(() => this.play('ANIM_IDLE_001'), 850);
  }

  update(dt: number): void {
    this.mixer?.update(dt);
    if (!this.moving || !this.path.length) return;
    const target = this.path[0]!;
    const delta = target.clone().sub(this.root.position);
    delta.z = 0;
    const distance = delta.length();
    if (distance < 0.06) {
      this.path.shift();
      if (!this.path.length) this.stop();
      return;
    }
    const dir = delta.normalize();
    const desired = Math.atan2(dir.y, dir.x) - Math.PI / 2;
    let diff = desired - this.root.rotation.z;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.root.rotation.z += diff * Math.min(1, dt * 9);
    this.root.position.addScaledVector(dir, Math.min(distance, this.speed * dt));
  }
}
