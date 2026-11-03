import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Measure a fresh game, including every fixed camp and native character clone.
// Heap bytes are browser allocations, not a claim about a phone's total memory.
const url=process.env.LOAD_REVIEW_URL || 'http://127.0.0.1:5175/';
const output=process.env.LOAD_REVIEW_OUTPUT || '/tmp/world-load-memory.json';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--enable-precise-memory-info']});
try {
  const page=await browser.newPage({viewport:{width:393,height:754},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.routeWebSocket(new URL(url).origin.replace(/^http/,'ws')+'/**',socket=>socket.close());
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  await page.goto(url);await page.locator('#loading[data-phase="menu"]').waitFor();
  await page.getByRole('button',{name:'开始游戏',exact:true}).click();
  const samples=[],start=Date.now();let finished=false;
  while(Date.now()-start<150000){
    const heap=await cdp.send('Runtime.getHeapUsage');
    const state=await page.evaluate(()=>({phase:document.querySelector('#loading')?.dataset.phase,ready:!!window.__DEMO__}));
    samples.push({time:Date.now()-start,...heap,...state});
    if(state.ready){finished=true;break;}
    await page.waitForTimeout(250);
  }
  assert(finished,'loading reaches the playable scene');
  const scene=await page.evaluate(()=>{const s=window.__DEMO__.snapshot();return {meshes:s.meshes,residents:s.residents.length,enemyCavalry:s.residents.filter(r=>r.id.startsWith('enemy-')&&r.role==='cavalry').length};});
  await cdp.send('HeapProfiler.collectGarbage');
  const retained=await cdp.send('Runtime.getHeapUsage');
  const report={url,viewport:{width:393,height:754},elapsed:Date.now()-start,peakHeap:Math.max(...samples.map(s=>s.usedSize)),
    peakBacking:Math.max(...samples.map(s=>s.backingStorageSize??0)),retained,scene,errors,samples};
  await writeFile(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,samples:samples.length}));assert.deepEqual(errors,[]);
} finally {await browser.close();}
