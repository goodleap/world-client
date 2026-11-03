import { BUILDINGS } from './world-data.ts';
import type { EconomyState, Inventory } from './economy.ts';

/** Trial durability and armor; storage contents remain a separate account. */
export const BUILDING_STATS = {
  house: { name:'民房',hp:600,armor:8,wood:6,stone:4 },
  warehouse: { name:'仓库',hp:1000,armor:12,wood:12,stone:8 },
  center: { name:'家园中心',hp:1500,armor:15,wood:20,stone:16 },
  tower: { name:'哨塔',hp:500,armor:10,wood:10,stone:6 },
  campfire: { name:'火堆',hp:200,armor:2,wood:0,stone:4 },
} as const;
export type StructureKind=keyof typeof BUILDING_STATS;
export function buildingInfo(state:EconomyState,id:string){
  const fixed=BUILDINGS.find(b=>b.id===id),site=state.sites.find(s=>s.id===id);
  if(!fixed&&(!site||site.kind==='farm'))return;
  const kind:StructureKind=fixed?(id==='home-center'?'center':id==='warehouse'?'warehouse':'house'):site!.kind as StructureKind;
  const config=BUILDING_STATS[kind],built=!!fixed||state.buildings.includes(id),shape=(fixed??site)!;
  const hp=built?(kind==='tower'?state.towers.find(t=>t.id===id)?.hp??config.hp:state.buildingHealth[id]??config.hp):0;
  return {id,kind,name:id==='cottage'?'暖阳小屋':config.name,x:shape.x,z:shape.z,width:shape.width,depth:shape.depth,
    built,hp,maxHealth:config.hp,armor:config.armor};
}
export function buildingList(state:EconomyState){
  return [...BUILDINGS.map(b=>b.id),...state.sites.filter(s=>s.kind!=='farm').map(s=>s.id)]
    .map(id=>buildingInfo(state,id)!);
}
export function buildingOperational(state:EconomyState,id:string){const b=buildingInfo(state,id);return !!b?.built&&b.hp>0;}
export function setBuildingHealth(state:EconomyState,id:string,hp:number){
  const b=buildingInfo(state,id);if(!b?.built)return;
  const value=Math.max(0,Math.min(b.maxHealth,hp));
  if(b.kind==='tower'){const tower=state.towers.find(t=>t.id===id);if(tower)tower.hp=value;}
  else if(value===b.maxHealth)delete state.buildingHealth[id];else state.buildingHealth[id]=value;
}
export function repairQuote(state:EconomyState,id:string){
  const b=buildingInfo(state,id);if(!b?.built||b.hp>=b.maxHealth)return;
  return repairAmount(b.kind,b.maxHealth-b.hp);
}
export function repairAmount(kind:StructureKind,hp:number){
  const config=BUILDING_STATS[kind],ratio=hp/config.hp;
  const cost:Inventory={wood:Math.ceil(config.wood*ratio),stone:Math.ceil(config.stone*ratio),food:0,iron:0};
  return {hp,cost};
}
export function validateBuildingHealth(state:EconomyState,raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('建筑生命存档无效');
  for(const [id,hp] of Object.entries(raw)){
    const b=buildingInfo(state,id);
    if(!b?.built||b.kind==='tower'||typeof hp!=='number'||!Number.isFinite(hp)||hp<0||hp>b.maxHealth)throw new Error('建筑生命存档无效');
  }
  state.buildingHealth={...raw as Record<string,number>};
}
