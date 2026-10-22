# 个人空间与舞台交付记录

日期：2026-10-15。工程：`/root/strgo-homepage`。已修改工作副本并生成 `dist/`。用户随后要求直接部署，已执行发布脚本，但被沙箱 socket 限制阻止，未发布线上。

## 入口、路由与终端

原主页及其所有原有章节保留。新增「代码之外，还有生活」三入口卡片、桌面 SPACES 导航及移动菜单入口；原作品详情中的终端按钮也改为 `/terminal`。

`dist/home/index.html`、`dist/dance/index.html`、`dist/terminal/index.html` 为真实静态目录索引，资源采用 `/assets/…` 根路径。静态服务器会把 `/home`、`/dance` 规范化为带斜杠路径；刷新不需要 SPA 回退。浏览器前进后退使用正常文档导航。

检查发现现有 `/etc/nginx/snippets/strgo-terminal.conf` 已定义：`/terminal → 308 /terminal/`，`/terminal/ → 127.0.0.1:3081`。原项目 `/root/.codex/strgo-terminal/README.md` 也记录公开入口为 `https://strgo.com/terminal`。复用这一入口，未创建模拟终端、命令执行后端或 iframe，未读取/复制访问口令及私钥。

生产站点现有终端代理优先于静态目录，继续由原服务处理。静态预览的 `/terminal/` 通过明确按钮打开已配置的真实地址；不会自动发起 SSH。空配置、无效地址和与当前入口相同的目标均有说明，同源自引用按钮被阻止，避免循环。终端访问控制继续由原服务处理。

**终端在线接入未验收通过**：当前沙箱中的本机请求无法连接 `127.0.0.1:3081`，不能据此确认外部站点是否可用。本次没有登录终端或建立 SSH 会话。

## 卧室实际实现

完整可浏览的三维剖面房间：木质地板、左墙、带实际开口的窗户与阳台门；床架、床垫、双枕、被褥、床尾毯；窗边电脑桌、显示器、键盘、鼠标、杯子、椅子；阅读椅、圆桌、床头灯、画与绿植。阳台在房间北侧相连，包含地面、栏杆、植物和小桌；花园在阳台外侧，包含室外地面、花朵、树木、石径与围栏。

暖色日光从窗户/阳台方向投向室内，搭配半球环境光、阴影和明亮背景。初始视角可辨识床、电脑与阳台；「阳台与花园」提供更接近窗外方向的视角。

受限环绕、滚轮缩放、触摸单指旋转/双指缩放、方向键/+/-/Home、重置视角、返回主页均已实现。镜头距离及旋转范围受限，使用开放前墙避免进入家具或被墙体长期遮挡。

## 舞台实际实现

8 名完整风格化人物，包含头、眼睛、眉毛、鼻子、耳朵、发型/帽子、颈部、躯干、外套、手臂、肘部、双手、髋部、双腿、膝盖和鞋。服装与肤色有区分。

48 秒循环，120 BPM，共同时间线控制关节与演出灯光：

| 时间 | 动作 | 队形 |
| --- | --- | --- |
| 0–12 秒 | 左右踏步、摆臂、躯干律动 | 平行双排 |
| 12–24 秒 | 抬臂波浪、时间错位、中央领舞呼应 | 展开 V 形双排 |
| 24–36 秒 | 转身、扭转、重拍屈膝 | 展宽双排 |
| 36–48 秒 | 齐舞展臂、呼应收束 | 弧形双排，平滑回到开场 |

动作段以 0.8 秒平滑过渡，队形以 3 秒平滑过渡。脚部采用世界空间支撑落点和抬脚弧线，双骨段反向运动学驱动腿部；数值采样中舞者最小中心间距为 2.65，落地鞋底约高于台面 0.0075 个单位。角色不是仅做整体移动或上下漂浮。

有高度的舞台、台阶、LED 边线、地面网格、背屏标题、灯架、音箱、暖色主光、冷色轮廓光、彩色聚光灯及透明光束。主材质有金属度和适度高光，未实现平面镜面反射或后期泛光。

自动运镜以全景为主，缓慢弧形移动；用户操作后转为手动，可恢复自动运镜。暂停冻结舞蹈和灯光时间线，相机仍可操作。可重置表演或视角；系统启用减少动态效果时初始暂停，用户可主动播放。

