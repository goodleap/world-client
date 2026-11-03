import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';

// Real WebGL/GLB playback, advancing and capturing EVERY 1/60-second frame.
// Vite response instrumentation is local to this review, never shipped in game.
const out = process.env.MOTION_REVIEW_DIR || '/tmp/world-motion-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const reports = [];
try {
  for (const scenario of (process.env.MOTION_REVIEW_SCENARIOS || 'farmer,infantry,archer,cavalry,haul').split(',')) {
    const id = scenario === 'haul' ? 'farmer' : scenario;
    const e = new Economy(); e.setLeadership(false); e.state.seconds = 10; e.state.raids.nextAt = 1000;
    for (const u of e.state.combat.units) if (u.team === 'enemy') { u.life = 'defeated'; u.hp = 0; u.diedAt = 0; }
    for (const camp of e.state.combat.camps) camp.cleared = camp.rewardGranted = camp.discovered = true;
    e.state.combat.cleared = e.state.combat.rewardGranted = e.state.combat.discovered = true;
    for (const w of e.state.raids.wildWolves) { w.life = 'defeated'; w.hp = 0; w.diedAt = 0; w.settled = true; }
    for (const v of Object.values(e.state.vitals)) v.manualUntil = 1000;
    const start = scenario === 'haul' ? { x: -8, z: -1 } : { x: -10, z: -18 };
    if (id === 'farmer') e.state.residents[id] = { position: start };
    else e.state.combat.units.find(u => u.id === id).position = start;
    if (scenario === 'haul') { e.state.goods.push({ id: 'goods-1', resource: 'wood', amount: 8, state: 'ground', x: -5, z: -1 }); e.state.nextId = 2; }
    const save=encodeEconomy(e); decodeEconomy(save);
    const page = await browser.newPage({ viewport: { width: 800, height: 650 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(save => {
      localStorage.setItem('world-basic-economy-v1', save); localStorage.setItem('world-shadows-enabled', 'false');
    }, save);
    await page.route('**/src/game/game.ts*', async route => {
      const response = await route.fetch(), source = await response.text();
      assert(source.includes('canSave = true;'));
      await route.fulfill({ response, body: source.replace('canSave = true;', `canSave = true;
        engine.stopRenderLoop(render); scene.useConstantAnimationDeltaTime=true; engine.getDeltaTime=()=>1000/60;
        window.__motionReview={scene,engine,render,combat,residents,simulationClock,ui,economy,controller,camera,mapCenter,
          frame(){engine.beginFrame();render();engine.endFrame();engine.stopRenderLoop();},
          view(x,z,size){zoom=size;mapCenter.set(x,0,z);camera.target.copyFrom(mapCenter);}};`) });
    });
    await page.goto(process.env.MOTION_REVIEW_URL || 'http://127.0.0.1:5174/');
    await page.locator('#continue-save').click();
    await page.waitForFunction(() => window.__motionReview, null, { timeout: 90000 });
    const accepted = await page.evaluate(({ id, scenario }) => {
      const r = window.__motionReview; r.residents.select(id);
      r.view(scenario === 'haul' ? -1 : -6, scenario === 'haul' ? 0 : -14, scenario === 'haul' ? 8 : 6);
      const root = r.scene.getTransformNodeByName(`${id === 'cavalry' ? id + '-animal' : id}-render-motion`);
      const descendants = new Set(root.getDescendants());
      r.clips = r.scene.animationGroups.filter(g => g.targetedAnimations.some(a => descendants.has(a.target)));
      r.starts = []; for (const clip of r.clips) clip.onAnimationGroupPlayObservable.add(() => r.starts.push(clip.name));
      return scenario === 'haul'
        ? r.controller.command(id, { kind: 'work', work: 'haul', target: 'goods-1' }).ok
        : id === 'farmer' ? r.residents.command({ x: -2, z: -18 }, id) : !!r.combat.move([id], { x: -2, z: -18 });
    }, { id, scenario });
    assert(accepted, scenario + ' accepted');
    const dir = `${out}/${scenario}`; await mkdir(dir, { recursive: true });
    const samples = [], commands = [], maxFrames = scenario === 'haul' ? 360 : 165;
    for (let frame = 0; frame < maxFrames; frame++) {
      if (scenario !== 'haul' && [45, 90, 120].includes(frame)) {
        const accepted = await page.evaluate(({ id, frame }) => {
          const r=window.__motionReview, p=r.residents.snapshot().find(u=>u.id===id).position;
          const goal=frame===45?{x:p.x,z:-10}:{x:frame===90?-10:-2,z:p.z};
          return id==='farmer'?r.residents.command(goal,id):!!r.combat.move([id],goal);
        }, { id, frame });
        assert(accepted); commands.push(frame);
      }
      const sample = await page.evaluate(id => {
        const r=window.__motionReview; r.frame();
        const u=r.residents.snapshot().find(u=>u.id===id), fighter=r.combat.unit(id);
        return {position:u.position,renderPosition:u.renderPosition,pose:u.modelPose,motion:u.motion,speed:u.movementSpeed,
          facing:u.facing,route:(fighter?.route??r.residents.routeFor(id)).length,waiting:fighter?.navigation.waiting??u.navigation.waiting,
          phase:r.economy.active(id)?.status,stock:r.economy.state.inventory.wood,
          clips:r.clips.filter(g=>g.isPlaying).map(g=>({name:g.name,frame:g.animatables[0]?.masterFrame})),starts:r.starts.slice()};
      }, id);
      samples.push(sample);
      await page.screenshot({ path: `${dir}/${String(frame).padStart(4,'0')}.png`, scale: 'css' });
      if (scenario === 'haul' && sample.stock === e.state.inventory.wood + 8) break;
    }
    assert.deepEqual(errors, []);
    const continuous = samples.slice(6);
    if (scenario !== 'haul') {
      assert(continuous.every(s=>s.motion==='run'&&s.speed>.1), scenario+' runs continuously through retargets');
      assert.equal(continuous.at(-1).starts.length,1,scenario+' does not restart its native Run clip');
      for (let i=1;i<continuous.length;i++) {
        assert(Math.hypot(continuous[i].renderPosition.x-continuous[i-1].renderPosition.x,continuous[i].renderPosition.z-continuous[i-1].renderPosition.z)>1e-6,scenario+' display advances each frame');
        assert.notDeepEqual(continuous[i].pose,continuous[i-1].pose,scenario+' native pose advances each frame');
      }
    } else {
      assert(samples.some(s=>s.phase==='delivering'&&s.motion==='run'));
      assert.equal(samples.at(-1).stock,e.state.inventory.wood+8,'real haul credits the warehouse');
    }
    const report = { scenario, frames:samples.length, commands, idleFrames:continuous.filter(s=>s.motion==='idle').length,
      clipStarts:samples.at(-1).starts, errors, samples };
    await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));
    const video=spawnSync('ffmpeg',['-loglevel','error','-y','-framerate','60','-i',`${dir}/%04d.png`,
      '-frames:v',String(samples.length),'-c:v','libx264','-pix_fmt','yuv420p','-crf','20',`${out}/${scenario}.mp4`],{encoding:'utf8'});
    assert.equal(video.status,0,video.stderr);
    const {samples:_,...summary}=report; reports.push(summary);console.log(JSON.stringify(summary));
    await page.close();
  }
  await writeFile(`${out}/report.json`,JSON.stringify({method:'Consecutive real Babylon render frames at controlled 1/60 game seconds; full frame sequences and 60 fps videos, not a hardware FPS benchmark',reports},null,2));
} finally { await browser.close(); }
