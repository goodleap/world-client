import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initialEconomy } from '../src/game/economy.ts';
const out = '/workspace/artifacts/render-motion'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } }), errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  const state = initialEconomy(1234); state.steward.enabled = false;
  await page.addInitScript(state => { localStorage.setItem('world-basic-economy-v1', JSON.stringify(state)); localStorage.setItem('world-shadows-enabled', 'false'); }, state);
  await page.route('**/src/game/game.ts', async route => {
    const response = await route.fetch(); let body = await response.text(); assert.ok(body.includes('canSave = true;'));
    body = body.replace('canSave = true;', 'canSave = true; engine.stopRenderLoop(render); scene.useConstantAnimationDeltaTime=true; engine.getDeltaTime=()=>1000/60; window.__motionReview={scene,engine,render,combat,residents,simulationClock,ui};');
    await route.fulfill({ response, body });
  });
  await page.goto('http://127.0.0.1:5174/'); await page.locator('#continue-save').click();
  await page.waitForFunction(() => window.__motionReview, null, { timeout: 90000 });
  const accepted = await page.evaluate(() => {
    const r = window.__motionReview; r.residents.select('cavalry');
    return [r.combat.move(['cavalry'], { x: -16, z: -15 }), r.residents.command({ x: -8, z: -15 }, 'farmer'), r.residents.command({ x: -12, z: -19 }, 'dog')];
  });
  assert.ok(accepted.every(Boolean));
  const samples = [];
  for (let frame = 0; frame < 90; frame++) {
    const sample = await page.evaluate(() => {
      const r = window.__motionReview; r.engine.stopRenderLoop(); r.engine.beginFrame(); r.render(); r.engine.endFrame(); r.engine.stopRenderLoop();
      return { alpha: r.simulationClock.alpha, units: r.residents.snapshot().filter(a => ['cavalry','farmer','dog'].includes(a.id)).map(a => ({id:a.id,position:a.position,renderPosition:a.renderPosition,speed:a.movementSpeed,pose:a.modelPose??a.pose})),
        clips: r.scene.animationGroups.filter(g=>g.isPlaying).map(g=>({name:g.name,frame:g.animatables[0]?.masterFrame})) };
    });
    samples.push(sample);
    if ([15, 30, 45, 60, 75].includes(frame)) await page.screenshot({ path: `${out}/motion-${frame}.png`, scale:'css' });
  }
  const summary = ['cavalry','farmer','dog'].map(id => {
    let movingFrames=0, logicChanges=0, renderChanges=0, poseChanges=0;
    for (let i=8;i<samples.length;i++) {
      const a=samples[i-1].units.find(a=>a.id===id),b=samples[i].units.find(a=>a.id===id);
      if(a.speed<.08||b.speed<.08)continue; movingFrames++;
      if(Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z)>1e-7)logicChanges++;
      if(Math.hypot(a.renderPosition.x-b.renderPosition.x,a.renderPosition.z-b.renderPosition.z)>1e-7)renderChanges++;
      if(JSON.stringify(a.pose)!==JSON.stringify(b.pose))poseChanges++;
    }
    assert.ok(movingFrames>30,id+' moved long enough');
    assert.ok(renderChanges>=movingFrames*.95,id+' advances between fixed steps');
    if(id!=='dog')assert.ok(poseChanges>=movingFrames*.9,id+' native bones advance between fixed steps');
    assert.ok(renderChanges>logicChanges*2,id+' renders more often than simulation');
    return {id,movingFrames,logicChanges,renderChanges,poseChanges};
  });
  assert.deepEqual(errors,[]); await writeFile(`${out}/report.json`,JSON.stringify({method:'Real Babylon frames with controlled 1/60 logic input and native constant animation delta; not a hardware FPS benchmark',summary,samples,errors},null,2));
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
