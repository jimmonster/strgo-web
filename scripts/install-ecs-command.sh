#!/usr/bin/env bash
# Install only the command; deployment is an explicit `strgo deploy` invocation.
set -Eeuo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$PROJECT_DIR/scripts/strgo"
BIN_DIR="${STRGO_BIN_DIR:-/usr/local/bin}"
TARGET="$BIN_DIR/strgo"
[[ -x "$SOURCE" && -f "$PROJECT_DIR/scripts/deploy_ecs.py" ]] || { printf '请从完整 strgo-web 仓库执行本安装脚本。\n' >&2; exit 1; }
if [[ -e "$TARGET" || -L "$TARGET" ]]; then
    [[ -L "$TARGET" && "$(readlink -f -- "$TARGET")" == "$SOURCE" ]] || { printf '%s 已被其他程序使用，请先核对；未覆盖。\n' "$TARGET" >&2; exit 1; }
else
    install -d -m 0755 -- "$BIN_DIR"
    ln -s -- "$SOURCE" "$TARGET"
fi
printf '已安装：%s\n检查环境：strgo check\n一键更新：strgo deploy\n' "$TARGET"
