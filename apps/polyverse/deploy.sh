#!/usr/bin/env bash
# Publish the prepared site on the existing strgo.com HTTPS virtual host.
set -Eeuo pipefail
umask 022
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SITE_ROOT='/var/www/polyverse'
CONFIG='/etc/nginx/sites-available/strgo.conf'
SNIPPET='/etc/nginx/snippets/polyverse.conf'
DOMAIN='strgo.com'
ARTIFACTS="$PROJECT_DIR/artifacts/deployment"
CHANGED=0
HAD_SNIPPET=0
OLD_TARGET=''
BACKUP=''
RELEASE=''
STAGE='发布前检查'
source "$PROJECT_DIR/lib/deploy-http.sh"

fail() { printf '%s\n' "部署未完成：$*" >&2; exit 1; }

rollback() {
    local code="${1:-$?}"
    trap - ERR INT TERM
    if [[ "$CHANGED" == 1 ]]; then
        set +e
        cp -a -- "$BACKUP/strgo.conf" "$CONFIG"
        if [[ "$HAD_SNIPPET" == 1 ]]; then
            cp -a -- "$BACKUP/polyverse.conf" "$SNIPPET"
        else
            rm -f -- "$SNIPPET"
        fi
        if [[ -n "$OLD_TARGET" ]]; then
            ln -s -- "$OLD_TARGET" "$SITE_ROOT/.rollback-$$"
            mv -Tf -- "$SITE_ROOT/.rollback-$$" "$SITE_ROOT/current"
        else
            rm -f -- "$SITE_ROOT/current"
        fi
        if nginx -t; then systemctl reload nginx; fi
        printf '失败步骤：%s\n' "$STAGE" >&2
        printf '%s\n' '发布验证失败，已尝试恢复原 Nginx 配置和上一版本。' >&2
        printf '备份目录：%s\n' "$BACKUP" >&2
    fi
    exit "$code"
}
trap 'rollback "$?"' ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM

[[ "$EUID" -eq 0 ]] || fail '请在服务器普通终端以 root 执行。'
for command in node python3 nginx curl systemctl flock cmp; do
    command -v "$command" >/dev/null || fail "缺少命令：$command"
done
POLYVERSE_NGINX_CONFIG="$CONFIG" node "$PROJECT_DIR/scripts/prepare-deployment.mjs"
python3 - <<'PY' || fail '当前会话禁止网络 socket；请在服务器普通 SSH / Workbench 终端执行本脚本。线上未切换。'
import socket
try:
    with socket.socket(): pass
except OSError as error:
    raise SystemExit('Socket preflight blocked: ' + str(error))
PY
[[ -d /run/systemd/system ]] || fail '需要已运行 systemd 的服务器。'
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || fail '主站配置必须是普通文件。'
[[ "$(readlink -f -- /etc/nginx/sites-enabled/strgo.conf)" == "$CONFIG" ]] || fail '主站启用链接未指向预期配置，未修改线上。'
if [[ -e "$SNIPPET" ]]; then
    [[ -f "$SNIPPET" && ! -L "$SNIPPET" ]] || fail '已有同名 Nginx 片段不是普通文件。'
    [[ "$(head -n 1 -- "$SNIPPET")" == '# Managed by polyverse/deploy.sh' ]] || fail '已有同名 Nginx 片段不属于本项目。'
fi
nginx -t
systemctl is-active --quiet nginx || fail '现有 Nginx 服务未运行。'
install -d -m 0755 "$SITE_ROOT/releases"
exec 9> "$SITE_ROOT/.deploy.lock"
flock -n 9 || fail '另一发布正在运行。'
if [[ -e "$SITE_ROOT/current" || -L "$SITE_ROOT/current" ]]; then
    [[ -L "$SITE_ROOT/current" ]] || fail '已有 current 不是符号链接，未覆盖。'
    OLD_TARGET="$(readlink -- "$SITE_ROOT/current")"
fi
# Refresh the candidate while holding the deployment lock.
POLYVERSE_NGINX_CONFIG="$CONFIG" node "$PROJECT_DIR/scripts/prepare-deployment.mjs"
RELEASE="$SITE_ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 0755 "$RELEASE/polyverse"
cp -R -- "$PROJECT_DIR/dist/." "$RELEASE/polyverse/"
find "$RELEASE" -type d -exec chmod 0755 {} +
find "$RELEASE" -type f -exec chmod 0644 {} +
BACKUP="$(mktemp -d "$SITE_ROOT/.backup.XXXXXX")"
cp -a -- "$CONFIG" "$BACKUP/strgo.conf"
if [[ -f "$SNIPPET" ]]; then
    HAD_SNIPPET=1
    cp -a -- "$SNIPPET" "$BACKUP/polyverse.conf"
