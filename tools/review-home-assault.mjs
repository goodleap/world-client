import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const out=process.env.ASSAULT_REVIEW_OUTPUT||'/tmp/home-assault-review';await mkdir(out,{recursive:true});
const mobile=!!process.env.ASSAULT_MOBILE;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const errors=[],samples=[];
try{
 const context=await browser.newContext({viewport:mobile?{width:390,height:740}:{width:1100,height:760},isMobile:mobile,hasTouch:mobile,
  recordVideo:{dir:`${out}/video`,size:mobile?{width:390,height:740}:{width:1100,height:760}}});
 const page=await context.newPage();
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text().slice(0,300));}});
 await page.route('**/src/game/game.ts*',async route=>{
  const response=await route.fetch(),source=await response.text();assert(source.includes('canSave = true;'));
  await route.fulfill({response,body:source.replace('canSave = true;',`canSave = true;
   window.__assaultReview={economy,combat,raids,residents,scene,camera,world,homeCenter,
    view(x,z,size){setPreview();overview=false;zoom=currentZoom=size;mapCenter.set(x,.5,z);camera.target.copyFrom(mapCenter);applyProjection();},
    save,encoded:()=>encodeEconomy(economy),
    sample(){return {seconds:economy.state.seconds,debug:economy.state.debug,wave:raids.state.wave,pending:raids.state.pendingCount,
      hp:combat.target('home-center')?.hp??0,home:{...world.objects.get('home-center')},focus:{x:homeCenter.x,y:homeCenter.y,z:homeCenter.z},
      camera:{x:camera.target.x,y:camera.target.y,z:camera.target.z},navigation:backgroundPaths.snapshot(),
      units:combat.state.units.map(u=>({id:u.id,role:u.role,hp:u.hp,life:u.life,position:{...u.position},home:{...u.home},target:u.target,speed:u.speed,route:u.route.length,
        shown:!!residents.displayPosition(u.id)}))};}};`)});
 });
 await page.goto('http://127.0.0.1:5177/?debug');
 await page.locator('#loading[data-phase="menu"]').waitFor({timeout:90000});await page.locator('#start-game').click();
 await page.locator('#loading[data-phase="playing"]').waitFor({timeout:120000});
 await page.waitForFunction(()=>window.__assaultReview);await page.waitForTimeout(700);
 const initial=await page.evaluate(()=>window.__assaultReview.sample());
 assert(initial.debug);assert(initial.home.x<0&&initial.home.z>0);
 assert(Math.abs(initial.focus.x-initial.home.x)<.2&&Math.abs(initial.focus.z-initial.home.z)<1&&initial.focus.y>1);
 assert(Math.hypot(initial.camera.x-initial.focus.x,initial.camera.z-initial.focus.z)<.01);
 await writeFile(`${out}/initial.json`,JSON.stringify(initial,null,2));
 await page.screenshot({path:`${out}/home-initial.png`});
 await page.evaluate(()=>window.__assaultReview.view(10,0,12));await page.locator('#reset').click();
 await page.waitForFunction(()=>{const r=window.__assaultReview;return Math.hypot(r.camera.target.x-r.homeCenter.x,r.camera.target.z-r.homeCenter.z)<.03;});
 await page.screenshot({path:`${out}/home-reset.png`});
 if(process.env.ASSAULT_CAMERA_ONLY){await context.close();await browser.close();console.log(JSON.stringify({out,focus:initial.focus}));process.exit(0);}
 await page.waitForFunction(()=>window.__assaultReview.combat.state.units.length>=8,null,{timeout:90000});
 const first=await page.evaluate(()=>window.__assaultReview.sample());samples.push(first);
 await page.evaluate(()=>{const r=window.__assaultReview,u=r.combat.state.units[0];r.view(u.position.x,u.position.z,9);});
 // Keep the real render/simulation/Worker loop running while recording travel.
 for(let i=0;i<5;i++){
  await page.waitForTimeout(1200);samples.push(await page.evaluate(()=>window.__assaultReview.sample()));
  await page.screenshot({path:`${out}/approach-${i}.png`});
 }
 const moving=samples.at(-1).units.filter(u=>{const start=first.units.find(s=>s.id===u.id);return start&&Math.hypot(u.position.x-start.position.x,u.position.z-start.position.z)>1;});
 assert(moving.length>=4,'several rendered enemies continuously traverse the terrain');
 if(process.env.ASSAULT_RECYCLE_ONLY){
  const retired=await page.evaluate(()=>{
   const r=window.__assaultReview,ids=r.combat.state.units.slice(0,4).map(u=>u.id);
   for(const id of ids)r.combat.hurt(id,100000,'farmer');r.economy.state.seconds+=6.2;return ids;
  });
  await page.waitForFunction(ids=>ids.every(id=>!window.__assaultReview.combat.unit(id)),retired,{timeout:30000});
  const stale=await page.evaluate(ids=>{
   const r=window.__assaultReview;
   return {labels:ids.filter(id=>document.querySelector('[data-resident="'+id+'"]')),
    units:r.combat.state.units.length,disposed:ids.every(id=>!r.residents.displayPosition(id)),
    vitals:ids.filter(id=>r.economy.state.vitals[id]),saved:r.encoded()};
  },retired);
  assert(stale.disposed);assert.deepEqual(stale.vitals,[]);
  await writeFile(`${out}/recycle.json`,JSON.stringify({errors,retired,...stale},null,2));
  assert.deepEqual(errors,[]);await context.close();await browser.close();
  console.log(JSON.stringify({out,retired:retired.length,remaining:stale.units,moving:moving.length,focus:initial.focus,errors}));process.exit(0);
 }
 await page.locator('#reset').click();
 await page.waitForFunction(()=>window.__assaultReview.sample().hp<1500,null,{timeout:180000});
 await page.screenshot({path:`${out}/home-under-attack.png`});
 await page.waitForFunction(()=>window.__assaultReview.economy.state.raids.wave>=3,null,{timeout:120000});
 samples.push(await page.evaluate(()=>window.__assaultReview.sample()));
 // Saving and loading must retain the running assault instead of restarting it.
 const saved=await page.evaluate(()=>{const r=window.__assaultReview;r.save();return r.encoded();});
 const before=JSON.parse(saved);assert(before.raids.soldiers.length>12);
 await page.reload();await page.locator('#loading[data-phase="menu"]').waitFor({timeout:90000});
 await page.locator('#continue-save').click();
 await page.locator('#loading[data-phase="playing"]').waitFor({timeout:120000});
 const resumed=await page.evaluate(()=>window.__assaultReview.sample());
 assert(resumed.wave>=before.raids.wave);assert(resumed.units.some(u=>before.raids.soldiers.includes(u.id)));
 await writeFile(`${out}/review.json`,JSON.stringify({errors,initial,samples,resumed},null,2));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({out,mobile,focus:initial.focus,home:initial.home,waves:resumed.wave,count:resumed.units.length,moving:moving.length,hp:samples.at(-1).hp,errors}));
 await context.close();
}finally{await browser.close();}
