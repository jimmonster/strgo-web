#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY="$ROOT/comfyui/deploy"
HOME_DIR=/opt/strgo-comfyui
ETC=/etc/strgo-comfyui
STATE=/var/lib/strgo-comfyui
BACKUPS=/var/backups/strgo-comfyui
ACCOUNT=/opt/strgo-image/image_service
AVAILABLE=/etc/nginx/sites-available/comfyui.strgo.com.conf
ENABLED=/etc/nginx/sites-enabled/comfyui.strgo.com.conf
CERT=/etc/letsencrypt/live/comfyui.strgo.com
BASE=fcbaac8eca36033bd9af36f2940c37fcbbbece56
FILES=(app.py store.py admin.py comfy_auth.py)
COMFY_UNITS=(strgo-comfyui.service strgo-comfyui-ws.service)

fail() { printf '%s\n' "$*" >&2; exit 1; }
exists() { [[ -e "$1" || -L "$1" ]]; }
managed_vhost() {
    [[ -f "$AVAILABLE" && ! -L "$AVAILABLE" ]] &&
        [[ "$(head -n 1 "$AVAILABLE")" == '# Managed by STRGO ComfyUI API-only' ]] &&
        [[ -L "$ENABLED" && "$(readlink "$ENABLED")" == "$AVAILABLE" ]]
}
vhost_check() {
    if exists "$AVAILABLE" || exists "$ENABLED"; then
        managed_vhost || fail 'Existing ComfyUI Nginx paths are not owned by this deployer.'
    fi
    if nginx -T 2>/dev/null | awk -v managed="$AVAILABLE" -v enabled="$ENABLED" '
        /^# configuration file / { file=$4; sub(/:$/,"",file) }
        /^[[:space:]]*server_name[[:space:]]/ && /(^|[[:space:]])comfyui\.strgo\.com([[:space:];]|$)/ &&
        file != managed && file != enabled { found=1 }
        END { exit !found }'; then
        fail 'Another Nginx configuration already serves comfyui.strgo.com.'
    fi
}
vhost_write() {
    local candidate
    candidate="$(mktemp /etc/nginx/sites-available/.strgo-comfyui.XXXXXX)"
    cat "$DEPLOY/nginx-http.conf" > "$candidate"
    if [[ "$1" == https ]]; then
        cat "$DEPLOY/nginx-https.conf" >> "$candidate"
    fi
    chmod 0644 "$candidate"
    mv -T "$candidate" "$AVAILABLE"
    [[ -L "$ENABLED" ]] || ln -s "$AVAILABLE" "$ENABLED"
}
release_link() {
    ln -s "$1" "$HOME_DIR/.current-next"
    mv -T "$HOME_DIR/.current-next" "$HOME_DIR/current"
}
python_release() { (cd "$ROOT" && python3.12 -m "$@"); }

[[ "$EUID" == 0 && -d /run/systemd/system ]] || fail 'Run as root in the ECS systemd environment.'
[[ "$#" -le 1 ]] || fail 'Usage: install.sh [--check|--prepare-http]'
mode="${1:-install}"
[[ "$mode" == install || "$mode" == --check || "$mode" == --prepare-http ]] || fail 'Invalid mode.'
for command in nginx systemctl git curl openssl python3.12 ss flock; do
    command -v "$command" >/dev/null || fail "Missing command: $command"
done
exec 9>/run/lock/strgo-comfyui.lock
flock -n 9 || fail 'A ComfyUI deployment or rollback is in progress.'
nginx -t
systemctl is-active --quiet nginx
systemctl is-active --quiet strgo-image
vhost_check
getent ahostsv4 comfyui.strgo.com >/dev/null || fail 'comfyui.strgo.com has no accessible IPv4 DNS record.'
[[ "$(uname -m)" == x86_64 ]] || fail 'The CPU-wheel lock targets Linux x86_64.'
if [[ "$mode" == --check ]]; then
    python_release comfyui.deploy.backup
    free -m
    swapon --show
    df -h /opt /var/lib
    ss -lntp '( sport = :80 or sport = :443 or sport = :8092 or sport = :8188 or sport = :8189 )'
    systemctl --no-pager --type=service --state=running
    ps -eo pid,comm,rss --sort=-rss | head -16
    exit
