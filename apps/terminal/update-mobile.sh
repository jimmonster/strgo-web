#!/usr/bin/env bash
# Install the locally built chat interface; restore the previous binary on failure.
set -Eeuo pipefail
umask 077
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Current bundles must update the shared account API and broker together.
# Keep the old standalone installer below for older copied bundles.
if [[ -f "$PROJECT_DIR/update-account.sh" ]]; then
    exec bash "$PROJECT_DIR/update-account.sh" "$@"
fi
RELEASE_DIR="$PROJECT_DIR/.build/chat-release"
INSTALL_DIR=/usr/local/lib/strgo-terminal
BACKUP=''
TRANSACTION=0

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --check ) ]]; then
    printf '用法：bash %s [--check]\n' "$0" >&2
    exit 2
fi
[[ -f "$RELEASE_DIR/SHA256SUMS" && -x "$RELEASE_DIR/strgo-terminal" ]] || {
    printf '缺少已编译的聊天版本，请先按照 MOBILE-CHAT.md 构建。\n' >&2
    exit 1
}
cd "$PROJECT_DIR"
sha256sum --check --status "$RELEASE_DIR/SHA256SUMS" || {
    printf '程序或源码已变化，请重新编译并生成校验文件。\n' >&2
    exit 1
}
node --check web/app.js
node tests/ui.test.mjs
python3 tests/check-files.py
if [[ "${1:-}" == --check ]]; then
    printf '聊天版本的文件校验与交互检查通过；尚未修改线上服务。\n'
    exit 0
fi
[[ "$EUID" -eq 0 ]] || { printf '请在 ECS 普通终端中以 root 执行。\n' >&2; exit 1; }
[[ -x "$INSTALL_DIR/strgo-terminal" && -f /etc/strgo-terminal/web.env ]] || {
    printf '未找到现有终端服务，请先运行 publish.sh。\n' >&2; exit 1;
}
python3 - <<'PY'
import socket
try:
    with socket.socket(): pass
except OSError as error:
    raise SystemExit('当前执行环境限制网络，请在 ECS 普通 SSH / Workbench 终端运行本脚本：' + str(error))
PY
systemctl is-active --quiet strgo-terminal-broker.service || { printf 'SSH 代理尚未启动，请先检查 strgo-terminal-broker。\n' >&2; exit 1; }
exec 9>"$RELEASE_DIR/update.lock"
flock -n 9 || { printf '另一个更新正在运行。\n' >&2; exit 1; }

on_error() {
    local code="${1:-$?}"
    trap - ERR INT TERM
    set +e
    if [[ "$TRANSACTION" == 1 ]]; then
        install -m 0755 "$BACKUP/strgo-terminal" "$INSTALL_DIR/.strgo-terminal.restore"
        mv -f "$INSTALL_DIR/.strgo-terminal.restore" "$INSTALL_DIR/strgo-terminal"
        systemctl restart strgo-terminal.service
        printf '检查未通过，已恢复旧程序。备份：%s\n' "$BACKUP" >&2
    fi
    exit "$code"
}
trap on_error ERR
trap 'on_error 130' INT
trap 'on_error 143' TERM
BACKUP="$(mktemp -d "$INSTALL_DIR/chat-backup.XXXXXXXX")"
cp -a "$INSTALL_DIR/strgo-terminal" "$BACKUP/strgo-terminal"
TRANSACTION=1
install -m 0755 "$RELEASE_DIR/strgo-terminal" "$INSTALL_DIR/.strgo-terminal.chat-new"
mv -f "$INSTALL_DIR/.strgo-terminal.chat-new" "$INSTALL_DIR/strgo-terminal"
systemctl restart strgo-terminal.service
ready=0
for attempt in {1..15}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:3081/terminal/api/health >/dev/null; then ready=1; break; fi
    sleep 1
done
[[ "$ready" == 1 ]] || on_error 1
python3 tests/smoke.py --env /etc/strgo-terminal/web.env
python3 - <<'PY'
from urllib.request import urlopen
for path, marker in [('app.js', 'function addBubble'), ('style.css', '.chat-message.sent'), ('', 'id="chat-log"')]:
    with urlopen('http://127.0.0.1:3081/terminal/' + path, timeout=5) as response:
        assert marker in response.read().decode(), '聊天资源验证失败：' + path
print('聊天界面资源验证通过。')
PY
TRANSACTION=0
printf '聊天终端已更新：https://strgo.com/terminal/\n'
printf '手机刷新页面后重新登录即可；访问口令沿用原配置。\n'
printf '旧版本备份：%s\n' "$BACKUP"
