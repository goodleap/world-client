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
export function createHomeManagement(e:Economy, ui:GameUI, callbacks:{save:()=>unknown;select:(index:number)=>void;rally:()=>void}) {
  const get=(id:string)=>document.getElementById(id)!;
  const abort=new AbortController(), options={signal:abort.signal};
  let editing=0,draft:string[]=[],shortcutKey='',recruitKey='',populationKey='',buildingKey='';
  const button=(label:string,click:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.addEventListener('click',click,options);return b;};
  const notice=(message:string)=>{get('group-notice').textContent=message;};
  function edit(index=editing) {
    editing=index;draft=[...e.state.groups[index]];notice('');
    get('group-editor-tabs').replaceChildren(...Array.from({length:GROUP_COUNT},(_,i)=>{
      const b=button(`${i+1} 队`,()=>edit(i));b.setAttribute('aria-pressed',String(i===editing));return b;
    }));
    populationKey='';renderPopulation();
  }
  function renderPopulation() {
    const rows=populationInfo(e.state), key=JSON.stringify([rows,editing]);
    if(key===populationKey)return;populationKey=key;
    // Keep unsaved membership choices while refreshing displayed vitals.
    draft=draft.filter(id=>rows.some(r=>r.id===id));
    const humans=rows.filter(r=>r.role!=='dog').length;
    get('population-summary').textContent=`人口 ${humans} · 田园犬 ${rows.length-humans}`;
    get('group-candidates').replaceChildren(...rows.map(r=>{
      const row=document.createElement('tr'),check=document.createElement('td'),input=document.createElement('input');
      const name=document.createElement('th'),label=document.createElement('label');
      row.dataset.resident=r.id;name.scope='row';
      input.type='checkbox';input.value=r.id;input.id=`group-member-${r.id}`;input.checked=draft.includes(r.id);
      input.setAttribute('aria-label',`将${r.name}编入 ${editing+1} 队`);
      label.htmlFor=input.id;label.textContent=r.name;label.title=r.name;
      if(r.group!==undefined&&r.group!==editing){const other=document.createElement('small');other.textContent=`${r.group+1} 队`;label.append(other);}
      input.addEventListener('change',()=>{
        if(input.checked&&draft.length>=GROUP_SIZE){input.checked=false;notice('每队最多 6 名');return;}
        draft=input.checked?[...draft,r.id]:draft.filter(id=>id!==r.id);notice(`已选 ${draft.length} / ${GROUP_SIZE}`);
      },options);check.append(input);name.append(label);row.append(check,name);
      const value=(kind:string,text:string,low=false)=>{const cell=document.createElement('td');cell.dataset.stat=kind;cell.textContent=text;cell.classList.toggle('low',low);return cell;};
      row.append(value('health',`${Math.ceil(r.health)}/${r.maxHealth}`,r.health/r.maxHealth<.3),
        value('stamina',`${Math.floor(r.stamina)}/${r.maxStamina}`,r.stamina/r.maxStamina<.3),
        value('combat',`${r.attack??'—'} / ${r.armor}`));
      return row;
    }));
  }
  function renderBuildings(){
    const rows=buildingList(e.state),key=JSON.stringify([rows,e.state.tasks.map(t=>[t.target,t.kind,t.status,Math.floor(t.progress)]),e.available()]);
    if(key===buildingKey)return;buildingKey=key;
    get('building-summary').textContent=`建筑 ${rows.length} · 受损 ${rows.filter(b=>b.built&&b.hp<b.maxHealth).length}`;
    get('building-rows').replaceChildren(...rows.map(b=>{
      const tr=document.createElement('tr');tr.dataset.building=b.id;
      const name=document.createElement('th');name.scope='row';name.textContent=b.name;name.title=b.id;
      const q=repairQuote(e.state,b.id),task=e.taskFor(b.id),repair=task?.kind==='repair';
      if(q&&!task){const cost=document.createElement('small');cost.textContent=`木${q.cost.wood} 石${q.cost.stone}`;name.append(cost);}
      const cell=(stat:string,value:string)=>{const td=document.createElement('td');td.dataset.stat=stat;td.textContent=value;return td;};
      const status=!b.built?'建造中':repair?task.status==='working'?`维修${Math.floor(task.progress/ECONOMY_CONFIG.workSeconds.repair*100)}%`:'待维修':b.hp<=0?'已损毁':b.hp<b.maxHealth?'受损':'完好';
      tr.append(name,cell('health',b.built?`${Math.ceil(b.hp)}/${b.maxHealth}`:'—'),cell('armor',String(b.armor)),cell('status',status));
      tr.classList.toggle('damaged',b.built&&b.hp<b.maxHealth);
      const action=cell('action',''),control=button(repair?'取消':'维修',()=>{
        if(repair){e.cancel(task.id);get('building-notice').textContent='维修已取消，预留材料已释放';}
        else{const result=e.request('repair',b.id);get('building-notice').textContent=result.message;}
        callbacks.save();renderBuildings();
      });
      control.disabled=!repair&&(!q||!!task);control.setAttribute('aria-label',`${repair?'取消维修':'维修'}${b.name}`);action.append(control);tr.append(action);return tr;
    }));
  }
  for(const tab of ['resources','population','buildings'])get(`${tab}-tab`).addEventListener('click',()=>{
    for(const kind of ['resources','population','buildings']){get(`${kind}-panel`).hidden=kind!==tab;get(`${kind}-tab`).setAttribute('aria-selected',String(kind===tab));}
    if(tab==='population')edit();
    if(tab==='buildings')renderBuildings();
  },options);
  get('home-resources').addEventListener('click',()=>{if(!get('population-panel').hidden)edit();if(!get('buildings-panel').hidden)renderBuildings();},options);
  get('save-group').addEventListener('click',()=>{
    if(saveGroup(e,editing,draft)){callbacks.save();edit();notice('编队已保存');refresh();}else notice('成员状态已变化，请重新选择');
  },options);
  get('clear-group').addEventListener('click',()=>{saveGroup(e,editing,[]);callbacks.save();edit();notice('本队已清空');refresh();},options);
  get('set-rally').addEventListener('click',()=>{ui.closeRecruitment();callbacks.rally();},options);
  function refresh(selected?:number) {
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
    const nextKey=JSON.stringify([e.available(),humans,dogs,centerOpen,queue.map(q=>[q.serial,q.role,Math.floor(q.elapsed)])]);
    if(nextKey===recruitKey)return;recruitKey=nextKey;
    get('recruit-capacity').textContent=`人口 ${humans} / ${POPULATION_LIMIT} · 田园犬 ${dogs} / ${DOG_LIMIT} · 排队 ${queue.length}`;
    get('recruit-options').replaceChildren(...Object.entries(RECRUIT_CONFIG).map(([role,config])=>{
      const cost=Object.entries(config.cost).map(([kind,amount])=>`${RESOURCE_NAMES[kind as keyof typeof RESOURCE_NAMES]} ${amount}`).join(' · ');
      const b=button('',()=>{const result=recruit(e,role as ResidentRole);get('recruit-notice').textContent=result.message;callbacks.save();refresh(selected);});
      b.disabled=!centerOpen;
      const title=document.createElement('strong'),detail=document.createElement('small');title.textContent=`招募${config.name}`;detail.textContent=`${cost} · ${config.seconds} 秒`;b.append(title,detail);
      return b;
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
