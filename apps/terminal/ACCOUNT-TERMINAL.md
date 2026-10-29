# 账号终端使用与交付

日期：2026-10-22。需求及两轮独立产品代理评审分别见 [REQUIREMENTS.md](REQUIREMENTS.md) 和 [PRODUCT-REVIEW.md](PRODUCT-REVIEW.md)。当前为源码与离线验收交付，尚未更新线上服务。

## 使用流程

1. 打开 `/terminal/`，使用既有 AI 生图账号登录。没有账号时前往 `/image-playground/`，沿用原有邀请注册规则。
2. 同站点同一浏览器已有生图登录时自动进入；新登录的共享状态保留 7 天，原登录迁移仅保留剩余期限。账号库、密码与会话都沿用生图服务，终端不另收口令。
3. 首次打开直接连接「我的终端」。左侧「＋」新建窗口，手机通过左上列表按钮切换。每个窗口的连接、输出、草稿、滚动和 xterm 均独立。
4. 点击「＋ SSH 连接」进入原 SSH 功能，需要目标服务器自己的认证；仅在勾选记住时按当前账号保存地址、用户名与端口。
5. 聊天和原始终端模式均保留输入区，支持中文选词；回车换行，点发送或 Ctrl/Cmd+Enter 执行。系统粘贴和粘贴按钮均先进入编辑区，不自动执行，终端画面保持可见。
6. 聊天气泡可选择复制、单条复制和再编辑；终端选区使用复制选区或有选区时的 Ctrl/Cmd+C。没有选区时 Ctrl+C 保持终端中断语义。
7. 终端标题「⋯」可重命名、导出当前聊天、清除聊天与关闭窗口。清除聊天不停止进程；关闭窗口需要确认并结束其连接。
8. 刷新后恢复当前账号的窗口配置，显示待连接，点连接才新建会话，不自动重放命令。聊天正文与草稿仅在当前页面内存中保留。
9. 在 SSH 要求密码时启用密码模式；发送、切换窗口、断开与退出时清空字段。密码不写入聊天导出或浏览器持久存储。普通命令模式的文本不能自动识别为秘密。
10. 退出使用侧栏账号入口，手机列表底部也有退出。生图与终端当前共享登录同时失效；Rust 每 15 秒核实账号，验证最长 3 秒，失败关闭已有连接。

## 工作区边界

- 默认是普通 UID 10001 的基础 Alpine shell，提供已有基础命令；无网络，不提供宿主机 root、sudo、任意软件安装或预装 Python/Node 的承诺。
- 每个窗口一个容器，128 MiB 内存、0.5 CPU、32 进程、只读根目录；默认全站同时 8 个活动连接，最多 32 可配置。每账号最多 8 个活动连接，每页最多保留 8 个窗口，离线窗口不占后端活动配额。
- 工作目录 `/home/terminal` 使用 `strgo-workspace-<账号32位ID>` 命名卷，同账号窗口共享文件，不同账号不共享挂载。身份由服务端账号校验后设置，浏览器不能指定账号 ID 或宿主路径。
- 文件保留，进程不保留；关闭、超时或重启会清理容器，卷不会自动删除。连接时限由 `TERMINAL_SESSION_SECONDS` 决定，默认 3,600 秒；页面计时以「默认 60 分钟」标识默认配置，管理员自定义后应同时告知用户。
- 单文件限制 16 MiB。普通 Docker 命名卷**没有每账号总容量硬配额**，需要下述运维容量监测；不能将内存限制解读为磁盘配额。
- 仅保留最近 120 条气泡、4,000 行 xterm 回滚，单条约最近 300 行/48,000 字符。行或字符裁剪都显示省略提示；导出明确仅为当前保留文本，不是完整日志。
- 断开不自动执行草稿，也不自动重连。长时间的远程工作可使用 SSH 目标服务器上已安装的 tmux；默认本地工作区不提供进程恢复。
- SSH 模式沿用原目标地址限制。管理员可使用部署的服务级私钥；普通成员不挂载该私钥，只能用目标服务器自己的密码等交互认证。

