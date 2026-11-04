// Actual shared-asset review, including full motion loops and matching static phases.
// Run dev server on 5175, then node tools/review_combat.mjs [/tmp/combat-review].
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.argv[2] || '/tmp/combat-review'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const errors = [], records = [], cycles = [];
const roles = (process.argv[3] || 'infantry,archer').split(',');
for (const role of roles) {
  const context = await browser.newContext({ viewport: { width: 540, height: 600 }, recordVideo: { dir: output, size: { width: 540, height: 600 } } });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const clip = role === 'farmer' ? 'Hammer' : role === 'archer' ? 'BowShot' : role === 'cavalry' ? 'LanceThrust' : 'SwordSlash';
  await page.goto(`${process.env.REVIEW_BASE || 'http://127.0.0.1:5175'}/studies/review.html?role=${role}&clip=${clip}${role === 'cavalry' ? '&center=1.4&centerZ=.35&height=4.2' : '&center=1.05&height=2.6'}`);
  await page.waitForFunction(() => !!window.review, null, { timeout: 90_000 });
  for (const view of (process.env.REVIEW_VIEWS || 'front,side,game,mobile').split(',')) {
    await page.setViewportSize(view === 'mobile' ? { width: 320, height: 568 } : { width: 540, height: 600 });
    await page.evaluate(({ view, clip }) => {
      const review = window.review, group = review.loaded.animationGroups.find(g => g.name === clip);
      review.view(view); review.completedCycles = 0;
      review.loopObserver = group.onAnimationGroupLoopObservable.add(() => review.completedCycles++);
      review.play(clip);
    }, { view, clip });
    // Observe actual native loops: wall-clock waits cannot prove full playback
    // on a software GPU or while shaders compile.
    await page.waitForFunction(() => window.review.completedCycles >= 2, null, { timeout: 60_000 });
    cycles.push(await page.evaluate(({ role, view, clip }) => {
      const review = window.review, group = review.loaded.animationGroups.find(g => g.name === clip);
      group.onAnimationGroupLoopObservable.remove(review.loopObserver);
      return { role, view, completed: review.completedCycles };
    }, { role, view, clip }));
    for (const phase of [0, .28, .48, .58, .8, 1]) {
      await page.evaluate(({ clip, phase }) => window.review.pose(clip, phase), { clip, phase });
      const data = await page.evaluate(() => window.review.loaded.skeletons[0].bones.map(b => {
        const node = b.getTransformNode(); node.computeWorldMatrix(true); return { name: b.name, position: node.position.asArray(), rotation: node.rotationQuaternion.asArray() };
      }));
      records.push({ role, view, phase, bones: data });
      if ([.28, .48, .8].includes(phase)) await page.screenshot({ path: `${output}/${role}-${view}-${phase}.png` });
    }
  }
  const video = page.video(); await context.close(); await video.saveAs(`${output}/${role}-cycles.webm`);
}
await browser.close(); await writeFile(`${output}/poses.json`, JSON.stringify(records));
await writeFile(`${output}/cycles.json`, JSON.stringify(cycles, null, 2));
if (errors.length) throw new Error(errors.join('\n'));
console.log(`${records.length} rig samples, two full cycles per view, screenshots and videos: ${output}`);
