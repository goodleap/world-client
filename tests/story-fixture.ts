import { Economy, initialEconomy } from '../src/game/economy.ts';
import { DEFAULT_GAME_SETUP } from '../src/game/game-setup.ts';
import { ENEMIES } from '../src/game/resident-data.ts';
import { buildingAt } from '../src/game/construction.ts';
import { newCampfire } from '../src/game/campfire.ts';
import { HOME_CENTER } from '../src/game/world-data.ts';
import { advanceStory, storyAction, storyGiver, STORY_ROAD } from '../src/game/story.ts';
import type { StoryAction } from '../src/game/story.ts';

export const questRequest = (e: Economy, action: StoryAction) => ({ action, stage: e.state.story!.stage, npc: storyGiver(e)!.id });
export function act(e: Economy, action: StoryAction) {
  const result = storyAction(e, questRequest(e, action));
  if (!result.ok) throw new Error(`Fixture ${action}: ${result.message}`);
}

export function welcomeFixture() {
  const e = new Economy(initialEconomy(391, false, DEFAULT_GAME_SETUP));
  e.setLeadership(false); e.state.inventory.food = 60; e.state.inventory.wood = 30;
  e.state.plots[0].harvests = 1; act(e, 'accept'); act(e, 'report'); act(e, 'claim');
  for (const unit of e.state.combat.units) if (ENEMIES.find(r => r.id === unit.id)?.camp === STORY_ROAD.id) {
    unit.hp = 0; unit.life = 'defeated'; unit.diedAt = 0;
  }
  Object.assign(e.state.combat.camps.find(c => c.id === STORY_ROAD.id)!, { cleared: true, discovered: true, rewardGranted: true });
  e.state.combat.discovered = true;
  act(e, 'accept'); act(e, 'report'); act(e, 'claim');
  const site = buildingAt('campfire', { x: HOME_CENTER.x + 8, z: HOME_CENTER.z - 5 }, 'site-0');
  e.state.sites.push(site); e.state.buildings.push(site.id); e.state.nextSiteId = 1;
  e.state.campfires.push({ ...newCampfire(site.id), enabled: true, wood: 6 });
  act(e, 'accept'); advanceStory(e);
  return e;
}
export function travellingFixture() {
  const e = welcomeFixture();
  act(e, 'invite');
  return e;
}
export function tradeFixture() {
  const e = travellingFixture();
  e.state.seconds = e.state.story!.arrivalAt!;
  advanceStory(e);
  return e;
}
