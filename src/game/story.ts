import type { Economy, EconomyState } from './economy.ts';
import type { Obstacle, Point } from './movement.ts';
import { fireIsLit } from './campfire.ts';
import { buildingOperational } from './building-state.ts';
import { HOME_CENTER } from './world-data.ts';
import { ENCOUNTERS } from './combat-config.ts';
import { ECONOMY_CONFIG } from './economy-config.ts';
import { admitGuest, homeResidents } from './recruitment.ts';
import { health } from './vitals.ts';
import { DIFFICULTIES } from './game-setup.ts';
import { RAID_CONFIG } from './raid-state.ts';

export const STORY_STAGES = ['harvest', 'road', 'welcome', 'travelling', 'trade', 'complete'] as const;
export const QUEST_STATUSES = ['available', 'active', 'ready', 'reward', 'claimed'] as const;
export type StoryStage = typeof STORY_STAGES[number];
export type QuestStatus = typeof QUEST_STATUSES[number];
export type StoryAction = 'accept' | 'report' | 'claim' | 'invite' | 'tools' | 'supplies';
export interface StoryRequest { action: StoryAction; stage: StoryStage; npc: string }
export interface StoryState {
  stage: StoryStage; status: QuestStatus; arrivalAt: number | null;
  reward: 'tools' | 'supplies' | null; craftsmanId: string | null;
}
export const initialStory = (): StoryState => ({ stage: 'harvest', status: 'available', arrivalAt: null, reward: null, craftsmanId: null });
export const STORY_FOOD = 20, CARAVAN_SECONDS = 45;
export const STORY_ROAD = ENCOUNTERS.find(c => c.id === 'road')!;
const welcomingFire = (s: EconomyState) => s.campfires.some(f => {
  const site = s.sites.find(p => p.id === f.id);
  return site && Math.hypot(site.x - HOME_CENTER.x, site.z - HOME_CENTER.z) <= 30 && buildingOperational(s, f.id) && fireIsLit(f);
});
/** Living residents handle hand-ins; a fallen giver is never resurrected. */
export function storyGiver(e: Economy) {
  const s = e.state;
  if (!s.story) return;
  const people = homeResidents(s).filter(r => r.role !== 'dog' && health(s, r.id) > 0);
  return people.find(r => r.id === s.story!.craftsmanId)
    ?? people.find(r => r.effects?.includes('leader')) ?? people.find(r => r.role === 'farmer') ?? people[0];
}
function objectiveMet(e: Economy) {
  switch (e.state.story?.stage) {
    case 'harvest': return e.state.plots.some(p => (p.harvests ?? 0) > 0) && e.available().food >= STORY_FOOD;
    case 'road': return !!e.state.combat.camps.find(c => c.id === STORY_ROAD.id)?.cleared;
    case 'welcome': return welcomingFire(e.state) && e.available().food >= STORY_FOOD;
    case 'trade': return true;
    default: return false;
  }
}
export function advanceStory(e: Economy, occupants: readonly Obstacle[] = []) {
  const s = e.state, story = s.story;
  if (!story) return;
  if (story.stage === 'travelling') {
    if (s.seconds < story.arrivalAt! || !welcomingFire(s)) return;
    const guest = admitGuest(e, occupants);
    if (!guest) return;
    story.craftsmanId = guest.id; story.stage = 'trade'; story.status = 'ready'; e.revision++;
  } else if (story.status === 'active' || story.status === 'ready') {
    const status = objectiveMet(e) ? 'ready' : 'active';
    if (status !== story.status) { story.status = status; e.revision++; }
  }
}
export function storyAction(e: Economy, request: StoryRequest, rewardPoint?: Point) {
  const s = e.state, story = s.story, npc = storyGiver(e);
  if (!story) return { ok: false, message: '自由模式没有章节任务' };
  if (!npc || request.npc !== npc.id) return { ok: false, message: '请与当前任务人物交谈' };
  if (request.stage !== story.stage) return { ok: false, message: '任务已经更新，请重新交谈' };
  const { action } = request;
  if (action === 'accept' && story.status === 'available') {
    story.status = objectiveMet(e) ? 'ready' : 'active'; e.revision++;
    return { ok: true, message: `已接取「${storyTitle(story.stage)}」。办好后再来找我。` };
  }
  if (action === 'report' && story.status === 'ready' && ['harvest', 'road', 'trade'].includes(story.stage)) {
    if (!objectiveMet(e)) { advanceStory(e); return { ok: false, message: '目标尚未满足，准备好后再来交付' }; }
    story.status = 'reward'; e.revision++;
    return { ok: true, message: '事情办妥了，谢谢你！请收下这份报酬。' };
  }
  if (action === 'claim' && story.status === 'reward' && (story.stage === 'harvest' || story.stage === 'road')) {
    const harvest = story.stage === 'harvest', title = storyTitle(story.stage);
    e.dropReward(rewardPoint ?? npc.spawn, harvest ? { wood: 6, stone: 4 } : { food: 8, iron: 4 });
    story.stage = harvest ? 'road' : 'welcome'; story.status = 'available'; e.revision++;
    return { ok: true, message: `「${title}」已完成并领奖：${harvest ? '木材 6、石材 4' : '粮食 8、铁矿 4'}。物资已放在人物旁，等待搬运入库。` };
  }
  if (action === 'invite' && story.stage === 'welcome' && story.status === 'ready') {
    if (!objectiveMet(e)) { advanceStory(e); return { ok: false, message: '请点燃家园附近的火堆，并备齐 20 份未预留粮食' }; }
    s.inventory.food -= STORY_FOOD;
    story.stage = 'travelling'; story.status = 'active'; story.arrivalAt = s.seconds + CARAVAN_SECONDS; e.revision++;
    return { ok: true, message: '已交付 20 份粮食。阿榆到达后，请与他交谈领取商队赠礼。' };
  }
  if (story.stage !== 'trade' || story.status !== 'reward' || !['tools', 'supplies'].includes(action)) {
    return { ok: false, message: '请按当前任务状态接取、回报或领取奖励' };
  }
  if (action === 'tools' && s.upgrades.tools >= ECONOMY_CONFIG.upgradeLimit) return { ok: false, message: '工具已满级，请选择安家物资' };
  story.reward = action as 'tools' | 'supplies'; story.stage = 'complete'; story.status = 'claimed';
  if (action === 'tools') { s.upgrades.tools++; e.dropReward(rewardPoint ?? npc.spawn, { wood: 12, iron: 8 }); }
  else e.dropReward(rewardPoint ?? npc.spawn, { food: 24, stone: 16 });
  s.raids.nextAt = Math.max(s.raids.nextAt, s.seconds + RAID_CONFIG.protection * DIFFICULTIES[s.setup.difficulty].protection);
  e.revision++;
  return { ok: true, message: `第一章已完成并领奖：${action === 'tools' ? '工具升一级、木材 12、铁矿 8' : '粮食 24、石材 16'}。物资已放在人物旁，等待搬运入库。` };
}
export function decodeStory(raw: unknown, mode: EconomyState['setup']['mode'], seconds: number): StoryState | null {
  if (mode === 'free') { if (raw !== null) throw new Error('自由模式章节存档无效'); return null; }
  const s = raw as StoryState | undefined;
  if (!s || !STORY_STAGES.includes(s.stage) || !QUEST_STATUSES.includes(s.status)) throw new Error('故事进度无效');
  const statuses: Record<StoryStage, readonly QuestStatus[]> = {
    harvest: ['available', 'active', 'ready', 'reward'], road: ['available', 'active', 'ready', 'reward'],
    welcome: ['available', 'active', 'ready'], travelling: ['active'], trade: ['ready', 'reward'], complete: ['claimed'],
  };
  if (!statuses[s.stage].includes(s.status)) throw new Error('任务交接状态无效');
  const sent = STORY_STAGES.indexOf(s.stage) >= 3, arrived = s.stage === 'trade' || s.stage === 'complete';
  if (sent ? typeof s.arrivalAt !== 'number' || !Number.isFinite(s.arrivalAt) || s.arrivalAt < CARAVAN_SECONDS || s.arrivalAt > seconds + CARAVAN_SECONDS
    || arrived && s.arrivalAt > seconds : s.arrivalAt !== null) throw new Error('商队时间无效');
  if (arrived ? typeof s.craftsmanId !== 'string' || !/^recruit-farmer-[1-9]\d*$/.test(s.craftsmanId) : s.craftsmanId !== null) throw new Error('故事居民无效');
  if (s.stage === 'complete' ? !['tools', 'supplies'].includes(s.reward!) : s.reward !== null) throw new Error('故事奖励无效');
  return { stage: s.stage, status: s.status, arrivalAt: s.arrivalAt, reward: s.reward, craftsmanId: s.craftsmanId };
}
const TITLES = ['先让粮仓充实起来', '打通西侧商路', '迎接第一支商队'];
const taskIndex = (stage: StoryStage) => Math.min(STORY_STAGES.indexOf(stage), 2);
const storyTitle = (stage: StoryStage) => TITLES[taskIndex(stage)];
export function storyView(e: Economy) {
  const s = e.state, story = s.story;
  if (!story) return null;
  const npc = storyGiver(e), food = Math.max(0, e.available().food), fire = welcomingFire(s);
  const craftsmanAlive = npc?.id === story.craftsmanId;
  const texts: Record<StoryStage, string> = {
    harvest: '远行商队想来这里歇脚，可不能让客人饿肚子。请收获一块农田，留下 20 份入库粮食。粮食先留在仓库，办好后来找我，我备了些建材给你。',
    road: '粮食有了，西边的路却还被守卫占着。带士兵清理路口，回来告诉我结果，我们才能邀请商队。出发前记得让大家吃饱。',
    welcome: '路通了，接下来得让客人有火可暖、有饭可吃。在家园附近点燃火堆，再带 20 份粮食来交付。我会通知木匠阿榆过来，他也带了一份见面礼。',
    travelling: '邀请已经送出去了。保持火堆燃烧，也给阿榆留出一个人口名额和通畅的家园出口；他到达后会亲自与你交接。',
    trade: craftsmanAlive ? '我是阿榆，多亏你们打通商路，还准备了热饭。我愿意留在这里帮忙。这一路带来的工具和物资，你可以挑一份家园现在最需要的。'
      : '阿榆已经不在了，但商队答应的赠礼还在。我来替他交接，你可以挑一份家园现在最需要的。',
    complete: '这份人情我记下了。商路已经连通，我们一起把家园经营好吧。',
  };
  const objectives: Record<StoryStage, string> = {
    harvest: `收获农田 ${s.plots.some(p => (p.harvests ?? 0) > 0) ? 1 : 0}/1 · 可用粮食 ${Math.min(food, STORY_FOOD)}/20`,
    road: `西侧路口守卫：${objectiveMet(e) ? '已清理' : '尚未清理'}`,
    welcome: `家园附近火堆${fire ? '已点燃' : '尚未点燃'} · 可交付粮食 ${Math.min(food, STORY_FOOD)}/20`,
    travelling: s.seconds < story.arrivalAt! ? `阿榆还有 ${Math.ceil(story.arrivalAt! - s.seconds)} 游戏秒抵达` : !fire ? '等待点燃家园附近的火堆' : '请留出一个人口名额并清理家园出口，迎接阿榆',
    trade: craftsmanAlive ? '阿榆已经到达家园 · 与他交谈并回报任务' : '与接替交接的居民回报任务，领取商队赠礼', complete: '第一章完成 · 全部任务已交付，奖励已领取',
  };
  const statusNames: Record<QuestStatus, string> = { available: '可接任务', active: '进行中', ready: '可交付', reward: '待领奖', claimed: '已领奖' };
  const status = story.status, index = taskIndex(story.stage);
  const rewards = index === 0 ? '木材 6 · 石材 4' : index === 1 ? '粮食 8 · 铁矿 4'
    : '木匠阿榆入驻；二选一：工具升一级 + 木材 12、铁矿 8，或粮食 24、石材 16';
  const actions: { id: StoryAction; label: string; disabled?: boolean }[] = status === 'available' ? [{ id: 'accept', label: '接取任务' }]
    : status === 'ready' ? [{ id: story.stage === 'welcome' ? 'invite' : 'report', label: story.stage === 'welcome' ? '交付粮食 20 · 邀请商队' : '回报任务' }]
    : status === 'reward' ? story.stage === 'trade' ? [
      { id: 'tools', label: '领取：工具升级、木材 12、铁矿 8', disabled: s.upgrades.tools >= ECONOMY_CONFIG.upgradeLimit },
      { id: 'supplies', label: '领取：粮食 24、石材 16' },
    ] : [{ id: 'claim', label: `领取奖励 · ${rewards}` }] : [];
  return {
    stage: story.stage, status, statusName: statusNames[status], title: storyTitle(story.stage), text: texts[story.stage],
    dialogue: status === 'ready' ? story.stage === 'trade' ? texts.trade : '你已经准备好了？和我说说吧，确认后就可以交接。'
      : status === 'reward' ? '任务已经办妥。这是答应你的报酬，请确认收下。' : texts[story.stage],
    objective: objectives[story.stage], rewards, actions, progress: story.stage === 'complete' ? 3 : index,
    npc: npc ? { id: npc.id, name: npc.name } : null,
    marker: ({ available: '!', active: '…', ready: '?', reward: '礼', claimed: '✓' })[status],
    bark: status === 'available' ? '有件事想请你帮忙，来聊聊吧。' : status === 'ready' ? '事情准备好了，来找我交接吧。' : status === 'reward' ? '别忘了收下答应你的报酬。' : '',
    target: story.stage === 'road' && status === 'active' ? { x: STORY_ROAD.x, z: STORY_ROAD.z } : null,
    journal: TITLES.map((title, i) => ({ title, status: story.stage === 'complete' || i < index ? '已完成 · 已领奖' : i === index ? statusNames[status] : '尚未开启' })),
  };
}
export type StoryView = ReturnType<typeof storyView>;
