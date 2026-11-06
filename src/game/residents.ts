import { surfaceHeight } from './terrain-height.ts';
import type { ResidentFrame } from './resident-simulation.ts';
import {bodyObstacle} from './body-shape.ts';
import { createResidentPicking } from './picking-shapes.ts';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { attackAnimationPhase } from './combat-animation';
import { DeathView, MountedDeathView } from './death-view.ts';
import type { MountedDeathProfile } from './death-view.ts';
import { UNIT_SELECTION_COLOR } from './selection-colors.ts';
import { deathAge } from './death.ts';
import { nextPaint } from '../launcher.ts';
import type { Fighter } from './combat.ts';
import { fighterStats } from './combat.ts';
import type { Vitals } from './vitals.ts';
import type { ResidentDefinition } from './resident-data.ts';
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
import { WORK_PLAYBACK_RATE } from './action-timing.ts';
import { RESIDENTS, ENEMIES, RESIDENT_OBSTACLES, canResidentWork, roleLeader, wanderSettings } from './resident-data.ts';
import { runReferenceSpeed, mountedRunReferenceSpeed } from './locomotion.ts';
import { createWanderState, seededRandom } from './wander.ts';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { createRouteState } from './route-following.ts';
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
import { RenderMotion } from './render-motion.ts';
import { SimulationClock } from './simulation-clock.ts';

const walkReferenceSpeed = animationMetadata.animations.Walk.navigation_speed_reference;
type ResourceProgress = (fraction: number) => void;

