"""Take a private online SQLite backup and ensure the account service is idle."""
from contextlib import closing
from pathlib import Path
import shutil
import sqlite3
import sys

from scripts.deploy_ecs import ensure_idle, read_env


def main():
    env = Path('/etc/strgo-image.env')
    settings = read_env(env)
    if settings.get('IMAGE_PUBLIC_ORIGIN', '').rstrip('/') != 'https://strgo.com':
        raise SystemExit('Unexpected existing account origin.')
    db = Path(settings.get('IMAGE_DATA_DIR', '/var/lib/strgo-image')) / 'playground.sqlite3'
    ensure_idle(db)
    if len(sys.argv) == 1:
        return
    output = Path(sys.argv[1])
    shutil.copy2(env, output / 'strgo-image.env')
    with closing(sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True)) as source:
        with closing(sqlite3.connect(output / 'account.sqlite3')) as destination:
            source.backup(destination)
            if destination.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise SystemExit('Account database backup integrity check failed.')


if __name__ == '__main__':
    main()
