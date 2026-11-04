import {test,expect} from '@playwright/test';
import {Economy,encodeEconomy} from '../../src/game/economy.ts';
import {buildingAt} from '../../src/game/construction.ts';
import {openGame,snapshot,selectUnit,panTo,clickGround} from './helpers.ts';

test('top selection, population filters, panel footers and full map touch gestures',async({page},info)=>{
  test.setTimeout(200000);
  const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;e.state.groups[0]=['infantry'];
  for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  const enemy=e.state.combat.units.find(u=>u.id==='enemy-guard')!;enemy.experience=200;
  await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page);
  await selectUnit(page,'cavalry',true);await expect(page.locator('#resident-level')).toHaveText('1级');
  await expect(page.locator('[data-health="cavalry"]')).toBeVisible();
  await page.locator('#unit-details summary').click();await expect(page.locator('#unit-attributes')).toContainText('经验');
  const top=(await page.locator('#selection-info').boundingBox())!,bottom=(await page.locator('#clear-selection').boundingBox())!;
  expect(top.y+top.height).toBeLessThan(bottom.y);expect(Math.abs(top.x+top.width/2-page.viewportSize()!.width/2)).toBeLessThan(1);
  await page.screenshot({path:info.outputPath('top-soldier-card.png')});
  await page.locator('#clear-selection').click();await selectUnit(page,'farmer',true);await expect(page.locator('#resident-level')).toBeHidden();
  await page.locator('#home-resources').click();await page.locator('#population-tab').click();
  const infantry=page.locator('#group-candidates [data-resident="infantry"]');
  await expect(infantry.locator('[data-stat="group"]')).toHaveText('1队');
  await page.locator('#population-filters [data-role="farmer"]').click();await page.locator('#group-member-farmer').check();
  await page.locator('#population-filters [data-role="archer"]').click();await page.locator('#group-member-archer').check();
  await page.locator('#population-filters [data-role="infantry"]').click();await expect(page.locator('#group-member-infantry')).toBeChecked();
  await page.locator('#save-group').click();expect((await snapshot(page)).economy.groups[0].sort()).toEqual(['archer','farmer','infantry']);
  await page.locator('#group-editor-tabs button').nth(1).click();await expect(infantry.locator('[data-stat="group"]')).toHaveText('1队');
  await page.locator('#population-filters [data-role="all"]').click();
  for(const [width,height] of [[320,568],[844,390],[412,915]]){
    await page.setViewportSize({width,height});await expect(page.locator('#continue-home')).toBeInViewport();
    const tabs=(await page.locator('#group-editor-tabs').boundingBox())!,save=(await page.locator('#save-group').boundingBox())!;
    expect(save.x).toBeGreaterThan(tabs.x+tabs.width);expect(Math.abs(save.y-tabs.y)).toBeLessThan(3);
    expect(await page.locator('#population-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`population-${width}.png`)});
  }
  await page.locator('#buildings-tab').click();await expect(page.locator('#auto-repair')).toBeChecked();await page.locator('#auto-repair').uncheck();
  await page.locator('#continue-home').click();expect((await snapshot(page)).manualPaused).toBe(false);
  await page.locator('#settings').click();await expect(page.getByRole('button',{name:'关闭设置',exact:true})).toBeVisible();
  for(const [width,height] of [[320,568],[844,390]]){
    await page.setViewportSize({width,height});await expect(page.locator('#continue-game')).toBeInViewport();
    const footer=(await page.locator('#settings-dialog .panel-footer').boundingBox())!,scroll=(await page.locator('.settings-scroll').boundingBox())!;
    expect(footer.y).toBeGreaterThanOrEqual(scroll.y+scroll.height+10);
    await page.screenshot({path:info.outputPath(`settings-${width}.png`)});
  }
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();expect((await snapshot(page)).manualPaused).toBe(false);
  await page.setViewportSize({width:412,height:915});await page.locator('#clear-selection').click();
  const camera=(await snapshot(page)).camera;
  await page.locator('#map-toggle').click();await page.locator('#minimap').tap();await expect(page.locator('#map-dialog')).toBeVisible();
  const touch=await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:156,y:450,id:1},{x:256,y:450,id:2}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:86,y:450,id:1},{x:326,y:450,id:2}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.locator('#map-viewport').getAttribute('data-zoom').then(Number)).toBeGreaterThan(2);
  const transform=await page.locator('#minimap').evaluate(el=>el.style.transform);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:240,y:450}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:150,y:400}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
  expect(await page.locator('#minimap').evaluate(el=>el.style.transform)).not.toBe(transform);
  await page.mouse.move(200,450);await page.mouse.wheel(0,-300);
  await expect.poll(()=>page.locator('#map-viewport').getAttribute('data-zoom').then(Number)).toBeGreaterThan(2.4);
  await page.screenshot({path:info.outputPath('full-map-pan-zoom.png')});
  await page.getByRole('button',{name:'关闭全屏地图'}).click();expect((await snapshot(page)).camera).toEqual(camera);
  expect(await page.locator('#minimap').evaluate(el=>el.parentElement!.id)).toBe('minimap-panel');
  await page.locator('#map-toggle').click();
  await panTo(page,(await snapshot(page)).economy.combat.units.find(u=>u.id===enemy.id)!.position,true);
  await expect(async()=>{
    if(await page.locator('#resident-selection.enemy-info').isVisible())return;
    const current=(await snapshot(page)).residents.find(u=>u.id===enemy.id)!;
    await clickGround(page,current.renderPosition,true,current.elevation+1);
    await expect(page.locator('#resident-selection.enemy-info')).toBeVisible({timeout:1000});
  }).toPass({timeout:20000});
  await expect(page.locator('#resident-selection.enemy-info')).toBeVisible();await expect(page.locator('#resident-level')).toHaveText('2级');
  await expect(page.locator('#resident-vitals .unit-vital:visible')).toHaveCount(1);
  await page.screenshot({path:info.outputPath('enemy-card.png')});await page.locator('#clear-selection').click();
  await expect(page.locator('#selection-info')).toBeHidden();expect(errors).toEqual([]);
});