fi
if [[ "$mode" == --prepare-http ]]; then
    if managed_vhost; then
        cmp -s "$AVAILABLE" "$DEPLOY/nginx-http.conf" || fail 'An active HTTPS vhost already exists.'
    else
        install -d -m 0755 /var/www/strgo-comfyui-acme
        vhost_write http
        if ! nginx -t || ! systemctl reload nginx; then
            rm -f -- "$ENABLED" "$AVAILABLE"
            nginx -t && systemctl reload nginx
            fail 'Could not publish the ComfyUI ACME vhost.'
        fi
    fi
    exit
fi
[[ -s "$CERT/fullchain.pem" && -s "$CERT/privkey.pem" ]] || fail 'Install the HTTPS certificate first.'
openssl x509 -in "$CERT/fullchain.pem" -noout -checkend 86400 >/dev/null
openssl x509 -in "$CERT/fullchain.pem" -noout -checkhost comfyui.strgo.com | grep -Fq 'does match certificate'
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || fail 'Deploy from a clean, committed checkout.'
REVISION="$(git -C "$ROOT" rev-parse HEAD)"
RELEASE="$HOME_DIR/releases/$REVISION"
if [[ -L "$HOME_DIR/current" && "$(readlink "$HOME_DIR/current")" == "$RELEASE" ]]; then
    python_release comfyui.deploy.healthcheck --public
    exit
fi
[[ ! -e "$HOME_DIR" || -f "$HOME_DIR/.strgo-managed" ]] || fail "$HOME_DIR is already occupied."
[[ ! -e "$ETC" || -f "$ETC/.strgo-managed" ]] || fail "$ETC is already occupied."
[[ ! -e "$STATE" || -f "$STATE/.strgo-managed" ]] || fail "$STATE is already occupied."
for unit in "${COMFY_UNITS[@]}"; do
    if exists "/etc/systemd/system/$unit"; then
        [[ -f "$HOME_DIR/.strgo-managed" && ! -L "/etc/systemd/system/$unit" ]] || fail "$unit already exists."
    fi
done
if [[ ! -L "$HOME_DIR/current" && -n "$(ss -H -lnt '( sport = :8188 or sport = :8189 )')" ]]; then
    fail 'Loopback port 8188 or 8189 is already occupied.'
fi
if [[ -f "$HOME_DIR/account.sha256" ]]; then
    (cd "$ACCOUNT" && sha256sum -c "$HOME_DIR/account.sha256" --quiet) ||
        fail 'The live account code changed outside the ComfyUI deployment.'
else
    for name in app.py store.py admin.py; do
        [[ -f "$ACCOUNT/$name" && ! -L "$ACCOUNT/$name" ]] || fail "Unexpected live account file: $name"
        git -C "$ROOT" show "$BASE:image_service/$name" | cmp -s "$ACCOUNT/$name" - ||
            fail "Live account file $name differs from the reviewed base $BASE."
    done
    ! exists "$ACCOUNT/comfy_auth.py" || fail 'The account adapter path is already occupied.'
fi
python_release comfyui.deploy.backup
df -Pk /opt /var/lib | awk 'NR>1 && $4 < 5000000 {small=1} END {exit small}' ||
    fail 'The deployment and rollback need at least 5 GB free.'
printf 'Sampling ECS resources for ten minutes.\n'
install -d -m 0700 "$BACKUPS"
SNAPSHOT="$(mktemp -d "$BACKUPS/deploy.XXXXXXXX")"
for ((sample=0; sample<=10; sample++)); do
    awk '
        /^(MemAvailable|SwapTotal|SwapFree):/ { print }
        /^MemAvailable:/ && $2 < 850000 { low=1 }
        END { exit low }' /proc/meminfo >> "$SNAPSHOT/baseline.txt" ||
        fail "Low available memory. Review $SNAPSHOT/baseline.txt and keep the current site online."
    if (( sample < 10 )); then sleep 60; fi
