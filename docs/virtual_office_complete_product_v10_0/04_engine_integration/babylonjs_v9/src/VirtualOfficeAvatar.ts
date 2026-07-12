import '@babylonjs/loaders/glTF';
import { AbstractMesh, AnimationGroup, Scene, SceneLoader, TransformNode } from '@babylonjs/core';

export class VirtualOfficeAvatar {
  root!: TransformNode;
  meshes: AbstractMesh[] = [];
  clips = new Map<string, AnimationGroup>();
  active?: AnimationGroup;

  static async load(scene: Scene, rootUrl: string, fileName: string) {
    const result = await SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene);
    const avatar = new VirtualOfficeAvatar();
    avatar.root = result.transformNodes[0] ?? result.meshes[0];
    avatar.meshes = result.meshes;
    for (const group of result.animationGroups) avatar.clips.set(group.name, group);
    return avatar;
  }

  play(clipId: string, loop = true) {
    this.active?.stop();
    const next = this.clips.get(clipId);
    if (!next) throw new Error(`Missing clip ${clipId}`);
    next.start(loop, 1.0, next.from, next.to, false);
    this.active = next;
  }
}
