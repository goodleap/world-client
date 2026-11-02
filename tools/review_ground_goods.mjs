import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const dir='docs/compact-card-harvest/evidence'; await mkdir(dir,{recursive:true});
const views=process.argv.length>2?process.argv.slice(2):['front','side','game','mobile'];
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
try {
  for (const kind of ['carrot','wheat','wood','stone','iron','food']) {
    const page=await browser.newPage({viewport:{width:420,height:420}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:5174/studies/goods.html?kind=${kind}`);
    await page.waitForSelector('body[data-ready=true]');
    for (const view of views) {
      if (view==='mobile') await page.setViewportSize({width:150,height:170});
      await page.evaluate(view=>window.goodsReview.view(view),view);
      await page.screenshot({path:`${dir}/${kind}-${view}.png`});
    }
    console.log(JSON.stringify(await page.evaluate(()=>window.goodsReview.report)));
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }
} finally {await browser.close()}
