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
from pathlib import Path


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
        if opcode != 1: raise RuntimeError(f'未收到预期的文本消息：opcode={opcode}')
        return json.loads(payload)


def websocket(cookie, origin):
    stream = socket.create_connection(('127.0.0.1', 3081), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    handshake = f'GET /terminal/ws HTTP/1.1\r\nHost: strgo.com\r\nOrigin: {origin}\r\nCookie: {cookie}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'
    stream.sendall(handshake.encode())
    header = bytearray()
    while not header.endswith(b'\r\n\r\n'):
        header.extend(exact(stream, 1))
        if len(header) > 8192: raise RuntimeError('握手响应过大')
    expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
    assert b' 101 ' in header.split(b'\r\n')[0], 'WebSocket 握手失败'
    assert expected.lower() in header.lower(), 'WebSocket accept 校验失败'
    return stream


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env', type=Path, required=True)
    args = parser.parse_args()
    env = dict(line.split('=', 1) for line in args.env.read_text().splitlines() if line and not line.startswith('#'))
    origin, token = env['TERMINAL_PUBLIC_ORIGIN'], env['TERMINAL_ACCESS_TOKEN']
    assert request('GET', '/api/health', origin)[0] == 200
    assert request('GET', '/api/session', origin)[0] == 401
    assert request('POST', '/api/login', 'https://untrusted.invalid', token)[0] == 403
    assert request('POST', '/api/login', origin, 'wrong-access-token')[0] == 401
    status, headers, _ = request('POST', '/api/login', origin, token)
    assert status == 200, '登录失败'
    cookie = headers['set-cookie'].split(';')[0]
    assert 'HttpOnly' in headers['set-cookie'] and 'SameSite=Strict' in headers['set-cookie']
    assert request('GET', '/api/session', origin, cookie=cookie)[0] == 200
    with websocket(cookie, origin) as stream:
        frame(stream, json.dumps({'type': 'connect', 'host': '127.0.0.1', 'port': 22, 'username': 'root', 'cols': 80, 'rows': 24}))
        reply = message(stream)
        assert reply['type'] == 'error' and '禁止访问' in reply['message'], '沙箱代理未拒绝宿主机回环地址'
    assert request('POST', '/api/logout', origin, cookie=cookie)[0] == 200
    assert request('GET', '/api/session', origin, cookie=cookie)[0] == 401
    print('服务冒烟检查通过：登录、来源限制、WebSocket、沙箱代理地址限制、退出失效。')


if __name__ == '__main__': main()