连接同一台阿里云主机时，可一次性配置管理员 SSH 密钥，之后复用已记住的地址和用户名；配置步骤、恢复边界及中文输入验收见 [中文输入与本机 SSH 免密](../../doc/TERMINAL-INPUT-SSH.md)。

## 实现位置

| 文件 | 职责 |
| --- | --- |
| `web/index.html`, `workspace.js`, `workspace.css` | 共享账号入口、微信式列表、多窗口、账号分区元数据 |
| `web/session.html`, `app.js`, `style.css` | 独立窗口上下文、聊天、xterm、剪贴板、密码保护 |
| `src/account.rs` | 只向固定回环账号服务核实身份，限时、限量解析 |
| `src/web.rs` | 共享 Cookie 校验、同源 WebSocket、账号配额与周期撤销 |
| `src/broker.rs`, `protocol.rs` | 账号工作区、持久卷、独立容器和原 SSH 路径 |
| `../../image_service/app.py` | 共享 Cookie、旧登录迁移、轻量身份接口，复用原账号库 |
| `update-account.sh` | 同时更新账号接口与网页/代理程序，失败恢复旧程序 |

`TERMINAL_ACCOUNT_ADDRESS` 默认为 `127.0.0.1:8092`，只能为数字回环 SocketAddr，不接受浏览器指定地址。新增 `/api/image/terminal-session` 只返回身份、CSRF、到期时间和窗口上限，不读取生图配置、额度或存储状态。

## 离线构建与检查

通用开发环境需要 Rust 1.88+、Node.js、Python 3 及现有生图依赖；终端开发依赖见 `package.json`。浏览器资源仍固定 xterm 5.5.0 与 addon-fit 0.10.0。正常联网开发可 `npm install --ignore-scripts --no-audit && npm run assets`。

本机使用已安装工具链和缓存构建，不下载依赖：

```bash
cd /root/strgo-web/apps/terminal
npm test
python3 tests/check-files.py
python3 -m unittest discover -s tests -p 'test_*.py' -q
CARGO_HOME=/root/strgo-terminal/.build/cargo-home \
RUSTUP_HOME=/root/.codex/strgo-terminal/.build/rustup-home \
CARGO_TARGET_DIR=/root/strgo-terminal/.build/target \
/root/strgo-terminal/.build/cargo-home/bin/cargo +1.88.0 test --locked --offline --jobs 2
CARGO_HOME=/root/strgo-terminal/.build/cargo-home \
RUSTUP_HOME=/root/.codex/strgo-terminal/.build/rustup-home \
CARGO_TARGET_DIR=/root/strgo-terminal/.build/target \
/root/strgo-terminal/.build/cargo-home/bin/cargo +1.88.0 build --release --locked --offline --jobs 2
mkdir -p .build/account-release
install -m 0755 /root/strgo-terminal/.build/target/release/strgo-terminal .build/account-release/strgo-terminal
sha256sum .build/account-release/strgo-terminal Cargo.toml Cargo.lock build.rs \
  src/*.rs web/*.html web/*.js web/*.css web/vendor/*.js web/vendor/*.css \
  ../../image_service/app.py tests/*.mjs tests/*.py deploy/*.service deploy/*.conf \
  update-account.sh update-mobile.sh repair-sandbox.sh \
  > .build/account-release/SHA256SUMS
bash update-account.sh --check
```

更换项目位置或工具链缓存时调整对应路径。`--check` 仅检查构建一致性与离线测试，不安装或重启服务。源码变化后需重新构建并更新校验清单。

## 更新现有部署

需要先通过真实浏览器与 Docker 验收，再在维护窗口更新。更新会中断现有终端连接，并重启生图 API；先等待当前生图任务完成，避免新任务在更新期间开始。当前环境不具备操作线上服务的能力，本次未执行安装。

适用已有 `/usr/local/lib/strgo-terminal` 和 `/opt/strgo-image` 的部署：

