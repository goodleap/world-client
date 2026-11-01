// Run two immutable revisions serially in one software GPU. Timings are not
// phone benchmarks; compare pixels and submitted geometry/draws instead.
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const origins = [process.env.BASELINE_ORIGIN || 'http://127.0.0.1:4175', process.env.CANDIDATE_ORIGIN || 'http://127.0.0.1:4174'];
const out = process.env.REVIEW_OUTPUT || '/workspace/artifacts/render-optimization';
const roles = (process.env.REVIEW_ROLES || 'farmer,infantry,archer,cavalry').split(',');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const results = [], errors = [];
try {
  for (const [version, origin] of origins.entries()) for (const role of roles) {
    if (version === 0 && process.env.REVIEW_CANDIDATE_ONLY === '1') continue;
    const page = await browser.newPage({ viewport: { width: 360, height: 480 } });
    page.on('pageerror', error => errors.push({ version, role, message: error.message }));
    const params = new URLSearchParams({ role, lighting: 'game', height: role === 'cavalry' ? '4.2' : '2.1', center: role === 'cavalry' ? '1.6' : '.89' });
    await page.goto(`${origin}/studies/review.html?${params}`);
    await page.waitForFunction(() => window.review, null, { timeout: 120000 });
    await page.evaluate(() => window.review.engine.stopRenderLoop());
    const clips = role === 'cavalry' ? ['RideRun', 'LanceThrust'] : role === 'archer' ? ['CarryRun', 'BowShot'] : role === 'infantry' ? ['CarryRun', 'SwordSlash'] : ['Walk', 'Hammer'];
    for (const lod of [false, true, 'far']) for (const view of ['front', 'side', 'game']) for (const clip of clips) {
      const key = `${role}-${lod}-${view}-${clip}`;
      const sample = await page.evaluate(async ({ lod, view, clip }) => {
        const r = window.review; r.mapLOD(lod); r.view(view); r.pose(clip, .42);
        const pixels = await r.pixels();
        return { pixels, geometry: r.geometry(), draws: r.engine._drawCalls.current };
      }, { lod, view, clip });
      const bytes = Buffer.from(sample.pixels, 'base64'); delete sample.pixels;
      if (!version) await writeFile(`${out}/${key}.rgba`, bytes);
      else {
        const base = await readFile(`${out}/${key}.rgba`);
        if (base.length !== bytes.length) throw new Error('Different framebuffer dimensions');
        let max = 0, total = 0, changed = 0;
        for (let i = 0; i < bytes.length; i++) { const d = Math.abs(bytes[i] - base[i]); max = Math.max(max, d); total += d; if (d > 1) changed++; }
        sample.difference = { max, mean: total / bytes.length, channelsOverOne: changed };
      }
      results.push({ version, key, ...sample });
      if (clip === clips.at(-1) && (lod === false || view === 'game')) await page.screenshot({ path: `${out}/${version}-${key}.png` });
    }
    console.log(JSON.stringify({ version, role, errors: errors.filter(e => e.role === role), meshes: results.at(-1).geometry.length, maxDifference: Math.max(...results.filter(r => r.version === version && r.key.startsWith(role)).map(r => r.difference?.max ?? 0)) }));
    await page.close();
  }
  await writeFile(`${out}/comparison.json`, JSON.stringify({ renderer: 'Chromium / SwiftShader; not phone timing', errors, results }, null, 2));
  if (errors.length) throw new Error(JSON.stringify(errors));
} finally { await browser.close(); }
