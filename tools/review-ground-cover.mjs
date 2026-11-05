import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=process.env.COVER_REVIEW_OUTPUT||'/tmp/flat-ground-cover';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:720,height:360}}),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text().slice(0,1000));}});
 await page.route('**/cover-review*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><script type="module" src="/studies/map-art/ground-cover-review.ts"></script></body></html>'}));
 for(const view of ['game','side']){
  await page.goto(`http://127.0.0.1:5177/cover-review${view==='side'?'?side':''}`);
  try{await page.waitForFunction(()=>window.coverReviewReady,null,{timeout:15000});}
  catch(error){console.error(await page.evaluate(()=>({stage:window.coverReviewStage,body:document.body.innerHTML.slice(0,300)})));throw error;}
  await page.waitForTimeout(200);
  await page.screenshot({path:`${out}/${view}.png`});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({out,errors}));
}finally{await browser.close();}
