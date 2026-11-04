import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Economy,encodeEconomy} from '../src/game/economy.ts';

const out=process.env.MANUAL_DANGER_DIR||'/tmp/world-manual-danger';
const url=process.env.MANUAL_DANGER_URL||'http://127.0.0.1:5178/';
await mkdir(out,{recursive:true});
const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
e.state.inventory={wood:60,stone:40,food:0,iron:0};
// A remembered danger area near the grove guards, where the former camp-wide
// circle also blocked construction. Real combat, work and navigation stay on.
e.state.dangerZones.push({id:'area:12:0',x:12,z:0,radius:4});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1,isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.routeWebSocket(/.*/,socket=>socket.send(JSON.stringify({type:'connected'})));
  await page.addInitScript(save=>{
    if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);
    localStorage.setItem('world-shadows-enabled','false');
  },encodeEconomy(e));
  // Test-only fixed clock and access to the existing controllers. No product
  // hooks or replacement movement/danger functions are installed.
  await page.route('**/src/game/game.ts*',async route=>{
    const response=await route.fetch(),source=await response.text();assert(source.includes('canSave = true;'));
    await route.fulfill({response,body:source.replace('canSave = true;',`canSave = true;
      engine.stopRenderLoop(render);scene.useConstantAnimationDeltaTime=true;engine.getDeltaTime=()=>1000/60;
      window.__manualDanger={economy,residents,raids,controller,save,
        frame(){engine.beginFrame();render();engine.endFrame();engine.stopRenderLoop();},
        view(x,z,size){zoom=size;mapCenter.set(x,0,z);camera.target.copyFrom(mapCenter);this.frame();},
        to(seconds){while(economy.state.seconds<seconds-1e-6){
          const dt=Math.min(.05,seconds-economy.state.seconds);
          residents.beginStep();wolves.beginStep(raids.wolves);ui.advanceSpeech(dt);
          controller.update(dt);raids.update(dt);combat.update(dt);residents.syncCombat(combat.state.units);
          residents.update(dt,undefined,dt);needs.update(dt);residents.endStep();
        }world.sync();refreshEconomy();residents.resetPresentation();freshFrame=true;this.frame();},
        read(){return {seconds:economy.state.seconds,tasks:structuredClone(economy.state.tasks),
          zones:structuredClone(economy.state.dangerZones),evading:structuredClone(raids.state.evading),
          buildings:[...economy.state.buildings],inventory:{...economy.state.inventory},
          people:residents.snapshot().filter(p=>p.id.startsWith('farmer')).map(p=>({id:p.id,position:p.position,
            travelled:p.travelled,motion:p.motion,working:p.working,work:residents.farmerWorkState(p.id)}))};}
      };`)});
  });
  const open=async()=>{
    await page.goto(url);await page.locator('#continue-save').tap();
    await page.waitForFunction(()=>window.__manualDanger,null,{timeout:90000});
  };
  const read=()=>page.evaluate(()=>window.__manualDanger.read());
  const tap=async(point,y=0)=>{
    const camera=await page.evaluate(()=>window.__DEMO__.snapshot().camera),v=page.viewportSize(),scale=v.height/(2*camera.zoom);
    await page.touchscreen.tap(v.width/2+(point.x-camera.target.x)*scale,
      v.height/2+((camera.target.y-y)*Math.sin(camera.beta)-(point.z-camera.target.z)*Math.cos(camera.beta))*scale);
  };
  await open();
  await page.evaluate(()=>window.__manualDanger.view(8,0,13));
  const initial=await read();
  await page.locator('#building-toggle').tap();await page.locator('#build-house').tap();await tap({x:12,z:0});
  const placed=await read(),task=placed.tasks.find(t=>t.kind==='build');assert(task,'touch placement queues a building');
  assert.equal(task.origin,'manual');
  const samples=[];
  // Render successive native movement/work states, including beyond the short
  // manual grace period, while the remembered danger region is still active.
  for(let i=1;i<=32;i++){
    await page.evaluate(t=>window.__manualDanger.to(t),initial.seconds+i*.2);
    samples.push(await read());
    if(i===8||i===32)await page.screenshot({path:`${out}/${i===8?'approach':'working'}.png`});
  }
  const working=samples.at(-1),active=working.tasks.find(t=>t.id===task.id);
  assert(active.worker);assert.equal(active.status,'working');assert(active.progress>1);assert(!active.danger);
  assert(working.zones.some(z=>z.id==='area:12:0'));assert(!working.evading[active.worker]);
  assert(samples.some(s=>s.people.some(p=>p.motion==='run')));assert(samples.some(s=>s.people.some(p=>p.working)));
  await page.evaluate(()=>window.__manualDanger.save());await open();
  const reloaded=await read();assert.equal(reloaded.tasks.find(t=>t.id===task.id).origin,'manual');
  await page.evaluate(t=>window.__manualDanger.to(t+20),reloaded.seconds);
  const completed=await read();assert(completed.buildings.includes(task.target));
  assert.equal(completed.inventory.wood,48);assert.equal(completed.inventory.stone,32);
  // Automatic work remains excluded; selecting a farmer and tapping the task
  // uses the same assign action as "优先执行" through the actual touch handler.
  const setup=await page.evaluate(()=>{
    const r=window.__manualDanger,p=r.economy.plot('plot-2');
    r.economy.state.dangerZones.push({id:'area:'+p.x+':'+p.z,x:p.x,z:p.z,radius:2});
    const t=r.economy.request('sow',p.id,'wheat','steward').task;
    r.to(r.economy.state.seconds+.6);r.view(p.x,p.z,13);
    return {task:t.id,plot:{x:p.x,z:p.z},people:r.read().people};
  });
  const held=await read();assert(held.tasks.find(t=>t.id===setup.task).danger);
  const farmer=setup.people.find(p=>p.id==='farmer');
  await page.evaluate(p=>window.__manualDanger.view(p.x,p.z,13),farmer.position);await tap(farmer.position,1);
  assert.equal(await page.evaluate(()=>window.__DEMO__.snapshot().selection.resident),'farmer');
  await page.evaluate(p=>window.__manualDanger.view(p.x,p.z,13),setup.plot);await tap(setup.plot);
  const taken=await read(),manual=taken.tasks.find(t=>t.id===setup.task);
  assert.equal(manual.origin,'manual');assert.equal(manual.worker,'farmer');assert(!manual.danger);
  await page.evaluate(t=>window.__manualDanger.to(t+12),taken.seconds);
  const final=await read();assert.equal(final.tasks.find(t=>t.id===setup.task).status,'done');
  assert.deepEqual(errors,[]);
  await writeFile(`${out}/browser.json`,JSON.stringify({initial,placed,samples,reloaded,completed,held,taken,final,errors},null,2));
  console.log(JSON.stringify({ok:true,worker:active.worker,workingProgress:active.progress,buildings:completed.buildings,
    manualTakeover:manual.origin,finalStatus:final.tasks.find(t=>t.id===setup.task).status,errors,out}));
}catch(error){
  await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});
  await writeFile(`${out}/failure.json`,JSON.stringify(await page.evaluate(()=>({state:window.__manualDanger?.read(),
    selection:window.__DEMO__?.snapshot().selection})).catch(()=>null),null,2));
  throw error;
}finally{await browser.close();}
