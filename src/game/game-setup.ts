export const GAME_MODES = {
  story: { name: '故事模式', description: '跟随章节发展家园，遇见旅人，打通商路。', goal: '第一章 · 迎接第一支商队' },
  free: { name: '自由模式', description: '自由建设、探索与战斗，自己决定下一步。', goal: '经营与探索，自由安排发展方向' },
} as const;
export const DIFFICULTIES = {
  relaxed: { name: '轻松', description: '补给充足，来袭规模较小，准备时间更长。', supplies: 1.5, protection: 2, interval: 1.75, raiders: .7 },
  standard: { name: '标准', description: '均衡的补给与威胁，适合第一次游玩。', supplies: 1, protection: 1, interval: 1, raiders: 1 },
  challenging: { name: '挑战', description: '补给较少，来袭更密集，需要提前布防。', supplies: .75, protection: .6, interval: .7, raiders: 1.3 },
} as const;
export interface GameSetup { mode: keyof typeof GAME_MODES; difficulty: keyof typeof DIFFICULTIES; homeName: string }
export const DEFAULT_GAME_SETUP: Readonly<GameSetup> = { mode: 'story', difficulty: 'standard', homeName: '溪谷家园' };
export const FREE_GAME_SETUP: Readonly<GameSetup> = { ...DEFAULT_GAME_SETUP, mode: 'free' };
export const homeName = (name: string) => Array.from(name.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 24).join('') || DEFAULT_GAME_SETUP.homeName;
export function decodeGameSetup(value: unknown): GameSetup {
  const v = value as GameSetup | undefined;
  if (!v || !Object.hasOwn(GAME_MODES, v.mode) || !Object.hasOwn(DIFFICULTIES, v.difficulty)
    || typeof v.homeName !== 'string' || homeName(v.homeName) !== v.homeName) throw new Error('游戏模式或难度配置无效');
  return { mode: v.mode, difficulty: v.difficulty, homeName: v.homeName };
}
