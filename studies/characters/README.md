# 统一人物资源与制作入口

2026-10-31 起，基础人体、20 根标准骨骼及全部人类动作统一在此维护。职业通过 `roles.json` 引用身体、衣物、装备和适用动作。马有独立的 17 根骨骼与动作；骑手使用基础人体的骑乘动作。

- `characters.blend`：统一 Blender 制作源。`BaseHumanRig` 上维护 Walk、Run、Hammer、CarryWalk、CarryRun、RideIdle、RideWalk、RideRun、SwordSlash、BowShot、LanceThrust；`HorseRig` 使用 HorseRideIdle、HorseRideWalk、HorseRideRun。
- `Role.base/farmer/infantry/archer/cavalry` 集合引用同一批共享对象。默认仅启用基础人物集合；切换职业时只启用一个职业集合，避免衣物叠在一起。公共部件不是五份可独立修改的身体。
- `characters.glb`：游戏加载的共享身体、职业部件、两个独立 skin 和动作库。
- `characters-lod.glb`：对应 LOD 几何，不带第二套动画；运行时沿用角色实例的材质与骨骼。
- `characters-far-lod.glb`、`far-lod.json`：普通地图远景几何及生成记录。Babylon 按正交视野面积在 120 / 320 平方单位处选择近、中、远三档；阴影相机也使用远景档。各档共享实例的材质、骨骼和动作。
- `roles.json`：职业部件清单与动作引用。拥有公共动作数据不代表角色获得相应玩法能力。
- `migration.json`、`authoring.json`：历史来源、文件校验和及制作源初始化记录。

当前所有角色都会进入同一地图，因此统一交付为共享模型及中、远景两档 LOD；每份只下载、解析一次。未来如需按职业分包，应从此统一源导出公共包与差量包。不要恢复逐职业完整导出人体和公共动作。

旧 `base-human/`、`farmer/`、`soldiers/`、`shared-actions/` 与 `lod/` 中的完整导出和制作脚本保留作迁移对照、历史参数说明；它们不再是游戏资源或人类动作的更新入口。**后续修改使用这里的统一源，不能在农民或士兵旧文件中另改公共动作。** 原造型仍有还原差距，本次共享不表示视觉审查通过。

## 本次迁移与验证

共享 GLB 直接重排原始 glTF accessor、材质与动画引用，没有通过 Blender 重导出运行时模型，没有减面或重采样。Blender 源从该共享库初始化；Blender 4.3 导入时会合并共父节点下的 skin，初始化脚本已把马与人体重新分成两个制作骨架。此制作源尚未用于替换本次逐字节核验的运行时文件，未来任何重导出都要经过引擎审查。

离线迁移只补充引擎不处理的发布文件去重。运行时使用 Babylon 9.32.1 原生 `LoadAssetContainerAsync`、`instantiateModelsToScene`、`Geometry.applyToMesh`、`AnimationGroup` 和 LOD；共享几何、材质和不变的关键帧数据，实例各有骨架、目标节点和播放状态。农民的混合参数单独复制，避免修改其他人物。

```sh
python3 tools/verify_character_library.py
node tools/review-server.mjs
node tools/review_character_migration.mjs
```

重新核对历史迁移时用 `python3 tools/migrate_character_library.py --output /tmp/character-migration-check`，不要覆盖现行资源。`create_character_authoring.py` 只用于首次初始化，也拒绝覆盖已有源文件。新制作时保留 `partId`、骨骼名、绑定和职业对应关系，导出到候选目录；核对连续动作、必要侧面、游戏视角及手机缩小显示后才替换正式 GLB。代码检查和数值一致不能代替新的原型还原审查。

## 远景档生成

Babylon 的运行时简化器不保留所需蒙皮属性，因此使用离线 meshoptimizer 1.3.0，运行时仍由原生 `Mesh.addLODLevel` 切换。生成器从现行共享中景资源选择原有顶点，逐字节保留这些顶点的全部属性；锁定混合骨骼权重及骨骼交界顶点，不改骨架、材质、动作和近景资源。目标面数为中景的 22%，同时受 0.008 模型单位的简化误差上限、关节锁定及边界限制；小于 600 面的部件保留。误差是简化器的估计值，仍需渲染检查。

```sh
npm install --prefix /tmp/world-lod-tool meshoptimizer@1.3.0 --no-audit --no-fund
node tools/build_character_far_lod.mjs /tmp/world-lod-tool/node_modules/meshoptimizer/index.js
python3 tools/verify_character_library.py
```

远景档不携带动画，发布文件额外约 3.18 MB；普通应用构建不运行此生成器，也不包含 meshoptimizer 运行时依赖。

## 首轮战斗动作（2026-11-01）

