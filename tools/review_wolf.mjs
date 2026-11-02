import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const output = process.env.REVIEW_OUTPUT || '/tmp/wolf-review';
const motion = process.env.REVIEW_MOTION;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 640 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4175/studies/review.html?asset=/studies/wolf/wolf.glb&clip=Idle&height=2.45&center=.73&centerZ=-.15&floor=1&wolfLOD=' + (process.env.REVIEW_LOD || '0') + (motion === 'proxy' ? '&proxy=1' : ''));
  await page.waitForFunction(() => window.review, null, { timeout: 120000 });
  await page.evaluate(() => window.review.engine.stopRenderLoop());
  if (motion) {
    const panels = [];
    for (const clip of process.env.REVIEW_CLIPS?.split(',') ?? (motion === 'proxy' ? ['Run', 'Bite'] : ['Run', 'Bite', 'Feed', 'Hurt'])) {
      await page.setViewportSize({ width: 480, height: 420 });
      await page.evaluate(clip => {
        const r = window.review; r.view('side'); r.loops = 0;
        const g = r.loaded.animationGroups.find(g => g.name === clip);
        g.onAnimationGroupLoopObservable.add(() => r.loops++);
        r.play(clip); r.engine.runRenderLoop(() => r.scene.render());
      }, clip);
      await page.waitForFunction(() => window.review.loops >= 3, null, { timeout: 60000 });
      await page.evaluate(() => window.review.engine.stopRenderLoop());
      for (const view of ['side', 'game']) {
        await page.evaluate(view => window.review.view(view), view);
        const folder = `${output}/${clip}-${view}`; await mkdir(folder, { recursive: true });
        for (let i = 0; i < 24; i++) {
          const data = await page.evaluate(({clip,phase}) => { window.review.pose(clip, phase); return document.querySelector('canvas').toDataURL('image/png').split(',')[1]; }, {clip,phase:i/24});
          await writeFile(`${folder}/${String(i).padStart(3,'0')}.png`, Buffer.from(data, 'base64'));
          if (i % 4 === 0) panels.push({ clip, view, phase:i/24, data });
        }
        const duration = await page.evaluate(clip => { const g=window.review.loaded.animationGroups.find(g=>g.name===clip); return (g.to-g.from)/g.targetedAnimations[0].animation.framePerSecond; },clip);
        const result = spawnSync('ffmpeg',['-y','-loglevel','error','-framerate',String(24/duration),'-i',`${folder}/%03d.png`,'-vf','fps=60','-c:v','libx264','-pix_fmt','yuv420p',`${folder}/cycle.mp4`],{encoding:'utf8'});
        if(result.status) throw new Error(result.stderr);
      }
    }
    const sheet = await browser.newPage({ viewport: { width: 1440, height: Math.ceil(panels.length/6)*230 } });
    await sheet.setContent(`<body style="margin:0;background:#f3efe5;font:12px sans-serif"><div style="display:grid;grid-template-columns:repeat(6,240px)">${panels.map(p=>`<div><div style="height:20px;text-align:center">${p.clip} ${p.view} ${p.phase.toFixed(2)}</div><img width="240" height="210" src="data:image/png;base64,${p.data}"></div>`).join('')}</div></body>`);
    await sheet.screenshot({ path:`${output}/phases.png` }); await sheet.close();
  }
  await page.evaluate(() => window.review.pose('Idle',0));
  for (const view of ['front', 'side', 'back', 'game', 'mobile']) {
    if (view === 'mobile') await page.setViewportSize({ width: 320, height: 400 });
    await page.evaluate(view => window.review.view(view), view);
    await page.screenshot({ path: `${output}/${view}.png` });
  }
  await writeFile(`${output}/summary.json`, JSON.stringify(await page.evaluate(() => window.review.summary), null, 2));
  console.log(JSON.stringify({ errors, output }));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
