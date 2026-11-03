import { chromium, devices, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { openGame, snapshot, selectUnit, clickGround } from '../tests/e2e/helpers.ts';

const url=process.env.FARM_REVIEW_URL||'http://127.0.0.1:5176/';
const out=process.env.FARM_REVIEW_DIR||'/tmp/world-farm-beds';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
let reviewPage;
try{
  const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
  for(const vital of Object.values(e.state.vitals))vital.manualUntil=1000;
  const infantry=e.state.combat.units.find(u=>u.id==='infantry');infantry.position={x:3,z:-25};
  const guard=e.state.combat.units.find(u=>u.id==='enemy-ore-0');
  const archer=e.state.combat.units.find(u=>u.id==='enemy-archer');
  const cavalry=e.state.combat.units.find(u=>u.team==='enemy'&&u.role==='cavalry');
  const wolf=e.state.raids.wildWolves[0];
  const save=encodeEconomy(e);decodeEconomy(save);
  const context=await browser.newContext({...devices['Pixel 7'],deviceScaleFactor:1,viewport:{width:393,height:852}});
  await context.addInitScript(save=>localStorage.setItem('world-basic-economy-v1',save),save);
  const page=await context.newPage();
  reviewPage=page;
  await page.route('**/src/game/game.ts*',async route=>{
    const response=await route.fetch(),body=await response.text();assert(body.includes('canSave = true;'));
    await route.fulfill({response,body:body.replace('canSave = true;',
      'canSave = true; window.__inspectionReview = {combat, residents, center(p) {mapCenter.set(p.x,.5,p.z);camera.target.copyFrom(mapCenter);}};')});
  });
  const errors=await openGame(page,url);
  const center=async point=>{
    const frames=(await snapshot(page)).frames;await page.evaluate(point=>window.__inspectionReview.center(point),point);
    await page.waitForFunction(frames=>window.__DEMO__.snapshot().frames>frames+1,frames);
  };
  const resize=async size=>{
    const frames=(await snapshot(page)).frames;await page.setViewportSize(size);
    await page.waitForFunction(({frames,ratio})=>{const s=window.__DEMO__.snapshot();return s.frames>frames+1&&Math.abs(s.graphics.width/s.graphics.height-ratio)<.01;},
      {frames,ratio:size.width/size.height});
  };
  await center((await snapshot(page)).residents.find(u=>u.id==='cavalry').position);
  await selectUnit(page,'cavalry',true);
  const tree=(await snapshot(page)).objects.find(o=>o.kind==='tree'&&o.screen.x>40&&o.screen.x<350&&o.screen.y>210&&o.screen.y<680);
  assert(tree,'visible tree for non-farmer work rejection');
  const tasks=(await snapshot(page)).economy.tasks;
  await page.touchscreen.tap(tree.screen.x,tree.screen.y);
  await expect(page.locator('#selection-hint')).toHaveText('此作业需要农民');
  await expect(page.locator('#selection-hint')).toBeVisible();
  await expect(page.locator('#target-hint')).toBeHidden();
  assert.equal(await page.getByText('此作业需要农民',{exact:true}).filter({visible:true}).count(),1);
  assert.deepEqual((await snapshot(page)).economy.tasks,tasks);
  await page.screenshot({path:`${out}/farmer-hint.png`});
  await page.locator('#clear-selection').tap();
  const clickEnemy=async(id,touch=true)=>{
    const state=await snapshot(page),unit=state.combat.units.find(u=>u.id===id)??state.economy.raids.wildWolves.find(u=>u.id===id);
    assert(unit);await clickGround(page,unit.position,touch,unit.role==='cavalry'?1.6:unit.role==='wolf'?.65:1);
  };
  const inspected=[];
  for(const unit of [guard,archer,cavalry,wolf]){
    await center(unit.position);
    await clickEnemy(unit.id);
    await expect.poll(async()=>(await snapshot(page)).selection.enemy).toBe(unit.id);
    await expect(page.locator(`[data-health="${unit.id}"]`)).toBeVisible();
    await expect(page.locator('#resident-selection')).toBeHidden();
    await expect(page.locator('#target-hint')).toBeHidden();
    const state=await snapshot(page);assert.equal(state.selection.resident,undefined);
    assert.equal(state.selectionFeedback.enemy.visible,true);assert.equal(state.selectionFeedback.enemy.color,'#ef6b58');
    await page.screenshot({path:`${out}/inspect-${unit.role}.png`});inspected.push(unit.id);
    await clickEnemy(unit.id);assert.equal((await snapshot(page)).selection.enemy,undefined);
    await expect(page.locator(`[data-health="${unit.id}"]`)).toBeHidden();
  }
  await center(guard.position);
  await resize({width:1280,height:800});
  await clickEnemy(guard.id,false);await expect(page.locator(`[data-health="${guard.id}"]`)).toBeVisible();
  await page.screenshot({path:`${out}/inspect-desktop.png`});
  // Actual damage/life-cycle logic, injected only to keep this UI check bounded.
  await page.evaluate(id=>window.__inspectionReview.combat.hurt(id,8,'infantry'),guard.id);
  await expect.poll(async()=>Number(await page.locator(`[data-health="${guard.id}"]`).getAttribute('aria-valuenow'))).toBeLessThan(guard.hp);
  await page.evaluate(id=>window.__inspectionReview.combat.hurt(id,9999,'infantry'),guard.id);
  await expect.poll(async()=>(await snapshot(page)).selection.enemy).toBeUndefined();
  assert.equal((await snapshot(page)).selectionFeedback.enemy.visible,false);
  await resize({width:393,height:852});
  await center({x:3,z:-25});await selectUnit(page,'infantry',true);
  await center(archer.position);await clickEnemy(archer.id);
  const attacked=await snapshot(page),soldier=attacked.combat.units.find(u=>u.id==='infantry');
  assert.equal(attacked.selection.resident,'infantry');assert.equal(attacked.selection.enemy,undefined);
  assert.equal(soldier.order,'attack');assert.equal(soldier.target,archer.id);
  await expect(page.locator(`[data-resident="${archer.id}"] .resident-attack-target`)).toBeVisible();
  await page.screenshot({path:`${out}/attack-command.png`});
  assert.deepEqual(errors,[]);
  await writeFile(`${out}/inspection-results.json`,JSON.stringify({inspected,headHealthOnly:true,redRing:true,toggle:true,
    mouseAndTouch:true,damageUpdates:true,deathClears:true,attackCommandPreserved:true,singleFarmerHint:true,errors},null,2)+'\n');
  console.log('Enemy inspection passed: head health/red ring, toggle, damage/death, attack command and single farmer hint.');
  await context.close();
}catch(error){
  if(reviewPage){await reviewPage.screenshot({path:`${out}/inspection-failed.png`});
    await writeFile(`${out}/inspection-failed.json`,JSON.stringify(await snapshot(reviewPage),null,2));}
  throw error;
}finally{await browser.close();}
