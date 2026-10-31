import type { SavedResident } from './economy.ts';
import { isBlocked } from './movement.ts';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { loadingProgress } from '../loading-progress.ts';
import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { GameUI } from '../ui.ts';
import { createCharacter } from './character.ts';
import { createAnimal } from './animal.ts';
import type { Palette } from './models.ts';
import type { Obstacle, Point } from './movement.ts';
import { COMMAND_RUN_SPEED_MULTIPLIER, HUMAN_SPEED_MULTIPLIER, RESIDENTS, RESIDENT_OBSTACLES, wanderSettings } from './resident-data.ts';
import { createWanderState, seededRandom, stepWander } from './wander.ts';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { findPath } from './pathfinding.ts';
import { createRouteState, resetRouteState, stepRoute } from './route-following.ts';
import mountMetadata from '../../studies/soldiers/cavalry/motion-plan.json';
import animationMetadata from '../../studies/base-human/animation-metadata.json';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Bone } from '@babylonjs/core/Bones/bone';
import { batchSkinnedMeshes } from './mesh-batching.ts';
import type { CharacterLOD } from './character-lod.ts';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { createCharacterLibrary } from './character-library.ts';

const walkReferenceSpeed = animationMetadata.animations.Walk.navigation_speed_reference;
const runReferenceSpeed = animationMetadata.animations.Run.navigation_speed_reference;
type ResourceProgress = (fraction: number) => void;

