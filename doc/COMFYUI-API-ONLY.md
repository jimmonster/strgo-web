# STRGO ComfyUI API-only

`comfyui.strgo.com` 使用原生 ComfyUI 画布。浏览器经独立 Nginx 站点访问 8189 回环网关，网关校验 STRGO 管理员后再连接 8188 回环引擎。主站账号服务签发 60 秒一次性授权码，兑换最长 12 小时的子域会话。退出主站、改密、撤销主站会话和降权会使子域会话失效，打开的 WebSocket 每 30 秒复核一次。

当前已锁定 ComfyUI 0.18.5、前端 1.41.21、Python 3.12 和 CPU Torch 2.10.0。服务只允许执行审核过的文本与 Mock 节点。官方线路目前审核了原生 `OpenAIChatNode` 和 `gpt-4.1-nano`，BYOK 使用固定 HTTPS 地址的 OpenAI-compatible `chat/completions`。图像、视频和跨模态示例返回 Mock 资产引用，真实图像、视频、异步上游查询和私有 OSS 仍需按所选供应商接入并验收。API-only 引擎与现有 `workflow.strgo.com` 的本机推理桥接独立。

## 先检查 ECS

使用现有 ECS 的 SSH 或 Workbench，以 root 在干净的发布 checkout 执行。脚本只支持 Linux x86_64 和 Python 3.12，需要 Nginx 已加载 `auth_request`，并能下载锁定的 CPU wheels。安装器校验现有账号服务源码与审核基线一致。若已有新版账号代码，先核对实际版本并重新审计兼容性。

```bash
bash scripts/deploy-comfyui-api-only.sh --check
```

在阿里云控制台核对 A 记录指向该 ECS，核对 AAAA 与服务器 IPv6 配置。先确认现有 80/443 可以到达该 ECS。安装前检查 8188 和 8189 空闲、账号服务在 8092 回环监听，并确认现有模型和 Workflow 任务已结束。

已有同域有效证书时直接使用。需要申请证书时，先启用独立 HTTP ACME 路由，再按 ECS 既有 Certbot 方式执行签发。Certbot 使用以下 webroot 和证书名。

```bash
bash scripts/deploy-comfyui-api-only.sh --prepare-http
certbot certonly --webroot -w /var/www/strgo-comfyui-acme -d comfyui.strgo.com --cert-name comfyui.strgo.com
```

## 安装与验证

```bash
bash scripts/deploy-comfyui-api-only.sh
python3.12 -m comfyui.deploy.healthcheck --public
```

安装器先采集 10 分钟内存与 Swap 基线，备份账号源码和在线 SQLite，安装固定版本并验证引擎节点。2 GB ECS 上初始的引擎内存硬限为 1400 MiB，网关为 160 MiB。启动后先通过回环健康检查，再加载独立 HTTPS 站点。账号服务升级会短暂重启。原有 Nginx server block、证书和数据库原文件保持原位。主站管理员总览的五语导航入口随主站静态发布生效。

安装通过后，在浏览器逐项验收。

- 从主站登录管理员账号，再访问 `https://comfyui.strgo.com/login/` 进入画布。普通成员的主站授权请求返回 403。匿名 API 请求返回 401。
- 在 ComfyUI 的 STRGO 菜单载入示例，执行文本、图像、视频和跨模态 Mock。使用 STRGO 菜单查看最近结果。停用测试账号或撤销主站会话后，检查 HTTP 立即拒绝，已连接 WebSocket 在 60 秒内断开。
- 核对原站点、论坛、终端和本机 Workflow 在发布前后的行为。观测主站负载下的内存、Swap I/O、磁盘、出口流量、OOM 和响应延迟。2 GB 下出现 OOM 时执行回滚后保留监控数据。
- 确认 8188、8189 和 8092 仅绑定回环。对公网 HTTPS 核验证书链和站点名。

## 供应商与费用

首次安装只启用 Mock。生产密钥和预算放入 root 专用 `/etc/strgo-comfyui/providers.json`，通过 systemd credential 交给对应进程。官方线路预算单位为千分之一 Comfy Credit，BYOK 为百万分之一美元。每条路线均需设置每日上限与每单保留额，以北京时间零点划分预算日。使用保守报价，并核对供应商账单。账本中的保留额是估算上限，实际费用缺省为空。

示例结构如下。管理员在服务器上填写供应商提供的固定 HTTPS 端点、真实模型名、密钥和正数预算。变更配置后重启两个 ComfyUI 单元。轮换前等待在途任务完成。

```json
{
  "official": { "api_key": "", "daily_limit": 0, "reserve": 0 },
  "byok": {
    "text-vendor": {
      "endpoint": "https://api.provider.example/v1/chat/completions",
      "api_key": "",
      "daily_limit": 0,
      "models": { "small": { "model": "model-name", "reserve": 0 } }
    }
  }
}
```

选择器每次把一个供应商图载入原生画布。付费提交只允许一个外部执行节点，调用前再次复核授权。UUID 重放复用原任务。同图任务处于 `unknown` 时，应先人工核对供应商和任务记录。网关保留用户、图摘要、路由、模型、时间、供应商任务 ID（如返回）和估算上限。浏览器从 `/strgo/jobs` 读取自己的审计记录。

本地文件上传只接受 PNG、JPEG 和 WebP，单文件上限 16 MiB，上传缓存总量上限 256 MiB。需要上传真实原件时，应先备份到已有的持久化存储。真实付费联调须显式确认后执行。

## 回滚

```bash
bash comfyui/deploy/rollback.sh
```

回滚恢复最近一次部署前的独立站点、服务版本和本次更新的账号文件。在线数据库和新增服务数据继续保留。若主站账号文件已经由其他发布更新，回滚脚本会停止，需按文件版本核对后恢复。受限备份目录为 `/var/backups/strgo-comfyui/`。

## 本地检查

```bash
python3 -m pip install -r image_service/requirements.txt -r comfyui/requirements-test.txt
python3 -m unittest tests.test_comfy_auth tests.test_comfy_api_only tests.test_comfy_security tests.test_comfy_deploy -v
npm run build:production
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

参考资料见 [ComfyUI 源码](https://github.com/Comfy-Org/ComfyUI)、[启动参数](https://github.com/Comfy-Org/docs/blob/main/development/comfyui-server/startup-flags.mdx)、[官方登录方式](https://docs.comfy.org/zh/interface/user)、[Partner 计费](https://support.comfy.org/articles/1982697177-partner-nodes-pricing)、[STRGO Workflow](../WORKFLOW.md) 和 [STRGO 全站后台](ADMIN-SYSTEM.md)。
