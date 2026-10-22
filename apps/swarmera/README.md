# SWARMERA · 虫族狂潮

程序化三维虫族战争概念网站，目标挂载路径 `/swarmera/`。主站首页空间入口第八张卡片为 **虫族狂潮 / SWARMERA**，移动导航也有入口。主站源文件位于 `/root/strgo-homepage`。

本次输入只有文字规格与 `REFERENCE_IMAGE` 标记，没有实际参考图片。首版根据文字构图制作完整体积的程序化女皇、四型机甲、废墟与裂隙。它是可交互的概念原型；没有接入真实游戏、CG 视频、公开社区或预约服务器。

## 运行

```bash
cd /root/swarmera
npm ci
npm run build
npm run preview
```

浏览器打开 `http://localhost:4176/swarmera/`。直接双击 HTML 的 `file://` 模式不支持 ES 模块。生产目录 `dist/` 含 28 个目录索引与独立 404，无须单页路由回退。

默认依赖随 `assets/vendor/` 本地交付，运行构建不需要访问 CDN。`package-lock.json` 固定 Three.js 0.160.1、LinkeDOM 与 Playwright Core。测试用依赖可通过 `npm ci` 重新准备；本环境开发时复用了相邻项目的已缓存 node_modules，交付压缩包不包含该符号链接。

`SWARMERA_BASE=/ npm run build` 可输出根路径版本；`SWARMERA_BASE=/your-path/ npm run build` 可改挂载位置。正式发布脚本固定使用 `/swarmera/`，避免影响已有根站。

## 正式发布与主站可点击入口

```bash
bash /root/swarmera/deploy.sh
```

此命令先发布应用，再调用 `/root/strgo-homepage/deploy.sh` 发布首页入口。发布应用时保留首页、NEXUS、DREAMS、POLYVERSE 与 MEOW 的响应；版本目录为 `/var/www/swarmera/releases/`，Nginx 片段为 `/etc/nginx/snippets/swarmera.conf`。应用经过哈希、全部资源、直接路由、308 和 404 验证后，才发布首页卡片。首页更新保留 SWARMERA 片段。

当前会话禁止创建网络 socket，也无法写系统部署目录。实际发布尝试的结果见 `artifacts/deployment/receipt.json` 与 `artifacts/deploy.log`；不能据此认为线上已更新。需要在服务器普通终端执行上面的命令。若应用已成功发布但首页发布失败，收据保留应用已部署的状态，主站自己的发布脚本负责回滚其失败发布；修复后重跑同一命令即可。

## 页面与操作

完整地址表见 `ROUTES.md`。女皇可以展翼、脉冲、召唤和重播；四型机甲具有不同外形与专属动作。世界与阵营拥有不同三维场景。工作台可选择单位、移动、蓄能发射与命中靶标。首页 01/02/03 改变相机与预设 URL；媒体为 42 秒实时演示，可暂停、跳转章节和拖动时间轴。

桌面拖动三维区域旋转、滚轮缩放。手机先点“激活三维观察”再拖动，退出后可正常滚动。按钮提供侧面、背面、部位观察、全屏和截图。首屏保持固定构图。默认静音，主动开启后使用浏览器合成的低音氛围音，不含第三方音频。

中英文从统一文案数据切换。搜索匹配真实条目。预约意向与留言草稿只存于当前浏览器，支持删除、修改或导出；存储失败会保留页面输入并提示导出。阵营选择也是本地偏好。邮箱不进入分享网址。

## 结构与资源

- `src/data.js`：页面清单、双语文案、新闻与概念设定。
- `src/views.js`：可静态构建的真实 HTML 页面、导航与控制台。
- `src/app.js`：表单、搜索、语言、下载与场景操作绑定。
- `src/state.js`：白名单配置、存储与 1/60 秒固定时间步模拟。
- `src/models.js`：女皇、四型机甲、防线单位、巢体与独立关节动作。
- `src/scene.js`：单个活动渲染器、相机、深度、实例虫群、池化特效与释放。
- `assets/manifest.json`：实际资产大小、哈希、原始模型视图三角形统计与授权。
- `scripts/`：目录构建、HTTP 服务、资产预览与发布准备。

模型由代码即时构建，非透明图片平面。女皇的头、胸核和八组分节翼可以独立变化；机甲的腿包含支撑与抬足、镰肢、护盾器官、可展开炮体或飞行翼壳。甲壳划痕、粗糙感和门户膜由程序化材质实现。此版本以受控发光材质和局部光晕代替全分辨率 Bloom 后处理，没有假称使用未接入的 GLB、骨骼动画片段或 CG 素材。

预览图由同一套模型经 EGL 离屏绘制，光照为近似值，不是浏览器截图，也不能作为最终视觉还原验收。使用 `npm run previews` 可重新生成（该辅助脚本需要 Linux EGL；当前环境通过 Chrome 的 SwiftShader 库提供）。

## 验证与范围

```bash
npm run deploy:prepare
npm test
npm run test:browser
```

测试记录见 `TEST-REPORT.md`。单元与 DOM 测试不替代真实浏览器、移动设备、全屏、WebGL 上下文恢复或内存长期监测。当前环境无法启动 HTTP 服务，因此未声明第 20 节全部验收通过；帧率和九宫格动态覆盖还需要实际设备确认。
