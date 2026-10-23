# STRGO AI 创作空间

实现入口：`/ai/`。音乐：`/ai/music/`；对话：`/ai/chat/`；作品：`/ai/assets/`；任务：`/ai/tasks/`；权限：`/ai/settings/`；管理：`/admin/ai/`。

统一入口为 `/hub/`。任务与作品页面已接入图像/AI 的本人记录聚合，详见 [门户设计与实现](doc/hub/design-v3.1.md)；原模块接口和生成流程保持。

本次实现依据 [设计文档 v1.0](doc/ai/design-v1.0.md) 与本次会话中的音乐、对话、管理三张设计稿。开发接口与后续模块接入方式见 [实现与接口](doc/ai/implementation.md)，上线前检查见 [验收记录](doc/ai/acceptance.md)。

## 1. 与现有项目的关系

- 延用当前原生 ES Modules 前端、Python 账号服务和 SQLite；没有另建 React/Nest/PostgreSQL 系统。
- 主站、生图、终端、论坛、AI 空间共用 `strgo_account_session`、用户、密码和登录会话。
- 新表全部使用 `ai_` 前缀；启动自动进行追加式建表，不删除现有账号、图片或论坛数据。
- 管理身份不自动授予 AI 使用权。默认对话 50 次/天、音乐 600 秒/天、私有音频 1 GiB；管理员同样遵守额度。
- 对话组件使用 Shadow DOM，可同时用于完整对话页、音乐侧栏和原有生图页面。

## 2. 按序部署

先按 [统一部署说明](DEPLOYMENT.md) 更新仓库与账号服务。在维护窗口等待现有生图及 AI 任务完成，并备份数据库、持久化音频/图片目录、暂存目录和加密密钥。安装脚本会替换服务代码并重启；它不会安装 Ollama/ACE-Step 或下载模型。

```bash
cd /root/strgo-web
git pull --ff-only origin main
npm ci
npm run build:production
npm test
```

在服务器安装音频校验工具，然后升级账号服务与静态页面：

```bash
apt-get update
apt-get install -y ffmpeg
cd /root/strgo-web
bash image_service/deploy/install.sh
bash deploy.sh
```

`ffprobe` 用于检查 MP3/FLAC 的真实格式与时长；WAV 使用标准库校验。`/api/ai/v1/` 由现有 8092 端口服务提供，Nginx 已加入流式 SSE 与私有音频代理，不需要再开公网端口。磁盘需要给音频暂存与最终文件留出额外空间。

### 2.1 初始化已有管理员

如果尚未有管理员，先按原有生图部署流程创建首位管理员账号。然后显式授予该账号 AI 模块与模型使用权：

默认环境文件为 root 专用的 0600 文件。以下命令由 root 载入配置后降权执行，避免改变数据目录归属；用户名放在命令的最后一个参数，不包含密钥：

```bash
cd /opt/strgo-image
.venv/bin/python - 你的已有管理员用户名 <<'PY'
import os, pwd, subprocess, sys
from image_service.cli import load_env
load_env('/etc/strgo-image.env')
account = pwd.getpwnam('strgo-image')
os.initgroups(account.pw_name, account.pw_gid)
os.setgid(account.pw_gid)
os.setuid(account.pw_uid)
subprocess.run(['.venv/bin/python', '-m', 'image_service.ai_cli', 'bootstrap', sys.argv[1]], check=True)
PY
```

主密钥仍由原有服务环境管理；不要新生成密钥替换已有 `IMAGE_ENCRYPTION_KEY`。

打开 `/admin/ai/`，点击「管理员验证」，验证当前密码，将显示的绑定密钥添加到身份验证器，再输入六位动态口令。密钥只在绑定时返回，管理修改需五分钟内的验证。MFA 丢失时在服务器使用 `ai_cli reset-mfa 用户名`，会撤销该管理员所有会话，再重新登录绑定；按相同的载入环境、降权方式执行。

### 2.2 接入私有本地模型

1. 在 GPU 主机单独安装并验证 Ollama 或 ACE-Step 1.5。模型版本与显存大小由实际硬件决定，程序不会下载模型。
2. 使用 WireGuard/Tailscale 等私有网络连接 ECS；只允许 ECS/受控网关访问模型端口。AI 运行时不需要本地节点的公网入口。
3. Ollama 设置 `OLLAMA_NO_CLOUD=1` 后重启，并安装实际本地模型。拒绝 `:cloud` 模型和上游报告的远程模型。本地对话使用 `/api/chat`，设置输出上限和 `keep_alive: 0`，完成后释放模型显存。
4. 在 `/etc/strgo-image.env` 增加精确白名单，例如：

```dotenv
AI_LOCAL_ENDPOINTS=http://100.64.0.2:11434,http://100.64.0.2:8001
```

5. 重启 `strgo-image`，在管理页「本地节点」登记两个服务地址。同一 GPU 填写相同资源组，例如 `studio-gpu-01`。
6. 在「模型连接」选择 Ollama/ACE-Step，填入地址、模型标识、对应节点，保存；检查连接通过后再启用。
7. 本地节点每 30 秒进行非生成式连接检查。排空节点会停止派发新任务；已有任务继续完成。未知结果保留 GPU 锁，禁止仅凭租约超时重新占用。

