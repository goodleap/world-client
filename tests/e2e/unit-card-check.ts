import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { openGame, selectUnit, snapshot, clickGround } from './helpers.ts';

export async function checkUnitCard(page: Page, info: TestInfo, touch: boolean) {
  const e = new Economy(); e.setLeadership(false);
  e.state.vitals.farmer.hp = 63; e.state.vitals.farmer.stamina = 47;
  e.state.vitals.horse.hp = 92; e.state.vitals.horse.stamina = 55;
  await page.addInitScript(save => {
    if (!localStorage.getItem('world-basic-economy-v1')) localStorage.setItem('world-basic-economy-v1', save);
    localStorage.setItem('world-shadows-enabled','false');
  }, encodeEconomy(e));
  const errors = await openGame(page);
  await selectUnit(page,'farmer',touch);
  await expect(page.locator('[data-vital="farmer-health"] .unit-vital-value')).toHaveText('63/100');
  const initialStamina = Number(await page.locator('[data-vital="farmer-stamina"] [role=meter]').getAttribute('aria-valuenow'));
  expect(initialStamina).toBeLessThanOrEqual(47);
  await page.locator('#building-toggle').click();
  expect((await snapshot(page)).selection.resident).toBe('farmer');
  const sizes = touch ? [[393,852],[320,568],[844,390]] : [[1280,900]];
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    const card=(await page.locator('#resident-selection').boundingBox())!, palette=(await page.locator('#building-palette').boundingBox())!;
    const build=(await page.locator('#building-toggle').boundingBox())!, reset=(await page.locator('#reset').boundingBox())!;
    const settings=(await page.locator('#settings').boundingBox())!;
    expect(build.height).toBe(settings.height); expect(reset.height).toBe(settings.height);
    expect(build.y).toBe(reset.y); expect(reset.x).toBe(settings.x);
    expect(Math.abs(card.x+card.width/2-width/2)).toBeLessThan(1);
    expect(card.y).toBeGreaterThanOrEqual(settings.y+settings.height);
    expect(card.y+card.height).toBeLessThan(palette.y);
    expect(palette.y+palette.height).toBeLessThanOrEqual(build.y-7);
    await expect(page.locator('#clear-selection')).toBeInViewport();
    expect(palette.x+palette.width).toBeLessThanOrEqual(width-7);
    const rows=await page.locator('[data-building]').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().y));
    expect(new Set(rows).size).toBe(1);
    const overflow=await page.locator('#resident-selection').evaluate(el=>el.scrollWidth>el.clientWidth);
    expect(overflow).toBe(false);
    await page.screenshot({path:info.outputPath(`card-build-${width}.png`),scale:'css'});
  }
  if (touch) {
    await page.setViewportSize({width:393,height:852});
    const palette=(await page.locator('#building-palette').boundingBox())!, camera=(await snapshot(page)).camera;
    const cdp=await page.context().newCDPSession(page), y=palette.y+palette.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:palette.x+palette.width-20,y}]});
    for (const distance of [30,70,120,180]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:palette.x+palette.width-20-distance,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await cdp.detach();
    await expect.poll(()=>page.locator('#building-palette').evaluate(el=>el.scrollLeft)).toBeGreaterThan(20);
    await expect(page.locator('#building-palette')).toBeVisible();
    expect((await snapshot(page)).placement.active).toBe(false);
    expect((await snapshot(page)).camera).toEqual(camera);
    expect((await snapshot(page)).selection.resident).toBe('farmer');
    await page.locator('#building-palette').evaluate(el=>{el.scrollLeft=0});
  }
  await page.locator('#build-farm').click();
  await expect(page.locator('#placement-status')).toBeVisible();
  expect((await snapshot(page)).selection.resident).toBe('farmer');
  expect((await snapshot(page)).placement.active).toBe(true);
  // An occupied plot rejects construction without sending the selected unit there.
  const before=await snapshot(page), plot=before.economy.plots[0];
  await clickGround(page,plot,touch);
  const after=await snapshot(page);
  expect(after.residents.find(r=>r.id==='farmer')!.moveCommand).toBe(false);
  expect(after.selection.resident).toBe('farmer');
  await page.locator('#cancel-building').click();
  // Dragging up into the map retains the existing drag-to-build interaction.
  await page.locator('#building-toggle').click();
  const option=(await page.locator('#build-farm').boundingBox())!, x=option.x+option.width/2, y=option.y+option.height/2;
  if (touch) {
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for (const dy of [20,60,140]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-dy}]});
    await expect(page.locator('#placement-status')).toBeVisible();
    expect((await snapshot(page)).selection.resident).toBe('farmer');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await cdp.detach();
  } else {
    await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x,y-140,{steps:3});
    await expect(page.locator('#placement-status')).toBeVisible();
    expect((await snapshot(page)).selection.resident).toBe('farmer');
    // Finish over the menu to exercise cancellation without placing a site.
    await page.mouse.move(x,y); await page.mouse.up(); await page.locator('#cancel-building').click();
  }
  expect((await snapshot(page)).placement.active).toBe(false);
  await selectUnit(page,'cavalry',touch);
  await expect(page.locator('#resident-vitals .unit-vital:visible')).toHaveCount(2);
  await expect(page.locator('[data-vital="horse-health"]')).toHaveCount(0);
  await expect(page.locator('[data-vital="cavalry-health"] [role=meter]')).toHaveAttribute('aria-label','骑手生命');
  expect(await page.locator('#resident-vitals').textContent()).not.toMatch(/生命|体力|HP/);
  await page.locator('#building-toggle').click();
  const mounted=(await page.locator('#resident-selection').boundingBox())!, choices=(await page.locator('#building-palette').boundingBox())!;
  expect(mounted.y+mounted.height).toBeLessThan(choices.y);
  await page.screenshot({path:info.outputPath('mounted-card.png'),scale:'css'});
  await page.locator('#building-toggle').click();
  await selectUnit(page,'farmer-leader',touch);
  await expect(page.locator('#leader-command-control')).toBeVisible();
  for (const [width,height] of touch ? [[393,852],[320,568],[844,390]] : [[1280,900]]) {
    await page.setViewportSize({width,height});
    const leader=(await page.locator('#resident-selection').boundingBox())!, command=(await page.locator('#leader-command-control').boundingBox())!;
    const cancel=(await page.locator('#clear-selection').boundingBox())!;
    expect(Math.abs(leader.x+leader.width/2-width/2)).toBeLessThan(1);
    expect(leader.y+leader.height).toBeLessThan(cancel.y);
    expect(command.y).toBeGreaterThanOrEqual(leader.y);
    expect(command.y+command.height).toBeLessThanOrEqual(leader.y+leader.height);
    expect(await page.locator('#resident-selection').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);
    await page.screenshot({path:info.outputPath(`leader-card-${width}.png`),scale:'css'});
  }
  if (touch) await page.setViewportSize({width:393,height:852});
  await page.locator('#leader-command-enabled').check();
  expect((await snapshot(page)).economy.steward.enabled).toBe(true);
  await page.locator('#leader-command-enabled').uncheck();
  await selectUnit(page,'dog',touch);
  await expect(page.locator('#resident-vitals .unit-vital:visible')).toHaveCount(2);
  await expect(page.locator('[data-vital="dog-health"] .unit-vital-value')).toHaveText('80/80');
  await page.locator('#settings').click();
  const paused=await snapshot(page), text=await page.locator('#resident-vitals').textContent();
  await page.waitForTimeout(400);
  expect((await snapshot(page)).economy.seconds).toBe(paused.economy.seconds);
  expect(await page.locator('#resident-vitals').textContent()).toBe(text);
  await page.locator('#continue-game').click();
  await page.locator('#clear-selection').click();
  await expect(page.locator('#resident-selection')).toBeHidden();
  expect((await snapshot(page)).selection.resident).toBeUndefined();
  await page.locator('#building-toggle').click();
  const compact=(await page.locator('#building-palette').boundingBox())!, control=(await page.locator('#building-toggle').boundingBox())!;
  expect(control.y-compact.y-compact.height).toBeGreaterThanOrEqual(7);
  expect(control.y-compact.y-compact.height).toBeLessThanOrEqual(9);
  expect(errors).toEqual([]);
}
