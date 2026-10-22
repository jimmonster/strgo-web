# DREAMS · Nature, Memory, and Cinema

2026-10-15 · v1.0 · 黑泽明《梦》的独立视觉致敬。原生 HTML、CSS、JavaScript 与本地 Three.js，默认英文与 `design` 内容模式。

这是可运行的实现初版，包含三段首页、八个真实存在的独立 HTML 梦境页、程序化实时 3D 场景，以及画廊、主题、搜索、英日翻译和环境设置。尚未完成全部视觉与浏览器验收，具体见下面的验证边界。

## 启动

需要 Node.js 20 或更新版本：

```bash
cd /root/dreams
npm ci
npm run build
npm run dev
```

浏览器访问 `http://localhost:5173/`。`PORT=8080 npm run dev` 可调整端口。静态产物在 `dist/`；可部署到支持目录索引的静态服务器。运行时资源均在项目内，无 CDN、远端字体、后端服务或密钥要求。不要通过 `file://` 直接打开 ES 模块页面。

当前交付已包含生成好的 HTML、插画和 vendor 文件；`npm run dev` 也可直接预览。开发时直接修改 `src/` 或 `styles/`，重新运行 `npm run build` 更新静态产物。修改 HTML 模板需编辑 `scripts/pages.mjs` 再构建。

## 页面与操作

- `/`：花园主画境、八梦章节带、五主题睡莲区。
- `/dreams/01/` 至 `/dreams/08/`：独立标题、编号、场景、艺术解读、关联主题、画作和上下梦链接。首尾不循环。
- 八张卡片均为真实 `<a href>`，支持中键、新标签、复制链接与刷新。
- 默认拖拽观察、滚轮缩放；触屏单指旋转、双指缩放。进入漫游后 WASD/方向键行走、拖拽看向，触屏有方向摇杆；Esc 退出，重置按钮回到默认视点。不会主动请求鼠标锁定。
- 环境设置位于右下角；声音默认关闭。开启后播放 Web Audio 合成的轻环境音，页面间保留声音意愿；浏览器自动播放限制下，下一页首次交互后恢复声音。
- “Explore the Dreams” 播放约 2.7 秒过渡后导航第一梦；Skip 和 Esc 均立即完成导航。减少动态或暂停模式直接进入。
- 搜索、画廊、主题、背景资料和设置使用原生 `<dialog>`；支持 Esc、焦点圈定及恢复、画廊方向键。弹层内也有 EN/JP 切换。
- 语言、暂停和画质存储在 localStorage；声音意愿、返回卡片与横向滚动位置使用 sessionStorage。

## 目录

```text
index.html                   首页
dreams/01/index.html … 08/    八个独立入口
src/config.js                模式、种子和初始参数
src/content.js               双语、双模式章节与主题数据
src/world.js                 地形、建筑、植物、人物、天气及碰撞
src/renderer.js              首页双视区、观察、漫游、画质和时钟
src/water.js                 统一实时平面反射、局部波纹和捕获状态隔离
src/pond.js                  实际 3D 睡莲池与花叶组微漂移
src/app.js                   DOM、弹层、搜索、语言、音频及导航状态
styles/main.css              响应式、排版、纸感及界面动态
assets/art/                  20 张无字原始绘画素材
assets/vendor/               固定版本的本地 Three.js、控制器与 Reflector
scripts/                     页面、素材、构建、预览与静态服务器
tests/                       场景/DOM 验证和真实浏览器验收脚本
artifacts/                   测试报告、构图示意与离屏几何预览
dist/                        可部署的静态产物
```

## 配置与内容模式

编辑 `src/config.js`，修改后重新构建。

```js
contentMode: 'design', // 或 'film'
basePath: '',          // 通常无需设置；相对路径与模块位置支持子目录
seed: 4217,
quality: 'auto'
```

`designTitle`、`designSummary`、`designArtwork`、`designBody`、`designThemes` 与对应的 `film*` 字段分别维护；原始设计标题与摘要保存在 `sourceDesign`。没有向访客暴露技术模式开关。

