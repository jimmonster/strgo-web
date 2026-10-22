#!/usr/bin/env python3
"""Verify authentication, origin checks and the web-to-broker protocol after install."""
import argparse
import base64
import hashlib
import http.client
import json
import os
import socket
import struct
import getpass
import sys
import time
import ipaddress
from pathlib import Path
from urllib.parse import urlsplit


def request(method, path, origin, token=None, cookie=None):
    connection = http.client.HTTPConnection('127.0.0.1', 3081, timeout=5)
    headers = {'Origin': origin}
    if cookie: headers['Cookie'] = cookie
    data = None
    if token is not None:
        data = json.dumps({'token': token})
        headers['Content-Type'] = 'application/json'
    if method == 'POST' and data is None:
        data = '{}'
        headers['Content-Type'] = 'application/json'
    connection.request(method, '/terminal' + path, data, headers)
    response = connection.getresponse()
    result = response.status, {key.lower(): value for key, value in response.getheaders()}, response.read()
    connection.close()
    return result


def exact(stream, count):
    result = bytearray()
    while len(result) < count:
        packet = stream.recv(count - len(result))
        if not packet: raise RuntimeError('WebSocket 意外关闭')
        result.extend(packet)
    return bytes(result)


def frame(stream, payload, opcode=1):
    if isinstance(payload, str): payload = payload.encode()
    mask = os.urandom(4)
    length = len(payload)
    prefix = bytes([0x80 | opcode, 0x80 | length]) if length < 126 else bytes([0x80 | opcode, 0x80 | 126]) + struct.pack('!H', length)
    stream.sendall(prefix + mask + bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload)))


def message(stream):
    while True:
        header = exact(stream, 2)
        opcode, length = header[0] & 15, header[1] & 127
        if length == 126: length = struct.unpack('!H', exact(stream, 2))[0]
        if length == 127: length = struct.unpack('!Q', exact(stream, 8))[0]
        if length > 32768: raise RuntimeError('WebSocket 帧超过预期限制')
        payload = exact(stream, length)
        if opcode == 9:
            frame(stream, payload, 10)
            continue
        if opcode == 8:
            return {'type': 'closed'}
        if opcode != 1: raise RuntimeError(f'未收到预期的文本消息：opcode={opcode}')
        return json.loads(payload)