export function createResidents(scene: Scene, p: Palette, shadows: ShadowGenerator, ui: GameUI,
  worldObstacles: (avoidFields?: boolean) => readonly Obstacle[] = () => RESIDENT_OBSTACLES, vitals: Vitals = {},
  definitions:readonly ResidentDefinition[]=[...RESIDENTS,...ENEMIES], elevation:(id:string)=>number=()=>0,
  restored:(id:string)=>Point|undefined=()=>undefined) {
  const obstaclesFor = (role: string) => worldObstacles(role !== 'farmer');
  const placeholderRoles = new Set<string>();
  const mountedDeathProfile:MountedDeathProfile={};
  const soldierAssets = [
    { role: 'infantry', mounted: false },
    { role: 'cavalry', mounted: true },
    { role: 'archer', mounted: false },
  ] as const;
  const seed = import.meta.env.VITE_E2E === 'true' ? 624 : Math.floor(Math.random() * 0xffffffff);
  const selectionMaterial = new StandardMaterial('unit-selection', scene);
  selectionMaterial.emissiveColor = Color3.FromHexString(UNIT_SELECTION_COLOR); selectionMaterial.disableLighting = true;
  const createActor = (definition:ResidentDefinition, index:number) => {
    const random = seededRandom(seed + (index + 1) * 1337);
    const settings = wanderSettings(definition);
    const state = createWanderState(definition.spawn, settings, obstaclesFor(definition.role), random,restored(definition.id));
    const human = definition.role === 'dog' ? undefined : createCharacter(scene, p, shadows, {
      id: definition.id, role: definition.role, marker: false, modelOnly:true, phase: index * 1.2, mounted: definition.role === 'cavalry',
    });
    const animal = definition.role === 'dog' || definition.role === 'cavalry'
      ? createAnimal(scene, p, shadows, definition.role === 'dog' ? 'dog' : 'horse', `${definition.id}-animal`,true) : undefined;
    const root = animal?.root ?? human!.root;
    const elevationRoot=new TransformNode(`${definition.id}-elevation`,scene);root.parent=elevationRoot;
    if (definition.role === 'cavalry' && human) {
      human.root.parent = root; human.root.position.set(0, 0.88, -0.1);
    }
    root.position.set(state.position.x, surfaceHeight(state.position.x,state.position.z), state.position.z);
    const hit = createResidentPicking(scene, root, definition.id, definition.role);
    const marker = MeshBuilder.CreateTorus(`${definition.id}-selection`, { diameter: 1.3, thickness: 0.055, tessellation: 32 }, scene);
    marker.parent = root; marker.position.y = 0.08; marker.material = selectionMaterial; marker.isPickable = false; marker.setEnabled(false);
    human?.update(0, 0, 0); animal?.update(0, 0, 0);
    const label = ui.addResidentLabel(definition.id, placeholderRoles.has(definition.role) ? `${definition.name}（占位）` : definition.name, definition.effects?.includes('leader'));
    return { definition, random, settings, state, human, animal, root, elevationRoot, label, marker, hit, renderMotion: new RenderMotion(root),
      death: definition.role === 'cavalry' ? new MountedDeathView(root,mountedDeathProfile) : new DeathView(root, { prone: definition.role !== 'dog' }), facing: Math.PI, movementSpeed: 0,
      ready:false, stepPath: undefined as readonly Point[] | undefined, stepFacing: undefined as number | undefined,
      route: [] as Point[], navigation: createRouteState(), wanderRoute: [] as Point[], wanderNavigation: createRouteState() };
  };
  const actors=definitions.map(createActor);
  const actorById = new Map(actors.map(actor => [actor.definition.id, actor]));
  const labelPoint = new Vector3(), labelProjected = new Vector3();
  const identity = Matrix.Identity();
  const farmer = actors.find((actor) => actor.definition.role === 'farmer')!;
  const leader = actors.find(actor => actor.definition.id === roleLeader('farmer')?.id)!;
  let farmerModelLoaded = false;
  let selected: typeof actors[number] | undefined;
  let selectedMembers=new Set<string>();
  let attaching=Promise.resolve();
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
    if (motion === 'work' && clips.work) clips.work.speedRatio = (speed || 1) * WORK_PLAYBACK_RATE;
    else if (motion !== 'idle' && motion !== 'attack') {
      const clip = motion === 'run' ? clips.run : clips.walk;
      clip.speedRatio = speed / (motion === 'run' ? clips.runSpeed : clips.walkSpeed);
    }
  };
  const api = {
    syncDefinitions(definitions:readonly ResidentDefinition[]) {
      const ids=new Set(definitions.map(d=>d.id));
      for(const actor of [...actors]) {
        const id=actor.definition.id;if(!id.startsWith('enemy-raid-')||ids.has(id))continue;
        for(const mesh of actor.root.getChildMeshes())shadows.removeShadowCaster(mesh,false);
        actor.elevationRoot.dispose();ui.removeResidentLabel(id);actorById.delete(id);actors.splice(actors.indexOf(actor),1);
        for(const map of [locomotion,characterModels,characterBones,characterLODs,combatClips,fallPostures,bowPoses,visualMeshes,combatPoses,playingAttack])map.delete(id);
        for(const stage of ['attach','geometry','death'])loadingProgress.items.delete(`${id}:${stage}`);
      }
      const added=definitions.filter(d=>!actorById.has(d.id));
      if(!added.length)return attaching;
      for(const d of added){const actor=createActor(d,actors.length);actor.root.setEnabled(false);actors.push(actor);actorById.set(d.id,actor);}
      attaching=attaching.then(async()=>{await api.loadFarmerModel();await api.loadSoldierModels();await api.loadDogModel();});
      return attaching;
    },
    occupancy: () => actors.filter(a => !dead(a.definition.id) && !combatPoses.get(a.definition.id)?.departed && a.elevationRoot.position.y<.1).map(actor => bodyObstacle(actor.state.position,actor.settings.bodyRadius)),
    async loadDogModel() { for(const actor of actors.filter(a=>a.definition.role==='dog'&&!a.ready)){await actor.animal!.loadModel();actor.ready=true;actor.root.setEnabled(true);} },
    async loadFarmerModel(report?: ResourceProgress) {
      const farmers = actors.filter(a => a.definition.role === 'farmer'&&!a.ready);
      for (const [index, actor] of farmers.entries()) {
        await nextPaint();
        const result = await library.instantiate('farmer', actor.root);
        if(actor.root.isDisposed())continue;
        loadingProgress.begin(actor.definition.id + ':attach', `${actor.definition.name}：共享材质与动作挂接`);
        if (actor === farmer) farmerBones = result.skeletons.flatMap((skeleton) => skeleton.bones);
        characterBones.set(actor.definition.id, result.skeletons.flatMap(skeleton => skeleton.bones));
        characterModels.set(actor.definition.id, {
          bones: characterBones.get(actor.definition.id)!.map(bone => bone.name),
          meshes: result.meshes.map(mesh => mesh.name), animations: result.animationGroups.map(group => group.name),
        });
        const farmerWalk = result.walk, farmerRun = result.run, farmerHammer = result.work;
        if (!farmerHammer) throw new Error('农民缺少共享作业动作');
        // Blending flags are actor-local. Key arrays remain shared and immutable.
        for (const clip of [farmerWalk, farmerRun, farmerHammer]) {
          for (const target of clip.targetedAnimations) target.animation = target.animation.clone();
        }
        // Reuse the authored neutral Walk pose for a native blended rest state.
        // This is not another authored body/rig/action set.
        const rest = farmerWalk.clone('Farmer rest pose', undefined, true);
        actor.root.onDisposeObservable.addOnce(()=>rest.dispose());
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
        actor.ready=true;actor.root.setEnabled(true);
      }
      const primary = locomotion.get(farmer.definition.id)!;
      farmerWalk = primary.walk; farmerRun = primary.run; farmerHammer = primary.work;
      farmerModelLoaded = true;
      report?.(1);
    },
    async loadSoldierModels(report?: ResourceProgress) {
      const soldiers = actors.filter(actor => !actor.ready&&soldierAssets.some(asset => asset.role === actor.definition.role));
      for (const [index, actor] of soldiers.entries()) {
        await nextPaint();
        const asset = soldierAssets.find(a => a.role === actor.definition.role)!;
        const roleProgress = (fraction: number) => report?.((index + fraction) / soldiers.length);
        const result = await library.instantiate(asset.role, actor.root);
        if(actor.root.isDisposed())continue;
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
        if(actor.death instanceof MountedDeathView&&!actor.death.prepared){
          const preparation=actor.definition.id+':death';loadingProgress.begin(preparation,'骑兵：退场接地曲线准备');
          await nextPaint();
          actor.death.prepare(actor.facing,(characterLODs.get(actor.definition.id)??[]).map(p=>p.source),()=>{
            for(const group of result.animationGroups)group.stop();
            idle!.enableBlending=false;idle!.start(false).pause();idle!.goToFrame(idle!.from);
          },result.fallPosture);
          registerLocomotion(actor.definition.id,walk,run,{idle,walkSpeed:mountMetadata.gaits.RideWalk.speed,runSpeed:mountedRunReferenceSpeed});
          loadingProgress.done(preparation);await nextPaint();
        }
        actor.ready=true;actor.root.setEnabled(true);
        report?.((index + 1) / soldiers.length);
      }
    },
    async loadRolePlaceholders(report?: ResourceProgress) {
      const placeholders = actors.filter(entry => placeholderRoles.has(entry.definition.role));
      for (const [index, actor] of placeholders.entries()) {
        const instance = await library.instantiate('base', actor.root);
        if(actor.root.isDisposed())continue;
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
      radius: a.definition.bodyRadius, heading:a.route.length?Math.atan2(a.route[0].x-a.state.position.x,a.route[0].z-a.state.position.z):a.facing,moving: a.movementSpeed > .08, purposeful: !!a.route.length||works.has(a.definition.id), waiting: a.navigation.waiting, destination:a.route.at(-1) })),
    applySimulation(frames:readonly ResidentFrame[],seconds:number){
      for(const frame of frames){
        const actor=actorById.get(frame.id);if(!actor)continue;
        const before={...actor.state.position};actor.state.position={...frame.position};actor.state.target=undefined;
        actor.route=frame.route;Object.assign(actor.navigation,frame.navigation);actor.stepPath=frame.path;
        actor.movementSpeed=frame.speed;actor.facing=frame.facing;
        actor.root.position.set(frame.position.x,surfaceHeight(frame.position.x,frame.position.z),frame.position.z);
        actor.root.rotationQuaternion??=Quaternion.Identity();Quaternion.RotationYawPitchRollToRef(frame.facing,0,0,actor.root.rotationQuaternion);
        if(frame.work)works.set(frame.id,frame.work);else works.delete(frame.id);
        if(dead(frame.id))continue;
        setMotion(frame.id,frame.motion,frame.playbackSpeed);
        if(seconds>0)actor.animal?.update(seconds,(frame.position.x-before.x)/seconds,(frame.position.z-before.z)/seconds,frame.motion==='run',frame.feeding);
      }
    },
    syncCombat(units: Fighter[]) {
      for (const u of units) {
        combatPoses.set(u.id, u);
        const actor = actorById.get(u.id);if(!actor)continue;
        actor.elevationRoot.position.y=elevation(u.id);
        actor.state.position.x = u.position.x; actor.state.position.z = u.position.z;
        actor.route.length = 0; actor.state.target = undefined;
        if (actor.root.position.x !== u.position.x || actor.root.position.z !== u.position.z) actor.root.position.set(u.position.x, surfaceHeight(u.position.x,u.position.z), u.position.z);

        actor.hit.isPickable = u.life !== 'defeated';
        if(u.departed){actor.root.setEnabled(false);actor.label.hidden=true;continue;}
        if (u.life === 'defeated') {
          if(!actor.ready){actor.root.setEnabled(false);continue;}
          actor.label.hidden = true; actor.marker.setEnabled(false); works.delete(u.id);
          if (selected === actor) { selected = undefined; ui.setResident(); ui.setCombatHint(false); }
          continue;
        }
        if (actor.death.snapshot().phase !== 'alive') { actor.death.reset(); actor.facing = NaN; }
        actor.root.setEnabled(actor.ready);
        if (actor.facing !== u.facing || !actor.root.rotationQuaternion) {
          actor.facing = u.facing; actor.root.rotationQuaternion ??= Quaternion.Identity();
          Quaternion.RotationYawPitchRollToRef(u.facing, 0, 0, actor.root.rotationQuaternion);
        }
        actor.movementSpeed = u.speed;
        Object.assign(actor.navigation,u.navigation);
        const clip = combatClips.get(u.id);
        if (u.attack && clip) {
          setMotion(u.id, 'attack');
          if (playingAttack.get(u.id) !== u.attack.id) { clip.start(false); clip.pause(); playingAttack.set(u.id, u.attack.id); }
          // Sample native exported tracks from authoritative game time, including after load.
          const stats = fighterStats(u);
          const phase = attackAnimationPhase(u.role, u.attack.elapsed, stats.windup, stats.recovery);
          clip.goToFrame(clip.from + phase * (clip.to - clip.from));
          bowPoses.get(u.id)?.(phase);
        } else { bowPoses.get(u.id)?.(); playingAttack.delete(u.id); setMotion(u.id, u.speed > .08 ? 'run' : 'idle', u.speed); }
      }
      for (const actor of actors.filter(a => a.ready && !combatPoses.has(a.definition.id) && dead(a.definition.id))) {
        const id = actor.definition.id;
        actor.route = []; actor.wanderRoute = []; actor.state.target = undefined; actor.movementSpeed = 0;
        actor.hit.isPickable = false; actor.label.hidden = true; actor.marker.setEnabled(false); works.delete(id);
        ui.clearResidentSpeech(id);
        if (selected === actor) { selected = undefined; ui.setResident(); ui.setCombatHint(false); }
      }
    },
    farmerIds: () => actors.filter(a => a.definition.role === 'farmer').map(a => a.definition.id),
    needsStatus: (id: string) => {
      const a = actors.find(a => a.definition.id === id)!;
      return { position: a.state.position, speed: a.movementSpeed, moving: a.route.length > 0, working: works.get(id)?.status === 'working', goal: a.route.at(-1) };
    },
    farmerPosition: (id = farmer.definition.id) => actors.find(a => a.definition.id === id)!.root.position,
    sharedLibraryInfo: library.summary,
    resourceCounts: library.resources,
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
    select(id?: string, members:readonly string[]=id?[id]:[]) {
      actors.forEach(a => a.marker.setEnabled(false));
      selected = actors.find((actor) => actor.definition.id === id && !id?.startsWith('enemy-') && !dead(id!));
      selectedMembers=new Set(members.filter(id=>actorById.has(id)&&!dead(id)));
      for(const actor of actors)actor.marker.setEnabled(selectedMembers.has(actor.definition.id));
      return selected?.definition.name;
    },
    selectionMeshes: () => actors.filter(a => selectedMembers.has(a.definition.id)&&!dead(a.definition.id)).flatMap(a => [
      ...a.root.getChildMeshes().filter(m => m.isVisible && m.visibility > 0 && m !== a.marker && !m.metadata?.selectionKind),
      ...(characterLODs.get(a.definition.id) ?? []).flatMap(p => [p.source, p.detail, ...(p.far ? [p.far] : [])]),
    ]),
    selectedId: () => selected?.definition.id,
    selectedIds:()=>[...selectedMembers].filter(id=>!dead(id)),
    routeFor: (id: string) => actorById.get(id)?.route ?? [],
    selectedCanMove: () => !!selected,
    canWork: (id: string) => !dead(id) && canResidentWork(id),
    hasMoveCommand: (id: string) => !!actors.find(actor => actor.definition.id === id && actor.route.length && !works.has(actor.definition.id)),
    farmerWorkState: (unit = farmer.definition.id): (Pick<Work, 'id' | 'status'> & { waitingFor?: number; approachOccupied?: boolean; path?: readonly Point[] }) | undefined => {
      const work = works.get(unit), actor = actors.find(a => a.definition.id === unit)!;
        return work && { id: work.id, status: work.status, path: actor.route, waitingFor: actor.navigation.waited,
        approachOccupied: false };
    },
    resetPresentation() { for (const a of actors) a.renderMotion.reset(); },
    beginStep() { for (const a of actors) { a.stepPath = undefined; a.stepFacing = undefined; a.renderMotion.beginStep(); } },
    endStep() { for (const a of actors) a.renderMotion.endStep(a.stepPath); },
    present(alpha: number, seconds: number, duration=SimulationClock.step) {
      let moving = 0, advanced = 0;
      for (const actor of actors) {
        if (!actor.ready || combatPoses.get(actor.definition.id)?.departed) { actor.renderMotion.reset(); continue; }
        if (dead(actor.definition.id)) {
          const id=actor.definition.id,u=combatPoses.get(id);
          if(!u&&actor.death.snapshot().phase==='alive')actor.facing=actor.root.rotationQuaternion?.toEulerAngles().y??actor.facing;
          const meshes=actor.definition.role==='dog'?[actor.animal!.mesh]:(characterLODs.get(id)??[]).map(p=>p.source);
          // Death remains authoritative at 20 Hz. Only native visual tracks use
          // the same interpolated game time as movement and sampled attacks.
          actor.death.sample(deathAge(u?.diedAt??vitals[id].diedAt,seconds-(1-alpha)*duration),u?.facing??actor.facing,meshes,()=>{
            if(actor.definition.role==='dog'){actor.animal!.freezePose();return;}
            setMotion(id,'idle');bowPoses.get(id)?.();const clips=locomotion.get(id)!;
            for(const group of [clips.walk,clips.run,clips.idle,clips.work,combatClips.get(id)])group?.stop();
            const rest=clips.idle??clips.walk;rest.enableBlending=false;rest.start(false).pause();rest.goToFrame(rest.from);
          },fallPostures.get(id),surfaceHeight(actor.state.position.x,actor.state.position.z));
          actor.renderMotion.reset();continue;
        }
        const changed = actor.renderMotion.sample(alpha);
        if (actor.movementSpeed > .08) { moving++; if (changed) advanced++; }
        const u = combatPoses.get(actor.definition.id), clip = combatClips.get(actor.definition.id);
        if (u?.attack && clip) {
          const stats = fighterStats(u), elapsed = Math.max(0, u.attack.elapsed - (1 - alpha) * duration);
          const phase = attackAnimationPhase(u.role, elapsed, stats.windup, stats.recovery);
          clip.goToFrame(clip.from + phase * (clip.to - clip.from)); bowPoses.get(u.id)?.(phase);
        }
      }
      return { moving, advanced };
    },
    displayPosition(id: string) { return actorById.get(id)?.renderMotion.position; },
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
        const position = actor.renderMotion.position;
        labelPoint.set(position.x, position.y+actor.definition.labelHeight+actor.elevationRoot.position.y, position.z);
        Vector3.ProjectToRef(labelPoint, identity, scene.getTransformMatrix(), viewport, labelProjected);
        const projected = labelProjected;
        const closeEnough = actor === selected || (camera.orthoTop ?? 0) - (camera.orthoBottom ?? 0) < 50;
        const visible = closeEnough && actor.ready && !combatPoses.get(actor.definition.id)?.departed && !dead(actor.definition.id) && projected.z >= 0 && projected.z <= 1 && projected.x >= 0 && projected.x <= width && projected.y >= 0 && projected.y <= height;
        if (actor.label.hidden !== !visible) actor.label.hidden = !visible || !actor.ready;
        if (!visible) { ui.positionSpeech(actor.definition.id, 0, 0, false); continue; }
        ui.positionSpeech(actor.definition.id, projected.x, projected.y, visible);
        ui.positionResidentLabel(actor.definition.id, projected.x, projected.y);
      }
    },
    snapshot: () => actors.map((actor) => ({
      id: actor.definition.id, role: actor.definition.role, name: actor.definition.name, effects: actor.definition.effects ?? [],
      death: actor.death.snapshot(), elevation:actor.elevationRoot.position.y,
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
      legacyVisible: !!actor.human?.mesh.isEnabled() || (actor.definition.role === 'cavalry' && !!actor.animal?.mesh?.isEnabled()),
      position: { ...actor.state.position }, renderPosition: { x: actor.renderMotion.position.x, z: actor.renderMotion.position.z }, state: actor.state.target ? 'walking' : 'idle',
      facing: actor.root.rotationQuaternion?.asArray() ?? [],
      routeRemaining: actor.route.length,
      destination: actor.route.at(-1),
      moveCommand: !!actor.route.length && !works.has(actor.definition.id),
      navigation: { ...actor.navigation },
      wanderNavigation: { ...actor.wanderNavigation },
      travelled: actor.state.distanceTravelled, reached: actor.state.destinationsReached,
      bodyRadius: actor.definition.bodyRadius,
      humanBones: actor.human?.skeleton?.bones.map((bone) => bone.name) ?? [],
      animalBones: actor.animal?.skeleton?.bones.map((bone) => bone.name) ?? [],
      humanRigId: actor.human?.skeleton?.uniqueId,
      parts: [...(actor.human?.partNames ?? []), ...(actor.animal?.partNames ?? [])],
      pose: (actor.human ?? actor.animal)?.skeleton?.bones.map((bone) => bone.getRotation().asArray()) ?? [],
    })),
  };
  return api;
}
