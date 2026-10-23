# STRGO Workflow 本地创作台

独立的管理员创作入口，默认域名为 `https://workflow.strgo.com/`，域名、服务器目录、API 端口、本机 ComfyUI 地址均可配置。前端产物为 `dist/local-studio/`，可直接作为子域名根目录。

复用 AI 生图的账号数据库、scrypt 密码校验、会话创建与密码修改后的会话撤销。登录后额外验证 `role=admin`；普通会员无法登录，也无法读写任务、读取作品或使用本机连接接口。没有独立注册入口。Workflow 使用独立的 host-only Cookie `strgo_workflow_session`，不设置跨子域 Domain，不读取主站登录 Cookie；退出此站不会退出 AI 生图。

本地任务保存在单独的 `local_jobs` / `local_chunks` 表，不读取收费接口配置、不调用收费图片 Provider、不计入成员图片额度。连接程序只接受本机配置中批准的 API 工作流，网站只发送工作流标识、提示词和可选参考图。

## 本机配置

Windows 上使用 Python 3.10+。连接程序仅使用标准库，可使用 ComfyUI 自带 Python，无需安装包或修改 ComfyUI。

本机现有目录已准备出 5 个独立预设：Qwen-Image-2.1 文生图、Qwen 参考图、H3 约 5 秒文生视频、H3 约 5 秒参考图视频、H3 约 12 秒参考图视频。参数沿用本机现有流程，H3 为 640×352、124/294 帧；这些为适配预设，真实效果和耗时仍需 GPU 联调。

在项目根目录执行（已有 `.local-studio/` 时不会覆盖）：

```powershell
& 'D:\soft\ai\ComfyUI_windows_portable\python_embeded\python.exe' scripts/prepare-local-studio.py --ai-root 'D:\soft\ai' --output '.local-studio'
& 'D:\soft\ai\ComfyUI_windows_portable\python_embeded\python.exe' image_service/comfy_worker.py --config .local-studio/worker.json --check
```

准备器读取现有 Qwen UI 文件中的具名控件值与 H3 API 文件，生成独立副本，清空原提示词、原参考图文件名和随机种子。原工作流保持原样。其他工作流请从 ComfyUI 导出 API JSON，再在 `worker.json` 配置 `file`、`output` 节点和 `bindings`。每个预设输出一张图片或一个视频，支持 PNG/JPEG/WebP 与 MP4/WebM；参考图使用 `LoadImage` 绑定。UI 的绕过节点、缺失具名控件或子图应通过 ComfyUI 正式导出，不做猜测转换。

准备器会在 `.local-studio/.env` 生成专用随机密钥；将其配置为服务器 `LOCAL_STUDIO_WORKER_TOKEN` 的值，确保两端完全相同。也可自行更换为至少 48 个随机字符。它是本机连接凭据，与账号密码、图片 API Key、加密主密钥不同。此目录已加入 Git 忽略规则，不在构建产物中。

```dotenv
LOCAL_STUDIO_WORKER_TOKEN=在此填写与服务器相同的专用随机密钥
```

先按原方式启动 ComfyUI，然后启动连接程序：

```powershell
.\scripts\start-local-studio.ps1 -Site 'https://workflow.strgo.com' -ComfyUrl 'http://127.0.0.1:8188'
```

可传入 `-PythonPath`、`-ConfigPath`、`-EnvPath`。停止连接程序用 Ctrl+C。ComfyUI 保持本机回环地址；连接程序主动通过 HTTPS 访问服务器，不需要公网 IP、端口映射或浏览器访问 localhost。ComfyUI 响应正常后才上报可用工作流。连接程序每 5 秒轮询，任务期间每 25 秒续租。

## 自定义服务器与域名

以下为 Ubuntu/Debian 上的部署步骤；SSH 地址与用户名由实际环境决定。

