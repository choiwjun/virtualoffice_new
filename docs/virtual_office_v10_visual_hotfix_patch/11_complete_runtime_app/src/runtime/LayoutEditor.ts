import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AssetRecord, LayoutInstance, LayoutPreset, Vec3 } from '../types.js';
import { AssetStore } from './AssetStore.js';
import type { ObstacleRect } from './GridNav.js';

interface RuntimeInstance { spec: LayoutInstance; root: THREE.Object3D; record: AssetRecord; mixer?: THREE.AnimationMixer; }

export class LayoutEditor extends EventTarget {
  instances = new Map<string, RuntimeInstance>();
  selected?: RuntimeInstance;
  transform: TransformControls;
  helper = new THREE.BoxHelper(new THREE.Group(), 0x3d7bff);
  gridSize = 0.25;
  mode: 'translate' | 'rotate' = 'translate';

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private renderer: THREE.WebGLRenderer,
    private orbit: OrbitControls,
    private store: AssetStore,
  ) {
    super();
    this.transform = new TransformControls(camera, renderer.domElement);
    this.transform.setSpace('world');
    this.transform.setTranslationSnap(this.gridSize);
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(15));
    this.transform.addEventListener('dragging-changed', (event) => { this.orbit.enabled = !event.value; });
    this.transform.addEventListener('objectChange', () => {
      if (!this.selected) return;
      const p = this.selected.root.position;
      p.z = 0;
      this.selected.spec.position = [p.x, p.y, p.z];
      this.selected.spec.rotation_z_deg = THREE.MathUtils.radToDeg(this.selected.root.rotation.z);
      this.helper.update();
      this.dispatchEvent(new Event('layoutchange'));
    });
    scene.add(this.transform.getHelper());
    scene.add(this.helper);
    this.helper.visible = false;
  }

  async spawn(assetId: string, position: Vec3 = [0, 0, 0], rotationZDeg = 0, id?: string): Promise<RuntimeInstance> {
    const record = this.store.get(assetId);
    const bundle = await this.store.instantiateBundle(assetId);
    const root = bundle.root;
    root.position.fromArray(position);
    root.rotation.z = THREE.MathUtils.degToRad(rotationZDeg);
    const instanceId = id ?? `${assetId}_${crypto.randomUUID().slice(0, 8)}`;
    root.userData.instanceId = instanceId;
    this.scene.add(root);
    const spec: LayoutInstance = { instance_id: instanceId, asset_id: assetId, position: [...position] as Vec3, rotation_z_deg: rotationZDeg, scale: [1, 1, 1] };
    let mixer: THREE.AnimationMixer | undefined;
    if (bundle.animations.length > 0) {
      mixer = new THREE.AnimationMixer(root);
      const idle = bundle.animations.find((clip) => clip.name === 'ANIM_IDLE_001') ?? bundle.animations[0];
      if (idle) mixer.clipAction(idle).reset().play();
    }
    const runtime: RuntimeInstance = { spec, root, record, mixer };
    this.instances.set(instanceId, runtime);
    this.dispatchEvent(new Event('layoutchange'));
    return runtime;
  }

  async loadPreset(preset: LayoutPreset): Promise<void> {
    this.clear();
    for (const item of preset.instances) await this.spawn(item.asset_id, item.position, item.rotation_z_deg, item.instance_id);
    this.dispatchEvent(new Event('layoutchange'));
  }

  clear(): void {
    for (const item of this.instances.values()) this.scene.remove(item.root);
    this.instances.clear();
    this.select(undefined);
  }

  select(item?: RuntimeInstance): void {
    this.selected = item;
    if (!item) {
      this.transform.detach(); this.helper.visible = false;
    } else {
      this.transform.attach(item.root);
      this.transform.setMode(this.mode);
      this.helper.setFromObject(item.root); this.helper.visible = true;
    }
    this.dispatchEvent(new CustomEvent('selectionchange', { detail: item }));
  }

  pick(raycaster: THREE.Raycaster): RuntimeInstance | undefined {
    const roots = [...this.instances.values()].map((i) => i.root);
    const hit = raycaster.intersectObjects(roots, true)[0];
    if (!hit) return undefined;
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.userData.instanceId) object = object.parent;
    return object ? this.instances.get(object.userData.instanceId as string) : undefined;
  }

  setMode(mode: 'translate' | 'rotate'): void { this.mode = mode; this.transform.setMode(mode); }

  async duplicateSelected(): Promise<void> {
    if (!this.selected) return;
    const p = this.selected.root.position.clone().add(new THREE.Vector3(0.5, 0.5, 0));
    const copy = await this.spawn(this.selected.spec.asset_id, [p.x, p.y, 0], this.selected.spec.rotation_z_deg);
    this.select(copy);
  }

  deleteSelected(): void {
    if (!this.selected) return;
    this.scene.remove(this.selected.root);
    this.instances.delete(this.selected.spec.instance_id);
    this.select(undefined);
    this.dispatchEvent(new Event('layoutchange'));
  }

  exportLayout(name = 'Custom Office'): LayoutPreset {
    return {
      version: '10.0', preset_id: `CUSTOM_${Date.now()}`, name,
      bounds_xy: [-7, -5, 7, 5], avatar_spawn: [0, -3.5, 0],
      instances: [...this.instances.values()].map((i) => ({ ...i.spec, position: [...i.spec.position] as Vec3, scale: [...(i.spec.scale ?? [1, 1, 1])] as Vec3 })),
    };
  }

  update(dt: number): void {
    for (const item of this.instances.values()) item.mixer?.update(dt);
  }

  getObstacles(): ObstacleRect[] {
    const obstacles: ObstacleRect[] = [];
    for (const item of this.instances.values()) {
      const collision = item.record.collision;
      if (!collision?.size) continue;
      const [w, d] = collision.size;
      // Do not block very thin floor/rug assets and explicitly walkable categories.
      if ((item.record.type ?? '').includes('floor') || item.record.category === 'decor' && (item.record.type ?? '').includes('rug')) continue;
      const yaw = item.root.rotation.z;
      const cw = Math.abs(Math.cos(yaw)), sw = Math.abs(Math.sin(yaw));
      const extX = (w * cw + d * sw) / 2;
      const extY = (w * sw + d * cw) / 2;
      obstacles.push({ minX: item.root.position.x - extX, maxX: item.root.position.x + extX, minY: item.root.position.y - extY, maxY: item.root.position.y + extY });
    }
    return obstacles;
  }

  nearestInteraction(position: THREE.Vector3, maxDistance = 1.35): { position: THREE.Vector3; yaw: number; typing: boolean; label: string } | undefined {
    let best: { position: THREE.Vector3; yaw: number; typing: boolean; label: string; distance: number } | undefined;
    for (const item of this.instances.values()) {
      const anchors = item.record.anchors ?? {};
      for (const [name, anchor] of Object.entries(anchors)) {
        if (!/(seat|work|meeting)/i.test(name)) continue;
        const local = new THREE.Vector3(...anchor.position);
        local.applyAxisAngle(new THREE.Vector3(0, 0, 1), item.root.rotation.z).add(item.root.position);
        const distance = local.distanceTo(position);
        if (distance > maxDistance || (best && distance >= best.distance)) continue;
        const rz = anchor.rotation?.[2] ?? 0;
        best = { position: local, yaw: item.root.rotation.z + THREE.MathUtils.degToRad(rz), typing: /work/i.test(name), label: `${item.record.asset_id} · ${name}`, distance };
      }
    }
    return best;
  }
}
