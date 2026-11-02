import wolf from '../../studies/wolf/wolf.glb?url';
import characters from '../../studies/characters/characters.glb?url';
import characterLOD from '../../studies/characters/characters-lod.glb?url';
import characterFarLOD from '../../studies/characters/characters-far-lod.glb?url';
import { modelData } from './asset-cache.ts';
import { loadingProgress } from '../loading-progress.ts';

export const modelAssets = { characters, characterLOD, characterFarLOD, wolf };
import { RESIDENTS, ENEMIES } from './resident-data.ts';
declare const __MODEL_BYTES__: Record<string, number>;
const sizes = ['characters', 'characters-lod', 'characters-far-lod', 'wolf'].map(id => __MODEL_BYTES__[id]);
const total = sizes.reduce((a, b) => a + b, 0);
const names = ['共享人物、服饰与坐骑', '共享人物、服饰与坐骑 LOD', '共享人物、服饰与坐骑远景 LOD', '灰狼共享模型与动作'];
Object.values(modelAssets).forEach((url, i) => {
  loadingProgress.plan(url, names[i], 25 * sizes[i] / total, 'download', sizes[i]);
  loadingProgress.plan(url + ':parse', `${names[i]}：模型解析`, 5);
  if (i < 3) loadingProgress.plan(url + ':materials', `${names[i]}：材质合批`, 5 / 3);
});
const humans = [...RESIDENTS, ...ENEMIES].filter(r => r.role !== 'dog');
for (const r of humans) {
  loadingProgress.plan(r.id + ':attach', `${r.name}：骨骼与动作挂接`, 10 / humans.length);
  loadingProgress.plan(r.id + ':geometry', `${r.name}：合批与 LOD 准备`, 10 / humans.length);
}
loadingProgress.plan('wolves:attach', '灰狼：实例与动作挂接', 4);

/** Failure is retryable on entry; preloading must never prevent menu input. */
export async function preloadGameAssets() {
  await Promise.allSettled(Object.values(modelAssets).map(url => modelData(url)));
}