现有主站和账号服务已发布时，在服务器运行 `bash scripts/deploy-workflow.sh` 可启用默认 Workflow 子域名。脚本检查创作台静态文件与登录接口，复用服务器已有 ACME 账号申请独立证书，安装 Nginx 站点并校验实际返回的页面和资源；失败时恢复原 Nginx 配置。域名须事先解析到该服务器。可通过 `WORKFLOW_DOMAIN`、`STRGO_SITE_ROOT`、`IMAGE_PORT` 覆盖域名、主站发布目录与 API 端口；服务器与本机的连接密钥仍按本文配置。

1. 将所选域名的 DNS 指向服务器。在 `site.json` 中设置 `"WORKFLOW_ORIGIN": "https://你的域名"`（默认 `https://workflow.strgo.com`），运行项目生产构建与现有主站发布。`dist/local-studio/` 随现有 release 一起发布。
2. 更新 API 模块，沿用现有 `/opt/strgo-image`、`strgo-image` systemd 服务和数据目录。可运行现有 `image_service/deploy/install.sh`，保留原 `IMAGE_ENCRYPTION_KEY`。在 `/etc/strgo-image.env` 添加下列两项，然后重启 `strgo-image`：

```dotenv
LOCAL_STUDIO_ORIGIN=https://你的域名
LOCAL_STUDIO_WORKER_TOKEN=与本机配置相同的随机密钥
```

3. 生成所选域名的 Nginx 配置。例如：

```bash
python3 scripts/configure-workflow.py \
  --domain workflow.strgo.com \
  --site-root /var/www/strgo \
  --api-port 8092 \
  --cert-dir /etc/letsencrypt/live/workflow.strgo.com \
  --output artifacts/workflow-deploy
```

生成器只写文件，不修改系统或连接服务器。源模板包含占位符，应安装生成后的配置。

4. 首次签发证书时，安装生成的 `workflow-http.conf` 到 `/etc/nginx/sites-available/workflow.conf` 并链接到 `sites-enabled`；执行 `nginx -t && systemctl reload nginx`。然后使用对应域名和自己的邮箱签发证书：

```bash
certbot certonly --webroot \
  --webroot-path /var/www/strgo/current/local-studio \
  --domain workflow.strgo.com --email 你的邮箱 --agree-tos --non-interactive
```

已有证书可直接使用其目录。证书就绪后，将生成的 `workflow.conf` 安装为上述配置，运行 `nginx -t && systemctl reload nginx`。配置仅代理 Workflow API；静态页面使用独立根目录，并启用 CSP、禁止框架嵌入和搜索索引。确保现有证书续期任务继续运行。

5. 本机 `-Site`、服务器 `LOCAL_STUDIO_ORIGIN`、构建 `WORKFLOW_ORIGIN` 使用同一 HTTPS 站点源（不带末尾 `/`）。自定义 API 端口时，服务的 `IMAGE_PORT` 也应与生成器的 `--api-port` 一致。用现有 AI 生图管理员账号登录。首次应各运行一个 Qwen 和 H3 小任务，确认本机模型与节点、参考图、音视频输出和站内下载。

本地开发可将服务器配置为 `IMAGE_ENV=development`、`LOCAL_STUDIO_ORIGIN=http://127.0.0.1:8080`，连接程序使用 `--site http://127.0.0.1:8080 --allow-local-http`，预览服务设置 `STRGO_IMAGE_API=1`。普通生产地址必须 HTTPS；ComfyUI 地址必须是 HTTP 回环地址。

## 任务、结果与恢复

Workflow与AI本地模型共用SQLite中央资源组锁。`LOCAL_STUDIO_RESOURCE_GROUP` 默认 `local-studio-gpu`，同一物理GPU的AI节点必须使用相同 `resourceGroup`。任务超时或结果保存不会自行释放资源；连接程序确认ComfyUI队列为空、请求卸载模型并确认显存状态后才释放。卸载失败或状态未知时保留本机日志与锁，重启只继续清理，不重新生成。配置、暂停领取及人工恢复步骤见 [GPU调度与恢复](doc/GPU-SCHEDULING.md)；真实设备卸载策略须另外验收。

