"""Operations CLI. Run on the server, never expose these operations over HTTP."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import tempfile
import time

from cryptography.fernet import Fernet

from .security import digest, encryption_key, password_hash
from .storage import create_storage
from .store import Store


def load_env(filename):
    # Parse KEY=VALUE without invoking a shell or expanding substitutions.
    if not filename:
        return
    for line in Path(filename).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not key.replace('_', '').isalnum():
            raise SystemExit('配置文件应使用 KEY=VALUE 格式。')
        os.environ[key] = value.strip().strip('"').strip("'")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', help='服务器环境配置文件，仅管理员读取')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('key', help='生成加密主密钥（请离线保管）')
    invite = sub.add_parser('invite', help='创建一次性邀请码')
    invite.add_argument('--admin', action='store_true', help='仅在没有管理员时引导创建首位管理员')
    reset = sub.add_parser('reset-password', help='重置账号密码并使所有会话失效')
    reset.add_argument('username')
    sub.add_parser('check-storage', help='实际校验图片存储的写入和读取')
    sub.add_parser('backup', help='加密备份数据库至持久化存储')
    sub.add_parser('reindex', help='从加密文件清单恢复账号、接口配置和作品索引')
    restore = sub.add_parser('restore', help='恢复加密数据库备份到新文件；不会覆盖运行中的数据库')
    restore.add_argument('object_key')
    restore.add_argument('destination')
    args = parser.parse_args()
    load_env(args.env)
    if args.command == 'key':
        print(Fernet.generate_key().decode())
        return
    cipher = encryption_key()
    storage = create_storage()
    if args.command == 'restore':
        if not args.object_key.startswith(storage.key('system/backups/')):
            raise SystemExit('只允许恢复本应用的加密备份。')
        data = cipher.decrypt(storage.get(args.object_key))
        if not data.startswith(b'SQLite format 3\x00'):
            raise SystemExit('备份内容校验失败。')
        destination = Path(args.destination)
        with destination.open('xb') as handle:
            handle.write(data)
        os.chmod(destination, 0o600)
        with closing(sqlite3.connect(destination)) as db, db:
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise SystemExit('数据库完整性检查失败，未触碰线上数据库。')
            db.execute('DELETE FROM sessions')
            db.execute('UPDATE invites SET expires=0 WHERE used_by IS NULL')
            db.execute("UPDATE jobs SET status='failed',error='数据库恢复后停止未完成的模型调用，避免重复计费。' WHERE status IN ('queued','generating')")
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_jobs'").fetchone():
                db.execute("UPDATE local_jobs SET status='failed',reference=NULL,error='数据库恢复后停止未完成的本机任务，避免重复生成。' WHERE status IN ('queued','running')")
                db.execute('DELETE FROM local_chunks')
            db.execute("UPDATE images SET state='pending' WHERE state IN ('staged','uploading')")
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_tasks'").fetchone():
                db.execute('DELETE FROM ai_stepups')
                db.execute("UPDATE ai_tasks SET state='RECONCILING',lease_until=0,reconcile_after=? WHERE dispatched=1 AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED','SAVING')", (int(time.time()) + 86400,))
                db.execute("UPDATE ai_tasks SET lease_until=0 WHERE state IN ('QUEUED','SAVING')")
        print('备份恢复到：' + str(destination) + '；登录会话已全部撤销。请先核对，再在停服后切换。')
        return
    if args.command == 'reindex':
        store = Store(os.environ.get('IMAGE_DATA_DIR', '/var/lib/strgo-image'), cipher)
        prefix = storage.key('images/')
        restored = 0
        configs = 0
        for object_key in storage.iter_keys(storage.key('system/users/')):
            if not object_key.endswith('.fernet'):
                continue
            try:
                encrypted = storage.get(object_key)
                record = json.loads(cipher.decrypt(encrypted))
                if (object_key != storage.key(f'system/users/{record["id"]}.fernet')
                        or not re.fullmatch(r'[a-f0-9]{32}', record['id'])
                        or not re.fullmatch(r'[a-z0-9_-]{3,32}', record['username'])
                        or not re.fullmatch(r'scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}', record['password'])
                        or record['role'] not in ('member', 'admin') or type(record['created']) is not int
                        or type(record['updated']) is not int or record['updated'] < record['created']):
                    raise ValueError()
            except Exception:
                raise SystemExit('账号文件清单无效，停止恢复。')
            with store.connect() as db:
                # The monotonic update version prevents a stale DB snapshot
                # from restoring a password superseded by a cloud copy.
                existing = db.execute('SELECT * FROM users WHERE id=?', (record['id'],)).fetchone()
                username_owner = db.execute('SELECT id FROM users WHERE username=?', (record['username'],)).fetchone()
                if existing and record['updated'] > existing['updated']:
                    db.execute('UPDATE users SET password=?,role=?,updated=? WHERE id=?', (record['password'], record['role'], record['updated'], record['id']))
                    db.execute('DELETE FROM sessions WHERE user_id=?', (record['id'],))
                elif not existing and not username_owner:
                    db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (record['id'], record['username'], record['password'], record['role'], record['created'], record['updated']))
        for object_key in storage.iter_keys(storage.key('system/configs/')):
            if not object_key.endswith('.fernet'):
                continue
            user_id = Path(object_key).name.removesuffix('.fernet')
            try:
                encrypted = storage.get(object_key)
                data = cipher.decrypt(encrypted)
                json.loads(data)
            except Exception:
                raise SystemExit('加密配置文件校验失败，停止恢复。')
            with store.connect() as db:
                if db.execute('SELECT 1 FROM users WHERE id=?', (user_id,)).fetchone():
                    db.execute('INSERT INTO configs VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted=excluded.encrypted', (user_id, encrypted))
                    configs += 1
        for object_key in storage.iter_keys(prefix):
            if not object_key.endswith('.metadata.fernet'):
                continue
            try:
                raw = storage.get(object_key)
                manifest = json.loads(cipher.decrypt(raw))
                image = manifest['image']
                if object_key != image['object_key'] + '.metadata.fernet' or not object_key.startswith(prefix):
                    raise ValueError()
                user_id, job_id = manifest['user_id'], manifest['id']
                if not all(isinstance(manifest[key], str) for key in ('prompt', 'model', 'size')):
                    raise ValueError()
                if (not re.fullmatch(r'[a-f0-9]{32}', user_id) or not re.fullmatch(r'[a-f0-9]{32}', job_id)
                        or not re.fullmatch(r'[a-f0-9]{32}', image['id'])
                        or not re.fullmatch(r'[a-f0-9]{64}', image['sha256'])
                        or not image['object_key'].startswith(prefix + user_id + '/')
                        or type(manifest['count']) is not int or manifest['count'] not in (1, 2, 4)
                        or type(image['bytes']) is not int or image['bytes'] < 1
                        or image['mime'] not in ('image/png', 'image/jpeg', 'image/webp')
                        or image['extension'] not in ('png', 'jpg', 'webp')):
                    raise ValueError()
            except Exception:
                raise SystemExit('图片文件清单无效，停止恢复。')
            with store.connect() as db:
                user = db.execute('SELECT 1 FROM users WHERE id=?', (user_id,)).fetchone()
                if not user:
                    continue
                removed = db.execute("SELECT 1 FROM images WHERE id=? AND state IN ('deleting','deleted')", (image['id'],)).fetchone()
                if removed:
                    continue
                existing = db.execute('SELECT * FROM jobs WHERE id=? AND user_id=?', (job_id, user_id)).fetchone()
                if not existing:
                    encrypted_config = cipher.encrypt(json.dumps({'endpoint': '', 'model': manifest['model'], 'apiKey': ''}).encode())
                    db.execute('INSERT INTO jobs(id,user_id,prompt,model,size,quality,count,status,created,request_id,provider_config) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                               (job_id, user_id, manifest['prompt'], manifest['model'], manifest['size'], manifest.get('quality', ''), manifest['count'], 'partial', manifest['created'], 'recovered-' + job_id, encrypted_config))
                image_data = storage.get(image['object_key'])
                if (len(image_data) != image['bytes'] or len(image_data) > 24 * 1024 * 1024
                        or hashlib.sha256(image_data).hexdigest() != image['sha256']):
                    raise SystemExit('图片完整性校验失败，停止恢复。')
                db.execute('''INSERT INTO images(id,job_id,user_id,object_key,mime,extension,bytes,sha256,state,created)
                              VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                              job_id=excluded.job_id,user_id=excluded.user_id,object_key=excluded.object_key,
                              mime=excluded.mime,extension=excluded.extension,bytes=excluded.bytes,
                              sha256=excluded.sha256,state='saved',error='' ''',
                           (image['id'], job_id, user_id, image['object_key'], image['mime'], image['extension'], image['bytes'], image['sha256'], 'saved', manifest['created']))
                restored += 1
                count = db.execute('SELECT COUNT(*) FROM images WHERE job_id=? AND state=?', (job_id, 'saved')).fetchone()[0]
                state = 'complete' if count >= manifest['count'] else 'partial'
                db.execute('UPDATE jobs SET status=? WHERE id=?', (state, job_id))
        store.set_metadata('last_backup', 0)
        with store.connect() as db:
            db.execute('UPDATE invites SET expires=0 WHERE used_by IS NULL')
            users = db.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        print(f'已检查 {users} 个账号，恢复 {restored} 张图片索引和 {configs} 份加密配置。请检查账号映射与作品列表。')
        return
    if args.command == 'check-storage':
        marker = secrets.token_bytes(32)
        key = storage.key('system/health-check.bin')
        storage.put(key, marker, 'application/octet-stream')
        if storage.get(key) != marker:
            raise SystemExit('图片存储读写校验失败。')
        print(storage.label + '：私有文件写入、读取与完整性校验成功。')
        return
    store = Store(os.environ.get('IMAGE_DATA_DIR', '/var/lib/strgo-image'), cipher)
    if args.command == 'invite':
        token = 'STRGO-' + secrets.token_urlsafe(24)
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if args.admin:
                if db.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
                    raise SystemExit('已有管理员。请使用该账号登录，或通过 reset-password 恢复账号。')
                db.execute("DELETE FROM invites WHERE role='admin' AND used_by IS NULL")
            db.execute('INSERT INTO invites VALUES(?,?,?,?,?)', (digest(token), int(time.time()) + 7 * 86400, None, 'server-operator', 'admin' if args.admin else 'member'))
        print('一次性邀请码（7 天有效）：' + token)
        print('管理员邀请码' if args.admin else '普通成员邀请码')
    elif args.command == 'reset-password':
        password = getpass.getpass('新密码（至少 12 位）：')
        if password != getpass.getpass('再次输入：'):
            raise SystemExit('两次密码不一致。')
        hashed = password_hash(password)
        with store.connect() as db:
            user = db.execute('SELECT id FROM users WHERE username=?', (args.username.lower(),)).fetchone()
            if not user:
                raise SystemExit('账号不存在。')
            record = db.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
            snapshot = dict(record)
            snapshot['password'] = hashed
            snapshot['updated'] = max(int(time.time()), int(record['updated']) + 1)
        storage.put(storage.key(f'system/users/{snapshot["id"]}.fernet'), cipher.encrypt(json.dumps(snapshot).encode()), 'application/octet-stream')
        with store.connect() as db:
            db.execute('UPDATE users SET password=?,updated=? WHERE id=?', (hashed, snapshot['updated'], user['id']))
            db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
        print('密码已重置，所有会话已撤销。')
    elif args.command == 'backup':
        timestamp = datetime.now(timezone.utc).strftime('%Y/%m/%d/%H%M%S')
        key = storage.key(f'system/backups/{timestamp}-{secrets.token_hex(4)}.sqlite3.fernet')
        storage.put(key, store.backup_bytes(), 'application/octet-stream')
        store.set_metadata('last_backup', int(time.time()))
        store.set_metadata('backup_key', key)
        print('备份已保存：' + key)


if __name__ == '__main__':
    main()
