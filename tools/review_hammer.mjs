// Native Babylon review, including continuous 2x playback as used by workers.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../docs/hammer-unit-card/evidence/', import.meta.url));
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true, args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport:{width:600,height:600} });
page.on('pageerror', e => { throw e; });
async function captureMotion(view, name = view) {
  await page.setViewportSize({width:400,height:400});
  await page.evaluate(view=>{
    const {scene,engine,loaded}=window.review;engine.stopRenderLoop();window.review.view(view);
    scene.useConstantAnimationDeltaTime=true;scene.animationTimeScale=1;window.review.play('Hammer');
    loaded.animationGroups.find(g=>g.name==='Hammer').speedRatio=2;
    window.motionFrames=[];let count=0;
    const token=scene.onAfterRenderObservable.add(()=>{
      if(++count%2===0)window.motionFrames.push(engine.getRenderingCanvas().toDataURL('image/png').split(',')[1]);
      if(count===120){engine.stopRenderLoop();scene.onAfterRenderObservable.remove(token);}
    });engine.runRenderLoop(()=>scene.render());
  },view);
  await page.waitForFunction(()=>window.motionFrames.length===60,{},{timeout:240000});
  const frames=await page.evaluate(()=>window.motionFrames);
  const dir='/tmp/hammer-'+name;await fs.mkdir(dir,{recursive:true});
  for(let i=0;i<frames.length;i++)await fs.writeFile(`${dir}/${String(i).padStart(3,'0')}.png`,Buffer.from(frames[i],'base64'));
  const encoded=spawnSync('ffmpeg',['-v','error','-framerate','31.25','-i',`${dir}/%03d.png`,'-c:v','libx264','-crf','23','-pix_fmt','yuv420p','-y',output+`hammer-${name}-motion.mp4`],{stdio:'inherit'});
  if(encoded.status!==0)throw new Error('Video encoding failed');
  console.log(name+': 120 consecutive native animation/render frames at 16 ms, 2x work speed');
}

const base = 'http://127.0.0.1:5174/studies/review.html?role=farmer&clip=Hammer&floor&height=2.2&center=.96';
const singleView=process.argv[2];
if(singleView) {
  if(!['side','game'].includes(singleView))throw new Error('Expected side or game');
  await page.goto(base+'&lighting=game'); await page.waitForFunction(()=>window.review);
  await captureMotion(singleView);
} else {
await page.goto(base+'&proxy'); await page.waitForFunction(()=>window.review);
await page.evaluate(()=>{ window.review.view('side'); window.review.pose('Hammer',.55); });
await page.screenshot({path:output+'hammer-rig.png'});
await captureMotion('side','rig');
await page.setViewportSize({width:600,height:600});
await page.goto(base+'&lighting=game'); await page.waitForFunction(()=>window.review);
console.log(JSON.stringify(await page.evaluate(()=>window.review.summary.animations)));
for (const view of ['front','side','game']) {
  for (const phase of [0,.4,.55,.7,.78,.84]) {
    await page.evaluate(({view,phase})=>{window.review.view(view);window.review.pose('Hammer',phase)}, {view,phase});
    await page.screenshot({path:`${output}hammer-${view}-${phase}.png`});
  }
}
await page.setViewportSize({width:120,height:150});
for(const phase of [0,.55]) {
  await page.evaluate(phase=>{window.review.view('mobile');window.review.pose('Hammer',phase)},phase);
  await page.screenshot({path:output+`hammer-mobile-${phase}.png`});
}
for(const view of ['side','game']) await captureMotion(view);
}
await browser.close();
