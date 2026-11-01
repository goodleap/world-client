import { chromium } from '@playwright/test';
const browser = await chromium.launch({executablePath: '/usr/bin/chromium', args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
try {
 for (const [name, query, size] of [
  ['off','state=off'], ['lit','state=lit'], ['cooking','state=cooking'], ['side','state=cooking&side'],
  ['night','state=lit&night'], ['mobile','state=cooking&mobile',{width:412,height:915}],
  ['door-closed','door'],['door-open','door&open'],
 ]) {
  const page=await browser.newPage({viewport:size??{width:960,height:640}});
  page.on('pageerror',e=>{throw e});
  await page.goto(`http://127.0.0.1:5175/studies/campfire.html?${query}`);
  await page.waitForSelector('body[data-ready=true]');
  await page.screenshot({path:`docs/campfire/evidence/${name}.png`});
  await page.close();
 }
} finally { await browser.close(); }
