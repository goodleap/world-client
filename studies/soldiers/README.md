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
