# 手机聊天终端

> 此文档记录旧版单窗口聊天改造。当前版本已升级为共享账号和多窗口工作台，使用、构建及升级请看 [ACCOUNT-TERMINAL.md](ACCOUNT-TERMINAL.md)；不要仅替换网页服务来安装新版。

更新入口沿用 https://strgo.com/terminal/ 。连接后默认显示微信风格的聊天界面：右侧绿色气泡是发送的命令，左侧白色气泡是实时服务器输出。输入框支持中文、系统选词、多行文本、长按粘贴和展开编辑。回车换行，点「发送」或 Ctrl+Enter 执行；发送后追加一次 Enter。点击已发送命令下的「再编辑」只放回输入框，需要再次点发送才执行。

「密码模式」使用密码输入框，聊天记录显示「密码已发送」。输入密码前请开启它；网页登录口令、SSH 密码和聊天内容均不写入浏览器存储。聊天记录仅存于当前页面内存，最多 120 条；刷新或重新连接清除。大段输出展示最近约 300 行，每条最多 48,000 字符。聊天气泡显示 SSH 输出流，命令结束状态由服务器实际输出判断。

vim、top、tmux 等切换到终端备用屏幕时，页面自动切到「终端」视图。也可手动切换。Esc、Tab、Ctrl 和方向键在「终端」或展开「符号」后可用；「中断」发送 Ctrl+C。普通聊天输入时左右方向键编辑本地草稿，Tab 将草稿交给终端并切换终端视图，以显示补全结果。手机连接后占满可见屏幕，使用 Visual Viewport 调整软键盘高度，保留安全区域。

## 安装已编译版本

在 ECS 普通 SSH / Workbench 终端以 root 执行：

```bash
bash /root/strgo-web/apps/terminal/update-mobile.sh
```

脚本先校验源码和编译件、运行交互检查，再备份旧程序、更新并重启网页服务。认证、WebSocket、SSH 代理和页面资源检查失败时恢复旧程序。现有 SSH 网页连接会中断；访问口令及 SSH 地址规则沿用现有配置。若项目位于另一条路径，将上述路径换成该服务器上的实际路径。

仅检查，不更新服务：

```bash
bash /root/strgo-web/apps/terminal/update-mobile.sh --check
```

## 验证与限制

在当前受限执行环境中已完成交互测试（包含真实 xterm 的 ANSI、UTF-8 分段、进度刷新、备用屏幕和 bracketed paste）、Rust 测试、Python 测试、资源完整性和 release 编译。当前环境禁止网络 socket、启动 Chromium 及操作系统服务，因此尚未更新线上服务，也尚未完成真实手机浏览器与 SSH 登录验证。

真实浏览器检查无需 SSH 口令，也无需启动 HTTP 服务。它通过 Playwright 路由提供实际资源，并模拟服务器消息，检查 320、390、430、844 和 1440 宽度以及键盘缩小视口，截图保存到 `artifacts/chat/`：

```bash
cd /root/strgo-web/apps/terminal
TERMINAL_CHROME=/opt/google/chrome/chrome node tests/browser-check.mjs
```

## 重新编译

```bash
cd /root/strgo-web/apps/terminal
CARGO_HOME=/root/strgo-terminal/.build/cargo-home \
RUSTUP_HOME=/root/.codex/strgo-terminal/.build/rustup-home \
CARGO_TARGET_DIR=/root/strgo-terminal/.build/target \
/root/strgo-terminal/.build/cargo-home/bin/cargo +1.88.0 build --release --offline --locked --jobs 2
mkdir -p .build/chat-release
install -m 0755 /root/strgo-terminal/.build/target/release/strgo-terminal .build/chat-release/strgo-terminal
sha256sum .build/chat-release/strgo-terminal web/index.html web/app.js web/style.css tests/ui.test.mjs > .build/chat-release/SHA256SUMS
bash update-mobile.sh --check
```
