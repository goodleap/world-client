# 随机灰狼袭击：首批交付记录

2026-11-02。承接用户批准的灰狼原型与开发任务，并落实“身体是毛色层次，不是凸起物”的最新纠正。设计入口在 world-design `玩法设计/战斗系统/野兽袭击与家园防守.md`；试行数值集中在 `数值设计/狼群袭击试行参数.md`。未开发需求清单或其他动物。

## 当前行为

- 四分钟开局保护，第一群两只，后续按建筑、装备与随机量在二至五只内选择；上一群结束四至七个游戏分钟后再来。防守者严重受伤则推迟。真实外围可达路径、屏幕外与居民／建筑距离检查，未找到合适点就等待。
- 来袭方向为短暂、可点击查看的提示，不强制镜头，不添加常驻战斗操作。保持单兵选中、点地移动与点狼攻击。
- 狼沿现有路线与人群避让接近，稳定选敌、分散包围；撕咬有准备、一次命中和恢复，弓箭仍沿原先投射物管线命中。
- 农民与狗避险时保留作业进度和实际物资，安全后继续调度；附近空闲士兵援护，有固定追击起点，手动指令优先。
- 燃烧中的火堆累积驱赶作用。狼可在火堆边完成短动作后拿走一份现成餐食；不扣仓库、不动原粮、在途货物或已领取的餐份。拿到食物、受重伤、同伴损失一半或袭扰超时后沿路退场。
- 被击败的狼落地两份粮食，携食再加一份；仍须搬运入仓，不直接加库存。未击败不给奖励。我方仍无永久死亡，沿用火堆缓慢恢复。
- v10 存档保存种子、时间、狼生命／路线／攻击／携食／结算、避险与士兵援护起点；v9 显式保留原进度并增加保护期。设置、画面预览及后台继续使用统一暂停时钟，不补算离线袭击。

## 模型与实际渲染

`studies/wolf/build_wolf.py` 是独立、参数化的制作源，使用批准原型，没有复制旧 Demo 狗。躯干、背部与尾部用连续表面和灰／暖白顶点色表达毛发分区；脸颊、胸颈与头顶仅保留影响轮廓的少量毛束。

先审查单只静态模型，再以固定 16 骨架验证运动。躯干采用 Blender 原生 bone heat 自动权重，四影响上限；离线双段 IK 给出固定关节轨迹，实际导出资源由 Babylon 原生 AnimationGroup 播放。Idle、Run、Bite、Hurt、Feed 来自同一份资源。奔跑按实际位移推进相位，动画不负责伤害结算。

- [正面](evidence/wolf-front.png)、[侧面](evidence/wolf-side.png)、[背面](evidence/wolf-back.png)、[游戏角度](evidence/wolf-game.png)、[手机缩小](evidence/wolf-mobile.png)。
- [制作阶段骨骼／足部连续周期分相](evidence/rig-phases.png)、[发布模型奔跑／撕咬分相](evidence/wolf-phases.png)、[中景 LOD](evidence/wolf-mid-lod.png)、[远景 LOD 分相](evidence/wolf-far-lod-phases.png)。每条检查片段先执行三个原生循环，再记录侧面与游戏角度的 24 个相位；人工检查相位图与必要大图。
- [奔跑片段](evidence/Run-side.mp4)、[撕咬片段](evidence/Bite-game.mp4)由这些真实 Babylon 渲染帧输出，非概念动画。
- [桌面游戏](evidence/desktop.png)、[手机游戏](evidence/mobile.png)、[游戏内攻击](evidence/bite.png)。检查了与人物、骑兵、门窗和地面的相对尺寸、毛色、名称与提示间距。

实际观察并修正过躯干颜色被误做成凸起、动作中腹部权重拉扯及提示紧贴作业按钮的问题。量化检查覆盖 121 个奔跑姿态：最低脚掌高约 0.0014，最大骨长误差约 1.4e-7，循环接缝 0、超出骨长的 IK 截断 0。数值与测试不能替代以上渲染检查，也不代替用户最终美术评价。

## 资源与运行成本

实际发布 GLB 为 2,697,896 字节、一个 skin、一个不透明材质、五个动作。近／中／远几何分别 43,244／17,296／7,206 个三角形，每层一网格。运行时使用 Babylon `AssetContainer.instantiateModelsToScene` 克隆最多五个独立骨骼，保留共享几何、材质和动作键；以原生 Mesh LOD、视锥和原有阴影管线渲染。不同骨骼姿态不适合直接使用普通 Thin Instances，未另造蒙皮实例化系统。

没有新增毛发粒子、点光源、后处理或额外渲染循环。不可见狼停止姿态采样，时间与移动仍由模拟推进；目标决策降频，寻路沿用带扫掠碰撞的既有实现。三角形和资源统计只说明开销范围，不能换算为 iPhone 帧率提升。

## 验证与复现

- `npm test`：176 项逻辑测试通过，其中 12 项新增袭击测试；覆盖多随机种子／五只上限、真实地形进退、围攻分散、准备与冷却、弓箭重载命中、火堆驱赶和抢食、单次地面掉落、手动优先、援护边界、暂停与 v9 升级。
- `npm run typecheck` 与 Vite 生产构建通过。构建保留既有大 chunk 提示，未把它当成手机性能数据。
- 云端 Chromium 桌面及 Pixel 7 视口：狼群点击攻击／移动保留选中、独立骨骼与共享几何、设置冻结、后台暂停／手动继续及保存重载；另回归火堆建造、仓库配送、烹饪、受伤恢复、半份餐重载和手机嵌套设置。四条相关浏览器回归通过。

```sh
npm test
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test raids.desktop.spec.ts raids.mobile.spec.ts campfire.desktop.spec.ts settings.mobile.spec.ts
blender -b --python studies/wolf/build_wolf.py
blender -b --python tools/check_wolf_motion.py
# 另启 Vite：npm run dev -- --host 127.0.0.1 --port 4175
REVIEW_MOTION=skin REVIEW_CLIPS=Run,Bite node tools/review_wolf.mjs
REVIEW_LOD=2 REVIEW_MOTION=skin REVIEW_CLIPS=Run,Bite node tools/review_wolf.mjs
```

## 保留限制

首批只有普通灰狼，尚未加入建筑破坏、狼王、其他野兽或昼夜。数量、频率和强度属于试玩参数；目前的单位少，集中留守通常能较快击退第一群，外出时更容易影响生产。镜头覆盖所有合法出生点时事件延后；出口后来被建筑封住时继续等路，不能穿墙退场，该群结束前也不会叠加下一群。

云端软件 WebGL 与手机视口用于功能和画面检查，未进行真实 iPhone 性能或触摸测试。
