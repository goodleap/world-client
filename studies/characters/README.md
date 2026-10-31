# 统一人物资源与制作入口

2026-10-31 起，基础人体、20 根标准骨骼及全部人类动作统一在此维护。职业通过 `roles.json` 引用身体、衣物、装备和适用动作。马有独立的 17 根骨骼与动作；骑手使用基础人体的骑乘动作。

- `characters.blend`：统一 Blender 制作源。`BaseHumanRig` 上维护 Walk、Run、Hammer、CarryWalk、CarryRun、RideIdle、RideWalk、RideRun；`HorseRig` 使用 HorseRideIdle、HorseRideWalk、HorseRideRun。
- `Role.base/farmer/infantry/archer/cavalry` 集合引用同一批共享对象。默认仅启用基础人物集合；切换职业时只启用一个职业集合，避免衣物叠在一起。公共部件不是五份可独立修改的身体。
- `characters.glb`：游戏加载的共享身体、职业部件、两个独立 skin 和动作库。
- `characters-lod.glb`：对应 LOD 几何，不带第二套动画；运行时沿用角色实例的材质与骨骼。
- `roles.json`：职业部件清单与动作引用。拥有公共动作数据不代表角色获得相应玩法能力。
- `migration.json`、`authoring.json`：历史来源、文件校验和及制作源初始化记录。

当前所有角色都会进入同一地图，因此统一交付为两个 GLB；每份只下载、解析一次。未来如需按职业分包，应从此统一源导出公共包与差量包。不要恢复逐职业完整导出人体和公共动作。

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
