#!/usr/bin/env bash
# Run from a normal SSH / cloud Workbench terminal with root privileges.
set -Eeuo pipefail
umask 077
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG=/etc/nginx/sites-available/strgo.conf
SNIPPET=/etc/nginx/snippets/strgo-terminal.conf
INSTALL_DIR=/usr/local/lib/strgo-terminal
ENV_DIR=/etc/strgo-terminal
IDENTITY=''
BUILD_MODE=native
IMAGE_PREFIX=docker.io/library
BACKUP=''
TRANSACTION=0
BUILD_CONTAINER=''
STAGE='预检查'

fail() {
    printf '错误：%s\n' "$*" >&2
    if [[ "$TRANSACTION" == 1 ]]; then on_error 1; fi
    exit 1
}
usage() {
    cat <<'HELP'
用法：bash deploy.sh [--identity /绝对路径/SSH私钥] [--build-mode native|docker]
将 Rust 终端接入现有 https://strgo.com/terminal。
在普通 SSH / 阿里云 Workbench 终端中以 root 执行；需要现有主站已启用 HTTPS。
不传 --identity 时使用交互式 SSH 密码登录。已有访问口令会保留。
默认 native 使用本地 Rust 与国内下载源，不访问 Docker Hub；运行时仍使用独立容器。
使用 docker 模式时，可加 --image-prefix 你的仓库/library 指定基础镜像来源。
HELP
}
while (($#)); do
    case "$1" in
        --identity) [[ $# -ge 2 ]] || fail '--identity 缺少路径'; IDENTITY="$2"; shift 2 ;;
        --build-mode) [[ $# -ge 2 ]] || fail '--build-mode 缺少值'; BUILD_MODE="$2"; shift 2 ;;
        --image-prefix) [[ $# -ge 2 ]] || fail '--image-prefix 缺少值'; IMAGE_PREFIX="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) fail "未知参数：$1" ;;
    esac
done
[[ "$BUILD_MODE" == native || "$BUILD_MODE" == docker ]] || fail '--build-mode 只能是 native 或 docker。'
[[ "$IMAGE_PREFIX" =~ ^[A-Za-z0-9][A-Za-z0-9./:_-]*$ && "$IMAGE_PREFIX" != */ ]] || fail '--image-prefix 必须是无协议、无尾部 / 的仓库路径。'
[[ "$EUID" -eq 0 ]] || fail '请以 root 执行。'
[[ -d /run/systemd/system ]] || fail '需要 systemd 环境。'
for tool in python3 curl openssl nginx ip; do command -v "$tool" >/dev/null || fail "缺少工具：$tool"; done
python3 -c 'import socket; s=socket.socket(); s.close()' || fail '当前会话禁止网络 socket，请在普通 SSH / Workbench 终端执行。'
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || fail "未找到现有主站配置：$CONFIG"
python3 "$PROJECT_DIR/scripts/integrate-nginx.py" "$CONFIG" --check
nginx -t
if [[ -n "$IDENTITY" ]]; then
    [[ "$IDENTITY" = /* && -f "$IDENTITY" && "$IDENTITY" != *,* ]] || fail '--identity 必须是现有私钥文件的绝对路径。'
fi
if [[ -e "$SNIPPET" ]]; then
    IFS= read -r marker < "$SNIPPET"
    [[ "$marker" == '# Managed by strgo-terminal/deploy.sh' ]] || fail '终端配置片段已被其他程序占用。'
fi

on_error() {
    local code="${1:-$?}"
    trap - ERR
    set +e
    [[ -z "$BUILD_CONTAINER" ]] || docker rm --force "$BUILD_CONTAINER" >/dev/null 2>&1
    if [[ "$TRANSACTION" == 1 ]]; then
        printf '正在恢复原配置与终端服务。\n' >&2
        cp -a "$BACKUP/strgo.conf" "$CONFIG"
        if [[ -f "$BACKUP/nginx-terminal.conf" ]]; then cp -a "$BACKUP/nginx-terminal.conf" "$SNIPPET"; else rm -f "$SNIPPET"; fi
        systemctl stop strgo-terminal.service strgo-terminal-broker.service
        for file in web.env broker.env identity; do
            if [[ -f "$BACKUP/$file" ]]; then cp -a "$BACKUP/$file" "$ENV_DIR/$file"; else rm -f "$ENV_DIR/$file"; fi
        done
        if [[ -f "$BACKUP/strgo-terminal" ]]; then
            install -m 0755 "$BACKUP/strgo-terminal" "$INSTALL_DIR/strgo-terminal"
            cp -a "$BACKUP/cleanup.sh" "$INSTALL_DIR/cleanup.sh"
        fi
        for unit in strgo-terminal.service strgo-terminal-broker.service; do
            if [[ -f "$BACKUP/$unit" ]]; then cp -a "$BACKUP/$unit" "/etc/systemd/system/$unit"; else rm -f "/etc/systemd/system/$unit"; fi
        done
        systemctl daemon-reload
        if [[ -f "$BACKUP/was-active" ]]; then systemctl start strgo-terminal-broker.service strgo-terminal.service; fi
        if nginx -t; then systemctl reload nginx; fi
    fi
    printf '未完成步骤：%s，错误码：%s。备份位置：%s\n' "$STAGE" "$code" "${BACKUP:-尚未修改系统}" >&2
    exit "$code"
}
trap on_error ERR
trap 'on_error 130' INT
trap 'on_error 143' TERM

STAGE='准备 Docker'
if ! command -v docker >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io
fi
systemctl start docker
docker info >/dev/null

STAGE='构建 Rust 程序与沙箱镜像'
mkdir -p "$PROJECT_DIR/.build"
if [[ "$BUILD_MODE" == native ]]; then
    bash "$PROJECT_DIR/scripts/build-native.sh"
else
    docker build --file "$PROJECT_DIR/deploy/Dockerfile.build" \
        --build-arg "NODE_IMAGE=$IMAGE_PREFIX/node:22-bookworm-slim" \
        --build-arg "RUST_IMAGE=$IMAGE_PREFIX/rust:1.88-bullseye" \
        --tag strgo-terminal-build:0.1.0 "$PROJECT_DIR"
    docker build --file "$PROJECT_DIR/deploy/Dockerfile.sandbox" \
        --build-arg "ALPINE_IMAGE=$IMAGE_PREFIX/alpine:3.21" \
        --tag strgo-ssh-sandbox:1 "$PROJECT_DIR"
    BUILD_CONTAINER="$(docker create strgo-terminal-build:0.1.0 /unused)"
    docker cp "$BUILD_CONTAINER:/strgo-terminal" "$PROJECT_DIR/.build/strgo-terminal"
    docker cp "$BUILD_CONTAINER:/Cargo.lock" "$PROJECT_DIR/.build/Cargo.lock"
    docker cp "$BUILD_CONTAINER:/package-lock.json" "$PROJECT_DIR/.build/package-lock.json"
    docker rm "$BUILD_CONTAINER" >/dev/null
    BUILD_CONTAINER=''
    cp "$PROJECT_DIR/.build/package-lock.json" "$PROJECT_DIR/package-lock.json"
fi
chmod 0755 "$PROJECT_DIR/.build/strgo-terminal"
# Retain the resolved dependencies so the next build uses the same lockfiles.
cp "$PROJECT_DIR/.build/Cargo.lock" "$PROJECT_DIR/Cargo.lock"

STAGE='准备独立容器网络与服务账户'
if ! docker network inspect strgo-terminal >/dev/null 2>&1; then
    docker network create --driver bridge --opt com.docker.network.bridge.enable_icc=false --opt com.docker.network.bridge.name=br-strgo-term strgo-terminal >/dev/null
fi
docker network inspect strgo-terminal > "$PROJECT_DIR/.build/network.json"
python3 - "$PROJECT_DIR/.build/network.json" <<'PY'
import json, sys
network = json.load(open(sys.argv[1]))[0]
assert network['Driver'] == 'bridge' and network.get('Options', {}).get('com.docker.network.bridge.enable_icc') == 'false', '现有 strgo-terminal 网络未启用容器间隔离'
PY
STAGE='验证真实沙箱容器的权限与资源限制'
bash "$PROJECT_DIR/tests/sandbox-check.sh"
if ! getent group strgo-terminal >/dev/null; then groupadd --system strgo-terminal; fi
if ! id strgo-terminal >/dev/null 2>&1; then
    useradd --system --gid strgo-terminal --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin strgo-terminal
fi
case " $(id -nG strgo-terminal) " in *' docker '*) fail '网页服务账户不能属于 docker 组。' ;; esac
install -d -m 0755 "$INSTALL_DIR" /etc/nginx/snippets
install -d -m 0700 "$ENV_DIR"
BACKUP="$(mktemp -d "$ENV_DIR/backup.XXXXXXXX")"
cp -a "$CONFIG" "$BACKUP/strgo.conf"
[[ ! -f "$SNIPPET" ]] || cp -a "$SNIPPET" "$BACKUP/nginx-terminal.conf"
for file in web.env broker.env identity; do [[ ! -f "$ENV_DIR/$file" ]] || cp -a "$ENV_DIR/$file" "$BACKUP/$file"; done
for file in strgo-terminal cleanup.sh; do [[ ! -f "$INSTALL_DIR/$file" ]] || cp -a "$INSTALL_DIR/$file" "$BACKUP/$file"; done
for unit in strgo-terminal.service strgo-terminal-broker.service; do [[ ! -f "/etc/systemd/system/$unit" ]] || cp -a "/etc/systemd/system/$unit" "$BACKUP/$unit"; done
if systemctl is-active --quiet strgo-terminal.service; then touch "$BACKUP/was-active"; fi
TRANSACTION=1

STAGE='安装并启动沙箱代理和网页服务'
if [[ ! -f "$ENV_DIR/web.env" ]]; then
    access_token="$(openssl rand -hex 32)"
    printf 'TERMINAL_ACCESS_TOKEN=%s\nTERMINAL_PUBLIC_ORIGIN=https://strgo.com\nTERMINAL_BIND=127.0.0.1:3081\nTERMINAL_BROKER_SOCKET=/run/strgo-terminal/broker.sock\n' "$access_token" > "$ENV_DIR/web.env"
    unset access_token
fi
if [[ ! -f "$ENV_DIR/broker.env" ]]; then
    python3 - "$ENV_DIR/broker.env" <<'PY'
import json, socket, subprocess, sys
blocked = set()
for interface in json.loads(subprocess.check_output(['ip', '-j', 'address'])):
    for address in interface.get('addr_info', []): blocked.add(address['local'])
for address in socket.getaddrinfo('strgo.com', 443, type=socket.SOCK_STREAM): blocked.add(address[4][0])
with open(sys.argv[1], 'w') as output:
    output.write('TERMINAL_BROKER_SOCKET=/run/strgo-terminal/broker.sock\nTERMINAL_SANDBOX_IMAGE=strgo-ssh-sandbox:1\nTERMINAL_SANDBOX_NETWORK=strgo-terminal\nTERMINAL_MAX_SESSIONS=8\nTERMINAL_SESSION_SECONDS=3600\nTERMINAL_ALLOW_PRIVATE=0\n')
    output.write('TERMINAL_BLOCKED_IPS=' + ','.join(sorted(blocked)) + '\n')
    output.write('TERMINAL_ALLOWED_TARGETS=\n')
PY
fi
if [[ -n "$IDENTITY" ]]; then
    install -o 10001 -g 10001 -m 0400 "$IDENTITY" "$ENV_DIR/identity"
    python3 - "$ENV_DIR/broker.env" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
lines = [line for line in path.read_text().splitlines() if not line.startswith('TERMINAL_IDENTITY_FILE=')]
path.write_text('\n'.join(lines) + '\nTERMINAL_IDENTITY_FILE=/etc/strgo-terminal/identity\n')
PY
fi
chmod 0600 "$ENV_DIR/web.env" "$ENV_DIR/broker.env"
install -m 0755 "$PROJECT_DIR/.build/strgo-terminal" "$INSTALL_DIR/.strgo-terminal.new"
mv -f "$INSTALL_DIR/.strgo-terminal.new" "$INSTALL_DIR/strgo-terminal"
install -m 0755 "$PROJECT_DIR/scripts/cleanup.sh" "$INSTALL_DIR/cleanup.sh"
install -m 0644 "$PROJECT_DIR/deploy/strgo-terminal.service" "$PROJECT_DIR/deploy/strgo-terminal-broker.service" /etc/systemd/system/
systemctl daemon-reload
systemctl restart strgo-terminal-broker.service
systemctl restart strgo-terminal.service
for attempt in {1..20}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:3081/terminal/api/health > "$BACKUP/health.json"; then break; fi
    sleep 1
done
python3 - "$BACKUP/health.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1])).get('status') == 'ok', '终端服务未就绪'
PY
python3 "$PROJECT_DIR/tests/smoke.py" --env "$ENV_DIR/web.env"

STAGE='接入 strgo.com/terminal 并验证'
install -m 0644 "$PROJECT_DIR/deploy/nginx-terminal.conf" "$SNIPPET"
python3 "$PROJECT_DIR/scripts/integrate-nginx.py" "$CONFIG" > "$BACKUP/new-strgo.conf"
install -m 0644 "$BACKUP/new-strgo.conf" "$CONFIG"
nginx -t
systemctl reload nginx
verified=0
for attempt in {1..10}; do
    if curl --fail --silent --show-error --max-time 5 --resolve strgo.com:443:127.0.0.1 https://strgo.com/terminal/ > "$BACKUP/served.html"; then
        if cmp -s "$PROJECT_DIR/web/index.html" "$BACKUP/served.html"; then verified=1; break; fi
    fi
    sleep 1
done
[[ "$verified" == 1 ]] || fail 'HTTPS 返回页面与终端页面不一致。'
systemctl enable strgo-terminal-broker.service strgo-terminal.service
TRANSACTION=0
printf '\n终端部署完成，本机 HTTPS 验证通过：https://strgo.com/terminal\n'
printf '访问口令已保存到 %s/web.env；请在服务器上私下查看，不要粘贴到公开聊天中。\n' "$ENV_DIR"
printf '查看口令：sudo sed -n "s/^TERMINAL_ACCESS_TOKEN=//p" %s/web.env\n' "$ENV_DIR"
printf '日志：journalctl -u strgo-terminal -u strgo-terminal-broker -n 80 --no-pager\n'
