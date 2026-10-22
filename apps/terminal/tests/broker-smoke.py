#!/usr/bin/env python3
"""Exercise the live broker's PTY/Docker path, including its systemd context.

Requires an administrator on the terminal host; uses a disposable account ID.
Does not read or modify browser sessions, account records, or user workspaces.
"""
import argparse
import base64
import json
from pathlib import Path
import socket
import struct
import subprocess
import time
import uuid

FRAME_LIMIT = 32 * 1024


def exact(stream, count):
    result = bytearray()
    while len(result) < count:
        data = stream.recv(count - len(result))
        if not data:
            raise RuntimeError('沙箱代理在验证完成前关闭连接。')
        result.extend(data)
    return bytes(result)


def receive(stream):
    length = struct.unpack('!I', exact(stream, 4))[0]
    if not 0 < length <= FRAME_LIMIT:
        raise RuntimeError('沙箱代理消息长度无效。')
    packet = json.loads(exact(stream, length))
    if packet.get('type') == 'error':
        raise RuntimeError('沙箱代理拒绝探针：' + str(packet.get('message', '未知错误')))
    return packet


def send(stream, packet):
    data = json.dumps(packet).encode()
    if len(data) > FRAME_LIMIT:
        raise RuntimeError('探针消息过长。')
    stream.sendall(struct.pack('!I', len(data)) + data)


def cleanup(volume):
    # Only containers mounting this randomly generated probe volume are removed.
    listed = subprocess.run(['/usr/bin/docker', 'ps', '--all', '--quiet', '--filter', 'volume=' + volume], capture_output=True, text=True, timeout=10)
    listed.check_returncode()
    containers = listed.stdout.split()
    if containers:
        subprocess.run(['/usr/bin/docker', 'rm', '--force', *containers], check=True, stdout=subprocess.DEVNULL, timeout=20)
    subprocess.run(['/usr/bin/docker', 'volume', 'rm', volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', type=Path, default=Path('/etc/strgo-terminal/broker.env'))
    args = parser.parse_args()
    env = dict(line.split('=', 1) for line in args.env.read_text().splitlines() if line and not line.startswith('#'))
    owner = uuid.uuid4().hex
    volume = 'strgo-workspace-' + owner
    path = env.get('TERMINAL_BROKER_SOCKET', '/run/strgo-terminal/broker.sock')
    # Refuse to reuse an existing volume, including an improbable UUID collision.
    exists = subprocess.run(['/usr/bin/docker', 'volume', 'inspect', volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    if exists.returncode == 0:
        raise SystemExit('探针卷名已存在，未执行检查，请重试。')
    connected = False
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
            stream.settimeout(25)
            stream.connect(path)
            connected = True
            send(stream, {'type': 'workspace', 'owner': owner, 'cols': 80, 'rows': 24})
            if receive(stream).get('type') != 'ready':
                raise RuntimeError('沙箱代理没有返回就绪消息。')
            # The expected marker never appears contiguously in the input echo.
            command = "printf 'STRGO_'; printf 'BROKER_OK\\n'; id -u; pwd; exit\r"
            output = bytearray()
            deadline = time.monotonic() + 25
            exited = False
            command_sent = False
            while time.monotonic() < deadline:
                stream.settimeout(max(.1, deadline - time.monotonic()))
                packet = receive(stream)
                if packet.get('type') == 'output':
                    output.extend(base64.b64decode(packet['data'], validate=True))
                    if len(output) > 1024 * 1024:
                        raise RuntimeError('探针输出超出预期上限。')
                    # Ready means the Docker client was spawned; wait until it
                    # actually attaches the container before writing to stdin.
                    if not command_sent:
                        send(stream, {'type': 'input', 'data': command})
                        command_sent = True
                elif packet.get('type') == 'exit':
                    exited = packet.get('code') == 0
                    break
            text = output.decode('utf-8', errors='replace').replace('\r', '')
            if not exited or 'STRGO_BROKER_OK\n10001\n/home/terminal\n' not in text:
                raise RuntimeError('沙箱未正常执行探针命令，请查看沙箱代理日志。')
        print('沙箱代理真实检查通过：systemd 服务 → PTY → Docker → 普通用户 shell → 正常退出。')
    finally:
        if connected:
            cleanup(volume)


if __name__ == '__main__':
    main()
