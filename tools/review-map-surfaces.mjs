import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { LANDSCAPE, GRID_SIZE } from '../src/game/world-data.ts';
import { RESOURCE_NODES } from '../src/game/economy-config.ts';
import { surfaceHeight } from '../src/game/terrain-height.ts';
import { Economy } from '../src/game/economy.ts';

const base=process.env.MAP_REVIEW_URL||'http://127.0.0.1:5177/';
const out=process.env.MAP_REVIEW_OUTPUT||'/tmp/map-surfaces';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const errors=[];
try {
 const mobile=!!process.env.MAP_MOBILE;
 const page=await browser.newPage({viewport:mobile?{width:390,height:740}:{width:1100,height:760},isMobile:mobile,hasTouch:mobile});
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message.slice(0,400));});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text().slice(0,400));}});
 await page.route('**/src/game/game.ts*',async route=>{
  const response=await route.fetch(),source=await response.text();assert(source.includes('canSave = true;'));
  await route.fulfill({response,body:source.replace('canSave = true;',`canSave = true;
   engine.stopRenderLoop();
   window.__surfaceReview={scene,engine,world,economy,camera,residents,controller,
     frame(){engine.beginFrame();render();engine.endFrame();engine.stopRenderLoop();},
     view(x,z,size){setPreview();overview=false;zoom=currentZoom=size;mapCenter.set(x,.5,z);camera.target.copyFrom(mapCenter);applyProjection();}};`)});
 });
 await page.goto(base);await page.locator('#loading[data-phase="menu"]').waitFor({timeout:90000});
 await page.locator('#start-game').click();
 await page.waitForFunction(()=>window.__surfaceReview,null,{timeout:120000});
 await page.locator('#loading[data-phase="playing"]').waitFor();await page.waitForTimeout(600);
 await page.evaluate(()=>window.__surfaceReview.economy.setLeadership(false));
 const meadow=LANDSCAPE.regions.find(r=>r.id==='meadow');
 const views=[{name:'cliff',x:-6*GRID_SIZE,z:11*GRID_SIZE,size:7},
  {name:'road-slope',x:7*GRID_SIZE,z:13*GRID_SIZE,size:7},
  {name:'meadow',x:meadow.x,z:meadow.z,size:5},
  {name:'home',x:0,z:0,size:12}];
 const chosen=process.argv.slice(2);
 for(const v of views.filter(v=>!chosen.length||chosen.includes(v.name))){
  await page.evaluate(v=>{const r=window.__surfaceReview;r.view(v.x,v.z,v.size);for(let i=0;i<16;i++)r.frame();},v);
  await page.screenshot({path:`${out}/${v.name}.png`,scale:'css'});
 }
 const interactions=[];
 if(process.env.MAP_CHECK_INTERACTIONS){
  const e=new Economy();
  for(const kind of ['food','stone']){
   const node=RESOURCE_NODES.filter(n=>n.kind===kind&&n.scale>1.3&&!e.regionLocked(n)).sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];assert(node);
   await page.evaluate(n=>{const r=window.__surfaceReview;r.view(n.x,n.z,4);for(let i=0;i<8;i++)r.frame();},node);
   const s=await page.evaluate(()=>window.__DEMO__.snapshot()),vp=page.viewportSize(),scale=vp.height/(2*s.camera.zoom),y=surfaceHeight(node.x,node.z)+(kind==='food'?.65:.45)*node.scale;
   const x=vp.width/2+(node.x-s.camera.target.x)*scale;
   const sy=vp.height/2+((s.camera.target.y-y)*Math.sin(s.camera.beta)-(node.z-s.camera.target.z)*Math.cos(s.camera.beta))*scale;
   if(mobile)await page.touchscreen.tap(x,sy);else await page.mouse.click(x,sy);
   await page.evaluate(()=>window.__surfaceReview.frame());
   assert.equal(await page.evaluate(()=>window.__DEMO__.snapshot().selection.object?.id),node.id);
   const action=kind==='food'?'gather':'mine',button=page.locator(`#selection-actions button[data-action="${action}"]`);
   assert(await button.isEnabled());await page.screenshot({path:`${out}/selected-${kind}.png`,scale:'css'});
   if(mobile)await button.tap();else await button.click();
   const task=await page.evaluate(id=>window.__surfaceReview.economy.taskFor(id),node.id);assert.equal(task?.kind,action);
   interactions.push({id:node.id,kind:task.kind,selected:true,command:true});
  }
  assert.equal(await page.locator('.north').count(),0);
 }
 const snapshot=await page.evaluate(()=>window.__DEMO__.snapshot());
 if(process.env.MAP_EXPORT_TEXTURES){
  const textures=await page.evaluate(()=>window.__surfaceReview.scene.textures.filter(t=>t.getContext&&t.name.startsWith('woodland-')).map(t=>({name:t.name,png:t.getContext().canvas.toDataURL('image/png').split(',')[1]})));
  await mkdir(process.env.MAP_EXPORT_TEXTURES,{recursive:true});
  for(const t of textures)await writeFile(`${process.env.MAP_EXPORT_TEXTURES}/${t.name}.png`,Buffer.from(t.png,'base64'));
 }
 await writeFile(`${out}/review.json`,JSON.stringify({errors,interactions,objects:snapshot.objects,camera:snapshot.camera,rendering:snapshot.rendering},null,2));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({output:out,errors,objects:snapshot.objects.length,interactions}));
}finally{await browser.close();}
