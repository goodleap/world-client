# 移动连续性、圆形骑兵碰撞与哨塔防御

2026-11-03。本批从远端 `main` 的 `722c88c` 继续修改；设计仓库基线为 `efe5c0b`。没有回退旧提交。

## 实际原因与修复

对比 `722c88c` 与此前路线实现，并在真实混合编队检查中复现，确认四处会造成移动顿挫或等待：

1. 骑兵胶囊要求朝向误差缩小到 0.04 弧度以内才允许位移。转向阶段返回零速，开始移动、转弯和改目的地都会重复触发。改为半径 0.6 的圆，删除方向 A*、转身扫掠及先转后走限制；朝向以最短转角平滑跟随移动，同时推进位置。
2. 所有角色走到一个短路段末端后，丢弃当前逻辑步剩余的位移预算。在 50 ms、速度 5 的案例中，应走 0.25，实际只走到距离 0.01 的路点。现在逐段花完预算，每一段仍做精确圆形扫掠。步频按实际路程计算；渲染插值沿本步经过的折线，避免直接连接起终点切穿墙角。
3. 前瞻检查把同向移动者也当成必须停等的阻挡，固定重试计时即使在道路已清空时仍禁止移动。40 步跟随案例原本停 9 步，只前进 4.65；现在停 0 步，前进 6。队列按实际净空推进，每步重查能否通过，计时只限制绕行搜索。对向、横穿、真正拥堵、空闲友军让路仍保留原有行为。
4. 混合编队中，后到的骑兵优先要求已到位弓兵让路，弓兵却会在两个仍挡路的位置间反复挪动。真实浏览器记录到骑兵累计等待超过 53 游戏秒、没有开始绕行。现在有安全侧向绕路时先绕过队友，狭窄通路或目标被占用时仍可让路；复现测试与手机视口的四人混合编队检查均确认全部到达、没有物理重叠，已到位队友保留各自位置。

最小前后对照数据见 [logic-comparison.json](logic-comparison.json)。其中骑兵 `facing` 是路线执行器返回的期望朝向；角色实际朝向仍通过平滑转角更新，逻辑测试检查首次位移与渐进转身同时发生。

`d8d711b` 引入的固定逻辑步、原生 TransformNode／四元数表现插值，以及每渲染帧推进 AnimationGroup 的机制仍然有效。本批沿用这些机制，只补充拐角内实际路径的插值数据；模型、骨架和动作资源未改。真实受阻时仍可以待机，正常转弯及改令不会反复重启动作。

## 统一尺寸与战斗数值

| 角色 | 物理形状 | 半径 |
| --- | --- | ---: |
| 农民 | 圆 | 0.29 |
| 步兵 | 圆 | 0.4 |
| 弓兵 | 圆 | 0.4 |
| 骑兵 | 圆 | 0.6 |

定义、招募、Worker 规划、实时路线采纳、移动、邻居避让、占位和目标预约共用物理尺寸。狗 0.54、狼 0.72 保持原值。胶囊专用分支与几何检查已清理，建筑原有圆形／矩形／多边形规则保留。

骑兵历史值 1.12 单独保留为战斗接触尺寸，供既有近战射程补偿和接近站位使用，不再作为物理碰撞半径。移速、射程、攻击间隔和伤害未因碰撞体缩小而调整；追击移动目标仍逐逻辑步更新畅通的直接接近点，保留目标运动预测。

哨塔统一配置为生命 500、防御 20。界面与实际伤害结算从同一配置读取，沿用 `max(1, 攻击 × 20 / (20 + 防御))`：150 攻击扣除 75 生命，满血哨塔剩余 425。

## 验证记录

125 项相关逻辑测试通过，覆盖短路段和绕墙角、清空道路后恢复、同向队列／对向避让／让路、圆形净空、Worker 路线采纳、混合编队到位、移动目标追击、插值与动画时钟、哨塔及伤害，并回归危险作业暂停恢复、拆除、多人火堆进食和编队反馈。

```sh
node --test --test-isolation=none tests/route-following.test.ts tests/circle-crowd.test.ts tests/work-navigation.test.ts tests/pathfinding.test.ts tests/navigation-queue.test.ts tests/combat.test.ts tests/combat-moving-target.test.ts tests/building-health.test.ts tests/render-motion.test.ts tests/performance-clock.test.ts tests/locomotion.test.ts tests/towers.test.ts tests/demolition-danger.test.ts tests/raids.test.ts tests/campfire.test.ts tests/move-feedback.test.ts
npm run typecheck
npm run build
```

类型检查及生产构建通过。Vite 仍提示已有的大分包体积警告。

6 项浏览器回归通过，使用生产构建与真实鼠标／触摸输入：步兵、骑兵、弓兵均能命中撤退目标，暂停冻结战斗；骑兵绕火堆、建筑拾取与安全拆除通过。混合编队检查从触摸事件开始采集所有帧，确认四类角色均进入跑步、编队中心正确、各自到位且没有物理重叠；同一场景核对[哨塔界面](tower-500-20.png)为 500/500、20。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- tests/e2e/movement-continuity.mobile.spec.ts tests/e2e/combat-moving-target.desktop.spec.ts tests/e2e/safety-demolition.mobile.spec.ts tests/e2e/fire-collision.desktop.spec.ts
```

连续动作审查使用实际游戏、Babylon WebGL 与导出 GLB，不是孤立动作播放器。`tools/review-movement-continuity.mjs` 在本地 Vite 响应中注入检查入口，按每帧 1/60 游戏秒推进，逐一保存所有连续渲染帧、位移、骨骼姿态、动画播放事件，并生成 60 fps 录像。逐帧顺序审看整个运动序列；受控游戏时间用于检查运动连续性，不是硬件帧率测量。注入入口不进入游戏发布代码。

四类角色各连续记录 165 帧，在第 45、90、120 帧改目的地，包含直行、直角转向和反向改令。起步后每帧可见位置、骨骼姿态均继续变化，途中待机帧数均为 0；每类对应的原生 Run／ShieldRun／CarryRun／RideRun 均只启动一次。画面中步态连续，骑兵在位移中完成转向，没有原地转完才走或转向时重置步态。

- [农民连续奔跑](farmer.mp4)
- [步兵连续移动](infantry.mp4)
- [弓兵连续移动](archer.mp4)
- [骑兵连续转向](cavalry.mp4)

农民完整搬运另记录 156 个连续帧：走到地面木材、转向送仓、绕过路边居民、抵达仓库。第 2～154 帧连续奔跑，途中没有待机或重启 Run；第 155 帧完成送达后才待机，库存木材从 8 增至 16。逐帧审看确认取货转向、绕过步兵和居民、到门口的运动连续。[完整搬运录像](haul.mp4)及[五场景检查摘要](browser-review.json)一并保存。

复现连续渲染检查需要本机 Chromium 和 FFmpeg：

```sh
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
# 另一终端；可用 MOTION_REVIEW_SCENARIOS 指定逗号分隔的单项场景。
MOTION_REVIEW_DIR=/tmp/world-motion-review node tools/review-movement-continuity.mjs
```
