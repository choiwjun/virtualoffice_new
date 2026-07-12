import { AnimationGroup, Observable, Scene } from "@babylonjs/core";

export type VirtualOfficeClipId =
  | "ANIM_IDLE_001" | "ANIM_WALK_001" | "ANIM_SIT_001"
  | "ANIM_SIT_DOWN_001" | "ANIM_STAND_UP_001" | "ANIM_TYPING_001"
  | "ANIM_TALK_001" | "ANIM_WAVE_001" | "ANIM_MEETING_IDLE_001"
  | "ANIM_POINT_001" | "ANIM_PHONE_CALL_001" | "ANIM_CLAP_001";

const LOOPING = new Set<VirtualOfficeClipId>([
  "ANIM_IDLE_001", "ANIM_WALK_001", "ANIM_SIT_001", "ANIM_TYPING_001",
  "ANIM_TALK_001", "ANIM_MEETING_IDLE_001", "ANIM_PHONE_CALL_001", "ANIM_CLAP_001",
]);

export class VirtualOfficeAvatarControllerV9 {
  private groups = new Map<VirtualOfficeClipId, AnimationGroup>();
  private active?: AnimationGroup;
  private fadeObserver?: ReturnType<Observable<Scene>["add"]>;

  constructor(private readonly scene: Scene, animationGroups: AnimationGroup[]) {
    for (const group of animationGroups) this.groups.set(group.name as VirtualOfficeClipId, group);
  }

  play(clipId: VirtualOfficeClipId, fadeSeconds = 0.18): void {
    const next = this.groups.get(clipId);
    if (!next) throw new Error(`Missing animation group: ${clipId}`);
    if (this.active === next && next.isPlaying) return;

    if (this.fadeObserver) this.scene.onBeforeRenderObservable.remove(this.fadeObserver);
    const previous = this.active;
    next.reset();
    next.setWeightForAllAnimatables(0);
    next.start(LOOPING.has(clipId), 1.0);
    const started = performance.now();

    this.fadeObserver = this.scene.onBeforeRenderObservable.add(() => {
      const t = Math.min((performance.now() - started) / Math.max(fadeSeconds * 1000, 1), 1);
      next.setWeightForAllAnimatables(t);
      previous?.setWeightForAllAnimatables(1 - t);
      if (t >= 1) {
        previous?.stop();
        if (this.fadeObserver) this.scene.onBeforeRenderObservable.remove(this.fadeObserver);
        this.fadeObserver = undefined;
      }
    });
    this.active = next;
  }

  dispose(): void {
    if (this.fadeObserver) this.scene.onBeforeRenderObservable.remove(this.fadeObserver);
    for (const group of this.groups.values()) group.stop();
    this.groups.clear();
  }
}
