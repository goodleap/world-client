# 农民敲击与底部单位卡

2026-11-02，按本轮确认方案一起改造。基础为客户端 `529cf0b`、设计 `065dce8`，两者均与开始开发时的远端 main 一致。

## 敲击

统一动作源 `studies/characters/hammer.json`、`characters.glb` 与 `characters.blend` 同步更新。仅替换共享 Hammer，普通农民、农民二和领头沿用各自的原生 AnimationGroup；没有新增运行时 IK、特效或重复模型。

- 肩、肘、腕协同抬锤，手腕外展，让锤头从大头模型的外侧通过；不能仅把手沿竖直方向抬高，否则锤头会进入脸侧。
- 慢抬：相位 0.08–0.55；顶点停顿：0.55–0.61；快落：0.61–0.78；0.84 小幅回弹，0.94 回到落点。躯干轻微前倾、头部反向补偿，膝部缓冲，脚底保持支撑。
- 保留 1 秒原生循环，游戏满体力仍按原有 2 倍播放，即每次约 0.5 秒；低体力继续沿用原有 effort。任务时长、材料与产出结算仍由经济系统推进，不依赖动画循环数。
- 离线固定骨长 IK 生成 121 帧。对实际导出的四元数插值和蒙皮顶点采样 241 个相位：锤头中心上下行程由 0.67647 增至 0.90615 制作单位，增加 **33.95%**；支撑脚最大漂移 0.0000133，鞋底最低 0.00305，无穿地。所有几何、材质、绑定、骨架和其他动作逐字节核对保留。完整数据见 [hammer-metrics.json](evidence/hammer-metrics.json)。

```sh
python tools/build_hammer.py
python tools/verify_hammer.py --baseline /tmp/world-hammer/before.glb
blender -b -t 2 --python tools/sync_hammer_authoring.py
python tools/verify_character_library.py
node tools/review-server.mjs
node tools/review_hammer.mjs
```

`--baseline` 可省略；需要检查本轮未改动内容时，从修改前的 Git 版本提取共享 GLB 到临时文件。旧 `studies/farmer/` 仍仅为历史比较数据。

## 单位卡与建造

- 左下仍为「建造」，右下仍为恢复视角。选中单位的信息卡位于底部中间，桌面最大宽 240、手机最大宽 220 CSS 像素；窄屏随两侧按钮之间的可用宽度收缩。
- 常规单位卡约 87–89 像素高，显示名称、当前行为、生命与体力的当前／最大数值和细条。生命向上取整、体力向下取整，比例条保留真实值；低于 30% 使用醒目颜色。数据取自战斗与生理状态，每 0.25 个有效游戏秒刷新，选中时立即刷新。
- 骑兵另列骑手、坐骑的生命和体力；领头保留原有指挥开关。二者按实际内容增高，建造栏随之上移，不用固定偏移猜测卡片高度。
- 建造选择改为单行横排，超过手机可用宽度时原生横向滚动；点击进入放置，上拖保留拖拽建造。鼠标在无需滚动的完整菜单上仍可向任意方向拖出。水平滑动不触发建造，也不拖动地图。
- 展开菜单、进入或取消放置均保留单位选择与现有任务。放置模式中的地图点击优先处理建造。点击卡片和菜单不会穿透到场景。
- 切换单位立即替换内容；取消选中、选中士兵死亡后隐藏卡片。暂停冻结状态，未增加新的存档字段或恢复规则。头顶短名称和临时生命变化细条继续按原规则显示。

## 验证

类型检查、生产构建、25 项相关逻辑测试及 3 项浏览器用例通过。资源核验包括 600 个部件比较、522 条未改动历史动画通道，以及 180 个远景部件的几何／绑定一致性。

```sh
npm run typecheck
node --test --test-isolation=none tests/assets.test.ts tests/unit-info.test.ts tests/construction.test.ts tests/commands.test.ts
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test unit-card hammer.desktop --workers=1
```

浏览器用例运行生产构建。单位卡桌面／手机用例通过后，实际敲击用例单独复跑通过；云端低帧率下原生播放有效倍率会与游戏 250 ms 单帧上限同步降低，断言采用这一现有规则。实际锻制装备过程检查选中状态、实时行为、骨骼持续运动、暂停冻结和完成结算：仍为 16 个有效游戏秒，只扣 6 木、12 铁，装备等级只增加一次。

浏览器覆盖桌面 1280×900、手机 393×852、窄屏 320×568、矮屏 844×390，检查横排、滚动、拖拽、数值、选择、领头开关、骑乘双体数据、暂停和实际作业。动作审查使用 Babylon 的真实导出资源，包含骨架连续播放、正／侧面、游戏角度、120×150 缩小效果，以及侧面和游戏角度的连续录像。

录像由原生动画和渲染连续推进，每帧 16 ms、实际 2 倍工作速度；每两帧取一张图，以 31.25 fps 编码。它反映动作节奏，不代表设备渲染帧率。

- [桌面同时显示](evidence/card-build-1280.png)、[手机](evidence/card-build-393.png)、[320 窄屏](evidence/card-build-320.png)、[矮屏](evidence/card-build-844.png)、[骑兵与坐骑](evidence/mounted-phone.png)。
- [敲击侧面连续录像](evidence/hammer-side-motion.mp4)、[游戏角度录像](evidence/hammer-game-motion.mp4)、[骨架录像](evidence/hammer-rig-motion.mp4)。
- [连续帧对照](evidence/hammer-game-sequence.png)、[手机缩小举锤](evidence/hammer-mobile-0.55.png)。
- [真实作业桌面画面](evidence/hammer-working-desktop.png)、[真实作业手机宽度](evidence/hammer-working-phone.png)。

限制：云端 Chromium 使用 SwiftShader，不能据此推断真机 FPS；尚未在 iOS Safari 或实体手机上复测。本轮保留既有角色造型与网格，仅改善动作，不改变历史模型还原结论。
