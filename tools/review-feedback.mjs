import {chromium} from 'playwright';import {mkdir,writeFile,cp} from 'node:fs/promises';
const out='docs/feedback-layout';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});const page=await browser.newPage({viewport:{width:1000,height:600}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
await page.goto('http://127.0.0.1:5174/studies/projectiles.html');await page.waitForFunction(()=>window.projectileReview?.snapshot().frames>3);await page.screenshot({path:out+'/arrow-phases.png'});
await page.evaluate(()=>window.projectileReview.sample(.15));await page.screenshot({path:out+'/attack-circle.png'});
await page.setViewportSize({width:390,height:650});await page.evaluate(()=>window.projectileReview.animate());const poses=[];for(let i=0;i<8;i++){await page.waitForTimeout(100);poses.push(await page.evaluate(()=>window.projectileReview.snapshot()));if(i===3)await page.screenshot({path:out+'/arrow-phone.png'});}
await writeFile(out+'/arrow-motion.json',JSON.stringify({poses,errors},null,2));console.log(JSON.stringify({frames:poses.map(p=>p.frames),errors}));await browser.close();
