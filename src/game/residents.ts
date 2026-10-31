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
import { ImportMeshAsync, LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { ISceneLoaderProgressEvent } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import { modelAssets } from './model-assets.ts';
import { modelData, modelOptions } from './asset-cache.ts';
import mountMetadata from '../../studies/soldiers/cavalry/motion-plan.json';
import animationMetadata from '../../studies/base-human/animation-metadata.json';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Bone } from '@babylonjs/core/Bones/bone';
import { createCharacterMaterialSetup } from './character-materials.ts';
import { batchSkinnedMeshes } from './mesh-batching.ts';
import { loadCharacterLOD } from './character-lod.ts';
import type { CharacterLOD } from './character-lod.ts';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

const walkReferenceSpeed = animationMetadata.animations.Walk.navigation_speed_reference;
const runReferenceSpeed = animationMetadata.animations.Run.navigation_speed_reference;
const { farmer: farmerModelUrl, base: baseModelUrl, infantry: infantryModelUrl, cavalry: cavalryModelUrl, archer: archerModelUrl,
  baseLOD: baseLODUrl, farmerLOD: farmerLODUrl, infantryLOD: infantryLODUrl, cavalryLOD: cavalryLODUrl, archerLOD: archerLODUrl } = modelAssets;
type ResourceProgress = (fraction: number) => void;
const downloadProgress = (report?: ResourceProgress) => (event: ISceneLoaderProgressEvent) => {
  // Reserve the final tenth for decoding, skinning and attaching the asset.
  if (event.lengthComputable && event.total > 0) report?.(Math.min(.9, .9 * event.loaded / event.total));
};

