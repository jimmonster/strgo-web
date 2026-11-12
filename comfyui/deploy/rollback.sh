#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
HOME_DIR=/opt/strgo-comfyui
ACCOUNT=/opt/strgo-image/image_service
AVAILABLE=/etc/nginx/sites-available/comfyui.strgo.com.conf
ENABLED=/etc/nginx/sites-enabled/comfyui.strgo.com.conf
UNITS=(strgo-comfyui.service strgo-comfyui-ws.service)
[[ "$EUID" == 0 && -d /run/systemd/system ]] || exit 1
automatic=false
if [[ "${1:-}" == --already-locked ]]; then
    automatic=true
    shift
else
    exec 9>/run/lock/strgo-comfyui.lock
    flock -n 9 || exit 1
fi
snapshot="${1:-$(cat "$HOME_DIR/latest-backup")}"
[[ "$snapshot" =~ ^/var/backups/strgo-comfyui/deploy\.[A-Za-z0-9]+$ && -f "$snapshot/activation" && ! -L "$snapshot" ]] || exit 1
if ! "$automatic"; then
    [[ "$snapshot" == "$(cat "$HOME_DIR/latest-backup")" && -f "$snapshot/complete" ]] || exit 1
    (cd "$ACCOUNT" && sha256sum -c "$snapshot/installed.sha256" --quiet) ||
        { echo 'Live account code changed. Reconcile before rollback.' >&2; exit 1; }
fi
if [[ -e "$AVAILABLE" || -L "$AVAILABLE" || -e "$ENABLED" || -L "$ENABLED" ]]; then
    [[ ! -L "$AVAILABLE" && -f "$AVAILABLE" && "$(head -n 1 "$AVAILABLE")" == '# Managed by STRGO ComfyUI API-only' ]] || exit 1
    [[ ! -e "$ENABLED" || ( -L "$ENABLED" && "$(readlink "$ENABLED")" == "$AVAILABLE" ) ]] || exit 1
fi
if [[ -f "$snapshot/vhost" ]]; then
    install -m 0644 "$snapshot/vhost" "$AVAILABLE"
    [[ -L "$ENABLED" ]] || ln -s "$AVAILABLE" "$ENABLED"
else
    rm -f -- "$ENABLED" "$AVAILABLE"
fi
nginx -t
systemctl reload nginx
systemctl stop "${UNITS[@]}" >/dev/null 2>&1 || true
for unit in "${UNITS[@]}"; do
    if [[ -f "$snapshot/$unit" ]]; then
        install -m 0644 "$snapshot/$unit" "/etc/systemd/system/$unit"
    elif [[ -f "/etc/systemd/system/$unit" ]]; then
        systemctl disable "$unit" >/dev/null
        rm -- "/etc/systemd/system/$unit"
    fi
done
if [[ -f "$snapshot/previous" ]]; then
    previous="$(cat "$snapshot/previous")"
    [[ "$previous" =~ ^/opt/strgo-comfyui/releases/[a-f0-9]{40}$ && -f "$previous/.ready" ]] || exit 1
    ln -sfn "$previous" "$HOME_DIR/current"
else
    [[ ! -L "$HOME_DIR/current" ]] || rm -- "$HOME_DIR/current"
fi
for name in app.py store.py admin.py comfy_auth.py; do
    if [[ -f "$snapshot/account/$name" ]]; then
        install -m 0644 "$snapshot/account/$name" "$ACCOUNT/.$name.comfy-old"
        mv -T "$ACCOUNT/.$name.comfy-old" "$ACCOUNT/$name"
    elif [[ "$name" == comfy_auth.py ]]; then
        rm -f -- "$ACCOUNT/$name"
    fi
done
systemctl daemon-reload
systemctl restart strgo-image
if [[ -f "$snapshot/previous" ]]; then
    systemctl enable --now "${UNITS[@]}"
fi
for name in account.sha256 latest-backup; do
    if [[ -f "$snapshot/$name" ]]; then cp "$snapshot/$name" "$HOME_DIR/$name"; else rm -f "$HOME_DIR/$name"; fi
done
printf 'Rolled back ComfyUI from %s. Persistent data and backups are retained.\n' "$snapshot"