## 加载、适配和资源

三维脚本按页面加载，首页不会加载卧室/舞台模块。全部资源在本地，无外部下载请求。加载面板包含刷新和返回入口，模块失败、加载超时、WebGL 初始化失败和上下文丢失都有反馈及重试。

画布随容器尺寸变化，移动端降低像素比、阴影贴图尺寸、抗锯齿和更新频率，演出灯数从 6 降为 4；窄屏调整视距与按钮布局。触摸手势只在画布区域接管。页面隐藏时停止帧循环，恢复时不跳过演出；离开时释放几何、材质、贴图、实例缓冲、渲染器、事件监听和观察器。浏览器缓存返回时重新建立场景。卧室静止时停止重复绘制。

卧室静态几何按材质合并；舞者重复部件采用 InstancedMesh。Node 检查得到桌面卧室 92 个可见绘制对象、舞台 129 个（不包含浏览器文字纹理可能增加的少量绘制）。这是场景结构计数，**不是实测帧率**。

所有模型、动画、服装和纹理由项目代码生成。沿用 Three.js MIT 许可，位于 `src/assets/vendor/THREE-LICENSE.txt`；没有新增外部素材或音轨。

## 配置与部署

集中配置在 `site.json`：

- `BASE_ORIGIN` 在用户要求直接部署后，沿用现有 Nginx 正式站点设为 `https://strgo.com`，`scheme` 同步设为 `https`。没有改动 `strg.com` 或 DNS。
- `TERMINAL_TARGET_URL` 为从原项目确认的 `https://strgo.com/terminal/`，实际可用性待浏览器验证。此字段只能放公开 URL，不得填写密钥或访问口令。
- `deploy.sh` 从 `BASE_ORIGIN` 读取域名；空值时要求先确认域名，避免沿用历史硬编码发布。现有证书、代理保留、回滚逻辑继续使用；发布验证覆盖 `/`、`/home/`、`/dance/`。
- 不需要新增 Nginx SPA 回退。正式同域终端继续使用原代理；独立站点终端则使用直接链接。本次没有操作跨域重定向或 DNS。

运行：

```bash
npm run build
npm run dev
# 浏览器打开 http://127.0.0.1:8080/home 或 /dance
npm test
npm run test:scenes:browser
```

浏览器检查会自行启动临时静态服务；可用 `STRGO_CHROME` 指定 Chrome。`STRGO_SKIP_RECORDING=1` 可仅运行截图与交互检查，默认生成约 49 秒的实际画布 WebM。测试产物写入 `artifacts/scenes/browser/`。原主页的浏览器回归命令为 `npm run test:browser`。

## 本次验证与验收状态

| 检查 | 本次结果 / 限制 |
| --- | --- |
| 静态构建与原有主页交互回归 | 通过；原有页面、归档和备案号保留 |
| 三个目录索引、入口与资源路径 | 构建检查通过；实际 HTTP 刷新/历史导航待浏览器检查 |
| 卧室物件、阳台外侧空间、日光方向 | 场景对象检查及 EGL 离屏预览通过；实际浏览器材质表现待验 |
| 群舞四段动作、循环衔接、队形间距、脚部位置 | 通过完整 48 秒时间线采样检查；不是设备帧率或视觉穿模全面验收 |
| 暂停/恢复、相机操作、重置、清理、减少动态效果、渲染失败状态 | 真实运行时代码配合渲染器替身检查通过；不冒充真实 WebGL/设备验证 |
| 配置校验、输出转义、终端空配置及自引用保护 | 通过 |
| EGL 几何与动作渲染 | 3 张 PNG 和 288 帧 / 48 秒 GIF 已生成，无 GL 错误 |
| Shell 语法、场景 JavaScript 语法 | 通过 |
| 真正的 Chrome 截图、交互、移动布局、实际 Three.js 渲染 | **未验证**。Chrome 启动因沙箱 `setsockopt: Operation not permitted` 退出，报告保存在 `artifacts/scenes/browser/results.json` |
| 实体手机 / Safari / Firefox | **未验证**；浏览器脚本中的手机尺寸是模拟环境，也不能代表实体设备 |
| 真实终端登录和 SSH 连接 | **未验证**；未把配置存在当作接入通过 |
| 线上发布、DNS 和跨域调整 | 已执行发布脚本，因沙箱禁止 socket 而在预检阶段停止；线上软链接仍指向 `/var/www/strgo/releases/20261014T120835Z-54372`。未改 DNS 或跨域配置 |

