import type { Economy } from './economy.ts';
import { recruit,cancelRecruit } from './recruitment.ts';
import { saveGroup } from './groups.ts';
import type { ResidentRole } from './resident-data.ts';
export type HomeAction={type:'group';index:number;members:string[]}|{type:'repair';id:string}|{type:'cancel';id:number}|{type:'autoRepair';enabled:boolean}|{type:'recruit';role:ResidentRole}|{type:'cancelRecruit';serial:number};
export function applyHomeAction(e:Economy,action:HomeAction):string{
  switch(action.type){
    case 'group':return saveGroup(e,action.index,action.members)?'':'成员状态已变化';
    case 'repair':return e.request('repair',action.id).message;
    case 'cancel':e.cancel(action.id);return '已取消，预留材料已释放';
    case 'autoRepair':e.setAutoRepair(action.enabled);return action.enabled?'自动维修已开启，材料不足或区域危险时等待':'自动维修已关闭，已安排的任务可单独取消';
    case 'recruit':return recruit(e,action.role).message;
    case 'cancelRecruit':cancelRecruit(e,action.serial);return '已取消招募，材料已退还';
  }
}
