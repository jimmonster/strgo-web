# STRGO /dreams/ 集成

目标地址为 `https://strgo.com/dreams/`，八梦地址为 `/dreams/01/` 至 `/dreams/08/`。首页与详情资源均从模块位置或页面相对路径解析，保留默认 `basePath: ''`。独立工程仍生成 `dreams/01/` 至 `dreams/08/`；同步脚本将它们展平到主站的 `/dreams/01/` 至 `/dreams/08/`，同步修正资源、返回入口和运行时 `chapterPath`。

## 可复现更新

```bash
cd /root/strgo-web/apps/dreams
npm ci
npm run build
npm test
npm run test:shaders
node scripts/sync-strgo.mjs
cd /root/strgo-web
npm run build:production
npm test
bash deploy.sh
```

`sync-strgo.mjs` 将静态产物复制到主站的 `src/dreams/`。主站不在发布时安装本项目的开发依赖；它直接复制这份已构建静态源，核对九个 HTML 和必要模块，生成 canonical 与 sitemap。主站新增梦境花园门户和移动导航入口。

Nginx 配置包含 `/dreams` → `/dreams/` 的 308 跳转，查询参数保留。未知梦境返回真正的 404，错误页面使用 `/dreams/` 内的资源和返回链接。保持原有严格 CSP，不添加 `unsafe-inline`；所有脚本、纹理与运行依赖均本地提供。

部署脚本继续使用原有版本目录、符号链接切换与失败回滚，保留已有 HTTPS 证书和终端代理配置。发布验证覆盖梦首页、八章、代表性模块/图片，以及跳转和不存在的编号。

## 本次状态与限制（2026-10-15）

发布目标已按最新要求由 `/dream/` 改为 `/dreams/`；以下构建与路由检查已按新路径通过。

- DREAMS 构建、场景/DOM/反射回归、水面 GLSL 编译链接已通过。
- 主站生产构建、4 组 Node 测试及 9 项 Python 测试已通过；包含 `/dreams/` 九页、依赖、canonical、sitemap、404 资源路径和 Nginx 配置检查。
- 生成了十二张离屏反射诊断图，采用真实水面 shader、镜像相机、几何和笔触纹理；它们不是浏览器截图，不能作为全部视觉验收通过的证据。
- Chrome 启动被容器 socket 策略阻断，未完成浏览器截图、录屏、实际帧率和上下文恢复验收。详情见 `artifacts/browser/report.json`。
- 发布脚本在 socket 预检处退出，尚未修改线上网站。日志位于主站 `artifacts/dream-deploy.log`。当前环境不能写入系统发布目录；需在具备相应权限的服务器终端运行上述发布命令。

可在允许启动浏览器的环境，对主站构建运行静态 HTTP 服务，再执行：

```bash
cd /root/dreams
DREAMS_TEST_URL=http://127.0.0.1:8080/dreams/ npm run test:full
```

这会按真实 `/dreams/` 前缀验证页面。请将实际截图、录屏、设备和浏览器结果补入报告后再判定完整验收。
