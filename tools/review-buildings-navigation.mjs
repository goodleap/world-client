import { chromium,expect } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import { Economy,encodeEconomy } from '../src/game/economy.ts';
import { BUILDINGS } from '../src/game/world-data.ts';
import { openGame,panTo,clickGround,snapshot } from '../tests/e2e/helpers.ts';

const out=new URL('../docs/buildings-navigation/',import.meta.url).pathname;await mkdir(out,{recursive:true});
const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=600;e.damageBuilding('cottage',60);
for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage({viewport:{width:1000,height:700}});
  await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page,process.env.REVIEW_URL??'http://127.0.0.1:4175/');
  const house=BUILDINGS[0];await clickGround(page,{x:house.x,z:house.z-house.depth/2-.2},false,1.3);
  await expect(page.locator('#selection-hint')).toContainText('生命 540/600 · 防御 8');
  await page.getByRole('button',{name:'维修 · 木1 石1',exact:true}).click();
  await page.waitForFunction(()=>window.__DEMO__.snapshot().economy.tasks.some(t=>t.kind==='repair'&&t.status==='working'&&t.progress>1));
  const working=await snapshot(page);await page.screenshot({path:out+'repair-in-world.png',scale:'css'});
  await page.keyboard.press('Escape');await panTo(page,{x:-37,z:59});
  const camp=(await snapshot(page)).residents.filter(r=>r.id.startsWith('enemy-orchard-'));
  expect(camp).toHaveLength(4);expect(camp.every(r=>!!r.model)).toBe(true);
  await page.screenshot({path:out+'north-camp.png',scale:'css'});expect(errors).toEqual([]);
  await writeFile(out+'scene-review.json',JSON.stringify({repair:working.economy.tasks.filter(t=>t.kind==='repair'),camp:camp.map(r=>({id:r.id,position:r.position,model:!!r.model})),errors},null,2));
}finally{await browser.close();}
