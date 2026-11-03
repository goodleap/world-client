import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { initialEconomy } from '../src/game/economy.ts';
const out = '/workspace/artifacts/lod-scene'; await mkdir(out, { recursive: true });
const old = await readFile('/workspace/artifacts/lod-before/characters-far-lod.glb');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const results = [], errors = [];
try {
  for (const before of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 393, height: 754 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    const state = initialEconomy(1234); state.steward.enabled = false;
    await page.addInitScript(state => localStorage.setItem('world-basic-economy-v1', JSON.stringify(state)), state);
    if (before) await page.route('**/characters-far-lod.glb', route => route.fulfill({ body: old, contentType: 'model/gltf-binary' }));
    await page.route('**/src/game/game.ts', async route => {
      const response = await route.fetch(); let body = await response.text();
      assert.ok(body.includes('canSave = true;') && body.includes('simulationClock.advance(elapsed,'));
      body = body.replace('simulationClock.advance(elapsed,', 'simulationClock.advance(0,')
        .replace('canSave = true;', 'canSave = true; engine.stopRenderLoop(render); scene.animationsEnabled=false; window.__lodScene={scene,engine,camera,shadows,performanceDiagnostics,world,residents,selectionFeedback};');
      await route.fulfill({ response, body });
    });
    await page.goto('http://127.0.0.1:5174/'); await page.locator('#continue-save').click();
    await page.waitForFunction(() => window.__lodScene, null, { timeout: 90000 });
    for (const [name, zoom, x, z] of [['default',16.21,1.69,-2],['phone-log',16.21,-3.44,-12.88],['near',6,1.69,-2],['wide',32,1.69,-2]]) {
      const sample = await page.evaluate(({ before, zoom, x, z }) => {
        const r = window.__lodScene, { engine, scene, camera, shadows } = r;
        if (before) for (const m of scene.meshes) if (m.metadata?.buildingLODSource) for (const l of m.getLODLevels()) l.distanceOrScreenCoverage = 0;
        camera.target.set(x,.5,z); camera.orthoTop=zoom; camera.orthoBottom=-zoom; camera.orthoRight=zoom*engine.getRenderWidth()/engine.getRenderHeight(); camera.orthoLeft=-camera.orthoRight;
        for (let i=0;i<3;i++){engine.beginFrame();r.performanceDiagnostics.beforeFrame();scene.render();engine.endFrame();}
        r.performanceDiagnostics.record({fps:0,cpuMs:0},{meanMs:0,p95Ms:0},zoom,false,[]);
        const metrics = r.performanceDiagnostics.snapshot().latest;
        const selected = scene.meshes.filter(m=>m.metadata?.buildingLODSource).map(m=>({source:m.name,shown:m.getLOD(camera)?.name}));
        return {draws:metrics.drawCalls,triangles:metrics.submittedTriangles,mainDraws:metrics.mainDrawCalls,mainTriangles:metrics.mainTriangles,
          shadowDraws:metrics.shadowDrawCalls,shadowTriangles:metrics.shadowTriangles,buildingLOD:metrics.buildingLOD,active:scene.getActiveMeshes().length,selected};
      }, { before, zoom, x, z });
      await page.screenshot({ path: `${out}/${name}-${before?'before':'after'}.png`, scale:'css' });
      results.push({before,name,...sample}); console.log(JSON.stringify({before,name,draws:sample.draws,triangles:sample.triangles,mainTriangles:sample.mainTriangles,buildingLOD:sample.buildingLOD}));
    }
    await page.close();
  }
  // Shadow maps keep their separate wide LOD camera, even at the closest main view.
  const close=results.filter(r=>r.name==='near');assert.equal(close[0].mainTriangles,close[1].mainTriangles,'closest main view retains original geometry');
  assert.deepEqual(errors,[]);await writeFile(`${out}/comparison.json`,JSON.stringify({results,errors},null,2));
} finally { await browser.close(); }
