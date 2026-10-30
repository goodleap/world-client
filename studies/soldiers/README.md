# 基础人物派生兵种

制作依据：设计仓库的角色原型图 v1、装备原型及人物骨骼规范。
读取 `studies/base-human/base-human.blend` 的副本制作，基础资源不写回；
`base-source.json` 固定本轮全部基础文件校验值，测试检查是否发生变化。

```sh
blender -b -t 8 --python-exit-code 1 --python studies/soldiers/build_soldier.py -- --role infantry
```

步兵复用原身体网格、20 根骨骼、绑定姿态、Walk／Run 的身体和腿部动作及原始时序。
仅在兵种副本中将上肢适配为持械姿态，避免空手跑姿将盾牌翻平；基础动作源不变。
钢盔、蓝缨、棕色护具、蓝衣、深裤、皮靴、剑盾按原型制作。

`infantry/preview.png` 为实际导出 GLB 的 Babylon.js 多视角渲染。
本轮配色及头盔更新已检查正面、侧面、背面、俯视、游戏视角和手机缩小效果，
并对完整 Walk／Run 周期各渲染 24 个相位；基础人物、骨架及已有动作数据不变。
本轮自审结果与历史动作检查分开记录在各角色的 `runtime-validation.json` 中。

骑兵使用同一人物网格、20 根骨骼、绑定矩阵及未改动的原始 Walk／Run，
新增 17 根 `Horse.*` 骨骼和 RideIdle／RideWalk／RideRun；Babylon 为双根结构添加一个虚拟骨骼根。
先用固定骨架和完整马蹄代理检查连续周期，再制作连续马身、头颈、腿、鬃毛、鞍具和骑手装备。
慢行是四拍步态，快速移动是带腾空阶段的对角快步，参数见 `cavalry/motion-plan.json`。
Demo 保留原导航速度，按每个动作自己的参考速度播放，骑手与坐骑同步起伏。

```sh
blender -b -t 8 --python-exit-code 1 --python studies/soldiers/build_soldier.py -- --role cavalry
```

`cavalry/preview.png` 同样来自实际导出 GLB；本轮检查相同静态视角与手机缩小效果，
并对 RideWalk／RideRun 完整周期各渲染 24 个相位。坐骑及骑乘动作保持不变。

弓兵复用步兵的制服、钢盔和持械 Walk／Run，并添加木弓、弓弦、斜背箭筒、羽箭、肩带与手持箭。
身体网格、20 根骨骼、身体／腿部动作及其时序继续与基础资源保持一致。
`archer/preview.png` 是实际 GLB 多视角渲染，已检查手机缩小视图和完整 Walk／Run 周期。

```sh
blender -b -t 8 --python-exit-code 1 --python studies/soldiers/build_soldier.py -- --role archer
```

[三兵种同一世界尺度的实际 GLB 总览](preview.png)。

三兵种共用较明亮的蓝灰钢盔、银色加宽加强带与底圈、蓝衣和暖棕护具。
金属使用 Babylon 原生 PBR 与共享的预过滤环境贴图；来源和许可见 `public/credits.html`。
截图使用 Demo 的灯光及材质设置，未后期调色；审查截图不等于用户最终验收。
