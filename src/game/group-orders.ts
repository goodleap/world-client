import type { Point } from './movement.ts';

/** Loose destination slots, not a rigid marching formation. Larger bodies get
 * sufficient clearance; each unit still uses the existing obstacle-aware route. */
export function groupDestinations(units:readonly {id:string;position:Point;radius:number}[],point:Point) {
  if(!units.length)return[];
  if(units.length===1)return[{id:units[0].id,point:{x:point.x,z:point.z}}];
  const spacing=Math.max(...units.map(u=>u.radius))*2+.35,columns=Math.min(3,Math.ceil(Math.sqrt(units.length)));
  const rows=Math.ceil(units.length/columns),center=units.reduce((p,u)=>({x:p.x+u.position.x/units.length,z:p.z+u.position.z/units.length}),{x:0,z:0});
  const angle=Math.atan2(point.x-center.x,point.z-center.z),cos=Math.cos(angle),sin=Math.sin(angle);
  const slots=units.map((_,i)=>{const row=Math.floor(i/columns),count=Math.min(columns,units.length-row*columns);
    const x=(i%columns-(count-1)/2)*spacing,z=(row-(rows-1)/2)*spacing;
    return{x:point.x+x*cos+z*sin,z:point.z-x*sin+z*cos};});
  const available=[...units],result:{id:string;point:Point}[]=[];
  for(const slot of slots){available.sort((a,b)=>Math.hypot(a.position.x-slot.x,a.position.z-slot.z)-Math.hypot(b.position.x-slot.x,b.position.z-slot.z));result.push({id:available.shift()!.id,point:slot});}
  return result;
}
