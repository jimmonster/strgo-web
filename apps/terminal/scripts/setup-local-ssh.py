#!/usr/bin/env python3
"""One-time key authentication for an administrator connecting to this server."""
import argparse
import importlib.util
import os
import re
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path


CONFIG = Path('/etc/strgo-terminal/broker.env')
IDENTITY = Path('/etc/strgo-terminal/identity')
LOCK = Path('/run/lock/strgo-terminal-local-ssh.lock')
HOST_KEY_DIR = Path('/etc/ssh')


def require_root():
    if os.name != 'posix' or os.geteuid() != 0:
        raise ValueError('请在部署 STRGO 的 Linux 服务器普通终端中以 root 执行')


def setting(source, name):
    values = [line.split('=', 1)[1].strip().strip('"').strip("'")
              for line in source.splitlines() if line.startswith(name + '=')]
    if len(values) > 1:
        raise ValueError(f'{name} 配置重复，请先核对配置')
    return values[0] if values else ''


def authorize(source, public_key):
    fields = public_key.split()
    if len(fields) < 2 or not fields[0].startswith(('ssh-', 'ecdsa-')):
        raise ValueError('SSH 公钥格式无效')
    # An existing restricted entry must never be replaced by an unrestricted one.
    if any(fields[1] in line.split() for line in source.splitlines() if not line.lstrip().startswith('#')):
        return source
    return source + ('' if not source or source.endswith('\n') else '\n') + ' '.join(fields[:2]) + ' strgo-terminal-admin\n'


def regular_file(path):
    if path.is_symlink() or path.exists() and not path.is_file():
        raise ValueError(f'拒绝修改符号链接或非普通文件：{path}')


