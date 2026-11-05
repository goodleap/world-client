import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Browser verification only: the served module exposes existing systems for
// observation; no test hooks or synthetic actors enter the production bundle.
const out=process.env.NAVIGATION_REVIEW_OUTPUT||'/tmp/navigation-performance-review';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const errors=[],samples=[];
try{
 const context=await browser.newContext({viewport:{width:1100,height:760},recordVideo:{dir:`${out}/video`,size:{width:1100,height:760}}});
 const page=await context.newPage();
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text().slice(0,300));}});
 await page.route('**/src/game/scene-candidates.ts*',async route=>{
  const response=await route.fetch(),source=await response.text();
  const marker=/rebuilds\+\+;\s*staticDirty = false;/;assert(marker.test(source),'index observation marker');
  await route.fulfill({response,body:source.replace(marker,`rebuilds++; staticDirty = false;
   const trace=window.__staticReview??={last:new Map(),events:[]},current=new Map(entries.map(m=>[m.uniqueId,m.name]));
   trace.events.push({rebuilds,added:[...current].filter(([id])=>!trace.last.has(id)).map(([,name])=>name),
    removed:[...trace.last].filter(([id])=>!current.has(id)).map(([,name])=>name)});trace.last=current;`)});
 });
 await page.route('**/src/game/game.ts*',async route=>{
  const response=await route.fetch(),source=await response.text();assert(source.includes('canSave = true;'));
  await route.fulfill({response,body:source.replace('canSave = true;',`canSave = true;
   const indexReview=[],arrowIds=new Set();
   scene.onBeforeRenderObservable.add(()=>{const s=sceneCandidates.snapshot();indexReview.push([economy.state.seconds,s.rebuilds,s.static,s.dynamic]);
    if(indexReview.length>1000)indexReview.shift();for(const p of combat.state.projectiles)arrowIds.add(p.id);});
   window.__navReview={economy,combat,raids,residents,scene,world,navigation,backgroundPaths,indexReview,arrowIds,save,
    view(x,z,size){setPreview();overview=false;zoom=currentZoom=size;mapCenter.set(x,.5,z);camera.target.copyFrom(mapCenter);applyProjection();},
    sample(){return {seconds:economy.state.seconds,wave:raids.state.wave,hp:combat.target('home-center')?.hp,
      index:sceneCandidates.snapshot(),navigation:navigation.snapshot(),automatic:backgroundPaths.snapshot(),arrows:arrowIds.size,
      units:combat.state.units.map(u=>({id:u.id,team:u.team,role:u.role,hp:u.hp,position:{...u.position},speed:u.speed,target:u.target,shown:!!residents.displayPosition(u.id)}))};}};`)});
 });
 await page.goto(process.env.NAVIGATION_REVIEW_URL||'http://127.0.0.1:5177/?debug');
 await page.locator('#loading[data-phase="menu"]').waitFor({timeout:90000});await page.locator('#start-game').click();
 await page.waitForFunction(()=>window.__navReview,null,{timeout:90000});
 await page.locator('#settings').click();
 const worker=await page.evaluate(async()=>{
  const r=window.__navReview,pausedAt=r.economy.state.seconds;
  const {createBackgroundPaths}=await import('/src/game/path-planner.ts');
  const {WORLD_BOUNDS}=await import('/src/game/world-data.ts');
  const {segmentIsClear}=await import('/src/game/wander.ts');
  const planner=createBackgroundPaths(new Worker('/src/game/pathfinding.worker.ts?worker_file&type=module',{type:'module'}));
  const queries=Array.from({length:12},(_,i)=>({start:{x:-6,z:2},goals:[{x:-1.5+i*.1,z:2}],radius:.29,bounds:WORLD_BOUNDS,obstacles:r.world.obstacles(true)}));
  const begin=performance.now();
  try{
   for(const q of queries)planner.plan(q);
   await new Promise((resolve,reject)=>{
    const timer=setInterval(()=>{const s=planner.snapshot();if(s.ready===queries.length){clearInterval(timer);resolve();}
     else if(s.failed||performance.now()-begin>20000){clearInterval(timer);reject(new Error('Worker batch stalled'));}},20);
   });
   const before=planner.snapshot(),stillPending=queries.every(q=>planner.plan(q)===null);planner.flush();
   const paths=queries.map(q=>planner.plan(q));
   const valid=paths.every((path,i)=>path?.length&&path.every((p,j)=>segmentIsClear(j?path[j-1]:queries[i].start,p,.29,WORLD_BOUNDS,queries[i].obstacles)));
   return {before,after:planner.snapshot(),stillPending,valid,pausedAt,afterSeconds:r.economy.state.seconds,elapsedMs:performance.now()-begin};
  }finally{planner.dispose();}
 });
 assert.equal(worker.before.ready,12);assert.equal(worker.before.completed,0);assert(worker.stillPending&&worker.valid);
 assert.equal(worker.before.geometryUploads,1);assert.equal(worker.pausedAt,worker.afterSeconds);
 console.log(JSON.stringify({worker}));
 await page.locator('#continue-game').click();
 // Queue the real one-second debug recruits and a manual farmer order. Their
 // models, navigation and combat continue through the normal render loop.
 await page.evaluate(async()=>{
  const r=window.__navReview,{recruit}=await import('/src/game/recruitment.ts');
  for(const role of ['infantry','archer','cavalry'])recruit(r.economy,role);
  r.navigation.request('farmer',()=>r.residents.movementInput('farmer',{x:-7,z:1}),path=>r.residents.command({x:-7,z:1},'farmer',false,path));
 });
 await page.waitForFunction(()=>window.__navReview.combat.state.units.filter(u=>u.team==='enemy').length>=12,null,{timeout:120000});
 const first=await page.evaluate(()=>window.__navReview.sample());samples.push(first);
 await page.evaluate(()=>{const r=window.__navReview,u=r.combat.state.units.find(u=>u.team==='enemy');r.view(u.position.x,u.position.z,10);});
 for(let i=0;i<6;i++){
  await page.waitForTimeout(1000);samples.push(await page.evaluate(()=>window.__navReview.sample()));
  await page.screenshot({path:`${out}/travel-${i}.png`});
 }
 assert(samples.at(-1).units.filter(u=>{const old=first.units.find(s=>s.id===u.id);return old&&Math.hypot(u.position.x-old.position.x,u.position.z-old.position.z)>1;}).length>=4);
 await page.evaluate(()=>{const r=window.__navReview,h=r.world.objects.get('home-center');r.view(h.x,h.z-3,12);});
 await page.waitForFunction(()=>window.__navReview.arrowIds.size>=3,null,{timeout:240000});
 const battleStart=await page.evaluate(()=>window.__navReview.sample());
 await page.waitForFunction(t=>window.__navReview.economy.state.seconds>t+2,battleStart.seconds,{timeout:90000});
 const battle=await page.evaluate(()=>({sample:window.__navReview.sample(),index:window.__navReview.indexReview,staticChanges:window.__staticReview.events.slice(1)}));
 samples.push(battleStart,battle.sample);
 await writeFile(`${out}/running.json`,JSON.stringify({worker,samples,...battle,errors},null,2));
 // Farmers may create/remove real static goods or harvest trees during the
 // battle. Every rebuild must correspond to such a static membership change.
 assert(battle.staticChanges.every(e=>e.added.length||e.removed.length),'dynamic churn must not rebuild an unchanged static tree');
 assert(battle.staticChanges.every(e=>[...e.added,...e.removed].every(name=>name!=='combat-arrow')));
 assert(battle.sample.arrows>=3);assert(!battle.sample.automatic.failed&&!battle.sample.navigation.failed);
 await page.screenshot({path:`${out}/battle.png`});
 await page.locator('#settings').click();const paused=await page.evaluate(()=>window.__navReview.economy.state.seconds);
 await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__navReview.economy.state.seconds),paused);
 await page.reload();await page.locator('#continue-save').waitFor({timeout:90000});await page.locator('#continue-save').click();
 await page.waitForFunction(()=>window.__navReview,null,{timeout:90000});
 const resumed=await page.evaluate(()=>window.__navReview.sample());assert(resumed.seconds>=paused);assert(resumed.units.length>=battleStart.units.length);
 assert.deepEqual(errors,[]);
 await writeFile(`${out}/result.json`,JSON.stringify({worker,samples,index:battle.index,staticChanges:battle.staticChanges,resumed,errors},null,2));
 console.log(JSON.stringify({out,worker:worker.before,index:battle.sample.index,arrows:battle.sample.arrows,units:battle.sample.units.length,errors}));
 await context.close();
}finally{await browser.close();}
