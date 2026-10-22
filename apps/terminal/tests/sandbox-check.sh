#!/usr/bin/env bash
# Runtime checks; requires Docker, the built image and the deployment network.
set -Eeuo pipefail
PROBE_NAME="strgo-terminal-probe-$$"
trap 'docker rm --force "$PROBE_NAME" >/dev/null 2>&1 || true' EXIT
docker run --rm --init \
    --name "$PROBE_NAME" \
    --network strgo-terminal --read-only --cap-drop=ALL \
    --security-opt=no-new-privileges:true \
    --memory=128m --memory-swap=128m --cpus=0.5 --pids-limit=32 \
    --ulimit=nofile=128:128 --ulimit=nproc=32:32 --user=10001:10001 \
    --tmpfs=/tmp:rw,noexec,nosuid,nodev,size=8m,mode=1777 \
    --tmpfs=/home/terminal:rw,noexec,nosuid,nodev,size=8m,uid=10001,gid=10001,mode=0700 \
    --log-driver=none --pull=never --entrypoint /bin/sh strgo-ssh-sandbox:1 -ec '
        test "$(id -u)" = 10001
        test ! -e /var/run/docker.sock
        test ! -e /var/www/strgo
        if touch /etc/strgo-write-test 2>/dev/null; then exit 1; fi
        printf probe > /home/terminal/probe
        rm /home/terminal/probe
        awk '\''$1 == "CapEff:" { if ($2 != "0000000000000000") exit 1; seen=1 } END { if (!seen) exit 1 }'\'' /proc/self/status
        awk '\''$1 == "NoNewPrivs:" { if ($2 != 1) exit 1; seen=1 } END { if (!seen) exit 1 }'\'' /proc/self/status
        if test -f /sys/fs/cgroup/memory.max; then
            test "$(cat /sys/fs/cgroup/memory.max)" = 134217728
            test "$(cat /sys/fs/cgroup/pids.max)" = 32
            test "$(cat /sys/fs/cgroup/cpu.max)" = "50000 100000"
        else
            test "$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)" = 134217728
            test "$(cat /sys/fs/cgroup/pids/pids.max)" = 32
            test "$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us)" = 50000
        fi
        ssh -V
    '
printf '真实沙箱检查通过：普通用户、只读根目录、临时目录、禁止提权、无能力与资源上限。\n'
