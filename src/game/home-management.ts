import {effectiveFighterStats} from './combat.ts';
import type { GameUI } from '../ui.ts';
import type { Economy } from './economy.ts';
import { RESOURCE_NAMES } from './economy.ts';
import { recruit, cancelRecruit, RECRUIT_CONFIG, livingResidents, POPULATION_LIMIT, DOG_LIMIT } from './recruitment.ts';
import { GROUP_COUNT, GROUP_SIZE, groupMembers, saveGroup } from './groups.ts';
import { populationInfo } from './unit-info.ts';
import type { ResidentRole } from './resident-data.ts';
import { buildingList, buildingOperational, repairQuote } from './building-state.ts';
import { ECONOMY_CONFIG } from './economy-config.ts';

/** DOM-only management. Membership edits and recruitment never advance the simulation. */
export function createHomeManagement(e:Economy, ui:GameUI, callbacks:{save:()=>unknown;select:(index:number)=>void;rally:()=>void;demolish:(id:string)=>void}) {
  const get=(id:string)=>document.getElementById(id)!;
  const abort=new AbortController(), options={signal:abort.signal};
  let editing=0,filter='all',shortcutKey='',recruitKey='',populationKey='',buildingKey='';
  let selectedGroup:number|undefined;
  const button=(label:string,click:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.addEventListener('click',click,options);return b;};
  const notice=(message='')=>{get('group-notice').textContent=`已选 ${groupMembers(e.state,editing).length} / ${GROUP_SIZE}${message?` · ${message}`:''}`;};
  function edit(index=editing) {
    editing=index;notice();
    get('group-editor-tabs').replaceChildren(...Array.from({length:GROUP_COUNT},(_,i)=>{
      const b=button(`${i+1} 队`,()=>edit(i));b.setAttribute('aria-pressed',String(i===editing));return b;
    }));
    populationKey='';renderPopulation();
  }
  function renderPopulation() {
    const rows=populationInfo(e.state), key=JSON.stringify([rows,editing,filter]);
    if(key===populationKey)return;populationKey=key;
    notice();
    const focused=document.activeElement instanceof HTMLInputElement?document.activeElement.id:undefined;
    const humans=rows.filter(r=>r.role!=='dog').length;
    get('population-summary').textContent=`人口 ${humans} · 田园犬 ${rows.length-humans}`;
    get('group-candidates').replaceChildren(...rows.filter(r=>filter==='all'||r.role===filter).map(r=>{
      const row=document.createElement('tr'),check=document.createElement('td'),input=document.createElement('input');
      const name=document.createElement('th'),label=document.createElement('label');
      row.dataset.resident=r.id;name.scope='row';
      input.type='checkbox';input.value=r.id;input.id=`group-member-${r.id}`;input.checked=r.group===editing;
      input.setAttribute('aria-label',`将${r.name}编入 ${editing+1} 队`);
      label.htmlFor=input.id;label.textContent=r.name;label.title=r.name;
      input.addEventListener('change',()=>{
        const members=groupMembers(e.state,editing);
        if(input.checked&&members.length>=GROUP_SIZE){input.checked=false;notice('已达人数上限');return;}
        const next=input.checked?[...members,r.id]:members.filter(id=>id!==r.id);
        if(!saveGroup(e,editing,next)){input.checked=members.includes(r.id);notice('成员状态已变化');return;}
        callbacks.save();refresh(selectedGroup);
      },options);check.append(input);name.append(label);row.append(check,name);
      const value=(kind:string,text:string,low=false)=>{const cell=document.createElement('td');cell.dataset.stat=kind;cell.textContent=text;cell.classList.toggle('low',low);return cell;};
      const rank=value('level',r.progression?`${r.progression.level}级`:'—');
      if(r.progression){
        const {progress,required}=r.progression,experience=document.createElement('small');
        experience.dataset.stat='experience';experience.textContent=required?`${Math.floor(progress)}/${required}`:'满级';rank.append(experience);
        rank.title=required?`经验 ${Math.floor(progress)} / ${required}，造成实际伤害获得经验`:'已达最高等级';
      }
      row.append(rank,value('group',r.group===undefined?'—':`${r.group+1}队`),value('assignment',r.assignment));
      row.append(value('health',`${Math.ceil(r.health)}/${r.maxHealth}`,r.health/r.maxHealth<.3),
        value('stamina',`${Math.floor(r.stamina)}/${r.maxStamina}`,r.stamina/r.maxStamina<.3),
        value('combat',`${r.attack??'—'} / ${r.armor}`));
      return row;
    }));
    if(focused)document.getElementById(focused)?.focus({preventScroll:true});
  }
  function renderBuildings(){
    (get('auto-repair') as HTMLInputElement).checked=e.state.autoRepair;
    const rows=[...buildingList(e.state),...e.state.plots.map(p=>({id:p.id,name:'耕地',built:true,hp:0,maxHealth:0,armor:0}))],key=JSON.stringify([rows,e.state.tasks.map(t=>[t.target,t.kind,t.status,Math.floor(t.progress)]),e.available()]);
    if(key===buildingKey)return;buildingKey=key;
    get('building-summary').textContent=`建筑 ${rows.filter(b=>b.maxHealth).length} · 耕地 ${e.state.plots.length} · 受损 ${rows.filter(b=>b.built&&b.hp<b.maxHealth).length}`;
    get('building-rows').replaceChildren(...rows.map(b=>{
      const tr=document.createElement('tr');tr.dataset.building=b.id;
      const name=document.createElement('th');name.scope='row';name.textContent=b.name;name.title=b.id;
      const q=repairQuote(e.state,b.id),task=e.taskFor(b.id),repair=task?.kind==='repair';
      if(q&&!task){const cost=document.createElement('small');cost.textContent=`木${q.cost.wood} 石${q.cost.stone}`;name.append(cost);}
      const cell=(stat:string,value:string)=>{const td=document.createElement('td');td.dataset.stat=stat;td.textContent=value;return td;};
      const removing=task?.kind==='demolish';
      const status=removing?task.status==='working'?`拆除${Math.floor(task.progress/ECONOMY_CONFIG.workSeconds.demolish*100)}%`:'待拆除':!b.maxHealth?(e.plot(b.id)?.crop?'种植中':'空地'):!b.built?'建造中':repair?task.status==='working'?`维修${Math.floor(task.progress/ECONOMY_CONFIG.workSeconds.repair*100)}%`:'待维修':b.hp<=0?'已损毁':b.hp<b.maxHealth?'受损':'完好';
      tr.append(name,cell('health',b.maxHealth?b.built?`${Math.ceil(b.hp)}/${b.maxHealth}`:'—':'—'),cell('armor',b.maxHealth?String(b.armor):'—'),cell('status',status));
      tr.classList.toggle('damaged',b.built&&b.hp<b.maxHealth);
      const action=cell('action',''),control=button(repair?'取消':'维修',()=>{
        if(repair){e.cancel(task.id);get('building-notice').textContent='维修已取消，预留材料已释放';}
        else{const result=e.request('repair',b.id);get('building-notice').textContent=result.message;}
        callbacks.save();renderBuildings();
      });
      control.disabled=!repair&&!!task;control.setAttribute('aria-label',`${repair?'取消维修':'维修'}${b.name}`);if(!removing&&(repair||q))action.append(control);
      if(removing){const cancel=button('取消拆除',()=>{e.cancel(task.id);callbacks.save();renderBuildings();});action.append(cancel);}
      else if(e.demolition(b.id)){const remove=button('拆除',()=>callbacks.demolish(b.id));remove.setAttribute('aria-label',`拆除${b.name}`);action.append(remove);}
      tr.append(action);return tr;
    }));
  }
  get('auto-repair').addEventListener('change',()=>{
    e.setAutoRepair((get('auto-repair') as HTMLInputElement).checked);
    get('building-notice').textContent=e.state.autoRepair?'自动维修已开启，材料不足或区域危险时等待':'自动维修已关闭，已安排的任务可单独取消';
    callbacks.save();renderBuildings();
  },options);
  get('population-filters').replaceChildren(...Object.entries({all:'全部',farmer:'农民',infantry:'步兵',archer:'弓兵',cavalry:'骑兵',dog:'狗'}).map(([role,name])=>{
    const b=button(name,()=>{filter=role;for(const child of get('population-filters').children)child.setAttribute('aria-pressed',String((child as HTMLElement).dataset.role===role));renderPopulation();});
    b.dataset.role=role;b.setAttribute('aria-pressed',String(role===filter));return b;
  }));
  for(const tab of ['resources','population','buildings'])get(`${tab}-tab`).addEventListener('click',()=>{
    for(const kind of ['resources','population','buildings']){get(`${kind}-panel`).hidden=kind!==tab;get(`${kind}-tab`).setAttribute('aria-selected',String(kind===tab));}
    if(tab==='population')edit();
    if(tab==='buildings')renderBuildings();
  },options);
  get('home-resources').addEventListener('click',()=>{if(!get('population-panel').hidden)edit();if(!get('buildings-panel').hidden)renderBuildings();},options);
  get('clear-group').addEventListener('click',()=>{saveGroup(e,editing,[]);callbacks.save();edit();refresh(selectedGroup);},options);
  get('set-rally').addEventListener('click',()=>{ui.closeRecruitment();callbacks.rally();},options);
  function refresh(selected?:number) {
    selectedGroup=selected;
    if(!get('population-panel').hidden && get('resources-dialog').hasAttribute('open'))renderPopulation();
    if(!get('buildings-panel').hidden && get('resources-dialog').hasAttribute('open'))renderBuildings();
    const groups=e.state.groups.map((_,i)=>groupMembers(e.state,i));
    const key=JSON.stringify([groups,selected]);
    if(key!==shortcutKey){shortcutKey=key;get('group-shortcuts').replaceChildren(...groups.flatMap((ids,i)=>{
      if(!ids.length)return[];const b=button(String(i+1),()=>callbacks.select(i));b.dataset.group=String(i);
      b.setAttribute('aria-label',`${i+1} 队，${ids.length} 名`);b.setAttribute('aria-pressed',String(selected===i));
      const count=document.createElement('small');count.textContent=String(ids.length);b.append(count);return[b];
    }));}
    const alive=livingResidents(e.state),queue=e.state.recruitment.queue;
    const humans=alive.filter(r=>r.role!=='dog').length,dogs=alive.length-humans;
    const centerOpen=buildingOperational(e.state,'home-center');
    const nextKey=JSON.stringify([e.available(),e.state.upgrades.arms,humans,dogs,centerOpen,queue.map(q=>[q.serial,q.role,Math.floor(q.elapsed)])]);
    if(nextKey===recruitKey)return;recruitKey=nextKey;
    get('recruit-capacity').textContent=`人口 ${humans} / ${POPULATION_LIMIT} · 田园犬 ${dogs} / ${DOG_LIMIT} · 排队 ${queue.length}`;
    get('recruit-options').replaceChildren(...Object.entries(RECRUIT_CONFIG).map(([role,config])=>{
      const cost=Object.entries(config.cost).map(([kind,amount])=>`${RESOURCE_NAMES[kind as keyof typeof RESOURCE_NAMES]} ${amount}`).join(' · ');
      const row=document.createElement('div');row.className='recruit-row';row.dataset.recruit=role;
      const name=document.createElement('div');name.className='recruit-unit';
      const title=document.createElement('strong'),stats=document.createElement('small');title.textContent=config.name;
      const combat=role==='infantry'||role==='archer'||role==='cavalry'?effectiveFighterStats({role,team:'home',experience:0},e.state.upgrades.arms):undefined;
      stats.textContent=`生命 ${combat?.hp??(role==='dog'?80:100)} · 攻 ${combat?.attack??'—'} · 防 ${combat?.armor??0}`;name.append(title,stats);
      const detail=document.createElement('small');detail.className='recruit-cost';detail.textContent=`${cost} · ${config.seconds} 秒`;
      const count=document.createElement('span');count.className='recruit-count';count.textContent=`排队 ${queue.filter(q=>q.role===role).length}`;
      const b=button('招募',()=>{const result=recruit(e,role as ResidentRole);get('recruit-notice').textContent=result.message;callbacks.save();refresh(selected);});
      b.setAttribute('aria-label',`招募${config.name}`);b.disabled=!centerOpen;
      name.append(detail);row.append(name,count,b);return row;
    }));
    get('recruit-queue').replaceChildren(...queue.map((q,i)=>{
      const row=document.createElement('li'),text=document.createElement('span'),progress=document.createElement('progress'),config=RECRUIT_CONFIG[q.role];
      text.textContent=`${config.name} · ${i?'等待':q.elapsed===config.seconds?'等待出口空位':`${Math.floor(q.elapsed)} / ${config.seconds} 秒`}`;
      progress.max=config.seconds;progress.value=q.elapsed;
      row.append(text,progress,button('取消',()=>{cancelRecruit(e,q.serial);get('recruit-notice').textContent='已取消招募，材料已退还';callbacks.save();refresh(selected);}));return row;
    }));
  }
  return {refresh,open(){refresh();ui.openRecruitment();},dispose(){abort.abort();}};
}