done

if [[ ! -d "$HOME_DIR" ]]; then
    install -d -m 0755 "$HOME_DIR"
    touch "$HOME_DIR/.strgo-managed"
fi
install -d -m 0755 "$HOME_DIR/releases"
if [[ ! -d "$ETC" ]]; then
    install -d -o root -g strgo-image -m 0750 "$ETC"
    touch "$ETC/.strgo-managed"
fi
if [[ ! -d "$STATE" ]]; then
    install -d -m 0755 "$STATE"
    touch "$STATE/.strgo-managed"
fi
id strgo-comfyui >/dev/null 2>&1 || useradd --system --user-group --home-dir "$STATE/engine" --shell /usr/sbin/nologin strgo-comfyui
id strgo-comfyui-web >/dev/null 2>&1 || useradd --system --gid strgo-comfyui --home-dir "$STATE/gateway" --shell /usr/sbin/nologin strgo-comfyui-web
install -d -o strgo-comfyui -g strgo-comfyui -m 0750 "$STATE/engine" "$STATE/engine/input"
install -d -o strgo-comfyui -g strgo-comfyui -m 0700 "$STATE/engine/output" "$STATE/engine/temp" "$STATE/engine/user"
install -d -o strgo-comfyui-web -g strgo-comfyui -m 0700 "$STATE/gateway"
if [[ ! -s "$ETC/account.token" ]]; then
    python3.12 -c 'import secrets; print(secrets.token_urlsafe(32))' > "$ETC/account.token"
    chown root:strgo-image "$ETC/account.token"
    chmod 0640 "$ETC/account.token"
fi
if [[ ! -s "$ETC/engine.token" ]]; then
    python3.12 -c 'import secrets; print(secrets.token_urlsafe(32))' > "$ETC/engine.token"
fi
[[ -f "$ETC/providers.json" ]] || install -m 0600 "$DEPLOY/providers.example.json" "$ETC/providers.json"
cp -a "$ETC/." "$SNAPSHOT/credentials/"
umask 022
if [[ ! -f "$RELEASE/.ready" ]]; then
    if [[ -e "$RELEASE" ]]; then
        mv -- "$RELEASE" "$RELEASE.incomplete.$(date +%s)"
    fi
    install -d -m 0755 "$RELEASE"
    git clone --depth=1 --branch v0.18.5 https://github.com/Comfy-Org/ComfyUI.git "$RELEASE/engine"
    EXPECTED="$(awk 'NR==1 {print $3}' "$DEPLOY/lock-versions.txt")"
    [[ "$(git -C "$RELEASE/engine" rev-parse HEAD)" == "$EXPECTED" ]] || fail 'The ComfyUI tag differs from its pinned SHA.'
    git -C "$RELEASE/engine" apply "$DEPLOY/engine.patch"
    install -m 0644 "$DEPLOY/strgo_engine_guard.py" "$RELEASE/engine/strgo_engine_guard.py"
    cp -R "$ROOT/comfyui/strgo_api_only" "$RELEASE/engine/custom_nodes/"
    install -d -m 0755 "$RELEASE/gateway"
    cp -R "$ROOT/comfyui" "$RELEASE/gateway/"
    python3.12 -m venv "$RELEASE/venv"
    PIP=("$RELEASE/venv/bin/python" -m pip --disable-pip-version-check)
    LOCK="$DEPLOY/requirements-linux-x86_64-py312.lock"
    grep -E '^torch(audio|vision)?==' "$LOCK" > "$RELEASE/torch.lock"
    grep -vE '^torch(audio|vision)?==' "$LOCK" > "$RELEASE/python.lock"
    "${PIP[@]}" install --no-deps --only-binary=:all: --index-url https://download.pytorch.org/whl/cpu -r "$RELEASE/torch.lock"
    "${PIP[@]}" install --no-deps --only-binary=:all: --index-url https://pypi.org/simple -r "$RELEASE/python.lock"
    "${PIP[@]}" check
    (cd "$RELEASE/engine" && "$RELEASE/venv/bin/python" main.py --help > "$RELEASE/startup-flags.txt")
    for flag in --cpu --cache-none --disable-all-custom-nodes --whitelist-custom-nodes; do
        grep -Fq -- "$flag" "$RELEASE/startup-flags.txt" || fail "Unsupported engine flag: $flag"
    done
    touch "$RELEASE/.ready"
