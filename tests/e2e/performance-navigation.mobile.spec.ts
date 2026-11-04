import { test, expect } from '@playwright/test';
import { openGame, snapshot, panTo, clickGround } from './helpers.ts';
import { Economy, initialEconomy, encodeEconomy } from '../../src/game/economy.ts';
import { buildingAt, buildingDoor } from '../../src/game/construction.ts';
import { newTower } from '../../src/game/towers.ts';

type Frame=ReturnType<NonNullable<Window['__DEMO__']>['frameSnapshot']>;
declare global { interface Window { __MAP_REVIEW__?:{running:boolean;frames:Frame[]} } }

test('debug farmers sow and the minimap footprint follows every rendered camera move and zoom',async({page},info)=>{
  test.setTimeout(150000);
  // Fresh debug state, with one farmer approaching the ripe field around an
  // actual world obstacle. Other farmers keep normal automatic sowing enabled.
  const e=new Economy(initialEconomy(1,true));e.state.raids.nextAt=1000;
  e.state.residents.farmer={position:{x:-15,z:3}};
  const harvest=e.request('harvest','plot-0').task!;e.assign(harvest.id,'farmer');
  await page.addInitScript(save=>{localStorage.setItem('world-shadows-enabled','false');localStorage.setItem('world-basic-economy-v1',save);},encodeEconomy(e));
  const errors=await openGame(page,'/?debug');
  await expect.poll(async()=>{
    const s=await snapshot(page);
    return s.residents.some(r=>r.role==='farmer'&&r.motion==='run');
  },{timeout:30000}).toBe(true);
  await expect.poll(async()=>(await snapshot(page)).economy.tasks.some(t=>t.kind==='sow'&&t.status==='done'),{timeout:30000}).toBe(true);
  await expect.poll(async()=>(await snapshot(page)).navigation.automatic.completed,{timeout:30000}).toBeGreaterThan(0);
  await page.locator('#map-toggle').click();
  await page.evaluate(()=>{
    const review={running:true,frames:[] as Frame[]};window.__MAP_REVIEW__=review;
    const sample=()=>{
      const frame=window.__DEMO__!.frameSnapshot();
      if(frame.frames!==review.frames.at(-1)?.frames)review.frames.push(frame);
      if(review.running)requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  });
  const touch=await page.context().newCDPSession(page);
  const nextFrame=async(frame:number)=>page.waitForFunction(previous=>window.__DEMO__!.frameSnapshot().frames>previous,frame);
  for(const direction of [1,-1]){
    const x=direction===1?110:290,y=450;
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let step=1;step<=8;step++){
      const frame=await page.evaluate(()=>window.__DEMO__!.frameSnapshot().frames);
      await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+direction*step*20,y}]});
      await nextFrame(frame);
    }
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await touch.detach();
  await page.mouse.move(180,450);
  for(const delta of [-240,240]){
    const frame=await page.evaluate(()=>window.__DEMO__!.frameSnapshot().frames);
    await page.mouse.wheel(0,delta);await nextFrame(frame);
  }
  const frames=await page.evaluate(()=>{window.__MAP_REVIEW__!.running=false;return window.__MAP_REVIEW__!.frames;});
  await info.attach('minimap-motion',{body:JSON.stringify({frames,navigation:(await snapshot(page)).navigation}),contentType:'application/json'});
  let moved=0,zoomed=false;
  for(let i=1;i<frames.length;i++){
    const before=frames[i-1],frame=frames[i],view=frame.minimap.view;
    if(!view||view.length!==4)continue;
    const center=view.reduce((sum,p)=>sum+p.x,0)/4;
    expect(Math.abs(center-frame.camera.target.x)).toBeLessThan(.01);
    if(Math.abs(frame.camera.target.x-before.camera.target.x)>.001){
      moved++;expect(frame.minimap.draws).toBeGreaterThan(before.minimap.draws);
    }
    if(Math.abs(frame.camera.zoom-before.camera.zoom)>.01&&before.minimap.view?.length===4){
      zoomed=true;
      const span=(f:Frame)=>Math.max(...f.minimap.view!.map(p=>p.x))-Math.min(...f.minimap.view!.map(p=>p.x));
      expect(Math.abs(span(frame)/span(before)-frame.camera.zoom/before.camera.zoom)).toBeLessThan(.001);
    }
  }
  expect(moved).toBeGreaterThan(5);expect(zoomed).toBe(true);
  expect(frames.at(-1)!.minimap.terrainBuilds).toBe(1);
  expect(frames.at(-1)!.minimap.mapBuilds).toBe(1);
  await page.locator('#map-toggle').click();
  const closed=await page.evaluate(()=>window.__DEMO__!.frameSnapshot().minimap);
  await page.locator('#game').focus();
  const hiddenFrame=await page.evaluate(()=>window.__DEMO__!.frameSnapshot().frames);
  await page.keyboard.down('ArrowRight');await nextFrame(hiddenFrame);await page.keyboard.up('ArrowRight');
  expect((await page.evaluate(()=>window.__DEMO__!.frameSnapshot().minimap)).draws).toBe(closed.draws);
  const state=await snapshot(page);
  expect(state.economy.debug).toBe(true);expect(state.navigation.automatic.failed).toBe(false);
  expect(errors).toEqual([]);
});

test('an occupied tower entrance keeps the automatic garrison button enabled and yields for the archer',async({page})=>{
  test.setTimeout(120000);
  const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
  // Keep both the entrance and the archer on walkable ground; farther west the
  // initial archer position would fall inside the cliff polygon.
  const site=buildingAt('tower',{x:-10,z:-10},'site-0'),door=buildingDoor(site);
  e.state.sites.push(site);e.state.buildings.push(site.id);e.state.towers.push(newTower(site));e.state.nextSiteId=1;
  e.state.residents.farmer={position:{...door}};
  const archer=e.state.combat.units.find(u=>u.id==='archer')!;archer.position={x:door.x,z:door.z-4};
  for(const vital of Object.values(e.state.vitals))vital.manualUntil=1000;
  await page.addInitScript(save=>{localStorage.setItem('world-shadows-enabled','false');localStorage.setItem('world-basic-economy-v1',save);},encodeEconomy(e));
  const errors=await openGame(page);await panTo(page,site,true);await clickGround(page,site,true,1);
  const enter=page.getByRole('button',{name:/^入驻·/});
  await expect(enter).toBeEnabled();await enter.click();
  await expect.poll(async()=>(await snapshot(page)).economy.towers.find(t=>t.id===site.id)?.phase,{timeout:45000}).toBe('occupied');
  expect((await snapshot(page)).economy.towers[0].unit).toBe('archer');expect(errors).toEqual([]);
});
