#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET=/opt/strgo-image
ENV_FILE=/etc/strgo-image.env
[[ "$EUID" == 0 ]] || { echo '请以 root 执行。' >&2; exit 1; }
[[ -d /run/systemd/system ]] || { echo '需要支持 systemd 的 ECS 服务器。' >&2; exit 1; }
python3 -c 'import socket; s=socket.socket(); s.close()' || { echo '当前环境禁止网络 socket；尚未修改系统。' >&2; exit 1; }
command -v nginx >/dev/null || { echo '请先安装主站 Nginx。' >&2; exit 1; }
python3 -c 'import venv, ensurepip' >/dev/null 2>&1 || {
    echo '系统缺少完整的 Python 虚拟环境工具。请先在普通服务器终端运行：' >&2
    echo 'apt-get update && apt-get install -y python3-venv python3-pip' >&2
    echo '安装完成后重新运行本脚本；尚未修改服务或凭据。' >&2
    exit 1
}
id strgo-image >/dev/null 2>&1 || useradd --system --home-dir /var/lib/strgo-image --shell /usr/sbin/nologin strgo-image
install -d -m 0755 "$TARGET" "$TARGET/image_service"
install -d -m 0700 -o strgo-image -g strgo-image /var/lib/strgo-image
cp "$SOURCE"/image_service/*.py "$SOURCE"/image_service/requirements*.txt "$TARGET/image_service/"
chmod 0644 "$TARGET"/image_service/*
# Runtime dependencies contain no secrets and must be readable by strgo-image.
# Use a separate umask from the root-only environment and credential files.
(
    umask 022
    python3 -m venv "$TARGET/.venv"
    "$TARGET/.venv/bin/python" -m pip --version >/dev/null 2>&1 || "$TARGET/.venv/bin/python" -m ensurepip --upgrade
    "$TARGET/.venv/bin/python" -m pip install -r "$TARGET/image_service/requirements.txt"
)
# Also repair permissions on a partially created virtual environment.
chmod -R a+rX "$TARGET/.venv"
if [[ ! -f "$ENV_FILE" ]]; then
    cp "$SOURCE/image_service/.env.example" "$ENV_FILE"
    "$TARGET/.venv/bin/python" - "$ENV_FILE" <<'PY'
from cryptography.fernet import Fernet
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('IMAGE_ENCRYPTION_KEY=\n', 'IMAGE_ENCRYPTION_KEY=' + Fernet.generate_key().decode() + '\n'))
PY
fi
chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"
# This installer follows the requested ECS-disk setup. Preserve the existing
# encryption key and other credentials when upgrading from an OSS template.
"$TARGET/.venv/bin/python" - "$ENV_FILE" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
lines = path.read_text().splitlines()
lines = [line for line in lines if not line.startswith('IMAGE_STORAGE=')]
lines.append('IMAGE_STORAGE=local')
path.write_text('\n'.join(lines) + '\n')
PY
# Test the same persistent disk that the runtime service will use.
cd "$TARGET"
"$TARGET/.venv/bin/python" -m image_service.cli --env "$ENV_FILE" check-storage
# The root-run check can create directories: transfer them to the service user.
chown -R strgo-image:strgo-image /var/lib/strgo-image
# Create SQLite as the service account before root runs any bootstrap commands.
"$TARGET/.venv/bin/python" - "$ENV_FILE" <<'PY'
import os
import pwd
import sys
from image_service.cli import load_env
from image_service.security import encryption_key
from image_service.store import Store
load_env(sys.argv[1])
account = pwd.getpwnam('strgo-image')
os.initgroups(account.pw_name, account.pw_gid)
os.setgid(account.pw_gid)
os.setuid(account.pw_uid)
Store(os.environ.get('IMAGE_DATA_DIR', '/var/lib/strgo-image'), encryption_key())
print('ECS 硬盘与账号数据库已就绪。')
PY
install -m 0644 "$SOURCE/image_service/deploy/strgo-image.service" /etc/systemd/system/strgo-image.service
install -m 0644 "$SOURCE/image_service/deploy/strgo-image.conf" /etc/nginx/snippets/strgo-image.conf
systemctl daemon-reload
systemctl enable strgo-image
systemctl restart strgo-image
echo '图片 API 已启动。主站发布脚本会自动包含 /api/image/ 代理。'
echo '首次管理员邀请码：'
echo "cd $TARGET && .venv/bin/python -m image_service.cli --env $ENV_FILE invite --admin"
echo "发布主站：bash $SOURCE/deploy.sh"
