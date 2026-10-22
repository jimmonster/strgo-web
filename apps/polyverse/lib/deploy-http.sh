#!/usr/bin/env bash
# Shared HTTPS verification. These functions do not modify Nginx or releases.

polyverse_local_request() {
    curl --silent --show-error --noproxy '*' --connect-timeout 2 --max-time 5 \
        --resolve "$DOMAIN:443:127.0.0.1" "$@"
}

polyverse_fetch() {
    local url="$1" code
    shift
    printf '校验访问：%s\n' "$url"
    if polyverse_local_request --fail "$url" "$@"; then
        return 0
    else
        code="$?"
        printf '访问校验失败：%s（curl 退出码 %s）\n' "$url" "$code" >&2
        return "$code"
    fi
}

polyverse_wait_for_release() {
    local expected_file="$1" expected_hash="$2" url="$3" diagnostics="$4"
    local timeout="${5:-15}" interval="${6:-0.25}"
    local deadline=$((SECONDS + timeout)) attempt=0 status code content_ok policy_ok
    mkdir -p -- "$diagnostics"
    : > "$diagnostics/readiness.log"
    printf '等待 Nginx 新配置就绪：%s\n' "$url"
    while :; do
        attempt=$((attempt + 1))
        code=0
        content_ok=no
        policy_ok=no
        if status="$(polyverse_local_request --max-time 2 "$url" \
            -D "$diagnostics/readiness.headers" -o "$diagnostics/readiness.body" \
            -w '%{http_code}' 2> "$diagnostics/readiness.error")"; then
            if [[ "$status" == 200 ]]; then
                if cmp -s -- "$expected_file" "$diagnostics/readiness.body"; then content_ok=yes; fi
                if grep -F -- "'$expected_hash'" "$diagnostics/readiness.headers" >/dev/null; then policy_ok=yes; fi
            fi
        else
            code="$?"
        fi
        printf 'attempt=%s url=%s http=%s curl=%s content=%s csp=%s\n' \
            "$attempt" "$url" "${status:-000}" "$code" "$content_ok" "$policy_ok" \
            >> "$diagnostics/readiness.log"
        if [[ "$code" == 0 && "$status" == 200 && "$content_ok" == yes && "$policy_ok" == yes ]]; then
            printf '新配置已就绪：第 %s 次请求，HTTP 200，页面内容及 CSP 一致。\n' "$attempt"
            return 0
        fi
        if (( SECONDS >= deadline )); then break; fi
        sleep "$interval"
    done
    printf '新配置未就绪：%s，最后 HTTP=%s，curl=%s，内容匹配=%s，CSP 匹配=%s。\n' \
        "$url" "${status:-000}" "$code" "$content_ok" "$policy_ok" >&2
    printf '诊断文件：%s/readiness.{log,headers,body,error}\n' "$diagnostics" >&2
    if [[ -s "$diagnostics/readiness.error" ]]; then cat "$diagnostics/readiness.error" >&2; fi
    return 1
}
