# 奔跑与疾驰改造

用户确认保持当前移速，改善人物与马“小碎步快速前进”的观感。代码基线 `598dd59`，设计基线 `6544c21`。本轮仅改动作及其播放参考速度，不修改造型、骨长、材质、三档 LOD、移动与战斗数值。

## 实现

- 人物 Run 和 CarryRun 共用同一腿部及骨盆轨道，增加前后跨距、屈膝回收、腾空、前倾和肩胯配合；持械上肢采用较小摆幅，保留持握。
- HorseRideRun 从对角小跑改为四拍疾驰：左后、右后、左前、右前依次触地，周期相位为 0、0.08、0.44、0.52。包含收腿和伸展腾空，马身俯仰及颈头缓冲；RideRun 中骑手根节点严格跟随马身鞍座，躯干与手臂另做缓冲。
- `src/game/locomotion.ts` 将原有导航速度关系与动画参考速度分离。移动位置仍由既有寻路和避让决定；动作仅按实际速度同步。农民满体力畅通时 5、步兵 4.6、弓兵 4.8、骑兵 6.96 世界单位／游戏秒，疲劳倍率不变。
- 参数统一维护于 `studies/characters/locomotion.json`，更新共享 GLB 和 `characters.blend` 的四套动作。农民、步兵、弓兵、骑手不各自发布人体或动作副本。马保留独立骨架。
- 离线两节 IK 和曲线只用于制作，运行时继续使用 Babylon 原生 AnimationGroup、现有暂停及屏外动作处理。骨架数、动作数、网格和绘制部件没有增加。

## 节奏与接地

下面是满体力、直线畅通的游戏时间周期；“完整周期”包含双腿或四腿的一次完整循环，非单次落脚。参考速度属于可调整的动作标定值，不是新的永久玩法数值。

| 对象 | 旧周期 | 新周期 | 当前移速 |
| --- | ---: | ---: | ---: |
| 农民 | 0.150 秒 | 0.3264 秒 | 5 |
| 步兵 | 0.163 秒 | 0.3548 秒 | 4.6 |
| 弓兵 | 0.1563 秒 | 0.340 秒 | 4.8 |
| 骑兵 | 0.1293 秒 | 0.340 秒 | 6.96 |

人物每周期对应前进距离从 0.75 调到 1.632 世界单位，马从 0.9 调到 2.3664。支撑脚在模型空间向后移动的速度与根节点在地图上向前移动的速度抵消，因此不能只调低旧动画的播放倍率。

每个动作 121 个相位样本；在实际导出轨道及中间插值上检查 241 个相位。原骨长全部保留，目标最小可达余量约 0.0071 世界单位。最小蒙皮鞋底高度约 0.00274、马蹄约 0.00760，未穿地；支撑阶段脚部漂移最大约 0.00037，鞍座变换误差小于 0.000001。具体记录见 [数值证据](evidence/numeric.json)。

## 视觉与验证

已在 Babylon 实际加载共享 GLB，检查基础人物、农民、步兵、弓兵和骑兵，每个角色观察原生动画完成至少三个循环，并采样完整周期。侧面和游戏视角见 [基础人物](evidence/base-phases.png)、[农民](evidence/farmer-phases.png)、[步兵](evidence/infantry-phases.png)、[弓兵](evidence/archer-phases.png)、[骑兵](evidence/cavalry-phases.png)，可与[改造前侧面](evidence/before-phases.png)对照；农民、步兵、弓兵图中也包含手机视角的远景 LOD。前后伸展、收腿和马的非对角节奏可辨认，服装和装备随骨架保持连接，未见本轮新增的明显穿插。

按当前游戏速度编码的循环视频：[人物](evidence/farmer-run.mp4)、[马与骑手](evidence/cavalry-gallop.mp4)。这些视频是确定相位的实际渲染，并非云端浏览器的实测 FPS。实际手机大小还以游戏内触控回归截图为依据。

类型检查、生产构建、162 项逻辑测试通过。导航回归逐步对比旧速度关系与新代码，在不同体力和暂停步长下位置、路线状态及到达时间一致。7 项桌面／手机浏览器场景均有成功记录，覆盖农民作业中断／恢复、狗移动、步兵／弓兵／骑兵连续指挥、攻击切换、战利品运输、存档和后台暂停；三兵种还验证了实际播放倍率与移动速度同步。首批 6 项成功，农民旧测试点被前景树冠遮挡，实际成为伐木指令；测试改用可见空地后该项成功，游戏拾取与作业规则不变。记录见 [首批](evidence/browser-first.txt) 和 [农民复测](evidence/browser-farmer.txt)。

制作源检查确认 Blender 中对象、有效网格顶点、骨架与其他动作均与基线一致，仅四个指定动作改变；记录见 [制作源核对](evidence/authoring-check.txt)。游戏内正常比例见[桌面](evidence/game-desktop.png)和[手机](evidence/game-mobile.png)。构建保留既有引擎分包大于 500 kB 的提示。

本次动作对照保留既有造型，不表示历史原型还原问题已经解决，也不将云端模拟结果视为真实 iPhone 性能。

## 维护与复现

```sh
npm test
npm run build
python3 tools/verify_character_library.py
python3 tools/verify_locomotion.py
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- commands.desktop.spec.ts single-soldier.desktop.spec.ts single-soldier.mobile.spec.ts combat.desktop.spec.ts lifecycle.desktop.spec.ts
```

`build_locomotion.py` 重建为逐字节一致的 GLB；`sync_locomotion_authoring.py` 同步 Blender 中的四个动作。`verify_character_library.py` 继续验证原有几何、权重、绑定及未改变的历史轨道；新跑姿由 `verify_locomotion.py` 验证。可使用 `--baseline /path/to/before.glb` 验证除四套动作之外的所有资产与轨道保持不变。

`animation_asset.py` 仅压紧未引用的 accessor／bufferView，原始几何字节不重新生成。攻击生成器也采用该方式，避免以后重建攻击时按旧 buffer 边界截断新跑姿。共享 GLB 比本轮基线增加约 353 KiB；中、远 LOD 文件不变，所有 LOD 复用同一套动作。
