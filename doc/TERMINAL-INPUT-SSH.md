# 浏览器终端中文输入与本机 SSH 免密

适用：`apps/terminal/`，2026-10-24。当前源码修复和本机浏览器验收已完成，尚未更新阿里云服务。

## 中文输入

进入 Codex CLI、vim 等交互程序后，备用屏幕会让页面切到终端视图。此前桌面端隐藏编辑框，手机样式也隐藏编辑框和发送按钮；发送函数还会直接拒绝终端模式的输入，导致已有中文编辑能力无法使用。

现在聊天和终端视图均保留底部编辑框。在其中输入中文、选词、换行，再点「发送」或 Ctrl/Cmd+Enter；发送后仍显示 Codex 的终端画面。文本使用现有 xterm bracketed paste 路径，多行内容作为一个粘贴块，最后追加一次 Enter。系统粘贴也先进入编辑框，等待明确发送。

点击终端仍可直接输入英文、中文和快捷键。输入法组合期间，原始终端不会处理选词用的 Enter 或快捷键；底部编辑框继续检查 `isComposing`、组合状态和 `keyCode=229`。xterm 隐藏输入域最小为 1×1，避免光标位于宽字符位置时出现零宽输入域。发送受阻时保留草稿。

## 同一台阿里云服务器的一次性配置

网站登录和 SSH 登录分别验证身份。用户已确认连接的是部署 STRGO 的同一台服务器；使用现有管理员专用服务密钥机制完成 SSH 认证，服务器密码不写入网页或浏览器存储。

先在该服务器的普通 SSH / 阿里云 Workbench 终端中，以 root 检查：

```bash
python3 /root/strgo-web/apps/terminal/scripts/setup-local-ssh.py --host strgo.com --user root --port 22 --check
```

路径、地址、SSH 用户和端口按实际部署调整。确认使用当前 SSH 用户；若平时用 `ubuntu` 等用户连接，替换 `--user root`。检查不生成密钥、不更改 SSH 配置或重启服务。正式配置执行同一条命令并移除 `--check`：

```bash
python3 /root/strgo-web/apps/terminal/scripts/setup-local-ssh.py --host strgo.com --user root --port 22
```

脚本会：

1. 复用已有 `TERMINAL_IDENTITY_FILE`，未配置时生成专用 Ed25519 密钥。已有加密密钥不能自动解锁时退出，不静默轮换。
2. 把公钥追加到该本机用户的 `~/.ssh/authorized_keys`，保留其他授权和已有密钥的限制选项；重复运行不重复追加。
3. 用 `/etc/ssh/ssh_host_*_key.pub` 固定本机主机身份，实际验证指定地址和用户的密钥登录，禁用密码回退。目标不是本机或认证失败时恢复文件。
4. 为指定 IP 与端口加入精确放行，保留其他地址限制；私钥按容器用户 UID/GID 10001、0400 权限安装。
5. 备份后更新代理配置并重启两个终端服务，现有终端连接会结束；失败恢复原文件和服务配置。

本机 sshd 必须允许该用户的公钥认证，并使用默认 `~/.ssh/authorized_keys`；脚本不修改 sshd 认证策略。主机公钥不在默认目录、地址指向 CDN 或服务器无法访问自身公网地址时，验证会失败并恢复文件，需要先修正对应部署条件。

之后以**网站管理员账号**打开「SSH 连接」，首次填写地址和用户名并勾选「记住服务器地址与用户名」。下次恢复窗口后点连接即可；新建 SSH 窗口也会复用当前账号已记住的目标。普通网站成员不会获得服务私钥，切换网站账号不会继承另一账号的目标。工作区模式仍使用原来的隔离容器。

每个新 SSH 沙箱仍需核对主机指纹并输入 `yes`，免密配置消除的是服务器密码输入。首次运行脚本会显示 root 专用备份目录；服务私钥、授权与配置的恢复材料仅留在服务器。

## 发布与验证

前端资源嵌入 Rust 二进制，修改源码或刷新网页不会更新运行中的服务。按 [账号终端](../apps/terminal/ACCOUNT-TERMINAL.md) 重新准备资源、构建 release、生成校验清单，再使用 `update-account.sh` 更新。免密配置工具可以独立在现有账号终端部署上执行，不需要先更新二进制。

本次修复位于 `codex/feature-completion-admin` 分支，尚未合并到 `main` 时，应拉取该分支。服务器已有账号终端的完整更新命令如下。在普通 SSH / 阿里云 Workbench 中以 root 执行，先等待生图及 AI 任务结束；更新会中断终端连接并重启账号 API。

