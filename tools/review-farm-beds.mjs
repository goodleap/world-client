// Native game review: crop dimensions, single-cell actions and soil troughs.
import { chromium, devices, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy } from '../src/game/economy.ts';
import { ECONOMY_CONFIG } from '../src/game/economy-config.ts';
import { openGame, snapshot, panTo } from '../tests/e2e/helpers.ts';

const url=process.env.FARM_REVIEW_URL||'http://127.0.0.1:5176/';
const out=process.env.FARM_REVIEW_DIR||'/tmp/world-farm-beds';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
try{
  const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
  const fixtures=[];
  for(const [row,kind] of ['carrot','wheat'].entries())for(const stage of [0,1,2]){
    const id=`plot-${row*4+stage}`,plot=e.plot(id);plot.crop=kind;
    plot.growth=ECONOMY_CONFIG.crops[kind].growthSeconds*[0,.5,1][stage];
    fixtures.push({id,kind,stage});
  }
  const context=await browser.newContext({...devices['Pixel 7'],deviceScaleFactor:1,viewport:{width:393,height:852}});
  await context.addInitScript(save=>{
    if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);
  },encodeEconomy(e));
  const page=await context.newPage();
  // Read-only scene access injected by the review tool; not a production hook.
  await page.route('**/src/game/game.ts*',async route=>{
    const response=await route.fetch(),body=await response.text();assert(body.includes('canSave = true;'));
    await route.fulfill({response,body:body.replace('canSave = true;','canSave = true; window.__farmReview = {scene};')});
  });
  const errors=await openGame(page,url);
  const resize=async size=>{
    const frames=(await snapshot(page)).frames;await page.setViewportSize(size);
    await page.waitForFunction(({frames,ratio})=>{const s=window.__DEMO__.snapshot();return s.frames>frames+1&&Math.abs(s.graphics.width/s.graphics.height-ratio)<.01;},
      {frames,ratio:size.width/size.height});
  };
  const measureCrops=async fixtures=>page.evaluate(async fixtures=>{
    const {createCropModel}=await import('/src/game/crop-model.ts');
    const {createPalette}=await import('/src/game/models.ts');
    const {Vector3}=await import('/node_modules/.vite/deps/@babylonjs_core.js');
    const scene=window.__farmReview.scene;
    const measure=meshes=>{
      const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let vertices=0;
      for(const mesh of meshes){
        mesh.computeWorldMatrix(true);vertices+=mesh.getTotalVertices();
        const positions=mesh.getVerticesData('position'),matrix=mesh.getWorldMatrix();
        for(let n=0;n<positions.length;n+=3){
          const p=Vector3.TransformCoordinates(Vector3.FromArray(positions,n),matrix);
          for(const [i,axis]of ['x','y','z'].entries()){
            min[i]=Math.min(min[i],p[axis]);max[i]=Math.max(max[i],p[axis]);
          }
        }
      }
      return {vertices,dimensions:max.map((v,i)=>v-min[i]),centerX:(min[0]+max[0])/2,centerZ:(min[2]+max[2])/2};
    };
    return fixtures.map(({id,kind,stage})=>{
      const plot=window.__DEMO__.snapshot().economy.plots.find(p=>p.id===id);
      const reference=new scene.constructor(scene.getEngine()),palette=createPalette(reference);
      // This unchanged source is the single crop used before the four-bed change.
      createCropModel(reference,palette,scene.getMaterialByName('carrot-orange'),kind,stage);
      const expected=measure(reference.meshes);
      const meshes=scene.meshes.filter(m=>m.metadata?.worldObjectId===id&&m.sourceMesh?.name.startsWith(`economy-template-${kind}-${stage}-`));
      const actual=measure(meshes);reference.dispose();
      return {id,kind,stage,actual,expected,plot:{x:plot.x,z:plot.z}};
    });
  },fixtures);
  const checkCrops=rows=>{
    for(const {id,actual,expected,plot} of rows){
      assert.equal(actual.vertices,expected.vertices,`${id}: exactly one crop geometry`);
      for(let i=0;i<3;i++)assert(Math.abs(actual.dimensions[i]-expected.dimensions[i])<1e-5,`${id}: original size on axis ${i}`);
      assert(Math.abs(actual.centerX-plot.x-expected.centerX)<1e-5,`${id}: centered x`);
      assert(Math.abs(actual.centerZ-plot.z-expected.centerZ)<1e-5,`${id}: centered z`);
    }
  };
  await page.locator('#settings').tap();
  const crops=await measureCrops(fixtures);
  await writeFile(`${out}/crop-sizes.json`,JSON.stringify(crops,null,2)+'\n');checkCrops(crops);
  await page.getByRole('button',{name:'继续游戏',exact:true}).tap();
  await panTo(page,{x:4.5,z:-5},true);
  await page.screenshot({path:`${out}/crops-mobile.png`});
  await resize({width:1280,height:800});
  await page.screenshot({path:`${out}/crops-desktop.png`});
  await resize({width:393,height:852});
  const choose=async(id,label)=>{
    const object=(await snapshot(page)).objects.find(o=>o.id===id);
    await page.touchscreen.tap(object.screen.x,object.screen.y);
    assert.equal((await snapshot(page)).selection.object.id,id);
    await expect(page.getByRole('button',{name:label,exact:true})).toBeVisible();
    await page.getByRole('button',{name:label,exact:true}).tap();
  };
  await choose('plot-8','种胡萝卜');
  await page.waitForFunction(()=>window.__DEMO__.snapshot().economy.plots.find(p=>p.id==='plot-8').crop==='carrot',null,{timeout:90000,polling:500});
  await page.locator('#settings').tap();
  const seedling=await measureCrops([{id:'plot-8',kind:'carrot',stage:0}]);checkCrops(seedling);
  await page.getByRole('button',{name:'继续游戏',exact:true}).tap();
  await page.screenshot({path:`${out}/sown-seedling.png`});
  await choose('plot-2','收获');
  await page.waitForFunction(()=>!window.__DEMO__.snapshot().economy.plots.find(p=>p.id==='plot-2').crop,null,{timeout:90000,polling:500});
  await page.screenshot({path:`${out}/harvested.png`});
  await choose('plot-7','拆除');await page.locator('#demolish-confirm').tap();
  await page.waitForFunction(()=>!window.__DEMO__.snapshot().economy.plots.some(p=>p.id==='plot-7'));
  await page.screenshot({path:`${out}/removed.png`});
  await page.locator('#settings').tap();await page.locator('#return-menu').tap();await page.reload();
  await page.locator('#continue-save').tap();
  await page.waitForFunction(()=>window.__DEMO__?.snapshot().frames>2,null,{timeout:90000});
  const saved=(await snapshot(page)).economy;
  assert.equal(saved.plots.find(p=>p.id==='plot-8').crop,'carrot');
  assert.equal(saved.plots.find(p=>p.id==='plot-2').crop,undefined);
  assert(!saved.plots.some(p=>p.id==='plot-7'));
  await panTo(page,{x:4.5,z:-5},true);await page.screenshot({path:`${out}/reloaded.png`});
  assert.deepEqual(errors,[]);
  await writeFile(`${out}/browser-results.json`,JSON.stringify({crops,seedling,sown:true,harvested:true,demolished:true,reloaded:true,errors},null,2)+'\n');
  console.log('Farm review passed: 6 original crop stages, freshly sown seedling, native harvest/demolition/save/reload.');
  await context.close();
}finally{await browser.close();}
