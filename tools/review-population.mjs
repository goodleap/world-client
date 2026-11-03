import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { recruit, advanceRecruitment, homeResidents } from '../src/game/recruitment.ts';
import { Combat } from '../src/game/combat.ts';
import { livingPopulation } from '../src/game/home-status.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { GRID_SIZE } from '../src/game/world-data.ts';
import { isBlocked } from '../src/game/movement.ts';

const out=new URL('../docs/balance-watchtower',import.meta.url).pathname;await mkdir(out,{recursive:true});
function fixture(count){
  const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=600;
  const roles=['farmer','infantry','archer','cavalry'];
  for(let i=6;i<count;i++){
    e.state.inventory={wood:40,food:60,stone:24,iron:40};
    assert(recruit(e,roles[i%4]).ok);assert(advanceRecruitment(e,25));
  }
  const occupied=homeResidents(e.state).filter(r=>!r.id.startsWith('recruit-')).map(r=>({kind:'circle',...r.spawn,radius:r.bodyRadius}));
  const solids=[...economyObstacles([],[],[]),...e.state.plots.map(p=>({kind:'box',x:p.x,z:p.z,halfWidth:GRID_SIZE/2+.2,halfDepth:GRID_SIZE/2+.2}))],points=[];
  for(let x=-45;x<=45;x+=2.8)for(let z=-45;z<=45;z+=2.8)points.push({x,z});
  points.sort((a,b)=>Math.hypot(a.x+5,a.z+15)-Math.hypot(b.x+5,b.z+15));
  for(const r of e.state.recruitment.roster){
    const p=points.find(p=>!isBlocked(p,r.bodyRadius+.05,[...solids,...occupied]));assert(p,'free spawn');
    r.spawn={...p};e.state.residents[r.id]={position:{...p}};
    const u=e.state.combat.units.find(u=>u.id===r.id);if(u){u.position={...p};u.home={...p};u.order='hold';}
    occupied.push({kind:'circle',...p,radius:r.bodyRadius});
  }
  for(const u of e.state.combat.units.filter(u=>u.team==='enemy')){u.life='defeated';u.hp=0;u.diedAt=0;u.order='hold';}
  for(const w of e.state.raids.wildWolves){w.life='defeated';w.hp=0;w.diedAt=0;w.settled=true;}
  new Combat(e.state.combat,e,()=>[]).update(.05);
  const save=encodeEconomy(e);assert.equal(livingPopulation(decodeEconomy(save).state),count);return save;
}
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']}),readings=[];
try{
  for(const count of (process.env.POPULATION_COUNTS??'50,100,200').split(',').map(Number)){
    const context=await browser.newContext({viewport:{width:1000,height:700}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>{errors.push(e.message);console.log('pageerror',count,e.message);});
    page.on('console',m=>{if(m.type()==='error')console.log('console error',count,m.text());});
    await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},fixture(count));
    const start=Date.now();await page.goto('http://127.0.0.1:5174/');await page.locator('#continue-save').click();
    const progress=setInterval(async()=>{try{const stage=await page.locator('#loading').innerText();console.log('loading',count,stage.slice(0,260));}catch{}},15000);
    try{await page.waitForFunction(()=>window.__DEMO__?.snapshot().frames>5,null,{timeout:180000});}
    catch(error){console.log(await page.locator('body').innerText());await page.screenshot({path:out+`/population-${count}-failure.png`});throw error;}
    finally{clearInterval(progress);}
    const loadedMs=Date.now()-start;
    await page.waitForFunction(()=>window.__DEMO__.snapshot().economy.seconds>2,null,{timeout:60000});
    await page.locator('#home-resources').click();await page.getByRole('tab',{name:'人口',exact:true}).click();
    const s=await page.evaluate(()=>window.__DEMO__.snapshot());
    assert.equal(livingPopulation(s.economy),count);
    assert.equal(await page.locator('#group-candidates tr').count(),count+1);
    assert.equal(livingPopulation(decodeEconomy(JSON.stringify(s.economy)).state),count);
    readings.push({population:count,loadedMs,seconds:s.economy.seconds,meshes:s.meshes,renderedFrames:s.frames,errors});
    assert.deepEqual(errors,[]);
    if(count===200){
      await page.screenshot({path:out+'/population-200-desktop.png'});
      await page.setViewportSize({width:393,height:754});
      assert(await page.locator('.population-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
      await page.screenshot({path:out+'/population-200-phone.png'});
    }
    console.log(JSON.stringify(readings.at(-1)));
    await writeFile(out+`/population-${count}.json`,JSON.stringify(readings.at(-1),null,2));await context.close();
  }
  await writeFile(out+'/population-readings.json',JSON.stringify({backend:'Chromium SwiftShader; functional scale check, not device FPS',readings},null,2));
}finally{await browser.close();}
