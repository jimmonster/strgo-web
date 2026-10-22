import concurrent.futures
import base64
from datetime import datetime, timezone
import hashlib
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
import re
import secrets
import signal
import threading
import time
from urllib.parse import parse_qs, urlsplit
import uuid

from .cloud import ImageProvider
from .security import Problem, digest, encryption_key, image_type, password_hash, password_matches, validate_endpoint
from .storage import create_storage
from .store import Store
from . import forum

API = '/api/image'
COOKIE = 'strgo_image_session'
ACCOUNT_COOKIE = 'strgo_account_session'
SESSION_AGE = 7 * 24 * 3600
BUSY = ('queued', 'generating', 'uploading')
QUALITIES = ('', 'auto', 'low', 'medium', 'high', 'standard', 'hd')
LOGGER = logging.getLogger('image-playground')
REFERENCE_MAX_BYTES = 2_000_000
REFERENCE_MAX_ENCODED = 4 * ((REFERENCE_MAX_BYTES + 2) // 3)
QUOTA_TIMEZONE = 'Asia/Shanghai'
QUOTA_UTC_OFFSET = 8 * 3600
MAX_DAILY_IMAGES = 100000


def valid_size(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{3,4}x\d{3,4}', value):
        return False
    width, height = (int(part) for part in value.split('x'))
    return all(256 <= side <= 4096 and side % 64 == 0 for side in (width, height))


def preset_public(row):
    return {**{key: row[key] for key in ('id', 'title', 'description', 'prompt', 'created', 'updated')}, 'sortOrder': row['sort_order']}


class Service:
    def __init__(self, store, storage=None, provider=None, origin=None, start_worker=True):
        self.store = store
        self.storage = storage if storage is not None else create_storage()
        self.provider = provider if provider is not None else ImageProvider()
        self.origin = origin or os.environ.get('IMAGE_PUBLIC_ORIGIN', 'https://strgo.com')
        parsed = urlsplit(self.origin)
        development = os.environ.get('IMAGE_ENV') == 'development'
        if parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password or not parsed.hostname or (parsed.scheme != 'https' and not (development and parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1'))):
            raise RuntimeError('IMAGE_PUBLIC_ORIGIN 需为 HTTPS 站点源，开发模式仅允许本地 HTTP。')
        self.secure = parsed.scheme == 'https'
        self.dummy_hash = password_hash(secrets.token_urlsafe(24))
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=3, thread_name_prefix='images')
        self.wake = threading.Event()
        self.stopping = threading.Event()
        self.inflight = set()
        self.inflight_lock = threading.Lock()
        self.image_locks = tuple(threading.RLock() for _ in range(64))
        self.backup_due = threading.Event()
        self.recover()
        self.worker = threading.Thread(target=self._loop, name='image-jobs', daemon=True) if start_worker else None
        if self.worker:
            self.worker.start()

    def recover(self):
        with self.store.connect() as db:
            # Repeating an interrupted paid model call could charge twice.
            db.execute("UPDATE jobs SET status='failed',error=?,reference_image=NULL WHERE status='generating'", ('服务重启时模型请求中断。为避免重复计费，未自动重新生成。',))
            db.execute("UPDATE images SET state='pending',error=? WHERE state='uploading'", ('上次同步中断，正在重试。',))
            db.execute("UPDATE images SET state='pending',error=? WHERE state='staged'", ('服务重启后恢复待同步图片。',))
            db.execute("UPDATE jobs SET status='failed',error=? WHERE status='uploading' AND NOT EXISTS(SELECT 1 FROM images WHERE job_id=jobs.id)", ('上次任务在保存图片前中断，请检查模型服务记录。',))
        self.backup_due.set()

    def close(self):
        self.stopping.set()
        self.wake.set()
        if self.worker:
            self.worker.join(timeout=3)
        self.pool.shutdown(wait=True)

    def dirty(self):
        self.backup_due.set()
        self.wake.set()

    def _loop(self):
        retry_after = 0
        while not self.stopping.is_set():
            try:
                with self.store.connect() as db:
                    queued = db.execute("SELECT id FROM jobs WHERE status='queued' AND deleted=0 ORDER BY created LIMIT 3").fetchall()
                for job in queued:
                    self._submit('job:' + job['id'], self.run_job, job['id'])
                if time.time() >= retry_after:
                    with self.store.connect() as db:
                        pending = db.execute("SELECT id FROM images WHERE state='pending' ORDER BY created LIMIT 20").fetchall()
                        deleting = db.execute("SELECT id FROM images WHERE state='deleting' ORDER BY created LIMIT 20").fetchall()
                    for image in deleting:
                        self._submit('image:' + image['id'], self.delete_image, image['id'])
                    for image in pending:
                        self._submit('image:' + image['id'], self.upload_image, image['id'])
                    retry_after = time.time() + 60
                    last_backup = int(self.store.metadata('last_backup') or '0')
                    last_attempt = int(self.store.metadata('backup_attempt') or '0')
                    retry_failed = bool(self.store.metadata('backup_error')) and time.time() - last_attempt >= 60
                    if self.storage.ready and (last_backup == 0 or time.time() - last_backup >= 86400 or retry_failed):
                        self._submit('backup', self.backup)
                        self.backup_due.clear()
            except Exception:
                LOGGER.error('后台队列检查失败；任务保留等待重试。')
            self.wake.wait(2)
            self.wake.clear()

    def _submit(self, key, action, *args):
        with self.inflight_lock:
            if key in self.inflight or len(self.inflight) >= 5 or self.stopping.is_set():
                return
            self.inflight.add(key)
        def execute():
            try:
                action(*args)
            except Exception:
                LOGGER.error('后台操作失败；未输出任何接口凭据或响应正文。')
            finally:
                with self.inflight_lock:
                    self.inflight.discard(key)
        self.pool.submit(execute)

    def run_job(self, job_id):
        with self.store.connect() as db:
            changed = db.execute("UPDATE jobs SET status='generating' WHERE id=? AND status='queued' AND deleted=0", (job_id,)).rowcount
            job = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        if not changed:
            return
        try:
            # Confirm durable storage is writable before a billable generation.
            self.storage.put(self.storage.key('system/write-check.txt'), b'Image storage ready', 'text/plain')
            config = json.loads(self.store.cipher.decrypt(job['provider_config']))
            provider_job = dict(job)
            if job['reference_image']:
                provider_job['reference_image'] = self.store.cipher.decrypt(job['reference_image'])
            try:
                items = self.provider.generate(config, provider_job)
            finally:
                # Reference uploads are encrypted while queued, then discarded
                # after the one paid upstream attempt has finished.
                with self.store.connect() as db:
                    db.execute('UPDATE jobs SET reference_image=NULL WHERE id=?', (job_id,))
            failures = []
            staged_ids = []
            for item in items:
                try:
                    data = self.provider.image_bytes(item)
                    mime, extension = image_type(data)
                    image_id = uuid.uuid4().hex
                    date = datetime.now(timezone.utc).strftime('%Y/%m/%d')
                    key = self.storage.key(f'images/{job["user_id"]}/{date}/{image_id}.{extension}')
                    self.store.stage(image_id, data)
                    with self.store.connect() as db:
                        db.execute('INSERT INTO images(id,job_id,user_id,object_key,mime,extension,bytes,sha256,state,created) VALUES(?,?,?,?,?,?,?,?,?,?)',
                                   (image_id, job_id, job['user_id'], key, mime, extension, len(data), hashlib.sha256(data).hexdigest(), 'staged', int(time.time())))
                    staged_ids.append(image_id)
                except Exception as error:
                    failures.append(error.message if isinstance(error, Problem) else '图片写入持久化队列失败，请检查服务器磁盘空间。')
            if len(items) != job['count']:
                failures.append(f'上游只返回 {len(items)} 张，期望 {job["count"]} 张；未自动补生成以避免额外计费。')
            with self.store.connect() as db:
                db.execute("UPDATE jobs SET status='uploading',error=? WHERE id=?", (' '.join(failures), job_id))
                db.execute("UPDATE images SET state='pending' WHERE job_id=? AND state='staged'", (job_id,))
            for image_id in staged_ids:
                self.upload_image(image_id)
            self.finalize_job(job_id)
        except Exception as error:
            message = error.message if isinstance(error, Problem) else '任务未完成，请检查服务器状态；未自动重复调用模型。'
            with self.store.connect() as db:
                db.execute("UPDATE jobs SET status='failed',error=? WHERE id=?", (message, job_id))
                db.execute("UPDATE images SET state='pending' WHERE job_id=? AND state='staged'", (job_id,))
        finally:
            self.dirty()

    def upload_image(self, image_id):
        # Serialize uploads and deletion for the same image so an in-flight
        # upload cannot recreate files after a successful deletion.
        with self.image_locks[int(image_id, 16) % len(self.image_locks)]:
            self._upload_image(image_id)

    def _upload_image(self, image_id):
        with self.store.connect() as db:
            changed = db.execute("UPDATE images SET state='uploading' WHERE id=? AND state='pending'", (image_id,)).rowcount
            record = db.execute('SELECT * FROM images WHERE id=?', (image_id,)).fetchone()
        if not changed:
            return
        try:
            data = self.store.pending_bytes(image_id)
            if hashlib.sha256(data).hexdigest() != record['sha256']:
                raise Problem(500, '待同步图片校验不一致，已停止上传。')
            self.storage.put(record['object_key'], data, record['mime'])
            with self.store.connect() as db:
                job = db.execute('SELECT * FROM jobs WHERE id=?', (record['job_id'],)).fetchone()
            manifest = {key: job[key] for key in ('id', 'user_id', 'prompt', 'model', 'size', 'quality', 'count', 'created')}
            manifest['image'] = {key: record[key] for key in ('id', 'object_key', 'mime', 'extension', 'bytes', 'sha256')}
            # The encrypted sidecar allows indexing recovery even if the latest
            # database backup predates the image. No API key is included.
            encrypted_manifest = self.store.cipher.encrypt(json.dumps(manifest, ensure_ascii=False).encode())
            self.storage.put(record['object_key'] + '.metadata.fernet', encrypted_manifest, 'application/octet-stream')
            with self.store.connect() as db:
                db.execute("UPDATE images SET state='saved',error='' WHERE id=?", (image_id,))
            (self.store.spool / (image_id + '.enc')).unlink(missing_ok=True)
        except Exception as error:
            message = error.message if isinstance(error, Problem) else '待同步图片暂时无法读取，请检查服务器存储。'
            with self.store.connect() as db:
                db.execute("UPDATE images SET state='pending',error=? WHERE id=?", (message, image_id))
        finally:
            self.finalize_job(record['job_id'])
            self.dirty()

    def delete_image(self, image_id):
        with self.image_locks[int(image_id, 16) % len(self.image_locks)]:
            with self.store.connect() as db:
                record = db.execute('SELECT * FROM images WHERE id=?', (image_id,)).fetchone()
                if not record or record['state'] == 'deleted':
                    return True
                db.execute("UPDATE images SET state='deleting',favorite=0,error='' WHERE id=?", (image_id,))
            try:
                # Delete the recovery sidecar first; reindex must not restore
                # a removed image. Missing files are safe to delete again.
                self.storage.delete(record['object_key'] + '.metadata.fernet')
                self.storage.delete(record['object_key'])
                (self.store.spool / (image_id + '.enc')).unlink(missing_ok=True)
                with self.store.connect() as db:
                    db.execute("UPDATE images SET state='deleted',error='' WHERE id=?", (image_id,))
                complete = True
            except Exception:
                with self.store.connect() as db:
                    db.execute("UPDATE images SET error=? WHERE id=?", ('图片已移除，存储文件等待自动清理。', image_id))
                complete = False
            self.finalize_job(record['job_id'])
            self.dirty()
            return complete

    def finalize_job(self, job_id):
        with self.store.connect() as db:
            job = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if job['status'] == 'generating':
                return
            images = db.execute('SELECT state FROM images WHERE job_id=?', (job_id,)).fetchall()
            if any(image['state'] not in ('saved', 'deleting', 'deleted') for image in images):
                state = 'uploading'
            elif len(images) == job['count'] and not job['error']:
                state = 'complete'
            else:
                state = 'partial' if images else 'failed'
            db.execute('UPDATE jobs SET status=? WHERE id=?', (state, job_id))

    def backup(self):
        if not self.store._backup_lock.acquire(blocking=False):
            return
        try:
            self.backup_due.clear()
            self.store.set_metadata('backup_attempt', int(time.time()))
            timestamp = datetime.now(timezone.utc).strftime('%Y/%m/%d/%H%M%S')
            key = self.storage.key(f'system/backups/{timestamp}-{secrets.token_hex(4)}.sqlite3.fernet')
            self.storage.put(key, self.store.backup_bytes(), 'application/octet-stream')
            self.store.set_metadata('last_backup', int(time.time()))
            self.store.set_metadata('backup_key', key)
            self.store.set_metadata('backup_error', '')
        except Exception:
            self.backup_due.set()
            self.store.set_metadata('backup_error', '最近一次加密备份失败，将自动重试。')
            raise Problem(502, '加密备份失败，请检查服务器存储和目录权限。')
        finally:
            self.store._backup_lock.release()

    def session(self, headers):
        jar = cookies.SimpleCookie()
        try:
            jar.load(headers.get('cookie', ''))
            # A shared cookie takes precedence even when stale: never silently
            # fall back to another account's legacy image-only login.
            token = jar[ACCOUNT_COOKIE].value if ACCOUNT_COOKIE in jar else (jar[COOKIE].value if COOKIE in jar else '')
        except cookies.CookieError:
            token = ''
        if not token:
            return None
        with self.store.connect() as db:
            return db.execute('SELECT users.*,sessions.csrf,sessions.hash AS session_hash,sessions.expires AS session_expires FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>?', (digest(token), int(time.time()))).fetchone()

    def set_cookie(self, value, age=SESSION_AGE):
        return f'{ACCOUNT_COOKIE}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}' + ('; Secure' if self.secure else '')

    def shared_cookie(self, headers, user):
        if not user:
            return {}
        jar = cookies.SimpleCookie()
        jar.load(headers.get('cookie', ''))
        if ACCOUNT_COOKIE in jar or COOKIE not in jar:
            return {}
        remaining = max(0, user['session_expires'] - int(time.time()))
        return {'Set-Cookie': self.set_cookie(jar[COOKIE].value, remaining)}

    def create_session(self, user_id):
        token, csrf = secrets.token_urlsafe(40), secrets.token_urlsafe(32)
        with self.store.connect() as db:
            db.execute('DELETE FROM sessions WHERE expires<?', (int(time.time()),))
            db.execute('INSERT INTO sessions VALUES(?,?,?,?)', (digest(token), user_id, csrf, int(time.time()) + SESSION_AGE))
        return csrf, {'Set-Cookie': self.set_cookie(token)}

    def invite(self, creator, role='member'):
        token = 'STRGO-' + secrets.token_urlsafe(24)
        expires = int(time.time()) + 7 * 24 * 3600
        with self.store.connect() as db:
            db.execute('INSERT INTO invites VALUES(?,?,?,?,?)', (digest(token), expires, None, creator, role))
        self.dirty()
        return {'code': token, 'expires': expires}

    def persist_user(self, user):
        record = {key: user[key] for key in ('id', 'username', 'password', 'role', 'created', 'updated')}
        encrypted = self.store.cipher.encrypt(json.dumps(record).encode())
        self.storage.put(self.storage.key(f'system/users/{user["id"]}.fernet'), encrypted, 'application/octet-stream')

    def user_info(self, user):
        return {'id': user['id'], 'username': user['username'], 'role': user['role']}

    def config_public(self, user_id):
        try:
            config = self.store.config(user_id)
            return {'endpoint': config['endpoint'], 'model': config['model'], 'hasKey': bool(config['apiKey'])}
        except Problem:
            return {'endpoint': '', 'model': '', 'hasKey': False}

    def generation_quota(self, user, db=None, now=None):
        if db is None:
            with self.store.connect() as connection:
                return self.generation_quota(user, connection, now)
        now = int(time.time()) if now is None else now
        start = (now + QUOTA_UTC_OFFSET) // 86400 * 86400 - QUOTA_UTC_OFFSET
        policy = db.execute("SELECT value FROM meta WHERE key='daily_image_limit'").fetchone()
        limit = int(policy['value']) if policy and policy['value'] else None
        used = db.execute('SELECT COALESCE(SUM(count),0) FROM jobs WHERE user_id=? AND created>=? AND created<?',
                          (user['id'], start, start + 86400)).fetchone()[0]
        exempt = user['role'] == 'admin'
        return {'dailyImageLimit': limit, 'used': used, 'remaining': None if exempt or limit is None else max(0, limit - used),
                'exempt': exempt, 'resetsAt': start + 86400, 'timezone': QUOTA_TIMEZONE}

    def job_public(self, job, db):
        if job['deleted']:
            raise Problem(410, '该任务记录已删除；如需重新生成，请创建新任务。')
        value = {key: job[key] for key in ('id', 'prompt', 'model', 'size', 'quality', 'count', 'status', 'error', 'created')}
        owner = db.execute('SELECT username FROM users WHERE id=?', (job['user_id'],)).fetchone()
        value['userId'] = job['user_id']
        value['username'] = owner['username']
        value['hasReference'] = bool(job['has_reference'])
        value['images'] = []
        for row in db.execute("SELECT * FROM images WHERE job_id=? AND user_id=? AND state NOT IN ('deleting','deleted') ORDER BY created,id", (job['id'], job['user_id'])):
            value['images'].append({
                'id': row['id'], 'state': row['state'], 'mime': row['mime'], 'bytes': row['bytes'],
                'favorite': bool(row['favorite']), 'error': row['error'],
                'url': f'{API}/assets/{row["id"]}',
                'downloadUrl': f'{API}/assets/{row["id"]}?download=1',
            })
        return value

    def dispatch(self, method, target, payload=None, headers=None, ip='local'):
        headers = {key.lower(): value for key, value in (headers or {}).items()}
        payload = payload if payload is not None else {}
        if not isinstance(payload, dict):
            raise Problem(400, '请求内容应为 JSON 对象。')
        url = urlsplit(target)
        path, query = url.path, parse_qs(url.query)
        if not path.startswith(API + '/'):
            raise Problem(404, '接口不存在。')
        if method not in ('GET', 'POST', 'PUT', 'DELETE'):
            raise Problem(405, '不支持该请求方法。')
        if method != 'GET' and headers.get('origin') != self.origin:
            raise Problem(403, '请求来源无效，请从本站打开工作台。')
        user = self.session(headers)
        if path == API + '/terminal-session' and method == 'GET':
            if not user:
                raise Problem(401, '请使用 AI 生图的账号登录。')
            return 200, {'user': self.user_info(user), 'csrf': user['csrf'],
                         'expires': user['session_expires'], 'maxWindows': 8}, self.shared_cookie(headers, user)
        if path == API + '/session' and method == 'GET':
            return 200, {'user': self.user_info(user) if user else None, 'csrf': user['csrf'] if user else None,
                         'config': self.config_public(user['id']) if user else None,
                         'generationQuota': self.generation_quota(user) if user else None,
                         'storageReady': self.storage.ready,
                         'storage': {'kind': getattr(self.storage, 'kind', 'local'), 'label': getattr(self.storage, 'label', 'ECS 硬盘')},
                         'backup': ({'last': self.store.metadata('last_backup'), 'error': self.store.metadata('backup_error')} if user else None)}, self.shared_cookie(headers, user)
        if path in (API + '/login', API + '/register') and method == 'POST':
            self.store.rate_limit('auth-ip:' + digest(ip), 15, 900)
            username, password = payload.get('username'), payload.get('password')
            if not isinstance(username, str) or not re.fullmatch(r'[A-Za-z0-9_-]{3,32}', username):
                raise Problem(400, '用户名需为 3–32 位字母、数字、下划线或连字符。')
            username = username.lower()
            self.store.rate_limit('auth-user:' + username, 15, 900)
            if path.endswith('/register'):
                invite = payload.get('invite', '')
                if not isinstance(invite, str) or len(invite) > 100:
                    raise Problem(400, '邀请码无效或已使用。')
                hashed = password_hash(password)
                user_id = uuid.uuid4().hex
                with self.store.connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    invitation = db.execute('SELECT * FROM invites WHERE hash=? AND used_by IS NULL AND expires>?', (digest(invite.strip()), int(time.time()))).fetchone()
                    if not invitation:
                        raise Problem(400, '邀请码无效、已使用或已过期。')
                    if invitation['role'] == 'admin' and db.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
                        raise Problem(400, '管理员引导邀请码已失效。')
                    if db.execute('SELECT 1 FROM users WHERE username=?', (username,)).fetchone():
                        raise Problem(409, '该用户名不可用。')
                    now = int(time.time())
                    db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (user_id, username, hashed, invitation['role'], now, now))
                    db.execute('UPDATE invites SET used_by=? WHERE hash=?', (user_id, digest(invite.strip())))
                    user = db.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
                    self.persist_user(user)
            else:
                with self.store.connect() as db:
                    user = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
                matched = password_matches(password, user['password'] if user else self.dummy_hash)
                if not user or not matched:
                    raise Problem(401, '用户名或密码错误。')
            csrf, cookie = self.create_session(user['id'])
            self.dirty()
            return 200, {'user': self.user_info(user), 'csrf': csrf}, cookie
        if not user:
            raise Problem(401, '请先登录。')
        if method != 'GET' and not secrets.compare_digest(headers.get('x-csrf-token', ''), user['csrf']):
            raise Problem(403, '登录校验失效，请刷新页面后重试。')
        if path.startswith(API + '/forum/'):
            return forum.dispatch(self, method, path, query, payload, user)
        if path == API + '/generation-quota' and method == 'GET':
            return 200, self.generation_quota(user), {}
        if path == API + '/generation-policy' and method == 'PUT':
            if user['role'] != 'admin':
                raise Problem(403, '仅管理员可设置每日生成额度。')
            limit = payload.get('dailyImageLimit')
            if 'dailyImageLimit' not in payload or (limit is not None and (type(limit) is not int or not 0 <= limit <= MAX_DAILY_IMAGES)):
                raise Problem(400, '每日额度需为 0–100000 的整数，或使用 null 表示不限制。')
            self.store.set_metadata('daily_image_limit', '' if limit is None else limit)
            self.dirty()
            return 200, self.generation_quota(user), {}
        if path == API + '/logout' and method == 'POST':
            with self.store.connect() as db:
                db.execute('DELETE FROM sessions WHERE hash=?', (user['session_hash'],))
            return 200, {'ok': True}, {'Set-Cookie': self.set_cookie('', 0)}
        if path == API + '/password' and method == 'PUT':
            self.store.rate_limit('password:' + user['id'], 5, 900)
            if not password_matches(payload.get('oldPassword'), user['password']):
                raise Problem(400, '当前密码不正确。')
            hashed = password_hash(payload.get('newPassword'))
            updated = dict(user)
            updated['password'] = hashed
            updated['updated'] = max(int(time.time()), int(user['updated']) + 1)
            self.persist_user(updated)
            with self.store.connect() as db:
                db.execute('UPDATE users SET password=?,updated=? WHERE id=?', (hashed, updated['updated'], user['id']))
                db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
            csrf, cookie = self.create_session(user['id'])
            self.dirty()
            return 200, {'ok': True, 'csrf': csrf}, cookie
        if path == API + '/config' and method == 'PUT':
            endpoint = validate_endpoint(payload.get('endpoint'))
            model = payload.get('model')
            if not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9_./:@+-]{1,120}', model):
                raise Problem(400, '模型标识格式不正确。')
            key = payload.get('apiKey')
            if not key:
                old = self.store.config(user['id'])
                if old['endpoint'] != endpoint:
                    raise Problem(400, '更换服务地址时需要重新输入密钥。')
                key = old['apiKey']
            if not isinstance(key, str) or not 8 <= len(key) <= 500 or any(ord(c) < 33 or ord(c) > 126 for c in key):
                raise Problem(400, 'API 密钥格式不正确。')
            encrypted = self.store.cipher.encrypt(json.dumps({'endpoint': endpoint, 'model': model, 'apiKey': key}).encode())
            # Save an encrypted configuration file independently of SQLite.
            config_object = self.storage.key(f'system/configs/{user["id"]}.fernet')
            self.storage.put(config_object, encrypted, 'application/octet-stream')
            with self.store.connect() as db:
                db.execute('INSERT INTO configs VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted=excluded.encrypted', (user['id'], encrypted))
            self.dirty()
            return 200, self.config_public(user['id']), {}
        preset_match = re.fullmatch(API + r'/preset-inspirations/([a-f0-9]{32})', path)
        if path == API + '/preset-inspirations' or preset_match:
            if method != 'GET' and user['role'] != 'admin':
                raise Problem(403, '仅管理员可管理预装灵感。')
            if method == 'GET':
                with self.store.connect() as db:
                    if preset_match:
                        row = db.execute('SELECT * FROM preset_inspirations WHERE id=?', (preset_match[1],)).fetchone()
                        if not row:
                            raise Problem(404, '预装灵感不存在。')
                        return 200, preset_public(row), {}
                    search = query.get('search', [''])[0][:300]
                    rows = db.execute("SELECT * FROM preset_inspirations WHERE instr(lower(title || ' ' || description || ' ' || prompt),lower(?))>0 ORDER BY sort_order,created,id", (search,)).fetchall()
                return 200, {'presets': [preset_public(row) for row in rows]}, {}
            if (not preset_match and method == 'POST') or (preset_match and method == 'PUT'):
                title, description, prompt = payload.get('title'), payload.get('description', ''), payload.get('prompt')
                sort_order = payload.get('sortOrder', 0)
                if not isinstance(title, str) or not title.strip() or len(title) > 80:
                    raise Problem(400, '灵感名称不能为空，最多 80 字。')
                if not isinstance(description, str) or len(description) > 200:
                    raise Problem(400, '灵感简介最多 200 字。')
                if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 8000:
                    raise Problem(400, '提示词不能为空，最多 8000 字。')
                if type(sort_order) is not int or not 0 <= sort_order <= 100000:
                    raise Problem(400, '排序值需为 0–100000 的整数。')
                self.store.rate_limit('presets:' + user['id'], 100, 3600)
                with self.store.connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    now = int(time.time())
                    if preset_match:
                        existing = db.execute('SELECT * FROM preset_inspirations WHERE id=?', (preset_match[1],)).fetchone()
                        if not existing:
                            raise Problem(404, '预装灵感不存在。')
                        if payload.get('updated') != existing['updated'] or type(payload.get('updated')) is not int:
                            raise Problem(409, '这条灵感已被更新，请刷新后重新编辑。')
                        preset_id = existing['id']
                        db.execute('UPDATE preset_inspirations SET title=?,description=?,prompt=?,sort_order=?,updated=? WHERE id=?',
                                   (title.strip(), description.strip(), prompt.strip(), sort_order, max(now, existing['updated'] + 1), preset_id))
                    else:
                        preset_id = uuid.uuid4().hex
                        db.execute('INSERT INTO preset_inspirations VALUES(?,?,?,?,?,?,?)',
                                   (preset_id, title.strip(), description.strip(), prompt.strip(), sort_order, now, now))
                    row = db.execute('SELECT * FROM preset_inspirations WHERE id=?', (preset_id,)).fetchone()
                self.dirty()
                return (200 if preset_match else 201), preset_public(row), {}
            if preset_match and method == 'DELETE':
                with self.store.connect() as db:
                    deleted = db.execute('DELETE FROM preset_inspirations WHERE id=?', (preset_match[1],)).rowcount
                if not deleted:
                    raise Problem(404, '预装灵感不存在。')
                self.dirty()
                return 200, {'ok': True}, {}
            raise Problem(405, '不支持该请求方法。')
        if path == API + '/inspirations' and method == 'GET':
            try:
                offset = max(0, min(int(query.get('offset', ['0'])[0]), 100000))
            except ValueError:
                raise Problem(400, '分页参数无效。')
            with self.store.connect() as db:
                rows = db.execute('SELECT * FROM inspirations WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 51 OFFSET ?', (user['id'], offset)).fetchall()
            values = [{key: row[key] for key in ('id', 'title', 'prompt', 'size', 'quality', 'count', 'created')} for row in rows[:50]]
            return 200, {'inspirations': values, 'hasMore': len(rows) > 50}, {}
        if path == API + '/inspirations' and method == 'POST':
            prompt = payload.get('prompt')
            size = payload.get('size')
            quality = payload.get('quality', '')
            count = payload.get('count', 1)
            title = payload.get('title', '')
            if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 8000:
                raise Problem(400, '灵感描述不能为空，最多 8000 字。')
            if not valid_size(size) or quality not in QUALITIES or type(count) is not int or count not in (1, 2, 4):
                raise Problem(400, '灵感参数无效。')
            if not isinstance(title, str) or len(title) > 80:
                raise Problem(400, '灵感名称最多 80 字。')
            self.store.rate_limit('inspiration:' + user['id'], 100, 3600)
            inspiration_id = uuid.uuid4().hex
            created = int(time.time())
            title = title.strip() or prompt.strip().splitlines()[0][:80]
            with self.store.connect() as db:
                db.execute('INSERT INTO inspirations VALUES(?,?,?,?,?,?,?,?)', (inspiration_id, user['id'], title, prompt.strip(), size, quality, count, created))
                row = db.execute('SELECT * FROM inspirations WHERE id=?', (inspiration_id,)).fetchone()
            self.dirty()
            return 201, {key: row[key] for key in ('id', 'title', 'prompt', 'size', 'quality', 'count', 'created')}, {}
        inspiration_match = re.fullmatch(API + r'/inspirations/([a-f0-9]{32})', path)
        if inspiration_match and method == 'DELETE':
            with self.store.connect() as db:
                deleted = db.execute('DELETE FROM inspirations WHERE id=? AND user_id=?', (inspiration_match[1], user['id'])).rowcount
            if not deleted:
                raise Problem(404, '灵感不存在。')
            self.dirty()
            return 200, {'ok': True}, {}
        if path == API + '/jobs' and method == 'POST':
            prompt, size, quality, count = payload.get('prompt'), payload.get('size'), payload.get('quality', ''), payload.get('count', 1)
            request_id = payload.get('requestId', '')
            reference = payload.get('referenceImage')
            if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 8000:
                raise Problem(400, '画面描述不能为空，最多 8000 字。')
            if not valid_size(size) or quality not in QUALITIES or type(count) is not int or count not in (1, 2, 4):
                raise Problem(400, '图片参数无效。')
            reference_bytes = None
            if reference is not None:
                if not isinstance(reference, dict) or reference.get('mime') not in ('image/png', 'image/jpeg', 'image/webp') or not isinstance(reference.get('data'), str) or len(reference['data']) > REFERENCE_MAX_ENCODED:
                    raise Problem(400, '参考图需先在工作台压缩至 2 MB 内再上传。')
                try:
                    reference_bytes = base64.b64decode(reference['data'], validate=True)
                except (ValueError, TypeError):
                    raise Problem(400, '参考图编码无效，请重新选择图片。')
                try:
                    actual_mime, _ = image_type(reference_bytes)
                except Problem:
                    raise Problem(400, '参考图内容无效，请选择有效的 PNG、JPEG 或 WebP 图片。')
                if actual_mime != reference['mime'] or len(reference_bytes) > REFERENCE_MAX_BYTES:
                    raise Problem(400, '压缩后的参考图格式无效或超过 2 MB，请重新选择图片。')
            if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', request_id):
                raise Problem(400, '缺少有效的请求编号。')
            with self.store.connect() as db:
                previous = db.execute('SELECT * FROM jobs WHERE user_id=? AND request_id=?', (user['id'], request_id)).fetchone()
                if previous:
                    return 200, self.job_public(previous, db), {}
            if not self.storage.ready:
                raise Problem(503, '服务器存储尚未就绪，暂不能生成图片。')
            config = self.store.config(user['id'])
            self.store.rate_limit('generate:' + user['id'], 20, 3600)
            job_id = uuid.uuid4().hex
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                previous = db.execute('SELECT * FROM jobs WHERE user_id=? AND request_id=?', (user['id'], request_id)).fetchone()
                if previous:
                    return 200, self.job_public(previous, db), {}
                if db.execute("SELECT COUNT(*) FROM jobs WHERE user_id=? AND status IN ('queued','generating','uploading')", (user['id'],)).fetchone()[0] >= 2:
                    raise Problem(429, '已有任务正在进行，请等待完成或先同步待保存的图片。')
                now = int(time.time())
                quota = self.generation_quota(user, db, now)
                if quota['remaining'] is not None and count > quota['remaining']:
                    raise Problem(429, f'今日生成额度不足，剩余 {quota["remaining"]} 张，本次需要 {count} 张；北京时间零点重置。')
                encrypted_config = self.store.cipher.encrypt(json.dumps(config).encode())
                encrypted_reference = self.store.cipher.encrypt(reference_bytes) if reference_bytes else None
                db.execute('INSERT INTO jobs(id,user_id,prompt,model,size,quality,count,status,created,request_id,provider_config,has_reference,reference_image) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', (job_id, user['id'], prompt.strip(), config['model'], size, quality, count, 'queued', now, request_id, encrypted_config, int(bool(reference_bytes)), encrypted_reference))
                result = self.job_public(db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone(), db)
                result['generationQuota'] = self.generation_quota(user, db, now)
            self.dirty()
            return 202, result, {}
        if path == API + '/jobs' and method == 'GET':
            try:
                offset = max(0, min(int(query.get('offset', ['0'])[0]), 100000))
            except ValueError:
                raise Problem(400, '分页参数无效。')
            search = query.get('search', [''])[0][:300]
            favorite = query.get('favorite') == ['true']
            all_users = query.get('scope') == ['all']
            if all_users and user['role'] != 'admin':
                raise Problem(403, '仅管理员可查看全部成员作品。')
            where = "deleted=0 AND instr(lower(prompt),lower(?))>0"
            parameters = [search]
            if not all_users:
                where += ' AND user_id=?'
                parameters.append(user['id'])
            where += " AND (status IN ('queued','generating') OR NOT EXISTS(SELECT 1 FROM images WHERE images.job_id=jobs.id) OR EXISTS(SELECT 1 FROM images WHERE images.job_id=jobs.id AND images.state NOT IN ('deleting','deleted')))"
            if favorite:
                where += " AND EXISTS(SELECT 1 FROM images WHERE images.job_id=jobs.id AND images.favorite=1 AND images.state NOT IN ('deleting','deleted'))"
            with self.store.connect() as db:
                rows = db.execute('SELECT * FROM jobs WHERE ' + where + ' ORDER BY created DESC,id DESC LIMIT 21 OFFSET ?', (*parameters, offset)).fetchall()
                values = [self.job_public(job, db) for job in rows[:20]]
            return 200, {'jobs': values, 'hasMore': len(rows) > 20}, {}
        match = re.fullmatch(API + r'/jobs/([a-f0-9]{32})', path)
        if match and method == 'DELETE':
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                owner_filter = '' if user['role'] == 'admin' else ' AND user_id=?'
                row = db.execute('SELECT * FROM jobs WHERE id=?' + owner_filter,
                                 (match[1],) if user['role'] == 'admin' else (match[1], user['id'])).fetchone()
                if not row:
                    raise Problem(404, '任务不存在。')
                if not row['deleted']:
                    images = db.execute("SELECT 1 FROM images WHERE job_id=? AND state NOT IN ('deleting','deleted') LIMIT 1", (row['id'],)).fetchone()
                    if row['status'] != 'failed' or images:
                        raise Problem(409, '仅可删除已失败且没有图片的任务记录；已有作品请使用图片删除按钮。')
                    # Retain submission identifiers and counts so deletion
                    # cannot refund quota or repeat a paid model call.
                    db.execute('UPDATE jobs SET deleted=1,reference_image=NULL WHERE id=?', (row['id'],))
            self.dirty()
            return 200, {'deleted': True}, {}
        if match and method == 'GET':
            with self.store.connect() as db:
                row = db.execute('SELECT * FROM jobs WHERE id=? AND user_id=? AND deleted=0', (match[1], user['id'])).fetchone()
                if not row:
                    raise Problem(404, '任务不存在。')
                return 200, self.job_public(row, db), {}
        match = re.fullmatch(API + r'/(?:assets|images)/([a-f0-9]{32})(/retry|/favorite)?', path)
        if match:
            with self.store.connect() as db:
                # Administrators may inspect and delete all images, while
                # account-specific favorites and storage retries remain private.
                admin_access = user['role'] == 'admin' and not match[2] and ((method == 'DELETE' and path.startswith(API + '/images/')) or (method == 'GET' and path.startswith(API + '/assets/')))
                record = db.execute('SELECT * FROM images WHERE id=?' + ('' if admin_access else ' AND user_id=?'),
                                    (match[1],) if admin_access else (match[1], user['id'])).fetchone()
            if not record:
                raise Problem(404, '图片不存在。')
            if not match[2] and method == 'DELETE' and path.startswith(API + '/images/'):
                complete = self.delete_image(record['id'])
                return (200 if complete else 202), {'deleted': True, 'cleanupPending': not complete}, {}
            if record['state'] in ('deleting', 'deleted'):
                raise Problem(404, '图片不存在。')
            if match[2] == '/retry' and method == 'POST':
                self.store.rate_limit('retry:' + user['id'], 30, 900)
                self._submit('image:' + record['id'], self.upload_image, record['id'])
                return 202, {'ok': True}, {}
            if match[2] == '/favorite' and method == 'PUT':
                if type(payload.get('favorite')) is not bool:
                    raise Problem(400, '收藏参数无效。')
                with self.store.connect() as db:
                    db.execute('UPDATE images SET favorite=? WHERE id=? AND user_id=?', (int(payload['favorite']), record['id'], user['id']))
                self.dirty()
                return 200, {'favorite': payload['favorite']}, {}
            if not match[2] and method == 'GET' and path.startswith(API + '/assets/'):
                data = self.storage.get(record['object_key']) if record['state'] == 'saved' else self.store.pending_bytes(record['id'])
                if hashlib.sha256(data).hexdigest() != record['sha256']:
                    raise Problem(502, '图片内容校验失败，请联系管理员检查原文件或恢复备份。')
                disposition = ('attachment' if query.get('download') == ['1'] else 'inline') + f'; filename="strgo-{record["id"]}.{record["extension"]}"'
                return 200, data, {'Content-Type': record['mime'], 'Content-Disposition': disposition}
        if path == API + '/invites' and method == 'POST':
            if user['role'] != 'admin':
                raise Problem(403, '仅管理员可创建邀请码。')
            self.store.rate_limit('invite:' + user['id'], 20, 86400)
            return 201, self.invite(user['id']), {}
        if path == API + '/backup' and method == 'POST':
            if user['role'] != 'admin':
                raise Problem(403, '仅管理员可触发备份。')
            self.store.rate_limit('backup:' + user['id'], 5, 3600)
            self.backup()
            return 200, {'last': self.store.metadata('last_backup')}, {}
        raise Problem(404, '接口不存在。')


class HTTPHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, format, *args):
        # No URLs, request bodies, cookies, account names or secrets in logs.
        return

    def do_GET(self):
        self.handle_request('GET')

    def do_POST(self):
        self.handle_request('POST')

    def do_PUT(self):
        self.handle_request('PUT')

    def do_DELETE(self):
        self.handle_request('DELETE')

    def handle_request(self, method):
        try:
            payload = None
            if method != 'GET':
                if self.headers.get('Transfer-Encoding'):
                    raise Problem(400, '不支持分块请求。')
                if self.headers.get_content_type() != 'application/json':
                    raise Problem(415, '请使用 JSON 请求。')
                try:
                    length = int(self.headers.get('Content-Length', '-1'))
                except ValueError:
                    length = -1
                if not 0 <= length <= 7 * 1024 * 1024:
                    raise Problem(413, '请求体无效或超过 7 MiB。')
                self.connection.settimeout(20)
                payload = json.loads(self.rfile.read(length) or b'{}')
            peer = self.client_address[0]
            ip = self.headers.get('X-Real-IP', peer) if peer in ('127.0.0.1', '::1') else peer
            status, result, extra = self.server.service.dispatch(method, self.path, payload, dict(self.headers), ip)
        except Problem as error:
            status, result, extra = error.status, {'error': error.message}, {}
        except (ValueError, UnicodeError):
            status, result, extra = 400, {'error': '请求格式不正确。'}, {}
        except Exception:
            LOGGER.error('请求处理失败；敏感请求内容未记录。')
            status, result, extra = 500, {'error': '服务暂时不可用，请稍后重试。'}, {}
        body = result if isinstance(result, bytes) else json.dumps(result, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', extra.pop('Content-Type', 'application/json; charset=utf-8'))
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'private, no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('X-Frame-Options', 'DENY')
        for key, value in extra.items():
            self.send_header(key, value)
            if key.lower() == 'set-cookie':
                # Clear the old path-scoped cookie on login, migration and
                # logout so switching accounts cannot resurrect a legacy login.
                self.send_header('Set-Cookie', f'{COOKIE}=; Path=/api/image/; HttpOnly; SameSite=Strict; Max-Age=0' + ('; Secure' if self.server.service.secure else ''))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(body)
        except OSError:
            pass


def main():
    os.umask(0o077)
    logging.basicConfig(level=logging.INFO)
    store = Store(os.environ.get('IMAGE_DATA_DIR', '/var/lib/strgo-image'), encryption_key())
    service = Service(store)
    server = ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('IMAGE_PORT', '8092'))), HTTPHandler)
    server.daemon_threads = True
    server.service = service
    def shutdown(signum, frame):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    LOGGER.info('图片服务已启动，仅监听 127.0.0.1。')
    try:
        server.serve_forever()
    finally:
        server.server_close()
        service.close()


if __name__ == '__main__':
    main()
