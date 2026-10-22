#!/usr/bin/env bash
# Complete HTTPS setup and terminal deployment from a regular server terminal.
set -Eeuo pipefail
umask 077
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG=/etc/nginx/sites-available/strgo.conf
CERT_DIR=/etc/letsencrypt/live/strgo.com
CERT_EMAIL=''
IDENTITY=''
BUILD_MODE=native
IMAGE_PREFIX=docker.io/library
CHECK_ONLY=0
TLS_BACKUP=''
TLS_TRANSACTION=0
STAGE='检查发布条件'

usage() {
    cat <<'HELP'
用法：
  bash publish.sh                       交互式发布到 https://strgo.com/terminal
  bash publish.sh --email 你的邮箱       申请 HTTPS 并发布（同意 Let's Encrypt 服务条款）
  bash publish.sh --check               只检查安装状态，不修改系统
可选：--identity /绝对路径/SSH私钥
可选：--build-mode native|docker（默认 native，无需 Docker Hub）
可选：--image-prefix 你的仓库/library（docker 模式的基础镜像来源）
需要在服务器普通 SSH / 阿里云 Workbench 终端执行，不能在受限 Codex 会话中发布。
已配置 HTTPS 时会直接部署终端。HTTPS 尚未配置时保留现有主站文件，申请证书后升级其配置。
HELP
}
fail() { printf '错误：%s\n' "$*" >&2; exit 1; }
while (($#)); do
    case "$1" in
        --email) [[ $# -ge 2 ]] || fail '--email 缺少邮箱'; CERT_EMAIL="$2"; shift 2 ;;
        --identity) [[ $# -ge 2 ]] || fail '--identity 缺少私钥路径'; IDENTITY="$2"; shift 2 ;;
        --build-mode) [[ $# -ge 2 ]] || fail '--build-mode 缺少值'; BUILD_MODE="$2"; shift 2 ;;
        --image-prefix) [[ $# -ge 2 ]] || fail '--image-prefix 缺少值'; IMAGE_PREFIX="$2"; shift 2 ;;
        --check) CHECK_ONLY=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) fail "未知参数：$1" ;;
    esac
done
[[ "$BUILD_MODE" == native || "$BUILD_MODE" == docker ]] || fail '--build-mode 只能是 native 或 docker。'
[[ "$IMAGE_PREFIX" =~ ^[A-Za-z0-9][A-Za-z0-9./:_-]*$ && "$IMAGE_PREFIX" != */ ]] || fail '--image-prefix 必须是无协议、无尾部 / 的仓库路径。'
[[ -f "$CONFIG" ]] || fail "现有主站配置不存在：$CONFIG"
if [[ "$CHECK_ONLY" == 1 ]]; then
    python3 - "$CONFIG" "$CERT_DIR" <<'PY'
import re, socket, sys
from pathlib import Path
config = Path(sys.argv[1]).read_text()
checks = {
    '主站 HTTPS 配置': bool(re.search(r'listen\s+(?:\[::\]:)?443\s+ssl\s*;', config)),
    'HTTPS 证书': (Path(sys.argv[2]) / 'fullchain.pem').is_file() and (Path(sys.argv[2]) / 'privkey.pem').is_file(),
    '终端 Nginx 路由': 'include /etc/nginx/snippets/strgo-terminal.conf;' in config and Path('/etc/nginx/snippets/strgo-terminal.conf').is_file(),
    'Rust 终端程序': Path('/usr/local/lib/strgo-terminal/strgo-terminal').is_file(),
    '沙箱代理服务': Path('/etc/systemd/system/strgo-terminal-broker.service').is_file(),
    '网页服务': Path('/etc/systemd/system/strgo-terminal.service').is_file(),
}
try:
    with socket.socket(): pass
    checks['当前终端可使用网络'] = True
except OSError:
    checks['当前终端可使用网络'] = False
for label, ready in checks.items(): print(('就绪' if ready else '缺失') + '：' + label)
if not all(checks.values()): raise SystemExit(1)
print('安装文件已就绪；实际服务与路由可用性仍需部署脚本验证。')
PY
    exit 0
fi
[[ "$EUID" -eq 0 ]] || fail '请以 root 执行，例如 sudo bash publish.sh。'
python3 - <<'PY' || fail '当前会话禁止网络 socket；请在服务器普通 SSH / Workbench 终端执行本脚本。'
import socket
try:
    with socket.socket(): pass
except OSError as error:
    raise SystemExit(f'无法发布：{error}')
PY
[[ ! -L "$CONFIG" ]] || fail '主站配置不是预期的普通文件。'
if [[ -n "$IDENTITY" ]]; then
    [[ "$IDENTITY" = /* && -f "$IDENTITY" && "$IDENTITY" != *,* ]] || fail '--identity 必须是现有私钥文件的绝对路径。'
fi
for tool in nginx curl openssl ip; do command -v "$tool" >/dev/null || fail "缺少工具：$tool"; done

on_error() {
    local code="${1:-$?}"
    trap - ERR INT TERM
    set +e
    if [[ "$TLS_TRANSACTION" == 1 ]]; then
        cp -a "$TLS_BACKUP/strgo.conf" "$CONFIG"
        if nginx -t; then systemctl reload nginx; fi
        printf '已恢复原主站配置，备份：%s\n' "$TLS_BACKUP" >&2
    fi
    printf '尚未发布成功。未完成步骤：%s，错误码：%s。\n' "$STAGE" "$code" >&2
    exit "$code"
}
trap on_error ERR
trap 'on_error 130' INT
trap 'on_error 143' TERM

if ! python3 "$PROJECT_DIR/scripts/integrate-nginx.py" "$CONFIG" --check >/dev/null 2>&1; then
    STAGE='检查现有 HTTP 网站与 HTTPS 转换'
    site_webroot="$(python3 "$PROJECT_DIR/scripts/enable-https.py" "$CONFIG" --webroot)"
    [[ -f "$site_webroot/index.html" ]] || fail '现有站点文件不完整，请先修复主站。'
    nginx -t
    if [[ ! -s "$CERT_DIR/fullchain.pem" || ! -s "$CERT_DIR/privkey.pem" ]]; then
        if [[ -z "$CERT_EMAIL" ]]; then
            [[ -t 0 ]] || fail '尚无 HTTPS 证书：在普通交互终端执行，或提供 --email 以申请证书并同意服务条款。'
            printf '申请 strgo.com 的 HTTPS 证书需要同意 Let\047s Encrypt 服务条款。\n'
            printf '服务条款：https://letsencrypt.org/repository/\n'
            read -r -p '若同意，请输入证书联系邮箱；取消可按 Ctrl+C：' CERT_EMAIL
        fi
        [[ "$CERT_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail '需要有效的联系邮箱。'
        STAGE='安装证书工具'
        if ! command -v certbot >/dev/null; then
            apt-get update
            DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
        fi
        STAGE='申请 strgo.com 的 HTTPS 证书'
        certbot certonly --webroot --webroot-path "$site_webroot" --non-interactive --agree-tos --email "$CERT_EMAIL" --domain strgo.com
    fi
    STAGE='启用现有主站 HTTPS'
    TLS_BACKUP="$(mktemp -d /etc/nginx/.strgo-https-backup.XXXXXXXX)"
    cp -a "$CONFIG" "$TLS_BACKUP/strgo.conf"
    python3 "$PROJECT_DIR/scripts/enable-https.py" "$CONFIG" > "$TLS_BACKUP/https.conf"
    TLS_TRANSACTION=1
    install -m 0644 "$TLS_BACKUP/https.conf" "$CONFIG"
    nginx -t
    if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then ufw allow 443/tcp; fi
    systemctl reload nginx
    verified=0
    for attempt in {1..10}; do
        if curl --fail --silent --show-error --max-time 5 --resolve strgo.com:443:127.0.0.1 https://strgo.com/ > "$TLS_BACKUP/served.html"; then
            if cmp -s "$site_webroot/index.html" "$TLS_BACKUP/served.html"; then verified=1; break; fi
        fi
        sleep 1
    done
    if [[ "$verified" != 1 ]]; then on_error 1; fi
    TLS_TRANSACTION=0
    systemctl enable --now certbot.timer
    printf '现有主站 HTTPS 已启用，本机验证通过。\n'
fi

STAGE='构建并发布终端服务与独立沙箱'
terminal_args=(--build-mode "$BUILD_MODE" --image-prefix "$IMAGE_PREFIX")
if [[ -n "$IDENTITY" ]]; then terminal_args+=(--identity "$IDENTITY"); fi
bash "$PROJECT_DIR/deploy.sh" "${terminal_args[@]}"
printf '请用手机访问 https://strgo.com/terminal；云安全组需允许入站 TCP 443。\n'
