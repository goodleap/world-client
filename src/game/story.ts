import type { Economy, EconomyState } from './economy.ts';
import type { Obstacle } from './movement.ts';
import { fireIsLit } from './campfire.ts';
import { buildingOperational } from './building-state.ts';
import { HOME_CENTER } from './world-data.ts';
import { ENCOUNTERS } from './combat-config.ts';
import { ECONOMY_CONFIG } from './economy-config.ts';
import { admitGuest } from './recruitment.ts';
import { DIFFICULTIES } from './game-setup.ts';
import { RAID_CONFIG } from './raid-state.ts';

export const STORY_STAGES = ['harvest', 'road', 'welcome', 'travelling', 'trade', 'complete'] as const;
export type StoryStage = typeof STORY_STAGES[number];
export type StoryAction = 'invite' | 'tools' | 'supplies';
export interface StoryState {
  stage: StoryStage; arrivalAt: number | null; reward: 'tools' | 'supplies' | null; craftsmanId: string | null;
}
export const initialStory = (): StoryState => ({ stage: 'harvest', arrivalAt: null, reward: null, craftsmanId: null });
export const STORY_FOOD = 20, CARAVAN_SECONDS = 45;
export const STORY_ROAD = ENCOUNTERS.find(c => c.id === 'road')!;
const welcomingFire = (s: EconomyState) => s.campfires.some(f => {
  const site = s.sites.find(p => p.id === f.id);
  return site && Math.hypot(site.x - HOME_CENTER.x, site.z - HOME_CENTER.z) <= 30 && buildingOperational(s, f.id) && fireIsLit(f);
});
export function advanceStory(e: Economy) {
  const s = e.state, story = s.story;
  if (!story) return;
  const before = story.stage;
  if (story.stage === 'harvest' && s.plots.some(p => (p.harvests ?? 0) > 0) && e.available().food >= STORY_FOOD) story.stage = 'road';
  if (story.stage === 'road' && s.combat.camps.find(c => c.id === STORY_ROAD.id)?.cleared) story.stage = 'welcome';
  if (story.stage === 'travelling' && s.seconds >= story.arrivalAt! && welcomingFire(s)) story.stage = 'trade';
  if (story.stage !== before) e.revision++;
}
export function storyAction(e: Economy, action: StoryAction, occupants: readonly Obstacle[] = []) {
  const s = e.state, story = s.story;
  if (!story) return { ok: false, message: '自由模式没有章节任务' };
  if (action === 'invite') {
    if (story.stage !== 'welcome') return { ok: false, message: '请先完成当前目标' };
    if (!welcomingFire(s)) return { ok: false, message: '请在家园中心附近建造并点燃火堆' };
    if (e.available().food < STORY_FOOD) return { ok: false, message: `需要 ${STORY_FOOD} 份未预留的入库粮食` };
    s.inventory.food -= STORY_FOOD;
    story.stage = 'travelling'; story.arrivalAt = s.seconds + CARAVAN_SECONDS; e.revision++;
    return { ok: true, message: '补给已备好，商队正在赶来' };
  }
  if (story.stage !== 'trade' || !['tools', 'supplies'].includes(action)) return { ok: false, message: '当前无法领取商队赠礼' };
  if (action === 'tools' && s.upgrades.tools >= ECONOMY_CONFIG.upgradeLimit) return { ok: false, message: '工具已满级，请选择安家物资' };
  const guest = admitGuest(e, occupants);
  if (!guest) return { ok: false, message: '请留出一个人口名额，并清理家园中心出口' };
  story.craftsmanId = guest.id; story.reward = action; story.stage = 'complete';
  if (action === 'tools') { s.upgrades.tools++; e.dropReward(guest.spawn, { wood: 12, iron: 8 }); }
  else e.dropReward(guest.spawn, { food: 24, stone: 16 });
  // The first chapter has deliberate breathing room; subsequent raids use the selected difficulty.
  s.raids.nextAt = Math.max(s.raids.nextAt, s.seconds + RAID_CONFIG.protection * DIFFICULTIES[s.setup.difficulty].protection);
  e.revision++;
  return { ok: true, message: '第一章完成！木匠阿榆已加入家园，赠礼等待搬运入库。' };
}
export function decodeStory(raw: unknown, mode: EconomyState['setup']['mode'], seconds: number): StoryState | null {
  if (mode === 'free') { if (raw !== null) throw new Error('自由模式章节存档无效'); return null; }
  const s = raw as StoryState | undefined;
  if (!s || !STORY_STAGES.includes(s.stage)) throw new Error('故事进度无效');
  const sent = STORY_STAGES.indexOf(s.stage) >= 3, complete = s.stage === 'complete';
  if (sent ? typeof s.arrivalAt !== 'number' || !Number.isFinite(s.arrivalAt) || s.arrivalAt < CARAVAN_SECONDS || s.arrivalAt > seconds + CARAVAN_SECONDS
    || STORY_STAGES.indexOf(s.stage) >= 4 && s.arrivalAt > seconds : s.arrivalAt !== null) throw new Error('商队时间无效');
  if (complete ? !['tools', 'supplies'].includes(s.reward!) || typeof s.craftsmanId !== 'string' || !/^recruit-farmer-[1-9]\d*$/.test(s.craftsmanId)
    : s.reward !== null || s.craftsmanId !== null) throw new Error('故事奖励无效');
  return { stage: s.stage, arrivalAt: s.arrivalAt, reward: s.reward, craftsmanId: s.craftsmanId };
}