fi
umask 077
python_release comfyui.deploy.backup "$SNAPSHOT"
install -d -m 0700 "$SNAPSHOT/account"
for name in "${FILES[@]}"; do
    [[ ! -f "$ACCOUNT/$name" ]] || cp -a "$ACCOUNT/$name" "$SNAPSHOT/account/"
done
systemctl cat strgo-image.service > "$SNAPSHOT/strgo-image.service"
for unit in "${COMFY_UNITS[@]}"; do
    [[ ! -f "/etc/systemd/system/$unit" ]] || cp -a "/etc/systemd/system/$unit" "$SNAPSHOT/"
done
if managed_vhost; then cp -a "$AVAILABLE" "$SNAPSHOT/vhost"; fi
if [[ -L "$HOME_DIR/current" ]]; then readlink "$HOME_DIR/current" > "$SNAPSHOT/previous"; fi
if [[ -f "$HOME_DIR/account.sha256" ]]; then cp -a "$HOME_DIR/account.sha256" "$SNAPSHOT/"; fi
if [[ -f "$HOME_DIR/latest-backup" ]]; then cp -a "$HOME_DIR/latest-backup" "$SNAPSHOT/"; fi
(cd "$ROOT/image_service" && sha256sum "${FILES[@]}") > "$SNAPSHOT/installed.sha256"

restore_on_error() {
    local code=$?
    trap - ERR INT TERM
    echo "Activation failed. Restoring the previous deployment from $SNAPSHOT." >&2
    bash "$DEPLOY/rollback.sh" --already-locked "$SNAPSHOT" || echo 'Rollback requires operator attention.' >&2
    exit "$code"
}
trap restore_on_error ERR INT TERM
touch "$SNAPSHOT/activation"
for name in "${FILES[@]}"; do
    install -m 0644 "$ROOT/image_service/$name" "$ACCOUNT/.$name.comfy-new"
    mv -T "$ACCOUNT/.$name.comfy-new" "$ACCOUNT/$name"
done
systemctl restart strgo-image
for unit in "${COMFY_UNITS[@]}"; do
    install -m 0644 "$DEPLOY/$unit" "/etc/systemd/system/$unit"
done
release_link "$RELEASE"
systemctl daemon-reload
systemctl restart "${COMFY_UNITS[@]}"
healthy=false
for ((i=0; i<45; i++)); do
    if python_release comfyui.deploy.healthcheck >/dev/null 2>&1; then healthy=true; break; fi
    sleep 2
done
"$healthy"
for unit in strgo-image "${COMFY_UNITS[@]}"; do systemctl is-active --quiet "$unit"; done
awk '/^MemAvailable:/ { exit ($2 < 250000) }' /proc/meminfo
vhost_write https
nginx -t
systemctl reload nginx
python_release comfyui.deploy.healthcheck --public
systemctl enable "${COMFY_UNITS[@]}"
cp "$SNAPSHOT/installed.sha256" "$HOME_DIR/account.sha256"
printf '%s\n' "$SNAPSHOT" > "$HOME_DIR/latest-backup"
touch "$SNAPSHOT/complete"
trap - ERR INT TERM
printf 'ComfyUI deployed. Rollback snapshot %s\n' "$SNAPSHOT"
systemctl show "${COMFY_UNITS[@]}" --property=MemoryCurrent,MemoryPeak
