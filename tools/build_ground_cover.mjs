/** Author a small shared cutout atlas. Chromium rasterizes the SVG offline;
 * the game loads only the finished PNG, never paints flowers at startup. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync, crc32 } from 'node:zlib';

const destination='src/assets/environment';
const gradients=`<defs>
 <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b2ce67"/><stop offset="1" stop-color="#7eaa4e"/></linearGradient>
 <radialGradient id="cream" cx=".38" cy=".28" r=".85"><stop stop-color="#fff8db"/><stop offset="1" stop-color="#e9cb84"/></radialGradient>
 <radialGradient id="pink" cx=".38" cy=".28" r=".85"><stop stop-color="#f7d1e6"/><stop offset="1" stop-color="#d98fba"/></radialGradient>
 <radialGradient id="gold" cx=".38" cy=".28" r=".85"><stop stop-color="#ffe39a"/><stop offset="1" stop-color="#e7b452"/></radialGradient>
 <radialGradient id="heart" cx=".35" cy=".25" r=".8"><stop stop-color="#f6d86d"/><stop offset="1" stop-color="#c99737"/></radialGradient>
</defs>`;
function flower(x,y,r,color,tilt=0){
 let petals='';
 for(let i=0;i<5;i++)petals+=`<ellipse cx="0" cy="${-r*.58}" rx="${r*.45}" ry="${r*.67}" fill="url(#${color})" transform="rotate(${i*72})"/>`;
 return `<g transform="translate(${x} ${y}) rotate(${tilt})">${petals}<circle r="${r*.27}" fill="url(#heart)"/><ellipse cx="${-r*.055}" cy="${-r*.075}" rx="${r*.095}" ry="${r*.065}" fill="#ffe79c"/></g>`;
}
function cluster(blooms,primary){
 let stems='',heads='';
 for(const [i,b] of blooms.entries()){
  const [x,y,r]=b,rootX=x+(i%2?9:-7),rootY=y+55+r*.35;
  stems+=`<path d="M${rootX} ${rootY} Q${x-9} ${y+26} ${x} ${y}" fill="none" stroke="#87ab55" stroke-width="4" stroke-linecap="round"/>
   <path d="M${rootX} ${rootY-5} Q${rootX-26} ${rootY-9} ${rootX-25} ${rootY-23} Q${rootX-8} ${rootY-23} ${rootX} ${rootY-5}Z" fill="url(#leaf)"/>
   <path d="M${rootX} ${rootY-15} Q${rootX+7} ${rootY-34} ${rootX+24} ${rootY-32} Q${rootX+20} ${rootY-15} ${rootX} ${rootY-15}Z" fill="url(#leaf)"/>`;
  heads+=flower(x,y,r,i===blooms.length-1?'gold':primary,(i-1)*13);
 }
 return stems+heads;
}
function grass(){
 return [[35,144,95],[67,94,109],[102,60,119],[143,80,130],[180,115,144],[213,158,153]].map(([x,y,root],i)=>
  `<path d="M${root-5} 221 Q${root-12} ${y+46} ${x} ${y} Q${x+17} ${y+13} ${x+22} ${y+34} Q${root+4} ${y+71} ${root+7} 221Z" fill="${i%2?'url(#leaf)':'#9bbf59'}"/>`).join('');
}
const cells=[grass(),cluster([[93,70,28],[162,113,24],[65,141,22]],'cream'),
 cluster([[144,56,25],[75,98,27],[172,140,23],[91,151,19]],'cream'),
 cluster([[84,60,25],[159,83,28],[61,131,21],[131,149,25],[194,146,18]],'pink')];
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${gradients}${cells.map((c,i)=>`<g transform="translate(${i%2*256} ${Math.floor(i/2)*256})">${c}</g>`).join('')}</svg>`;
await mkdir(destination,{recursive:true});await writeFile(`${destination}/ground-cover.svg`,svg+'\n');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--disable-dev-shm-usage']});
try{
 const page=await browser.newPage();
 const pixels=Buffer.from(await page.evaluate(async source=>{
  const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(source);await img.decode();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return Array.from(ctx.getImageData(0,0,512,512).data);
 },svg));
 // Preserve colored RGB in transparent padding. Black transparent texels
 // otherwise leak into bilinear/mipmap samples as a dark cutout outline.
 let filled=Uint8Array.from({length:512*512},(_,i)=>Number(pixels[i*4+3]>0));
 for(let pass=0;pass<12;pass++){
  const next=filled.slice(),source=Buffer.from(pixels);
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){
   const i=y*512+x;if(filled[i])continue;
   const neighbors=[x>0?i-1:-1,x<511?i+1:-1,y>0?i-512:-1,y<511?i+512:-1].filter(j=>j>=0&&filled[j]);
   if(!neighbors.length)continue;next[i]=1;
   for(let c=0;c<3;c++)pixels[i*4+c]=Math.round(neighbors.reduce((sum,j)=>sum+source[j*4+c],0)/neighbors.length);
  }
  filled=next;
 }
 function chunk(name,data){
  const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,crc]);
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(512,0);header.writeUInt32BE(512,4);header[8]=8;header[9]=6;
 const rows=Buffer.alloc(512*(512*4+1));for(let y=0;y<512;y++)pixels.copy(rows,y*(512*4+1)+1,y*512*4,(y+1)*512*4);
 await writeFile(`${destination}/ground-cover.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]));
 console.log('Published 512×512 ground-cover atlas: grass and three wildflower clusters.');
}finally{await browser.close();}