export function storyView(e: Economy) {
  const s = e.state, story = s.story;
  if (!story) return null;
  const food = Math.max(0, e.available().food), fire = welcomingFire(s);
  const views = {
    harvest: { title: '先让粮仓充实起来', text: '远行商队正在寻找新的落脚点。收获一块农田，并留足接待粮食，让这里成为值得停留的家园。', objective: `收获农田 ${s.plots.some(p => (p.harvests ?? 0) > 0) ? '1' : '0'}/1 · 可用粮食 ${Math.min(food, STORY_FOOD)}/${STORY_FOOD}` },
    road: { title: '商路上的求救', text: '向导被困在西侧路口。带领士兵清理路口守卫，为商队打通安全通道；农民可以继续经营家园。', objective: '清理西侧路口守卫', target: { x: STORY_ROAD.x, z: STORY_ROAD.z } },
    welcome: { title: '为远客留一盏火', text: '获救的向导答应带商队过来。在家园中心 30 单位内建造并点燃火堆，准备 20 份粮食招待远客。', objective: `火堆${fire ? '已点燃' : '尚未就绪'} · 可用粮食 ${Math.min(food, STORY_FOOD)}/${STORY_FOOD}` },
    travelling: { title: '商队正在路上', text: '向导已带着邀请出发。你可以继续建设，保持家园附近的火堆燃烧，商队抵达后会在这里停留。', objective: s.seconds < story.arrivalAt! ? `还有 ${Math.ceil(story.arrivalAt! - s.seconds)} 游戏秒抵达` : '商队已到附近，等待点燃家园火堆' },
    trade: { title: '第一支商队抵达了', text: '“这一路终于有个能歇脚的地方了。”木匠阿榆愿意留下帮忙，商队还送来一份见面礼。选择一份适合当前发展的赠礼。', objective: '木匠入驻 · 选择一份商队赠礼' },
    complete: { title: '商路已经连通', text: '木匠阿榆已经加入家园，商队的赠礼等待农民搬运入库。你完成了第一章，可以继续经营、探索其他区域，并准备接下来的家园防守。', objective: `第一章已完成 · ${story.reward === 'tools' ? '工具强化与铁木补给' : '粮食与石材补给'}` },
  };
  return { ...views[story.stage], stage: story.stage, progress: STORY_STAGES.indexOf(story.stage),
    invite: story.stage === 'welcome', canInvite: fire && food >= STORY_FOOD,
    trade: story.stage === 'trade', canTools: s.upgrades.tools < ECONOMY_CONFIG.upgradeLimit };
}
export type StoryView = ReturnType<typeof storyView>;
