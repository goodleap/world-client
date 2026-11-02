import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../docs/dog/evidence/', import.meta.url));
await fs.mkdir(output, { recursive: true });
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:700,height:700}});page.on('pageerror',e=>console.error(e));
const base='http://127.0.0.1:5174/studies/review.html?asset=/studies/dog/dog.glb&clip=Idle&floor&height=2.05&center=.73';
await page.goto(base+'&proxy');await page.waitForFunction(()=>window.review);await page.evaluate(()=>window.review.view('side'));
await page.evaluate(()=>{window.review.play('Run');window.loops=0;window.review.loaded.animationGroups.find(g=>g.name==='Run').onAnimationGroupLoopObservable.add(()=>window.loops++);});
await page.waitForFunction(()=>window.loops>=3);await page.screenshot({path:output+'rig-run.png'});
await page.goto(base);await page.waitForFunction(()=>window.review);
console.log(JSON.stringify(await page.evaluate(()=>window.review.summary)));
for(const v of ['front','side','back','game']){await page.evaluate(v=>{window.review.pose('Idle',0);window.review.view(v)},v);await page.screenshot({path:`${output}dog-${v}.png`});}
for(const clip of ['Walk','Run','Feed']){await page.evaluate(clip=>{window.review.view('side');window.review.play(clip);window.loops=0;window.review.loaded.animationGroups.find(g=>g.name===clip).onAnimationGroupLoopObservable.add(()=>window.loops++);},clip);await page.waitForFunction(()=>window.loops>=3);
for(let i=0;i<8;i++){await page.evaluate(({clip,i})=>window.review.pose(clip,i/8),{clip,i});await page.screenshot({path:`${output}${clip}-${i}.png`});}}
await page.setViewportSize({width:120,height:150});await page.evaluate(()=>{window.review.pose('Run',.25);window.review.view('mobile')});await page.screenshot({path:output+'dog-mobile.png'});

await page.setViewportSize({width:400,height:400});
for(const clip of ['Walk','Run','Feed']) {
  await page.evaluate(clip=>{
    const {scene,engine}=window.review;engine.stopRenderLoop();window.review.view('side');
    scene.useConstantAnimationDeltaTime=true;scene.animationTimeScale=1;window.review.play(clip);
    window.motionFrames=[];let count=0;
    const token=scene.onAfterRenderObservable.add(()=>{
      if(++count%2===0)window.motionFrames.push(engine.getRenderingCanvas().toDataURL('image/png').split(',')[1]);
      if(count===120){engine.stopRenderLoop();scene.onAfterRenderObservable.remove(token);}
    });engine.runRenderLoop(()=>scene.render());
  },clip);
  await page.waitForFunction(()=>window.motionFrames.length===60,{},{timeout:120000});
  const frames=await page.evaluate(()=>window.motionFrames);
  await fs.mkdir('/tmp/dog-'+clip,{recursive:true});
  for(let i=0;i<frames.length;i++)await fs.writeFile(`/tmp/dog-${clip}/${String(i).padStart(3,'0')}.png`,Buffer.from(frames[i],'base64'));
  const video=spawnSync('ffmpeg',['-v','error','-framerate','31.25','-i',`/tmp/dog-${clip}/%03d.png`,'-c:v','libx264','-crf','23','-pix_fmt','yuv420p','-y',output+clip+'-motion.mp4'],{stdio:'inherit'});
  if(video.status!==0)throw new Error('Video encoding failed');
  console.log(clip+': 120 consecutive native animation/render frames, 16 ms per frame');
}
for(const level of [0,1,2]) {
 await page.goto(base+'&lighting=game&dogLOD='+level);await page.waitForFunction(()=>window.review);
 await page.evaluate(()=>{window.review.pose('Run',.3);window.review.view('game')});
 await page.screenshot({path:output+'game-light-lod-'+level+'.png'});
}
await browser.close();
