#!/usr/bin/env bash
# Publish only /meow/ on the existing strgo.com HTTPS host.
set -Eeuo pipefail
umask 022
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SITE_ROOT='/var/www/meow'
CONFIG='/etc/nginx/sites-available/strgo.conf'
SNIPPET='/etc/nginx/snippets/meow.conf'
DOMAIN='strgo.com'
ARTIFACTS="$PROJECT_DIR/artifacts/deployment"
CHANGED=0
HAD_SNIPPET=0
OLD_TARGET=''
BACKUP=''
RELEASE=''
STAGE='发布前检查'
source "$PROJECT_DIR/lib/deploy-http.sh"

fail() { printf '部署未完成：%s\n' "$*" >&2; return 1; }

receipt() {
    python3 - "$ARTIFACTS/receipt.json" "$1" "$STAGE" "$RELEASE" "$BACKUP" "$OLD_TARGET" <<'PY'
import datetime, json, pathlib, sys
manifest = json.loads((pathlib.Path(sys.argv[1]).parent / 'manifest.json').read_text())
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    'status': sys.argv[2], 'stage': sys.argv[3],
    'target': manifest['target'], 'releaseId': manifest['releaseId'],
    'release': sys.argv[4] or None, 'rollbackBackup': sys.argv[5] or None,
    'previousTarget': sys.argv[6] or None,
    'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'publicConnectivity': 'not independently verified'
}, ensure_ascii=False, indent=2) + '\n')
PY
}

rollback() {
    local code="${1:-$?}" status='blocked-before-mutation' restored=1
    trap - ERR INT TERM
    set +e
    if [[ "$CHANGED" == 1 ]]; then
        status='rollback-attempted'
        cp -a -- "$BACKUP/strgo.conf" "$CONFIG" || restored=0
        if [[ "$HAD_SNIPPET" == 1 ]]; then
            cp -a -- "$BACKUP/meow.conf" "$SNIPPET" || restored=0
        else rm -f -- "$SNIPPET" || restored=0; fi
        if [[ -n "$OLD_TARGET" ]]; then
            ln -s -- "$OLD_TARGET" "$SITE_ROOT/.rollback-$$" \
                && mv -Tf -- "$SITE_ROOT/.rollback-$$" "$SITE_ROOT/current" || restored=0
        else rm -f -- "$SITE_ROOT/current" || restored=0; fi
        if ! nginx -t || ! systemctl reload nginx; then restored=0; fi
        if [[ "$restored" == 1 ]]; then status='rolled-back'; fi
        printf '已尝试恢复原配置和版本；备份：%s\n' "$BACKUP" >&2
    fi
    if [[ -f "$ARTIFACTS/manifest.json" ]]; then receipt "$status"; fi
    printf '停止步骤：%s。退出码：%s。\n' "$STAGE" "$code" >&2
    exit "$code"
}
trap 'rollback "$?"' ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM

[[ "$EUID" -eq 0 ]] || fail '请在服务器普通终端以 root 执行。'
for command in node python3 nginx curl systemctl flock cmp sha256sum; do
    command -v "$command" >/dev/null || fail "缺少命令：$command"
done
STAGE='构建 /meow/ 静态站点'
MEOW_BASE=/meow/ node "$PROJECT_DIR/scripts/build.mjs"
node "$PROJECT_DIR/scripts/prepare-deployment.mjs"
STAGE='网络与系统权限预检'
python3 - <<'PY' || fail '当前会话禁止网络 socket。请在服务器普通 SSH / Workbench 终端执行 bash /root/meow/deploy.sh；线上版本未切换。'
import socket
try:
    with socket.socket(): pass
except OSError as error:
    raise SystemExit('Socket preflight blocked: ' + str(error))
