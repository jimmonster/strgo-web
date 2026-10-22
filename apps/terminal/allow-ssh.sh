#!/usr/bin/env bash
# Targeted policy update using the already cached Rust toolchain and dependencies.
set -Eeuo pipefail
umask 077
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG=/etc/strgo-terminal/broker.env
INSTALL_DIR=/usr/local/lib/strgo-terminal
SSH_HOST="${1:-strgo.com}"
SSH_PORT="${2:-22}"
TRANSACTION=0
BACKUP=''
TEMP_DIR=''
STAGE='预检查'

usage() {
    cat <<'HELP'
用法：bash allow-ssh.sh [服务器IP或域名] [SSH端口]
默认只放行 strgo.com 的解析地址和端口 22；不同服务器请填写其实际地址和端口。
利用现有本地缓存离线编译地址规则修复，备份配置并更新、重启终端服务。
无需下载工具链、重建容器镜像或重新发布 HTTPS。当前网页 SSH 会话会断开。
在服务器普通 SSH / Workbench 终端中以 root 执行。
HELP
}
if [[ "$SSH_HOST" == --help || "$SSH_HOST" == -h ]]; then usage; exit 0; fi
[[ $# -le 2 ]] || { usage; exit 2; }
[[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$SSH_PORT >= 1 && 10#$SSH_PORT <= 65535)) || { printf 'SSH 端口必须为 1–65535。\n' >&2; exit 2; }
[[ "$EUID" -eq 0 ]] || { printf '请以 root 执行。\n' >&2; exit 1; }
[[ -f "$CONFIG" && ! -L "$CONFIG" && -x "$INSTALL_DIR/strgo-terminal" ]] || { printf '终端服务尚未安装，请先运行 publish.sh。\n' >&2; exit 1; }
python3 - <<'PY' || { printf '当前会话禁止系统网络；请在服务器普通 SSH / Workbench 终端执行。\n' >&2; exit 1; }
import socket
try:
    with socket.socket(): pass
except OSError as error:
    raise SystemExit(str(error))
PY
export CARGO_HOME="$PROJECT_DIR/.build/cargo-home"
export RUSTUP_HOME="$PROJECT_DIR/.build/rustup-home"
export CARGO_TARGET_DIR="$PROJECT_DIR/.build/target"
[[ -x "$CARGO_HOME/bin/cargo" ]] || { printf '本地 Rust 缓存缺失，请先通过 publish.sh 完成构建。\n' >&2; exit 1; }
TEMP_DIR="$(mktemp -d "$PROJECT_DIR/.build/access-update.XXXXXXXX")"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

on_error() {
    local code="${1:-$?}"
    trap - ERR INT TERM
    set +e
    if [[ "$TRANSACTION" == 1 ]]; then
        install -m 0600 "$BACKUP/broker.env" "$CONFIG"
        install -m 0755 "$BACKUP/strgo-terminal" "$INSTALL_DIR/.strgo-terminal.restore"
        mv -f "$INSTALL_DIR/.strgo-terminal.restore" "$INSTALL_DIR/strgo-terminal"
        systemctl restart strgo-terminal-broker.service
        systemctl restart strgo-terminal.service
        printf '已恢复原配置及程序，备份：%s\n' "$BACKUP" >&2
    fi
    printf '修复未完成：%s，错误码：%s。\n' "$STAGE" "$code" >&2
    exit "$code"
}
trap on_error ERR
trap 'on_error 130' INT
trap 'on_error 143' TERM

STAGE='核对需要放行的 SSH 地址和端口'
python3 "$PROJECT_DIR/scripts/configure-target.py" --config "$CONFIG" --host "$SSH_HOST" --port "$SSH_PORT" --output "$TEMP_DIR/broker.env"
STAGE='利用现有缓存离线测试与编译地址规则'
cd "$PROJECT_DIR"
"$CARGO_HOME/bin/cargo" +1.88.0 test --locked --offline --jobs 2
"$CARGO_HOME/bin/cargo" +1.88.0 build --release --locked --offline --jobs 2
STAGE='备份配置与程序并安装修复'
BACKUP="$(mktemp -d /etc/strgo-terminal/access-backup.XXXXXXXX)"
cp -a "$CONFIG" "$BACKUP/broker.env"
cp -a "$INSTALL_DIR/strgo-terminal" "$BACKUP/strgo-terminal"
TRANSACTION=1
install -m 0755 "$CARGO_TARGET_DIR/release/strgo-terminal" "$INSTALL_DIR/.strgo-terminal.new"
mv -f "$INSTALL_DIR/.strgo-terminal.new" "$INSTALL_DIR/strgo-terminal"
install -m 0600 "$TEMP_DIR/broker.env" "$CONFIG"
systemctl restart strgo-terminal-broker.service
systemctl restart strgo-terminal.service
STAGE='验证服务与地址规则'
ready=0
for attempt in {1..15}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:3081/terminal/api/health >/dev/null; then ready=1; break; fi
    sleep 1
done
if [[ "$ready" != 1 ]]; then on_error 1; fi
python3 "$PROJECT_DIR/tests/smoke.py" --env /etc/strgo-terminal/web.env
TRANSACTION=0
printf '目标 SSH 地址和端口已放行。备份：%s\n' "$BACKUP"
printf '请刷新 /terminal 并重新输入访问口令，再连接 %s:%s。SSH 密码仍由目标服务器验证。\n' "$SSH_HOST" "$SSH_PORT"
