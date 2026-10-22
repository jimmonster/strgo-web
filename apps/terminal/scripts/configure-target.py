#!/usr/bin/env python3
"""Generate one administrator-managed SSH endpoint exception without loosening other rules."""
import argparse
import ipaddress
import os
import re
import socket
from pathlib import Path

KEY = 'TERMINAL_ALLOWED_TARGETS'


def canonical(value):
    address = ipaddress.ip_address(value)
    return address.ipv4_mapped if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped else address


def eligible(address):
    address = canonical(address)
    if address.is_loopback or address.is_unspecified or address.is_multicast or address.is_link_local:
        return False
    if address.version == 4:
        return not any(address in ipaddress.ip_network(network) for network in (
            '0.0.0.0/8', '224.0.0.0/3', '169.254.0.0/16', '100.64.0.0/10',
            '192.0.0.0/24', '192.0.2.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
        ))
    if address in ipaddress.ip_network('2001:db8::/32'):
        return False
    return address in ipaddress.ip_network('2000::/3') or address in ipaddress.ip_network('fc00::/7')


def endpoint(address, port):
    address = canonical(address)
    return f'[{address}]:{port}' if address.version == 6 else f'{address}:{port}'


def parse_endpoint(value):
    if value.startswith('['):
        match = re.fullmatch(r'\[([^\]]+)\]:(\d+)', value)
    else:
        match = re.fullmatch(r'([^:]+):(\d+)', value)
    if not match:
        raise ValueError('已有放行配置格式无效，需要 IP:port 或 [IPv6]:port')
    address, port = canonical(match[1]), int(match[2])
    if not 1 <= port <= 65535 or not eligible(address):
        raise ValueError('已有放行配置包含无效端口或不可放行的特殊地址')
    return endpoint(address, port)


def resolve(host):
    try:
        return [canonical(host)]
    except ValueError:
        if len(host) > 253 or not all(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label) for label in host.split('.')):
            raise ValueError('目标地址必须是 IP 或域名，不含协议、路径、空格或 SSH 选项')
    records = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return sorted({canonical(record[4][0]) for record in records}, key=lambda ip: (ip.version, int(ip)))


def render(source, addresses, port):
    if not 1 <= port <= 65535:
        raise ValueError('SSH 端口必须为 1–65535')
    allowed = {endpoint(ip, port) for ip in addresses if eligible(ip)}
    if not allowed:
        raise ValueError('此目标没有可放行的地址；回环、元数据、链路本地和保留地址不能放行')
    lines = []
    existing = set()
    for line in source.splitlines():
        if line.startswith(KEY + '='):
            value = line.split('=', 1)[1].strip().strip('"').strip("'")
            existing.update(parse_endpoint(part.strip()) for part in value.split(',') if part.strip())
        else:
            lines.append(line)
    lines.append(KEY + '=' + ','.join(sorted(existing | allowed)))
    return '\n'.join(lines) + '\n', sorted(allowed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--host', required=True)
    parser.add_argument('--port', type=int, default=22)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result, added = render(args.config.read_text(), resolve(args.host), args.port)
    if args.output:
        with args.output.open('w') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(result)
    for value in added:
        print('SSH 放行目标：' + value)
    print('其余地址规则保留；特殊系统地址仍禁止访问。')


if __name__ == '__main__':
    main()
