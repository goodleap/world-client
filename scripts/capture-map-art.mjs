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
    if(sample==='trees'){
      const measured=await page.evaluate(()=>{
        const roots=window.mapArt.scene.transformNodes.filter(root=>/^oak(?:-small|-large)?-\d+$/.test(root.name));
        return roots.map(root=>{
          const crown=root.getChildMeshes().find(mesh=>(mesh.metadata??mesh.sourceMesh?.metadata)?.gltf?.extras?.treePart==='crown');
          const p=crown.getVerticesData('position'),indices=crown.getIndices(),vertices=new Map(),parent=[];
          const vertexIds=[];
          for(let i=0;i<p.length;i+=3){
            const key=p.slice(i,i+3).map(value=>Math.round(value*100000)).join(',');
            if(!vertices.has(key)){vertices.set(key,parent.length);parent.push(parent.length);}
            vertexIds.push(vertices.get(key));
          }
          const find=id=>{while(parent[id]!==id){parent[id]=parent[parent[id]];id=parent[id];}return id;};
          for(let i=0;i<indices.length;i+=3){const first=find(vertexIds[indices[i]]);parent[find(vertexIds[indices[i+1]])]=first;parent[find(vertexIds[indices[i+2]])]=first;}
          crown.computeWorldMatrix(true);
          const matrix=crown.getWorldMatrix().m;
          let radius=0,top=0,bottom=Infinity;
          for(let i=0;i<p.length;i+=3){
            const x=p[i]*matrix[0]+p[i+1]*matrix[4]+p[i+2]*matrix[8]+matrix[12]-root.position.x;
            const y=p[i]*matrix[1]+p[i+1]*matrix[5]+p[i+2]*matrix[9]+matrix[13]-root.position.y;
            const z=p[i]*matrix[2]+p[i+1]*matrix[6]+p[i+2]*matrix[10]+matrix[14]-root.position.z;
            radius=Math.max(radius,Math.hypot(x,z));top=Math.max(top,y);bottom=Math.min(bottom,y);
          }
          const size=root.name.includes('small')?'small':root.name.includes('large')?'large':'medium';
          const extras=(crown.metadata??crown.sourceMesh?.metadata).gltf.extras;
          return{size,lobes:new Set(parent.map((_,i)=>find(i))).size,primaryLobes:extras.primaryLobeCount,infillLobes:extras.infillLobeCount,diameter:radius*2,bareTrunkFraction:bottom/top};
        });
      });
      for(const tree of measured){
        const [primary,infill,diameter]=({small:[5,1,1],medium:[9,2,1.5],large:[14,3,2]})[tree.size];
        if(tree.lobes!==primary+infill||tree.primaryLobes!==primary||tree.infillLobes!==infill||Math.abs(tree.diameter-diameter)>.0001||tree.bareTrunkFraction>.32)throw new Error(`Tree dimensions differ from the review brief: ${JSON.stringify(tree)}`);
      }
      if(measured.length!==3)throw new Error('Three tree sizes must be visible in the review');
      results.at(-1).trees=measured;
      for(const [suffix,angle] of [['quarter',Math.PI/4],['side',Math.PI/2],['back',Math.PI]]){
        await page.evaluate(angle=>{
          for(const root of window.mapArt.scene.transformNodes)if(/^oak(?:-small|-large)?-\d+$/.test(root.name))root.rotation.y=angle;
          window.mapArt.scene.render();
        },angle);
        await page.screenshot({path:`${output}/trees-${suffix}.png`});
      }
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
