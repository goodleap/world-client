import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { initialEconomy } from '../src/game/economy.ts';
const out=new URL('../docs/balance-watchtower',import.meta.url).pathname,frames='/tmp/world-death-cadence';
await mkdir(out,{recursive:true});await mkdir(frames,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:640,height:480}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  const state=initialEconomy(1234);state.steward.enabled=false;state.raids.nextAt=600;
  await page.addInitScript(state=>{localStorage.setItem('world-basic-economy-v1',JSON.stringify(state));localStorage.setItem('world-shadows-enabled','false');},state);
  await page.route('**/src/game/game.ts',async route=>{
    const response=await route.fetch(),source=await response.text();assert(source.includes('canSave = true;'));
    await route.fulfill({response,body:source.replace('canSave = true;',`canSave = true;engine.stopRenderLoop(render);scene.useConstantAnimationDeltaTime=true;engine.getDeltaTime=()=>1000/60;
      window.__deathReview={scene,engine,render,combat,residents,simulationClock,ui,economy,raids,wolves,mapCenter,loadingProgress,cavalryGeometryReads:0,setZoom:v=>zoom=v};`)});
  });
  await page.goto('http://127.0.0.1:5174/');await page.locator('#continue-save').click();
  await page.waitForFunction(()=>window.__deathReview,null,{timeout:90000});
  await page.evaluate(()=>{
    const r=window.__deathReview;r.engine.stopRenderLoop();r.mapCenter.set(-2,.5,-12);r.setZoom(10);
    for(const mesh of r.scene.getTransformNodeByName('cavalry-animal').getChildMeshes()){
      const read=mesh.getPositionData.bind(mesh);mesh.getPositionData=(...args)=>{r.cavalryGeometryReads++;return read(...args);};
    }
    const positions={infantry:{x:-6,z:-10},archer:{x:-2,z:-10},cavalry:{x:-8,z:-16},'enemy-guard':{x:2,z:-10},farmer:{x:2,z:-16},dog:{x:5,z:-14}};
    r.residents.restoreResidents(Object.fromEntries(Object.entries(positions).map(([id,position])=>[id,{position}])));
    for(const [id,position] of Object.entries(positions)){
      const u=r.combat.unit(id);if(u)u.position={...position};
      r.combat.hurt(id,10000,id==='enemy-guard'?'infantry':'enemy-sentry');
    }
    const wolf=r.raids.wolves[0];wolf.position={x:-2,z:-17};r.combat.hurt(wolf.id,10000,'infantry');
    r.residents.syncCombat(r.combat.state.units);
  });
  const samples=[];
  for(let frame=0;frame<352;frame++){
    const s=await page.evaluate(capture=>{
      const r=window.__deathReview;r.engine.stopRenderLoop();r.engine.beginFrame();r.render();r.engine.endFrame();r.engine.stopRenderLoop();
      const units=r.residents.snapshot().filter(u=>['infantry','archer','cavalry','enemy-guard','farmer','dog'].includes(u.id)).map(u=>({id:u.id,death:u.death}));
      units.push({id:r.raids.wolves[0].id,death:r.wolves.snapshot()[0].death});
      for(const u of units){
        const root=r.scene.getTransformNodeByName(u.id.startsWith('wolf-')?'wolf-pool-0':['cavalry','dog'].includes(u.id)?u.id+'-animal':u.id);
        const nodes=[root,...root.getChildTransformNodes(true).filter(n=>n.name.startsWith('fallen-'))];
        u.pose=nodes.flatMap(n=>[n.position.y,...(n.rotationQuaternion?.asArray()??[])]);
      }
      return {seconds:r.economy.state.seconds,time:r.economy.state.seconds-(1-r.simulationClock.alpha)*.05,units,
        png:capture?r.engine.getRenderingCanvas().toDataURL('image/png').split(',')[1]:undefined};
    },frame%2===0);
    if(s.png){await writeFile(`${frames}/${String(frame/2).padStart(3,'0')}.png`,Buffer.from(s.png,'base64'));delete s.png;}
    samples.push(s);
    if([12,13,14,180,181].includes(frame))await page.screenshot({path:`${out}/death-frame-${frame}.png`});
    if(frame===16){
      const frozen=JSON.stringify(s.units);
      await page.evaluate(()=>document.getElementById('settings').click());
      await page.waitForTimeout(150);
      const after=await page.evaluate(()=>window.__deathReview.residents.snapshot().filter(u=>['infantry','archer','cavalry','enemy-guard','farmer','dog'].includes(u.id)).map(u=>u.death));
      assert.deepEqual(after,s.units.slice(0,6).map(u=>u.death),'pause preserves the exact displayed death phase');
      assert(frozen.length);await page.evaluate(()=>{document.getElementById('continue-game').click();window.__deathReview.engine.stopRenderLoop();});
    }
  }
  const summary=samples[0].units.map(({id})=>{
    const result={id,fallFrames:0,fallChanges:0,sinkFrames:0,sinkChanges:0};
    for(let i=1;i<samples.length;i++){
      const before=samples[i-1],after=samples[i];if(after.time-before.time<.001)continue;
      const a=before.units.find(u=>u.id===id),b=after.units.find(u=>u.id===id);
      for(const phase of ['fall','sink'])if(a.death.phase===phase&&b.death.phase===phase&&a.death.age>.02){
        result[phase+'Frames']++;if(JSON.stringify(a.pose)!==JSON.stringify(b.pose))result[phase+'Changes']++;
      }
    }
    assert(result.fallFrames>25&&result.fallChanges===result.fallFrames,JSON.stringify(result));
    assert(result.sinkFrames>150&&result.sinkChanges===result.sinkFrames,JSON.stringify(result));
    assert.equal(samples.at(-1).units.find(u=>u.id===id).death.phase,'gone');return result;
  });
  assert.deepEqual(errors,[]);
  const video=spawnSync('ffmpeg',['-v','error','-framerate','30','-i',frames+'/%03d.png','-c:v','libx264','-crf','25','-pix_fmt','yuv420p','-y',out+'/death-cadence.mp4']);assert.equal(video.status,0,String(video.stderr));
  const preparation=await page.evaluate(()=>{
    const r=window.__deathReview,item=r.loadingProgress.snapshot().find(i=>i.id==='cavalry:death');
    return {cavalryGeometryReads:r.cavalryGeometryReads,preparedDuringLoadMs:item?.elapsedMs};
  });assert.equal(preparation.cavalryGeometryReads,0,'death never reskins cavalry geometry on the CPU');
  const report={method:'Actual game render loop with controlled 60 Hz delta and unchanged 20 Hz simulation; not a hardware FPS benchmark',summary,pause:'exact frozen pose',preparation,errors};
  await writeFile(out+'/death-cadence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
