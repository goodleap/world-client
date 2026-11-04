import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { updateDangerZones } from '../src/game/danger-zones.ts';

const out=process.env.DANGER_REVIEW_DIR||'/tmp/world-danger-fix';
const url=process.env.DANGER_REVIEW_URL||'http://127.0.0.1:5176/';
const capture=process.env.DANGER_REVIEW_CAPTURE!=='0';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const reports=[];
try {
  for(const scenario of (process.env.DANGER_REVIEW_CASES||'farmers,dog').split(',')){
    const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
    updateDangerZones(e.state.dangerZones,[{id:'past-grove-guard',x:4,z:-4,radius:10}],0);
    const plots=['plot-2','plot-3','plot-4'];
    if(scenario==='farmers')for(const id of plots){
      const task=e.request('sow',id,'wheat','steward').task;assert(task);
      task.watchPath=[{x:e.plot(id).x,z:e.plot(id).z}];e.holdDanger(task);
    }
    else {
      // Actual refuge positions from the pre-fix browser reproduction. Nearby
      // farmers block every direct homeward stroll, but a detour exists.
      for(const [id,x,z] of [['dog',-10.82842712474619,-4],['farmer-leader',-9.92162701701816,-3.9208180061541498],
        ['farmer',-6.4852813742385695,6.485281374238571],['farmer-2',-5.949408690368967,6.099877699202137]])e.state.residents[id]={position:{x,z}};
    }
    const encoded=encodeEconomy(e);decodeEconomy(encoded);
    const page=await browser.newPage({viewport:{width:720,height:720},deviceScaleFactor:1}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    // Keep Vite's test-page socket open but isolated. Closing it makes the
    // dev client poll/reload and can invalidate a long software-WebGL capture.
    await page.routeWebSocket(/.*/,socket=>socket.send(JSON.stringify({type:'connected'})));
    await page.addInitScript(save=>{
      if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);
      localStorage.setItem('world-shadows-enabled','false');
    },encoded);
    await page.route('**/src/game/game.ts*',async route=>{
      const response=await route.fetch(),source=await response.text();assert(source.includes('canSave = true;'));
      await route.fulfill({response,body:source.replace('canSave = true;',`canSave = true;
        engine.stopRenderLoop(render);scene.useConstantAnimationDeltaTime=true;engine.getDeltaTime=()=>1000/60;
        window.__dangerReview={scene,engine,economy,raids,residents,save,ui,
          frame(){engine.beginFrame();render();engine.endFrame();engine.stopRenderLoop();},
          view(x,z,size){zoom=size;mapCenter.set(x,0,z);camera.target.copyFrom(mapCenter);},
          to(seconds){while(economy.state.seconds<seconds-1e-6){
            const dt=Math.min(.05,seconds-economy.state.seconds);
            residents.beginStep();wolves.beginStep(raids.wolves);ui.advanceSpeech(dt);
            controller.update(dt);raids.update(dt);combat.update(dt);residents.syncCombat(combat.state.units);
            residents.update(dt,undefined,dt);needs.update(dt);residents.endStep();
          }world.sync();refreshEconomy();residents.resetPresentation();freshFrame=true;this.frame();},
          read(){return {seconds:economy.state.seconds,oldZone:economy.state.dangerZones.find(z=>z.id==='area:4:-4')??null,
            people:residents.snapshot().filter(p=>['farmer','farmer-2','farmer-leader','dog'].includes(p.id)).map(p=>({
              id:p.id,position:p.position,renderPosition:p.renderPosition,speed:p.movementSpeed,motion:p.motion,
              pose:p.id==='dog'?p.pose:p.modelPose,travelled:p.travelled,evading:!!raids.state.evading[p.id],
              active:economy.active(p.id)?.status,canWork:raids.canWork(p.id)})),
            tasks:economy.state.tasks.map(t=>({id:t.id,target:t.target,status:t.status,danger:!!t.danger,progress:t.progress})),
            plots:economy.state.plots.map(p=>({id:p.id,crop:p.crop})),version:economy.state.version};}
        };`)});
    });
    const open=async()=>{
      await page.goto(url);await page.locator('#continue-save').click();
      await page.waitForFunction(()=>window.__dangerReview,null,{timeout:90000});
    };
    const read=()=>page.evaluate(()=>window.__dangerReview.read());
    try {
      await open();
      await page.evaluate(()=>window.__dangerReview.to(9.5));
      const waiting=await read();assert(waiting.oldZone);assert.equal(waiting.version,21);
      if(scenario==='farmers')assert(waiting.tasks.filter(t=>plots.includes(t.target)).every(t=>t.danger));
      else assert.equal(waiting.people.find(p=>p.id==='dog').travelled,0,'dog does not wander back into the cooling area');
      await page.evaluate(()=>window.__dangerReview.save());
      await page.reload();await page.locator('#continue-save').click();
      await page.waitForFunction(()=>window.__dangerReview,null,{timeout:90000});
      const reloaded=await read();assert.equal(reloaded.oldZone.safeSince,waiting.oldZone.safeSince);
      await page.evaluate(scenario=>{const r=window.__dangerReview;r.to(11);r.view(scenario==='dog'?-8:0,scenario==='dog'?-4:0,scenario==='dog'?4.3:12);r.frame();},scenario);
      const resumed=await read();assert.equal(resumed.oldZone,null);
      const dir=`${out}/${scenario}`;await mkdir(dir,{recursive:true});
      const samples=[];
      if(capture)for(let frame=0;frame<150;frame++){
        samples.push(await page.evaluate(()=>{window.__dangerReview.frame();return window.__dangerReview.read();}));
        await page.screenshot({path:`${dir}/${String(frame).padStart(4,'0')}.png`});
      }
      await page.evaluate(()=>window.__dangerReview.to(40));
      const finished=await read();assert(finished.people.every(p=>!p.evading));
      if(scenario==='farmers')for(const id of plots)assert.equal(finished.plots.find(p=>p.id===id).crop,'wheat',id+' automatically resumes and finishes sowing');
      else {
        const dog=finished.people.find(p=>p.id==='dog');
        assert(dog.travelled>5);assert(Math.hypot(dog.position.x+.5,dog.position.z+5.5)<5,'dog returns to its activity area');
      }
      if(capture){
        const moving=samples.flatMap(s=>s.people.filter(p=>(scenario==='dog'?p.id==='dog':p.id!=='dog')&&p.speed>.08));
        assert(moving.length>40,'continuous native movement is present');
        const result=spawnSync('ffmpeg',['-loglevel','error','-y','-framerate','60','-i',`${dir}/%04d.png`,
          '-frames:v',String(samples.length),'-c:v','libx264','-pix_fmt','yuv420p','-crf','20',`${out}/${scenario}.mp4`],{encoding:'utf8'});
        assert.equal(result.status,0,result.stderr);
      }
      assert.deepEqual(errors,[]);
      await page.screenshot({path:`${out}/${scenario}-finished.png`});
      const report={scenario,waiting,reloaded,resumed,finished,frames:samples.length,errors};reports.push(report);
      await writeFile(`${dir}/samples.json`,JSON.stringify(samples));
      await writeFile(`${out}/${scenario}-results.json`,JSON.stringify(report,null,2));
      console.log(`${scenario}: passed; save/reload, clearance and recovery verified; ${samples.length} consecutive native frames`);
    }catch(error){
      await page.screenshot({path:`${out}/${scenario}-failed.png`}).catch(()=>{});
      await writeFile(`${out}/${scenario}-failed.json`,JSON.stringify({error:String(error),snapshot:await read().catch(()=>null)},null,2));
      throw error;
    }
    finally{await page.close();}
  }
  await writeFile(`${out}/browser-results.json`,JSON.stringify({method:'Current production scene and controllers. Fixed-step fast-forward sets up each case; captured sequences use the unmodified production render loop at controlled 1/60 game seconds and native animation playback. Test-only scene hooks are not shipped.',reports},null,2));
}finally{await browser.close();}
