#!/usr/bin/env bash
# Run in the server's regular terminal after confirming BASE_ORIGIN in site.json.
set -Eeuo pipefail
umask 022

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$PROJECT_DIR/lib/verify-site.sh"
DOMAIN=''
SITE_ROOT='/var/www/strgo'
CONFIG='/etc/nginx/sites-available/strgo.conf'
ENABLED='/etc/nginx/sites-enabled/strgo.conf'
CERT_DIR=''
CERT_EMAIL=''
MARKER='# Managed by strgo-homepage/deploy.sh'
STAGE='preflight'
TRANSACTION=0
OLD_TARGET=''
OLD_CONFIG=0
OLD_ENABLED=''
RELEASE=''
BACKUP_DIR=''

usage() {
    cat <<'HELP'
用法：
  bash deploy.sh                      部署 HTTP 网站
  bash deploy.sh --email 你的邮箱      部署并申请 HTTPS（同意 Let's Encrypt 服务条款）

需要在阿里云服务器的普通终端以 root 执行，Ubuntu 22.04 / 24.04。
先确认 site.json 的 BASE_ORIGIN；对应域名须已解析到本机，安全组须放行入站 TCP 80 / 443。
重复执行可更新网站，已有 HTTPS 证书会保留。
HELP
}

while (($#)); do
    case "$1" in
        --email)
            [[ $# -ge 2 ]] || { usage; exit 2; }
            CERT_EMAIL="$2"
            shift 2
            ;;
        -h|--help) usage; exit 0 ;;
        *) printf '未知参数：%s\n' "$1" >&2; usage; exit 2 ;;
    esac
done

fail() { printf '错误：%s\n' "$*" >&2; exit 1; }

rollback() {
    if [[ "$TRANSACTION" == 1 ]]; then
        printf '\n发布失败，正在恢复上一版配置和网站。\n' >&2
        if [[ "$OLD_CONFIG" == 1 ]]; then
            cp -a -- "$BACKUP_DIR/strgo.conf" "$CONFIG"
        else
            rm -f -- "$CONFIG"
        fi
        rm -f -- "$ENABLED"
        if [[ -n "$OLD_ENABLED" ]]; then ln -s -- "$OLD_ENABLED" "$ENABLED"; fi
        if [[ -n "$OLD_TARGET" ]]; then
            ln -s -- "$OLD_TARGET" "$SITE_ROOT/.rollback-$$"
            mv -Tf -- "$SITE_ROOT/.rollback-$$" "$SITE_ROOT/current"
        else
            rm -f -- "$SITE_ROOT/current"
        fi
        if nginx -t; then systemctl reload nginx || true; fi
    fi
}

on_error() {
    local code="$?"
    trap - ERR
    set +e
    rollback
    printf '\n未完成步骤：%s。错误码：%s。\n' "$STAGE" "$code" >&2
    printf '诊断命令：bash %s/check.sh\n' "$PROJECT_DIR" >&2
    exit "$code"
}
trap on_error ERR

[[ "$EUID" -eq 0 ]] || fail '请以 root 执行，例如 sudo bash deploy.sh。'
[[ -f /etc/os-release ]] || fail '找不到系统信息。'
source /etc/os-release
[[ "${ID:-}" == ubuntu || "${ID:-}" == debian ]] || fail '本脚本仅适用于 Ubuntu / Debian。'
[[ -d /run/systemd/system ]] || fail '本脚本需要运行 systemd 的服务器环境。'
command -v python3 >/dev/null || fail '需要 Python 3，请先安装 python3。'
command -v curl >/dev/null || fail '需要 curl，请先安装 curl。'
python3 -c 'import socket; s=socket.socket(); s.close()' || fail '当前终端禁止网络 socket。请在服务器的普通 SSH/Workbench 终端执行本脚本。'
DOMAIN="$(python3 - "$PROJECT_DIR" <<'PY'
import json, sys
from urllib.parse import urlparse
sys.path.insert(0, sys.argv[1])
from build import validate
config = validate(json.load(open(sys.argv[1] + '/site.json', encoding='utf-8')))
if not config.get('BASE_ORIGIN'):
    raise SystemExit('请先核对 strg.com 与 strgo.com，并在 site.json 填写 BASE_ORIGIN；本地构建不需要此配置。')
origin = urlparse(config['BASE_ORIGIN'])
if origin.port:
    raise SystemExit('自动 Nginx 发布仅支持标准 HTTP(S) 端口。')
print(origin.hostname)
PY
)"
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
TERMINAL_REUSE_PROXY="$(python3 - "$PROJECT_DIR/site.json" "$DOMAIN" <<'PYCFG'
import json, sys
from urllib.parse import urlparse
config = json.load(open(sys.argv[1], encoding='utf-8'))
target = config.get('TERMINAL_TARGET_URL', '')
parsed = urlparse(target)
print('1' if target and (target.startswith('/') or parsed.hostname == sys.argv[2]) and parsed.path.rstrip('/') == '/terminal' else '0')
PYCFG
)"
if [[ -n "$CERT_EMAIL" ]]; then
    [[ "$CERT_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail '--email 后需要有效邮箱。'
fi
if [[ -e "$CONFIG" || -L "$CONFIG" ]]; then
    [[ -f "$CONFIG" && ! -L "$CONFIG" ]] || fail "$CONFIG 已存在且不是普通文件，请先检查。"
    IFS= read -r first_line < "$CONFIG"
    [[ "$first_line" == "$MARKER" ]] || fail "$CONFIG 不属于本项目，已停止以保护现有配置。"
fi
if [[ -e "$ENABLED" || -L "$ENABLED" ]]; then
    [[ -L "$ENABLED" ]] || fail "$ENABLED 不是符号链接，请先检查。"
    [[ "$(readlink -f -- "$ENABLED")" == "$CONFIG" ]] || fail "$ENABLED 指向其他配置，已停止。"
    OLD_ENABLED="$(readlink -- "$ENABLED")"
fi
if [[ -e "$SITE_ROOT/current" || -L "$SITE_ROOT/current" ]]; then
    [[ -L "$SITE_ROOT/current" ]] || fail "$SITE_ROOT/current 已存在且不是符号链接。"
    OLD_TARGET="$(readlink -- "$SITE_ROOT/current")"
fi

STAGE='安装 Nginx'
if ! command -v nginx >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y nginx
fi
nginx -t
if [[ -n "$CERT_EMAIL" ]] && ! command -v certbot >/dev/null; then
    STAGE='安装 HTTPS 证书工具'
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
fi

STAGE='构建并准备网站'
BUILD_SCHEME=http
if [[ -s "$CERT_DIR/fullchain.pem" && -s "$CERT_DIR/privkey.pem" ]]; then BUILD_SCHEME=https; fi
python3 "$PROJECT_DIR/build.py" --scheme "$BUILD_SCHEME" --require-vendor
RELEASE="$SITE_ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 0755 "$SITE_ROOT/releases" "$RELEASE" /etc/nginx/sites-available /etc/nginx/sites-enabled
cp -R -- "$PROJECT_DIR/dist/." "$RELEASE/"
find "$RELEASE" -type d -exec chmod 0755 {} +
find "$RELEASE" -type f -exec chmod 0644 {} +
BACKUP_DIR="$(mktemp -d "$SITE_ROOT/.deploy-backup.XXXXXX")"
if [[ -f "$CONFIG" ]]; then
    cp -a -- "$CONFIG" "$BACKUP_DIR/strgo.conf"
    OLD_CONFIG=1
fi
TRANSACTION=1
ln -s -- "$RELEASE" "$SITE_ROOT/.current-$$"
mv -Tf -- "$SITE_ROOT/.current-$$" "$SITE_ROOT/current"

render_content_config() {
    cat <<NGINX
    root $SITE_ROOT/current;
    index index.html;
    charset utf-8;
    server_tokens off;
    autoindex off;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'none'; base-uri 'none'; style-src 'self'; script-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'" always;
    add_header Cache-Control "no-cache" always;
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript application/json image/svg+xml application/xml;
    location = /nexus { return 308 /nexus/\$is_args\$args; }
    location = /image-playground { return 308 /image-playground/\$is_args\$args; }
    location = /dreams { return 308 /dreams/\$is_args\$args; }
    location /dreams/ {
        error_page 404 /dreams/404.html;
        try_files \$uri \$uri/ =404;
    }
    location / { try_files \$uri \$uri/ =404; }
    location ~ /\. { deny all; }
NGINX
    if [[ -f /etc/nginx/snippets/strgo-image.conf ]]; then
        printf '%s\n' '    include /etc/nginx/snippets/strgo-image.conf;'
    else
        printf '%s\n' '    location ^~ /api/image/ { default_type application/json; return 503 '\''{"error":"Image service is not configured"}'\''; }'
    fi
    if [[ -f /etc/nginx/snippets/polyverse.conf ]]; then
        printf '%s\n' '    include /etc/nginx/snippets/polyverse.conf;'
    fi
    if [[ -f /etc/nginx/snippets/swarmera.conf ]]; then
        printf '%s\n' '    include /etc/nginx/snippets/swarmera.conf;'
    fi
    if [[ -f /etc/nginx/snippets/meow.conf ]]; then
        printf '%s\n' '    include /etc/nginx/snippets/meow.conf;'
    fi
    if [[ "$TERMINAL_REUSE_PROXY" == 1 && -s "$CERT_DIR/fullchain.pem" && -s "$CERT_DIR/privkey.pem" && -f /etc/nginx/snippets/strgo-terminal.conf ]]; then
        printf '%s\n' '    include /etc/nginx/snippets/strgo-terminal.conf;'
    fi
}

render_config() {
    printf '%s\n' "$MARKER"
    if [[ -s "$CERT_DIR/fullchain.pem" && -s "$CERT_DIR/privkey.pem" ]]; then
        cat <<NGINX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    root $SITE_ROOT/current;
    location ^~ /.well-known/acme-challenge/ { default_type text/plain; try_files \$uri =404; }
    location / { return 301 https://$DOMAIN\$request_uri; }
}
server {
    listen 443 ssl;
    server_name $DOMAIN;
    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:STRGO_SSL:10m;
    ssl_session_timeout 1d;
NGINX
        render_content_config
        printf '}\n'
    else
        cat <<NGINX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    location ^~ /.well-known/acme-challenge/ { default_type text/plain; try_files \$uri =404; }
NGINX
        render_content_config
        printf '}\n'
    fi
}

STAGE='启用网站并检查 Nginx'
render_config > "$CONFIG"
ln -sfn -- "$CONFIG" "$ENABLED"
nginx -t
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
    ufw allow 80/tcp
    if [[ -n "$CERT_EMAIL" || "$BUILD_SCHEME" == https ]]; then ufw allow 443/tcp; fi
fi
systemctl enable nginx
if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl start nginx; fi

STAGE='验证本机域名访问'
if [[ "$BUILD_SCHEME" == https ]]; then
    verify_site "$RELEASE/index.html" "$BACKUP_DIR/served.html" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/"
else
    verify_site "$RELEASE/index.html" "$BACKUP_DIR/served.html" -H "Host: $DOMAIN" http://127.0.0.1/
fi
for route in home dance nexus; do
    if [[ "$BUILD_SCHEME" == https ]]; then
        verify_site "$RELEASE/$route/index.html" "$BACKUP_DIR/$route.html" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/$route/"
    else
        verify_site "$RELEASE/$route/index.html" "$BACKUP_DIR/$route.html" -H "Host: $DOMAIN" "http://127.0.0.1/$route/"
    fi
done
for image_file in index.html app.js icons.js reference-image.js styles.css; do
    image_url="image-playground/${image_file/index.html/}"
    if [[ "$BUILD_SCHEME" == https ]]; then
        verify_site "$RELEASE/image-playground/$image_file" "$BACKUP_DIR/image-check" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/$image_url"
    else
        verify_site "$RELEASE/image-playground/$image_file" "$BACKUP_DIR/image-check" -H "Host: $DOMAIN" "http://127.0.0.1/$image_url"
    fi
done
if [[ -f /etc/nginx/snippets/strgo-image.conf ]]; then
    if [[ "$BUILD_SCHEME" == https ]]; then
        curl --fail --silent --show-error --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/image/session" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("user") is None and "storageReady" in d'
    else
        fail '图片账号 API 需要 HTTPS。请先为主站配置证书。'
    fi
fi
for dream_path in dreams/index.html dreams/{01..08}/index.html dreams/src/app.js dreams/src/water.js dreams/assets/art/dream-02.webp; do
    dream_url="${dream_path%index.html}"
    if [[ "$BUILD_SCHEME" == https ]]; then
        verify_site "$RELEASE/$dream_path" "$BACKUP_DIR/dream-check" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/$dream_url"
    else
        verify_site "$RELEASE/$dream_path" "$BACKUP_DIR/dream-check" -H "Host: $DOMAIN" "http://127.0.0.1/$dream_url"
    fi
done
if [[ "$BUILD_SCHEME" == https ]]; then
    verify_dream_routes "$BACKUP_DIR" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN"
else
    verify_dream_routes "$BACKUP_DIR" -H "Host: $DOMAIN" http://127.0.0.1
fi
if [[ -f /etc/nginx/snippets/polyverse.conf ]]; then
    [[ -L /var/www/polyverse/current ]] || fail 'POLYVERSE 配置片段存在，但 /var/www/polyverse/current 不是有效版本链接。'
    POLYVERSE_EXPECTED="$(readlink -f -- /var/www/polyverse/current)/polyverse/index.html"
    [[ -f "$POLYVERSE_EXPECTED" ]] || fail "找不到 POLYVERSE 首页：$POLYVERSE_EXPECTED"
    if [[ "$BUILD_SCHEME" == https ]]; then
        verify_site "$POLYVERSE_EXPECTED" "$BACKUP_DIR/polyverse.html" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/polyverse/"
    else
        verify_site "$POLYVERSE_EXPECTED" "$BACKUP_DIR/polyverse.html" -H "Host: $DOMAIN" "http://127.0.0.1/polyverse/"
    fi
fi
if [[ -f /etc/nginx/snippets/meow.conf ]]; then
    [[ -L /var/www/meow/current ]] || fail 'MEOW 配置片段存在，但 /var/www/meow/current 不是有效版本链接。'
    MEOW_EXPECTED="$(readlink -f -- /var/www/meow/current)/meow/index.html"
    [[ -f "$MEOW_EXPECTED" ]] || fail "找不到 MEOW 首页：$MEOW_EXPECTED"
    if [[ "$BUILD_SCHEME" == https ]]; then
        verify_site "$MEOW_EXPECTED" "$BACKUP_DIR/meow.html" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/meow/"
    else
        verify_site "$MEOW_EXPECTED" "$BACKUP_DIR/meow.html" -H "Host: $DOMAIN" "http://127.0.0.1/meow/"
    fi
fi
if [[ -f /etc/nginx/snippets/swarmera.conf ]]; then
    [[ -L /var/www/swarmera/current ]] || fail 'SWARMERA 配置片段存在，但 /var/www/swarmera/current 不是有效版本链接。'
    SWARMERA_EXPECTED="$(readlink -f -- /var/www/swarmera/current)/swarmera/index.html"
    [[ -f "$SWARMERA_EXPECTED" ]] || fail "找不到 SWARMERA 首页：$SWARMERA_EXPECTED"
    if [[ "$BUILD_SCHEME" == https ]]; then
        verify_site "$SWARMERA_EXPECTED" "$BACKUP_DIR/swarmera.html" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/swarmera/"
    else
        verify_site "$SWARMERA_EXPECTED" "$BACKUP_DIR/swarmera.html" -H "Host: $DOMAIN" "http://127.0.0.1/swarmera/"
    fi
fi
TRANSACTION=0
printf '\n网站已部署，本机验证通过：%s://%s\n' "$BUILD_SCHEME" "$DOMAIN"

if [[ -n "$CERT_EMAIL" ]]; then
    STAGE='申请 HTTPS 证书（需要公网 80 端口可访问）'
    if ! certbot certonly --webroot --webroot-path "$SITE_ROOT/current" --non-interactive --agree-tos --email "$CERT_EMAIL" --domain "$DOMAIN"; then
        printf '\n证书申请失败，HTTP 网站已保留。请检查域名解析和阿里云安全组的 80 端口，再运行相同命令。\n' >&2
        exit 1
    fi
    STAGE='启用 HTTPS'
    # Take a new snapshot so a failed HTTPS activation restores working HTTP.
    cp -a -- "$CONFIG" "$BACKUP_DIR/strgo.conf"
    OLD_CONFIG=1
    OLD_ENABLED="$CONFIG"
    OLD_TARGET="$RELEASE"
    python3 "$PROJECT_DIR/build.py" --scheme https --require-vendor
    HTTPS_RELEASE="$SITE_ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$-https"
    install -d -m 0755 "$HTTPS_RELEASE"
    cp -R -- "$PROJECT_DIR/dist/." "$HTTPS_RELEASE/"
    find "$HTTPS_RELEASE" -type d -exec chmod 0755 {} +
    find "$HTTPS_RELEASE" -type f -exec chmod 0644 {} +
    TRANSACTION=1
    ln -s -- "$HTTPS_RELEASE" "$SITE_ROOT/.current-$$"
    mv -Tf -- "$SITE_ROOT/.current-$$" "$SITE_ROOT/current"
    render_config > "$CONFIG"
    nginx -t
    systemctl reload nginx
    verify_site "$HTTPS_RELEASE/index.html" "$BACKUP_DIR/served.html" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/"
    TRANSACTION=0
    install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
    cat > /etc/letsencrypt/renewal-hooks/deploy/strgo-reload-nginx <<'HOOK'
#!/bin/sh
set -e
nginx -t
systemctl reload nginx
HOOK
    chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/strgo-reload-nginx
    systemctl enable --now certbot.timer
    BUILD_SCHEME=https
fi
rm -rf -- "$BACKUP_DIR"
printf '\n发布完成：%s://%s\n' "$BUILD_SCHEME" "$DOMAIN"
printf '接下来运行诊断：bash %s/check.sh\n' "$PROJECT_DIR"
printf '本机验证已通过；公网连通性还需从服务器外部确认。\n'
