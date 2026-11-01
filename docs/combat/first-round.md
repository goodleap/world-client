# 首轮战斗交付与验证

后续操作、30 格内低体力进食和全职业火堆补给已按最新要求调整，见[本轮交付记录](../controls-and-feeding/implementation.md)。以下保留当轮实现与验证记录。

> 这是首轮战斗交付的历史记录。后续已移除小队及自动回家扣粮恢复，改为单兵操作、火堆配送和进食补体力/生命，存档升至版本 7。当前行为与验证见[火堆交付记录](../campfire/implementation.md)。下文旧机制及测试结果仅对应当时提交。


2026-11-01。基于当时远端 main（客户端 `8ad712e`、设计 `b258f12`）继续开发，保留已有移动选择、湖泊地形、经营和共享人物资源实现。对应设计：[战斗系统](https://github.com/goodleap/world-design/tree/main/玩法设计/战斗系统)。

## 可玩的范围

“选择小队”选中现有步兵、弓兵；“西南据点”定位外围敌营，点击敌人指定攻击，点空地移动。“撤退回家”抑制索敌，抵达后待命；“自动战斗”重新开启附近索敌。移动、攻击保留选择；取消选择仅清除选择，生产作业安排成功才释放选择。手机拖动继续平移镜头。

敌营有两名近战、一名弓手，近战分散接近、远程检查射程和固体遮挡，敌方有限追击并沿路线回岗。我方战败后受伤、沿正常路线回家，支付仓库可用粮食并经过游戏内时间恢复。清理敌营只生成一次三堆战利品，正常搬运入库、受仓库容量约束；该区域解除敌营建设限制。

参数位于 [combat-config.ts](../../src/game/combat-config.ts)，均为试行值。目前恢复需要 6 粮食和 20 游戏秒，奖励为木材 24、石材 16、粮食 12。没有骑兵作战、军事领头、招募、家园防御、多据点或永久死亡。

## 实现边界

- [combat.ts](../../src/game/combat.ts) 使用固定上限的小步推进，管理准备、唯一命中、恢复、冷却、在途箭、伤病和奖励。反复点击不能重置冷却；伤害不依赖渲染帧、动画事件或特效回调。
- 沿用现有 A*、路线执行和人群避让。每个目标周围有 12 个候选站位，复用终点预留，接敌重算间隔至少 0.8 游戏秒。湖泊、建筑、树石及不可通行农田参与阻挡；远程采用保守的平面遮挡，无高低差射击和友军误伤。
- 统一活动时间输入战斗、移动、经营、恢复和发言；前台单帧最多推进 0.25 秒。后台、失焦、设置暂停，返回须手动继续，恢复首帧推进量为零。
- 存档版本 6 保存剩余冷却、攻击释放标记、在途箭、生命、目标、恢复付款和进度，以及据点奖励标记和对应普通物资 ID。拒绝旧版或非法状态，不迁移旧存档。开始新游戏覆盖旧进度仍使用原有确认流程。
- 全图新增 3 名敌人，总计 5 名战斗单位。复用共享人体、骨架、服饰、材质与 LOD，只增加简单旗帜、范围环和箭；没有新光源、粒子系统或运行时动画生成依赖。

## 三个界面修复

关闭领头指挥同时清除发言队列和当前气泡；领取旧领头任务时也检查开关，不再次发言。正常已接受作业继续，领头仍作为农民工作。

气泡位置使用名称实际高度和包含尾部的 12px 间距。上方放不下时显示在下方，横向钳制在视口中；两侧都放不下时隐藏气泡。设置面板统一 `inset: 0; margin: auto`，手机及矮屏保持居中，内部滚动以操作底部按钮。

## 验证结果

| 检查 | 结果与覆盖 |
| --- | --- |
| `npm test` | 124 项通过。新增战斗逻辑覆盖近战准备／命中／冷却、防连点、撤退、箭保存与遮挡、目标稳定及追击、真实地图多人碰撞、回家付费恢复、单次奖励和容量、暂停与非法存档；另有发言清空和关闭领头后旧任务继续的回归。 |
| `npm run build` | 通过，包括 TypeScript 检查；保留现有 Vite 大包体积提示。 |
| 战斗桌面／手机浏览器 | 4 项通过。实际点击／触摸攻击、持续选中、移动、撤退、取消选择、暂停、保存重载、战利品、拖动平移，以及指挥气泡和不同视口设置布局。 |
| 后台生命周期浏览器 | 通过。战斗中的 visibility、blur、pagehide 全部冻结战斗与经济状态、居民和姿态；返回首帧不补算，仍需点击继续。 |
| `python3 tools/verify_character_library.py` | 600 组几何比较、993 组原动作轨道比较及两个骨架／绑定通过；180 个远景部件保持原属性。新攻击轨道追加约 77 KB，未复制完整职业模型。 |
| 气泡边缘布局 | 实际 UI/CSS 的 12 组位置检查通过，含 320／393／1280 宽视口、上下左右边缘、不同实际名称高度；尾部和名称保留间距。 |

浏览器使用云端 Chromium / SwiftShader。战斗浏览器用例通过正式存档解码器布置初始位置；领奖用例将敌人生命设为 1 以缩短等待，不能当作正式数值平衡测试。正常数值的命中、多人接近、地形和恢复另由逻辑测试覆盖。本轮运行相关用例，未宣称整个历史浏览器套件通过。

```sh
npm test
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- tests/e2e/combat.desktop.spec.ts tests/e2e/combat.mobile.spec.ts tests/e2e/lifecycle.desktop.spec.ts
python3 tools/verify_character_library.py
```

## 实际动作与布局证据

正式共享 GLB 增加 SwordSlash / BowShot，参数源为 [combat-actions.json](../../studies/characters/combat-actions.json)，同步保留 [characters.blend](../../studies/characters/characters.blend)。固定人体骨长，挥剑有抬手、下劈和收回，弓兵采用适合现有短臂比例的胸前抬弓、拉弦、释放和恢复。射箭时弓弦及搭箭跟手骨，隐藏原来静态手持箭，避免两支箭重叠；这两套动作均没有复用农民 Hammer。

已实际查看正面、侧面、游戏角度和手机缩小画面，并记录连续播放。录像和截图来自共享资源审查入口，游戏截图来自正式渲染和实际输入。连续周期通过原生 AnimationGroup 循环事件计数；固定相位还记录各骨骼的变换，不能用这些数值代替画面审查。

- [挥剑连续录像](evidence/infantry-cycles.webm)、[射箭连续录像](evidence/archer-cycles.webm)、[实际循环计数](evidence/cycles.json)。
- [挥剑准备](evidence/infantry-front-0.28.png)、[挥剑命中姿态](evidence/infantry-game-0.48.png)、[射箭侧面](evidence/archer-side-0.48.png)、[射箭手机视角](evidence/archer-mobile-0.48.png)。
- [桌面战斗](evidence/combat-desktop.png)、[手机战斗](evidence/combat-phone.png)、[清理后物资](evidence/outpost-cleared.png)。
- [手机气泡](evidence/speech-phone.png)、[320px 边缘布局组件检查](evidence/speech-edges-320.png)、[桌面设置](evidence/settings-desktop.png)、[矮屏设置](evidence/settings-820.png)。边缘组件截图独立检验 UI 布局，没有伪装成游戏截图。

复现动作检查：运行 `node tools/review-server.mjs`，另一个终端使用 `REVIEW_BASE=http://127.0.0.1:5174 node tools/review_combat.mjs`。Playwright 录像需可用 ffmpeg；本环境还设置 `PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright`。边缘组件检查运行 `node tools/review_speech.mjs`。

## 仍有的限制

首轮用于验证玩法闭环，试行数值尚未做长期平衡。射箭是现有短臂角色的简化动作，没有新增受击、倒地、拔箭及重伤表情；恢复时仍用原有站姿。多人密集交战时名称可能互相遮挡，后续可按选中和目标优先级进一步收敛显示。现有历史模型的原型还原状态不因本轮攻击审查而自动改变。

没有 iPhone 真机数据。软件 GPU 截图中的 FPS 很低，不能据此承诺真机帧率，也不能把模型复用和控制特效数量等同于手机性能验收完成。
