#!/usr/bin/env python3
"""Upgrade the existing managed STRGO HTTP server, preserving its page configuration."""
import argparse
import re
from pathlib import Path

from importlib.util import module_from_spec, spec_from_file_location

spec = spec_from_file_location('terminal_nginx', Path(__file__).with_name('integrate-nginx.py'))
nginx = module_from_spec(spec)
spec.loader.exec_module(nginx)

MARKER = '# Managed by strgo-homepage/deploy.sh'
CERT_DIR = '/etc/letsencrypt/live/strgo.com'


def server_blocks(text):
    for match in re.finditer(r'(?m)^[ \t]*server[ \t]*\{', text):
        start = text.index('{', match.start(), match.end())
        end = nginx.closing_brace(text, start)
        yield match.start(), end + 1, text[start + 1:end]


def target(text):
    if not text.startswith(MARKER + '\n'):
        raise ValueError('主站配置没有项目管理标记，停止自动修改')
    matches = []
    for start, end, body in server_blocks(text):
        names = re.findall(r'(?m)^[ \t]*server_name[ \t]+([^;]+);', body)
        if not any('strgo.com' in line.split() for line in names):
            continue
        listens = re.findall(r'(?m)^[ \t]*listen[ \t]+([^;]+);', body)
        if any(re.search(r'(?:^|:)443(?:\s|$)', line) and 'ssl' in line.split() for line in listens):
            return None
        matches.append((start, end, body))
    if len(matches) != 1:
        raise ValueError('需要唯一的 strgo.com HTTP server 块')
    start, end, body = matches[0]
    listens = re.findall(r'(?m)^[ \t]*listen[ \t]+([^;]+);', body)
    if listens != ['80']:
        raise ValueError('HTTP listener 不是预期的 listen 80，请检查现有配置')
    roots = re.findall(r'(?m)^[ \t]*root[ \t]+([^;]+);', body)
    if len(roots) != 1 or not re.fullmatch(r'/[A-Za-z0-9_./-]+', roots[0]):
        raise ValueError('未找到唯一且有效的现有站点 root')
    if not re.search(r'(?m)^[ \t]*location[ \t]+/[ \t]*\{[ \t]*try_files\b', body):
        raise ValueError('主页 location 与预期配置不同，停止自动修改')
    if re.search(r'(?m)^[ \t]*ssl_[a-z_]+\b', body):
        raise ValueError('HTTP 块包含既有 TLS 指令，请手动检查')
    return start, end, body, roots[0]


def webroot(text):
    info = target(text)
    if info is None:
        raise ValueError('HTTPS 已经配置，无需转换')
    return info[3]


def enable(text):
    info = target(text)
    if info is None:
        return text
    start, end, body, root = info
    body = re.sub(r'(?m)^([ \t]*)listen[ \t]+80[ \t]*;', r'\1listen 443 ssl;', body)
    body = re.sub(r'(?m)^([ \t]*)server_name[ \t]+[^;]+;', r'\1server_name strgo.com;', body)
    certificates = f'''    ssl_certificate {CERT_DIR}/fullchain.pem;
    ssl_certificate_key {CERT_DIR}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:STRGO_SSL:10m;
    ssl_session_timeout 1d;
'''
    redirect = f'''server {{
    listen 80;
    server_name strgo.com www.strgo.com;
    root {root};
    location ^~ /.well-known/acme-challenge/ {{ default_type text/plain; try_files $uri =404; }}
    location / {{ return 301 https://strgo.com$request_uri; }}
}}
'''
    upgraded = redirect + 'server {' + body + certificates + '}\n'
    return text[:start] + upgraded + text[end:]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('config', type=Path)
    parser.add_argument('--webroot', action='store_true')
    args = parser.parse_args()
    text = args.config.read_text()
    print(webroot(text) if args.webroot else enable(text), end='\n' if args.webroot else '')


if __name__ == '__main__':
    main()

