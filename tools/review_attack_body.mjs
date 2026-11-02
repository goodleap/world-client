// Run the stable review server first: node tools/review-server.mjs
// Capture native Babylon playback at its fixed 16 ms animation step.
import {chromium} from 'playwright';
import {mkdir,writeFile,mkdtemp,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const output=process.argv[2]||'docs/attack-body/rendered',rig=process.argv.includes('--rig'),roles=(process.env.ROLES||'infantry,archer,cavalry').split(',');await mkdir(output,{recursive:true});
const framesRoot=await mkdtemp('/tmp/attack-body-frames-'), playback=[];
const assetSHA256=createHash('sha256').update(await readFile(new URL('../studies/characters/characters.glb',import.meta.url))).digest('hex');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:420,height:480}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
for(const role of roles){
 const clip={infantry:'SwordSlash',archer:'BowShot',cavalry:'LanceThrust'}[role],phases=role==='archer'?[0,.22,.53,.73]:[0,.30,.475,.65];
 await page.goto(`http://127.0.0.1:5174/studies/review.html?role=${role}&clip=${clip}&floor${rig?'&proxy':''}${role==='cavalry'?'&center=1.35&centerZ=.35&height=3.4':'&center=1.0&height=2.5'}`);await page.waitForFunction(()=>window.review,null,{timeout:90000});
 await page.evaluate(()=>window.review.engine.stopRenderLoop());
 for(const view of (rig?['side']:['front','side','game','mobile'])){
  await page.setViewportSize(view==='mobile'?{width:150,height:180}:{width:420,height:480});
  for(const phase of phases){await page.evaluate(({view,clip,phase})=>{window.review.view(view);window.review.pose(clip,phase);},{view,clip,phase});await page.screenshot({path:`${output}/${role}-${view}-${phase}.png`});}
  if(view==='side'||view==='game'){
   await page.setViewportSize({width:320,height:360});
   await page.evaluate(({view,clip})=>{const r=window.review;r.view(view);r.scene.useConstantAnimationDeltaTime=true;r.scene.animationTimeScale=1;r.play(clip);const g=r.loaded.animationGroups.find(a=>a.name===clip);window.cycles=0;window.cycleToken=g.onAnimationGroupLoopObservable.add(()=>window.cycles++);}, {view,clip});
   const dir=`${framesRoot}/${role}-${view}`;await mkdir(dir,{recursive:true});
   for(let i=0;i<40;i++){const png=await page.evaluate(()=>{const r=window.review;r.scene.render();return r.engine.getRenderingCanvas().toDataURL('image/png').split(',')[1];});await writeFile(`${dir}/${String(i).padStart(3,'0')}.png`,Buffer.from(png,'base64'));}
   const loops=await page.evaluate(clip=>{const r=window.review,g=r.loaded.animationGroups.find(a=>a.name===clip);g.onAnimationGroupLoopObservable.remove(window.cycleToken);g.stop();return window.cycles;},clip);if(loops<2)throw Error('Insufficient native loops');
   const result=spawnSync('ffmpeg',['-v','error','-framerate','62.5','-i',`${dir}/%03d.png`,'-c:v','libx264','-crf','22','-pix_fmt','yuv420p','-y',`${output}/${role}-${view}.mp4`]);if(result.status)throw Error(result.stderr.toString());playback.push({role,view,frames:40,stepMs:16,nativeLoops:loops});console.log(role,view,'native loops',loops);
   const sheet=spawnSync('ffmpeg',['-v','error','-framerate','62.5','-i',`${dir}/%03d.png`,'-vf',"select='lt(n,20)',scale=160:180,tile=10x2",'-frames:v','1','-y',`${output}/${role}-${view}-sequence.png`]);if(sheet.status)throw Error(sheet.stderr.toString());
  }
 }
}
await writeFile(output+'/playback.json',JSON.stringify({assetSHA256,errors,playback},null,2)+'\n');await browser.close();if(errors.length)throw Error(errors.join('\n'));
