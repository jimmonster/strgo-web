#!/bin/sh
set -e
nginx -t
systemctl reload nginx
