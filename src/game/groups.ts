import type { Economy, EconomyState } from './economy.ts';
import { livingResidents } from './recruitment.ts';
import { selectedUnitInfo } from './unit-info.ts';
import type { UnitInfo, UnitMovement } from './unit-info.ts';

export const GROUP_COUNT=4, GROUP_SIZE=6;
export const initialGroups=()=>Array.from({length:GROUP_COUNT},()=>[] as string[]);
export function groupMembers(state: EconomyState,index:number) {
  const alive=new Set(livingResidents(state).map(r=>r.id));return (state.groups[index]??[]).filter(id=>alive.has(id));
}
export function saveGroup(e: Economy,index:number,members:readonly string[]) {
  const alive=new Set(livingResidents(e.state).map(r=>r.id));
  if(!Number.isInteger(index)||index<0||index>=GROUP_COUNT||members.length>GROUP_SIZE||new Set(members).size!==members.length||members.some(id=>!alive.has(id)))return false;
  e.state.groups=e.state.groups.map((group,i)=>i===index?[...members]:group.filter(id=>!members.includes(id)));e.revision++;return true;
}
export function pruneGroups(e: Economy) {
  const groups=e.state.groups.map((_,i)=>groupMembers(e.state,i));
  if(groups.some((g,i)=>g.length!==e.state.groups[i].length)){e.state.groups=groups;e.revision++;}
}
export function groupInfo(e: Economy,index:number,movement:(id:string)=>UnitMovement):UnitInfo|undefined {
  const members=groupMembers(e.state,index),info=members.map(id=>selectedUnitInfo(e,id,movement(id))).filter(x=>!!x);
  if(!info.length)return;
  const activity=info.every(i=>i.activity===info[0].activity)?info[0].activity:'各自行动';
  return {id:`group-${index}`,activity,meters:info[0].meters.map((m,k)=>({...m,id:`group-${index}-${m.kind}`,
    value:info.reduce((sum,i)=>sum+i.meters[k].value,0),maximum:info.reduce((sum,i)=>sum+i.meters[k].maximum,0)}))};
}
