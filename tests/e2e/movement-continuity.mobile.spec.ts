import { test, expect } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { buildingAt } from '../../src/game/construction.ts';
import { newTower } from '../../src/game/towers.ts';
import { groupDestinations } from '../../src/game/group-orders.ts';
import { openGame, snapshot, panTo, clickGround } from './helpers.ts';

type MovementSample={positions:{x:number;z:number;radius:number}[];moving:boolean[];motions:(string|undefined)[]};
declare global { interface Window { __MOVEMENT_REVIEW__?: { done:boolean; samples:MovementSample[] } } }

test('phone mixed formation keeps its feedback, arrives without overlap and displays tower armor 20', async ({ page }, info) => {
  info.setTimeout(150000);
  const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
  const ids=['farmer','infantry','archer','cavalry'];e.state.groups[0]=ids;
  for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  ids.forEach((id,i)=>{
    const position={x:-9+i*2,z:-10},u=e.state.combat.units.find(u=>u.id===id);
    if(u)u.position=position;else e.state.residents[id]={position};
  });
  const tower=buildingAt('tower',{x:-16,z:-10},'site-0');
  e.state.sites.push(tower);e.state.buildings.push(tower.id);e.state.towers.push(newTower(tower));e.state.nextSiteId=1;
  await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page);
  await page.locator('#home-resources').click();await page.getByRole('tab',{name:'建筑',exact:true}).click();
  const row=page.locator('[data-building="site-0"]');
  await expect(row.locator('[data-stat="armor"]')).toHaveText('20');
  await expect(row.locator('[data-stat="health"]')).toHaveText('500/500');
  await page.screenshot({path:info.outputPath('tower-500-20.png')});
  await page.getByRole('button',{name:'关闭家园面板'}).click();
  await panTo(page,{x:-6,z:-14},true);await page.locator('[data-group="0"]').click();
  const before=await snapshot(page),goal={x:-6,z:-17};
  // Capture inside the browser from the pointer event: fast units can arrive
  // before a later Playwright snapshot, legitimately clearing their live goal.
  await page.evaluate(ids=>{
    const review={done:false,samples:[] as MovementSample[]};window.__MOVEMENT_REVIEW__=review;
    document.querySelector('canvas')!.addEventListener('click',()=>{
      const observe=()=>{
        const s=window.__DEMO__!.snapshot(),units=ids.map(id=>s.residents.find(r=>r.id===id)!);
        const moving=ids.map(id=>{const u=s.combat.units.find(u=>u.id===id);return u?!!u.route.length:!!s.residents.find(r=>r.id===id)!.routeRemaining;});
        review.samples.push({positions:units.map(u=>({...u.position,radius:u.bodyRadius})),moving,motions:units.map(u=>u.motion)});
        if(s.economy.groupMoves['0']&&!s.navigation.pending&&moving.every(m=>!m)){
          document.getElementById('settings')!.click();review.done=true;return;
        }
        requestAnimationFrame(observe);
      };requestAnimationFrame(observe);
    },{once:true});
  },ids);
  await clickGround(page,goal,true);
  try {
    await page.waitForFunction(()=>window.__MOVEMENT_REVIEW__?.done,undefined,{timeout:60000});
  } finally {
    const state=await snapshot(page);
    await info.attach('mixed-formation-state',{body:JSON.stringify({navigation:state.navigation,order:state.economy.groupMoves['0'],
      units:state.combat.units.filter(u=>ids.includes(u.id)),residents:state.residents.filter(r=>ids.includes(r.id)),
      review:await page.evaluate(()=>window.__MOVEMENT_REVIEW__),errors}),contentType:'application/json'});
  }
  const trace=await page.evaluate(()=>window.__MOVEMENT_REVIEW__!.samples);
  for(const sample of trace)for(let i=0;i<sample.positions.length;i++)for(let j=i+1;j<sample.positions.length;j++) {
    const a=sample.positions[i],b=sample.positions[j];expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeGreaterThanOrEqual(a.radius+b.radius-.001);
  }
  const final=await snapshot(page);
  expect(final.selection.members).toEqual(ids);
  const center=final.economy.groupMoves['0'].center;
  expect(Math.hypot(center.x-goal.x,center.z-goal.z)).toBeLessThan(.08);
  const destinations=groupDestinations(ids.map(id=>{const r=before.residents.find(r=>r.id===id)!;return {id,position:r.position,radius:r.bodyRadius};}),center);
  for(const {id,point} of destinations){const p=final.residents.find(r=>r.id===id)!.position;expect(Math.hypot(p.x-point.x,p.z-point.z)).toBeLessThan(.16);}
  ids.forEach((_,i)=>expect(trace.some(s=>s.moving[i]&&s.motions[i]==='run')).toBe(true));
  await info.attach('mixed-formation-trace',{body:JSON.stringify(trace),contentType:'application/json'});
  expect(errors).toEqual([]);
});
