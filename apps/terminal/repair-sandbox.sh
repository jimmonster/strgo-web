#!/usr/bin/env bash
# Fix old and new broker binaries without changing ProtectHome or account data.
set -Eeuo pipefail
umask 077
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$PROJECT_DIR/deploy/strgo-terminal-broker-home.conf"
DROPIN_DIR=/etc/systemd/system/strgo-terminal-broker.service.d
DROPIN="$DROPIN_DIR/20-runtime-home.conf"
BACKUP=''
TRANSACTION=0
[[ $# -eq 0 || ( $# -eq 1 && "$1" == --check ) ]] || { printf '用法：bash %s [--check]\n' "$0" >&2; exit 2; }
[[ -s "$SOURCE" && -f "$PROJECT_DIR/tests/broker-smoke.py" ]] || { printf '修复文件不完整。\n' >&2; exit 1; }
bash -n "$0"
python3 - "$PROJECT_DIR/tests/broker-smoke.py" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
compile(path.read_text(), str(path), 'exec')
PY
if [[ "${1:-}" == --check ]]; then
    printf '启动目录修复文件检查通过；未修改系统。\n'
    exit 0
fi
[[ "$EUID" == 0 && -d /run/systemd/system ]] || { printf '请在服务器普通终端中以 root 执行。\n' >&2; exit 1; }
python3 -c 'import socket; s=socket.socket(); s.close()' || { printf '当前执行环境禁止 socket，尚未修改服务。请在普通 SSH / Workbench 终端执行本脚本。\n' >&2; exit 1; }
[[ -x /usr/local/lib/strgo-terminal/strgo-terminal && -f /etc/strgo-terminal/broker.env ]] || { printf '未找到已安装的终端服务。\n' >&2; exit 1; }
for unit in strgo-terminal-broker strgo-terminal; do
    systemctl is-active --quiet "$unit" || { printf '终端服务未运行：%s。\n' "$unit" >&2; exit 1; }
done
exec 9>/run/lock/strgo-terminal-sandbox-repair.lock
flock -n 9 || { printf '另一项终端修复正在执行。\n' >&2; exit 1; }
BACKUP="$(mktemp -d /etc/strgo-terminal/sandbox-home-backup.XXXXXXXX)"
if [[ -e "$DROPIN" ]]; then cp -a "$DROPIN" "$BACKUP/runtime-home.conf"; fi
rollback() {
    local code="${1:-$?}"
    trap - ERR INT TERM
    set +e
    if [[ "$TRANSACTION" == 1 ]]; then
        if [[ -f "$BACKUP/runtime-home.conf" ]]; then cp -a "$BACKUP/runtime-home.conf" "$DROPIN"; else rm -f "$DROPIN"; fi
        systemctl daemon-reload
        systemctl restart strgo-terminal-broker strgo-terminal
        printf '修复验证未通过，已恢复原服务配置。备份：%s\n' "$BACKUP" >&2
    fi
    exit "$code"
}
trap rollback ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
TRANSACTION=1
install -d -m 0755 "$DROPIN_DIR"
install -m 0644 "$SOURCE" "$DROPIN"
systemctl daemon-reload
systemctl restart strgo-terminal-broker strgo-terminal
ready=0
for attempt in {1..15}; do
    if systemctl is-active --quiet strgo-terminal-broker && systemctl is-active --quiet strgo-terminal && [[ -S /run/strgo-terminal/broker.sock ]]; then ready=1; break; fi
    sleep 1
done
[[ "$ready" == 1 ]] || rollback 1
python3 "$PROJECT_DIR/tests/broker-smoke.py"
python3 "$PROJECT_DIR/tests/smoke.py" --env /etc/strgo-terminal/web.env
TRANSACTION=0
printf '沙箱启动目录已修复，真实代理 shell 检查通过。请刷新 /terminal/ 后重新连接。\n'
printf '账号、工作区文件及隔离设置保留；本次仅重启两个终端服务。备份：%s\n' "$BACKUP"
