#!/usr/bin/env bash
# Publish the administrator host against the existing STRGO release and API.
set -Eeuo pipefail
umask 022

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="${WORKFLOW_DOMAIN:-workflow.strgo.com}"
SITE_ROOT="${STRGO_SITE_ROOT:-/var/www/strgo}"
API_PORT="${IMAGE_PORT:-8092}"
CONFIG=/etc/nginx/sites-available/workflow.conf
ENABLED=/etc/nginx/sites-enabled/workflow.conf
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
BACKUP=''
CHANGED=0

fail() { printf '%s\n' "$*" >&2; exit 1; }
rollback() {
    local code=$?
    trap - ERR
    if [[ "$CHANGED" == 1 ]]; then
        if [[ -f "$BACKUP/workflow.conf" ]]; then
            install -m 0644 "$BACKUP/workflow.conf" "$CONFIG"
        else
            rm -f -- "$CONFIG"
        fi
        rm -f -- "$ENABLED"
        if [[ -f "$BACKUP/enabled-target" ]]; then
            ln -s -- "$(cat "$BACKUP/enabled-target")" "$ENABLED"
        fi
        if nginx -t; then systemctl reload nginx; fi
    fi
    printf 'Workflow deployment failed; previous Nginx configuration restored. Backup: %s\n' "$BACKUP" >&2
    exit "$code"
}
trap rollback ERR

[[ "$EUID" == 0 ]] || fail 'Run as root on the production server.'
for command in python3 nginx certbot curl; do
    command -v "$command" >/dev/null || fail "Required command missing: $command"
done
[[ -d /run/systemd/system ]] || fail 'A systemd server is required.'
for file in index.html app.js styles.css reference-image.js; do
    [[ -s "$SITE_ROOT/current/local-studio/$file" ]] || fail "Publish the main site first; missing local-studio/$file"
done
if [[ -e "$ENABLED" || -L "$ENABLED" ]]; then
    [[ -L "$ENABLED" && "$(readlink -f -- "$ENABLED")" == "$CONFIG" ]] || fail "$ENABLED belongs to another configuration."
fi
nginx -t
curl --noproxy '*' --fail --silent --show-error --max-time 10 \
    "http://127.0.0.1:$API_PORT/api/image/local-studio/session" \
    | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data.get("user") is None and "csrf" in data'

BACKUP="$(mktemp -d "$SITE_ROOT/.workflow-backup.XXXXXX")"
chmod 0700 "$BACKUP"
if [[ -f "$CONFIG" ]]; then cp -a -- "$CONFIG" "$BACKUP/workflow.conf"; fi
if [[ -L "$ENABLED" ]]; then readlink -- "$ENABLED" > "$BACKUP/enabled-target"; fi
python3 "$PROJECT_DIR/scripts/configure-workflow.py" --domain "$DOMAIN" \
    --site-root "$SITE_ROOT" --api-port "$API_PORT" --cert-dir "$CERT_DIR" --output "$BACKUP/generated"

activate() {
    CHANGED=1
    install -m 0644 "$1" "$CONFIG"
    ln -sfn -- "$CONFIG" "$ENABLED"
    nginx -t
    systemctl reload nginx
}

if [[ ! -s "$CERT_DIR/fullchain.pem" || ! -s "$CERT_DIR/privkey.pem" ]]; then
    activate "$BACKUP/generated/workflow-http.conf"
    # Reuse the server's registered ACME account; no new account or contact.
    certbot certonly --webroot --webroot-path "$SITE_ROOT/current/local-studio" \
        --domain "$DOMAIN" --cert-name "$DOMAIN" --non-interactive
fi
activate "$BACKUP/generated/workflow.conf"
source "$PROJECT_DIR/lib/verify-site.sh"
for file in index.html app.js styles.css reference-image.js; do
    verify_site "$SITE_ROOT/current/local-studio/$file" "$BACKUP/served-$file" \
        --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/${file/index.html/}"
done
curl --noproxy '*' --fail --silent --show-error --max-time 10 \
    --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/image/local-studio/session" \
    | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data.get("user") is None and "csrf" in data'
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 "$PROJECT_DIR/image_service/deploy/workflow-renew-hook.sh" \
    /etc/letsencrypt/renewal-hooks/deploy/strgo-workflow-reload-nginx
systemctl enable --now certbot.timer
CHANGED=0
printf 'Workflow deployed and verified: https://%s/\nNginx backup: %s\n' "$DOMAIN" "$BACKUP"
