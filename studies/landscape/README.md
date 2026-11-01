# 林岸地图样板 · 待视觉确认

依据用户于 2026-11-01 确认的地图与光影方案制作。视觉依据为对话中两张森林、曲线路面和自然水域参考图：借鉴环境配色、疏密与边界组织，保留现有 3D 人物，不转为插画角色。

本轮完成可运行的代表区域。全图其他区域的丰富化、额外植物和每局随机种子，等待样板反馈，不把本轮标记为整图美术完成。

## 预览

使用游戏本身的启动、交互与经营系统：

- `/?landscape=preview`：正常家园视角。
- `/?landscape=preview&view=wide`：树石组合、道路和湖岸的整体构图。
- `/?landscape=preview&view=shore`：湖岸近景。

预览使用固定种子 `20261101`，独立存档 `world-landscape-review-v1`。普通入口继续使用现有地图和存档。阴影开关沿用用户设置。

## 实现与边界

- Babylon.js 原生 Catmull–Rom 曲线描述湖岸；道路复用原生二次 Bézier 曲线，宽度随位置平滑变化。
- 湖面以一个原生 ribbon 表现岸边、浅水、深水，保留轻量水纹；本轮没有实时反射或动画水面。
- 湖岸多边形同时供水面、土地分类、连续碰撞、寻路与建筑禁放使用。新增多边形碰撞是对现有二维经营移动规则的适配，不另建渲染/物理引擎。
- 树冠使用共享的叶片色纹，树木保留原生实例化、三档 LOD；资源有稳定 ID、旋转、大小与间距约束。
- 地表有世界尺度的草土色块、随树林分布的林下底色、重复细节纹理和少量分簇草花。新建耕地或建筑继续清除占地内装饰。
- StandardMaterial 的颜色维持其原生 gamma 工作方式，PBR 人物保留原材质流程；调整补光/主光比例，不叠加全屏饱和度或曝光滤镜。
- 保留现有树木、房屋形体；新增一个不对称、顶部磨平的圆润岩石样板，替换预览中的方块石头。尚未批量扩展岩石或灌木种类。

## 验证与复现

```sh
npm test
VITE_E2E=true npm run build -- --outDir /tmp/world-landscape-review-dist
npm run preview -- --host 127.0.0.1 --port 4174 --outDir /tmp/world-landscape-review-dist
node studies/landscape/capture.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test tests/e2e/landscape.desktop.spec.ts tests/e2e/landscape.mobile.spec.ts
```

截图脚本支持按名称选择视角，以及 `REVIEW_URL`、`REVIEW_OUTPUT` 配置。截图保留实际 UI 与人物，未用合成效果替代游戏渲染。云端 SwiftShader 的 FPS 不能用于推断 iPhone 微信帧率；记录的是实际提交三角形、阴影三角形和绘制次数，手机持续运行与发热仍需设备验证。

## 本轮实际渲染审查

- [整体构图](review/wide.png)：家园留空、曲线路径、混合树石与连片湖面已可见；外围仍是待扩展区域。
- [湖岸近景](review/shore.png)：连续岸线、浅水色带、水纹、树冠叶片纹理和新岩石形体已实际渲染。
- [手机家园](review/mobile-home.png)、[手机湖岸](review/mobile-shore.png)、[手机整体](review/mobile-wide.png)：保留实际 UI、原有 3D 人物及正常材质。
- 本轮代表岩石的轮廓与体积已检查：主石不对称、顶部略平、底部有两块小石；最大水平半径 0.825，小于碰撞半径 0.85，任意旋转仍包在碰撞范围内。单簇 1,728 个三角形。
- 地表颜色已经与树木世界坐标对齐；光照没有采用全屏调色滤镜。材质、树冠与地面依然保留三维受光，未按参考图改为平面插画。
- [绘制量记录](review/rendering.json)：手机视口家园约 147 万三角形/帧、湖岸约 69 万、样板整体约 158 万，均包含阴影，视角和统计一并记录。角色动作、位置及相机变化会改变结果。

这些检查说明样板可供审看，不等于用户已接受最终视觉方向。森林疏密、色调、岸边宽度和石头比例仍接受本轮反馈。
