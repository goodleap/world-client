import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const base = process.env.MAP_ART_URL || 'http://127.0.0.1:5176';
const output = process.env.MAP_ART_OUTPUT || '/tmp/world-map-art';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const args=process.argv.slice(2),sheet=args.includes('--sheet');
const names = args.length ? args.filter(name=>name!=='--sheet') : ['oak'];
const results=[];
try {
  const page=await browser.newPage({ viewport:{width:1400,height:1000}, deviceScaleFactor:1 });
  page.setDefaultTimeout(90000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  for(const sample of names){
    await page.goto(`${base}/studies/map-art.html?sample=${sample}&capture`);
    await page.waitForFunction(()=>window.mapArt?.ready);
    await page.evaluate(()=>window.mapArt.scene.render());
    await page.screenshot({path:`${output}/${sample}.png`});
    results.push({sample,meshes:await page.evaluate(()=>window.mapArt.scene.meshes.length),errors:[...errors]});
    if(sample==='oak'){
      await page.evaluate(()=>window.mapArt.frame('side'));
      await page.screenshot({path:`${output}/oak-side.png`});
      await page.setViewportSize({width:390,height:740});
      await page.evaluate(()=>window.mapArt.frame('game'));
      await page.screenshot({path:`${output}/oak-mobile.png`});
      await page.setViewportSize({width:1400,height:1000});
    }
    if(sample==='creek'){
      await page.evaluate(()=>window.mapArt.focus([-.1,1,-.4],11.5));
      await page.screenshot({path:`${output}/creek-detail.png`});
      await page.setViewportSize({width:390,height:740});
      await page.evaluate(()=>window.mapArt.frame('game'));
      await page.screenshot({path:`${output}/creek-mobile.png`});
      await page.setViewportSize({width:1400,height:1000});
    }
    if(sample==='quarry'){
      await page.evaluate(()=>window.mapArt.focus([-4.5,1.6,3.1],8));
      await page.screenshot({path:`${output}/cliff-detail.png`});
    }
    console.log(JSON.stringify(results.at(-1)));
  }
  if(results.length){
    let previous=[];try{previous=JSON.parse(await readFile(`${output}/render-check.json`,'utf8'));}catch{/* first render */}
    await writeFile(`${output}/render-check.json`,JSON.stringify([...previous.filter(result=>!names.includes(result.sample)),...results],null,2));
  }
  if(errors.length)throw new Error(errors.join('\n'));
  if(sheet||['trees','forest','conifers','orchard','creek','wetland','quarry','ruins','camp'].every(name=>names.includes(name))){
    await page.setViewportSize({width:1800,height:1400});
    await page.goto(`${base}/studies/map-art/contact-sheet.html`);
    await page.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));
    await page.screenshot({path:`${output}/overview.png`,fullPage:true});
  }
}finally{await browser.close();}
