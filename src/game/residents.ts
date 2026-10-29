import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { GameUI } from '../ui.ts';
import { createCharacter } from './character.ts';
import { createAnimal } from './animal.ts';
import { applyCharacterColors } from './models.ts';
import type { Palette } from './models.ts';
import type { Obstacle, Point } from './movement.ts';
import { RESIDENTS, RESIDENT_OBSTACLES, wanderSettings } from './resident-data.ts';
import { createWanderState, seededRandom, stepWander } from './wander.ts';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { moveCharacter } from './movement.ts';
import { findPath } from './pathfinding.ts';
import { ImportMeshAsync, LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import farmerModelUrl from '../../studies/farmer/farmer-scarf.glb?url';
import baseModelUrl from '../../studies/base-human/base-human.glb?url';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Bone } from '@babylonjs/core/Bones/bone';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Material } from '@babylonjs/core/Materials/material';

export function createResidents(scene: Scene, p: Palette, shadows: ShadowGenerator, ui: GameUI) {
  const placeholderRoles = new Set(['worker', 'infantry', 'archer', 'cavalry']);
  const seed = import.meta.env.VITE_E2E === 'true' ? 624 : Math.floor(Math.random() * 0xffffffff);
  const actors = RESIDENTS.map((definition, index) => {
    const random = seededRandom(seed + (index + 1) * 1337);
    const settings = wanderSettings(definition);
    const state = createWanderState(definition.spawn, settings, RESIDENT_OBSTACLES, random);
    const human = definition.role === 'dog' ? undefined : createCharacter(scene, p, shadows, {
      id: definition.id, role: definition.role === 'base' ? 'traveler' : definition.role, marker: false, phase: index * 1.2, mounted: definition.role === 'cavalry',
    });
    const animal = definition.role === 'dog' || definition.role === 'cavalry'
      ? createAnimal(scene, p, shadows, definition.role === 'dog' ? 'dog' : 'horse', `${definition.id}-animal`) : undefined;
    const root = animal?.root ?? human!.root;
    if (definition.role === 'cavalry' && human) {
      human.root.parent = root; human.root.position.set(0, 0.88, -0.1);
    }
    root.position.set(state.position.x, 0, state.position.z);
    const hit = MeshBuilder.CreateSphere(`${definition.id}-hit`, { diameter: 1.5 }, scene);
    hit.parent = root; hit.position.y = definition.role === 'cavalry' ? 1.6 : 1.0; hit.scaling.y = 1.5; hit.visibility = 0;
    hit.metadata = { selectionKind: 'resident', id: definition.id };
    const marker = MeshBuilder.CreateTorus(`${definition.id}-selection`, { diameter: 1.3, thickness: 0.055, tessellation: 32 }, scene);
    marker.parent = root; marker.position.y = 0.08; marker.material = p.pathLight; marker.isPickable = false; marker.setEnabled(false);
    human?.update(0, 0, 0); animal?.update(0, 0, 0);
    const label = ui.addResidentLabel(definition.id, placeholderRoles.has(definition.role) ? `${definition.name}（占位）` : definition.name);
    return { definition, random, settings, state, human, animal, root, label, marker, route: [] as Point[] };
  });
  const labelPoint = new Vector3();
  const identity = Matrix.Identity();
  const farmer = actors.find((actor) => actor.definition.role === 'farmer')!;
  const baseHuman = actors.find((actor) => actor.definition.role === 'base')!;
  let farmerModelLoaded = false;
  let baseModelLoaded = false;
  let selected: typeof actors[number] | undefined;
  let farmerWalk: AnimationGroup | undefined;
  let baseWalk: AnimationGroup | undefined;
  let baseRun: AnimationGroup | undefined;
  let baseBones: Bone[] = [];
  let baseMeshNames: string[] = [];
  type Motion = 'idle' | 'walk' | 'run';
  type Locomotion = { walk: AnimationGroup; run: AnimationGroup; motion: Motion };
  const locomotion = new Map<string, Locomotion>();
  const prepareBaseMaterials = (materials: readonly (Material | null)[]) => {
    for (const material of new Set(materials)) {
      // Match the new PBR asset to this scene's light levels, retaining its
      // original albedo and facial vertex colors rather than recoloring it.
      if (material instanceof PBRMaterial) {
        const cotton = material.name === 'Warm ivory cotton' || material.name === 'Cotton hems';
        material.directIntensity = cotton ? 1.35 : 1.65;
      }
    }
  };
  const setWalking = (group: AnimationGroup | undefined, walking: boolean) => {
    if (!group) return;
    if (walking && !group.isPlaying) group.play(true);
    if (!walking && group.isPlaying) { group.stop(); group.reset(); }
  };
  const setFarmerWalking = (walking: boolean) => {
    setWalking(farmerWalk, walking);
  };
  const registerLocomotion = (id: string, walk: AnimationGroup, run: AnimationGroup) => {
    walk.stop(); run.stop(); walk.reset();
    locomotion.set(id, { walk, run, motion: 'idle' });
  };
  const setMotion = (id: string, motion: Motion, speed = 0) => {
    const clips = locomotion.get(id);
    if (!clips) return;
    if (motion !== clips.motion) {
      clips.walk.stop(); clips.run.stop();
      // Run starts at a running phase. Walk's first frame carries the complete
      // neutral pose, so stopping Run must reset Walk rather than reset Run.
      if (motion === 'idle') clips.walk.reset();
      else (motion === 'run' ? clips.run : clips.walk).play(true);
      clips.motion = motion;
    }
    if (motion !== 'idle') {
      const clip = motion === 'run' ? clips.run : clips.walk;
      clip.speedRatio = speed / (motion === 'run' ? 2.1 : 1.15);
    }
  };
  return {
    async loadFarmerModel() {
      const result = await ImportMeshAsync(farmerModelUrl, scene);
      applyCharacterColors(result.meshes.map((mesh) => mesh.material));
      farmerWalk = result.animationGroups.find((group) => group.name === 'Walk');
      if (!farmerWalk) throw new Error('Farmer model is missing its walk animation');
      farmerWalk.stop(); farmerWalk.reset();
      result.meshes[0].parent = farmer.root;
      farmer.human!.mesh.setEnabled(false);
      for (const mesh of result.meshes) mesh.isPickable = false;
      farmerModelLoaded = true;
    },
    async loadBaseModel() {
      const result = await ImportMeshAsync(baseModelUrl, scene);
      // Preserve the approved model's own skin, face vertex colors and cotton.
      prepareBaseMaterials(result.meshes.map((mesh) => mesh.material));
      baseBones = result.skeletons.flatMap((skeleton) => skeleton.bones);
      baseMeshNames = result.meshes.map((mesh) => mesh.name);
      baseWalk = result.animationGroups.find((group) => group.name === 'Walk');
      baseRun = result.animationGroups.find((group) => group.name === 'Run');
      if (!baseWalk || !baseRun) throw new Error('Base character model needs Walk and Run animations');
      registerLocomotion(baseHuman.definition.id, baseWalk, baseRun);
      result.meshes[0].parent = baseHuman.root;
      baseHuman.human!.mesh.setEnabled(false);
      for (const mesh of result.meshes) {
        mesh.isPickable = false;
        if (mesh.getTotalVertices()) shadows.addShadowCaster(mesh, false);
      }
      baseModelLoaded = true;
    },
    async loadRolePlaceholders() {
      const container = await LoadAssetContainerAsync(baseModelUrl, scene);
      prepareBaseMaterials(container.materials);
      for (const actor of actors.filter((entry) => placeholderRoles.has(entry.definition.role))) {
        const instance = container.instantiateModelsToScene((name) => `${actor.definition.id}-${name}`, false, { doNotInstantiate: true });
        const walk = instance.animationGroups.find((group) => group.name.endsWith('-Walk'));
        const run = instance.animationGroups.find((group) => group.name.endsWith('-Run'));
        if (!walk || !run) throw new Error(`Missing locomotion animations for ${actor.definition.id}`);
        registerLocomotion(actor.definition.id, walk, run);
        for (const root of instance.rootNodes) {
          root.parent = actor.root;
          for (const mesh of root.getChildMeshes()) {
            mesh.isPickable = false;
            if (mesh.getTotalVertices()) shadows.addShadowCaster(mesh, false);
          }
        }
        actor.human?.mesh.setEnabled(false);
        if (actor.definition.role === 'cavalry') actor.animal?.mesh.setEnabled(false);
      }
    },
    farmerPosition: () => farmer.root.position,
    basePosition: () => baseHuman.root.position,
    baseModelInfo: () => ({
      meshes: baseMeshNames,
      bones: baseBones.map((bone) => bone.name),
      pose: baseBones.map((bone) => (bone.getTransformNode()?.rotationQuaternion ?? bone.getRotationQuaternion()).asArray()),
      motion: locomotion.get(baseHuman.definition.id)?.motion ?? 'idle',
      animations: [baseWalk?.name, baseRun?.name].filter(Boolean),
    }),
    farmerModelLoaded: () => farmerModelLoaded,
    baseModelLoaded: () => baseModelLoaded,
    baseWalking: () => baseWalk?.isPlaying ?? false,
    baseRunning: () => baseRun?.isPlaying ?? false,
    farmerWalking: () => farmerWalk?.isPlaying ?? false,
    farmerLegPose: () => scene.getTransformNodeByName('thigh.L')?.rotationQuaternion?.asArray() ?? [],
    select(id?: string) {
      selected?.marker.setEnabled(false);
      selected = actors.find((actor) => actor.definition.id === id && actor.definition.role !== 'dog');
      selected?.marker.setEnabled(true);
      return selected?.definition.name;
    },
    selectedId: () => selected?.definition.id,
    command(point: Point) {
      if (!selected) return false;
      const path = findPath(selected.state.position, point, selected.settings.bodyRadius, selected.settings.bounds, RESIDENT_OBSTACLES);
      if (!path) return false;
      selected.route = path; selected.state.target = undefined; selected.state.pause = 0;
      return true;
    },
    update(seconds: number, previewRole?: 'farmer' | 'base') {
      for (const actor of actors) {
        if (previewRole === actor.definition.role && (actor === farmer || actor === baseHuman)) {
          actor.root.rotationQuaternion ??= Quaternion.Identity();
          Quaternion.RotationYawPitchRollToRef(Math.PI, 0, 0, actor.root.rotationQuaternion);
          if (actor === farmer) {
            if (farmerWalk) farmerWalk.speedRatio = 1;
            setFarmerWalking(seconds > 0);
          }
          else setMotion(actor.definition.id, 'idle');
          continue;
        }
        if (seconds <= 0) { if (actor === farmer) setFarmerWalking(false); setMotion(actor.definition.id, 'idle'); continue; }
        const crowd: Obstacle[] = actors.filter((other) => other !== actor).map((other) => ({
          kind: 'circle', x: other.state.position.x, z: other.state.position.z, radius: other.definition.bodyRadius,
        }));
        const blockers = crowd.filter((other) => other.kind === 'circle'
          && Math.hypot(other.x - actor.state.position.x, other.z - actor.state.position.z) >= other.radius + actor.settings.bodyRadius - 0.001);
        let velocity: Point;
        const commanded = actor.route.length > 0;
        if (actor.route.length) {
          const target = actor.route[0], before = actor.state.position;
          const dx = target.x - before.x, dz = target.z - before.z, distance = Math.hypot(dx, dz);
          const next = moveCharacter(before, { x: dx / (distance || 1), z: dz / (distance || 1) }, seconds,
            Math.min(actor.settings.speed * (2.1 / 1.15), distance / seconds), actor.settings.bounds, [...RESIDENT_OBSTACLES, ...blockers], actor.settings.bodyRadius);
          velocity = { x: (next.x - before.x) / seconds, z: (next.z - before.z) / seconds };
          const moved = Math.hypot(next.x - before.x, next.z - before.z);
          actor.state.position = next; actor.state.distanceTravelled += moved;
          if (Math.hypot(target.x - next.x, target.z - next.z) < 0.08) actor.route.shift();
          actor.state.blockedFor = moved < 0.002 ? actor.state.blockedFor + seconds : 0;
          if (actor.state.blockedFor > 1) {
            const goal = actor.route[actor.route.length - 1];
            actor.route = findPath(next, goal, actor.settings.bodyRadius, actor.settings.bounds, [...RESIDENT_OBSTACLES, ...blockers]) ?? actor.route;
            actor.state.blockedFor = 0;
          }
          if (!actor.route.length) actor.state.pause = 3;
        } else if (actor === selected) velocity = { x: 0, z: 0 };
        else velocity = stepWander(actor.state, actor.settings, seconds, [...RESIDENT_OBSTACLES, ...blockers], actor.random);
        const speed = Math.hypot(velocity.x, velocity.z);
        if (actor === farmer) {
          if (farmerWalk) farmerWalk.speedRatio = speed / 1.15;
          setFarmerWalking(speed > 0.08);
        }
        setMotion(actor.definition.id, speed > 0.08 ? commanded ? 'run' : 'walk' : 'idle', speed);
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
      placeholder: placeholderRoles.has(actor.definition.role) && locomotion.has(actor.definition.id),
      placeholderWalking: placeholderRoles.has(actor.definition.role) && (locomotion.get(actor.definition.id)?.walk.isPlaying ?? false),
      placeholderRunning: placeholderRoles.has(actor.definition.role) && (locomotion.get(actor.definition.id)?.run.isPlaying ?? false),
      legacyVisible: !!actor.human?.mesh.isEnabled() || (actor.definition.role === 'cavalry' && !!actor.animal?.mesh.isEnabled()),
      position: { ...actor.state.position }, state: actor.state.target ? 'walking' : 'idle',
      facing: actor.root.rotationQuaternion?.asArray() ?? [],
      routeRemaining: actor.route.length,
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
