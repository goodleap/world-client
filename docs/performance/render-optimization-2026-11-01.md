# 渲染性能优化与验证（2026-11-01）

基线为远端 main 的 `99b9e80`，设计基线 `31ab9bd`，Babylon.js 9.32.1。任务由用户从检查明确转为实施；保留当前形体、平滑法线、动作、色彩层次和柔和阴影。未修改或重新导出角色 GLB。

## 实施结果

| 处理 | 实现及边界 |
| --- | --- |
| 角色材质合批 | `character-material-batching.ts` 比较除基色和标识以外的完整 PBR 参数；兼容纯色材质的基色乘入线性顶点色，再用原有 `batchSkinnedMeshes` 合批。已有位置、法线和蒙皮缓冲尽量直接共享，只在确有不同颜色的共享几何上分离。金属反射、皮肤和棉布等不同响应保持分离。 |
| 阴影剔除 | `rig-envelope.ts` 由逆绑定、顶点影响、骨骼链、动作平移/缩放上界计算完整动作范围。`shadow-culling.ts` 同时测试人物与太阳投影。不同材质共用一个角色范围；不支持的形变、加法动画或无法界定的轨道保留原路径。 |
| 静态冻结 | 经济资源的实例和模板矩阵冻结；角色共享材质冻结。门、人物、火焰、相机继续动态。`material-invalidation.ts` 在点光启停、阴影切换、光照设置变化时，通过公开 `markDirty(true)` 重新验证冻结材质，避免旧 Shader 继续显示过期光影。 |
| Shader | `matte-material.ts` 用原生 MaterialPluginBase 去掉黑色高光材质的 SPECULARTERM，纯颜色 detail 保留原采样但省去零强度法线/TBN 分支。保留 PBR 和原生光照/PCF；扩展绑定当前引擎版本。 |
| 压缩纹理 | 地面颜色、草笔触、道路、树叶、水纹离线生成 KTX2/UASTC，保留原尺寸、mipmap 和过滤。官方转码器、WASM、许可证随站点发布，使用一个可释放 Worker；原生选择 ASTC/BC7/ETC2。无合适格式或 KTX2 失败则使用 PNG。布局指纹变化则回到原生成器，地图尺寸仍由配置决定。 |
| 屏外动作 | `animation-visibility.ts` 暂停不影响当前画面及阴影的动作求值，按游戏时间累计相位；恢复时使用原生 `goToFrame/play`。选中单位和模型查看保持更新，攻击姿态仍以战斗时间采样。切换动作清除旧隐藏相位。 |
| CPU / GC | Combat 单位索引、属性缓存及最近目标单次扫描；居民同步复用位置、空路径与投影向量；不重复重置静止士兵变换/弓弦状态。高亮只在选择或 Mesh 增删时更新；名称、状态和气泡复用 DOM 引用及尺寸，隐藏时不做布局测量，相同位置/文字不重写。 |

既有树木/资源实例、分块草地 Thin Instances、原生空间剔除、角色和树木 LOD、后台停止渲染、点击拾取过滤和紧凑 UI 继续使用。

## 同视角绘制统计

云端 Chromium / SwiftShader，412×839 CSS 像素，移动设备输入配置，手机 1024 阴影图；固定相机位置、角度与正交视距，停止模拟和动作后采样。每一档渲染三帧，记录最后一帧。渲染调用与三角形包含主画面和阴影；采样不代表真机 FPS 或 GPU 耗时。

| 正交半高 | 绘制调用：前 → 后 | 阴影调用：前 → 后 | 提交三角形：前 → 后 |
| --- | --- | --- | --- |
| 18 | 697 → 308（减少 55.8%） | 447 → 140 | 1,867,156 → 1,495,966 |
| 40 | 715 → 326（减少 54.4%） | 447 → 140 | 1,910,326 → 1,539,136 |
| 77 | 797 → 452（减少 43.3%） | 448 → 228 | 2,378,450 → 2,312,810 |

本场景冻结矩阵从 634 个增到 827 个。数值来自 [测量记录](render-optimization/evidence.json)，对照图见 [优化前近景](render-optimization/before-near.png)、[优化后近景](render-optimization/after-near.png) 和 [优化后远景](render-optimization/after-far.png)。图片中性能 HUD 的软件渲染帧率不作为收益结论；手动固定视距采样时 HUD 保留此前正常游戏帧的数值。

上述静帧只比较 3D 渲染，DOM 标签锚点仍沿用停算前的位置。实际交互布局另见 [手机名称与气泡](render-optimization/speech-phone.png)、[短屏设置](render-optimization/settings-short.png) 和 [建造补给后的火堆](render-optimization/cooking-desktop.png)。

## 画面与功能验证

