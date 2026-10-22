# NEXUS INTERSTELLAR · 星际穿越

版本 1.0 · 2026 年 10 月 15 日。HTML/CSS/ES Modules 与 Three.js 0.160.1 实现的交互观景台。页面文案、导航、按钮、卡片和弹层均为真实 DOM；黑洞独立实时绘制。

## 启动

需要 Node.js 18 或更高版本。

```bash
npm ci
npm run dev
```

访问 `http://localhost:5173`。可用 `PORT=8080 npm run dev` 指定端口。

```bash
npm run build
npm run preview
```

`dist/` 是可直接部署的静态产物。也可以用任意本地 HTTP 服务运行项目根目录；所有运行素材已放入 `assets/`，无需 CDN、远程字体、API 密钥或服务端账号。直接双击 `index.html` 可能被浏览器的 ES Module 跨源限制阻止，请通过 HTTP 打开。

正式挂载路径为 `https://strgo.com/nexus/`。源码集成到本仓库 `src/nexus/`，主站构建生成 `dist/nexus/`。在应用目录执行 `npm run sync:strgo` 同步，执行 `npm run check:integration` 只读校验；失效资源或依赖会停止同步并保留原集成副本。主站导航与返回入口保持原路径；当前部署边界见 [统一部署](../../DEPLOYMENT.md)，历史集成记录见 [NEXUS部署](../../NEXUS-DEPLOYMENT.md)。

## 入口与模块

| 文件 | 职责 |
| --- | --- |
| `index.html` | 真实 HTML 布局、可访问名称与图标 |
| `styles/main.css` | 界面、响应式断点、CSS 动效与玻璃弹层 |
| `src/app.js` | 唯一应用状态、交互、焦点、进入动画、25 秒场景演示、环境音 |
| `src/scene.js` | 主渲染器、统一场景时钟、离屏目标、尺寸、画质、生命周期 |
| `src/shaders.js` | 程序化星空、球面行星、黑洞透镜与盘面、地面反射 |
| `src/foreground.js` | 空间站、栏杆、地板、背向宇航员、五艘飞船、实例化碎石 |
| `src/fallback.js` | WebGL 不可用、上下文丢失时的 Canvas 2D 应急场景 |
| `src/scene-config.js` | 黑洞参数、种子、观景主题 |
| `src/content-data.js` | 目的地、档案、科技与展示数据 |

## 黑洞调参

修改 `src/scene-config.js` 中的 `sceneConfig.blackHole`。中心采用左上原点归一化坐标，渲染器转换至左下 UV；核心半径以视口高度归一化。桌面默认中心 `(0.69, 0.31)`，核心半径为视口高度的 11%，在 1920×1080 中直径为 237.6 CSS px。移动端中心 `(0.65, 0.26)`，核心直径为视口宽度的 25%。画质档只改变内部像素数，不改变核心构图尺寸。

> 配置值 `coreRadiusVH: 0.11` 表示视口高度的 11%，不是 CSS 字面值 `0.11vh`。

三组 `flowCyclesPerSecond` 分别驱动不同尺度的角向流纹；`inwardFlowSpeed` 控制径向纹理运动；`lensingStrength` 控制后景 UV 弯折。`diskTiltDeg`、`diskSpanVW`、`pulseAmount`、`glowEnvelopeHeightVH` 与统一 `exposure` 均已连接着色器。可在控制台通过 `window.nexus.config.blackHole` 临时调试；刷新后以文件为准。

合成顺序为：后景写入独立 RenderTarget → 采样该目标进行背景扭曲和盘面合成 → 暗核遮罩和窄亮环 → 前景几何 → HTML。不存在同一 RenderTarget 的反馈读写。发光采用局部解析近似，没有全屏 Bloom；暗核保持近黑。当前是艺术化实时近似，不是广义相对论光线追踪。

## 已实现的动效与交互

场景包括三层星点漂移及错相呼吸、星云噪声流动、球面行星地表与独立云层、远月缓移、三速盘面及径向卷吸、引力扭曲、实例化碎石收束、五艘分层飞船与独立引擎尾迹、分组窗灯及机械环、宇航员呼吸和背包灯、全息扫描/线框/小数据刷新、地面反射、四卡片预览及平滑鼠标视差。前景静态网格按材质合并，目前约 62 个网格；窗灯与碎石使用实例化。

六项导航、四张卡片、搜索、登录演示、菜单、四种手动观景主题、黑洞观测与聚焦、语言状态均有响应。本地档案可筛选，三个目的地可查看详情并生成演示航线。账号面板显著说明未连接账户系统，不收集凭据。

“开启星际旅程”执行约 3.3 秒场景合成，界面变暗、盘面提速、核心扩大、速度线出现，随后打开航线面板。可跳过、按 Esc 取消、返回观景台；重复触发锁定，恢复后释放按钮与焦点。25 秒概念片为明确标注的程序化场景演示。

弹层使用原生 `dialog`、Tab 循环、Esc、焦点恢复与页面滚动锁定。环境音默认关闭，用户主动开启后使用 Web Audio 合成轻声低频背景；暂停与页面隐藏时挂起音频。设置存于本地 `localStorage`。系统减少动态效果默认生效；此模式和暂停模式直接显示航线面板，不推进镜头。

统一时钟按 delta time 更新，页面隐藏后停止渲染、恢复时限制时间差。`window.nexus.dispose()` 释放 RAF、监听器、音频、RenderTarget、材质和几何。

## 画质

