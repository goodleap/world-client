import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { Palette } from './models.ts';
import type { Point } from './movement.ts';
import { ellipsoid, roundedBox } from './environment-shapes.ts';

type Building = Point & { id: string; depth: number };
const OPEN = .3, HOLD_END = 1.2, END = 1.55, ANGLE = Math.PI * .38;

/** One native hinge track per building. Only active doors consume game time;
 * the paused AnimationGroup is sampled by the same clock as the simulation. */
export function createBuildingDoors(scene: Scene, p: Palette, shadows?: ShadowGenerator) {
  const doors = new Map<string, { hinge: TransformNode; clip: AnimationGroup; time: number; uses: number; point: Point; warehouse: boolean }>();
  const active = new Set<string>();
  return {
    add(b: Building, warehouse = false) {
      if (doors.has(b.id)) return;
      const hinge = new TransformNode(`${b.id}-door-hinge`, scene);
      hinge.position.set(b.x - .85, 0, b.z - b.depth / 2 - .13);
      const leaf = roundedBox(scene, `${b.id}-door-leaf`, [1, 1.96, .12], [.5, 1.19, 0], p.sage, .035);
      const knob = ellipsoid(scene, `${b.id}-door-knob`, [.13, .13, .12], [.82, 1.1, -.11], p.golden);
      for (const mesh of [leaf, knob]) {
        mesh.parent = hinge; mesh.metadata = { worldObjectId: b.id, animatedDoor: true, castsShadow: true };
        mesh.isPickable = true; mesh.receiveShadows = true; shadows?.addShadowCaster(mesh, false);
      }
      const track = new Animation(`${b.id}-door-turn`, 'rotation.y', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
      track.setKeys([{ frame: 0, value: 0 }, { frame: OPEN * 60, value: ANGLE }, { frame: HOLD_END * 60, value: ANGLE }, { frame: END * 60, value: 0 }]);
      const clip = new AnimationGroup(`${b.id}-door-use`, scene); clip.addTargetedAnimation(track, hinge);
      doors.set(b.id, { hinge, clip, time: 0, uses: 0, point: { x: b.x, z: b.z - b.depth / 2 - .75 }, warehouse });
    },
    use(id: string) {
      const door = doors.get(id); if (!door) return;
      // A second visitor extends the opening without snapping a moving leaf.
      door.time = OPEN * door.hinge.rotation.y / ANGLE; door.uses++;
      if (!active.has(id)) door.clip.start(false).pause();
      door.clip.goToFrame(door.time * 60); active.add(id);
    },
    useWarehouse(from?: Point) {
      const candidates = [...doors].filter(([, door]) => door.warehouse);
      if (from) candidates.sort(([, a], [, b]) => Math.hypot(a.point.x - from.x, a.point.z - from.z) - Math.hypot(b.point.x - from.x, b.point.z - from.z));
      if (candidates[0]) this.use(candidates[0][0]);
    },
    update(seconds: number) {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      for (const id of active) {
        const door = doors.get(id)!; door.time = Math.min(END, door.time + seconds);
        door.clip.goToFrame(door.time * 60);
        if (door.time === END) { door.clip.stop(); door.hinge.rotation.y = 0; active.delete(id); }
      }
    },
    remove(id: string) {
      const door = doors.get(id); if (!door) return;
      for (const mesh of door.hinge.getChildMeshes()) shadows?.removeShadowCaster(mesh, false);
      door.clip.dispose(); door.hinge.dispose(); active.delete(id); doors.delete(id);
    },
    snapshot: () => [...doors].map(([id, d]) => ({ id, angle: d.hinge.rotation.y, active: active.has(id), uses: d.uses })),
  };
}
export type BuildingDoors = ReturnType<typeof createBuildingDoors>;
