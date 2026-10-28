import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { GameUI } from '../ui.ts';
import { createCharacter } from './character.ts';
import { createAnimal } from './animal.ts';
import type { Palette } from './models.ts';
import type { Obstacle, Point } from './movement.ts';
import { RESIDENTS, RESIDENT_OBSTACLES, wanderSettings } from './resident-data.ts';
import { createWanderState, seededRandom, stepWander } from './wander.ts';
import { PLAYER_RADIUS } from './world-data.ts';

export function createResidents(scene: Scene, p: Palette, shadows: ShadowGenerator, ui: GameUI) {
  const seed = import.meta.env.VITE_E2E === 'true' ? 624 : Math.floor(Math.random() * 0xffffffff);
  const actors = RESIDENTS.map((definition, index) => {
    const random = seededRandom(seed + (index + 1) * 1337);
    const settings = wanderSettings(definition);
    const state = createWanderState(definition.spawn, settings, RESIDENT_OBSTACLES, random);
    const human = definition.role === 'dog' ? undefined : createCharacter(scene, p, shadows, {
      id: definition.id, role: definition.role, marker: false, phase: index * 1.2, mounted: definition.role === 'cavalry',
    });
    const animal = definition.role === 'dog' || definition.role === 'cavalry'
      ? createAnimal(scene, p, shadows, definition.role === 'dog' ? 'dog' : 'horse', `${definition.id}-animal`) : undefined;
    const root = animal?.root ?? human!.root;
    if (definition.role === 'cavalry' && human) {
      human.root.parent = root; human.root.position.set(0, 0.88, -0.1);
    }
    root.position.set(state.position.x, 0, state.position.z);
    human?.update(0, 0, 0); animal?.update(0, 0, 0);
    const label = ui.addResidentLabel(definition.id, definition.name);
    return { definition, random, settings, state, human, animal, root, label };
  });
  const labelPoint = new Vector3();
  const identity = Matrix.Identity();
  return {
    update(seconds: number, player: Point) {
      for (const actor of actors) {
        if (seconds <= 0) continue;
        const crowd: Obstacle[] = actors.filter((other) => other !== actor).map((other) => ({
          kind: 'circle', x: other.state.position.x, z: other.state.position.z, radius: other.definition.bodyRadius,
        }));
        crowd.push({ kind: 'circle', x: player.x, z: player.z, radius: PLAYER_RADIUS + 0.1 });
        // If the controllable player steps into a resident, let the resident leave the overlap.
        const blockers = crowd.filter((other) => other.kind === 'circle'
          && Math.hypot(other.x - actor.state.position.x, other.z - actor.state.position.z) >= other.radius + actor.settings.bodyRadius - 0.001);
        const velocity = stepWander(actor.state, actor.settings, seconds, [...RESIDENT_OBSTACLES, ...blockers], actor.random);
        actor.root.position.set(actor.state.position.x, 0, actor.state.position.z);
        actor.human?.update(seconds, velocity.x, velocity.z);
        actor.animal?.update(seconds, velocity.x, velocity.z);
      }
    },
    updateLabels(camera: Camera) {
      const width = ui.canvas.clientWidth, height = ui.canvas.clientHeight;
      const viewport = camera.viewport.toGlobal(width, height);
      for (const actor of actors) {
        labelPoint.set(actor.state.position.x, actor.definition.labelHeight, actor.state.position.z);
        const projected = Vector3.Project(labelPoint, identity, scene.getTransformMatrix(), viewport);
        const visible = projected.z >= 0 && projected.z <= 1 && projected.x > 15 && projected.x < width - 15 && projected.y > 15 && projected.y < height - 55;
        actor.label.hidden = !visible;
        if (visible) actor.label.style.transform = `translate(${projected.x}px, ${projected.y}px) translate(-50%, -100%)`;
      }
    },
    snapshot: () => actors.map((actor) => ({
      id: actor.definition.id, role: actor.definition.role,
      position: { ...actor.state.position }, state: actor.state.target ? 'walking' : 'idle',
      travelled: actor.state.distanceTravelled, reached: actor.state.destinationsReached,
      bodyRadius: actor.definition.bodyRadius,
      humanBones: actor.human?.skeleton.bones.map((bone) => bone.name) ?? [],
      animalBones: actor.animal?.skeleton.bones.map((bone) => bone.name) ?? [],
      humanRigId: actor.human?.skeleton.uniqueId,
      parts: [...(actor.human?.partNames ?? []), ...(actor.animal?.partNames ?? [])],
      pose: (actor.human ?? actor.animal)!.skeleton.bones.map((bone) => bone.getRotation().asArray()),
    })),
  };
}
