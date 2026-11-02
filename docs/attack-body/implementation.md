# 三兵种攻击的身体发力

2026-11-02，按用户确认一并调整步兵、弓兵、骑兵。沿用现有人物造型、共享 20 骨人体、独立 17 骨马匹和装备，修改三个共享攻击动作，保持攻击速度、伤害、移动及任务规则。

| 动作 | 身体配合与试行参数 |
| --- | --- |
| SwordSlash | 肩胯反向蓄力，转身斜下挥砍，屈膝下压后收招。胸部偏航 -18° → 17°，前倾最大 12°，根节点下压最多 0.025 制作单位；剑从大头外侧抬起，盾保持原来的斜握并跟随胸部。 |
| BowShot | 开胸拉弓时胸部后仰 14°、转体 10°；放箭后回正。头部抵消胸部旋转，视线保持水平，双脚支撑；弓、弦和搭箭继续跟随手骨。 |
| LanceThrust | 上身后收蓄力后前倾 17°刺出，再回到骑姿。骨盆、双腿和坐姿根节点固定，马保持独立站姿，避免骑手随整个人物根节点前扑而离鞍。 |

上述角度是参数源的局部增量；完整导出姿态另包含基础站姿和骨盆旋转。脚底接触检查在角色本地坐标中进行，弓兵沿用现有面向目标的整身转向。

参数源：[combat-actions.json](../../studies/characters/combat-actions.json)。`tools/build_combat_actions.py` 在离线阶段进行固定骨长手脚 IK，烘焙每个动作 61 个采样。拉弓手的前臂采用肘平面确定旋转，避免放下手臂经过反向姿态时翻转。运行时仍由 Babylon 原生 AnimationGroup 求值，无运行时 IK、新骨架或额外模型。

步兵／骑兵动作总时长仍为 0.228571 秒，弓兵为 0.271429 秒。`attackAnimationPhase` 将每个战士自己的前摇终点映射到共享动作的接触／松弦相位（0.475／0.579）；敌军不同前摇比例也同步。伤害、投射物、冷却和暂停仍由原战斗时钟负责，保存后按已有 attack.elapsed 继续采样。

## 验证与实际渲染

- `npm test`：218 项通过，包括友军／敌军不同前后摇与动作接触相位的对应。
- 生产构建包含 TypeScript 检查。
- 桌面／手机两项战斗浏览器回归通过：独立选择与攻击、拖拽、移动中断、取消选中、暂停时战斗与骨骼姿态冻结、保存及刷新继续。断言按当前战斗状态检查，避免把已完成攻击／移动或已淡出的短暂血条误判为失败。
- `tools/verify_combat_actions.py --baseline <修改前 characters.glb>`：检查每动作 241 个插值时刻；几何、材质、绑定矩阵、骨长及其他动作保持原值。步兵／弓兵足骨最大漂移约 0.000030／0.000011 制作单位，蒙皮鞋底保持地面上方，骑兵骨盆位置漂移为 0。详见 [metrics.json](metrics.json)。
- `tools/verify_shield.py`：原斜握盾牌的走跑轨道和弓兵独立持械姿态通过。
- 统一 `characters.blend` 同步三段动作，原几何、蒙皮权重、骨架及其他 Blender 动作逐项比对。
- 原生 Babylon 导出资源检查包含正侧面、游戏角度、150 × 180 手机缩小画面；侧面与游戏角度均连续播放超过两个完整周期，每 16 ms 取一帧。视频保留实际动作速度，连续帧图覆盖完整动作。此处为动作审查，未加入游戏中的攻击冷却间隔。

| 角色 | 侧面连续帧 | 游戏角度连续帧 | 原速视频 | 手机关键姿态 |
| --- | --- | --- | --- | --- |
| 步兵 | [连续帧](rendered/infantry-side-sequence.png) | [连续帧](rendered/infantry-game-sequence.png) | [视频](rendered/infantry-game.mp4) | [挥砍](rendered/infantry-mobile-0.475.png) |
| 弓兵 | [连续帧](rendered/archer-side-sequence.png) | [连续帧](rendered/archer-game-sequence.png) | [视频](rendered/archer-game.mp4) | [拉弓后仰](rendered/archer-mobile-0.53.png) |
| 骑兵 | [连续帧](rendered/cavalry-side-sequence.png) | [连续帧](rendered/cavalry-game-sequence.png) | [视频](rendered/cavalry-game.mp4) | [前倾刺击](rendered/cavalry-mobile-0.475.png) |

复现：先运行 `node tools/review-server.mjs`，再运行 `node tools/review_attack_body.mjs`。中间帧写入云端临时目录，交付保留关键姿态、连续帧图、视频和浏览器错误记录。

GLB 从 21,262,340 增至 21,334,632 字节，增加 72,292 字节（约 70.6 KiB）；共享几何、LOD 与其他动作未复制。本轮使用云端 Chromium 软件 WebGL 和手机视口，未做实体手机帧率／功耗测量；不改变历史模型造型审查结论。
