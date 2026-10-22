# NEXUS 路由交付

目标地址为 `https://strgo.com/nexus/`。2026-10-15 已完成主站集成与生产构建；本文件不代表线上发布成功。

## 路由与入口

- `src/nexus/` 是自包含的静态源码，`build.py` 将其复制到 `dist/nexus/` 并生成正式 canonical 和 sitemap 条目。
- 主站桌面导航、移动菜单及“星际穿越”卡片链接 `/nexus/`。卧室、舞台与终端入口页也可进入 NEXUS。NEXUS 页脚可返回 `/`。
- `deploy.sh` 生成 `location = /nexus { return 308 /nexus/$is_args$args; }`；原有 `try_files $uri $uri/ =404` 处理目录索引。直接访问、刷新和相对资源均使用同一目录。
- 保留原站 CSP。页面脚本与样式使用本地文件，不需要增加内联执行权限。Three.js 0.160.1 及其 MIT 许可在 `src/nexus/assets/`。

## 预览与发布

```bash
cd /root/strgo-homepage
python3 build.py --require-vendor
npm test
npm run dev
```

预览入口为 `http://127.0.0.1:8080/nexus/`。发布使用服务器普通终端：

```bash
bash /root/strgo-homepage/deploy.sh
```

发布脚本创建版本目录并原子切换，校验主页及 `/home/`、`/dance/`、`/nexus/` 内容，失败时回滚。已有 HTTPS 证书和终端代理按现有逻辑保留。

2026-10-15 已实际执行发布脚本，因当前会话禁止网络 socket，脚本在预检阶段以 `PermissionError: [Errno 1] Operation not permitted` 停止，退出码为 1，未切换线上版本。记录见 `artifacts/nexus-deploy-20261015.log`。请在服务器普通终端执行上面的发布命令。

## 调整与验收

黑洞参数在 `src/nexus/src/scene-config.js`；本地演示数据在 `src/nexus/src/content-data.js`，交互状态在 `src/nexus/src/app.js`。修改这些文件后重新构建并发布。所有场景资源均为本地程序化几何或 SVG，没有账户、支付或外部 API 依赖。

构建回归检查 NEXUS HTML、全部本地样式/图片/模块依赖、站内入口、返回链接、canonical、sitemap、Nginx 重定向及 CSP。独立场景项目另有 23 项交互/几何检查及 GLSL 离屏验证。

真实浏览器截图、10 秒整页录屏、完整进入动画录屏、六种尺寸的视觉验收及 3 分钟性能测试尚待在允许启动浏览器的环境完成。离屏 GLSL 预览不能替代这些验收。场景采用程序化工业结构和人物，原参考图片未随工作目录提供，尚未逐项对照原图。
