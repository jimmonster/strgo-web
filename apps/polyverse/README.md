# POLYVERSE · Beyond Dimension

一个可静态部署的多维几何宇宙网站。页面为真实 HTML，核心场景由 Three.js 程序化生成，无背景视频、整页截图、远程运行时资源或伪造社交链接。交付日期：2026-10-16（Asia/Shanghai）。

## 启动

需要 Node.js 20+；已包含 `dist/`，查看构建产物无需安装依赖。

```bash
cd /root/polyverse
npm ci
npm run dev
```

打开 `http://localhost:4173/`。开发启动先构建；修改源码后重新运行构建或开发命令。更改端口：`PORT=8080 npm run dev`。

直接查看现成静态构建（自动按 `dist/build-info.json` 的路径挂载）：

```bash
npm run preview
```

请使用 HTTP 服务；不以双击 `file://` 作为运行方式。这个开发环境禁止监听端口，因此此处未启动网站服务；在允许本地 HTTP 服务的机器上使用上述命令。

## 已实现的独立页面

| 场景 | 地址 | 核心内容 |
|---|---|---|
| 维度实验室 | `/dimensions/?n=4` | 1D–6D 原始坐标、全部旋转平面、分步投影、4D 切片、稳定对象 ID、坐标复制 |
| 几何实验室 | `/geometry/?model=dodecahedron` | 五种正多面体、原始拓扑、面/边/点选择、实体/线框/透明、面片分离 |
| 运动实验室 | `/motion/` | 软化引力、固定步 Verlet、采样轨迹、速度/加速度向量、物体编辑、能量统计 |
| 法则实验室 | `/laws/?experiment=gravity` | 欧氏距离与点拖动、数值引力、简谐场、标量波、独立可视层 |
| 立方世界 | `/realms/cubic/` | 有体积的实例化城市、可变建筑、种子、选择、受限街道步行 |
| 轨道世界 | `/realms/orbital/` | 三维数值轨道、选择/编辑/暂停拖动、轨迹与能量误差 |
| 分形世界 | `/realms/fractal/` | 真递归谢尔宾斯基四面体、门格海绵、真实实例计数 |
| 高维世界 | `/realms/higher/` | 4D–6D 投影、4D 切片、门户走廊、相机锁定 |

附加页面：`/simulator/`、`/library/`、`/about/`、`/docs/`、`/search/?q=gravity`。首页所有导航、快捷入口、公式、维度列表、卡片和页脚均有真实响应。

首页以嵌套立方体、真实高维内线、受控辉光核心、多平面装饰轨道、浮动多面体、建筑与渐隐倒影构图。未收到参考图文件，视觉依据需求中的位置、配色和文字描述实现，不宣称逐像素还原。

## 观察与操作

- 拖动旋转，滚轮缩放，右键拖动平移；底部相机按钮提供同等操作。
- 移动端先点 **Start observing** 激活 3D 手势，再点 **Finish observing** 恢复页面滚动。
- **Pause** 停止整个站点的自动时间、粒子、预览和 CSS 动画；手动相机与参数仍可操作。
- **Reset Scene** 恢复预设和模型；**Reset View** 仅恢复相机。
- 力学场景先选择物体，再编辑质量、位置、速度；暂停后 **Shift + 拖动** 在物体的水平面移动它。
- **Step** 精确推进 1/120 模拟时间单位；解析参数轨道不提供力学单步或能量误差声明。
- 立方世界步行沿没有建筑的中央街道限制移动，W/S 或上下键前后，A/D 或左右键转向，Esc 退出。无需指针锁定。
- 保存、JSON 导入导出、图片导出、全屏、帮助均在场景工具栏。

## 保存、分享与数据边界

本地作品只保存在当前浏览器。作品库支持打开、重命名、按当前名称确认删除、导出。写入失败明确报错并建议导出，不伪装云同步。

JSON 版本为 1，包含场景、种子、白名单参数、相机、可视层和质量。力学导出把当前物体质量、位置和速度作为从时间零开始的初始条件，不标为运行快照。导入限制为 256 KB、最多 8 个物体、有限数值、递归上限与已知字段；校验失败保留当前场景。未知版本拒绝导入，不覆盖文件。

分享链接重建场景、预设和少量地址参数。完整实验请导出 JSON；本地作品 ID 不具备跨浏览器分享能力。

## 数学模型

- 顶点属于 `{−1,+1}^n`，仅相差一个坐标的顶点相连；每帧从不可变原坐标重新旋转。
- 透视投影逐步降维，每步取 `d = 3B`，更新保守界限；正交投影逐步删除最后一维。
- 4D 切片由原始边与 `w=c` 的交点、去重及三维凸包得到；点、线、平面、空集合分别处理。
- 软化牛顿引力采用严格正 ε、固定 `dt=1/120` 和 velocity Verlet，位置统一更新后计算新力；默认无碰撞合并、阻尼和固定中心。
- 积累器每渲染帧最多接收 1/15 秒，最多执行 16 子步；超预算减慢模拟，不用大步追赶。隐藏页面不补算后台时间。
- 轨迹每 4 tick 采样一次，保留 1024 点；K、U 和误差来自真实状态。外部编辑重新建立基准。
- 简谐场为 `a=-kx/m`，波场为 `A sin(kx+kz-ωt)`。曲率网格是势能示意，不求解广义相对论。
- 面片分离不等于标准展开图；门户穿行不等于进入真实四维；有限分形不宣称无限计算。

