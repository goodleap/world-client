import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';

/** Pause only visual evaluation, retaining phase on the game's capped clock.
 * Commands, movement, combat settlement and needs continue independently. */
export class AnimationVisibility {
  private sleeping = new WeakMap<AnimationGroup, number>();
  reset(...groups: (AnimationGroup | undefined)[]) { for (const group of groups) if (group) this.sleeping.delete(group); }
  update(group: AnimationGroup | undefined, visible: boolean, seconds: number) {
    if (!group) return;
    if (!group.isStarted) { this.sleeping.delete(group); return; }
    const asleep = this.sleeping.get(group);
    if (visible) {
      if (asleep !== undefined) { group.goToFrame(asleep); group.play(true); this.sleeping.delete(group); }
      return;
    }
    // Externally paused clips (notably authoritative attack poses) stay paused.
    if (asleep === undefined && !group.isPlaying) return;
    const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    const span = group.to - group.from;
    const frame = (asleep ?? group.animatables[0]?.masterFrame ?? group.from) + Math.max(0, seconds) * fps * group.speedRatio;
    const wrapped = span > 0 ? group.from + ((frame - group.from) % span + span) % span : group.from;
    group.pause(); this.sleeping.set(group, wrapped);
  }
}
