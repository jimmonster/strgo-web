# STRGO · Digital Universe

保留原有个人主页、银河归档和光学动效，在静态 HTML / CSS / JavaScript 工程中提供 `/terminal`、`/home`、`/dance` 和 `/nexus/` 四个入口。可编辑工程位于 `/root/strgo-homepage`，本目录不是 Git 仓库。

```bash
cd /root/strgo-homepage
npm run build
npm run dev
```

在浏览器中访问 `http://127.0.0.1:8080`，进入主页、`/home`、`/dance` 或 `/nexus/`。场景使用 ES 模块，请通过 HTTP 预览；直接用 `file://` 打开场景不受支持。预览服务需要允许本机 socket 的终端环境。

原有栈和 Python 静态构建器均已保留，没有迁移框架。Three.js r160 与其许可沿用已有本地资源；场景模型全部由代码生成，无外部模型、图片、音乐或 CDN 依赖。构建产生目录索引，现有 Nginx `try_files $uri $uri/ =404` 即可处理直接访问和刷新，无需把所有路径回退到主页。

详细实现、修改文件、配置、验收结果和预览文件见 [SCENES-DELIVERY.md](SCENES-DELIVERY.md)。

NEXUS 星际穿越的源码位于 `src/nexus/`，构建后为 `dist/nexus/`。主页桌面导航、移动菜单及空间入口均链接 `/nexus/`，场景页和终端入口也提供链接。正式地址为 `https://strgo.com/nexus/`；发布配置将 `/nexus` 以 308 转至 `/nexus/`，并保留查询参数。部署细节与验收范围见 [NEXUS-DEPLOYMENT.md](NEXUS-DEPLOYMENT.md)。

修改 `site.json` 后重新构建：

- `BASE_ORIGIN`：本次直接部署按服务器现有站点设置为 `https://strgo.com`，并将 `scheme` 设为 `https`。没有改动 `strg.com` 或 DNS。
- `TERMINAL_TARGET_URL`：已从原终端项目说明和 Nginx 配置确认的入口 `https://strgo.com/terminal/`。本期没有修改终端程序或登录权限，没有验证实际连接。
- `email`：联系邮箱为 `jim@strgo.com`，用于页脚邮箱入口及复制功能。
- `github` / `city` / `coordinates`：可填真实资料，空值隐藏相应入口或位置字段。
- `timezone`：默认 `Asia/Shanghai`。
- `contributions`：可填 196 个 `0–4` 整数；空值显示示例矩阵，不声称是 GitHub 数据。

```bash
npm test                       # DOM、数学、三维空间、动画和生命周期检查
npm run test:scenes:browser     # 真实 Chrome：路由、桌面/手机模拟、截图与录屏
npm run test:browser            # 原主页浏览器回归
npm run preview:scenes:offscreen # 沙箱内 EGL 几何预览，不能替代浏览器验收
```

当前构建和自动化检查已通过。当前沙箱禁止 Chrome 启动所需的 socket，真实浏览器验收尚未完成；离屏 PNG / GIF 有明确的不同标记。

正式依赖需要重新准备时，使用 `npm install` 和 `npm run prepare:vendor`。生产构建为 `npm run build:production`，缺少必要的正式动效库会停止构建。

正式域名确认并填写 `BASE_ORIGIN` 后，可在具有系统写入权限的普通终端运行 `bash deploy.sh`。发布脚本保留版本目录、原子切换和失败回滚，验证主页、卧室、舞台和 NEXUS 页面；同域的现有终端继续复用 Nginx 代理片段。若配置为独立域名终端，静态入口提供直接打开链接。

2026-10-15 已按“直接部署”指令执行 `bash deploy.sh`，但当前沙箱禁止网络 socket，脚本在预检阶段停止，未切换线上版本。配置、生产构建和全部测试已就绪；请在服务器普通终端执行 `bash /root/strgo-homepage/deploy.sh`。未修改 DNS、线上 Nginx、终端服务或系统权限。历史银河页面仍保留在 `/archive/`。

## DREAMS 梦境花园

新增 `/dreams/` 门户，八个独立梦境地址为 `/dreams/01/` 至 `/dreams/08/`。从相邻 `/root/dreams` 运行 `npm run build && node scripts/sync-strgo.mjs`，再按本项目原流程构建和发布。构建复制 `src/dreams/`，补 canonical 与 sitemap；Nginx 保留查询参数跳转 `/dreams`，并为未知梦境返回独立 404。

2026-10-15：本地生产构建与集成回归通过。当前受限终端的 socket 预检阻断发布，线上尚未更新；日志为 `artifacts/dream-deploy.log`。反射实现、离屏诊断图和浏览器验收限制见 `/root/dreams/README.md` 与 `DEPLOYMENT.md`。

## POLYVERSE 多维几何宇宙入口

