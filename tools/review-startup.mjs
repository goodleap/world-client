import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
const out=process.env.AUDIT_OUT||'/tmp/world-startup';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--enable-precise-memory-info']});
const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const errors=[],navigation=[],crashes=[],requests=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('crash',()=>crashes.push(Date.now()));
page.on('framenavigated',f=>{if(f===page.mainFrame())navigation.push({time:Date.now(),url:f.url()});});
page.on('requestfailed',r=>requests.push({url:r.url(),error:r.failure()?.errorText}));
await page.addInitScript(({saving,shadows})=>{
  if(saving)localStorage.setItem('world-performance-mode','saving');
  if(!shadows)localStorage.setItem('world-shadows-enabled','false');
  const records=[],longTasks=[],events=[],contexts=[],live=new WeakMap();
  const state=gl=>{let s=live.get(gl);if(!s){s={buffers:new WeakMap(),bindings:new Map(),capacity:0,peak:0,created:0,deleted:0,shaderCompiles:0,programLinks:0};live.set(gl,s);contexts.push(s);}return s;};
  for(const C of [window.WebGLRenderingContext,window.WebGL2RenderingContext])if(C){
    for(const name of ['bindBuffer','bufferData','deleteBuffer','createBuffer','compileShader','linkProgram']){
      if(!Object.hasOwn(C.prototype,name))continue;
      const original=C.prototype[name];C.prototype[name]=function(...a){
        const result=Reflect.apply(original,this,a),s=state(this);
        if(name==='bindBuffer')s.bindings.set(a[0],a[1]);
        if(name==='createBuffer')s.created++;
        if(name==='bufferData'){
          const b=s.bindings.get(a[0]);let size=typeof a[1]==='number'?a[1]:a[1]?.byteLength??0;
          if(a[3]!==undefined&&typeof a[1]!=='number')size=(a[4]||a[1].length-a[3])*(a[1].BYTES_PER_ELEMENT||1);
          if(b){s.capacity+=size-(s.buffers.get(b)||0);s.buffers.set(b,size);s.peak=Math.max(s.peak,s.capacity);}
        }
        if(name==='deleteBuffer'&&a[0]){s.capacity-=s.buffers.get(a[0])||0;s.buffers.delete(a[0]);s.deleted++;}
        if(name==='compileShader')s.shaderCompiles++;
        if(name==='linkProgram')s.programLinks++;
        return result;
      };
    }
  }
  const read=()=>({t:performance.now(),phase:document.querySelector('#loading')?.dataset.phase,
    percent:document.querySelector('#loading-percent')?.textContent,stage:document.querySelector('#loading-description')?.textContent,
    heap:performance.memory?.usedJSHeapSize,heapTotal:performance.memory?.totalJSHeapSize,
    gl:contexts.map(({buffers,bindings,...s})=>s)});
  new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push({...read(),start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
  document.addEventListener('webglcontextlost',()=>events.push({type:'webglcontextlost',...read()}),true);
  document.addEventListener('webglcontextrestored',()=>events.push({type:'webglcontextrestored',...read()}),true);
  window.addEventListener('pagehide',()=>events.push({type:'pagehide',...read()}));
  window.addEventListener('pageshow',()=>events.push({type:'pageshow',...read()}));
  document.addEventListener('DOMContentLoaded',()=>{
    new MutationObserver(()=>records.push(read())).observe(document.querySelector('#loading-description'),{childList:true,characterData:true,subtree:true});
  });
  window.__loadAudit={read,records,longTasks,events};
},{saving:process.env.AUDIT_SAVING==='1',shadows:process.env.AUDIT_SHADOWS!=='0'});
const cdp=await page.context().newCDPSession(page),system=await browser.newBrowserCDPSession();
if(process.env.AUDIT_PROFILE==='1')await cdp.send('HeapProfiler.startSampling',{samplingInterval:32768});
const heap=[],processes=[];let done=false,processPoll;
try{
  await page.goto(process.env.AUDIT_URL||'http://127.0.0.1:5177/');
  await page.locator('#loading[data-phase="menu"]').waitFor();
  processPoll=(async()=>{while(!done){
    const list=await system.send('SystemInfo.getProcessInfo');
    for(const p of list.processInfo)if(['renderer','GPU'].includes(p.type)){
      try{const data=await readFile(`/proc/${p.id}/smaps_rollup`,'utf8');processes.push({t:Date.now(),type:p.type,pid:p.id,
        rssKB:Number(data.match(/^Rss:\s+(\d+)/m)?.[1]),pssKB:Number(data.match(/^Pss:\s+(\d+)/m)?.[1])});}catch{}
    }await new Promise(r=>setTimeout(r,200));
  }})();
  const start=Date.now();await page.getByRole('button',{name:'开始游戏',exact:true}).click();
  while(Date.now()-start<180000){
    const h=await cdp.send('Runtime.getHeapUsage'),r=await page.evaluate(()=>window.__loadAudit.read());heap.push({...r,...h});
    if(r.phase==='playing'||r.phase==='error')break;
    await page.waitForTimeout(150);
  }
  const ready=await page.evaluate(()=>window.__loadAudit.read());
  if(process.env.AUDIT_INVENTORY==='1'){
    const engineFile=(await readdir((process.env.AUDIT_DIST||'dist')+'/assets')).find(f=>/^engine-.*\.js$/.test(f));
    const inventory=await page.evaluate(async path=>{
      const mod=await import(path),Engine=Object.values(mod).find(v=>typeof v==='function'&&Array.isArray(v.Instances)&&v.LastCreatedScene);
      if(!Engine)return {error:'engine export unavailable'};
      const scene=Engine.LastCreatedScene,arrays=new Set(),buffers=new Set(),geometries=[];
      let plainBytes=0,typedBackingBytes=0;
      const count=data=>{if(!data||arrays.has(data))return 0;arrays.add(data);if(Array.isArray(data)){plainBytes+=data.length*8;return data.length*8;}
        if(ArrayBuffer.isView(data)&&!buffers.has(data.buffer)){buffers.add(data.buffer);typedBackingBytes+=data.buffer.byteLength;}return data.byteLength||0;};
      for(const g of scene.getGeometries()){
        let bytes=count(g.getIndices());
        for(const b of Object.values(g.getVertexBuffers()||{}))bytes+=count(b.getData());
        geometries.push({id:g.id,bytes,users:g.meshes.length,names:g.meshes.slice(0,3).map(m=>m.name)});
      }
      const animationNames={};for(const g of scene.animationGroups)animationNames[g.name]=(animationNames[g.name]||0)+1;
      return {meshes:scene.meshes.length,materials:scene.materials.length,geometries:scene.getGeometries().length,skeletons:scene.skeletons.length,
        animationGroups:scene.animationGroups.length,targetedAnimations:scene.animationGroups.reduce((sum,g)=>sum+g.targetedAnimations.length,0),
        animationNames,plainGeometryBytesEstimate:plainBytes,uniqueTypedBackingBytes:typedBackingBytes,largestGeometry:geometries.sort((a,b)=>b.bytes-a.bytes).slice(0,20),
        canvas:{width:scene.getEngine().getRenderWidth(),height:scene.getEngine().getRenderHeight()}};
    },'/assets/'+engineFile);
    await writeFile(`${out}/inventory.json`,JSON.stringify(inventory,null,2));
  }
  await page.screenshot({path:`${out}/finished.png`});
  const captured=await page.evaluate(()=>({records:window.__loadAudit.records,longTasks:window.__loadAudit.longTasks,events:window.__loadAudit.events,
    loadingItems:[...document.querySelectorAll('#loading-items li')].map(x=>x.textContent)}));
  await cdp.send('HeapProfiler.collectGarbage');const retained=await cdp.send('Runtime.getHeapUsage');
  if(process.env.AUDIT_PROFILE==='1')await writeFile(`${out}/allocations.json`,JSON.stringify(await cdp.send('HeapProfiler.stopSampling')));
  const report={build:process.env.AUDIT_BUILD||'working-tree',url:page.url(),viewport:{width:393,height:852,dpr:3},elapsed:Date.now()-start,ready,retained,heap,processes,...captured,errors,navigation,crashes,requests};
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  const summary={elapsed:report.elapsed,phase:ready.phase,peakHeap:Math.max(...heap.map(x=>x.usedSize)),peakBacking:Math.max(...heap.map(x=>x.backingStorageSize||0)),retained,
    peaksByProcess:['renderer','GPU'].map(type=>({type,rssKB:Math.max(...processes.filter(p=>p.type===type).map(p=>p.rssKB)),pssKB:Math.max(...processes.filter(p=>p.type===type).map(p=>p.pssKB))})),
    gl:ready.gl,largestTasks:captured.longTasks.sort((a,b)=>b.duration-a.duration).slice(0,8).map(t=>({duration:t.duration,percent:t.percent,stage:t.stage,heap:t.heap})),
    errors,navigations:navigation.length,crashes,requests};
  await writeFile(`${out}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
  if(ready.phase!=='playing'||errors.length||crashes.length||navigation.length!==1)throw new Error('Startup review failed; inspect summary.json and report.json');
}finally{done=true;if(processPoll)await processPoll.catch(()=>{});await browser.close();}