当前实现使用中央数据库的持久化资源互斥，而非额外分布式节点代理。仓库新加入的 ComfyUI 本地创作台采用独立队列；在完成统一资源锁接入前，不能与 AI 任务同时使用同一 GPU，应使用不同硬件或先停止另一条队列。部署前必须保证这些原生模型服务只接收本系统的生成流量；不要让另一个调度器同时直连同一 GPU。ACE-Step 服务还需按其自身配置，在空闲时释放与 Ollama 冲突的模型显存。若要求多个独立调度器共享节点，先开发带 fencing 的节点代理，见实现文档。

### 2.3 接入在线 API

1. 在「额度与预算」分别设置所需币种的日预算与月预算。CNY、USD 分开结算，不做汇率换算。
2. 在「模型连接」配置 DeepSeek 或其他支持 Chat Completions SSE 的在线对话接口，或 ElevenLabs Music。
3. 填入 API Key、模型标识、价格版本与保守价格上限。输入/输出价格界面按百万 tokens 计价并向上取整，音乐按秒设置。价格需要按你的供应商合同填写，仓库没有预设实时售价。
4. 首次保存后点击「检查连接」，只调用模型列表/健康接口，不生成内容；随后启用模型。
5. 在「成员与权限」单独授权模块、模型、额度与有效期。即使是管理员，也需要模型使用授权。
6. 前往对应工作台试用。在线调用会先显示费用上限并要求确认，计入正常额度和平台预算。

当前 ElevenLabs 音乐适配器固定发布 `music_v1` 的计划结构：人声使用 `composition_plan`，纯音乐使用 `prompt` + 时长 + `force_instrumental`。v2/v2.5 的新计划格式尚未发布，不能只修改模型名绕过验证。在线音乐没有可靠实际费用响应时按上限暂记，通过供应商账单在「额度与预算」核对。

## 3. 使用流程与边界

音乐：写表单 → 自动保存草稿 → 助手起草 → 预览差异 → 应用表单 → 点击确认生成 → 确认本地额度/在线费用 → 任务排队 → 私有保存 → 播放/下载/复用原任务参数。应用助手建议不会触发音乐接口。

对话：独立对话或绑定某个音乐/生图表单。历史不会自动跨模块合并。普通对话中点击「带入音乐工作台」，只传递明确确认的原消息文字，创建新的音乐表单与对话。生图页的「创作助手」仅传递当前文字提示词，不传参考图片，不提交生图任务。

文本以安全文字渲染；第一版不接附件、语音、联网搜索或终端工具。任务和资源只由所有者访问，管理页不提供查看其他用户歌词/消息/音频的入口。

音乐每人最多一个执行中任务、三个排队任务；对话每人一个活动回复。相同 GPU 资源组跨音乐与对话互斥。任务断开网页后继续，SSE 断线按事件序号恢复；停止/取消会保留明确的任务状态。结果不明不会自动重新发起生成。

## 4. 备份、恢复与维护

- 使用原有 `image_service.cli backup` 备份完整 SQLite（含 AI 表）。数据库备份不包含图片、音频、暂存文件；这些目录与原加密密钥必须同时备份。
- 单独保留最新 `pending/deletion-*.enc` 本地删除意图与 `image-playground/system/ai-deletions/` 加密删除日志；对话删除和音频删除都纳入重放。恢复旧数据后，启动 Web 服务前执行 `ai_cli replay-deletions`；它会再次删除日志中的音频并标记对应作品删除。恢复的是最新日志，不能仅使用旧备份内的旧日志。
- `image_service.cli restore` 会撤销登录与二次验证，已派发的未完成任务进入核对；已保存暂存音频继续保存。不要直接覆盖正在运行的数据库。
- 默认保存内容/音频 90 天、表单 30 天、建议 24 小时、事件 7 天、用量/任务元数据约 180 天。未解决的资源锁/删除失败项保留到人工核对完成；最小删除日志需要至少覆盖所有可恢复备份的寿命。
- 查看运行摘要：`python -m image_service.ai_cli status`。命令仅输出任务状态、锁与待核对费用数量。
- 未知音乐任务在 24 小时内核对；期限后退回用户音乐额度，供应商费用保守暂记。已派发的对话占用一次额度，部分输出不进入下一轮正常上下文。
- 若本地未知任务已结算但仍保留 GPU 锁，先排空同资源组全部节点、停止该组全部模型服务、核对供应商/节点任务已结束，再执行 `ai_cli release-resource 资源组 --confirm-services-stopped`。启动服务并检查连接后再取消排空。不要直接删除锁表。

## 5. 开发与验证

```bash
npm ci
npm run build:production
npm run test:ai
npm test
```

真实本地开发可按 `IMAGE-PLAYGROUND.md` 启动共用账号 API，再执行 `npm run dev:image`；它同时代理 `/api/image/` 与 `/api/ai/v1/`。预览服务器默认只监听本机；`--host 0.0.0.0 --port 4173` 仅供明确的内网验收环境使用。前端服务不会自行启动真实模型。

`tests/ai-preview.py --demo` 是单独的临时界面验收夹具，使用临时账号/数据库、假模型和静音音频，并在页面标明演示。它不由任何生产入口加载，不能作为真实模型联调结果。

需要真实账号、密钥与 GPU 节点的验收项不能由离线测试替代。详见 [验收记录](doc/ai/acceptance.md)。
