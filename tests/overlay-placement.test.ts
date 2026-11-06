import test from 'node:test';
import assert from 'node:assert/strict';
import { createDamageNumbers } from '../src/game/damage-numbers.ts';
import type { OverlayLabel } from '../src/game/overlay-host.ts';
test('simultaneous and recycled damage numbers remain hidden until their own placement is ready',()=>{
  const labels:OverlayLabel[]=[];
  const feedback=createDamageNumbers({create(){const label={textContent:'',hidden:true,style:{transform:'',opacity:''},classList:{toggle(){}},remove(){}};labels.push(label);return label;},remove(){}});
  const hit={target:'one',amount:2.4,team:'home' as const,point:{x:0,y:1,z:0}};
  feedback.add(hit,0,true);feedback.add({...hit,target:'two'},0,true);
  assert.equal(labels.length,2);assert(labels.every(n=>n.hidden));
  feedback.update(.1,()=>({x:100,y:200,visible:true}));assert(labels.every(n=>!n.hidden&&n.style.transform));
  feedback.update(1,()=>({x:100,y:200,visible:true}));feedback.add({...hit,target:'three',amount:20.8},1,true);
  assert(labels[0].hidden);assert.equal(labels[0].textContent,'21');assert.equal(labels[0].style.opacity,'0');
  feedback.update(1,()=>({x:350,y:450,visible:true}));assert(!labels[0].hidden);assert.match(labels[0].style.transform,/350/);
});
