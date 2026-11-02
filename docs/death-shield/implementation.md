# 第二批：俯卧退场与自然持盾

2026-11-02。接续统一战斗目标与路径反馈，不修改作业、移动或攻击结算速度。

## 结果与参数

- 所有人类按自身朝向向前倒，最终面朝下；狗、狼和马保留侧卧。死亡状态和奖励仍由逻辑层决定，表现层不会造成复活或再次掉落。
- 倒地 0.6 游戏秒、落地停留 2 秒、下沉 3 秒，共 5.6 秒。原生 AnimationGroup 按存档游戏时间采样，暂停冻结，重载直接恢复当前阶段；已退场对象不重新播放。
- 骑兵分为保留各自骨架的骑手和马两个变换组。骑手从已有 RideIdle 展开至 Walk 初始姿态后俯卧，横移 1.15、前移 0.1；马向另一侧横移 0.15 后侧卧。各自使用实际蒙皮顶点计算接地与完全沉没高度，不改骨长、比例或蒙皮。
- 普通尸体在第一次播放时读取一次姿态；骑手展开姿态在 25 个采样点计算一次接地轨道，之后只采样缓存的原生动画，没有逐帧顶点读取、布娃娃或新增渲染通道。
- 盾牌随左腕向外转 25°、略倾 -8°，手掌与盾一起运动。ShieldWalk／ShieldRun 复用原动作的其余 59 条轨道，SwordSlash 同步持盾方向；弓兵保持原 CarryWalk／CarryRun。几何、20 根人体骨架、17 根马骨架和动作节奏不变。

共享制作源为 `studies/characters/shield.json`、`characters.glb`、`characters.blend`；`tools/build_shield_pose.py` 与 `tools/sync_shield_authoring.py` 同步运行时资产和 Blender 动作。GLB 增加约 15 KB，不增加角色模型。

## 实际渲染检查

`tools/review_death_shield.mjs` 使用实际游戏共享角色库、LOD、死亡实现和 Babylon 原生动作。检查了步兵、弓兵、农民、骑兵、狗、狼的正侧面、游戏角度和手机缩小画面。以下是保留的连续渲染与关键画面：

- [骑兵完整退场视频](evidence/cavalry-death.mp4)／[连续帧](evidence/cavalry-death-sequence.jpg)：骑手俯卧、马侧卧、分离落地、停留及完全下沉。
- [步兵行走](evidence/infantry-ShieldWalk.mp4)、[奔跑](evidence/infantry-ShieldRun.mp4)、[攻击](evidence/infantry-SwordSlash.mp4)：实际原生动作连续运行，各 120 个渲染帧；左腕与盾共同运动，未发现新增明显穿插或形变。
- [持盾正面](evidence/shield-hold-front.png)／[侧面](evidence/shield-hold-side.png)／[游戏角度](evidence/shield-hold-game.png)。
- [骑兵游戏角度](evidence/cavalry-prone-game.png)／[侧面](evidence/cavalry-prone-side.png)／[手机缩小](evidence/cavalry-prone-mobile.png)。
- [农民](evidence/farmer-prone-game.png)、[弓兵](evidence/archer-prone-game.png)、[步兵](evidence/infantry-prone-game.png)、[狗](evidence/dog-prone-game.png)、[灰狼](evidence/wolf-prone-game.png)。

骑兵落地后实际蒙皮顶点最低世界 Y：骑手 0.0149999857，马 0.0149999857；地面为 0。骑手初始最低点 0.79224，倒地 0.2 秒时为 0.2962，0.4 秒起接地。使用实际几何检验，未以包围盒或截图估计替代接地检查。

## 验证

- TypeScript 类型检查通过。
- 死亡、通用目标及死亡存档逻辑测试 10/10；覆盖四种朝向的俯卧方向、地面接触、暂停、下沉、过期尸体、唯一奖励与死亡后禁用恢复和指令。
- `tools/verify_character_library.py`：600 个共享 primitive、522 条基础动作轨道匹配，180 个远景 LOD 部件，骨架与几何保持一致。
- `tools/verify_shield.py`：两种盾姿动作仅左腕旋转改变，其余 59 条轨道及时间完全一致，职业绑定正确。
- 生产构建通过；实际游戏 `death.desktop.spec.ts` 浏览器回归 1/1，通过步兵、弓兵、骑兵、敌兵、农民、狗与狼的死亡退场、暂停、保存重载及奖励只结算一次检查（约 48 秒）。

当前限制：云端 Chromium 使用软件 WebGL，连续动作录像关闭阴影以完成采样，静态审查保留游戏阴影。手机结果为浏览器视口／缩小渲染，尚未进行实体手机 GPU 性能测试。骑兵分离偏移针对当前模型标定，未来不同坐骑需要重新校准。