- 高：像素比上限 1.35。
- 中：像素比上限 0.9。
- 低：像素比上限 0.65，25 个碎石、3 艘可见飞船。
- 自动：桌面从中档开始、移动从低档开始；约 180 帧均值超过 22ms 时降档，约 600 帧稳定低于 14ms 时尝试升档，切换具有冷却时间。手动档优先。

`window.nexus.diagnostics()` 返回渲染模式、档位、像素比、绘制调用、资源数量与核心 CSS 尺寸。性能目标仍需真实设备验证。

## 测试与预览

```bash
npm test
npm run build
npm run test:browser
```

`npm test` 当前通过 23 项 DOM 交互与几何检查，包括搜索空结果、档案筛选、三个目的地流程、访客模式、暂停/减少动效、场景切换、进入/跳过/取消/恢复、焦点恢复、概念片退出及可复现几何。这是替换渲染器的 DOM 行为测试，不替代真实浏览器验收。

浏览器测试使用已安装的 Chrome，可通过 `NEXUS_CHROME` 指定可执行文件，或通过 `NEXUS_TEST_URL` 指向 HTTP 预览地址。覆盖六个指定尺寸、无横向溢出、CTA 与卡片关系、桌面一屏、交互、焦点、暂停、系统减少动效及上下文丢失。

```bash
# 页面截图、10 秒真实整页录屏、完整进入动画录屏
NEXUS_RECORD=1 npm run test:browser
# 额外 3 分钟帧率和资源稳定性记录
NEXUS_STRESS=1 npm run test:browser
```

真实浏览器素材将输出到 `artifacts/browser/`。录屏由页面截图与浏览器 MediaRecorder 合成，包含真实 DOM 和进入后的航线面板；截图采样实际帧数会写入报告。

当前开发沙箱拒绝本地端口监听（`listen EPERM`），并阻止 Chrome 的进程通信（`setsockopt: Operation not permitted`）。因此真实浏览器截图、两段完整页面录屏、六尺寸视觉验收与 3 分钟性能验收**尚未完成**，没有把它们标为通过。失败记录见 `artifacts/browser/report.json`。

为核验着色器，提供不依赖浏览器启动的实际 GLSL / EGL 测试：

```bash
npm run test:shaders
node tests/export-scene.mjs --animate
python3 tests/render-offscreen.py --animate
```

这套辅助脚本在当前 Linux 环境使用 Chrome 随附的 EGL/GLES 与 SwiftShader 库；其他环境需要调整测试脚本的库位置，网站运行源码不依赖这些路径。

已生成：

- `artifacts/scene-offscreen-1920.png`：实际背景、黑洞、地面 GLSL 与近似前景光照的离屏预览。
- `artifacts/steady-offscreen-10s.gif`：10 秒、6 fps 的离屏场景动效预览。
- `artifacts/approach-offscreen.gif`：核心接近过渡预览，不含结尾 DOM 航线面板。
- `artifacts/shader-report.json`：4 组着色器成功编译，GL error 为 0。
- `artifacts/pixel-checks.json`：离屏核心平均 RGB 为 0、核心直径 237.6px，九宫格各区均有独立时间变化。
- `artifacts/interaction-report.json`：23 项行为与几何检查通过记录。

这些离屏素材**不包含 HTML/CSS，不是首页截图或浏览器录屏**。离屏预览使用软件 GPU，渲染耗时不能作为交互帧率。

## 已知限制与待验收项

1. 工作目录未提供《星际穿越：宇宙探索界面(1).png》。构图依据需求中的坐标和描述，尚不能逐项对照原图。
2. 空间站、飞船和宇航员为程序化低至中复杂度几何，卡片为本地 SVG 图景；没有使用精细 glTF、照片或 AI 生成素材。工业细节与人物材质仍可继续完善。
3. 视差当前主要由背景 UV 与前景相机产生，前景世界内部共用相机，不是每个物体独立的分层偏移。
4. 四种主题采用小幅黑洞构图偏移和主题色；尚未制作四套完整独立建筑布景。不会闲置自动轮播，也不改变首页导航路径。
5. 地面为程序化透视反射遮罩，未使用平面反射相机或屏幕空间反射。黑洞亮环/光弧采用局部解析发光。
6. 无实际视频，概念片为程序化演示；无真实账户、支付、航班、地图或外部数据依赖。
7. Canvas 2D 是明确标注的应急模式，保留黑核与盘面遮挡，但没有正常 WebGL 路径的背景透镜扭曲和工业前景。没有图片纹理网络依赖，纹理失败情形由程序化后景自然规避。
8. V01/V03/V04/V05/V06、真实浏览器 F02/A01、P01 和上下文恢复均仍需在允许启动浏览器的环境完成。离屏图可验证 1920×1080 中黑核尺寸与清晰暗核，但不替代完整首页验收。

## 素材与依赖

见 `ASSETS.md`。所有网站资源均使用相对路径。运行时总文件体积约 1MB；不包含测试产物和开发依赖。Three.js 以固定版本在 `package-lock.json` 锁定，随项目提供本地压缩模块及 MIT 许可。

## 2026-10-23 本机浏览器补验

本机Chrome155（SwiftShader）已通过六种尺寸、搜索、设置暂停、旅程退出、观景/语言及交互脚本检查。搜索输入现在一次Escape即可关闭面板。6张截图见 `artifacts/browser/`；本轮未录屏，未执行180秒硬件性能测试。源码同步及主站构建另行通过。
