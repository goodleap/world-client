import { Tools } from '@babylonjs/core/Misc/tools.js';
import type { ISceneLoaderProgressEvent } from '@babylonjs/core/Loading/sceneLoader.js';
import { loadingProgress } from '../loading-progress.ts';

type Progress = (event: ISceneLoaderProgressEvent) => void;
type Download = { data: Promise<Uint8Array>; progress?: ISceneLoaderProgressEvent; listeners: Set<Progress> };
const downloads = new Map<string, Download>();

/** Share both pending and completed downloads. Babylon still owns transport,
 * retry/progress reporting and GLB decoding; no scene is needed in the menu. */
export async function modelData(url: string, onProgress?: Progress): Promise<Uint8Array> {
  let download = downloads.get(url);
  if (!download) {
    loadingProgress.begin(url, loadingProgress.items.get(url)?.name ?? url.split('/').pop()!, 'download');
    const listeners = new Set<Progress>();
    const entry: Download = { listeners, data: undefined! };
    entry.data = new Promise<Uint8Array>((resolve, reject) => {
      Tools.LoadFile(url, data => {
        const bytes = new Uint8Array(data as ArrayBuffer);
        loadingProgress.bytes(url, bytes.byteLength, bytes.byteLength); loadingProgress.done(url); resolve(bytes);
      }, event => {
        entry.progress = { lengthComputable: event.lengthComputable, loaded: event.loaded, total: event.total };
        loadingProgress.bytes(url, event.loaded, event.lengthComputable ? event.total : undefined);
        for (const listener of listeners) listener(entry.progress);
      }, undefined, true, (request, error) => reject(new Error(`${loadingProgress.items.get(url)?.name}: HTTP ${request?.status ?? '网络错误'} · ${error?.message ?? '资源下载失败'}`)));
    }).catch(error => { loadingProgress.fail(url, error); downloads.delete(url); throw error; });
    downloads.set(url, entry); download = entry;
  }
  if (onProgress) { download.listeners.add(onProgress); if (download.progress) onProgress(download.progress); }
  try {
    const data = await download.data;
    onProgress?.({ lengthComputable: true, loaded: data.byteLength, total: data.byteLength });
    return data;
  } finally { if (onProgress) download.listeners.delete(onProgress); }
}

export const modelOptions = (url: string) => ({
  pluginExtension: '.glb', name: url.slice(url.lastIndexOf('/') + 1), rootUrl: url.slice(0, url.lastIndexOf('/') + 1),
});

// Decoded scene resources now own their buffers; avoid retaining another 66 MB
// for the whole play session. Returning to the menu can use the HTTP cache.
export function releaseModelDownloads() { downloads.clear(); }