export function createResidents(scene: Scene, p: Palette, shadows: ShadowGenerator, ui: GameUI,
  worldObstacles: () => readonly Obstacle[] = () => RESIDENT_OBSTACLES) {
  const obstaclesFor = (role: string): readonly Obstacle[] => role === 'farmer' ? worldObstacles() : [
    ...worldObstacles(), { kind: 'box', x: 5.07, z: -5.91, halfWidth: 3.38, halfDepth: 2.54 },
  ];
  const placeholderRoles = new Set<string>();
  const soldierAssets = [
    { role: 'infantry', mounted: false },
    { role: 'cavalry', mounted: true },
    { role: 'archer', mounted: false },
  ] as const;
  const seed = import.meta.env.VITE_E2E === 'true' ? 624 : Math.floor(Math.random() * 0xffffffff);
  const selectionMaterial = new StandardMaterial('unit-selection', scene);
  selectionMaterial.emissiveColor = Color3.FromHexString('#62e4ff'); selectionMaterial.disableLighting = true;
  const actors = RESIDENTS.map((definition, index) => {
    const random = seededRandom(seed + (index + 1) * 1337);
    const settings = wanderSettings(definition);
    const state = createWanderState(definition.spawn, settings, obstaclesFor(definition.role), random);
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
    if (definition.role === 'dog') { hit.position.y = .65; hit.scaling.set(.9, .8, 1.2); }
    hit.metadata = { selectionKind: 'resident', id: definition.id };
    const marker = MeshBuilder.CreateTorus(`${definition.id}-selection`, { diameter: 1.3, thickness: 0.055, tessellation: 32 }, scene);
    marker.parent = root; marker.position.y = 0.08; marker.material = selectionMaterial; marker.isPickable = false; marker.setEnabled(false);
    human?.update(0, 0, 0); animal?.update(0, 0, 0);
    const label = ui.addResidentLabel(definition.id, placeholderRoles.has(definition.role) ? `${definition.name}（占位）` : definition.name);
    return { definition, random, settings, state, human, animal, root, label, marker, facing: Math.PI, movementSpeed: 0, route: [] as Point[], navigation: createRouteState() };
  });
  const labelPoint = new Vector3();
  const identity = Matrix.Identity();
  const farmer = actors.find((actor) => actor.definition.role === 'farmer')!;
  const baseHuman = actors.find((actor) => actor.definition.role === 'base')!;
  let farmerModelLoaded = false;
  let baseModelLoaded = false;
  let selected: typeof actors[number] | undefined;
  let farmerWalk: AnimationGroup | undefined;
  let farmerRun: AnimationGroup | undefined;
  let farmerHammer: AnimationGroup | undefined;
  type Work = { id: number; target: Point; status: 'travelling' | 'arrived' | 'working' | 'blocked' };
  const works = new Map<string, Work>();
  let farmerBones: Bone[] = [];
  let baseWalk: AnimationGroup | undefined;
  let baseRun: AnimationGroup | undefined;
  let baseBones: Bone[] = [];
  let baseMeshNames: string[] = [];
  type Motion = 'idle' | 'walk' | 'run' | 'work';
  type Locomotion = { walk: AnimationGroup; run: AnimationGroup; idle?: AnimationGroup; work?: AnimationGroup;
    walkSpeed: number; runSpeed: number; motion: Motion };
  const locomotion = new Map<string, Locomotion>();
  const soldierModels = new Map<string, { bones: string[]; meshes: string[]; animations: string[] }>();
  const soldierBones = new Map<string, Bone[]>();
  const characterLODs = new Map<string, CharacterLOD[]>();
  const library = createCharacterLibrary(scene);
  const attachGeometry = async (id: string, meshes: readonly AbstractMesh[], report?: ResourceProgress) => {
    loadingProgress.begin(id + ':geometry', `${id}：合批与 LOD 准备`);
    const sources = batchSkinnedMeshes(meshes, library.highBatches);
    for (const mesh of sources) {
      mesh.isPickable = false;
      if (mesh.getTotalVertices()) { mesh.receiveShadows = true; shadows.addShadowCaster(mesh, false); }
    }
    report?.(0);
    characterLODs.set(id, await library.attachLOD(sources));
    // The native shadow renderer selects the same LOD as the main camera;
    // only the source meshes belong in its caster list.
    loadingProgress.done(id + ':geometry');
    report?.(1);
  };
  const lodInfo = (id: string) => {
    const pairs = characterLODs.get(id);
    if (!pairs) return;
    return {
      parts: pairs.length,
      mapParts: pairs.filter(({ source, detail }) => scene.activeCamera && source.getLOD(scene.activeCamera) === detail).length,
      sourceTriangles: pairs.reduce((sum, pair) => sum + pair.source.getTotalIndices() / 3, 0),
      mapTriangles: pairs.reduce((sum, pair) => sum + pair.detail.getTotalIndices() / 3, 0),
      sharedSkeletonAndMaterials: pairs.every(({ source, detail }) => source.skeleton === detail.skeleton && source.material === detail.material),
    };
  };
  const destinationSpeed = (actor: typeof actors[number]) => actor.settings.speed
    * (locomotion.has(actor.definition.id) ? runReferenceSpeed / walkReferenceSpeed : 2.1 / 1.15)
    * COMMAND_RUN_SPEED_MULTIPLIER;
  const advanceRoute = (actor: typeof actors[number], seconds: number) => {
    const result = stepRoute(actor.definition.id, actor.state.position, actor.route, actor.navigation, seconds,
      destinationSpeed(actor), actor.settings.bodyRadius, actor.settings.bounds, obstaclesFor(actor.definition.role),
      actors.filter(other => other !== actor).map(other => ({ id: other.definition.id, position: other.state.position,
        radius: other.settings.bodyRadius, moving: other.movementSpeed > .08, purposeful: !!other.route.length, waiting: other.navigation.waiting })));
    actor.state.distanceTravelled += Math.hypot(result.position.x - actor.state.position.x, result.position.z - actor.state.position.z);
    actor.state.position = result.position;
    return result;
  };
  const registerLocomotion = (id: string, walk: AnimationGroup, run: AnimationGroup,
    options: { idle?: AnimationGroup; work?: AnimationGroup; walkSpeed?: number; runSpeed?: number } = {}) => {
    walk.stop(); run.stop(); options.work?.stop(); options.idle?.stop(); (options.idle ?? walk).reset();
    if (options.work) options.idle?.play(true);
    locomotion.set(id, { walk, run, idle: options.idle, work: options.work, motion: 'idle',
      walkSpeed: options.walkSpeed ?? walkReferenceSpeed, runSpeed: options.runSpeed ?? runReferenceSpeed });
  };
  const setMotion = (id: string, motion: Motion, speed = 0) => {
    const clips = locomotion.get(id);
    if (!clips) return;
    if (motion !== clips.motion) {
      clips.walk.stop(); clips.run.stop(); clips.idle?.stop(); clips.work?.stop();
      // Run starts at a running phase. Walk's first frame carries the complete
      // neutral pose, so stopping Run must reset Walk rather than reset Run.
      if (motion === 'idle') {
        if (clips.work && clips.idle) clips.idle.play(true);
        else (clips.idle ?? clips.walk).reset();
      } else (motion === 'work' ? clips.work : motion === 'run' ? clips.run : clips.walk)?.play(true);
      clips.motion = motion;
    }
    if (motion === 'work' && clips.work) clips.work.speedRatio = (speed || 1) * HUMAN_SPEED_MULTIPLIER;
    else if (motion !== 'idle') {
      const clip = motion === 'run' ? clips.run : clips.walk;
      clip.speedRatio = speed / (motion === 'run' ? clips.runSpeed : clips.walkSpeed);
    }
  };
  return {
    async loadFarmerModel(report?: ResourceProgress) {
      for (const actor of actors.filter(a => a.definition.role === 'farmer')) {
      const result = await library.instantiate('farmer', actor.root);
      loadingProgress.begin('farmer:attach', '农民：共享材质与动作挂接');
      if (actor === farmer) farmerBones = result.skeletons.flatMap((skeleton) => skeleton.bones);
      const farmerWalk = result.walk, farmerRun = result.run, farmerHammer = result.work;
      // Blending flags are actor-local. Key arrays remain shared and immutable.
      for (const clip of [farmerWalk, farmerRun, farmerHammer]) {
        for (const target of clip.targetedAnimations) target.animation = target.animation.clone();
      }
      // Reuse the authored neutral Walk pose for a native blended rest state.
      // This is not another authored body/rig/action set.
      const rest = farmerWalk.clone('Farmer rest pose', undefined, true);
      for (const target of rest.targetedAnimations) {
        const first = target.animation.getKeys()[0];
        target.animation.setKeys([{ frame: 0, value: first.value.clone?.() ?? first.value }, { frame: 60, value: first.value.clone?.() ?? first.value }]);
      }
      rest.normalize(0, 60);
      for (const clip of [farmerWalk, farmerRun, farmerHammer, rest]) { clip.enableBlending = true; clip.blendingSpeed = .15; }
      registerLocomotion(actor.definition.id, farmerWalk, farmerRun, { idle: rest, work: farmerHammer });
      actor.human!.mesh.setEnabled(false);
      loadingProgress.done('farmer:attach');
      await attachGeometry(actor.definition.id, result.meshes, fraction => report?.(.8 + .2 * fraction));
      }
      const primary = locomotion.get(farmer.definition.id)!;
      farmerWalk = primary.walk; farmerRun = primary.run; farmerHammer = primary.work;
      farmerModelLoaded = true;
      report?.(1);
    },
    async loadBaseModel(report?: ResourceProgress) {
      const result = await library.instantiate('base', baseHuman.root);
      loadingProgress.begin('base:attach', '基础人物：共享材质与动作挂接');
      baseBones = result.skeletons.flatMap((skeleton) => skeleton.bones);
      baseMeshNames = result.meshes.map((mesh) => mesh.name);
      baseWalk = result.walk; baseRun = result.run;
      registerLocomotion(baseHuman.definition.id, baseWalk, baseRun);
      baseHuman.human!.mesh.setEnabled(false);
      loadingProgress.done('base:attach');
      await attachGeometry(baseHuman.definition.id, result.meshes, fraction => report?.(.8 + .2 * fraction));
      baseModelLoaded = true;
      report?.(1);
    },
    async loadSoldierModels(report?: ResourceProgress) {
      for (const [index, asset] of soldierAssets.entries()) {
        const roleProgress = (fraction: number) => report?.((index + fraction) / soldierAssets.length);
        const actor = actors.find(entry => entry.definition.role === asset.role)!;
        const result = await library.instantiate(asset.role, actor.root);
        loadingProgress.begin(asset.role + ':attach', `${actor.definition.name}：共享材质与动作挂接`);
        result.animationGroups.forEach(group => group.stop());
        const { walk, run, idle } = result;
        if (!walk || !run || (asset.mounted && !idle)) throw new Error(`${asset.role} is missing its locomotion clips`);
        registerLocomotion(actor.definition.id, walk, run, asset.mounted ? {
          idle, walkSpeed: mountMetadata.gaits.RideWalk.speed, runSpeed: mountMetadata.gaits.RideRun.speed,
        } : {});
        actor.human!.mesh.setEnabled(false);
        actor.animal?.mesh.setEnabled(false);
        loadingProgress.done(asset.role + ':attach');
        const meshNames = result.meshes.map(mesh => mesh.name);
        await attachGeometry(actor.definition.id, result.meshes, fraction => roleProgress(.8 + .2 * fraction));
        soldierModels.set(actor.definition.id, {
          bones: result.skeletons.flatMap(skeleton => skeleton.bones.map(bone => bone.name)),
          meshes: meshNames,
          animations: result.animationGroups.map(group => group.name),
        });
        soldierBones.set(actor.definition.id, result.skeletons.flatMap(skeleton => skeleton.bones));
        report?.((index + 1) / soldierAssets.length);
      }
    },
    async loadRolePlaceholders(report?: ResourceProgress) {
      const placeholders = actors.filter(entry => placeholderRoles.has(entry.definition.role));
      for (const [index, actor] of placeholders.entries()) {
        const instance = await library.instantiate('base', actor.root);
        const { walk, run } = instance;
        registerLocomotion(actor.definition.id, walk, run);
        for (const root of instance.rootNodes) {
          root.parent = actor.root;
        }
        await attachGeometry(actor.definition.id, instance.meshes,
          fraction => report?.(.8 + .2 * (index + fraction) / placeholders.length));
        actor.human?.mesh.setEnabled(false);
        if (actor.definition.role === 'cavalry') actor.animal?.mesh.setEnabled(false);
      }
      report?.(1);
    },
    farmerIds: () => actors.filter(a => a.definition.role === 'farmer').map(a => a.definition.id),
    saveResidents: (): Record<string, SavedResident> => Object.fromEntries(actors.map(actor => [actor.definition.id, {
      position: { ...actor.state.position }, manualGoal: !works.has(actor.definition.id) && actor.route.length ? { ...actor.route.at(-1)! } : undefined,
    }])),
    restoreResidents(saved: Record<string, SavedResident>) {
      for (const actor of actors) {
        const data = saved[actor.definition.id]; if (!data) continue;
        if (!isBlocked(data.position, actor.settings.bodyRadius, obstaclesFor(actor.definition.role))) {
          actor.state.position = { ...data.position }; actor.root.position.set(data.position.x, 0, data.position.z);
          actor.state.target = undefined;
        }
        if (data.manualGoal) actor.route = findPath(actor.state.position, data.manualGoal, actor.settings.bodyRadius, actor.settings.bounds, obstaclesFor(actor.definition.role)) ?? [];
      }
    },
    farmerPosition: (id = farmer.definition.id) => actors.find(a => a.definition.id === id)!.root.position,
    sharedLibraryInfo: library.summary,
    lodSummary: () => [...characterLODs].map(([id, pairs]) => ({ id, parts: pairs.length,
      mapParts: pairs.filter(({ source, detail }) => scene.activeCamera && source.getLOD(scene.activeCamera) === detail).length })),
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
    farmerRunning: () => farmerRun?.isPlaying ?? false,
    farmerModelInfo: () => ({
      bones: farmerBones.map(bone => bone.name),
      pose: farmerBones.map(bone => (bone.getTransformNode()?.rotationQuaternion ?? bone.getRotationQuaternion()).asArray()),
      animations: [farmerWalk?.name, farmerRun?.name, farmerHammer?.name].filter(Boolean),
      motion: locomotion.get(farmer.definition.id)?.motion ?? 'idle',
      effectiveWorkPlaybackRate: farmerHammer ? farmerHammer.speedRatio * scene.animationTimeScale : undefined,
    }),
    farmerLegPose: () => farmerBones.find(bone => bone.name === 'thigh.L')?.getTransformNode()?.rotationQuaternion?.asArray() ?? [],
    select(id?: string) {
      selected?.marker.setEnabled(false);
      selected = actors.find((actor) => actor.definition.id === id);
      selected?.marker.setEnabled(true);
      return selected?.definition.name;
    },
    selectionMeshes: () => selected ? [...selected.root.getChildMeshes().filter(m => m.isEnabled() && m.isVisible && m.visibility > 0 && m !== selected!.marker && !m.metadata?.selectionKind), ...(characterLODs.get(selected.definition.id) ?? []).flatMap(p => [p.source, p.detail])] : [],
    selectedId: () => selected?.definition.id,
    selectedCanMove: () => !!selected,
    canWork: (id: string) => actors.some(a => a.definition.id === id && a.definition.role === 'farmer'),
    hasMoveCommand: (id: string) => !!actors.find(actor => actor.definition.id === id && actor.route.length && !works.has(actor.definition.id)),
    command(point: Point, id = selected?.definition.id) {
      const actor = actors.find(entry => entry.definition.id === id);
      if (!actor) return false;
      const path = findPath(actor.state.position, point, actor.settings.bodyRadius, actor.settings.bounds, obstaclesFor(actor.definition.role));
      if (!path) return false;
      works.delete(actor.definition.id);
      actor.route = path; actor.state.target = undefined; actor.state.pause = 0; actor.state.blockedFor = 0;
      resetRouteState(actor.navigation);
      return true;
    },
    planFarmerWork(points: readonly Point[], unit = farmer.definition.id): Point[] | undefined {
      const farmer = actors.find(a => a.definition.id === unit)!;
      // Temporary occupants are handled by the same follower as manual moves.
      // They must not make a valid job look permanently unreachable.
      const paths = points.map(point => findPath(farmer.state.position, point, farmer.settings.bodyRadius, farmer.settings.bounds, worldObstacles())).filter((path): path is Point[] => !!path);
      const length = (path: Point[]) => path.reduce((sum, p, i) => { const prev = i ? path[i - 1] : farmer.state.position; return sum + Math.hypot(p.x - prev.x, p.z - prev.z); }, 0);
      paths.sort((a, b) => length(a) - length(b));
      return paths[0];
    },
    startFarmerWork(id: number, path: Point[], target: Point, unit = farmer.definition.id) {
      const farmer = actors.find(a => a.definition.id === unit)!;
      farmer.route = path; farmer.state.target = undefined;
      resetRouteState(farmer.navigation);
      works.set(unit, { id, target, status: 'travelling' });
    },
    farmerWorkState: (unit = farmer.definition.id) => { const work = works.get(unit); return work && { id: work.id, status: work.status }; },
    beginFarmerWork(id: number, unit = farmer.definition.id) { const work = works.get(unit); if (work?.id === id && work.status === 'arrived') work.status = 'working'; },
    releaseFarmerWork(unit = farmer.definition.id) { works.delete(unit); const actor = actors.find(a => a.definition.id === unit)!; actor.route = []; resetRouteState(actor.navigation); setMotion(unit, 'idle'); },
    update(seconds: number, previewRole?: 'farmer' | 'base', activeElapsed = seconds) {
      for (const actor of actors) {
        actor.movementSpeed = 0;
        if (seconds <= 0) continue;
        const work = works.get(actor.definition.id);
        if (work) {
          const before = { ...actor.state.position };
          const workSeconds = Math.min(activeElapsed, .5);
          if (work.status === 'travelling') {
            let remaining = workSeconds;
            while (remaining > 1e-8 && actor.route.length) {
              const step = Math.min(remaining, .05);
              if (advanceRoute(actor, step).unreachable) { work.status = 'blocked'; actor.route = []; break; }
              remaining -= step;
            }
            if (!actor.route.length && work.status !== 'blocked') work.status = 'arrived';
          }
          const dx = actor.state.position.x - before.x, dz = actor.state.position.z - before.z;
          const moved = Math.hypot(dx, dz);
          actor.movementSpeed = workSeconds > 0 ? moved / workSeconds : 0;
          if (moved > .001) actor.facing = Math.atan2(dx, dz);
          else if (work.status === 'arrived' || work.status === 'working') actor.facing = Math.atan2(work.target.x - actor.state.position.x, work.target.z - actor.state.position.z) + .35;
          actor.root.position.set(actor.state.position.x, 0, actor.state.position.z);
          actor.root.rotationQuaternion ??= Quaternion.Identity();
          Quaternion.RotationYawPitchRollToRef(actor.facing, 0, 0, actor.root.rotationQuaternion);
          setMotion(actor.definition.id, work.status === 'working' ? 'work' : moved > .001 ? 'run' : 'idle',
            work.status === 'working' ? activeElapsed / seconds : moved / seconds);
          continue;
        }
        if (previewRole === actor.definition.role && (actor === farmer || actor === baseHuman)) {
          actor.root.rotationQuaternion ??= Quaternion.Identity();
          Quaternion.RotationYawPitchRollToRef(Math.PI, 0, 0, actor.root.rotationQuaternion);
          if (actor === farmer) setMotion(actor.definition.id, seconds > 0 ? 'walk' : 'idle', walkReferenceSpeed * HUMAN_SPEED_MULTIPLIER);
          else setMotion(actor.definition.id, 'idle');
          continue;
        }
        const crowd: Obstacle[] = actors.filter((other) => other !== actor).map((other) => ({
          kind: 'circle', x: other.state.position.x, z: other.state.position.z, radius: other.definition.bodyRadius,
        }));
        const blockers = crowd.filter((other) => other.kind === 'circle'
          && Math.hypot(other.x - actor.state.position.x, other.z - actor.state.position.z) >= other.radius + actor.settings.bodyRadius - 0.001);
        let velocity: Point;
        const commanded = actor.route.length > 0;
        if (actor.route.length) {
          const before = { ...actor.state.position };
          let remaining = Math.min(activeElapsed, .5);
          while (remaining > 1e-8 && actor.route.length) {
            const step = Math.min(remaining, .05);
            if (advanceRoute(actor, step).unreachable) { actor.route = []; ui.toast('目标暂时无法到达'); break; }
            remaining -= step;
          }
          velocity = { x: (actor.state.position.x - before.x) / seconds, z: (actor.state.position.z - before.z) / seconds };
          if (!actor.route.length) actor.state.pause = 3;
        } else if (actor.definition.role === 'farmer') velocity = { x: 0, z: 0 };
        else velocity = stepWander(actor.state, actor.settings, seconds, [...obstaclesFor(actor.definition.role), ...blockers], actor.random);
        const speed = Math.hypot(velocity.x, velocity.z);
        actor.movementSpeed = speed;
        setMotion(actor.definition.id, speed > 0.08 ? commanded ? 'run' : 'walk' : 'idle', speed);
        actor.root.position.set(actor.state.position.x, 0, actor.state.position.z);
        if (actor.definition.role === 'farmer' || soldierModels.has(actor.definition.id)) {
          // Dressed GLBs own their visible animation. Preserve the farmer's
          // working heading on release instead of resetting the hidden legacy rig.
          if (speed > 0.08) {
            const target = Math.atan2(velocity.x, velocity.z);
            const difference = Math.atan2(Math.sin(target - actor.facing), Math.cos(target - actor.facing));
            actor.facing += difference * (1 - Math.exp(-seconds * (actor.definition.role === 'cavalry' ? 7 : 14)));
          }
          actor.root.rotationQuaternion ??= Quaternion.Identity();
          Quaternion.RotationYawPitchRollToRef(actor.facing, 0, 0, actor.root.rotationQuaternion);
        } else {
          actor.human?.update(seconds, velocity.x, velocity.z);
          actor.animal?.update(seconds, velocity.x, velocity.z, commanded);
        }
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
      model: soldierModels.get(actor.definition.id),
      lod: lodInfo(actor.definition.id),
      modelPose: soldierBones.get(actor.definition.id)?.map(bone =>
        (bone.getTransformNode()?.rotationQuaternion ?? bone.getRotationQuaternion()).asArray()),
      motion: locomotion.get(actor.definition.id)?.motion ?? actor.animal?.motion,
      movementSpeed: actor.movementSpeed,
      runPlaybackRate: locomotion.get(actor.definition.id)?.run.speedRatio ?? actor.animal?.runPlaybackRate,
      runReferenceSpeed: locomotion.get(actor.definition.id)?.runSpeed ?? actor.animal?.runReferenceSpeed,
      walking: locomotion.get(actor.definition.id)?.walk.isPlaying ?? actor.animal?.motion === 'walk',
      running: locomotion.get(actor.definition.id)?.run.isPlaying ?? actor.animal?.motion === 'run',
      working: locomotion.get(actor.definition.id)?.work?.isPlaying ?? false,
      placeholder: placeholderRoles.has(actor.definition.role) && locomotion.has(actor.definition.id),
      placeholderWalking: placeholderRoles.has(actor.definition.role) && (locomotion.get(actor.definition.id)?.walk.isPlaying ?? false),
      placeholderRunning: placeholderRoles.has(actor.definition.role) && (locomotion.get(actor.definition.id)?.run.isPlaying ?? false),
      legacyVisible: !!actor.human?.mesh.isEnabled() || (actor.definition.role === 'cavalry' && !!actor.animal?.mesh.isEnabled()),
      position: { ...actor.state.position }, state: actor.state.target ? 'walking' : 'idle',
      facing: actor.root.rotationQuaternion?.asArray() ?? [],
      routeRemaining: actor.route.length,
      moveCommand: !!actor.route.length && !works.has(actor.definition.id),
      navigation: { ...actor.navigation },
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
