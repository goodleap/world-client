// Actual Babylon shared-asset frames. Videos use deterministic phase sampling
// at the configured game speed; they are motion evidence, not device FPS.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import motion from '../studies/characters/locomotion.json' with { type: 'json' };
const out = process.env.REVIEW_OUTPUT || '/tmp/locomotion-review';
const roles = (process.env.REVIEW_ROLES || 'base,farmer,infantry,archer,cavalry').split(',');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const errors = [], records = [];
try {
  await mkdir(out, { recursive: true });
  for (const role of roles) {
    const page = await browser.newPage({ viewport: { width: 360, height: 440 } });
    page.on('pageerror', e => errors.push(e.message));
    const mounted = role === 'cavalry', clip = mounted ? 'RideRun' : ['infantry', 'archer'].includes(role) ? 'CarryRun' : 'Run';
    const duration = mounted ? motion.horse.duration : motion.human.duration;
    const speed = mounted ? 6.96 : role === 'infantry' ? 4.6 : role === 'archer' ? 4.8 : 5;
    const rate = speed / (mounted ? motion.horse.referenceSpeed : motion.human.referenceSpeed);
    await page.goto(`${process.env.REVIEW_ORIGIN || 'http://127.0.0.1:4174'}/studies/review.html?role=${role}&lighting=game&clip=${clip}&height=${mounted ? 3.1 : 2.2}&center=${mounted ? 1.15 : .93}`);
    await page.waitForFunction(() => window.review, null, { timeout: 120000 });
    // First exercise native continuous playback, including the loop seam.
    await page.evaluate(({ clip, rate }) => {
      const r = window.review, group = r.loaded.animationGroups.find(g => g.name === clip);
      r.loops = 0; group.onAnimationGroupLoopObservable.add(() => r.loops++);
      r.view('side'); r.play(clip); group.speedRatio = rate;
    }, { clip, rate });
    await page.waitForFunction(() => window.review.loops >= 3, null, { timeout: 90000 });
    records.push(await page.evaluate(({ role, clip, rate }) => {
      const r = window.review; r.engine.stopRenderLoop();
      return { role, clip, rate, loops: r.loops, animations: r.summary.animations };
    }, { role, clip, rate }));
    const panels = [];
    for (const view of (process.env.REVIEW_VIEWS || 'side,game,mobile').split(',')) {
      await page.evaluate(view => { window.review.view(view); window.review.mapLOD(view === 'mobile' ? 'far' : false); }, view);
      const folder = `${out}/${role}-${view}`; await mkdir(folder, { recursive: true });
      const count = 24;
      for (let i = 0; i < count; i++) {
        const png = await page.evaluate(({ clip, phase }) => {
          const r = window.review; r.pose(clip, phase);
          return document.querySelector('canvas').toDataURL('image/png').split(',')[1];
        }, { clip, phase: i / count });
        await writeFile(`${folder}/${String(i).padStart(3, '0')}.png`, Buffer.from(png, 'base64'));
        if (i % 4 === 0) panels.push({ view, phase: i / count, src: `data:image/png;base64,${png}` });
      }
      const video = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(count * rate / duration), '-i', `${folder}/%03d.png`, '-vf', 'fps=60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${folder}/cycle.mp4`], { encoding: 'utf8' });
      if (video.status !== 0) throw new Error(video.stderr);
    }
    await page.close();
    const sheet = await browser.newPage({ viewport: { width: 1440, height: Math.ceil(panels.length / 6) * 312 } });
    await sheet.setContent(`<body style="margin:0;background:#f5f1e8;font:14px sans-serif"><div style="display:grid;grid-template-columns:repeat(6,240px)">${panels.map(p => `<div><div style="height:18px;text-align:center">${role} ${p.view} ${p.phase.toFixed(2)}</div><img width="240" height="293" src="${p.src}"></div>`).join('')}</div></body>`);
    await sheet.screenshot({ path: `${out}/${role}-phases.png`, timeout: 90000 }); await sheet.close();
    await writeFile(`${out}/playback.json`, JSON.stringify({ errors, records }, null, 2));
    console.log(JSON.stringify(records.at(-1)));
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
