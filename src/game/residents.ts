import { DeathView, MountedDeathView } from './death-view.ts';
import { deathAge } from './death.ts';
import { nextPaint } from '../launcher.ts';
import type { Neighbour } from './route-following.ts';
import type { Fighter } from './combat.ts';
import { fighterStats } from './combat.ts';
import { effort } from './vitals.ts';
import type { Vitals } from './vitals.ts';
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
import { HUMAN_SPEED_MULTIPLIER, RESIDENTS, ENEMIES, RESIDENT_OBSTACLES, canResidentWork, roleLeader, wanderSettings } from './resident-data.ts';
import { destinationSpeed as commandedSpeed, runReferenceSpeed, mountedRunReferenceSpeed } from './locomotion.ts';
import { createWanderState, seededRandom, stepWander } from './wander.ts';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { createRouteState, resetRouteState, stepRoute } from './route-following.ts';
import { occupiedApproach, planMoveDestination, planWorkApproach } from './work-navigation.ts';
import mountMetadata from '../../studies/soldiers/cavalry/motion-plan.json';
import animationMetadata from '../../studies/base-human/animation-metadata.json';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Bone } from '@babylonjs/core/Bones/bone';
import { batchSkinnedMeshes } from './mesh-batching.ts';
import type { CharacterLOD } from './character-lod.ts';
import { selectCharacterLOD } from './character-lod.ts';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { createCharacterLibrary } from './character-library.ts';
import { rigEnvelope } from './rig-envelope.ts';
import { AnimationVisibility } from './animation-visibility.ts';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import { createShadowCasterFilter } from './shadow-culling.ts';

const walkReferenceSpeed = animationMetadata.animations.Walk.navigation_speed_reference;
type ResourceProgress = (fraction: number) => void;