def write_file(path, data, mode, uid=0, gid=0):
    regular_file(path)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            os.fchmod(output.fileno(), mode)
            os.fchown(output.fileno(), uid, gid)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--user', default='root', help='本机 SSH 用户，默认 root')
    parser.add_argument('--host', default='strgo.com', help='网页 SSH 使用的本机地址')
    parser.add_argument('--port', type=int, default=22)
    parser.add_argument('--check', action='store_true', help='只检查，不生成密钥或修改服务')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', args.user) or not 1 <= args.port <= 65535:
        parser.error('用户名或 SSH 端口无效')
    require_root()
    import fcntl
    import pwd

    with LOCK.open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for executable in ['ssh', 'ssh-keygen', 'systemctl']:
            if not shutil.which(executable):
                raise ValueError(f'缺少命令：{executable}')
        regular_file(CONFIG)
        source = CONFIG.read_text()
        identity = Path(setting(source, 'TERMINAL_IDENTITY_FILE') or IDENTITY)
        if not identity.is_absolute() or ',' in str(identity):
            raise ValueError('已配置的私钥路径无效')
        regular_file(identity)
        if not identity.parent.is_dir():
            raise ValueError('已配置的私钥目录不存在')
        user = pwd.getpwnam(args.user)
        home = Path(user.pw_dir)
        if not home.is_absolute() or not home.is_dir() or home.is_symlink():
            raise ValueError('SSH 用户主目录无效')
        ssh_dir = home / '.ssh'
        if ssh_dir.is_symlink() or ssh_dir.exists() and not ssh_dir.is_dir():
            raise ValueError('SSH 目录不能是符号链接或普通文件')
        authorized = ssh_dir / 'authorized_keys'
        regular_file(authorized)
        spec = importlib.util.spec_from_file_location('terminal_target', Path(__file__).with_name('configure-target.py'))
        target = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(target)
        config, endpoints = target.render(source, target.resolve(args.host), args.port)
        config = '\n'.join(line for line in config.splitlines() if not line.startswith('TERMINAL_IDENTITY_FILE='))
        config += f'\nTERMINAL_IDENTITY_FILE={identity}\n'
        host_keys = [path.read_text().split()[:2] for path in HOST_KEY_DIR.glob('ssh_host_*_key.pub')]
        if not host_keys or any(len(key) != 2 for key in host_keys):
            raise ValueError('未找到本机 SSH 主机公钥，无法核验连接目标')
        for unit in ['strgo-terminal-broker', 'strgo-terminal']:
            subprocess.run(['systemctl', 'is-active', '--quiet', unit], check=True)
        if args.check:
            print(f'检查通过：将为本机 {args.user}@{args.host}:{args.port} 配置密钥认证；未修改文件或服务。')
            return

        # Backups remain root-only. Reuse an installed identity; never rotate it silently.
        backup = Path(tempfile.mkdtemp(prefix='local-ssh-backup.', dir=CONFIG.parent))
        snapshots = {}
        for path in [CONFIG, authorized, identity]:
            snapshots[path] = (path.read_bytes(), path.stat()) if path.exists() else None
        directory_stat = ssh_dir.stat() if ssh_dir.exists() else None
        for name, path in [('broker.env', CONFIG), ('authorized_keys', authorized)]:
            if snapshots[path]:
                (backup / name).write_bytes(snapshots[path][0])
                (backup / name).chmod(0o600)
        try:
            with tempfile.TemporaryDirectory(prefix='key.', dir=backup) as directory:
                staged_key = Path(directory) / 'identity'
                if identity.exists():
                    shutil.copyfile(identity, staged_key)
                    staged_key.chmod(0o600)
                else:
                    subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'strgo-terminal-admin', '-f', str(staged_key)], check=True)
                public_key = subprocess.check_output(['ssh-keygen', '-y', '-P', '', '-f', str(staged_key)], text=True).strip()
                previous = authorized.read_text() if authorized.exists() else ''
                ssh_dir.mkdir(mode=0o700, exist_ok=True)
                os.chown(ssh_dir, user.pw_uid, user.pw_gid)
                ssh_dir.chmod(0o700)
                write_file(authorized, authorize(previous, public_key).encode(), 0o600, user.pw_uid, user.pw_gid)
                alias = args.host if args.port == 22 else f'[{args.host}]:{args.port}'
                known_hosts = Path(directory) / 'known_hosts'
                known_hosts.write_text(''.join(f'{alias} {kind} {key}\n' for kind, key in host_keys))
                # Trust this machine's host keys and require public-key auth. Password fallback is disabled.
                subprocess.run(['ssh', '-F', '/dev/null', '-i', str(staged_key), '-p', str(args.port), '-l', args.user,
                                '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
                                '-o', f'UserKnownHostsFile={known_hosts}', '-o', 'GlobalKnownHostsFile=/dev/null',
                                '-o', 'PreferredAuthentications=publickey', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes',
                                '-o', 'ConnectTimeout=10', args.host, 'true'], check=True, timeout=20)
                write_file(identity, staged_key.read_bytes(), 0o400, 10001, 10001)
            write_file(CONFIG, config.encode(), 0o600)
            subprocess.run(['systemctl', 'restart', 'strgo-terminal-broker', 'strgo-terminal'], check=True)
            for unit in ['strgo-terminal-broker', 'strgo-terminal']:
                subprocess.run(['systemctl', 'is-active', '--quiet', unit], check=True)
        except BaseException:
            for path, snapshot in snapshots.items():
                if snapshot:
                    data, metadata = snapshot
                    write_file(path, data, stat.S_IMODE(metadata.st_mode), metadata.st_uid, metadata.st_gid)
                elif path.exists():
                    path.unlink()
            if directory_stat:
                os.chown(ssh_dir, directory_stat.st_uid, directory_stat.st_gid)
                ssh_dir.chmod(stat.S_IMODE(directory_stat.st_mode))
            elif ssh_dir.exists():
                ssh_dir.rmdir()
            subprocess.run(['systemctl', 'restart', 'strgo-terminal-broker', 'strgo-terminal'], check=False)
            print(f'配置失败，已恢复文件。备份：{backup}')
            raise
        print(f'已验证本机 SSH 密钥登录：{args.user}@{args.host}:{args.port}。放行：{", ".join(endpoints)}')
        print('以网站管理员账号打开 SSH，勾选「记住服务器地址与用户名」，以后点连接即可，无需输入服务器密码。')
        print('每个新沙箱仍须核对主机指纹；普通网站成员不会获得此私钥。')
        print(f'备份：{backup}；本次重启已结束原有终端连接。')


if __name__ == '__main__':
    main()