统一库包含 `SwordSlash`、`BowShot` 与 `LanceThrust`，由同目录 `combat-actions.json` 定义手部目标、准备／释放／恢复相位。`tools/build_combat_actions.py` 使用既有 CarryWalk 中性姿势（步兵/弓兵）或 RideIdle 坐姿（骑兵）和固定 20 根骨骼，以两节 IK 生成 31 个均匀相位样本；只追加动画 buffer，原几何、权重、绑定和原有移动作业轨道逐字节保留。`tools/sync_combat_authoring.py` 把这三个动作同步到现有 `characters.blend` 的 BaseHumanRig，保留原有部件和动作；后续修改保持参数源与制作源同步。

```sh
python3 tools/build_combat_actions.py
blender -b -t 2 --python tools/sync_combat_authoring.py
python3 tools/verify_character_library.py
```

生成工具需要 numpy/scipy；它们不是游戏运行时依赖。脚本重跑替换自己的动画区段，不无限追加未引用数据。弓弦端点来自原资源手骨绑定空间，记录于 `bow-string.json`；射箭期间用 Babylon 原生可更新线段显示弓弦和搭箭，准备／释放由统一动作阶段驱动。击中计算不依赖动画或渲染回调。

使用实际 Babylon 动作审查：启动 `VITE_E2E=true npm run dev -- --host 127.0.0.1 --port 5175`，运行 `node tools/review_combat.mjs`，会记录完整周期、正侧面／游戏／手机截图与骨架样本。录像需要 Playwright 可用的 ffmpeg；本云环境通过 `/workspace/.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux` 使用已有 `/usr/bin/ffmpeg`，相应运行命令加 `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright`。

当前攻击节奏为旧版 3.5 倍；骑兵长枪刺击保留 RideIdle 根与下肢姿势，独立马骨架使用原站姿的原生常量轨道同步采样。完整三兵种审查使用 `node tools/review_combat.mjs /tmp/combat-review cavalry,infantry,archer`，结果见[本轮交付](../../docs/combat-and-auto-feeding/implementation.md)。

## 舒展奔跑与疾驰

`locomotion.json` 是当前 Run、CarryRun、RideRun、HorseRideRun 的统一参数源。人物增加跨步、收腿、肩胯配合；马使用后肢到前肢依次触地的四拍疾驰，骑手根节点与马鞍变换一致。保留 20／17 根骨架、所有几何、绑定、Walk、作业及攻击轨道。旧逐职业 Run 只供历史对照，不能再用于覆盖当前动作。

动画参考速度与游戏移速已分离。人物参考速度为 4.8，马为 6.96，原生周期均为 0.34 秒；人物满速实际周期约 0.326–0.355 秒。移动、体力、寻路、避让及经济时钟不变。

```sh
python3 tools/build_locomotion.py
python3 tools/verify_locomotion.py
python3 tools/verify_character_library.py
blender -b -t 2 --python tools/sync_locomotion_authoring.py
REVIEW_ORIGIN=http://127.0.0.1:4174 node tools/review_locomotion.mjs
```

生成器从当前共享库的中性姿态和固定骨长计算离线 IK，运行时只使用 Babylon AnimationGroup。输出重建会压紧未引用的动画 buffer，重复生成不增长文件；重建攻击也保留新奔跑轨道。数值检查直接读取导出后的四元数插值、蒙皮鞋底及马蹄，检查地面接触、循环和鞍座关系。Blender 同步工具只替换四个动作，保留其他制作内容。

审查记录及视频见[奔跑改造记录](../../docs/locomotion/implementation.md)。视频以确定相位渲染并按当前移速编码，用于判断动作节奏，不代表录制设备帧率。当前造型的历史还原结论不因本次动作改造而改变。

## 扩大敲击幅度（2026-11-02）

`hammer.json` 维护共享 Hammer 的手部目标、腕部方向、躯干和重心曲线。`tools/build_hammer.py` 从当前共享 Walk 中性姿势以固定骨长生成 121 帧，只替换 Hammer；`tools/sync_hammer_authoring.py` 同步统一 Blender 源中的同名动作。旧逐职业 Hammer 仅供历史比较。

锤头中心上下行程约增加 34%，采用慢抬、快落、短暂停顿与小幅回弹。保留 1 秒原生周期、游戏 2 倍满体力播放及所有玩法结算。运行时无新增求解器、特效或动画副本；现有各角色播放实例继续独立。

```sh
python3 tools/build_hammer.py
python3 tools/verify_hammer.py
blender -b -t 2 --python tools/sync_hammer_authoring.py
python3 tools/verify_character_library.py
node tools/review-server.mjs
node tools/review_hammer.mjs
```

数据检查和实际引擎连续播放、游戏／手机视角证据见[敲击与单位卡记录](../../docs/hammer-unit-card/implementation.md)。