export function createResidents(scene: Scene, p: Palette, shadows: ShadowGenerator, ui: GameUI,
  worldObstacles: (avoidFields?: boolean) => readonly Obstacle[] = () => RESIDENT_OBSTACLES, vitals: Vitals = {}) {
  const resting = new Set<string>();
  const obstaclesFor = (role: string) => worldObstacles(role !== 'farmer');
  const placeholderRoles = new Set<string>();
  const soldierAssets = [
    { role: 'infantry', mounted: false },
    { role: 'cavalry', mounted: true },
    { role: 'archer', mounted: false },
  ] as const;
  const seed = import.meta.env.VITE_E2E === 'true' ? 624 : Math.floor(Math.random() * 0xffffffff);
  const selectionMaterial = new StandardMaterial('unit-selection', scene);
  selectionMaterial.emissiveColor = Color3.FromHexString('#62e4ff'); selectionMaterial.disableLighting = true;
  const actors = [...RESIDENTS, ...ENEMIES].map((definition, index) => {
    const random = seededRandom(seed + (index + 1) * 1337);
    const settings = wanderSettings(definition);
    const state = createWanderState(definition.spawn, settings, obstaclesFor(definition.role), random);
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
    const hit = MeshBuilder.CreateSphere(`${definition.id}-hit`, { diameter: 1.5 }, scene);
    hit.parent = root; hit.position.y = definition.role === 'cavalry' ? 1.6 : 1.0; hit.scaling.y = 1.5; hit.visibility = 0;
    if (definition.role === 'dog') { hit.position.y = .65; hit.scaling.set(.9, .8, 1.2); }
    hit.metadata = { selectionKind: 'resident', id: definition.id };
    const marker = MeshBuilder.CreateTorus(`${definition.id}-selection`, { diameter: 1.3, thickness: 0.055, tessellation: 32 }, scene);
    marker.parent = root; marker.position.y = 0.08; marker.material = selectionMaterial; marker.isPickable = false; marker.setEnabled(false);
    human?.update(0, 0, 0); animal?.update(0, 0, 0);
    const label = ui.addResidentLabel(definition.id, placeholderRoles.has(definition.role) ? `${definition.name}（占位）` : definition.name, definition.effects?.includes('leader'));
    return { definition, random, settings, state, human, animal, root, label, marker, hit,
      death: definition.role === 'cavalry' ? new MountedDeathView(root) : new DeathView(root, { prone: definition.role !== 'dog' }), facing: Math.PI, movementSpeed: 0,
      route: [] as Point[], navigation: createRouteState(), wanderRoute: [] as Point[], wanderNavigation: createRouteState() };
  });
  const actorById = new Map(actors.map(actor => [actor.definition.id, actor]));
  const labelPoint = new Vector3(), labelProjected = new Vector3();
  const identity = Matrix.Identity();
  const farmer = actors.find((actor) => actor.definition.role === 'farmer')!;
  const leader = actors.find(actor => actor.definition.id === roleLeader('farmer')?.id)!;
  let farmerModelLoaded = false;
  let selected: typeof actors[number] | undefined;
  let farmerWalk: AnimationGroup | undefined;
  let farmerRun: AnimationGroup | undefined;
  let farmerHammer: AnimationGroup | undefined;
  type Work = { id: number; target: Point; status: 'travelling' | 'arrived' | 'working' | 'blocked' };
  const works = new Map<string, Work>();
  let farmerBones: Bone[] = [];
  type Motion = 'idle' | 'walk' | 'run' | 'work' | 'attack';
  const combatPoses = new Map<string, Fighter>();
  const dead = (id: string) => combatPoses.get(id)?.life === 'defeated' || vitals[id]?.hp === 0;
  const combatClips = new Map<string, AnimationGroup>();
  const fallPostures = new Map<string, AnimationGroup>();
  const playingAttack = new Map<string, number>();
  const bowPoses = new Map<string, (phase?: number) => void>();
  type Locomotion = { walk: AnimationGroup; run: AnimationGroup; idle?: AnimationGroup; work?: AnimationGroup;
    walkSpeed: number; runSpeed: number; motion: Motion };
  const locomotion = new Map<string, Locomotion>();
  const characterModels = new Map<string, { bones: string[]; meshes: string[]; animations: string[] }>();
  const characterBones = new Map<string, Bone[]>();
  const characterLODs = new Map<string, CharacterLOD[]>();
  const animationVisibility = new AnimationVisibility();
  const visualFilter = createShadowCasterFilter(shadows.getLight().getShadowDirection());
  const visualPlanes = Frustum.GetPlanes(Matrix.Identity());
  const visualMeshes = new Map<string, AbstractMesh[]>();
  const library = createCharacterLibrary(scene);
  const attachGeometry = async (id: string, meshes: readonly AbstractMesh[], report?: ResourceProgress) => {
    loadingProgress.begin(id + ':geometry', `${id}：合批与 LOD 准备`);
    const sources = batchSkinnedMeshes(meshes, library.highBatches);
    const envelope = rigEnvelope(sources, actorById.get(id)!.root);
    if (envelope) visualMeshes.set(id, sources.filter(mesh => !!mesh.skeleton && !!mesh.getTotalVertices()).slice(0, 1));
    for (const mesh of sources) {
      mesh.isPickable = false;
      if (envelope) mesh.metadata = { ...mesh.metadata, rigEnvelope: envelope };
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
      mapParts: pairs.filter(({ source }) => scene.activeCamera && selectCharacterLOD(source, scene.activeCamera) !== source).length,
      farParts: pairs.filter(({ source, far }) => far && scene.activeCamera && selectCharacterLOD(source, scene.activeCamera) === far).length,
      sourceTriangles: pairs.reduce((sum, pair) => sum + pair.source.getTotalIndices() / 3, 0),
      mapTriangles: pairs.reduce((sum, pair) => sum + pair.detail.getTotalIndices() / 3, 0),
      farTriangles: pairs.reduce((sum, pair) => sum + (pair.far ?? pair.detail).getTotalIndices() / 3, 0),
      sharedSkeletonAndMaterials: pairs.every(({ source, detail, far }) => [detail, ...(far ? [far] : [])]
        .every(mesh => source.skeleton === mesh.skeleton && source.material === mesh.material)),
    };
  };
  let extraNeighbours: () => Neighbour[] = () => [];
  const destinationSpeed = (actor: typeof actors[number]) => commandedSpeed(actor.settings.speed, locomotion.has(actor.definition.id));
  const navigate = (actor: typeof actors[number], route: Point[], navigation: typeof actor.navigation, seconds: number, speed: number) =>
    stepRoute(actor.definition.id, actor.state.position, route, navigation, seconds,
      speed * effort(vitals, actor.definition.id), actor.settings.bodyRadius, actor.settings.bounds, obstaclesFor(actor.definition.role),
      [...extraNeighbours(), ...actors.filter(other => other !== actor && !dead(other.definition.id)).map(other => ({ id: other.definition.id, position: other.state.position,
        radius: other.settings.bodyRadius, moving: other.movementSpeed > .08, purposeful: !!other.route.length || !!other.state.target,
        waiting: (other.route.length ? other.navigation : other.wanderNavigation).waiting }))]);
  const workNeighbours = (actor: typeof actors[number]) => [...extraNeighbours(), ...actors.filter(other => other !== actor && !dead(other.definition.id)).map(other => ({
    position: other.state.position, radius: other.settings.bodyRadius, destination: other.route.at(-1),
  }))];
  const advanceRoute = (actor: typeof actors[number], seconds: number) => {
    const result = navigate(actor, actor.route, actor.navigation, seconds, destinationSpeed(actor));
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
      animationVisibility.reset(clips.walk, clips.run, clips.idle, clips.work);
      clips.walk.stop(); clips.run.stop(); clips.idle?.stop(); clips.work?.stop(); combatClips.get(id)?.stop();
      // Run starts at a running phase. Walk's first frame carries the complete
      // neutral pose, so stopping Run must reset Walk rather than reset Run.
      if (motion === 'idle') {
        if (clips.work && clips.idle) clips.idle.play(true);
        else (clips.idle ?? clips.walk).reset();
      } else if (motion !== 'attack') (motion === 'work' ? clips.work : motion === 'run' ? clips.run : clips.walk)?.play(true);
      clips.motion = motion;
    }
    if (motion === 'work' && clips.work) clips.work.speedRatio = (speed || 1) * HUMAN_SPEED_MULTIPLIER;
    else if (motion !== 'idle' && motion !== 'attack') {
      const clip = motion === 'run' ? clips.run : clips.walk;
      clip.speedRatio = speed / (motion === 'run' ? clips.runSpeed : clips.walkSpeed);
    }
  };
  return {
    setExtraNeighbours(read: () => Neighbour[]) { extraNeighbours = read; },
    occupancy: () => actors.filter(a => !dead(a.definition.id)).map(actor => ({ kind: 'circle' as const, x: actor.state.position.x, z: actor.state.position.z, radius: actor.definition.bodyRadius })),
    async loadDogModel() { await actorById.get('dog')!.animal!.loadModel(); },
    async loadFarmerModel(report?: ResourceProgress) {
      const farmers = actors.filter(a => a.definition.role === 'farmer');
      for (const [index, actor] of farmers.entries()) {
        await nextPaint();
        const result = await library.instantiate('farmer', actor.root);
        loadingProgress.begin(actor.definition.id + ':attach', `${actor.definition.name}：共享材质与动作挂接`);
        if (actor === farmer) farmerBones = result.skeletons.flatMap((skeleton) => skeleton.bones);
        characterBones.set(actor.definition.id, result.skeletons.flatMap(skeleton => skeleton.bones));
        characterModels.set(actor.definition.id, {
          bones: characterBones.get(actor.definition.id)!.map(bone => bone.name),
          meshes: result.meshes.map(mesh => mesh.name), animations: result.animationGroups.map(group => group.name),
        });
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
        loadingProgress.done(actor.definition.id + ':attach');
        await attachGeometry(actor.definition.id, result.meshes, fraction => report?.((index + .8 + .2 * fraction) / farmers.length));
      }
      const primary = locomotion.get(farmer.definition.id)!;
      farmerWalk = primary.walk; farmerRun = primary.run; farmerHammer = primary.work;
      farmerModelLoaded = true;
      report?.(1);
    },
    async loadSoldierModels(report?: ResourceProgress) {
      const soldiers = actors.filter(actor => soldierAssets.some(asset => asset.role === actor.definition.role));
      for (const [index, actor] of soldiers.entries()) {
        await nextPaint();
        const asset = soldierAssets.find(a => a.role === actor.definition.role)!;
        const roleProgress = (fraction: number) => report?.((index + fraction) / soldiers.length);
        const result = await library.instantiate(asset.role, actor.root);
        loadingProgress.begin(actor.definition.id + ':attach', `${actor.definition.name}：共享材质与动作挂接`);
        result.animationGroups.forEach(group => group.stop());
        const { walk, run, idle } = result;
        if (result.fallPosture) fallPostures.set(actor.definition.id, result.fallPosture);
        if (!walk || !run || (asset.mounted && !idle)) throw new Error(`${asset.role} is missing its locomotion clips`);
        registerLocomotion(actor.definition.id, walk, run, asset.mounted ? {
          idle, walkSpeed: mountMetadata.gaits.RideWalk.speed, runSpeed: mountedRunReferenceSpeed,
        } : {});
        if (asset.role === 'archer') bowPoses.set(actor.definition.id, result.bowPose);
        const attack = result.animationGroups.find(g => g.name === (asset.role === 'archer' ? 'BowShot' : asset.mounted ? 'LanceThrust' : 'SwordSlash'));
        if (!attack) throw new Error(`${asset.role} is missing its shared attack clip`);
        combatClips.set(actor.definition.id, attack);
        actor.human!.mesh.setEnabled(false);
        actor.animal?.mesh.setEnabled(false);
        loadingProgress.done(actor.definition.id + ':attach');
        const meshNames = result.meshes.map(mesh => mesh.name);
        await attachGeometry(actor.definition.id, result.meshes, fraction => roleProgress(.8 + .2 * fraction));
        characterModels.set(actor.definition.id, {
          bones: result.skeletons.flatMap(skeleton => skeleton.bones.map(bone => bone.name)),
          meshes: meshNames,
          animations: result.animationGroups.map(group => group.name),
        });
        characterBones.set(actor.definition.id, result.skeletons.flatMap(skeleton => skeleton.bones));
        report?.((index + 1) / soldiers.length);
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
    combatNeighbours: () => actors.filter(a => !combatPoses.has(a.definition.id) && !dead(a.definition.id)).map(a => ({ id: a.definition.id, position: a.state.position,
      radius: a.definition.bodyRadius, moving: a.movementSpeed > .08, purposeful: !!a.route.length, waiting: a.navigation.waiting })),
    syncCombat(units: Fighter[], seconds: number) {
      for (const u of units) {
        combatPoses.set(u.id, u);
        const actor = actorById.get(u.id)!;
        actor.state.position.x = u.position.x; actor.state.position.z = u.position.z;
        actor.route.length = 0; actor.state.target = undefined;
        if (actor.root.position.x !== u.position.x || actor.root.position.z !== u.position.z) actor.root.position.set(u.position.x, 0, u.position.z);

        actor.hit.isPickable = u.life !== 'defeated';
        if (u.life === 'defeated') {
          actor.label.hidden = true; actor.marker.setEnabled(false); resting.delete(u.id); works.delete(u.id);
          if (selected === actor) { selected = undefined; ui.setResident(); ui.setCombatHint(false); }
          const meshes = (characterLODs.get(u.id) ?? []).map(pair => pair.source);
          actor.death.sample(deathAge(u.diedAt, seconds), u.facing, meshes, () => {
            setMotion(u.id, 'idle'); bowPoses.get(u.id)?.();
            const clips = locomotion.get(u.id)!;
            for (const g of [clips.walk, clips.run, clips.idle, clips.work, combatClips.get(u.id)]) g?.stop();
            const rest = clips.idle ?? clips.walk;
            rest.enableBlending = false; rest.start(false).pause(); rest.goToFrame(rest.from);
          }, fallPostures.get(u.id));
          continue;
        }
        if (actor.death.snapshot().phase !== 'alive') { actor.death.reset(); actor.facing = NaN; }
        actor.root.setEnabled(true);
        if (actor.facing !== u.facing || !actor.root.rotationQuaternion) {
          actor.facing = u.facing; actor.root.rotationQuaternion ??= Quaternion.Identity();
          Quaternion.RotationYawPitchRollToRef(u.facing, 0, 0, actor.root.rotationQuaternion);
        }
        actor.movementSpeed = u.speed;
        const clip = combatClips.get(u.id);
        if (u.attack && clip) {
          setMotion(u.id, 'attack');
          if (playingAttack.get(u.id) !== u.attack.id) { clip.start(false); clip.pause(); playingAttack.set(u.id, u.attack.id); }
          // Sample native exported tracks from authoritative game time, including after load.
          const phase = Math.min(1, u.attack.elapsed / (fighterStats(u).windup + fighterStats(u).recovery));
          clip.goToFrame(clip.from + phase * (clip.to - clip.from));
          bowPoses.get(u.id)?.(phase);
        } else { bowPoses.get(u.id)?.(); playingAttack.delete(u.id); setMotion(u.id, u.speed > .08 ? 'run' : 'idle', u.speed); }
      }
      for (const actor of actors.filter(a => !combatPoses.has(a.definition.id) && dead(a.definition.id))) {
        const id = actor.definition.id;
        actor.route = []; actor.wanderRoute = []; actor.state.target = undefined; actor.movementSpeed = 0;
        actor.hit.isPickable = false; actor.label.hidden = true; actor.marker.setEnabled(false); resting.delete(id); works.delete(id);
        ui.clearResidentSpeech(id);
        if (selected === actor) { selected = undefined; ui.setResident(); ui.setCombatHint(false); }
        const meshes = actor.definition.role === 'dog' ? [actor.animal!.mesh] : (characterLODs.get(id) ?? []).map(p => p.source);
        if (actor.death.snapshot().phase === 'alive') actor.facing = actor.root.rotationQuaternion?.toEulerAngles().y ?? actor.facing;
        actor.death.sample(deathAge(vitals[id].diedAt, seconds), actor.facing, meshes, () => {
          if (actor.definition.role === 'dog') { actor.animal!.freezePose(); return; }
          setMotion(id, 'idle'); const clips = locomotion.get(id)!;
          for (const group of [clips.walk, clips.run, clips.idle, clips.work]) group?.stop();
          const rest = clips.idle ?? clips.walk; rest.enableBlending = false; rest.start(false).pause(); rest.goToFrame(rest.from);
        });
      }
    },
    farmerIds: () => actors.filter(a => a.definition.role === 'farmer').map(a => a.definition.id),
    setResting(id: string, yes: boolean) { if (yes) resting.add(id); else resting.delete(id); },
    needsStatus: (id: string) => {
      const a = actors.find(a => a.definition.id === id)!;
      return { position: a.state.position, speed: a.movementSpeed, moving: a.route.length > 0, working: works.get(id)?.status === 'working', goal: a.route.at(-1) };
    },
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
      }
      // Resolve reservations after every saved position is restored, including
      // older saves that assigned several units an identical destination.
      for (const actor of actors) {
        const goal = saved[actor.definition.id]?.manualGoal;
        if (goal) actor.route = planMoveDestination(actor.state.position, goal, actor.settings.bodyRadius, actor.settings.bounds,
          obstaclesFor(actor.definition.role), workNeighbours(actor)) ?? [];
      }
    },
    farmerPosition: (id = farmer.definition.id) => actors.find(a => a.definition.id === id)!.root.position,
    sharedLibraryInfo: library.summary,
    lodSummary: () => [...characterLODs].map(([id, pairs]) => ({ id, parts: pairs.length,
      mapParts: pairs.filter(({ source }) => scene.activeCamera && selectCharacterLOD(source, scene.activeCamera) !== source).length,
      farParts: pairs.filter(({ source, far }) => far && scene.activeCamera && selectCharacterLOD(source, scene.activeCamera) === far).length })),
    leaderPosition: () => leader.root.position,
    leaderModelInfo: () => ({
      meshes: characterModels.get(leader.definition.id)?.meshes ?? [],
      bones: (characterBones.get(leader.definition.id) ?? []).map(bone => bone.name),
      pose: (characterBones.get(leader.definition.id) ?? []).map(bone => (bone.getTransformNode()?.rotationQuaternion ?? bone.getRotationQuaternion()).asArray()),
      motion: locomotion.get(leader.definition.id)?.motion ?? 'idle',
      animations: characterModels.get(leader.definition.id)?.animations ?? [],
    }),
    farmerModelLoaded: () => farmerModelLoaded,
    leaderModelLoaded: () => characterModels.has(leader.definition.id),
    leaderWalking: () => locomotion.get(leader.definition.id)?.walk.isPlaying ?? false,
    leaderRunning: () => locomotion.get(leader.definition.id)?.run.isPlaying ?? false,
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
      actors.forEach(a => a.marker.setEnabled(false));
      selected = actors.find((actor) => actor.definition.id === id && !id?.startsWith('enemy-') && !dead(id!));
      selected?.marker.setEnabled(true);
      return selected?.definition.name;
    },
    selectionMeshes: () => actors.filter(a => a === selected).flatMap(a => [
      ...a.root.getChildMeshes().filter(m => m.isVisible && m.visibility > 0 && m !== a.marker && !m.metadata?.selectionKind),
      ...(characterLODs.get(a.definition.id) ?? []).flatMap(p => [p.source, p.detail, ...(p.far ? [p.far] : [])]),
    ]),
    selectedId: () => selected?.definition.id,
    routeFor: (id: string) => actorById.get(id)?.route ?? [],
    selectedCanMove: () => !!selected,
    canWork: (id: string) => !dead(id) && canResidentWork(id),
    hasMoveCommand: (id: string) => !!actors.find(actor => actor.definition.id === id && actor.route.length && !works.has(actor.definition.id)),
    command(point: Point, id = selected?.definition.id, exact = false) {
      const actor = actors.find(entry => entry.definition.id === id);
      if (!actor || dead(actor.definition.id)) return false;
      const path = exact ? planWorkApproach(actor.state.position, [point], actor.settings.bodyRadius, actor.settings.bounds,
        obstaclesFor(actor.definition.role), workNeighbours(actor)) : planMoveDestination(actor.state.position, point, actor.settings.bodyRadius, actor.settings.bounds,
        obstaclesFor(actor.definition.role), workNeighbours(actor));
      if (!path) return false;
      works.delete(actor.definition.id);
      actor.wanderRoute = []; resetRouteState(actor.wanderNavigation);
      actor.route = path; actor.state.target = undefined; actor.state.pause = 0; actor.state.blockedFor = 0;
      resetRouteState(actor.navigation);
      return true;
    },
    planFarmerWork(points: readonly Point[], unit = farmer.definition.id): Point[] | undefined {
      const farmer = actors.find(a => a.definition.id === unit)!;
      return planWorkApproach(farmer.state.position, points, farmer.settings.bodyRadius, farmer.settings.bounds, worldObstacles(), workNeighbours(farmer));
    },
    startFarmerWork(id: number, path: Point[], target: Point, unit = farmer.definition.id) {
      const farmer = actors.find(a => a.definition.id === unit)!;
      farmer.route = path; farmer.state.target = undefined;
      resetRouteState(farmer.navigation);
      works.set(unit, { id, target, status: 'travelling' });
    },
    farmerWorkState: (unit = farmer.definition.id): (Pick<Work, 'id' | 'status'> & { waitingFor?: number; approachOccupied?: boolean }) | undefined => {
      const work = works.get(unit), actor = actors.find(a => a.definition.id === unit)!;
      const goal = actor.route.at(-1);
      return work && { id: work.id, status: work.status, waitingFor: actor.navigation.waited,
        approachOccupied: !!goal && occupiedApproach(goal, actor.settings.bodyRadius, workNeighbours(actor)) };
    },
    beginFarmerWork(id: number, unit = farmer.definition.id) { const work = works.get(unit); if (work?.id === id && work.status === 'arrived') work.status = 'working'; },
    releaseFarmerWork(unit = farmer.definition.id) { works.delete(unit); const actor = actors.find(a => a.definition.id === unit)!; actor.route = []; resetRouteState(actor.navigation); setMotion(unit, 'idle'); },
    update(frameSeconds: number, previewRole?: 'farmer' | 'leader', frameElapsed = frameSeconds) {
      // Advance the whole crowd in short shared ticks. Previously one resident
      // could consume a half-second of movement against everybody else's old
      // position before the next resident got a turn on a slow frame.
      const ticks = Math.max(1, Math.ceil(Math.min(frameElapsed, .5) / .05));
      const seconds = frameSeconds / ticks, activeElapsed = Math.min(frameElapsed, .5) / ticks;
      for (let tick = 0; tick < ticks; tick++) for (const actor of actors) {
        if (combatPoses.has(actor.definition.id) || dead(actor.definition.id)) continue;
        actor.movementSpeed = 0;
        if (seconds <= 0) continue;
        if (resting.has(actor.definition.id) && !actor.route.length) { setMotion(actor.definition.id, 'idle'); actor.movementSpeed = 0; actor.animal?.update(seconds, 0, 0, false, !!vitals[actor.definition.id]?.meal); continue; }
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
            work.status === 'working' ? activeElapsed / seconds * effort(vitals, actor.definition.id) : moved / seconds);
          continue;
        }
        if (previewRole === 'farmer' && actor === farmer || previewRole === 'leader' && actor === leader) {
          actor.root.rotationQuaternion ??= Quaternion.Identity();
          Quaternion.RotationYawPitchRollToRef(Math.PI, 0, 0, actor.root.rotationQuaternion);
          if (actor === farmer) setMotion(actor.definition.id, seconds > 0 ? 'walk' : 'idle', walkReferenceSpeed * HUMAN_SPEED_MULTIPLIER);
          else setMotion(actor.definition.id, 'idle');
          continue;
        }
        const crowd: Obstacle[] = [...extraNeighbours().map(n => ({ kind: 'circle' as const, ...n.position, radius: n.radius })), ...actors.filter((other) => other !== actor && !dead(other.definition.id)).map((other) => ({
          kind: 'circle' as const, x: other.state.position.x, z: other.state.position.z, radius: other.definition.bodyRadius,
        }))];
        const blockers = crowd.filter((other) => other.kind === 'circle'
          && Math.hypot(other.x - actor.state.position.x, other.z - actor.state.position.z) >= other.radius + actor.settings.bodyRadius - 0.001);
        let velocity: Point;
        const commanded = actor.route.length > 0;
        if (actor.route.length) {
          const before = { ...actor.state.position };
          let remaining = Math.min(activeElapsed, .5);
          while (remaining > 1e-8 && actor.route.length) {
            const step = Math.min(remaining, .05);
            if (advanceRoute(actor, step).unreachable) { actor.route = []; ui.targetHint('目标暂时无法到达', { x: actor.root.position.x, y: 2, z: actor.root.position.z }); break; }
            remaining -= step;
          }
          velocity = { x: (actor.state.position.x - before.x) / seconds, z: (actor.state.position.z - before.z) / seconds };
          if (!actor.route.length) actor.state.pause = 3;
        } else if (actor.definition.role === 'farmer') velocity = { x: 0, z: 0 };
        else velocity = stepWander(actor.state, actor.settings, seconds, [...obstaclesFor(actor.definition.role), ...blockers], actor.random, (goal, dt, speed) => {
          const last = actor.wanderRoute.at(-1);
          if (!last || Math.hypot(last.x - goal.x, last.z - goal.z) > .001) {
            actor.wanderRoute = [{ ...goal }]; resetRouteState(actor.wanderNavigation);
          }
          return navigate(actor, actor.wanderRoute, actor.wanderNavigation, dt, speed);
        });
        const speed = Math.hypot(velocity.x, velocity.z);
        actor.movementSpeed = speed;
        setMotion(actor.definition.id, speed > 0.08 ? commanded ? 'run' : 'walk' : 'idle', speed);
        actor.root.position.set(actor.state.position.x, 0, actor.state.position.z);
        if (actor.definition.role === 'farmer' || characterModels.has(actor.definition.id)) {
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
    updateAnimationVisibility(camera: Camera, seconds: number, preview = false) {
      Frustum.GetPlanesToRef(camera.getTransformationMatrix(), visualPlanes);
      for (const actor of actors) {
        const clips = locomotion.get(actor.definition.id), meshes = visualMeshes.get(actor.definition.id);
        if (dead(actor.definition.id) || !clips || !meshes?.length || clips.motion === 'attack') continue;
        const visible = preview || actor === selected || visualFilter(meshes, 1, visualPlanes).length > 0;
        const active = clips.motion === 'idle' ? clips.idle : clips.motion === 'work' ? clips.work : clips.motion === 'run' ? clips.run : clips.walk;
        animationVisibility.update(active, visible, seconds);
      }
    },
    updateLabels(camera: Camera) {
      const width = ui.canvas.clientWidth, height = ui.canvas.clientHeight;
      const viewport = camera.viewport.toGlobal(width, height);
      for (const actor of actors) {
        labelPoint.set(actor.state.position.x, actor.definition.labelHeight, actor.state.position.z);
        Vector3.ProjectToRef(labelPoint, identity, scene.getTransformMatrix(), viewport, labelProjected);
        const projected = labelProjected;
        const closeEnough = actor === selected || (camera.orthoTop ?? 0) - (camera.orthoBottom ?? 0) < 50;
        const visible = closeEnough && !dead(actor.definition.id) && projected.z >= 0 && projected.z <= 1 && projected.x >= 0 && projected.x <= width && projected.y >= 0 && projected.y <= height;
        if (actor.label.hidden !== !visible) actor.label.hidden = !visible;
        if (!visible) { ui.positionSpeech(actor.definition.id, 0, 0, false); continue; }
        ui.positionSpeech(actor.definition.id, projected.x, projected.y, visible);
        ui.positionResidentLabel(actor.definition.id, projected.x, projected.y);
      }
    },
    snapshot: () => actors.map((actor) => ({
      id: actor.definition.id, role: actor.definition.role, name: actor.definition.name, effects: actor.definition.effects ?? [],
      death: actor.death.snapshot(),
      model: characterModels.get(actor.definition.id),
      lod: lodInfo(actor.definition.id), dogLOD: actor.definition.role === 'dog' ? actor.animal?.lodInfo() : undefined,
      modelPose: characterBones.get(actor.definition.id)?.map(bone =>
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
      destination: actor.route.at(-1),
      moveCommand: !!actor.route.length && !works.has(actor.definition.id),
      navigation: { ...actor.navigation },
      wanderNavigation: { ...actor.wanderNavigation },
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
