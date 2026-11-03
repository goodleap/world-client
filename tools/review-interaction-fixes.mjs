import { chromium, devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { ENEMIES } from '../src/game/resident-data.ts';
import { newWolf } from '../src/game/raid-state.ts';
import { OUTPOST } from '../src/game/combat-config.ts';
import { findPath } from '../src/game/pathfinding.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { WORLD_BOUNDS } from '../src/game/world-data.ts';

// Controlled game time only in the intercepted development response. Real
// Babylon rendering, native picking, UI events and production gameplay rules.
const url=process.env.INTERACTION_REVIEW_URL||'http://127.0.0.1:5175/';
const out=process.env.INTERACTION_REVIEW_DIR||'/tmp/world-interaction-review';
const only=process.env.INTERACTION_REVIEW_CASES?.split(',');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const reports=[];
try{
  for(const name of only||['camp-mobile','defence-mobile','wolf-mobile','fallback-mobile','wolf-desktop']){
    const scenario=name.split('-')[0],touch=name.endsWith('mobile'),campScene=['camp','defence'].includes(scenario),id=campScene?'infantry':scenario==='wolf'?'archer':'cavalry';
    const e=new Economy();e.setLeadership(false);e.state.seconds=10;e.state.raids.nextAt=1000;
    for(const u of e.state.combat.units)if(u.id!==id&&!(campScene&&u.id==='enemy-guard')){u.life='defeated';u.hp=0;u.diedAt=0;}
    for(const v of Object.values(e.state.vitals)){v.manualUntil=1000;if(v.hp!==undefined){v.hp=0;v.diedAt=0;}}
    if(id==='cavalry'){e.state.vitals.horse.hp=160;e.state.vitals.horse.diedAt=undefined;}
    for(const w of e.state.raids.wildWolves){w.life='defeated';w.hp=0;w.diedAt=0;w.settled=true;}
    for(const camp of e.state.combat.camps){camp.discovered=true;camp.cleared=camp.rewardGranted=e.state.combat.units.filter(u=>ENEMIES.find(r=>r.id===u.id)?.camp===camp.id).every(u=>u.life==='defeated');}
    e.state.combat.discovered=true;e.state.combat.cleared=e.state.combat.rewardGranted=e.state.combat.camps.every(c=>c.cleared);
    const hero=e.state.combat.units.find(u=>u.id===id);
    const direction={x:Math.cos(Math.PI/8),z:Math.sin(Math.PI/8)},at=d=>({x:OUTPOST.x+direction.x*d,z:OUTPOST.z+direction.z*d});
    if(campScene){
      const guard=e.state.combat.units.find(u=>u.id==='enemy-guard');guard.position=at(14.2);guard.target=id;
      hero.position=at(15.6);
      if(scenario==='defence'){
        guard.position=at(18);guard.order='hold';guard.goal={...guard.home};guard.target=undefined;
        guard.route=findPath(guard.position,guard.goal,.4,WORLD_BOUNDS,economyObstacles([],[],[]));assert(guard.route);
        hero.position=at(19.4);
      }
    }else if(scenario==='wolf'){
      hero.position={x:-4,z:-2};hero.order='move';hero.goal={x:-4,z:10};hero.route=findPath(hero.position,hero.goal,.4,WORLD_BOUNDS,economyObstacles([],[],[]));
      assert(hero.route);
      const wolf=newWolf('wolf-1-0',{x:-4,z:-11});wolf.target=id;wolf.mode='hunt';wolf.defendFrom={...wolf.position};
      Object.assign(e.state.raids,{wave:1,phase:'raid',startedAt:10,wolves:[wolf],origin:{...wolf.position}});
    }
    const save=encodeEconomy(e);decodeEconomy(save);
    const context=await browser.newContext(touch?{...devices['Pixel 7'],deviceScaleFactor:1}:{viewport:{width:1000,height:750}});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.routeWebSocket(new URL(url).origin.replace(/^http/,'ws')+'/**',socket=>socket.close());
    await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},save);
    await page.route('**/src/game/game.ts*',async route=>{
      const response=await route.fetch(),source=await response.text();assert(source.includes('canSave = true;'));
      await route.fulfill({response,body:source.replace('canSave = true;',`canSave = true;
        engine.stopRenderLoop(render);scene.useConstantAnimationDeltaTime=true;engine.getDeltaTime=()=>1000/60;
        window.__interactionReview={scene,engine,render,combat,residents,raids,wolves,ui,economy,camera,
          frame(){engine.beginFrame();render();engine.endFrame();engine.stopRenderLoop();},
          view(x,z,size){zoom=currentZoom=size;mapCenter.set(x,.5,z);camera.target.copyFrom(mapCenter);},
          project(p,y=0){const q=Vector3.Project(new Vector3(p.x,y,p.z),Matrix.Identity(),scene.getTransformMatrix(),camera.viewport.toGlobal(ui.canvas.clientWidth,ui.canvas.clientHeight));return {x:q.x,y:q.y,z:q.z};},
          pick(p,y=.7){const q=this.project(p,y);return scene.pick(q.x,q.y,isWorldPickable)?.pickedMesh?.metadata?.id;}
        };`)});
    });
    await page.goto(url);await page.locator('#continue-save').click();
    await page.waitForFunction(()=>window.__interactionReview,null,{timeout:90000});
    const frame=()=>page.evaluate(id=>{const r=window.__interactionReview;r.frame();const hero=r.combat.unit(id),guard=r.combat.unit('enemy-guard'),wolf=r.raids.state.wolves[0];
      return {seconds:r.economy.state.seconds,hero:{position:hero.position,hp:hero.hp,order:hero.order,target:hero.target,goal:hero.goal,route:hero.route.length},
        guard:{position:guard.position,hp:guard.hp,order:guard.order,target:guard.target,goal:guard.goal,attack:guard.attack?.elapsed,quiet:guard.pursuitQuiet},
        wolf:wolf&&{position:wolf.position,hp:wolf.hp,speed:wolf.speed},navigation:window.__DEMO__.snapshot().navigation};},id);
    const view=async(p,size)=>{await page.evaluate(({p,size})=>window.__interactionReview.view(p.x,p.z,size),{p,size});await frame();await frame();};
    const click=async(p,y=0)=>{const q=await page.evaluate(({p,y})=>window.__interactionReview.project(p,y),{p,y});
      assert(q.x>0&&q.y>0&&q.x<page.viewportSize().width&&q.y<page.viewportSize().height,`click inside ${name}: ${JSON.stringify(q)}`);
      if(touch)await page.touchscreen.tap(q.x,q.y);else await page.mouse.click(q.x,q.y);};
    const samples=[],dir=`${out}/${name}`;await mkdir(dir,{recursive:true});
    const capture=async()=>{const s=await frame();samples.push(s);
      if(touch)await page.screenshot({path:`${dir}/${String(samples.length-1).padStart(4,'0')}.png`,scale:'css'});
      // Drain software-rendered GPU work during desktop samples as well.
      else if(samples.length%10===0)await page.screenshot({scale:'css'});
      return s;};
    let extra={};
    if(scenario==='camp'){
      await view(at(18),12);await click(hero.position,1);const initial=(await frame()).hero.hp;
      for(let i=0;i<60;i++){const s=await capture();assert.equal(s.guard.order,'guard');assert.equal(s.guard.target,id);}
      assert(samples.at(-1).hero.hp<initial,'guard deals real damage beyond the old boundary');
      await click(at(22));let returned=false,returnX;
      for(let i=0;i<160;i++){const s=await capture();if(s.guard.order==='hold'&&s.guard.goal){returned=true;returnX=s.guard.position;break;}}
      assert(returned,'hard limit starts a real return');
      for(let i=0;i<30;i++)await capture();
      const end=samples.at(-1).guard;assert.equal(end.order,'hold');assert(Math.hypot(end.position.x-returnX.x,end.position.z-returnX.z)>.5);
      extra={oldBoundary:14,hardLimit:20,returnStartedAt:returnX,returnGoal:end.goal};
    }else if(scenario==='defence'){
      await view(at(18),12);await click(hero.position,1);await click((await frame()).guard.position,1);
      const initial=await frame();
      for(let i=0;i<60;i++){const s=await capture();assert.equal(s.guard.order,'hold');assert.deepEqual(s.guard.goal,initial.guard.goal);}
      assert(samples.some(s=>s.guard.attack!==undefined)&&samples.at(-1).hero.hp<initial.hero.hp,'returning guard actually retaliates');
      const before={...samples.at(-1).guard.position};await click(at(22));
      for(let i=0;i<80;i++)await capture();
      const end=samples.at(-1).guard;assert.equal(end.order,'hold');assert(Math.hypot(end.position.x-end.goal.x,end.position.z-end.goal.z)<Math.hypot(before.x-end.goal.x,before.z-end.goal.z)-1);
      extra={retaliation:true,returnGoal:end.goal};
    }else if(scenario==='wolf'){
      await view({x:-4,z:-6},9);await click((await frame()).hero.position,1);
      const initial=(await frame()).wolf.hp,triangles=[];
      for(const size of [5,11,20]){
        const p=await page.evaluate(()=>{const p=window.__interactionReview.wolves.displayPosition('wolf-1-0');return {x:p.x,z:p.z};});await view(p,size);
        const info=await page.evaluate(()=>{const r=window.__interactionReview,p=r.wolves.displayPosition('wolf-1-0');return {p:{x:p.x,z:p.z},id:r.pick(p),triangles:r.wolves.snapshot().find(w=>w.id==='wolf-1-0').triangles};});
        assert.equal(info.id,'wolf-1-0');triangles.push(info.triangles);await click(info.p,.7);await frame();
        assert.equal((await frame()).hero.target,'wolf-1-0','native pointer event issues an attack against the wolf');
      }
      assert(new Set(triangles).size>=2,'real native wolf LOD changes');
      await view({x:-4,z:-6},9);
      for(let i=0;i<100;i++)await capture();assert(samples.some(s=>s.wolf.speed>.1));assert(samples.at(-1).wolf.hp<initial);
      const lifecycle=await page.evaluate(()=>{
        const r=window.__interactionReview,w=r.raids.state.wolves[0],point={...w.position};
        w.life='defeated';w.hp=0;w.diedAt=r.economy.state.seconds;r.wolves.update(r.raids.wolves,r.economy.state.seconds,r.camera,1);r.scene.render();
        const dead=r.pick(point);
        const fresh={...structuredClone(w),id:'wolf-2-0',hp:75,life:'active',diedAt:undefined,attack:undefined,target:undefined};
        r.raids.state.wolves=[fresh];r.wolves.update(r.raids.wolves,r.economy.state.seconds,r.camera,1);r.scene.render();
        const rebound=r.pick(point);
        fresh.mode='gone';r.wolves.update(r.raids.wolves,r.economy.state.seconds,r.camera,1);r.scene.render();
        return {dead,rebound,gone:r.pick(point)};
      });
      assert.notEqual(lifecycle.dead,'wolf-1-0');assert.equal(lifecycle.rebound,'wolf-2-0');assert.notEqual(lifecycle.gone,'wolf-2-0');
      extra={triangles,lifecycle};
    }else{
      await view({x:-4,z:-4},8);await click((await frame()).hero.position,1.6);
      const point={x:-4,z:-25};await view({x:-5,z:-23},12);await click(point);
      let accepted;
      for(let i=0;i<90;i++){const s=await frame();if(s.hero.goal){accepted=s.hero.goal;break;}}
      assert(accepted,'the formerly unreachable click is accepted');const offset=Math.hypot(accepted.x-point.x,accepted.z-point.z);assert(offset>3&&offset<=6);
      await view({x:-6,z:-14},15);let arrived=false;
      for(let i=0;i<360;i++){const s=await capture();if(Math.hypot(s.hero.position.x-accepted.x,s.hero.position.z-accepted.z)<.2){arrived=true;break;}}
      assert(arrived,'horse physically reaches the accepted nearby goal');extra={clicked:point,accepted,offset};
    }
    assert.deepEqual(errors,[]);await page.screenshot({path:`${out}/${name}.png`,scale:'css'});
    const report={name,frames:samples.length,...extra,errors,samples};await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));
    if(touch){const video=spawnSync('ffmpeg',['-loglevel','error','-y','-framerate','60','-i',`${dir}/%04d.png`,'-frames:v',String(samples.length),'-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-pix_fmt','yuv420p','-crf','20',`${out}/${name}.mp4`],{encoding:'utf8'});assert.equal(video.status,0,video.stderr);}
    const {samples:_,...summary}=report;reports.push(summary);console.log(JSON.stringify(summary));await context.close();
  }
  await writeFile(`${out}/report.json`,JSON.stringify({method:'Native Babylon frames at controlled 1/60 game seconds, pointer/touch attack and move commands, full consecutive frame recordings',reports},null,2));
}finally{await browser.close();}
