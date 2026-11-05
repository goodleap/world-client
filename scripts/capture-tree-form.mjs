import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Native GLB review only. Does not launch the game or publish environment assets.
const base=process.env.MAP_ART_URL||'http://127.0.0.1:5177';
const output=process.env.MAP_ART_OUTPUT||'studies/map-art/renders/tree-form';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage({viewport:{width:1200,height:820},deviceScaleFactor:1});
  page.setDefaultTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const open=async sample=>{
    await page.goto(`${base}/studies/map-art.html?sample=${sample}&capture`);
    await page.waitForFunction(()=>window.mapArt?.ready);
    await page.evaluate(()=>window.mapArt.engine.stopRenderLoop());
  };
  const capture=async(name,view)=>{
    await page.evaluate(view=>window.mapArt.frame(view),view);
    await page.screenshot({path:`${output}/${name}.png`});
  };
  await open('tree-compare');
  await capture('compare-front','front');
  await capture('compare-game','game');
  await page.setViewportSize({width:1000,height:820});
  await open('tree-form');
  await page.evaluate(()=>{window.mapArt.camera.alpha=-.8;window.mapArt.scene.render();});
  await page.screenshot({path:`${output}/study-quarter.png`});
  await capture('study-side','side');
  await page.evaluate(()=>{window.mapArt.camera.alpha=Math.PI/2;window.mapArt.scene.render();});
  await page.screenshot({path:`${output}/study-back.png`});
  await page.setViewportSize({width:390,height:740});
  await capture('study-mobile','game');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(`Model-only renders saved to ${output}; no browser errors.`);
}finally{await browser.close();}
