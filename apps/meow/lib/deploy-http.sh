#!/usr/bin/env bash
# All requests use the existing local HTTPS host and validate its certificate.
meow_request() {
    curl --disable --silent --show-error --noproxy '*' --connect-timeout 2 --max-time 5 \
        --resolve "$DOMAIN:443:127.0.0.1" "$@"
}

meow_wait_for_release() {
    local expected="$1" fingerprint="$2" directory="$3" attempt status
    for ((attempt=1; attempt<=40; attempt++)); do
        status='000'
        if status="$(meow_request "https://$DOMAIN/meow/" -D "$directory/ready.headers" \
            -o "$directory/ready.html" -w '%{http_code}' 2> "$directory/ready.error")" \
            && [[ "$status" == 200 ]] \
            && cmp -s -- "$expected" "$directory/ready.html" \
            && grep -qi -- "^X-Meow-Release: $fingerprint" "$directory/ready.headers"; then
            return 0
        fi
        sleep 0.25
    done
    printf '新版本尚未就绪：最后 HTTP %s；诊断位于 %s/ready.*\n' "$status" "$directory" >&2
    return 1
}

meow_verify_release() {
    local release="$1" directory="$2" manifest="$3" checksum relative address actual status redirect
    while IFS=$'\t' read -r checksum relative; do
        address="$relative"
        if [[ "$address" == *index.html ]]; then address="${address%index.html}"; fi
        printf '校验 /meow/%s\n' "$address"
        status="$(meow_request "https://$DOMAIN/meow/$address" -D "$directory/last.headers" \
            -o "$directory/last.body" -w '%{http_code}')" || return 1
        [[ "$status" == 200 ]] || return 1
        actual="$(sha256sum "$directory/last.body")"
        [[ "${actual%% *}" == "$checksum" ]] || return 1
        case "$relative" in
            *.js) grep -Eqi '^Content-Type: (application|text)/javascript' "$directory/last.headers" || return 1 ;;
            *.css) grep -qi '^Content-Type: text/css' "$directory/last.headers" || return 1 ;;
            *.html) grep -qi '^Content-Type: text/html' "$directory/last.headers" || return 1 ;;
        esac
    done < <(node -e 'for (const f of require(process.argv[1]).files) if (f.path!=="404.html") console.log(f.sha256+"\t"+f.path)' "$manifest")
    status="$(meow_request "https://$DOMAIN/meow/__deployment-missing__/" -o "$directory/404.html" -w '%{http_code}')" || return 1
    [[ "$status" == 404 ]] && cmp -s -- "$release/meow/404.html" "$directory/404.html" || return 1
    redirect="$(meow_request "https://$DOMAIN/meow?probe=1" -o /dev/null -w '%{http_code} %{redirect_url}')" || return 1
    [[ "$redirect" == '308 https://strgo.com/meow/?probe=1' ]]
}
