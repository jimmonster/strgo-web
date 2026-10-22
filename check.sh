#!/usr/bin/env bash
# Read-only diagnostics. No secrets, cloud metadata, or credentials are read.
set -uo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="$(python3 - "$PROJECT_DIR/site.json" <<'PY'
import json, sys
from urllib.parse import urlparse
config = json.load(open(sys.argv[1], encoding='utf-8'))
print(urlparse(config['BASE_ORIGIN']).hostname if config.get('BASE_ORIGIN') else config['domain'])
PY
)"
SITE_ROOT='/var/www/strgo'
printf '\n[1/5] 域名解析\n'
if command -v dig >/dev/null; then
    dig +time=3 +tries=1 +short "$DOMAIN" A
    dig +time=3 +tries=1 +short "$DOMAIN" AAAA
else
    getent ahostsv4 "$DOMAIN" || true
fi
printf '\n[2/5] Nginx 服务和配置\n'
if command -v nginx >/dev/null; then nginx -t 2>&1; else printf '未安装 Nginx\n'; fi
systemctl is-active nginx 2>&1 || true
printf '\n[3/5] HTTP / HTTPS 监听和系统防火墙\n'
ss -lntp '( sport = :80 or sport = :443 )' 2>&1 || true
if command -v ufw >/dev/null; then ufw status 2>&1; fi
printf '\n[4/5] 本机访问（指定域名）\n'
curl --noproxy '*' --silent --show-error --connect-timeout 5 --max-time 10 -I -H "Host: $DOMAIN" http://127.0.0.1/ 2>&1 || true
if [[ -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
    curl --noproxy '*' --silent --show-error --connect-timeout 5 --max-time 10 -I --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" 2>&1 || true
fi
printf '\n[5/5] 通过域名访问（本机视角，不等于外部连通）\n'
curl --noproxy '*' --silent --show-error --connect-timeout 5 --max-time 12 -I "http://$DOMAIN/" 2>&1 || true
curl --noproxy '*' --silent --show-error --connect-timeout 5 --max-time 12 -I "https://$DOMAIN/" 2>&1 || true
printf '\n当前网站版本：\n'
readlink "$SITE_ROOT/current" 2>/dev/null || true
