#!/usr/bin/env bash
# Runtime acceptance uses only disposable probe volumes, never account volumes.
set -Eeuo pipefail
IMAGE="${TERMINAL_SANDBOX_IMAGE:-strgo-ssh-sandbox:1}"
PROBE="strgo-workspace-probe-$(date +%s)-$$"
FIRST_VOLUME="$PROBE-a"
SECOND_VOLUME="$PROBE-b"
cleanup() {
    docker rm --force "$PROBE" >/dev/null 2>&1 || true
    docker volume rm "$FIRST_VOLUME" "$SECOND_VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create --label com.strgo.terminal.probe=1 "$FIRST_VOLUME" >/dev/null
docker volume create --label com.strgo.terminal.probe=1 "$SECOND_VOLUME" >/dev/null
probe() {
    local volume="$1" script="$2"
    docker run --rm --init --name "$PROBE" --network none \
        --read-only --cap-drop=ALL --security-opt=no-new-privileges:true \
        --memory=128m --memory-swap=128m --cpus=0.5 --pids-limit=32 \
        --ulimit=nofile=128:128 --ulimit=nproc=32:32 --ulimit=fsize=16777216:16777216 \
        --user=10001:10001 --tmpfs=/tmp:rw,noexec,nosuid,nodev,size=8m,mode=1777 \
        --mount "type=volume,src=$volume,dst=/home/terminal" \
        --log-driver=none --pull=never --entrypoint /bin/sh "$IMAGE" -ec "$script"
}
probe "$FIRST_VOLUME" '
    test "$(id -u)" = 10001
    test ! -e /var/run/docker.sock
    test ! -e /var/www/strgo
    test "$(ls /sys/class/net)" = lo
    if touch /etc/strgo-write-test 2>/dev/null; then exit 1; fi
    printf account-a-file > /home/terminal/account-test
'
probe "$FIRST_VOLUME" 'test "$(cat /home/terminal/account-test)" = account-a-file'
probe "$SECOND_VOLUME" 'test ! -e /home/terminal/account-test; printf account-b-file > /home/terminal/account-test'
probe "$FIRST_VOLUME" 'test "$(cat /home/terminal/account-test)" = account-a-file'
printf '真实工作区检查通过：普通用户、无网络、只读根目录、文件跨容器保留、账号卷相互隔离。\n'
