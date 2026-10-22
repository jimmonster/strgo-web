#!/usr/bin/env python3
"""Add the terminal include only to strgo.com's HTTPS server blocks."""
import argparse
import re
from pathlib import Path

INCLUDE = '    include /etc/nginx/snippets/strgo-terminal.conf;\n'


def closing_brace(text, start):
    depth, quote, comment, escaped = 0, None, False, False
    for index in range(start, len(text)):
        char = text[index]
        if comment:
            if char == '\n': comment = False
            continue
        if escaped:
            escaped = False
            continue
        if char == '\\':
            escaped = True
            continue
        if quote:
            if char == quote: quote = None
            continue
        if char in "\"'":
            quote = char
        elif char == '#':
            comment = True
        elif char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0: return index
    raise ValueError('Nginx 配置括号未闭合')


def integrate(text):
    changes = []
    found = False
    for match in re.finditer(r'(?m)^\s*server\s*\{', text):
        start = text.index('{', match.start(), match.end())
        end = closing_brace(text, start)
        block = text[start + 1:end]
        names = re.findall(r'(?m)^\s*server_name\s+([^;]+);', block)
        listens = re.findall(r'(?m)^\s*listen\s+([^;]+);', block)
        if not any('strgo.com' in n.split() for n in names): continue
        if not any(re.search(r'(?:^|:)443(?:\s|$)', line) and 'ssl' in line.split() for line in listens): continue
        found = True
        if re.search(r'(?m)^\s*include\s+/etc/nginx/snippets/strgo-terminal\.conf\s*;', block): continue
        if re.search(r'(?m)^\s*location\s+(?:=\s*|\^~\s*)?/terminal(?:[/\s{])', block):
            raise ValueError('已有 /terminal location，请先检查路由归属')
        changes.append(end)
    if not found: raise ValueError('未找到 strgo.com 的 HTTPS server 块；请先为现有主站启用 HTTPS')
    for end in reversed(changes): text = text[:end] + INCLUDE + text[end:]
    return text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('config', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = integrate(args.config.read_text())
    if not args.check: print(result, end='')


if __name__ == '__main__': main()