def websocket(cookie, origin, expected_status=101):
    stream = socket.create_connection(('127.0.0.1', 3081), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    handshake = f'GET /terminal/ws HTTP/1.1\r\nHost: strgo.com\r\nOrigin: {origin}\r\nCookie: {cookie}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'
    stream.sendall(handshake.encode())
    header = bytearray()
    while not header.endswith(b'\r\n\r\n'):
        header.extend(exact(stream, 1))
        if len(header) > 8192: raise RuntimeError('握手响应过大')
    expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
    assert f' {expected_status} '.encode() in header.split(b'\r\n')[0], 'WebSocket 握手状态不符合预期'
    if expected_status != 101:
        stream.close()
        return None
    assert expected.lower() in header.lower(), 'WebSocket accept 校验失败'
    return stream


def account_request(address, method, path, origin, body=None, cookie=None, csrf=None):
    connection = http.client.HTTPConnection(address.hostname, address.port or 8092, timeout=8)
    headers = {'Origin': origin}
    if cookie: headers['Cookie'] = cookie
    if csrf: headers['X-CSRF-Token'] = csrf
    if body is not None: headers['Content-Type'] = 'application/json'
    connection.request(method, '/api/image' + path, json.dumps(body) if body is not None else None, headers)
    response = connection.getresponse()
    response_headers = response.getheaders()
    extra = {key.lower(): value for key, value in response_headers}
    shared = next((value for key, value in response_headers if key.lower() == 'set-cookie' and value.startswith('strgo_account_session=')), None)
    if shared is not None: extra['set-cookie'] = shared
    result = response.status, extra, json.loads(response.read())
    connection.close()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env', type=Path, required=True)
    parser.add_argument('--account', help='可选：使用已有测试账号执行真实登录、工作区和撤销测试')
    parser.add_argument('--password-stdin', action='store_true', help='从标准输入读取密码，不接受命令行密码')
    args = parser.parse_args()
    env = dict(line.split('=', 1) for line in args.env.read_text().splitlines() if line and not line.startswith('#'))
    origin = env['TERMINAL_PUBLIC_ORIGIN']
    address = urlsplit('http://' + env.get('TERMINAL_ACCOUNT_ADDRESS', '127.0.0.1:8092'))
    assert ipaddress.ip_address(address.hostname).is_loopback, '账号服务必须是固定回环地址'
    assert request('GET', '/api/health', origin)[0] == 200
    assert request('GET', '/api/session', origin)[0] == 401
    assert request('POST', '/api/login', origin, 'old-token-is-disabled')[0] == 404
    assert account_request(address, 'GET', '/terminal-session', origin)[0] == 401, '账号服务未升级或未启动'
    for path in ('/', '/session', '/workspace.js', '/workspace.css', '/app.js', '/style.css'):
        assert request('GET', path, origin)[0] == 200, '终端资源缺失：' + path
    websocket('', origin, 401)
    websocket('', 'https://untrusted.invalid', 403)
    if not args.account:
        print('基础冒烟通过：页面资源、共享账号接口、匿名拒绝、跨源拒绝及旧口令停用。未验证真实账号、工作区和退出撤销；使用 --account 执行。')
        return
    password = sys.stdin.readline().rstrip('\r\n') if args.password_stdin else getpass.getpass('测试账号密码（不回显）：')
    status, headers, result = account_request(address, 'POST', '/login', origin, {'username': args.account, 'password': password})
    password = None
    assert status == 200, '登录失败'
    cookie = headers['set-cookie'].split(';')[0]
    assert cookie.startswith('strgo_account_session='), '登录未返回共享账号 Cookie'
    assert 'HttpOnly' in headers['set-cookie'] and 'SameSite=Strict' in headers['set-cookie']
    assert request('GET', '/api/session', origin, cookie=cookie)[0] == 200
    websocket(cookie, 'https://untrusted.invalid', 403)
    with websocket(cookie, origin) as stream:
        frame(stream, json.dumps({'type': 'connect', 'host': '127.0.0.1', 'port': 22, 'username': 'root', 'cols': 80, 'rows': 24}))
        reply = message(stream)
        assert reply['type'] == 'error' and '禁止访问' in reply['message'], '沙箱代理未拒绝宿主机回环地址'
    with websocket(cookie, origin) as stream:
        frame(stream, json.dumps({'type': 'workspace', 'cols': 80, 'rows': 24}))
        reply = message(stream)
        assert reply['type'] == 'ready', '工作区未就绪'
        frame(stream, json.dumps({'type': 'input', 'data': "printf 'STRGO_'; printf 'WORKSPACE_OK\\n'\r"}))
        output = ''
        deadline = time.monotonic() + 20
        while 'STRGO_WORKSPACE_OK' not in output and time.monotonic() < deadline:
            reply = message(stream)
            assert reply['type'] not in ('error', 'exit', 'closed'), '工作区提前结束'
            if reply['type'] == 'output': output += base64.b64decode(reply['data']).decode('utf-8', errors='replace')
        assert 'STRGO_WORKSPACE_OK' in output, '工作区命令没有产生预期输出'
        assert account_request(address, 'POST', '/logout', origin, {}, cookie, result['csrf'])[0] == 200
        deadline = time.monotonic() + 30
        stream.settimeout(30)
        revoked = False
        while time.monotonic() < deadline:
            reply = message(stream)
            if reply['type'] in ('closed', 'error'):
                revoked = True
                break
        assert revoked, '账号退出后连接未及时结束'
    assert request('GET', '/api/session', origin, cookie=cookie)[0] == 401
    print('真实账号冒烟通过：共享登录、来源限制、SSH 地址限制、工作区命令与退出撤销。')


if __name__ == '__main__': main()

