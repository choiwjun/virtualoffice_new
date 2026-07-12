import * as THREE from 'three';
import { VirtualOfficeRuntime, type LoadedAvatar, type ClipId } from './VirtualOfficeRuntime.js';

interface SceneManifest {
  environment_glb: string;
  characters: Array<{
    file: string;
    position: [number, number, number];
    rotation_euler_deg: [number, number, number];
    initial_state: string;
  }>;
}

export async function loadRiggedOffice(
  scene: THREE.Scene,
  manifestUrl: string,
  baseUrl = '/',
): Promise<{ environment: THREE.Object3D; avatars: LoadedAvatar[] }> {
  const runtime = new VirtualOfficeRuntime(baseUrl);
  const manifest = await fetch(baseUrl + manifestUrl).then((r) => {
    if (!r.ok) throw new Error(`Failed to load manifest: ${r.status}`);
    return r.json() as Promise<SceneManifest>;
  });
  const environment = await runtime.loadScene(manifest.environment_glb);
  scene.add(environment);
  const avatars: LoadedAvatar[] = [];
  for (const item of manifest.characters) {
    const avatar = await runtime.loadAvatar(item.file);
    avatar.root.position.fromArray(item.position);
    avatar.root.rotation.set(...item.rotation_euler_deg.map(THREE.MathUtils.degToRad) as [number, number, number]);
    scene.add(avatar.root);
    avatar.play(item.initial_state.toUpperCase().startsWith('ANIM_')
      ? item.initial_state as ClipId
      : (`ANIM_${item.initial_state.toUpperCase()}_001` as ClipId));
    avatars.push(avatar);
  }
  return { environment, avatars };
}