角色按农民、步兵、弓兵、骑兵分别对照 3 档 LOD、正面/侧面/游戏视角、移动/作业或攻击，共 72 组。每个角色的渲染部件从 25/27/30/40 个降到 14/15/14/19 个。除弓兵高精度侧面移动的一处边缘像素外，通道差异不超过 1/255；该处最大差异 10/255，仅 3 个通道超过 1，整图平均差异约 0.000026/255。实际查看了代表人物侧面、挥剑、射箭、骑乘刺击、远档轮廓及手机地图。对照只证明本次改造保留当前效果，不等于历史造型已经通过原型审查。

五张压缩纹理在实际 WebGL 中与对应 PNG 对照：512×512 输出下，RGBA 通道平均绝对差异为 0.006–0.128/255，最大 7/255；这不是无损编码。实际上传格式为 ASTC 4×4，含 mipmap 的五张纹理格式存储量估算从约 25.67 MiB 降至 6.42 MiB，未计驱动对齐和其他 GPU 资源。阻断 KTX2 请求后，PNG 回退可就绪并显示原尺寸。

类型检查、生产构建和 160 项逻辑测试通过。10 项桌面/手机浏览器回归均有成功记录，覆盖单兵连续移动与保存路线、骑兵/弓兵攻击、奖励运输、火堆与进食、名称和气泡、设置居中及光影设置暂停恢复。首批为 9 项通过、1 项建造点击落到左下角提示条；测试改为先平移到建造地点后，建造、光照、阴影三项在最终材质处理上重新通过，没有放宽游戏的建造或点击规则。

额外的实际 Shader 检查确认高光分支关闭、颜色 detail 分支启用，冻结材质的同一像素在火光关闭/开启/关闭时为 `[51,51,51] → [113,82,57] → [51,51,51]`。最后的几何缓冲复用调整又对照了农民和弓兵共 36 组，差异上界与前一轮一致。

## 复现与维护

```sh
npm ci
npm run typecheck
npm test
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- single-soldier.desktop.spec.ts single-soldier.mobile.spec.ts combat.desktop.spec.ts combat.mobile.spec.ts campfire.desktop.spec.ts campfire.mobile.spec.ts shadows-setting.mobile.spec.ts lighting.mobile.spec.ts
```

角色像素对照工具为 `tools/compare_render_optimization.mjs`，两个版本分别使用 `BASELINE_ORIGIN`、`CANDIDATE_ORIGIN`。两个 Vite 服务需使用各自独立的 `cacheDir`，不能共享 `node_modules/.vite`；否则会出现开发缓存过期 504，不能把这种加载失败误认为纹理解码故障。

完整地图统计用 `tools/inspect_render_scene.mjs`；压缩误差及回退用 `tools/verify_compressed_textures.mjs`；冻结光照及 Shader 分支用 `tools/verify_material_shader.mjs`。正式构建测试使用 Playwright 的独立预览端口，不受开发热更新影响。

纹理重建先在当前源码用 `?proceduralTextures=1` 导出原始 Canvas，再运行：

```sh
REVIEW_ORIGIN='http://127.0.0.1:4174/?proceduralTextures=1' REVIEW_OUTPUT=/tmp/world-paint node tools/inspect_render_scene.mjs
node tools/build_landscape_textures.mjs /tmp/world-paint /path/to/basisu
```

编码器为 Basis Universal 1.16.4，参数固定在脚本中；官方解码器与 Babylon 同为 9.32.1。提交生成的 KTX2、PNG、manifest 和本地解码器。地图尺寸、种子和实际生成位置自动参与指纹，跨 JS 引擎的无意义浮点尾差被规范化；修改绘制颜色/算法时增加 `texture-paint-key.ts` 的画法版本。不能用旧地图的图片冒充新布局重建。

## 保留项与限制

未将全部 PBR 换成自制卡通 Shader，未额外降低角色/建筑面数或阴影分辨率。现有高、中、远 LOD 保留，远景提交三角形仍较多，需要结合真机瓶颈继续评估。

未做静态阴影/AO烘焙，也没有冻结包含人物、门、可采集树木和可建造房屋的整张阴影图；地面颜色纹理不属于光照烘焙。没有全局 freezeActiveMeshes 或追加 GPU 遮挡查询。它们需要处理相机、LOD、建设、光照变化等失效条件，本轮通过有证据的合批和剔除减少开销。没有新增透明烟雾、辉光和后处理通道，也没有改变战斗、寻路或经济结算频率。

程序生成纹理原先没有独立的图片下载；本次五张 KTX2 共 1,720,379 字节（约 1.64 MiB），另按需加载解码器，换取压缩 GPU 存储、采样带宽及免除正常布局的 Canvas 绘制。PNG 仅在兼容/失败回退时下载。图片 URL 带布局指纹，防止换图后复用旧缓存，不能把这一改动宣传为减少了首屏下载量。

尚未验证真实 iPhone 的帧率、GPU 时间、峰值内存、耗电和温度，也未替所有旧设备验证 BC7/ETC2 路径；已验证的压缩路径是云端 ASTC，另有 PNG 回退。构建仍提示既有引擎分包大于 500 kB，这是后续加载体积优化项，不是本轮渲染验证失败。