## 性能与降级

唯一活动 WebGL 渲染器；建筑和分形使用 InstancedMesh。卡片用程序化 SVG，不常驻额外渲染循环。切换预设释放旧几何、材质与纹理；离开页面释放渲染器、控件与监听。

桌面自动像素比上限 1.5，移动 1.2；高档上限 2，低档 1 且关闭 Bloom。连续检测到低帧率时，自动把像素比降为 1 并关闭 Bloom。不会删除力学物体改变实验结果。

谢尔宾斯基上限桌面 5 级/移动 4 级；门格上限 3/2 级。WebGL 不可用显示与场景对应的程序化 SVG、说明及 HTML 参数，仍可导航和导出配置；图片导出提示需要 WebGL。上下文丢失暂停并等待恢复。

当前降级实现为像素比与 Bloom 两步，未实现分级反射渲染或 GPU 平面反射；首页使用透明镜像几何。背景星点数量按视口选择。帧率指标必须在目标设备实测，不能将此环境的数学测试视为 GPU 性能验收。

## 构建与部署

当前交付的 `dist/` 已按 `/polyverse/` 构建，目标为 `https://strgo.com/polyverse/`。2026-10-16 实际部署尝试被当前会话的 socket 权限阻止，**尚未上线**；线上主站配置及版本未改变。发布脚本、校验和、Nginx 候选配置和阻断记录均已准备。

在这台服务器的普通 SSH / Workbench 终端执行：

```bash
bash /root/polyverse/deploy.sh
```

脚本会安装独立版本、校验并重载 Nginx，等待首页内容与 CSP 就绪，再验证各页和主站；发布后验证失败会回滚。已修复重载后立即请求可能触发短暂 404 的校验时序，增加完整 URL 与就绪诊断。详细部署方式与当前状态见 [DEPLOYMENT.md](DEPLOYMENT.md)。

若需重新构建为网站根路径：

```bash
npm run build
npm run preview
```

所有 14 个页面均输出独立目录的 `index.html`，直接刷新不依赖前端路由回退。`dist/` 可完整复制到静态托管。

子目录部署示例：

```bash
BASE_PATH=/polyverse/ npm run build
npm run preview
# http://localhost:4173/polyverse/
```

将 `dist/` 内容部署到站点 `/polyverse/`。Node 预览服务自动读取 `build-info.json` 的挂载路径；普通静态服务应把该目录挂到对应子目录。未知 URL 由内置服务返回 HTTP 404 和 `404.html`。其他托管请配置自定义 404；Nginx 示例：

```nginx
location /polyverse/ { try_files $uri $uri/ =404; }
error_page 404 /polyverse/404.html;
```

依赖固定 Three.js `0.160.1`；运行时 JS、字体和 SVG 均本地提供，无 CDN 请求。锁定文件随源码交付。

## 测试

```bash
npm test
npm run build
node tests/build.mjs
npm run test:browser
```

浏览器测试需要本机 Chrome；自定义路径用 `CHROME_PATH=/path/to/chrome npm run test:browser`。已有服务可用 `POLYVERSE_TEST_URL=http://localhost:4173/ npm run test:browser`。

- `tests/math.test.mjs`：维度计数、旋转保长、投影有限性、切片边界和退化情况、正多面体拓扑、递归、固定步可重复性、60 秒能量误差、场景真实几何与释放。
- `tests/state.test.mjs`：严格配置校验、本地保存与存储失败。
- `tests/dom.mjs`：真实应用 HTML 与事件测试；使用 WebGL 静态降级，不冒充浏览器布局或 GPU 测试。
- `tests/browser.mjs`：HTTP、深层刷新、WebGL、参数、暂停/单步、保存、响应式截图与场景切换资源检查。
- `tests/build.mjs`：独立产物与 basePath 检查。
- `scripts/render-proofs.mjs`：实际几何与实例矩阵的离线 CPU 预览，材质近似，不是浏览器截图。

执行结果和限制见 `TEST-REPORT.md`、`artifacts/`。当前环境禁止 HTTP 监听，Chrome 启动也被权限限制；真实浏览器验收标为 **blocked**，没有虚报通过。

## 工程目录

```text
src/manifest.js       路由、文案、默认参数、搜索清单
src/app.js            HTML 页面、交互、导览、作品库、全局暂停
src/geometryND.js     高维拓扑、旋转、投影、切片、递归
src/dynamics.js       引力、积分、采样与能量
src/scenes.js         首页和八种实时场景工厂
src/sceneHost.js      唯一渲染器、相机、拾取、时钟与释放
src/panels.js         按场景能力生成参数和检查器
src/state.js          配置校验、本地保存、导出
src/art.js            与场景对应的程序化 SVG 预览
src/styles.css       深空玻璃布局、响应式、暂停与动态偏好
scripts/             构建、HTTP 服务、原创字体生成、离线预览
public/assets/       原创字体和品牌图标
```

资源、依赖授权及参考来源见 `SOURCES.md`。
