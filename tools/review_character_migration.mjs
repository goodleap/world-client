// Run against the cloud Vite dev server. Pixel comparisons use Babylon's
// framebuffer readback; screenshots are only saved at review checkpoints.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const out = process.env.REVIEW_OUTPUT || '/workspace/artifacts/character-sharing';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const requested = process.env.REVIEW_ROLES?.split(',');
const previous = requested ? JSON.parse(await readFile(`${out}/pixel-comparison.json`, 'utf8').catch(() => '{"results":[]}')).results : [];
const results = previous.filter(row => !requested?.includes(row.role)), errors = [];
const origin = process.env.REVIEW_ORIGIN || 'http://127.0.0.1:5174';
const phases = Number(process.env.REVIEW_PHASES || 4);
const files = { base: 'base-human/base-human', farmer: 'farmer/farmer',
  infantry: 'soldiers/infantry/infantry', archer: 'soldiers/archer/archer', cavalry: 'soldiers/cavalry/cavalry' };
try {
  for (const [role, file] of Object.entries(files)) {
    if (requested && !requested.includes(role)) continue;
    const pages = await Promise.all([browser.newPage({ viewport: { width: 360, height: 480 } }), browser.newPage({ viewport: { width: 360, height: 480 } })]);
    for (const page of pages) page.on('pageerror', error => errors.push(`${role}: ${error.message}`));
    const mounted = role === 'cavalry';
    const parameters = new URLSearchParams({ lighting: 'game', clip: mounted ? 'RideIdle' : 'Walk', height: mounted ? '4.2' : '2.1', center: mounted ? '1.6' : '.89' });
    await pages[0].goto(`${origin}/studies/review.html?${parameters}&asset=/studies/${file}.glb&lodAsset=/studies/lod/${role}-lod.glb`);
    await pages[1].goto(`${origin}/studies/review.html?${parameters}&role=${role}`);
    await Promise.all(pages.map(page => page.waitForFunction(() => window.review, { timeout: 60000 })));
    await Promise.all(pages.map(page => page.evaluate(() => window.review.engine.stopRenderLoop())));
    const clips = mounted ? ['RideIdle', 'RideWalk', 'RideRun'] : role === 'farmer' ? ['Walk', 'Run', 'Hammer'] : ['Walk', 'Run'];
    let worstDifference = 0, differentPixels = 0, comparisons = 0;
    for (const map of [false, true]) {
      await Promise.all(pages.map(page => page.evaluate(map => { window.review.mapLOD(map); window.review.view('game'); }, map)));
      for (const clip of clips) for (let phase = 0; phase < phases; phase++) {
        const encoded = await Promise.all(pages.map((page, index) => page.evaluate(async ({ clip, phase }) => {
          window.review.pose(clip, phase);
          return window.review.pixels();
        }, { clip: index && ['infantry', 'archer'].includes(role) ? 'Carry' + clip : clip, phase: phase / phases })));
        const frames = encoded.map(data => Buffer.from(data, 'base64'));
        let max = 0, count = 0;
        for (let pixel = 0; pixel < frames[0].length; pixel += 4) {
          let delta = 0;
          for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(frames[0][pixel + c] - frames[1][pixel + c]));
          max = Math.max(max, delta);
          if (delta > 1) count++;
        }
        worstDifference = Math.max(worstDifference, max); differentPixels += count; comparisons++;
      }
      console.log(`${role}: ${map ? 'map LOD' : 'full detail'} compared`);
    }
    await pages[1].evaluate(clip => { window.review.mapLOD(false); window.review.pose(clip, .25); window.review.view('game'); }, mounted ? 'RideRun' : role === 'farmer' ? 'Hammer' : ['infantry', 'archer'].includes(role) ? 'CarryRun' : 'Run');
    await pages[1].screenshot({ path: `${out}/${role}-game.png` });
    for (const view of ['front', 'side']) {
      await pages[1].evaluate(view => window.review.view(view), view);
      await pages[1].screenshot({ path: `${out}/${role}-${view}.png` });
    }
    const row = { role, comparisons, phasesPerClip: phases, maxChannelDifference: worstDifference, pixelsDifferentByMoreThanOne: differentPixels,
      renderedFramePixels: 360 * 480, geometry: await pages[1].evaluate(() => window.review.geometry()) };
    results.push(row);
    console.log(JSON.stringify({ ...row, geometry: undefined }));
    await writeFile(`${out}/pixel-comparison.json`, JSON.stringify({ renderer: 'Chromium / SwiftShader; not iPhone performance', results, errors }, null, 2));
    await Promise.all(pages.map(page => page.close()));
  }
  if (errors.length || results.some(row => row.maxChannelDifference > 1)) process.exitCode = 1;
} finally { await browser.close(); }
