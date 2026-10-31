import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import '@babylonjs/core/Engines/Extensions/engine.query';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { FrameSample } from './frame-metrics.ts';
type LodSample = { id: string; parts: number; mapParts: number }[];

/** Native counters measure submitted work, including instances and shadow passes.
 * GPU queries are optional: unsupported / disjoint samples never become CPU estimates. */
export function createPerformanceDiagnostics(engine: Engine, scene: Scene, shadows: ShadowGenerator) {
  const engineMeter = new EngineInstrumentation(engine), sceneMeter = new SceneInstrumentation(scene);
  engineMeter.captureGPUFrameTime = !!engine.getCaps().timerQuery;
  sceneMeter.captureRenderTargetsRenderTime = true;
  sceneMeter.captureActiveMeshesEvaluationTime = true;
  let shadowDraws = 0, shadowTriangles = 0, beforeDraws = 0, beforeIndices = 0;
  let observedMap: ReturnType<typeof shadows.getShadowMap>;
  let gpuCount = 0, gpuUpdated: number | undefined;
  const observeShadowMap = () => {
    const map = shadows.getShadowMap();
    if (!map || map === observedMap) return;
    observedMap = map;
    map.onBeforeRenderObservable.add(() => { beforeDraws = sceneMeter.drawCallsCounter.current; beforeIndices = scene.getActiveIndices(); });
    map.onAfterRenderObservable.add(() => {
      shadowDraws = sceneMeter.drawCallsCounter.current - beforeDraws;
      shadowTriangles = (scene.getActiveIndices() - beforeIndices) / 3;
    });
  };
  observeShadowMap();
  const read = (sample: FrameSample, cadence: { meanMs: number; p95Ms: number }, zoom: number, paused: boolean, lod: LodSample) => ({
    timeMs: Math.round(performance.now()), zoom, paused, ...sample, frameMs: cadence.meanMs, frameP95Ms: cadence.p95Ms,
    gpuMs: engineMeter.captureGPUFrameTime && engineMeter.gpuFrameTimeCounter.count > 0 ? engineMeter.gpuFrameTimeCounter.current / 1e6 : null,
    gpuTimingSupported: !!engine.getCaps().timerQuery,
    gpuSampleAgeMs: gpuUpdated === undefined ? null : performance.now() - gpuUpdated,
    drawCalls: sceneMeter.drawCallsCounter.current, submittedTriangles: scene.getActiveIndices() / 3,
    shadowDrawCalls: shadowDraws, shadowTriangles, shadowCpuMs: sceneMeter.renderTargetsRenderTimeCounter.current,
    cullingCpuMs: sceneMeter.activeMeshesEvaluationTimeCounter.current,
    activeMeshes: scene.getActiveMeshes().length, meshes: scene.meshes.length, geometries: scene.geometries.length,
    textures: engine.getLoadedTexturesCache().length, materials: scene.materials.length, skeletons: scene.skeletons.length,
    animationGroups: scene.animationGroups.length, renderLoops: engine.activeRenderLoops.length,
    width: engine.getRenderWidth(), height: engine.getRenderHeight(), scaling: engine.getHardwareScalingLevel(),
    shadowSize: shadows.mapSize,
    shadowLodCamera: shadows.getShadowMap()?.cameraForLOD?.name, lod,
  });
  type Sample = ReturnType<typeof read>;
  const history: Sample[] = [], marks: { label: string; sample: Sample }[] = [];
  return {
    beforeFrame() { shadowDraws = 0; shadowTriangles = 0; observeShadowMap(); },
    record(sample: FrameSample, cadence: { meanMs: number; p95Ms: number }, zoom: number, paused: boolean, lod: LodSample) {
      const count = engineMeter.gpuFrameTimeCounter.count;
      if (count !== gpuCount) { gpuCount = count; gpuUpdated = performance.now(); }
      history.push(read(sample, cadence, zoom, paused, lod)); if (history.length > 120) history.shift();
    },
    mark() {
      const sample = [...history].reverse().find(entry => !entry.paused);
      if (!sample) return '请先运行游戏几秒，再记录视距。';
      const label = ['近景', '远景', '返回近景'][marks.length % 3];
      marks.push({ label, sample }); if (marks.length > 12) marks.splice(0, 3);
      return `已记录${label}（视距 ${sample.zoom.toFixed(1)}）。${label === '近景' ? '关闭设置，缩小镜头后再记录。' : label === '远景' ? '放大回原视距后再记录。' : '可复制性能日志反馈。'}`;
    },
    snapshot: () => ({ latest: history.at(-1), history: [...history], marks: [...marks],
      backend: `WebGL ${engine.webGLVersion}`, webGLVersion: engine.webGLVersion, renderer: engine.getGlInfo().renderer,
      gpuTimingSupported: !!engine.getCaps().timerQuery, renderLoops: engine.activeRenderLoops.length,
      sampleAgeMs: history.length ? performance.now() - history.at(-1)!.timeMs : null,
      note: 'renderer 是正在使用的图形渲染器。gpuTimingSupported 仅表示 GPU 耗时查询是否可用，false 不表示未使用 GPU；gpuMs 为 null 时不能从 CPU 或帧间隔推算 GPU 耗时。CPU 与阴影 CPU 均为提交耗时。latest/history 保留最近实际渲染的样本，暂停后停止采样，sampleAgeMs 表示样本距现在的时间。' }),
    dispose() { engineMeter.dispose(); sceneMeter.dispose(); },
  };
}
