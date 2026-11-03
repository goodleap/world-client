import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = process.env.REVIEW_OUTPUT || '/workspace/artifacts/lod-optimization';
await mkdir(out, { recursive: true });
const old = await readFile('/workspace/artifacts/lod-before/characters-far-lod.glb');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const errors = [], results = [];
try {
  for (const role of ['farmer', 'infantry', 'archer', 'cavalry']) {
    const pages = await Promise.all([browser.newPage({ viewport: { width: 320, height: 420 } }), browser.newPage({ viewport: { width: 320, height: 420 } })]);
    await pages[0].route('**/characters-far-lod.glb', route => route.fulfill({ body: old, contentType: 'model/gltf-binary' }));
    for (const page of pages) {
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:5174/studies/review.html?role=${role}&lighting=game&height=${role === 'cavalry' ? 4.2 : 2.1}&center=${role === 'cavalry' ? 1.6 : .89}`);
      await page.waitForFunction(() => window.review, null, { timeout: 90000 });
      await page.evaluate(() => { const r = window.review; r.engine.stopRenderLoop(); r.mapLOD('far'); });
    }
    const clips = role === 'farmer' ? ['Run', 'Hammer'] : role === 'infantry' ? ['ShieldRun', 'SwordSlash'] : role === 'archer' ? ['CarryRun', 'BowShot'] : ['RideRun', 'LanceThrust'];
    const comparisons = [];
    for (const view of ['front', 'side', 'game', 'phone']) for (const clip of clips) for (const phase of [0, .3, .6, .85]) {
      const frames = [];
      for (const page of pages) frames.push(await page.evaluate(async ({ view, clip, phase }) => {
        const r = window.review; r.view(view === 'phone' ? 'game' : view);
        if (view === 'phone') {
          const c = r.scene.activeCamera, ratio = r.engine.getAspectRatio(c), height = 20;
          c.orthoTop = height / 2; c.orthoBottom = -height / 2; c.orthoRight = height * ratio / 2; c.orthoLeft = -c.orthoRight;
        }
        r.pose(clip, phase); return r.pixels();
      }, { view, clip, phase }));
      const [a, b] = frames.map(v => Buffer.from(v, 'base64')); let total = 0, changed = 0;
      for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]); total += d; if (d > 60) changed++; }
      comparisons.push({ view, clip, phase, meanChannelDifference: total / (a.length / 4 * 3), changedPixels: changed });
      if (phase === .6 && clip === clips[1]) for (const [i, page] of pages.entries()) await page.screenshot({ path: `${out}/${role}-${view}-${i ? 'after' : 'before'}.png` });
      assert.ok(total / (a.length / 4 * 3) < 4, `${role}/${view}/${clip}: large visual change`);
    }
    // Actual native animation advances through complete cycles, not isolated poses.
    for (const clip of clips) {
      const page = pages[1];
      await page.evaluate(clip => { const r = window.review, g = r.loaded.animationGroups.find(g => g.name === clip); r.cycles = 0; r.observer = g.onAnimationGroupLoopObservable.add(() => r.cycles++); r.play(clip); r.engine.runRenderLoop(() => r.scene.render()); }, clip);
      await page.waitForFunction(() => window.review.cycles >= 2, null, { timeout: 60000 });
      await page.evaluate(clip => { const r = window.review; r.engine.stopRenderLoop(); r.loaded.animationGroups.find(g => g.name === clip).onAnimationGroupLoopObservable.remove(r.observer); }, clip);
    }
    results.push({ role, comparisons }); console.log(JSON.stringify({ role, comparisons: comparisons.length, maxMeanDifference: Math.max(...comparisons.map(c => c.meanChannelDifference)), nativeCycles: 4 }));
    await Promise.all(pages.map(p => p.close()));
  }
  const buildings = [];
  for (const id of ['cottage', 'warehouse', 'home-center']) {
    const page = await browser.newPage({ viewport: { width: 393, height: 600 } }); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:5174/studies/building-lod.html?id=${id}`); await page.waitForFunction(() => window.buildingReview, null, { timeout: 60000 });
    for (const view of ['front', 'side', 'game', 'phone']) for (const detail of ['near', 'map', 'far']) {
      const summary = await page.evaluate(({ view, detail }) => { const r = window.buildingReview; r.view(view, view === 'phone' ? 26 : view === 'game' ? 14 : 8); r.detail(detail); r.scene.render(); return r.summary(); }, { view, detail });
      buildings.push({ id, view, detail, ...summary });
      await page.screenshot({ path: `${out}/${id}-${view}-${detail}.png` });
    }
    await page.close(); console.log(JSON.stringify({ id, levels: buildings.filter(b => b.id === id && b.view === 'phone') }));
  }
  assert.deepEqual(errors, []); await writeFile(`${out}/report.json`, JSON.stringify({ results, buildings, errors }, null, 2));
} finally { await browser.close(); }