`design` 忠实采用需求中的创意章节，不称其为影片正式章节。`film` 数据采用用户提供的八段影片对应，配套独立插画与基础场景变化：太阳雨森林、雪山风雪、麦田乌鸦、红色山体、荒地人物、水车村。电影模式尤其是核灾变、人物表现和艺术质量仍需进一步美术复核，默认交付保持 `design`。

本项目部署目标为 `https://strgo.com/dreams/`，章节地址为 `/dreams/01/` 至 `/dreams/08/`。部署资源使用 `basePath: ''`；同步脚本将章节移到根层，并将部署配置的 `chapterPath` 设为空。运行 `npm run build && node scripts/sync-strgo.mjs` 同步到相邻主站的 `src/dreams/`，随后在 `/root/strgo-homepage` 执行 `npm run build:production`。集成构建为九页添加 canonical 和 sitemap，Nginx 将 `/dreams` 以保留查询参数的 308 转向 `/dreams/`；未知编号返回带花园入口的 404。详见 `DEPLOYMENT.md`。

## 画面与 3D

未在工作区找到需求提及的原始 PNG，因此构图依据文档中的比例和坐标，而非原图逐像素复刻。首页、移动端画境、八张设计画、八张电影资料画、睡莲底图和纸纹均由 `scripts/paintings.js` 的确定性 Canvas 笔触生成；不是电影截图，也未使用图像生成 API。

首页正常模式使用一个共享 WebGL 渲染器的两个真实 3D 视区：上方花园包含山体、桥梁、村屋、花田、旅人与树木，下方为实际睡莲池。两处水面捕获各自场景的镜像相机画面；入梦过渡推进实际花园相机。无字绘画图保留为即时加载与 WebGL 失败时的后备；手机使用单独后备图和适配机位。文字、框体和导航为 DOM，章节预览为轻量 CSS 动效。

八个详情页分别建立真正的 Three.js 地形、路径、植被、人物、建筑与远山；不是背景平面加缩放。重复花海实例化，静态几何按材质合并。植物与天空使用附着于物体的笔触纹理，材质粗糙、阴影柔和。桃园、富士湖畔、雨后场景的独立水面由低分辨率 Reflector 捕获实际场景；雨日的十二处不规则水洼共用一次捕获。统一水面模块在水域内加入世界坐标波纹、Fresnel 混合、笔触碎光和随相机/太阳关系变化的高光。岸边逐渐减弱位移，桥体与岸线几何保持稳定。捕获隔离其他反射面，并在成功或异常时恢复视区、裁剪、渲染目标、XR 和阴影更新状态，避免首页双视区污染反射。

时钟以 elapsed/delta 驱动；统一暂停、系统减少动态、页面隐藏、场景离屏与销毁处理。画质自动降档减少可见实例、降低反射采样和内部像素比；设置可手动优先选择。

## 验证与证据

```bash
npm test                   # 不启动浏览器：页面、数据、几何、碰撞和实际 DOM 逻辑
npm run test:browser        # 六个尺寸、八页直达/刷新、交互、降级与浏览器截图
npm run test:full           # 加 180 秒真实运行检查和两段 WebM 录屏
npm run test:shaders        # 真实水面 GLSL（含 ACES/sRGB chunks）离屏编译链接
```

浏览器脚本默认使用 `/usr/bin/google-chrome`，可用 `DREAMS_CHROME` 指定路径；`DREAMS_TEST_URL` 可指定已有 HTTP 服务。录屏为实际页面图像采集，不将场景画作本身当作动画证据。

本次已通过 `npm run build` 与 `npm test`：

- 首页与八个真实入口、资源相对路径、八卡与五主题、首尾章节禁用状态。
- 英日字典、design/film 两套完整字段及主题关系。
- 16 个模式/场景组合的真实几何、地面与边界检测、建筑障碍、隧道边墙和可走桥面。
- 180 秒**模拟时间**更新后，场景对象数量保持稳定；销毁清空场景。
- 在 LinkeDOM 中执行实际 `app.js`，验证搜索/空结果、语言与搜索保留、画廊筛选、大图切换、主题关联、暂停、减少动态、WebGL 失败后的 DOM 与进入跳过。

