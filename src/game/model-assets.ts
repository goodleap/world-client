import characters from '../../studies/characters/characters.glb?url';
import characterLOD from '../../studies/characters/characters-lod.glb?url';
import { modelData } from './asset-cache.ts';
import { loadingProgress } from '../loading-progress.ts';

export const modelAssets = { characters, characterLOD };
const names = ['共享人物、服饰与坐骑', '共享人物、服饰与坐骑 LOD'];
Object.values(modelAssets).forEach((url, i) => loadingProgress.register(url, `${names[i]}（${url.split('/').pop()}）`, 'download'));

/** Failure is retryable on entry; preloading must never prevent menu input. */
export async function preloadGameAssets() {
  await Promise.allSettled(Object.values(modelAssets).map(url => modelData(url)));
}
