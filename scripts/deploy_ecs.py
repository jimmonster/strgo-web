#!/usr/bin/env python3
"""Update the existing strgo.com ECS installation using its module publishers."""
import argparse
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tempfile


class DeploymentError(RuntimeError):
    pass


@dataclass(frozen=True)
class Target:
    project: Path
    account: Path
    env_file: Path
    data: Path
    terminal: bool


def run(command, cwd, *, capture=False, env=None):
    print('+ ' + shlex.join(map(str, command)), flush=True)
    return subprocess.run(list(map(str, command)), cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None, env=env)


def read_env(path):
    """Use the account CLI's KEY=VALUE syntax without shell evaluation."""
    values = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not key.replace('_', '').isalnum():
            raise DeploymentError('账号环境文件需要 KEY=VALUE 格式。')
        values[key] = value.strip().strip('"').strip("'")
    return values


def validate_configuration(project, env_file):
    site = json.loads((project / 'site.json').read_text())
    values = read_env(env_file)
    if site.get('BASE_ORIGIN', '').rstrip('/') != 'https://strgo.com':
        raise DeploymentError('此入口更新已有 https://strgo.com；请核对 site.json。')
    if values.get('IMAGE_PUBLIC_ORIGIN', '').rstrip('/') != 'https://strgo.com':
        raise DeploymentError('IMAGE_PUBLIC_ORIGIN 必须与主站的 HTTPS 地址一致。')
    if values.get('IMAGE_STORAGE', 'local').strip().lower() != 'local':
        raise DeploymentError('此入口适用于 ECS 本地存储；OSS 请先按部署文档迁移。')
    if not values.get('IMAGE_ENCRYPTION_KEY'):
        raise DeploymentError('已有账号服务缺少加密密钥；停止更新。')
    return Path(values.get('IMAGE_DATA_DIR', '/var/lib/strgo-image'))


def ensure_idle(database):
    """Inspect the existing DB read-only; never migrate it during preflight."""
    if not database.is_file():
        raise DeploymentError('找不到已有账号数据库：' + str(database))
    pending = [
        ('jobs', 'status', ('queued', 'generating', 'uploading')),
        ('local_jobs', 'status', ('queued', 'running')),
        ('ai_tasks', 'state', ('QUEUED', 'DISPATCHING', 'RUNNING', 'SAVING',
                               'CANCEL_REQUESTED', 'RECONCILING')),
    ]
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'jobs' not in tables:
            raise DeploymentError('已有账号数据库不包含 jobs 表；停止更新。')
        for table, column, states in pending:
            if table not in tables:
                continue
            placeholders = ','.join('?' for _ in states)
            count = db.execute(f'SELECT COUNT(*) FROM {table} WHERE {column} IN ({placeholders})', states).fetchone()[0]
            if count:
                raise DeploymentError(f'{table} 还有 {count} 个未完成或待核对任务，请处理后重试。')


