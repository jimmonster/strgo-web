#!/usr/bin/env bash
set -Eeuo pipefail
# This label belongs exclusively to disposable SSH sessions, never the homepage.
mapfile -t sandbox_ids < <(/usr/bin/docker ps --all --quiet --filter label=com.strgo.terminal.sandbox=1)
if ((${#sandbox_ids[@]})); then
    /usr/bin/docker rm --force "${sandbox_ids[@]}" >/dev/null
fi

