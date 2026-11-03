import { chromium, devices, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy } from '../src/game/economy.ts';
import { ECONOMY_CONFIG } from '../src/game/economy-config.ts';
import { openGame, snapshot, selectUnit, panTo } from '../tests/e2e/helpers.ts';

const url=process.env.MAP_FARM_REVIEW_URL||'http://127.0.0.1:5176/';
const out=process.env.MAP_FARM_REVIEW_DIR||'/tmp/world-map-farm';
const cases=process.env.MAP_FARM_REVIEW_CASES?.split(',')||['mobile','desktop'];
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const reports=[];
try{
  for(const name of cases){
    if(name==='model'){
      const page=await browser.newPage({viewport:{width:560,height:480}});
      for(const layout of ['single','row','block','l']){
        await page.goto(new URL(`studies/farm.html?layout=${layout}`,url).href);await page.waitForFunction(()=>window.farmReview);
        for(const view of layout==='single'?['game','side','top']:['game','top']){
          await page.evaluate(({view,size})=>window.farmReview.view(view,size),{view,size:layout==='single'?2.5:4.5});
          await page.screenshot({path:`${out}/soil-${layout}-${view}.png`});
        }
      }
      await page.close();continue;
    }
    const touch=name!=='desktop',e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
    e.plot('plot-0').growth=ECONOMY_CONFIG.crops.carrot.growthSeconds;
    e.plot('plot-1').growth=ECONOMY_CONFIG.crops.wheat.growthSeconds*.45;
    const context=await browser.newContext(touch?{...devices['Pixel 7'],deviceScaleFactor:1}:{viewport:{width:1280,height:800}});
    await context.addInitScript(({save,unsupported})=>{
      if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);
      if(unsupported)Object.defineProperty(performance,'memory',{value:undefined,configurable:true});
    },{save:encodeEconomy(e),unsupported:!touch});
    const page=await context.newPage(),errors=await openGame(page,url);
    if(name==='appearance'){
      await page.setViewportSize({width:393,height:852});await panTo(page,{x:4,z:-4},true);
      await page.locator('#map-toggle').tap();await page.screenshot({path:`${out}/farms-final.png`});
      const object=(await snapshot(page)).objects.find(o=>o.id==='plot-5');await page.touchscreen.tap(object.screen.x,object.screen.y);
      await expect(page.getByRole('button',{name:'种胡萝卜',exact:true})).toBeVisible();
      assert.equal((await snapshot(page)).selection.object.id,'plot-5');
      await page.screenshot({path:`${out}/farm-selected.png`});assert.deepEqual(errors,[]);
      const result={name,soilSelection:true,errors};reports.push(result);await writeFile(`${out}/${name}-results.json`,JSON.stringify(result,null,2));
      await context.close();continue;
    }
    await expect(page.locator('#minimap-panel')).toBeHidden();assert.equal((await snapshot(page)).minimap.draws,0);
    await expect(page.locator('#fps-value')).toHaveText(/\d+\.\d/);
    if(touch)await expect(page.locator('#memory-value')).toHaveText(/\d+\.\d/);
    else await expect(page.locator('#memory-value')).toHaveText('—');
    const press=async id=>touch?await page.locator(id).tap():await page.locator(id).click();
    await selectUnit(page,'infantry',touch);
    const before=await snapshot(page),order=before.combat.units.find(u=>u.id==='infantry');
    await press('#map-toggle');await expect(page.locator('#map-toggle')).toHaveAttribute('aria-expanded','true');
    await page.waitForFunction(()=>window.__DEMO__.snapshot().minimap.draws>1);
    if(touch)await page.locator('#minimap').tap();else await page.locator('#minimap').click();
    const opened=await snapshot(page);assert.equal(opened.manualPaused,false);assert.equal(opened.selection.resident,'infantry');
    assert.equal(opened.combat.units.find(u=>u.id==='infantry').order,order.order);
    assert.deepEqual(opened.combat.units.find(u=>u.id==='infantry').goal,order.goal);
    const renderLoops=opened.diagnostics.renderLoops;assert.equal(renderLoops,1);
    const camera=opened.camera,view=opened.minimap.view;
    assert.equal(view.length,4);assert(Math.abs(view.reduce((n,p)=>n+p.x,0)/4-camera.target.x)<.1);
    assert(Math.abs(view.reduce((n,p)=>n+p.z,0)/4-camera.target.z-camera.target.y*Math.tan(camera.beta))<.1);
    const png=await page.locator('#minimap').screenshot();assert(png.length>1000);
    await press('#map-toggle');await expect(page.locator('#minimap-panel')).toBeHidden();
    const folded=await snapshot(page);await page.waitForFunction(frames=>window.__DEMO__.snapshot().frames>frames+2,folded.frames);
    assert.equal((await snapshot(page)).minimap.draws,folded.minimap.draws);
    await press('#map-toggle');await page.waitForFunction(draws=>window.__DEMO__.snapshot().minimap.draws>draws,folded.minimap.draws);
    assert.equal((await snapshot(page)).minimap.terrainBuilds,1);
    const oldView=(await snapshot(page)).minimap.view;
    await panTo(page,{x:4,z:-2},touch);await page.waitForFunction(old=>JSON.stringify(window.__DEMO__.snapshot().minimap.view)!==old,JSON.stringify(oldView));
    const layouts=[];
    for(const size of touch?[{width:320,height:720},{width:393,height:852},{width:844,height:390}]:[{width:1280,height:800}]){
      await page.setViewportSize(size);await page.waitForFunction(()=>window.__DEMO__.snapshot().frames>2);
      const boxes=await page.evaluate(()=>Object.fromEntries(['home-resources','settings','map-toggle','performance','queue-toggle','minimap-panel'].map(id=>{
        const r=document.getElementById(id).getBoundingClientRect();return [id,{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}];
      })));
      for(const [id,r] of Object.entries(boxes))assert(r.x>=0&&r.y>=0&&r.right<=size.width+.1&&r.bottom<=size.height+.1,`${name} ${size.width}: ${id} inside viewport`);
      const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>.5;
      for(const [a,b] of [['home-resources','map-toggle'],['map-toggle','settings'],['performance','queue-toggle'],['performance','minimap-panel']])assert(!overlap(boxes[a],boxes[b]),`${size.width}: ${a} / ${b}`);
      assert(boxes['map-toggle'].right<boxes.settings.x);assert.equal(boxes['map-toggle'].w,boxes.settings.w);
      await page.screenshot({path:`${out}/${name}-${size.width}.png`});layouts.push({viewport:size,boxes});
    }
    if(touch)await page.setViewportSize({width:393,height:852});
    await press('#settings');const frozen=await snapshot(page),heap=await page.locator('#memory-value').textContent();
    await page.waitForTimeout(300);assert.equal((await snapshot(page)).economy.seconds,frozen.economy.seconds);
    assert.equal(await page.locator('#memory-value').textContent(),heap);
    await page.getByRole('button',{name:'继续游戏',exact:true}).click();
    await page.waitForFunction(t=>window.__DEMO__.snapshot().economy.seconds>t,frozen.economy.seconds);
    let farming;
    if(touch){
      await press('#clear-selection');await press('#reset');await panTo(page,{x:4,z:-4},true);
      const choose=async(id,label)=>{
        const object=(await snapshot(page)).objects.find(o=>o.id===id);await page.touchscreen.tap(object.screen.x,object.screen.y);
        await expect(page.getByRole('button',{name:label,exact:true})).toBeVisible();await page.getByRole('button',{name:label,exact:true}).tap();
      };
      await page.screenshot({path:`${out}/farms-stages.png`});await choose('plot-0','收获');
      await page.waitForFunction(()=>!window.__DEMO__.snapshot().economy.plots.find(p=>p.id==='plot-0').crop,null,{timeout:90000,polling:500});
      const harvested=(await snapshot(page)).economy;assert(harvested.tasks.some(t=>t.target==='plot-0'&&t.kind==='harvest'));
      await page.screenshot({path:`${out}/farm-harvested.png`});
      await choose('plot-7','拆除');await page.locator('#demolish-confirm').tap();
      await page.waitForFunction(()=>!window.__DEMO__.snapshot().economy.plots.some(p=>p.id==='plot-7'));
      await page.screenshot({path:`${out}/farm-removed.png`});
      await press('#queue-toggle');await expect(page.locator('#queue-panel')).toBeVisible();await page.screenshot({path:`${out}/mobile-queue.png`});await press('#queue-close');
      await press('#settings');await page.locator('#return-menu').click();await page.reload();
      await page.locator('#continue-save').click();await page.waitForFunction(()=>window.__DEMO__?.snapshot().frames>2,null,{timeout:90000});
      assert.equal((await snapshot(page)).economy.plots.find(p=>p.id==='plot-0').crop,undefined);
      assert(!(await snapshot(page)).economy.plots.some(p=>p.id==='plot-7'));
      await page.screenshot({path:`${out}/farm-reloaded.png`});
      await expect(page.locator('#minimap-panel')).toBeHidden();farming={harvested:true,demolished:true,reloaded:true};
    }
    assert.deepEqual(errors,[]);
    const result={name,layouts,heap:await page.locator('#memory-value').textContent(),collapsedStopsDrawing:true,terrainBuilds:1,
      pointerDoesNotCommandUnits:true,viewportTracksCamera:true,renderLoops,farming,errors};
    await writeFile(`${out}/${name}-results.json`,JSON.stringify(result,null,2));reports.push(result);console.log(`${name}: passed`);
    await context.close();
  }
  if(reports.length)await writeFile(`${out}/browser-results.json`,JSON.stringify({reports},null,2));
}finally{await browser.close();}