def preflight(project, skip_terminal):
    if not hasattr(os, 'geteuid') or os.geteuid() != 0:
        raise DeploymentError('请在 ECS 的普通 SSH / Workbench 终端以 root 执行。')
    if not Path('/run/systemd/system').is_dir():
        raise DeploymentError('需要运行 systemd 的 Ubuntu / Debian ECS。')
    os_release = read_env(Path('/etc/os-release'))
    if os_release.get('ID') not in ('ubuntu', 'debian'):
        raise DeploymentError('此入口仅支持 Ubuntu / Debian。')
    for name in ('git', 'node', 'npm', 'python3', 'nginx', 'curl', 'systemctl', 'ffmpeg'):
        if not shutil.which(name):
            raise DeploymentError('缺少命令：' + name + '。请先按 DEPLOYMENT.md 准备环境。')
    run(['node', '-e', 'if (Number(process.versions.node.split(".")[0]) < 22) throw Error("需要 Node.js 22 或更新版本")'], project)
    run(['python3', '-c', 'import venv, ensurepip, socket; socket.socket().close()'], project)
    if run(['git', 'branch', '--show-current'], project, capture=True).stdout.strip() != 'main':
        raise DeploymentError('请先切换到 main，并 git pull --ff-only origin main。')
    if run(['git', 'status', '--porcelain', '--untracked-files=no'], project, capture=True).stdout.strip():
        raise DeploymentError('源码有未提交改动，请先保存并合并后重试。')
    account, env_file = Path('/opt/strgo-image'), Path('/etc/strgo-image.env')
    if not env_file.is_file() or not (account / '.venv/bin/python').is_file():
        raise DeploymentError('此入口升级已有账号服务；首次安装请按 DEPLOYMENT.md 操作。')
    data = validate_configuration(project, env_file)
    for filename in ('fullchain.pem', 'privkey.pem'):
        certificate = Path('/etc/letsencrypt/live/strgo.com') / filename
        if not certificate.is_file() or not certificate.stat().st_size:
            raise DeploymentError('需要已有 strgo.com HTTPS 证书；首次申请见 DEPLOYMENT.md。')
    host = Path('/etc/nginx/sites-available/strgo.conf')
    if not host.is_file() or host.is_symlink() or not host.read_text().startswith('# Managed by strgo-homepage/deploy.sh\n'):
        raise DeploymentError('主站 Nginx 配置不是本项目管理的文件，请先核对现有部署。')
    run(['nginx', '-t'], project)
    run(['systemctl', 'is-active', '--quiet', 'nginx', 'strgo-image'], project)
    terminal = not skip_terminal and any(path.exists() for path in (
        Path('/etc/strgo-terminal/web.env'),
        Path('/usr/local/lib/strgo-terminal/strgo-terminal'),
        Path('/etc/systemd/system/strgo-terminal.service'),
    ))
    if terminal:
        if not shutil.which('docker'):
            raise DeploymentError('已有终端需要 Docker；如只更新网页，请使用 --skip-terminal。')
        run(['docker', 'info', '--format', '{{.ServerVersion}}'], project, capture=True)
        run(['systemctl', 'is-active', '--quiet', 'strgo-terminal', 'strgo-terminal-broker'], project)
    ensure_idle(data / 'playground.sqlite3')
    return Target(project, account, env_file, data, terminal)


def terminal_manifest(terminal):
    release = terminal / '.build/account-release'
    release.mkdir(parents=True, exist_ok=True)
    shutil.copy2(terminal / '.build/strgo-terminal', release / 'strgo-terminal')
    patterns = ['.build/account-release/strgo-terminal', 'Cargo.toml', 'Cargo.lock', 'build.rs',
                'src/*.rs', 'web/*.html', 'web/*.js', 'web/*.css', 'web/vendor/*.js',
                'web/vendor/*.css', '../../image_service/app.py', 'tests/*.mjs',
                'tests/*.py', 'deploy/*.service', 'deploy/*.conf',
                'update-account.sh', 'update-mobile.sh', 'repair-sandbox.sh']
    lines = []
    for pattern in patterns:
        paths = sorted(terminal.glob(pattern))
        if not paths:
            raise DeploymentError('终端校验清单缺少文件：' + pattern)
        for path in paths:
            name = os.path.relpath(path, terminal)
            if '\n' in name or '\\' in name:
                raise DeploymentError('终端文件路径不支持换行或反斜杠。')
            lines.append(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + name + '\n')
    (release / 'SHA256SUMS').write_text(''.join(lines))


def prepare(target):
    run(['npm', 'ci', '--no-audit', '--no-fund'], target.project)
    run(['npm', 'run', 'build:production'], target.project)
    for app in ('polyverse', 'meow', 'swarmera'):
        directory = target.project / 'apps' / app
        run(['npm', 'ci', '--no-audit', '--no-fund'], directory)
        env = dict(os.environ, BASE_PATH='/polyverse/', MEOW_BASE='/meow/', SWARMERA_BASE='/swarmera/')
        run(['npm', 'run', 'build'], directory, env=env)
    if target.terminal:
        directory = target.project / 'apps/terminal'
        run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], directory)
        run(['node', 'scripts/sync-terminal-theme.mjs', '--check'], target.project)
        run(['bash', 'scripts/build-native.sh'], directory)
        terminal_manifest(directory)
        env = dict(os.environ, ACCOUNT_TEST_PYTHON=str(target.account / '.venv/bin/python'))
        run(['bash', 'update-account.sh', '--check'], directory, env=env)