PY
[[ -d /run/systemd/system ]] || fail '需要运行 systemd 的服务器。'
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || fail '主站配置必须是普通文件。'
[[ "$(readlink -f -- /etc/nginx/sites-enabled/strgo.conf)" == "$CONFIG" ]] || fail '启用的主站配置与预期不一致。'
if [[ -e "$SNIPPET" || -L "$SNIPPET" ]]; then
    [[ -f "$SNIPPET" && ! -L "$SNIPPET" ]] || fail '已有 Meow 片段不是普通文件。'
    [[ "$(head -n 1 -- "$SNIPPET")" == '# Managed by meow/deploy.sh' ]] || fail '已有 Meow 片段不属于本项目。'
fi
nginx -t
systemctl is-active --quiet nginx || fail '现有 Nginx 服务未运行。'
install -d -m 0755 "$SITE_ROOT/releases"
exec 9> "$SITE_ROOT/.deploy.lock"
flock -n 9 || fail '另一 Meow 发布正在运行。'
if [[ -e "$SITE_ROOT/current" || -L "$SITE_ROOT/current" ]]; then
    [[ -L "$SITE_ROOT/current" ]] || fail '已有 current 不是符号链接。'
    OLD_TARGET="$(readlink -- "$SITE_ROOT/current")"
fi
node "$PROJECT_DIR/scripts/prepare-deployment.mjs"
RELEASE="$SITE_ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 0755 "$RELEASE/meow"
cp -R -- "$PROJECT_DIR/dist/." "$RELEASE/meow/"
find "$RELEASE" -type d -exec chmod 0755 {} +
find "$RELEASE" -type f -exec chmod 0644 {} +
BACKUP="$(mktemp -d "$SITE_ROOT/.backup.XXXXXX")"
cp -a -- "$CONFIG" "$BACKUP/strgo.conf"
printf '%s\n' "$OLD_TARGET" > "$BACKUP/previous-target"
if [[ -f "$SNIPPET" ]]; then HAD_SNIPPET=1; cp -a -- "$SNIPPET" "$BACKUP/meow.conf"; fi
STAGE='保存现有站点响应'
for route in '' nexus dreams polyverse; do
    address="https://$DOMAIN/${route}${route:+/}"
    meow_request --fail "$address" -o "$BACKUP/${route:-home}-before.html"
done
STAGE='安装配置与原子切换'
cmp -s -- "$CONFIG" "$ARTIFACTS/strgo.conf.original" || fail '主站配置已变化，请重新运行发布。'
CHANGED=1
install -m 0644 -- "$ARTIFACTS/meow.conf" "$SNIPPET.new-$$"
mv -Tf -- "$SNIPPET.new-$$" "$SNIPPET"
install -m 0644 -- "$ARTIFACTS/strgo.conf.candidate" "$CONFIG.new-$$"
mv -Tf -- "$CONFIG.new-$$" "$CONFIG"
ln -s -- "$RELEASE" "$SITE_ROOT/.current-$$"
mv -Tf -- "$SITE_ROOT/.current-$$" "$SITE_ROOT/current"
STAGE='校验并重载 Nginx'
nginx -t
systemctl reload nginx
FINGERPRINT="$(node -e 'console.log(require(process.argv[1]).releaseId)' "$ARTIFACTS/manifest.json")"
meow_wait_for_release "$RELEASE/meow/index.html" "$FINGERPRINT" "$BACKUP"
STAGE='校验全部页面、资源、重定向与 404'
meow_verify_release "$RELEASE" "$BACKUP" "$ARTIFACTS/manifest.json"
STAGE='确认其他站点响应未变化'
for route in '' nexus dreams polyverse; do
    meow_request --fail "https://$DOMAIN/${route}${route:+/}" -o "$BACKUP/${route:-home}-after.html"
    cmp -- "$BACKUP/${route:-home}-before.html" "$BACKUP/${route:-home}-after.html"
done
STAGE='完成'
receipt 'deployed-local-verified'
CHANGED=0
printf '\n发布完成，本机 HTTPS 校验通过：https://strgo.com/meow/\n'
printf '版本：%s\n回滚备份：%s\n' "$RELEASE" "$BACKUP"
