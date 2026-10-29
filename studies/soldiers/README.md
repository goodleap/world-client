# 基础人物派生兵种

制作依据：设计仓库的角色原型图 v1、装备原型及人物骨骼规范。
读取 `studies/base-human/base-human.blend` 的副本制作，基础资源不写回；
`base-source.json` 固定本轮全部基础文件校验值，测试检查是否发生变化。

```sh
blender -b -t 8 --python studies/soldiers/build_soldier.py -- --role infantry
```

步兵复用原身体网格、20 根骨骼、绑定姿态、Walk／Run 的身体和腿部动作及原始时序。
仅在兵种副本中将上肢适配为持械姿态，避免空手跑姿将盾牌翻平；基础动作源不变。
钢盔、蓝缨、棕色护具、蓝衣、深裤、皮靴、剑盾按原型制作。

`infantry/preview.png` 为实际导出 GLB 的 Babylon.js 多视角渲染。
已检查正面、侧面、背面、游戏视角、180×240 缩小视图，以及每个完整步行／奔跑周期
的 60 帧游戏视角与 12 帧侧面姿态；视觉结论仍待用户评审。

骑兵使用同一人物网格、20 根骨骼、绑定矩阵及未改动的原始 Walk／Run，
新增 17 根 `Horse.*` 骨骼和 RideIdle／RideWalk／RideRun；Babylon 为双根结构添加一个虚拟骨骼根。
先用固定骨架和完整马蹄代理检查连续周期，再制作连续马身、头颈、腿、鬃毛、鞍具和骑手装备。
慢行是四拍步态，快速移动是带腾空阶段的对角快步，参数见 `cavalry/motion-plan.json`。
Demo 保留原导航速度，按每个动作自己的参考速度播放，骑手与坐骑同步起伏。

```sh
blender -b -t 8 --python studies/soldiers/build_soldier.py -- --role cavalry
```

`cavalry/preview.png` 同样来自实际导出 GLB；已检查四个主要视角、180×240 缩小图、
每个动作的 60 帧完整游戏视角周期及 12 帧侧面姿态，并验证 Demo 中的慢行、快步和骑乘待机。