结果：`artifacts/acceptance.json`。反射回归 `artifacts/reflections.json` 验证真实 Reflector 回调、镜像相机与视角变化、同级水面隔离、负 viewport 与 scissor 恢复、捕获异常恢复，以及几何/目标释放。实际运行的水面 GLSL 连同 Three.js 0.160.1 的 ACES/sRGB chunks 已通过 EGL 编译和链接（`artifacts/shaders.json`）。这些检查不等同于浏览器实测。

当前容器禁止服务器监听（`listen EPERM`），Chrome 在启动阶段遇到 `setsockopt: Operation not permitted`。因此 `artifacts/browser/report.json` 记录 `blocked`，没有伪造通过结果。本次**未产出实际浏览器首页/手机截图或 WebM 录屏，未测得真实 FPS，也未完成 3 分钟浏览器内存验证**。六尺寸实际重叠、原生键盘焦点、触屏手势、声音策略、浏览器反射观感与上下文恢复仍须在可启动浏览器的环境验收。上下文恢复时已接入反射目标重建，但尚无浏览器实测证据。

供美术审阅的文件：

- `artifacts/compositions/composition-1920x1080.png` 与两张手机长图：Canvas 构图示意，**不是 HTML/CSS 浏览器截图**。
- `artifacts/offscreen/dream-XX-view-X.png`：实际场景几何的 EGL 多视角预览，**不是浏览器截图**；使用近似诊断光照。
- `artifacts/offscreen/reflection-XX-view-X.png`：使用真实运行水面 shader、真实 Reflector 镜像相机和投影矩阵、实际几何与笔触纹理的十二张离屏反射预览，**不是浏览器截图**；环境照明近似，没有 Three.js 阴影和 DOM。`00` 为首页花园，`09` 为主题睡莲池，`02/03/06/08` 为水域章节。

如需重建辅助素材，运行 `npm run art`、`node scripts/preview-layout.mjs`。离屏预览使用 `node scripts/export-scenes.mjs && node scripts/export-water-shader.mjs && python3 scripts/render-reflections.py && python3 scripts/render-scenes.py`。先输出反射预览，后输出几何预览并删除中间 JSON；Python 脚本依赖本环境 Chrome 的 EGL/SwiftShader 库，仅作诊断工具。

## 已知视觉限制与待完成项

- 缺少原 PNG，无法确认精确构图、色彩和原图笔触相似度；当前插画为程序化再创作，人物、树冠与山体仍有明显风格化几何特征。
- 平面反射适用于当前水平湖面与水洼，不包含折射、体积水、屏幕空间反射或复杂波峰几何。当前 512/256 反射分辨率和实际观感仍需目标浏览器复核。
- 首页入场采用渐入，进入梦境采用实际相机推进与雾幕；没有完成画笔边缘揭示动画。
- 漫游采用平面障碍加地面采样，适用于当前程序化模型；复杂 glTF、完整物理与高精人物骨骼不在本次素材内。
- 暂停/减少动态和可访问性已接入逻辑，仍需真实浏览器与辅助技术复核。没有获得全部 V01–P01 验收通过的证据。

## 素材与参考

详见 `ASSETS.md` 及 `assets/manifest.json`。Third-party 运行依赖为 Three.js 0.160.1，MIT 许可随 vendor 附带。字体使用系统 Georgia / Liberation Serif / 日文宋体与通用字体回退，图标为项目内联 SVG。

影片年份、八段结构、电影模式名称及《乌鸦》的梵高关联采用需求文档提供的 Criterion 资料；整站印象派色彩是独立视觉解释，未将生成素材标注为电影画面或名家真迹。

1. https://www.criterion.com/films/28700-akira-kurosawas-dreams
2. https://www.criterion.com/current/posts/4299-akira-kurosawa-s-dreams-quiet-devastation
3. https://threejs.org/docs/pages/OrbitControls.html
4. https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation
5. https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
6. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion

## 2026-10-23 本机浏览器补验

本机Chrome155（SwiftShader）已通过六种尺寸、八章直接访问/刷新、搜索/设置/旅程、反射捕获与上下文相关脚本检查；修复了桌面备案页脚挤出首屏和搜索输入Escape问题。14张截图见 `artifacts/browser/`，状态以该目录report.json为准。本轮未启用180秒压力或录屏选项，软件渲染不能代表真实GPU性能。
