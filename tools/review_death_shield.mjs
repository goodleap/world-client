import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../docs/death-shield/evidence/', import.meta.url));
await fs.mkdir(output, { recursive: true });
const role = process.argv[2] || 'cavalry', motion = process.argv[3];
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
page.on('pageerror', e => { throw e; });
const animal = ['dog', 'wolf'].includes(role);
const clip = animal ? 'Idle' : role === 'cavalry' ? 'RideIdle' : role === 'infantry' ? 'ShieldWalk' : 'Walk';
await page.goto(`http://127.0.0.1:5174/studies/review.html?${animal ? `asset=/studies/${role}/${role}.glb` : `role=${role}`}&clip=${clip}&floor&lighting=game&height=${role === 'cavalry' ? 4.5 : 3.4}&center=.6&centerZ=.5`);
await page.waitForFunction(() => window.review, {}, { timeout: 120000 });
await page.evaluate(() => window.review.engine.stopRenderLoop());
if (!motion) {
  if (role === 'infantry') {
    for (const view of ['front', 'side', 'game']) {
      await page.evaluate(view => { window.review.pose('ShieldWalk', 0); window.review.view(view); }, view);
      await page.screenshot({ path: `${output}shield-hold-${view}.png` });
    }
  }
  for (const age of [0, .2, .4, .6, 1.5, 4]) {
    await page.evaluate(age => { window.review.view('game'); window.review.death(age); }, age);
    await page.screenshot({ path: `${output}${role}-fall-${age}.png` });
  }
  // Resample the existing native group at the held pose for all review views.
  for (const view of ['front', 'side', 'game']) {
    await page.evaluate(view => { window.review.view(view); window.review.death(1); }, view);
    await page.screenshot({ path: `${output}${role}-prone-${view}.png` });
  }
  await page.setViewportSize({ width: 150, height: 170 });
  await page.evaluate(() => { window.review.view('mobile'); window.review.death(1); });
  await page.screenshot({ path: `${output}${role}-prone-mobile.png` });
  console.log(role, JSON.stringify(await page.evaluate(() => window.review.death(1))));
} else {
  await page.setViewportSize({ width: 400, height: 400 });
  const frames = motion === 'death' ? 180 : 120;
  await page.evaluate(({ motion, frames }) => {
    const { scene, engine } = window.review; window.review.view('game');
    scene.useConstantAnimationDeltaTime = true; scene.animationTimeScale = 1; scene.shadowsEnabled = false;
    if (motion !== 'death') {
      window.review.play(motion);
      const group = window.review.loaded.animationGroups.find(g => g.name === motion);
      group.speedRatio = motion === 'SwordSlash' ? (group.to - group.from) / 60 / (.8 / 3.5) : motion === 'ShieldRun' ? 2 : 1;
    }
    window.motionFrames = []; let count = 0;
    // Death is sampled directly from a game clock advancing 1/30 s per frame;
    // other motion runs through consecutive Babylon 16 ms animation frames.
    const after = scene.onAfterRenderObservable.add(() => {
      if (++count % 2 === 0) window.motionFrames.push(engine.getRenderingCanvas().toDataURL('image/png').split(',')[1]);
      if (count === frames) { engine.stopRenderLoop(); scene.onAfterRenderObservable.remove(after); }
    });
    engine.runRenderLoop(() => motion === 'death' ? window.review.death(count / 30) : scene.render());
  }, { motion, frames });
  await page.waitForFunction(n => window.motionFrames.length >= n / 2, frames, { timeout: 240000 });
  const data = await page.evaluate(() => window.motionFrames), dir = `/tmp/death-shield-${role}-${motion}`;
  await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < data.length; i++) await fs.writeFile(`${dir}/${String(i).padStart(3, '0')}.png`, Buffer.from(data[i], 'base64'));
  const encoded = spawnSync('ffmpeg', ['-v', 'error', '-framerate', motion === 'death' ? '15' : '31.25', '-i', `${dir}/%03d.png`, '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-y', `${output}${role}-${motion}.mp4`]);
  if (encoded.status) throw new Error(String(encoded.stderr));
  console.log(role, motion, `${frames} consecutive native render frames`);
}
await browser.close();
