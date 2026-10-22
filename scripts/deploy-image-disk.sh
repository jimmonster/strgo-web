#!/usr/bin/env bash
# Install the private ECS-disk API, publish the site, then bootstrap the owner.
set -Eeuo pipefail
umask 077
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$PROJECT_DIR/image_service/deploy/install.sh"
bash "$PROJECT_DIR/deploy.sh"
cd /opt/strgo-image
ADMIN_COUNT="$(.venv/bin/python - /etc/strgo-image.env <<'PY'
import os
import sys
from image_service.cli import load_env
from image_service.security import encryption_key
from image_service.store import Store
load_env(sys.argv[1])
store = Store(os.environ.get('IMAGE_DATA_DIR', '/var/lib/strgo-image'), encryption_key())
with store.connect() as db:
    print(db.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0])
PY
)"
if [[ "$ADMIN_COUNT" == 0 ]]; then
    .venv/bin/python -m image_service.cli --env /etc/strgo-image.env invite --admin
else
    echo '管理员账号已存在，请使用已有账号登录；没有重新发放管理员邀请码。'
fi
echo 'ECS 硬盘版已部署：https://strgo.com/image-playground/'
echo '持久化数据目录：/var/lib/strgo-image/；网站升级保留此目录。'