```bash
bash /root/strgo-web/apps/terminal/update-account.sh
```

脚本先做文件与离线检查、核对已部署生图依赖模块一致、检查在途生图任务、验证一次性探针卷；再备份旧二进制与生图 `app.py`，停止并更新三个服务。配置、加密密钥、账号数据库、生图文件和账号工作区卷均保留。基础检查失败时恢复旧程序并重新启动服务。

旧 `update-mobile.sh` 在本版本中转交 `update-account.sh`，防止只更新网页程序而遗漏代理与共享账号接口。

若生图其他模块与仓库不一致，脚本在更改服务前停止，需要先对齐对应版本。首次安装则先安装支持共享账号的生图服务，再按已有 `deploy.sh` 流程安装终端。新部署不再生成访问口令；旧配置内的 `TERMINAL_ACCESS_TOKEN` 被忽略，不用于认证。

回滚时使用更新输出的备份目录，停止三个服务，恢复备份 `strgo-terminal` 到原安装位置、`image-app.py` 到 `/opt/strgo-image/image_service/app.py`，再启动生图、代理和网页服务。旧生图服务仅识别旧 Cookie，回滚后需在旧入口重新登录。此次不变更账号数据库结构或自动删除命名卷。

## 真实环境验收

以下脚本已准备，当前环境因 `socket: Operation not permitted` 和 Chromium `setsockopt: Operation not permitted` 无法执行，不能视为已通过：

```bash
cd /root/strgo-web/apps/terminal
TERMINAL_CHROME=/opt/google/chrome/chrome npm run test:browser
bash tests/workspace-check.sh
python3 tests/smoke.py --env /etc/strgo-terminal/web.env
python3 tests/smoke.py --env /etc/strgo-terminal/web.env --account 测试账号
```

- 浏览器脚本路由提供真实 HTML/CSS/xterm，模拟账号 API 与 WS；覆盖 320/390/430/844/1440 宽度，三窗口后台输出与草稿、刷新恢复、退出和软键盘视口，截图位于 `artifacts/chat/` 与 `artifacts/workspace/`。这不是 SSH 服务端测试。
- `workspace-check.sh` 只使用带唯一探针名称的新卷，验证 UID、无网络、只读根目录、跨容器文件保留与不同卷隔离，退出自动清理探针。
- `python3 tests/broker-smoke.py` 进一步通过实际代理服务执行 shell，覆盖 systemd 环境和 PTY 启动，升级脚本也会运行。若出现 `Cannot start sandbox process: Permission denied`，见 [启动目录修复](SANDBOX-STARTUP-FIX.md)。
- 不带 `--account` 的冒烟仅检查匿名拒绝、资源、账号接口及跨源拒绝，不声称通过登录验收。
- `--account` 通过隐藏输入读取密码，不把密码放入命令行或输出；验证共享登录、SSH 地址拒绝、实际工作区命令和 30 秒内退出撤销。使用独立测试账号，避免影响个人工作。
- 真实手机系统剪贴板与 SSH 登录、vim/top、远程断开清理仍需按需求文档人工核验。

## 容量治理

持久卷不会因为关窗而删除。管理员需要监控 Docker 数据目录所在磁盘容量，建议可用空间低于 20% 预警、低于 10% 停止开放新的使用入口并处理容量。常用只读检查：

```bash
docker system df -v
docker volume ls --filter name=strgo-workspace-
df -h /var/lib/docker
```

磁盘写满时 shell 会返回 `No space left on device`，用户可删除自己不再需要的文件，管理员先检查容量，不应把它当作登录故障。清理账号卷时先核对账号 ID、导出需要的文件并结束该账号所有连接，随后只删除明确停用账号对应的精确卷名。不要使用全量 `docker volume prune` 作为本功能维护步骤。需要每账号总容量硬限制时，应先配置并验证支持配额的存储驱动或独立文件系统，再调整部署；本版不伪报硬配额。
