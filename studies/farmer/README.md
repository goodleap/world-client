# 农民 · 共享基础人物

`farmer.glb` 为 Demo 当前资源，`farmer.blend` 保留制作来源。`build_farmer.py` 直接加载 `studies/base-human/base-human.blend`，复用身体、20 根骨骼及完整 Walk／Run；只增加衣物与装备，衣物权重从基础身体表面转移。被裤靴覆盖的基础腿留在 blend 中作为权重来源，不重复导出覆盖下的皮肤。

米色头巾完整覆盖头顶，深棕头发、蓝色短袖、棕色背带围裙及腰带、深色裤子、棕色靴子和短柄农具依据设计仓库农民原型制作。原型图片留在私有设计仓库。

```sh
blender -b -t 8 --python studies/farmer/build_farmer.py -- --output /tmp/farmer-review
```

用 `studies/review.html?asset=/studies/farmer/farmer.glb` 检查实际 GLB，再在 Demo 验证漫步 Walk、指挥 Run、到达站立；停止 Run 时使用共享 Walk 的中立首帧。`tests/assets.test.ts` 验证骨架、绑定矩阵和全部动作轨道与基础人物相同。旧 `farmer-scarf.*` 与 `base-human-rig.*` 仅作历史存档，不再由 Demo 加载。