```bash
(
  set -e
  cd /root/strgo-web
  test -z "$(git status --porcelain)" || { echo '源码目录有未提交内容，请先保存并处理。'; exit 1; }
  git fetch origin
  git switch codex/feature-completion-admin
  git pull --ff-only origin codex/feature-completion-admin
  git log -1 --oneline

  cd apps/terminal
  npm ci --ignore-scripts --no-audit --no-fund
  npm test
  python3 -m unittest discover -s tests -p 'test_*.py' -v
  bash scripts/build-native.sh
  mkdir -p .build/account-release
  install -m 0755 .build/strgo-terminal .build/account-release/strgo-terminal
  sha256sum .build/account-release/strgo-terminal Cargo.toml Cargo.lock build.rs \
    src/*.rs web/*.html web/*.js web/*.css web/vendor/*.js web/vendor/*.css \
    ../../image_service/app.py tests/*.mjs tests/*.py scripts/*.py \
    deploy/*.service deploy/*.conf update-account.sh update-mobile.sh repair-sandbox.sh \
    > .build/account-release/SHA256SUMS
  bash update-account.sh --check
  bash update-account.sh
)
```

原生构建脚本在当前项目 `.build/` 准备 Rust 1.88.0、锁定依赖和前端资源，并构建 SSH 沙箱镜像；需要已安装 Docker、Node.js/npm、Python 3、systemd 与可用网络。若更新提示账号服务模块版本不一致，先按 [统一部署第 3 节](../DEPLOYMENT.md#3-升级账号生图与论坛) 备份并对齐账号服务，再重跑终端更新，不绕过脚本检查。

更新成功后执行上文的一次性免密配置，再核查服务并刷新页面：

```bash
systemctl is-active strgo-image strgo-terminal strgo-terminal-broker
python3 /root/strgo-web/apps/terminal/tests/broker-smoke.py
python3 /root/strgo-web/apps/terminal/tests/smoke.py --env /etc/strgo-terminal/web.env
```

最后用网站管理员账号打开 `/terminal/`，进入实际 Codex CLI，验证中文选词、发送和免输服务器密码。若仍显示旧页面，强制刷新；iPhone 主屏幕入口关闭旧窗口后重开。升级输出的备份目录用于回滚，手动恢复方式见 [账号终端](../apps/terminal/ACCOUNT-TERMINAL.md#更新现有部署)。

本机 Windows / Chrome 验证结果：

| 检查 | 结果 |
| --- | --- |
| Node 子会话与多窗口回归 | 41 项通过 |
| Python 回归 | 37 项中 36 项通过、1 项 POSIX 权限用例跳过 |
| Chrome 子会话 | 320 / 390 / 430 / 844 / 1440 五种尺寸通过；CDP 产生组合输入，覆盖编辑框、xterm 直接输入、选词 Enter、中文标点和 emoji |
| Chrome 多窗口 | 同五种尺寸通过；账号、三窗口、草稿、后台输出、恢复与退出 |
| 页面资源 / 元素 / Rust 路由检查 | 通过 |

免密工具的离线测试实际读写临时文件，模拟 SSH、systemd 和文件所有权，覆盖重复配置、原有限制保留、认证失败和重启失败后的恢复。真实阿里云 SSH、Docker 沙箱密钥登录、系统输入法候选窗口以及 iOS Safari 仍需服务器和设备验收。本轮未改 Rust 服务代码，未在 Windows 执行 Linux Rust 测试。

## 参考项目

- [Windows Terminal 的输入处理](https://github.com/microsoft/terminal/blob/main/src/cascadia/TerminalControl/TermControl.cpp)：组合输入期间阻止直接向 PTY 转发按键，提交文本与终端按键保持顺序。本项目采用浏览器组合事件和明确发送的编辑框落实这一原则。
- [Windows Terminal 的 TSF 实现](https://github.com/microsoft/terminal/blob/main/src/tsf/Implementation.cpp)：区分组合预览、提交与焦点生命周期；原生 TSF 代码依赖 Windows，网页端使用浏览器 IME。
- [REA](https://github.com/morluto/rea)：项目定位是应用行为与二进制分析工具；本次参照其从可复现行为收集证据的方法，加入真实浏览器组合输入回归。本轮未安装 REA 或引入其运行依赖。