fi
STAGE='保存主站响应'
polyverse_fetch "https://$DOMAIN/" -o "$BACKUP/home-before.html"
STAGE='安装候选配置和版本'
CHANGED=1
install -m 0644 -- "$ARTIFACTS/polyverse.conf" "$SNIPPET.new-$$"
mv -Tf -- "$SNIPPET.new-$$" "$SNIPPET"
install -m 0644 -- "$ARTIFACTS/strgo.conf.candidate" "$CONFIG.new-$$"
mv -Tf -- "$CONFIG.new-$$" "$CONFIG"
ln -s -- "$RELEASE" "$SITE_ROOT/.current-$$"
mv -Tf -- "$SITE_ROOT/.current-$$" "$SITE_ROOT/current"
STAGE='检查候选 Nginx 配置'
nginx -t
STAGE='重载 Nginx 并等待新配置就绪'
systemctl reload nginx
EXPECTED_HASH="$(node -e 'console.log(require(process.argv[1]).importMapHash)' "$ARTIFACTS/manifest.json")"
polyverse_wait_for_release "$RELEASE/polyverse/index.html" "$EXPECTED_HASH" \
    "https://$DOMAIN/polyverse/" "$BACKUP"

STAGE='逐页校验'
while IFS= read -r relative; do
    if [[ "$relative" == 'index.html' ]]; then
        address=''
    else
        address="${relative%index.html}"
    fi
    polyverse_fetch "https://$DOMAIN/polyverse/$address" -D "$BACKUP/last.headers" -o "$BACKUP/served"
    cmp -- "$RELEASE/polyverse/$relative" "$BACKUP/served"
done < <(node -e 'const m=require(process.argv[1]);for(const p of m.routes)console.log((p?p+"/":"")+"index.html")' "$PROJECT_DIR/dist/build-info.json")
STAGE='资源与安全策略校验'
for relative in assets/app.js assets/styles.css assets/vendor/three.module.js assets/polyverse-display.ttf; do
    polyverse_fetch "https://$DOMAIN/polyverse/$relative" -D "$BACKUP/last.headers" -o "$BACKUP/served"
    cmp -- "$RELEASE/polyverse/$relative" "$BACKUP/served"
done
polyverse_fetch "https://$DOMAIN/polyverse/" -D "$BACKUP/headers" -o "$BACKUP/served"
grep -F -- "$EXPECTED_HASH" "$BACKUP/headers" >/dev/null
STAGE='404 与目录重定向校验'
UNKNOWN_CODE="$(polyverse_local_request -o "$BACKUP/404.html" -w '%{http_code}' "https://$DOMAIN/polyverse/unknown-deployment-probe/")"
[[ "$UNKNOWN_CODE" == 404 ]]
cmp -- "$RELEASE/polyverse/404.html" "$BACKUP/404.html"
REDIRECT="$(polyverse_local_request -o /dev/null -w '%{http_code} %{redirect_url}' "https://$DOMAIN/polyverse?probe=1")"
[[ "$REDIRECT" == '308 https://strgo.com/polyverse/?probe=1' ]]
STAGE='确认主站及保存发布记录'
polyverse_fetch "https://$DOMAIN/" -o "$BACKUP/home-after.html"
cmp -- "$BACKUP/home-before.html" "$BACKUP/home-after.html"
python3 - "$ARTIFACTS/receipt.json" "$RELEASE" "$BACKUP" <<'PY'
import datetime, json, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    'status':'deployed-local-verified',
    'target':'https://strgo.com/polyverse/',
    'release':sys.argv[2], 'rollbackBackup':sys.argv[3],
    'verified':['14 HTML pages','4 primary assets','import-map CSP','query-preserving redirect','custom 404','main page unchanged'],
    'publicConnectivity':'not yet independently verified',
    'time':datetime.datetime.now(datetime.timezone.utc).isoformat()
},indent=2))
PY
CHANGED=0
printf '\n发布完成，本机 HTTPS 校验通过：https://strgo.com/polyverse/\n'
printf '发布版本：%s\n回滚备份：%s\n' "$RELEASE" "$BACKUP"
