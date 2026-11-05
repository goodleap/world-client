import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Economy,encodeEconomy,decodeEconomy } from '../src/game/economy.ts';
import { LANDSCAPE } from '../src/game/world-data.ts';
import { ENEMIES } from '../src/game/resident-data.ts';
import { surfaceHeight,terrainHeight } from '../src/game/terrain-height.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { ROAD_PATHS } from '../src/game/road-layout.ts';
import { MAP_DEVELOPMENT } from '../src/game/opening-profile.ts';
import { isBlocked, sweepIsBlocked } from '../src/game/movement.ts';

// Real game/GLB frames at 1/60 game second. The local response instrument below
// is never compiled into production and does not change movement/animation code.
const url=process.env.MAP_REVIEW_URL||'http://127.0.0.1:5176/';
const out=process.env.MAP_REVIEW_OUTPUT||'/tmp/map-redesign-motion';await mkdir(out,{recursive:true});
const bridge=LANDSCAPE.bridges[1],c=Math.cos(bridge.angle),s=Math.sin(bridge.angle);
const along=n=>({x:bridge.x+c*n,z:bridge.z-s*n});
const solids=economyObstacles([]),candidates=[];
const approach=ROAD_PATHS[3];
for(let i=0;i<approach.length;i++)for(let j=i+1;j<approach.length;j++){
 const a=approach[i],b=approach[j],distance=Math.hypot(a.x-b.x,a.z-b.z),rise=surfaceHeight(a.x,a.z)-surfaceHeight(b.x,b.z);
 if(distance>6&&distance<9&&rise>1&&!isBlocked(a,.35,solids)&&!isBlocked(b,.35,solids)&&!sweepIsBlocked(a,b,.35,solids))candidates.push({start:{x:b.x,z:b.z},goal:{x:a.x,z:a.z},rise});
}
assert(candidates.length,'a traversable terrace approach exists');
const slope=candidates.sort((a,b)=>b.rise-a.rise)[0];
const scenarios=[{name:'farmer-slope',id:'farmer',start:slope.start,goal:slope.goal,view:{x:(slope.start.x+slope.goal.x)/2,z:(slope.start.z+slope.goal.z)/2},frames:180,kind:'slope'},
 {name:MAP_DEVELOPMENT?'farmer-bridge':'cavalry-bridge',id:MAP_DEVELOPMENT?'farmer':'cavalry',start:along(-bridge.length/2-1),goal:along(bridge.length/2+1),view:bridge,frames:180,kind:'bridge'}];