本次 `npm test` 包含 16 个 Node 用例（4 个测试文件）与 6 个 Python 用例。不得将上表的待验项目视为完整验收通过。

## 图像与动画交付

以下为真实场景几何和关节变换的 **EGL 离屏预览**，使用单独的简化光照验证着色器，未包含 HTML/CSS、Canvas 字体贴图或 Three.js 完整 PBR 渲染。它们不是浏览器截图，也不是浏览器录屏：

- [卧室初始视角](artifacts/scenes/bedroom-offscreen.png)
- [窗外与阳台花园](artifacts/scenes/garden-offscreen.png)
- [舞台全景](artifacts/scenes/stage-offscreen.png)
- [48 秒群舞动画预览 GIF](artifacts/scenes/dance-offscreen.gif)
- [离屏生成记录](artifacts/scenes/offscreen-results.json)

**需求中的实际浏览器截图和群舞录屏仍待补齐。** 在允许 Chrome 启动的环境执行 `npm run test:scenes:browser` 会生成卧室、花园、舞台桌面/移动截图与 `dance-browser.webm`。

## 修改文件

| 文件 | 用途 |
| --- | --- |
| `site.json` | 正式 origin 与既有终端目标集中配置 |
| `build.py` | URL 校验、三个静态目录索引、站点地图与模板生成 |
| `src/index.html`、`src/assets/globals.css` | 保留主页，增加入口卡片和导航 |
| `src/main.js`、`src/components/FooterHorizon.js` | 原终端按钮及集中 origin 接入 |
| `src/pages/scene.html`、`src/pages/terminal.html` | 三维场景页面外壳、终端入口 |
| `src/assets/scenes/home.js` | 卧室、电脑、床、阳台、花园和日光 |
| `src/assets/scenes/dance.js`、`choreography.js` | 舞台、关节人物、队形、脚部运动与灯光 |
| `src/assets/scenes/geometry.js` | 几何、材质、合批、实例化与资源释放 |
| `src/assets/scenes/controls.js`、`runtime.js`、`boot.js` | 受限相机、时间线、页面生命周期、加载/失败处理 |
| `src/assets/scenes/terminal.js`、`scenes.css` | 终端目标保护、响应式页面样式 |
| `deploy.sh`、`check.sh` | 配置驱动的发布域名与路由验证 |
| `tests/scenes.test.mjs`、`scene-runtime.test.mjs`、`test_build.py` | 场景、动作、生命周期、配置和输出检查 |
| `tests/scenes-browser.mjs` | 真浏览器验收、截图、实际画布录屏 |
| `tests/export-scene-previews.mjs`、`render-scene-previews.py` | 沙箱可运行的离屏预览生成器 |
| `package.json`、`README.md`、本文档 | 运行、验证与交付说明 |
| `dist/` | 可部署静态产物 |

尚未实现的可选增强：音乐/音量控制、点击电脑进入终端、窗帘/植物摆动、外部高精度骨骼模型、后期泛光、真实镜面反射。核心动画采用稳定的程序化关节方案，人物表现为精细几何体风格化造型。

## 直接部署尝试记录

2026-10-15：按用户后续指令，使用当前服务器既有域名 `https://strgo.com`，完成 HTTPS 生产构建，16 个 Node 用例与 6 个 Python 用例再次通过。执行 `bash deploy.sh` 返回 `PermissionError: [Errno 1] Operation not permitted`，停止于 socket 预检，未进入线上目录/配置写入和版本切换。

当前会话无法完成发布。服务器普通 SSH / Workbench 终端可执行：

```bash
bash /root/strgo-homepage/deploy.sh
```

脚本沿用已有 HTTPS 证书与终端代理，成功后校验主页与两个新场景的响应；发布后仍需真实浏览器验证终端和场景。