test('demolition waits in the paused panel, can be cancelled and uses the farmer hammer before removal',async({page},info)=>{
  test.setTimeout(120000);const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
  const site=buildingAt('house',{x:-10,z:-10},'site-0');e.state.sites.push(site);e.state.buildings.push(site.id);e.state.nextSiteId=1;
  e.state.residents.farmer={position:{x:site.x,z:site.z-site.depth/2-2}};
  for(const id of ['farmer-2','farmer-leader']){e.state.vitals[id].hp=0;e.state.vitals[id].diedAt=0;}
  for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page);await page.locator('#home-resources').click();await page.locator('#buildings-tab').click();
  const row=page.locator('#building-rows [data-building="site-0"]');
  const order=async()=>{await row.getByRole('button',{name:/拆除/}).click();await page.locator('#demolish-confirm').click();};
  await order();await expect(row).toContainText('待拆除');expect((await snapshot(page)).economy.sites).toHaveLength(1);
  await row.getByRole('button',{name:'取消拆除'}).click();await expect(row).toContainText('完好');
  await order();await page.locator('#continue-home').click();await panTo(page,site,true);await clickGround(page,site,true,1.4);
  await expect(page.locator('.selected-object-label [role="meter"]')).toBeVisible();
  await expect.poll(async()=>(await snapshot(page)).economy.tasks.find(t=>t.kind==='demolish'&&t.status==='working')?.progress??0,{timeout:30000}).toBeGreaterThan(0);
  const working=await snapshot(page);expect(working.economy.sites).toHaveLength(1);
  const farmer=working.residents.find(r=>r.id==='farmer')!;expect(farmer.working).toBe(true);expect(farmer.motion).toBe('work');
  await expect.poll(async()=>JSON.stringify((await snapshot(page)).residents.find(r=>r.id==='farmer')!.modelPose)).not.toBe(JSON.stringify(farmer.modelPose));
  await page.screenshot({path:info.outputPath('farmer-demolishing.png')});
  await expect.poll(async()=>(await snapshot(page)).economy.sites.length,{timeout:45000}).toBe(0);
  expect((await snapshot(page)).economy.goods.some(g=>g.resource==='wood'&&g.state==='ground')).toBe(true);
  expect(errors).toEqual([]);
});

test('actual combat shows damage numbers and freezes them with the game pause',async({page},info)=>{
  test.setTimeout(90000);const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
  const home=e.state.combat.units.find(u=>u.id==='infantry')!,foe=e.state.combat.units.find(u=>u.id==='enemy-guard')!;
  home.position={x:4,z:-2};foe.position={x:5.2,z:-2};home.order='attack';home.target=foe.id;foe.order='attack';foe.target=home.id;
  await page.addInitScript(save=>{
    localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');
    const watch=()=>{const home=document.querySelector('.damage-number.home-damage:not([hidden])'),enemy=document.querySelector('.damage-number:not(.home-damage):not([hidden])');
      if(window.__DEMO__&&home&&enemy){document.getElementById('settings')!.click();return;}requestAnimationFrame(watch);};requestAnimationFrame(watch);
  },encodeEconomy(e));
  const errors=await openGame(page);await expect(page.locator('#settings-dialog')).toBeVisible();
  const numbers=page.locator('.damage-number:not([hidden])');expect(await numbers.count()).toBeGreaterThanOrEqual(2);
  for(const text of await numbers.allTextContents())expect(Number(text)).toBeGreaterThan(0);
  const before=await numbers.evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,style:(n as HTMLElement).style.cssText})));
  await page.waitForTimeout(250);expect(await numbers.evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,style:(n as HTMLElement).style.cssText})))).toEqual(before);
  const hide=await page.addStyleTag({content:'#settings-dialog { visibility:hidden; } #settings-dialog::backdrop { background:transparent; backdrop-filter:none; }'});
  await page.screenshot({path:info.outputPath('combat-damage-numbers.png')});await hide.evaluate(el=>(el as HTMLElement).remove());
  expect((await page.evaluate(()=>window.__DEMO__!.frameSnapshot())).damage.allocated).toBeLessThanOrEqual(32);expect(errors).toEqual([]);
});
