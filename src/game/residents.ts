import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
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
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import farmerModelUrl from '../../studies/farmer/farmer-scarf.glb?url';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';

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
  const farmer = actors.find((actor) => actor.definition.role === 'farmer')!;
  let farmerModelLoaded = false;
  let farmerWalk: AnimationGroup | undefined;
  const setFarmerWalking = (walking: boolean) => {
    if (!farmerWalk) return;
    if (walking && !farmerWalk.isPlaying) farmerWalk.play(true);
    if (!walking && farmerWalk.isPlaying) { farmerWalk.stop(); farmerWalk.reset(); }
  };
  return {
    async loadFarmerModel() {
      const result = await ImportMeshAsync(farmerModelUrl, scene);
      farmerWalk = result.animationGroups.find((group) => group.name === 'Walk');
      if (!farmerWalk) throw new Error('Farmer model is missing its walk animation');
      farmerWalk.stop(); farmerWalk.reset();
      result.meshes[0].parent = farmer.root;
      farmer.human!.mesh.setEnabled(false);
      for (const mesh of result.meshes) mesh.isPickable = false;
      farmerModelLoaded = true;
    },
    farmerPosition: () => farmer.root.position,
    farmerModelLoaded: () => farmerModelLoaded,
    farmerWalking: () => farmerWalk?.isPlaying ?? false,
    farmerLegPose: () => scene.getTransformNodeByName('thigh.L')?.rotationQuaternion?.asArray() ?? [],
    update(seconds: number, player: Point, previewFarmer = false) {
      for (const actor of actors) {
        if (previewFarmer && actor === farmer) {
          actor.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(Math.PI, 0, 0);
          setFarmerWalking(seconds > 0);
          continue;
        }
        if (seconds <= 0) { if (actor === farmer) setFarmerWalking(false); continue; }
        const crowd: Obstacle[] = actors.filter((other) => other !== actor).map((other) => ({
          kind: 'circle', x: other.state.position.x, z: other.state.position.z, radius: other.definition.bodyRadius,
        }));
        crowd.push({ kind: 'circle', x: player.x, z: player.z, radius: PLAYER_RADIUS + 0.1 });
        // If the controllable player steps into a resident, let the resident leave the overlap.
        const blockers = crowd.filter((other) => other.kind === 'circle'
          && Math.hypot(other.x - actor.state.position.x, other.z - actor.state.position.z) >= other.radius + actor.settings.bodyRadius - 0.001);
        const velocity = stepWander(actor.state, actor.settings, seconds, [...RESIDENT_OBSTACLES, ...blockers], actor.random);
        if (actor === farmer) setFarmerWalking(Math.hypot(velocity.x, velocity.z) > 0.08);
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
