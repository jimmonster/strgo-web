#!/usr/bin/env bash
# Nginx reload returns before new workers are necessarily ready. Keep checking
# the actual body, so a successful HTTP response from the old site cannot pass.
verify_site() {
    local expected="$1" served="$2"
    shift 2
    local attempt
    for ((attempt = 1; attempt <= 10; attempt++)); do
        if curl --noproxy '*' --fail --silent --show-error \
            --connect-timeout 2 --max-time 3 "$@" \
            -o "$served" 2>"$served.curl-error" \
            && cmp -s -- "$expected" "$served"; then
            return 0
        fi
        if ((attempt < 10)); then
            printf '等待网站配置生效（%s/10）……\n' "$attempt"
            sleep 1
        fi
    done
    printf '网站验证失败：多次请求仍未返回当前主页。\n' >&2
    if [[ -s "$served.curl-error" ]]; then cat -- "$served.curl-error" >&2; fi
    if [[ -s "$served" ]]; then
        printf '最后一次保存的响应内容（前 10 行）：\n' >&2
        head -n 10 -- "$served" >&2
    fi
    return 1
}

verify_dream_routes() {
    local directory="$1" origin="${!#}"
    shift
    local options=("${@:1:$#-1}") status redirect
    status="$(curl --noproxy '*' --silent --show-error --connect-timeout 2 --max-time 3 "${options[@]}" -o "$directory/dream-redirect" -w '%{http_code}' -D "$directory/dream-headers" "$origin/dreams?test=route")" || return 1
    [[ "$status" == 308 ]] || { printf 'DREAMS redirect returned %s, expected 308.\n' "$status" >&2; return 1; }
    redirect="$(sed -n 's/^[Ll]ocation: //p' "$directory/dream-headers" | tr -d '\r')"
    [[ "$redirect" == */dreams/\?test=route ]] || { printf 'DREAMS redirect lost its route or query.\n' >&2; return 1; }
    status="$(curl --noproxy '*' --silent --show-error --connect-timeout 2 --max-time 3 "${options[@]}" -o "$directory/dream-missing" -w '%{http_code}' "$origin/dreams/99/")" || return 1
    [[ "$status" == 404 ]] && grep -q 'href="/dreams/"' "$directory/dream-missing" || { printf 'DREAMS missing page did not return 404 with garden link.\n' >&2; return 1; }
}
