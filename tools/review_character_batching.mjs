// Compare the first actor with a later actor sharing the first farmer's
// geometry cache. Uses real WebGL draws, including each native LOD switch.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = process.env.REVIEW_ORIGIN || 'http://127.0.0.1:5174';
const out = process.env.REVIEW_OUTPUT || '/workspace/artifacts/character-batching';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const errors = [], results = [];
try {
  for (const role of ['farmer', 'base', 'infantry', 'archer', 'cavalry']) {
    const pages = await Promise.all([browser.newPage({ viewport: { width: 360, height: 480 } }), browser.newPage({ viewport: { width: 360, height: 480 } })]);
    for (const [i, page] of pages.entries()) {
      page.on('pageerror', error => errors.push(error.message));
      const params = new URLSearchParams({ role, lighting: 'game', height: role === 'cavalry' ? '4.2' : '2.1', center: role === 'cavalry' ? '1.6' : '.89' });
      if (i) params.set('warmup', 'farmer');
      await page.goto(`${origin}/studies/review.html?${params}`);
      await page.waitForFunction(() => window.review, { timeout: 60000 });
      await page.evaluate(() => window.review.engine.stopRenderLoop());
      const incomplete = await page.evaluate(() => window.review.loaded.meshes.filter(mesh => !mesh.isDisposed() && mesh.getTotalIndices()
        && mesh.subMeshes.reduce((sum, sub) => sum + sub.indexCount, 0) !== mesh.getTotalIndices()).map(mesh => mesh.name));
      assert.deepEqual(incomplete, [], `${role}: all merged parts must reach the draw range`);
    }
    const clips = role === 'cavalry' ? ['RideIdle', 'RideRun'] : ['infantry', 'archer'].includes(role) ? ['CarryWalk', 'CarryRun']
      : role === 'farmer' ? ['Walk', 'Run', 'Hammer'] : ['Walk', 'Run'];
    let comparisons = 0, maximum = 0;
    for (const lod of [false, true, 'far']) for (const view of ['front', 'game']) for (const [i, clip] of clips.entries()) {
      const frames = await Promise.all(pages.map(page => page.evaluate(async ({ lod, view, clip, phase }) => {
        const review = window.review; review.mapLOD(lod); review.view(view); review.pose(clip, phase);
        return review.pixels();
      }, { lod, view, clip, phase: i ? .45 : .2 })));
      const [cold, cached] = frames.map(frame => Buffer.from(frame, 'base64'));
      assert.equal(cold.length, cached.length);
      let difference = 0;
      for (let i = 0; i < cold.length; i++) difference = Math.max(difference, Math.abs(cold[i] - cached[i]));
      maximum = Math.max(maximum, difference); comparisons++;
      assert.ok(difference <= 1, `${role}/${lod}/${view}/${clip}: cached geometry changed pixels by ${difference}`);
      if (lod === false && i === 0) await pages[1].screenshot({ path: `${out}/${role}-${view}.png` });
    }
    if (role === 'farmer') {
      await pages[1].evaluate(() => { window.review.mapLOD(false); window.review.view('side'); });
      await pages[1].screenshot({ path: `${out}/farmer-side.png` });
    }
    results.push({ role, comparisons, maxChannelDifference: maximum });
    console.log(JSON.stringify(results.at(-1)));
    await Promise.all(pages.map(page => page.close()));
  }
  assert.deepEqual(errors, []);
  await writeFile(`${out}/comparison.json`, JSON.stringify({ renderer: 'Chromium / SwiftShader', results, errors }, null, 2));
} finally { await browser.close(); }
