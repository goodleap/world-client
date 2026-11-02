import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const out=new URL('../docs/performance-tower',import.meta.url).pathname;await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:900,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const readings=[];
for(const view of ['front','side','iso']){await page.goto('http://127.0.0.1:5174/studies/tower.html?view='+view);await page.waitForFunction(()=>window.towerReview?.().frames>2);await page.screenshot({path:`${out}/tower-${view}.png`});readings.push({view,...await page.evaluate(()=>window.towerReview())});}
await page.setViewportSize({width:390,height:650});await page.goto('http://127.0.0.1:5174/studies/tower.html?view=iso');await page.waitForFunction(()=>window.towerReview?.().frames>2);await page.screenshot({path:out+'/tower-phone.png'});
await writeFile(out+'/model-readings.json',JSON.stringify({readings,errors},null,2));console.log(JSON.stringify({readings,errors}));await browser.close();
