# 沙箱启动权限修复

2026-10-22，用户反馈登录终端后始终提示「SSH 会话已结束，或沙箱暂时不可用」。

## 原因

已读取线上代理日志，连续记录：

```text
Sandbox session ended: Cannot start sandbox process: Permission denied (os error 13)
```

错误发生在启动 Docker 客户端进程阶段，尚未进入目标服务器的 SSH 密码校验。`portable-pty 0.8.1` 在未指定工作目录时会将子进程工作目录设为 `HOME`，服务以 root 运行时为 `/root`；现有 systemd 配置包含 `ProtectHome=true`，使该目录在服务命名空间内不可访问。子进程在执行 Docker 前切换目录即失败。

此前的 Docker 检查从普通 root 终端运行，没有经过代理服务的 PTY 和 systemd 环境，不能发现这个问题。`/api/health` 也只检查代理 socket 是否存在，不能证明 shell 已经可用。

## 修复

- `src/broker.rs` 为 SSH 和个人工作区统一指定 Docker 客户端的工作目录 `/`。
- 代理服务将宿主端 `HOME` 和 `DOCKER_CONFIG` 放在自己的 `/run/strgo-terminal` 运行目录，避免读取不可访问的 `/root/.docker/config.json`。
- 保留 `ProtectHome`、原有权限与容器隔离；容器内的 `HOME=/home/terminal` 不变。
- 新增真实 PTY 回归测试：即使服务的 HOME 不存在，也能通过生产命令构造路径启动子进程，并验证实际工作目录为 `/`。

## 修复已安装的服务

在服务器普通 SSH / Workbench 终端执行：

```bash
bash /root/strgo-web/apps/terminal/repair-sandbox.sh
```

此脚本使用 systemd 的小型配置覆盖，也兼容已经安装的旧二进制。它只重启终端代理与网页服务，不重启生图服务，不变更账号、密码、工作区文件或 SSH 目标规则。当前终端连接会结束。

修复后会通过实际运行的代理服务创建一次性测试工作区，验证 `systemd → PTY → Docker → 普通用户 shell → 正常退出`，并检查 UID 为 10001、容器工作目录为 `/home/terminal`。不会把仅出现 socket 或服务 active 视为修复成功。测试工作区使用随机 ID，退出后清理对应容器和卷；失败时恢复原配置。

只检查修复文件：

```bash
bash /root/strgo-web/apps/terminal/repair-sandbox.sh --check
```

安装成功后刷新终端页面并点「连接」。SSH 目标服务器仍使用自己的登录认证。

## 独立验证

管理员也可单独执行：

```bash
python3 /root/strgo-web/apps/terminal/tests/broker-smoke.py
```

它通过受权限保护的代理 Unix socket 运行测试，不读取账号数据库或浏览器 Cookie。若仍失败，查看 `journalctl -u strgo-terminal-broker -n 50 --no-pager` 的新日志。

当前 Codex 会话可以读取日志、修改源码及构建，但创建 socket 和连接 systemd bus 仍返回 `Operation not permitted`。已尝试执行修复脚本；它在安装前检查退出，尚未改变线上服务，真实服务探针仍需在普通服务器终端执行。

本次本地验证：20 项 Rust 测试通过（含实际 PTY 子进程测试），31 项 Python 测试通过，release 构建通过。它们不替代线上服务探针。