每次执行一个任务，最多排队 5 个。电脑离线后禁止新提交；已排队任务最多等待 10 分钟。执行任务租期为 180 秒，超时标记失败，不自动再次派发。图片与视频按 1 MiB 分片加密暂存于 SQLite，完成后校验 SHA-256、写入私有存储，再开放管理员预览/下载。单个结果上限 200 MiB；视频支持 Range 请求。参考图先在浏览器压缩至 2 MB，服务端加密暂存，完成或失败后清除。

连接程序的 `state/pending.json` 记录领取凭据、ComfyUI prompt ID 和结果位置。提交前先落盘，网络中断后查询原 prompt 的队列与历史，不再次 POST 相同工作流；已生成文件只重传分片。ComfyUI 接受请求但回包丢失、执行失败、进程重启等情形不会触发自动重生成。若 ComfyUI 自身重启导致历史丢失，任务会失败，需人工核对本机输出后决定是否新建任务。启动程序要求 ComfyUI 支持客户端提供 UUID prompt ID。

失败记录保存在本机 `state/last-failure.json`。本机图像和视频仍保留在 ComfyUI 输出目录；连接程序仅在服务器确认保存后清理自己的传输副本。服务器磁盘写入失败会保留分片供重传；失败或过期任务会清理分片。SQLite 与作品沿用现有持久化目录，升级发布不清理。备份需保留整个数据目录及原加密主密钥；单独图片 `reindex` 不恢复 Workflow 索引，应使用完整数据库备份。数据库恢复后未完成的本机任务会停止，不重新派发。

ComfyUI 通信遵循官方的 [`/prompt`、`/history`、`/view` 等 API](https://docs.comfy.org/development/comfyui-server/comms_routes)。

## 验证

```bash
python3 -m unittest tests.test_local_studio tests.test_comfy_worker tests.test_workflow_http -v
python3 build.py --require-vendor
npm run test:workflow:browser
```

后端测试使用真实临时 SQLite 和 HTTP 服务、模拟 ComfyUI/存储，覆盖管理员角色、既有账号复用、跨站请求/CSRF、独立 Cookie、任务幂等、单任务领取、断线和重启、加密参考图、分片重传、磁盘失败和视频 Range。浏览器测试覆盖手机/桌面布局、会员拒绝、管理员登录、工作流切换、参考图压缩、离线限制、提交与退出。测试不调用收费模型，也不执行真实 GPU 推理。截图与报告在 `artifacts/local-studio/`。

2026-10-22 验证：19 项本次专项测试（含独立构建检查）、浏览器交互与 320/390/768/1440 宽度检查通过；生产构建和 ComfyUI 内嵌 Python 下的 5 个工作流配置校验通过。整仓回归未全绿：既有场景测试的 CRLF 导入匹配失败，部分 Python 测试在 Windows 遇到 UTF-8 默认编码、Bash 缺失、路径分隔符和未关闭 SQLite 连接的清理问题。未运行服务器 `nginx -t`，未发布域名，未执行真实 GPU 推理。

2026-10-22 生产发布补充：服务器已启用 `workflow.strgo.com` 独立 Nginx 站点和对应 HTTPS 证书，修复了子域名落到主站且证书域名不匹配的问题。真实浏览器验证 390/1440 宽度的登录页、登录状态接口、未登录任务访问拒绝和其他图片 API 隔离通过，主站仍返回主页；报告与截图位于 `artifacts/workflow-deploy/`。Linux 下 18 项后端及连接程序专项测试通过，包含真实本机 HTTP 往返。此验证未使用生产管理员密码、未连接用户电脑或执行 GPU 推理；服务器尚需按本文配置本机连接密钥。