主页桌面顶部导航、移动导航菜单和“空间入口”第六张卡片均提供 `/polyverse/` 原生链接。前六张卡片桌面为两行三列，平板两列、手机单列；第七张 Meow 卡片占据完整一行。平板导航折叠为菜单。

主站上的按钮位置固定如下：

- 桌面端顶部浮动导航：`NEXUS` 右侧的 `POLYVERSE`。
- 移动端导航菜单：`DREAMS` 下方的 `POLYVERSE / 多维几何宇宙`。
- 首页 `SPACES / 代码之外，还有生活。`：第六张 `06 / POLYVERSE` 卡片，点击整张卡片或右上角箭头进入。

POLYVERSE 使用 `/root/polyverse` 的独立构建和发布目录，主站发布脚本在配置片段存在时保留其 Nginx 引用。更新首页入口需要发布主站：`bash /root/strgo-homepage/deploy.sh`；单独执行 `/root/polyverse/deploy.sh` 只更新几何宇宙应用。

## MEOW 粉色猫咪天堂

猫咪网站独立工程位于 `/root/meow`，地址为 `https://strgo.com/meow/`。应用发布命令为 `bash /root/meow/deploy.sh`，使用独立版本目录 `/var/www/meow` 与 `/etc/nginx/snippets/meow.conf`。本项目后续发布在片段存在时保留 include 并校验 Meow 首页。

首页现已加入三个原生链接，均进入 `/meow/`：

- 桌面端顶部导航：`POLYVERSE` 右侧的粉色 `MEOW`。
- 手机与平板菜单：底部 `MEOW / 粉色猫咪天堂`。
- 首页 `SPACES / 代码之外，还有生活。`：第七张粉色卡片 `07 / MEOW PARADISE · 粉色猫咪天堂`，整张卡片可点。

2026-10-16 服务器已有 Meow 应用成功发布记录，`/var/www/meow/current` 指向 `20261016T060953Z-23858`。本次首页入口已构建并通过检查，但当前会话发布主站仍在 socket 预检阶段被阻断，**新增入口尚未发布**。请在服务器普通终端执行 `bash /root/strgo-homepage/deploy.sh`。日志为 `artifacts/meow-navigation-deploy.log`，检查记录为 `artifacts/meow-navigation-tests.log`。

## SWARMERA 虫族狂潮入口

首页“空间入口”第八张卡片与移动导航已加入 `/swarmera/` 原生链接。独立项目位于 `/root/swarmera`，具有 28 个目录路由、程序化三维模型、互动工作台与本地体验内容。主站发布脚本保留 `/etc/nginx/snippets/swarmera.conf` 并验证应用首页。

2026-10-16：主站构建及回归检查通过。当前受限会话的 socket 预检阻止线上发布，首页入口及应用尚未上线。服务器普通终端运行 `bash /root/swarmera/deploy.sh` 会依次发布应用、主站可点击入口并验证结果。具体测试和阻断记录见 `/root/swarmera/TEST-REPORT.md`。

## AI 生图工作台

主站提供 `/image-playground/` 路由，桌面导航、移动菜单和空间区均可进入。工作台使用邀请码注册和账号密码登录；图片直接保存到 ECS 硬盘，账号和 Fernet 加密的接口配置放在 `/var/lib/strgo-image/`，与网站发布目录分开，不需要 OSS Bucket 或 AccessKey。作品、收藏、搜索、保存失败重试、加密数据库备份和恢复工具均位于 `image_service/`。硬盘版安装、首个管理员邀请码与备份步骤见 [IMAGE-PLAYGROUND.md](IMAGE-PLAYGROUND.md)。本地验收运行 `npm run test:image`；浏览器验收运行 `npm run test:image:browser`，需要允许 Chrome 的本机 socket。

## 2026-10-17 · 导览与内容补充（本地改动，未发布）

已在现有项目中接入三条推荐路线、八个空间的主题筛选、作者具体介绍与代表作品入口、三个作品独立介绍页和 `/updates/`。公共内容集中在 `content/site-content.json`；邮箱与已有终端配置继续沿用 `site.json`。作品背景和真实更新资料尚未收到，相关章节隐藏，更新列表为空。没有将预览完成写成上线记录。

新增路径：`/projects/galactic-frontier/`、`/projects/terminal-anywhere/`、`/projects/digital-universe/`、`/updates/`，均生成目录索引，兼容既有部署结构。`npm run dev` 继续使用 8080 端口，并支持预览相邻独立空间的现有构建。

维护方法见 [CONTENT-MAINTENANCE.md](CONTENT-MAINTENANCE.md)，未收到的材料与截图限制见 [CONTENT-MISSING.md](CONTENT-MISSING.md)，本轮交付与实际验证结果见 [V1-DELIVERY.md](V1-DELIVERY.md)。本轮不运行 `deploy.sh`，不切换线上版本。