export function createResidents(scene: Scene, p: Palette, shadows: ShadowGenerator, ui: GameUI,
  worldObstacles: () => readonly Obstacle[] = () => RESIDENT_OBSTACLES) {
  const obstaclesFor = (role: string): readonly Obstacle[] => role === 'farmer' ? worldObstacles() : [
    ...worldObstacles(), { kind: 'box', x: 4.8, z: -2, halfWidth: 2.35, halfDepth: 2.1 },
  ];
  const placeholderRoles = new Set(['worker']);
  const soldierAssets = [
    { role: 'infantry', url: infantryModelUrl, lod: infantryLODUrl, mounted: false },
    { role: 'cavalry', url: cavalryModelUrl, lod: cavalryLODUrl, mounted: true },
    { role: 'archer', url: archerModelUrl, lod: archerLODUrl, mounted: false },
  ] as const;
  const seed = import.meta.env.VITE_E2E === 'true' ? 624 : Math.floor(Math.random() * 0xffffffff);
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
    marker.parent = root; marker.position.y = 0.08; marker.material = p.pathLight; marker.isPickable = false; marker.setEnabled(false);
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
  let work: { id: number; target: Point; status: 'travelling' | 'arrived' | 'working' | 'blocked' } | undefined;
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
  const attachGeometry = async (id: string, meshes: readonly AbstractMesh[], lodUrl: string, report?: ResourceProgress, namePrefix?: string) => {
    loadingProgress.begin(id + ':geometry', `${id}：合批与 LOD 准备`);
    const sources = batchSkinnedMeshes(meshes);
    for (const mesh of sources) {
      mesh.isPickable = false;
      if (mesh.getTotalVertices()) { mesh.receiveShadows = true; shadows.addShadowCaster(mesh, false); }
    }
    report?.(0);
    characterLODs.set(id, await loadCharacterLOD(scene, sources, lodUrl, {
      namePrefix, onProgress: downloadProgress(report),
    }));
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
  const prepareBaseMaterials = createCharacterMaterialSetup(scene);
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
      const data = await modelData(farmerModelUrl, downloadProgress(fraction => report?.(.8 * fraction)));
      const result = await loadingProgress.run(farmerModelUrl + ':parse', '农民：模型解析', () => ImportMeshAsync(data, scene, modelOptions(farmerModelUrl)));
      loadingProgress.begin(farmerModelUrl + ':attach', '农民：材质与动作挂接');
      prepareBaseMaterials(result.meshes.map((mesh) => mesh.material));
      farmerBones = result.skeletons.flatMap((skeleton) => skeleton.bones);
      farmerWalk = result.animationGroups.find((group) => group.name === 'Walk');
      farmerRun = result.animationGroups.find((group) => group.name === 'Run');
      farmerHammer = result.animationGroups.find((group) => group.name === 'Hammer');
      if (!farmerWalk || !farmerRun || !farmerHammer) throw new Error('Farmer model needs shared Walk, Run and Hammer animations');
      // Reuse the authored neutral Walk pose for a native blended rest state.
      // This is not another authored body/rig/action set.
      const rest = farmerWalk.clone('Farmer rest pose', undefined, true);
      for (const target of rest.targetedAnimations) {
        const first = target.animation.getKeys()[0];
        target.animation.setKeys([{ frame: 0, value: first.value.clone?.() ?? first.value }, { frame: 60, value: first.value.clone?.() ?? first.value }]);
      }
      rest.normalize(0, 60);
      for (const clip of [farmerWalk, farmerRun, farmerHammer, rest]) { clip.enableBlending = true; clip.blendingSpeed = .15; }
      registerLocomotion(farmer.definition.id, farmerWalk, farmerRun, { idle: rest, work: farmerHammer });
      result.meshes[0].parent = farmer.root;
      farmer.human!.mesh.setEnabled(false);
      loadingProgress.done(farmerModelUrl + ':attach');
      await attachGeometry(farmer.definition.id, result.meshes, farmerLODUrl, fraction => report?.(.8 + .2 * fraction));
      farmerModelLoaded = true;
      report?.(1);
    },
    async loadBaseModel(report?: ResourceProgress) {
      const data = await modelData(baseModelUrl, downloadProgress(fraction => report?.(.8 * fraction)));
      const result = await loadingProgress.run(baseModelUrl + ':parse', '基础人物：模型解析', () => ImportMeshAsync(data, scene, modelOptions(baseModelUrl)));
      loadingProgress.begin(baseModelUrl + ':attach', '基础人物：材质与动作挂接');
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
      loadingProgress.done(baseModelUrl + ':attach');
      await attachGeometry(baseHuman.definition.id, result.meshes, baseLODUrl, fraction => report?.(.8 + .2 * fraction));
      baseModelLoaded = true;
      report?.(1);
    },
    async loadSoldierModels(report?: ResourceProgress) {
      for (const [index, asset] of soldierAssets.entries()) {
        const roleProgress = (fraction: number) => report?.((index + fraction) / soldierAssets.length);
        const actor = actors.find(entry => entry.definition.role === asset.role)!;
        const data = await modelData(asset.url, downloadProgress(fraction => roleProgress(.8 * fraction)));
        const result = await loadingProgress.run(asset.url + ':parse', `${actor.definition.name}：模型解析`, () => ImportMeshAsync(data, scene, modelOptions(asset.url)));
        loadingProgress.begin(asset.url + ':attach', `${actor.definition.name}：材质与动作挂接`);
        prepareBaseMaterials(result.meshes.map(mesh => mesh.material));
        result.animationGroups.forEach(group => group.stop());
        const walk = result.animationGroups.find(group => group.name === (asset.mounted ? 'RideWalk' : 'Walk'));
        const run = result.animationGroups.find(group => group.name === (asset.mounted ? 'RideRun' : 'Run'));
        const idle = result.animationGroups.find(group => group.name === 'RideIdle');
        if (!walk || !run || (asset.mounted && !idle)) throw new Error(`${asset.role} is missing its locomotion clips`);
        registerLocomotion(actor.definition.id, walk, run, asset.mounted ? {
          idle, walkSpeed: mountMetadata.gaits.RideWalk.speed, runSpeed: mountMetadata.gaits.RideRun.speed,
        } : {});
        result.meshes[0].parent = actor.root;
        actor.human!.mesh.setEnabled(false);
        actor.animal?.mesh.setEnabled(false);
        loadingProgress.done(asset.url + ':attach');
        await attachGeometry(actor.definition.id, result.meshes, asset.lod, fraction => roleProgress(.8 + .2 * fraction));
        soldierModels.set(actor.definition.id, {
          bones: result.skeletons.flatMap(skeleton => skeleton.bones.map(bone => bone.name)),
          meshes: result.meshes.map(mesh => mesh.name),
          animations: result.animationGroups.map(group => group.name),
        });
        soldierBones.set(actor.definition.id, result.skeletons.flatMap(skeleton => skeleton.bones));
        report?.((index + 1) / soldierAssets.length);
      }
    },
    async loadRolePlaceholders(report?: ResourceProgress) {
      const data = await modelData(baseModelUrl, downloadProgress(fraction => report?.(.8 * fraction)));
      const container = await loadingProgress.run('worker:parse', '工人：模型解析与动作复用', () => LoadAssetContainerAsync(data, scene, modelOptions(baseModelUrl)));
      prepareBaseMaterials(container.materials);
      const placeholders = actors.filter(entry => placeholderRoles.has(entry.definition.role));
      for (const [index, actor] of placeholders.entries()) {
        const instance = container.instantiateModelsToScene((name) => `${actor.definition.id}-${name}`, false, { doNotInstantiate: true });
        const walk = instance.animationGroups.find((group) => group.name.endsWith('-Walk'));
        const run = instance.animationGroups.find((group) => group.name.endsWith('-Run'));
        if (!walk || !run) throw new Error(`Missing locomotion animations for ${actor.definition.id}`);
        registerLocomotion(actor.definition.id, walk, run);
        for (const root of instance.rootNodes) {
          root.parent = actor.root;
        }
        await attachGeometry(actor.definition.id, instance.rootNodes.flatMap(root => root.getChildMeshes()), baseLODUrl,
          fraction => report?.(.8 + .2 * (index + fraction) / placeholders.length), `${actor.definition.id}-`);
        actor.human?.mesh.setEnabled(false);
        if (actor.definition.role === 'cavalry') actor.animal?.mesh.setEnabled(false);
      }
      report?.(1);
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
    selectedId: () => selected?.definition.id,
    selectedCanMove: () => !!selected,
    canWork: (id: string) => id === farmer.definition.id,
    hasMoveCommand: (id: string) => !!actors.find(actor => actor.definition.id === id && actor.route.length && (actor !== farmer || !work)),
    command(point: Point, id = selected?.definition.id) {
      const actor = actors.find(entry => entry.definition.id === id);
      if (!actor) return false;
      const path = findPath(actor.state.position, point, actor.settings.bodyRadius, actor.settings.bounds, obstaclesFor(actor.definition.role));
      if (!path) return false;
      if (actor === farmer) work = undefined;
      actor.route = path; actor.state.target = undefined; actor.state.pause = 0; actor.state.blockedFor = 0;
      resetRouteState(actor.navigation);
      return true;
    },
    planFarmerWork(points: readonly Point[]): Point[] | undefined {
      // Temporary occupants are handled by the same follower as manual moves.
      // They must not make a valid job look permanently unreachable.
      const paths = points.map(point => findPath(farmer.state.position, point, farmer.settings.bodyRadius, farmer.settings.bounds, worldObstacles())).filter((path): path is Point[] => !!path);
      const length = (path: Point[]) => path.reduce((sum, p, i) => { const prev = i ? path[i - 1] : farmer.state.position; return sum + Math.hypot(p.x - prev.x, p.z - prev.z); }, 0);
      paths.sort((a, b) => length(a) - length(b));
      return paths[0];
    },
    startFarmerWork(id: number, path: Point[], target: Point) {
      farmer.route = path; farmer.state.target = undefined;
      resetRouteState(farmer.navigation);
      work = { id, target, status: 'travelling' };
    },
    farmerWorkState: () => work && { id: work.id, status: work.status },
    beginFarmerWork(id: number) { if (work?.id === id && work.status === 'arrived') work.status = 'working'; },
    releaseFarmerWork() { work = undefined; farmer.route = []; resetRouteState(farmer.navigation); setMotion(farmer.definition.id, 'idle'); },
    update(seconds: number, previewRole?: 'farmer' | 'base', activeElapsed = seconds) {
      for (const actor of actors) {
        actor.movementSpeed = 0;
        if (seconds <= 0) continue;
        if (actor === farmer && work) {
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
          const result = advanceRoute(actor, seconds);
          velocity = result.velocity;
          if (result.unreachable) { actor.route = []; ui.toast('目标暂时无法到达'); }
          if (!actor.route.length) actor.state.pause = 3;
        } else if (actor === farmer) velocity = { x: 0, z: 0 };
        else velocity = stepWander(actor.state, actor.settings, seconds, [...obstaclesFor(actor.definition.role), ...blockers], actor.random);
        const speed = Math.hypot(velocity.x, velocity.z);
        actor.movementSpeed = speed;
        setMotion(actor.definition.id, speed > 0.08 ? commanded ? 'run' : 'walk' : 'idle', speed);
        actor.root.position.set(actor.state.position.x, 0, actor.state.position.z);
        if (actor === farmer || soldierModels.has(actor.definition.id)) {
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
      moveCommand: !!actor.route.length && (actor !== farmer || !work),
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
