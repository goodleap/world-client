# 农民 · 共享基础人物

`farmer.glb` 为 Demo 当前资源，`farmer.blend` 保留制作来源。`build_farmer.py` 直接加载 `studies/base-human/base-human.blend`，复用身体、20 根骨骼及完整 Walk／Run；只增加衣物与装备，衣物权重从基础身体表面转移。被裤靴覆盖的基础腿留在 blend 中作为权重来源，不重复导出覆盖下的皮肤。

米白色头巾完整覆盖头顶，宽斜向布褶向后结收拢；深棕头发、蓝色短袖、棕色背带围裙及腰带、深色裤子、棕色靴子和短柄农具依据设计仓库农民原型制作。原型图片留在私有设计仓库。

```sh
blender -b -t 8 --python-exit-code 1 --python studies/farmer/build_farmer.py -- --output /tmp/farmer-review
```

用 `studies/review.html?asset=/studies/farmer/farmer.glb` 检查实际 GLB，再在 Demo 验证自动接单前往 Walk、作业 Hammer、完成站立。原有 Run 保留在共享动作中；农民由经营队列调度，不接受直接移动指令。站立使用共享 Walk 的中立首帧，过渡采用 Babylon 原生混合。`tests/assets.test.ts` 验证骨架、绑定矩阵和原有 Walk／Run 全部轨道与基础人物相同。旧 `farmer-scarf.*` 与 `base-human-rig.*` 仅作历史存档，不再由 Demo 加载。

[本轮实际 GLB 多视角渲染](preview.png)使用 Demo 灯光与材质设置，未后期调色。
已检查原模型与手机 LOD 的静态视角及完整 Walk／Run 周期各 24 个相位；
本轮结果与历史动作检查分开记录于 `runtime-validation.json`，视觉效果仍以用户评审为准。

经营动作和短柄锤为试运行方案：`build_farmer.py` 从 [共享动作](../shared-actions/README.md) 添加 Hammer，同一动作供全部六种作业复用。基础身体、骨架、Walk／Run 和已有头巾配色保持原资源。完工按作业时间结算，不按挥锤次数结算。