def backup(target, backup_root=Path('/var/backups/strgo')):
    backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-')
    directory = Path(tempfile.mkdtemp(prefix=timestamp, dir=backup_root))
    shutil.copy2(target.env_file, directory / 'strgo-image.env')
    (directory / 'strgo-image.env').chmod(0o600)
    shutil.copytree(target.account / 'image_service', directory / 'image_service', ignore=shutil.ignore_patterns('__pycache__'))
    for name in ('sites-available', 'sites-enabled', 'snippets'):
        path = Path('/etc/nginx') / name
        if path.is_dir():
            shutil.copytree(path, directory / 'nginx' / name, symlinks=True)
    result = run([target.account / '.venv/bin/python', '-m', 'image_service.cli',
                  '--env', target.env_file, 'backup'], target.account, capture=True)
    (directory / 'database-backup.txt').write_text(result.stdout)
    print(result.stdout.strip(), flush=True)
    print('配置、密钥与账号源码备份：' + str(directory), flush=True)
    return directory


def publish(target):
    run(['bash', 'image_service/deploy/install.sh'], target.project)
    run(['bash', 'deploy.sh'], target.project)
    for app in ('polyverse', 'meow', 'swarmera'):
        run(['bash', 'deploy.sh'], target.project / 'apps' / app)
    if target.terminal:
        env = dict(os.environ, ACCOUNT_TEST_PYTHON=str(target.account / '.venv/bin/python'))
        run(['bash', 'update-account.sh'], target.project / 'apps/terminal', env=env)
    run(['nginx', '-t'], target.project)
    services = ['nginx', 'strgo-image'] + (['strgo-terminal', 'strgo-terminal-broker'] if target.terminal else [])
    run(['systemctl', 'is-active', '--quiet', *services], target.project)
    for route in ('/', '/hub/', '/forum/', '/admin/', '/ai/', '/polyverse/', '/meow/', '/swarmera/'):
        run(['curl', '--noproxy', '*', '--fail', '--silent', '--show-error', '--max-time', '15',
             '--resolve', 'strgo.com:443:127.0.0.1', 'https://strgo.com' + route, '-o', '/dev/null'], target.project)


def main(argv=None):
    parser = argparse.ArgumentParser(description='一键升级已有 strgo.com ECS：主站、账号 API、三个独立空间及已安装终端。')
    parser.add_argument('--check', action='store_true', help='只读检查现有环境与任务状态，不安装或发布')
    parser.add_argument('--skip-terminal', action='store_true', help='仅更新网页和账号 API，保留终端服务版本')
    args = parser.parse_args(argv)
    project = Path(__file__).resolve().parents[1]
    stage, saved = '部署前检查', None
    os.umask(0o077)
    try:
        target = preflight(project, args.skip_terminal)
        print('终端：' + ('重新构建并更新，现有连接会结束。' if target.terminal else '本轮不更新。'), flush=True)
        if args.check:
            print('部署前检查通过；尚未构建、备份或发布。')
            return 0
        import fcntl
        with Path('/run/lock/strgo-ecs-deploy.lock').open('a') as lock:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise DeploymentError('另一轮 ECS 部署正在运行。') from None
            stage = '安装依赖并准备全部构建'
            prepare(target)
            # Build downloads may take time. Recheck immediately before touching services.
            ensure_idle(target.data / 'playground.sqlite3')
            stage = '备份配置、密钥、账号源码与加密数据库'
            saved = backup(target)
            stage = '按模块发布并验证'
            publish(target)
        sha = run(['git', 'rev-parse', '--short', 'HEAD'], project, capture=True).stdout.strip()
        print(f'部署及本机 HTTPS 检查完成：{sha} · https://strgo.com\n备份：{saved}')
        return 0
    except (DeploymentError, OSError, ValueError, sqlite3.Error, subprocess.CalledProcessError) as error:
        print(f'部署停止于「{stage}」：{error}', file=sys.stderr)
        if saved:
            print(f'备份：{saved}。各发布脚本按自身边界回滚；不是跨模块的整体事务。', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