const chosen=process.argv.slice(2),reports=[];
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
try{for(const test of scenarios.filter(t=>!chosen.length||chosen.includes(t.name))){
 const e=new Economy();e.setLeadership(false);e.state.seconds=10;e.state.raids.nextAt=1000;
 for(const u of e.state.combat.units)if(u.team==='enemy'){u.life='defeated';u.hp=0;u.diedAt=0;}
 for(const camp of e.state.combat.camps){camp.cleared=camp.rewardGranted=e.state.combat.units.filter(u=>ENEMIES.find(r=>r.id===u.id)?.camp===camp.id).every(u=>u.life==='defeated');camp.discovered=true;}
 e.state.combat.cleared=e.state.combat.rewardGranted=e.state.combat.discovered=true;
 for(const w of e.state.raids.wildWolves){w.life='defeated';w.hp=0;w.diedAt=0;w.settled=true;}
 for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
 if(test.id==='farmer')e.state.residents.farmer={position:test.start};else e.state.combat.units.find(u=>u.id===test.id).position=test.start;
 const save=encodeEconomy(e);decodeEconomy(save);
 const page=await browser.newPage({viewport:{width:720,height:540}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.routeWebSocket(new URL(url).origin.replace(/^http/,'ws')+'/**',socket=>socket.close());
 await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},save);
 await page.route('**/src/game/game.ts*',async route=>{
  const response=await route.fetch(),source=await response.text();assert(source.includes('canSave = true;'));
  await route.fulfill({response,body:source.replace('canSave = true;',`canSave = true;
    engine.stopRenderLoop(render);scene.useConstantAnimationDeltaTime=true;engine.getDeltaTime=()=>1000/60;
    window.__mapReview={scene,engine,residents,combat,economy,controller,
      frame(){engine.beginFrame();render();engine.endFrame();engine.stopRenderLoop();},
      view(x,z,size){zoom=currentZoom=size;mapCenter.set(x,.5,z);camera.target.copyFrom(mapCenter);}};`)});
 });
 await page.goto(url);await page.locator('#continue-save').click();await page.waitForFunction(()=>window.__mapReview,null,{timeout:120000});
 const accepted=await page.evaluate(test=>{
  const r=window.__mapReview;r.residents.select(test.id);r.view(test.view.x,test.view.z,7);
  const root=r.scene.getTransformNodeByName(`${test.id==='cavalry'?test.id+'-animal':test.id}-render-motion`),nodes=new Set(root.getDescendants());
  r.clips=r.scene.animationGroups.filter(g=>g.targetedAnimations.some(a=>nodes.has(a.target)));r.starts=[];
  for(const clip of r.clips)clip.onAnimationGroupPlayObservable.add(()=>r.starts.push(clip.name));
  return test.id==='farmer'?r.residents.command(test.goal,test.id):!!r.combat.move([test.id],test.goal);
 },test);assert(accepted,test.name+' command accepted');
 const dir=`${out}/${test.name}`;await mkdir(dir,{recursive:true});const samples=[];
 for(let frame=0;frame<test.frames;frame++){
  const sample=await page.evaluate(id=>{const r=window.__mapReview;r.frame();const u=r.residents.snapshot().find(u=>u.id===id),p=r.residents.displayPosition(id);return {position:u.position,display:{x:p.x,y:p.y,z:p.z},motion:u.motion,speed:u.movementSpeed,pose:u.modelPose,starts:r.starts.slice()};},test.id);
  samples.push(sample);if(frame%6===0)await page.screenshot({path:`${dir}/${String(frame/6).padStart(4,'0')}.png`,scale:'css'});
 }
 await writeFile(`${dir}/samples.json`,JSON.stringify(samples));
 assert.deepEqual(errors,[]);const solids=economyObstacles([]),moving=samples.slice(6).filter(p=>p.speed>.08);
 assert(moving.length>55,'sustained actual movement');assert(moving.every(p=>p.motion==='run'));
 for(const p of moving){assert.equal(isBlocked(p.position,test.id==='cavalry'?.6:.35,solids),false);assert(Math.abs(p.display.y-surfaceHeight(p.display.x,p.display.z))<.04,'feet follow terrain/deck');}
 for(let i=1;i<moving.length;i++){assert(Math.hypot(moving[i].display.x-moving[i-1].display.x,moving[i].display.z-moving[i-1].display.z)>1e-6);assert.notDeepEqual(moving[i].pose,moving[i-1].pose);}
 const runStarts=moving.at(-1).starts.filter(name=>/run|gallop/i.test(name)).length;
 assert.equal(runStarts,1,'native run is not restarted');
 const last=samples.at(-1);assert(Math.hypot(last.position.x-test.goal.x,last.position.z-test.goal.z)<.2,'arrives at the intended ground point');
 if(test.kind==='bridge')assert(Math.max(...samples.map(p=>p.display.y-terrainHeight(p.display.x,p.display.z)))>.2,'crosses the raised deck');
 else assert(Math.max(...samples.map(p=>p.display.y))-Math.min(...samples.map(p=>p.display.y))>.5,'climbs the terrace');
 await writeFile(`${dir}/samples.json`,JSON.stringify(samples));
 const video=spawnSync('ffmpeg',['-loglevel','error','-y','-framerate','10','-i',`${dir}/%04d.png`,'-c:v','libx264','-pix_fmt','yuv420p','-crf','20',`${out}/${test.name}.mp4`],{encoding:'utf8'});assert.equal(video.status,0,video.stderr);
 const report={scenario:test.name,frames:samples.length,movingFrames:moving.length,runStarts,errors};reports.push(report);console.log(JSON.stringify(report));await page.close();
}await writeFile(`${out}/checks.json`,JSON.stringify(reports,null,2));}finally{await browser.close()}
