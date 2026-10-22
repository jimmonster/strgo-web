#!/usr/bin/env bash
# Build with mirrored toolchains and a rootfs-based sandbox; no Docker Hub requests.
set -Eeuo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/.build"
RUST_VERSION=1.88.0
NPM_REGISTRY="${TERMINAL_NPM_REGISTRY:-https://registry.npmmirror.com}"
ALPINE_MIRROR="${TERMINAL_ALPINE_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/alpine}"
export RUSTUP_DIST_SERVER="${TERMINAL_RUSTUP_DIST_SERVER:-https://rsproxy.cn}"
export RUSTUP_UPDATE_ROOT="${TERMINAL_RUSTUP_UPDATE_ROOT:-https://rsproxy.cn/rustup}"
export CARGO_HOME="$BUILD_DIR/cargo-home"
export RUSTUP_HOME="$BUILD_DIR/rustup-home"
export CARGO_TARGET_DIR="$BUILD_DIR/target"
export CARGO_BUILD_JOBS="${TERMINAL_BUILD_JOBS:-2}"
mkdir -p "$BUILD_DIR/downloads" "$CARGO_HOME" "$RUSTUP_HOME"
for mirror_url in "$NPM_REGISTRY" "$ALPINE_MIRROR" "$RUSTUP_DIST_SERVER" "$RUSTUP_UPDATE_ROOT"; do
    python3 - "$PROJECT_DIR/scripts" "$mirror_url" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
from download import https_url
https_url(sys.argv[2])
PY
done
case "$(uname -m)" in
    x86_64) rust_target=x86_64-unknown-linux-gnu; alpine_arch=x86_64 ;;
    aarch64|arm64) rust_target=aarch64-unknown-linux-gnu; alpine_arch=aarch64 ;;
    *) printf '不支持此 CPU 架构。\n' >&2; exit 1 ;;
esac
if ! command -v cc >/dev/null || ! command -v make >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential ca-certificates
fi
[[ -s /etc/ssl/certs/ca-certificates.crt ]] || { printf '缺少系统 CA 证书，请安装 ca-certificates。\n' >&2; exit 1; }

printf '准备本地 Rust %s 工具链，文件仅保存到项目 .build 目录。\n' "$RUST_VERSION"
if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
    python3 "$PROJECT_DIR/scripts/download.py" "${RUSTUP_UPDATE_ROOT%/}/dist/$rust_target/rustup-init" "$BUILD_DIR/downloads/rustup-init" --sha256
    chmod 0755 "$BUILD_DIR/downloads/rustup-init"
    RUSTUP_INIT_SKIP_PATH_CHECK=yes "$BUILD_DIR/downloads/rustup-init" -y --no-modify-path --profile minimal --default-toolchain "$RUST_VERSION"
else
    "$CARGO_HOME/bin/rustup" toolchain install "$RUST_VERSION" --profile minimal --no-self-update
fi
export PATH="$CARGO_HOME/bin:$PATH"
# This configuration applies only to this project's dedicated Cargo home.
python3 - "$CARGO_HOME/config.toml" "${TERMINAL_CARGO_REGISTRY:-sparse+https://rsproxy.cn/index/}" <<'PY'
import json, sys
from pathlib import Path
registry = sys.argv[2]
if not registry.startswith('sparse+https://') or not registry.endswith('/'):
    raise SystemExit('TERMINAL_CARGO_REGISTRY 必须是以 / 结尾的 sparse+https:// 地址')
Path(sys.argv[1]).write_text('[source.crates-io]\nreplace-with = "terminal-mirror"\n[source.terminal-mirror]\nregistry = ' + json.dumps(registry) + '\n[net]\nretry = 3\n[http]\ntimeout = 90\nmultiplexing = false\n[resolver]\nincompatible-rust-versions = "fallback"\n')
PY

printf '下载并校验固定版本的浏览器终端资源。\n'
python3 "$PROJECT_DIR/scripts/fetch-assets.py" --registry "$NPM_REGISTRY" --cache "$BUILD_DIR/downloads/npm" --output "$PROJECT_DIR/web/vendor"
cd "$PROJECT_DIR"
if [[ ! -f Cargo.lock ]]; then cargo "+$RUST_VERSION" generate-lockfile; fi
cargo "+$RUST_VERSION" test --locked
cargo "+$RUST_VERSION" build --release --locked
install -m 0755 "$CARGO_TARGET_DIR/release/strgo-terminal" "$BUILD_DIR/strgo-terminal"
cp Cargo.lock "$BUILD_DIR/Cargo.lock"

printf '从经校验的 Alpine 根文件系统构建独立 SSH 沙箱，无需拉取基础镜像。\n'
context_dir="$BUILD_DIR/sandbox-context"
mkdir -p "$context_dir"
python3 "$PROJECT_DIR/scripts/fetch-rootfs.py" --mirror "$ALPINE_MIRROR" --arch "$alpine_arch" --cache "$BUILD_DIR/downloads" --output "$context_dir/alpine-minirootfs.tar.gz"
cp /etc/ssl/certs/ca-certificates.crt "$context_dir/ca-certificates.crt"
cp "$PROJECT_DIR/deploy/Dockerfile.sandbox-rootfs" "$context_dir/Dockerfile"
docker build --pull=false --build-arg "ALPINE_MIRROR=${ALPINE_MIRROR%/}" --tag strgo-ssh-sandbox:1 "$context_dir"
printf 'Rust 程序和 SSH 沙箱镜像已构建，接下来由发布脚本运行真实服务检查。\n'

