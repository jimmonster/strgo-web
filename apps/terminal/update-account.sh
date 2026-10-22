#!/usr/bin/env bash
# Upgrade the account API and both terminal services as one reversible change.
set -Eeuo pipefail
umask 077
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$PROJECT_DIR/../.." && pwd)"
RELEASE_DIR="$PROJECT_DIR/.build/account-release"
INSTALL_DIR=/usr/local/lib/strgo-terminal
ACCOUNT_DIR=/opt/strgo-image
BACKUP=''
TRANSACTION=0
BROKER_DROPIN_DIR=/etc/systemd/system/strgo-terminal-broker.service.d
BROKER_DROPIN="$BROKER_DROPIN_DIR/20-runtime-home.conf"
[[ $# -eq 0 || ( $# -eq 1 && "$1" == --check ) ]] || { printf '用法：bash %s [--check]\n' "$0" >&2; exit 2; }
[[ -f "$RELEASE_DIR/SHA256SUMS" && -x "$RELEASE_DIR/strgo-terminal" ]] || { printf '请先按 ACCOUNT-TERMINAL.md 构建账号终端并生成校验清单。\n' >&2; exit 1; }
cd "$PROJECT_DIR"
sha256sum --check --status "$RELEASE_DIR/SHA256SUMS" || { printf '源码或程序已变化，请重新构建并生成校验清单。\n' >&2; exit 1; }
node --check web/app.js
node --check web/workspace.js
npm test
python3 tests/check-files.py
(
    cd "$SOURCE_DIR"
    "${ACCOUNT_TEST_PYTHON:-python3}" -m unittest tests.test_terminal_account -q
)
if [[ "${1:-}" == --check ]]; then
    printf '账号终端离线检查通过；未修改线上服务，真实浏览器与容器验收需另行执行。\n'
    exit 0
fi
[[ "$EUID" == 0 && -d /run/systemd/system ]] || { printf '请在支持 systemd 的普通服务器终端中以 root 执行。\n' >&2; exit 1; }
python3 -c 'import socket; s=socket.socket(); s.close()' || { printf '当前环境禁止 socket，尚未修改系统；请在服务器普通终端执行。\n' >&2; exit 1; }
[[ -x "$INSTALL_DIR/strgo-terminal" && -f /etc/strgo-terminal/web.env && -f "$ACCOUNT_DIR/image_service/app.py" ]] || { printf '需要已有终端与 AI 生图服务。\n' >&2; exit 1; }
for unit in strgo-image strgo-terminal-broker strgo-terminal; do
    systemctl is-active --quiet "$unit" || { printf '服务未运行：%s；请先检查已有服务。\n' "$unit" >&2; exit 1; }
done
for module in store security storage cloud forum local_studio ai_schema ai_security ai_providers ai_service; do
    cmp -s "$SOURCE_DIR/image_service/$module.py" "$ACCOUNT_DIR/image_service/$module.py" || { printf '生图服务的 %s.py 与仓库版本不一致，请先对齐生图服务版本，避免覆盖不兼容接口。\n' "$module" >&2; exit 1; }
done
(
    cd "$ACCOUNT_DIR"
    .venv/bin/python - <<'PY'
import os
import sqlite3
from pathlib import Path
from image_service.cli import load_env
load_env('/etc/strgo-image.env')
path = Path(os.environ.get('IMAGE_DATA_DIR', '/var/lib/strgo-image')) / 'playground.sqlite3'
with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
    count = db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','generating','uploading')").fetchone()[0]
if count:
    raise SystemExit('生图任务尚未完成，请等待任务结束后再更新；尚未修改服务。')
PY
)
bash tests/workspace-check.sh
exec 9>"$RELEASE_DIR/update.lock"
flock -n 9 || { printf '另一个账号终端更新正在执行。\n' >&2; exit 1; }
rollback() {
    local code="${1:-$?}"
    trap - ERR INT TERM
    set +e
    if [[ "$TRANSACTION" == 1 ]]; then
        systemctl stop strgo-terminal strgo-terminal-broker strgo-image
        install -m 0755 "$BACKUP/strgo-terminal" "$INSTALL_DIR/strgo-terminal"
        install -m 0644 "$BACKUP/image-app.py" "$ACCOUNT_DIR/image_service/app.py"
        if [[ -f "$BACKUP/runtime-home.conf" ]]; then
            cp -a "$BACKUP/runtime-home.conf" "$BROKER_DROPIN"
        else
            rm -f "$BROKER_DROPIN"
        fi
        systemctl daemon-reload
        systemctl start strgo-image strgo-terminal-broker strgo-terminal
        printf '更新检查未通过，已恢复旧程序。备份：%s\n' "$BACKUP" >&2
    fi
    exit "$code"
}
trap rollback ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
BACKUP="$(mktemp -d "$INSTALL_DIR/account-backup.XXXXXXXX")"
cp -a "$INSTALL_DIR/strgo-terminal" "$BACKUP/strgo-terminal"
cp -a "$ACCOUNT_DIR/image_service/app.py" "$BACKUP/image-app.py"
if [[ -e "$BROKER_DROPIN" ]]; then cp -a "$BROKER_DROPIN" "$BACKUP/runtime-home.conf"; fi
TRANSACTION=1
systemctl stop strgo-terminal strgo-terminal-broker strgo-image
install -m 0755 "$RELEASE_DIR/strgo-terminal" "$INSTALL_DIR/.strgo-terminal.account-new"
mv -f "$INSTALL_DIR/.strgo-terminal.account-new" "$INSTALL_DIR/strgo-terminal"
install -m 0644 "$SOURCE_DIR/image_service/app.py" "$ACCOUNT_DIR/image_service/.app.account-new.py"
mv -f "$ACCOUNT_DIR/image_service/.app.account-new.py" "$ACCOUNT_DIR/image_service/app.py"
install -d -m 0755 "$BROKER_DROPIN_DIR"
install -m 0644 "$PROJECT_DIR/deploy/strgo-terminal-broker-home.conf" "$BROKER_DROPIN"
systemctl daemon-reload
systemctl start strgo-image strgo-terminal-broker strgo-terminal
ready=0
for attempt in {1..20}; do
    if curl --silent --fail --max-time 2 http://127.0.0.1:3081/terminal/api/health >/dev/null; then ready=1; break; fi
    sleep 1
done
[[ "$ready" == 1 ]] || rollback 1
python3 tests/broker-smoke.py
python3 tests/smoke.py --env /etc/strgo-terminal/web.env
TRANSACTION=0
printf '账号终端已更新。使用既有 AI 生图账号访问 /terminal/。旧会话已结束。\n'
printf '程序备份：%s\n' "$BACKUP"
printf '请继续执行浏览器检查与 --account 真实账号冒烟，再完成上线验收。\n'
