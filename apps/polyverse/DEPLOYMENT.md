# POLYVERSE 发布记录

2026-10-16，目标为 `https://strgo.com/polyverse/`。当前服务器已有发布版本：`/var/www/polyverse/current` 指向已验证的 release，`artifacts/deployment/receipt.json` 记录了 14 个页面、4 个主资源、CSP、404 和查询参数重定向校验。公网连通性仍需从服务器外部确认。

此前一次发布在首次 HTTP 请求收到 404 后回滚；脚本随后增加了重载后的就绪等待和详细诊断。若要更新版本，在普通 SSH / Workbench 终端再次执行发布命令即可。

这不是网页构建失败。当前会话不能创建网络 socket，也不能写入 `/etc/nginx`、`/var/www`。主站配置 SHA256、当前版本链接和 POLYVERSE 安装状态的前后对照见 `artifacts/deployment/attempt.json`。

## 完成上线

在这台服务器的普通 root SSH / Workbench 终端执行一条命令：

```bash
bash /root/polyverse/deploy.sh
```

已包含按 `/polyverse/` 构建的产物，现有服务器无需再次安装依赖或申请证书。脚本使用现有 `strgo.com` HTTPS 配置和证书，不触发证书签发。

脚本会创建 `/var/www/polyverse/releases/<版本>/polyverse/`，原子切换 `/var/www/polyverse/current`，安装 `/etc/nginx/snippets/polyverse.conf` 并在既有 HTTPS 虚拟主机中引用。主站使用独立的发布目录。修改前保存 Nginx 配置、旧片段与旧版本链接；配置或上线验证失败会尝试恢复备份。

上线验证包括 14 个页面、四个主资源、导入映射 CSP 哈希、保留查询参数的目录重定向、自定义 404 和原主站首页内容。成功后生成 `artifacts/deployment/receipt.json`，记录本机 HTTPS 校验及版本、回滚备份位置。公网连通性仍需通过外部浏览器验证，脚本不会把本机验证冒充公网验证。

## 当前已验证

- 14 个独立 HTML 的路径和本地资源符合 `/polyverse/`；子目录 DOM 路由和交互测试通过。
- 页面 import map 使用一致且按实际内容计算的 SHA256；仅 POLYVERSE 路径采用相应 CSP，不修改主站安全策略。
- 发布脚本与主站发布脚本的 Bash 语法通过。
- Nginx 已完成候选片段的语法解析，但 `nginx -t` 随后因 socket 权限失败，完整服务校验标为 blocked。
- 发布脚本真实执行后退出码为 1，未创建线上 POLYVERSE 链接或配置片段，主站配置与版本保持原值。

部署清单、文件校验和和配置位于 `artifacts/deployment/`。`strgo.conf.candidate` 是现有主站配置的候选副本，不是已生效配置。日志与测试记录明确区分 prepared、blocked 和 deployed。

主站源码 `/root/strgo-homepage/deploy.sh` 已增加条件引用：仅当 POLYVERSE 配置片段存在时才引用它，避免以后重发主站时丢失 POLYVERSE 入口。这个源码修改未执行主站发布。

## 首次请求 404 的修复

普通终端的两次发布已通过 Nginx 配置检查，但在新站首页的首次 HTTP 校验收到 404 后回滚。保留的发布目录中，586 个文件均与当前构建校验和一致，目录映射及权限检查未发现异常。当前主站配置与发布前备份一致，POLYVERSE 的 current 链接与片段已移除。

原脚本在 `systemctl reload nginx` 返回后立即校验首页，缺少就绪等待。这个时序可能让首次请求仍由旧配置处理；当前会话无法读取 Nginx 日志或连接服务，因此不能把它当成已被日志证实的唯一原因。

修订后的脚本在重载后进行约 15 秒的就绪检查（单次请求最多 2 秒），同时要求 HTTP 200、首页内容与发布文件一致、响应 CSP 包含预期 import-map 哈希，然后开始完整逐页校验。所有本机请求显式绕过代理。持续 404、旧页面或错误策略都不会被当成发布成功。

失败会记录 URL、HTTP 状态、curl 退出码及内容/策略匹配结果，并在本次备份目录保存 `readiness.log`、`readiness.headers`、`readiness.body`、`readiness.error`；回滚时显示失败步骤。再次执行同一个发布命令即可使用修订后的脚本。

离线回归测试：`npm run test:deployment`。测试使用模拟 HTTP 响应检查真实 Bash 函数，结果见 `artifacts/deployment/http-regression.json`；它不代替普通终端的真实 Nginx/HTTPS 验证。

## 更新构建

源码更改后，在项目目录执行：

```bash
BASE_PATH=/polyverse/ npm run build
node tests/build.mjs
POLYVERSE_TEST_BASE=/polyverse/ node tests/dom.mjs
node scripts/prepare-deployment.mjs
bash deploy.sh
```

发布脚本拒绝部署 base 为 `/` 的构建，避免发布后深层资源路径失效。重新生成配置时必须能读取这台服务器的既有 Nginx 配置；这个发布脚本专用于当前 `strgo.com` 服务器。

## 八个主要入口（上线后）

```text
https://strgo.com/polyverse/dimensions/
https://strgo.com/polyverse/geometry/
https://strgo.com/polyverse/motion/
https://strgo.com/polyverse/laws/
https://strgo.com/polyverse/realms/cubic/
https://strgo.com/polyverse/realms/orbital/
https://strgo.com/polyverse/realms/fractal/
https://strgo.com/polyverse/realms/higher/
```

如果完整 Nginx 检查或运行服务报错，请查看该命令输出和记录的备份目录。当前环境尚未验证真实 GPU、触屏与公网浏览器效果；相关测试脚本和限制见 `TEST-REPORT.md`。
