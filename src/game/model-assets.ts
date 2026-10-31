import farmer from '../../studies/farmer/farmer.glb?url';
import base from '../../studies/base-human/base-human.glb?url';
import infantry from '../../studies/soldiers/infantry/infantry.glb?url';
import cavalry from '../../studies/soldiers/cavalry/cavalry.glb?url';
import archer from '../../studies/soldiers/archer/archer.glb?url';
import baseLOD from '../../studies/lod/base-lod.glb?url';
import farmerLOD from '../../studies/lod/farmer-lod.glb?url';
import infantryLOD from '../../studies/lod/infantry-lod.glb?url';
import cavalryLOD from '../../studies/lod/cavalry-lod.glb?url';
import archerLOD from '../../studies/lod/archer-lod.glb?url';
import { modelData } from './asset-cache.ts';
import { loadingProgress } from '../loading-progress.ts';

export const modelAssets = { farmer, base, infantry, cavalry, archer, baseLOD, farmerLOD, infantryLOD, cavalryLOD, archerLOD };
const names = ['农民', '基础人物', '步兵', '骑兵', '弓兵', '基础人物 LOD', '农民 LOD', '步兵 LOD', '骑兵 LOD', '弓兵 LOD'];
Object.values(modelAssets).forEach((url, i) => loadingProgress.register(url, `${names[i]}（${url.split('/').pop()}）`, 'download'));

/** Failure is retryable on entry; preloading must never prevent menu input. */
export async function preloadGameAssets() {
  await Promise.allSettled(Object.values(modelAssets).map(url => modelData(url)));
}
