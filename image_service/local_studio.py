"""Administrator-only local ComfyUI jobs, isolated from the paid image queue."""
import base64
import hashlib
import json
import os
import re
import secrets
import time
from urllib.parse import urlsplit
import uuid

from .security import Problem, digest, image_type

PREFIX = '/api/image/local-studio'
COOKIE = 'strgo_workflow_session'
CHUNK = 1024 * 1024
MAX_FILE = 200 * CHUNK
LEASE = 180
SCHEMA = '''
CREATE TABLE IF NOT EXISTS local_jobs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
 workflow TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL, prompt TEXT NOT NULL,
 reference BLOB, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
 claim TEXT NOT NULL DEFAULT '', expires INTEGER NOT NULL DEFAULT 0,
 object_key TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL DEFAULT '', bytes INTEGER NOT NULL DEFAULT 0,
 sha256 TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL,
 UNIQUE(user_id,request_id));
CREATE TABLE IF NOT EXISTS local_chunks (
 job_id TEXT NOT NULL REFERENCES local_jobs(id) ON DELETE CASCADE, part INTEGER NOT NULL,
 encrypted BLOB NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
 PRIMARY KEY(job_id,part));
'''


def origin(service):
    value = os.environ.get('LOCAL_STUDIO_ORIGIN', 'https://workflow.strgo.com')
    parsed = urlsplit(value)
    local = os.environ.get('IMAGE_ENV') == 'development' and parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')
    if (not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
            or not (parsed.scheme == 'https' or local)):
        raise Problem(503, '本地创作台站点源配置无效。')
    return value


def cookie(service, token, age=604800):
    return f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}' + ('; Secure' if origin(service).startswith('https:') else '')


def session(service, headers):
    # Do not accept the main site's cookie on this independent login surface.
    return service.session(headers, cookie_names=(COOKIE,))


def capabilities(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 20:
        raise Problem(400, '连接程序需提供 1–20 个工作流。')
    result = []
    for item in value:
        if (not isinstance(item, dict) or not isinstance(item.get('id'), str)
                or not re.fullmatch(r'[a-z0-9-]{1,80}', item['id'])
                or item.get('kind') not in ('image', 'video')
                or not isinstance(item.get('label'), str) or not 1 <= len(item['label']) <= 100
                or not isinstance(item.get('description', ''), str) or len(item.get('description', '')) > 300
                or type(item.get('reference', False)) is not bool):
            raise Problem(400, '工作流说明无效。')
        result.append({key: item.get(key, False if key == 'reference' else '') for key in ('id', 'label', 'description', 'kind', 'reference')})
    if len({item['id'] for item in result}) != len(result):
        raise Problem(400, '工作流标识重复。')
    return result


def status(service):
    registry = json.loads(service.store.metadata('local_studio_worker', '{}'))
    enabled = len(os.environ.get('LOCAL_STUDIO_WORKER_TOKEN', '')) >= 32
    return {'enabled': enabled, 'online': enabled and time.time() - registry.get('seen', 0) < 90,
            'lastSeen': registry.get('seen'), 'workflows': registry.get('workflows', []) if enabled else []}


def expire(service, db):
    now = int(time.time())
    db.execute("UPDATE local_jobs SET status='failed',error=?,reference=NULL,updated=? WHERE (status='running' AND expires<?) OR (status='queued' AND created<?)",
               ('本机连接已中断或等待超时；任务未自动重新生成，请检查本机执行记录。', now, now, now - 600))
    db.execute("DELETE FROM local_chunks WHERE job_id IN (SELECT id FROM local_jobs WHERE status='failed')")


def public(job):
    return {**{key: job[key] for key in ('id', 'workflow', 'label', 'kind', 'prompt', 'status', 'error', 'created', 'updated', 'bytes')},
            'url': PREFIX + '/jobs/' + job['id'] + '/asset' if job['status'] == 'complete' else None}


def media_type(data, kind):
    if kind == 'image':
        return image_type(data)
    if len(data) >= 12 and data[4:8] == b'ftyp':
        return 'video/mp4', 'mp4'
    if data.startswith(b'\x1aE\xdf\xa3'):
        return 'video/webm', 'webm'
    raise Problem(400, '视频结果需为 MP4 或 WebM。')


def worker(service, method, path, payload, headers):
    expected = os.environ.get('LOCAL_STUDIO_WORKER_TOKEN', '')
    if len(expected) < 32:
        raise Problem(503, '管理员尚未配置本机连接密钥。')
    if headers.get('origin') or not secrets.compare_digest(headers.get('authorization', ''), 'Bearer ' + expected):
        raise Problem(401, '本机连接认证失败。')
    if method != 'POST':
        raise Problem(405, '连接接口仅接受 POST。')
    now = int(time.time())
    if path == '/worker/poll':
        workflows = capabilities(payload.get('workflows'))
        service.store.set_metadata('local_studio_worker', json.dumps({'seen': now, 'workflows': workflows}, ensure_ascii=False))
        with service.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            expire(service, db)
            if db.execute("SELECT 1 FROM local_jobs WHERE status='running'").fetchone():
                return 200, {'job': None}, {}
            ids = [item['id'] for item in workflows]
            job = db.execute("SELECT * FROM local_jobs WHERE status='queued' AND workflow IN (" + ','.join('?' for _ in ids) + ') ORDER BY created,id LIMIT 1', ids).fetchone()
            if not job:
                return 200, {'job': None}, {}
            claim = secrets.token_urlsafe(32)
            db.execute("UPDATE local_jobs SET status='running',claim=?,expires=?,updated=? WHERE id=?", (digest(claim), now + LEASE, now, job['id']))
            reference = base64.b64encode(service.store.cipher.decrypt(job['reference'])).decode() if job['reference'] else None
        service.dirty()
        return 200, {'job': {'id': job['id'], 'workflow': job['workflow'], 'prompt': job['prompt'], 'claim': claim, 'reference': reference}}, {}
    match = re.fullmatch(r'/worker/jobs/([a-f0-9]{32})/(heartbeat|chunk|complete|fail)', path)
    if not match:
        raise Problem(404, '连接接口不存在。')
    job_id, action = match.groups()
    claim = payload.get('claim')
    if not isinstance(claim, str) or len(claim) > 100:
        raise Problem(401, '任务凭据无效。')
    # The SQLite write transaction serializes chunk, completion and deletion.
    with service.store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        job = db.execute('SELECT * FROM local_jobs WHERE id=?', (job_id,)).fetchone()
        if not job or not job['claim'] or not secrets.compare_digest(job['claim'], digest(claim)):
            raise Problem(409, '任务凭据失效。')
        if action in ('complete', 'heartbeat') and job['status'] == 'complete':
            return 200, {'ok': True, 'complete': True}, {}
        if job['status'] != 'running' or job['expires'] < now:
            raise Problem(409, '任务已结束或连接超时，未重新生成。')
        db.execute('UPDATE local_jobs SET expires=?,updated=? WHERE id=?', (now + LEASE, now, job_id))
        registry = json.loads(service.store.metadata('local_studio_worker', '{}'))
        registry['seen'] = now
        db.execute("INSERT INTO meta VALUES('local_studio_worker',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(registry, ensure_ascii=False),))
        if action == 'heartbeat':
            return 200, {'ok': True}, {}
        if action == 'fail':
            # Never reflect ComfyUI exceptions, local paths or graph values.
            db.execute("UPDATE local_jobs SET status='failed',error=?,reference=NULL WHERE id=?", ('本机工作流执行失败，请查看本机连接程序的状态文件。', job_id))
            db.execute('DELETE FROM local_chunks WHERE job_id=?', (job_id,))
        elif action == 'chunk':
            part, encoded = payload.get('part'), payload.get('data')
            if type(part) is not int or not 0 <= part < 200 or not isinstance(encoded, str) or len(encoded) > 4 * ((CHUNK + 2) // 3):
                raise Problem(400, '结果分片无效。')
            try:
                data = base64.b64decode(encoded, validate=True)
            except ValueError:
                raise Problem(400, '结果分片编码无效。')
            if not 1 <= len(data) <= CHUNK:
                raise Problem(413, '结果分片需为 1 字节至 1 MiB。')
            sha = hashlib.sha256(data).hexdigest()
            old = db.execute('SELECT sha256 FROM local_chunks WHERE job_id=? AND part=?', (job_id, part)).fetchone()
            if old and old['sha256'] != sha:
                raise Problem(409, '同一分片内容不一致。')
            if not old:
                db.execute('INSERT INTO local_chunks VALUES(?,?,?,?,?)', (job_id, part, service.store.cipher.encrypt(data), sha, len(data)))
        else:
            parts, sha = payload.get('parts'), payload.get('sha256')
            if type(parts) is not int or not 1 <= parts <= 200 or not isinstance(sha, str) or not re.fullmatch(r'[a-f0-9]{64}', sha):
                raise Problem(400, '结果清单无效。')
            rows = db.execute('SELECT * FROM local_chunks WHERE job_id=? ORDER BY part', (job_id,)).fetchall()
            if [row['part'] for row in rows] != list(range(parts)):
                raise Problem(409, '结果分片尚未全部收到。')
            data = b''.join(service.store.cipher.decrypt(row['encrypted']) for row in rows)
            if hashlib.sha256(data).hexdigest() != sha:
                raise Problem(400, '结果校验失败。')
            mime, extension = media_type(data, job['kind'])
            key = service.storage.key(f'local-studio/{job["user_id"]}/{job_id}.{extension}')
            service.storage.put(key, data, mime)
            db.execute("UPDATE local_jobs SET status='complete',reference=NULL,object_key=?,mime=?,bytes=?,sha256=? WHERE id=?", (key, mime, len(data), sha, job_id))
            db.execute('DELETE FROM local_chunks WHERE job_id=?', (job_id,))
    service.dirty()
    return 200, {'ok': True}, {}


def dispatch(service, method, path, query, payload, headers, ip):
    path = path[len(PREFIX):]
    if path.startswith('/worker/'):
        return worker(service, method, path, payload, headers)
    if method != 'GET' and headers.get('origin') != origin(service):
        raise Problem(403, '请从本地创作台站点操作。')
    user = session(service, headers)
    if path == '/login' and method == 'POST':
        service.store.rate_limit('local-auth-ip:' + digest(ip), 15, 900)
        username = payload.get('username', '')
        if not isinstance(username, str) or not re.fullmatch(r'[A-Za-z0-9_-]{3,32}', username):
            raise Problem(400, '用户名格式无效。')
        service.store.rate_limit('local-auth-user:' + username.lower(), 15, 900)
        record = service.authenticate(username, payload.get('password'))
        if record['role'] != 'admin':
            raise Problem(403, '仅管理员可登录本地创作台。')
        csrf, extra = service.create_session(record['id'], cookie_factory=lambda token: cookie(service, token))
        return 200, {'user': service.user_info(record), 'csrf': csrf}, extra
    if user and user['role'] != 'admin':
        raise Problem(403, '仅管理员可使用本地创作台。')
    if path == '/session' and method == 'GET':
        return 200, {'user': service.user_info(user) if user else None, 'csrf': user['csrf'] if user else None}, {}
    if not user:
        raise Problem(401, '请先以管理员身份登录。')
    if method != 'GET' and not secrets.compare_digest(headers.get('x-csrf-token', ''), user['csrf']):
        raise Problem(403, '登录校验失效，请刷新页面。')
    if path == '/logout' and method == 'POST':
        with service.store.connect() as db:
            db.execute('DELETE FROM sessions WHERE hash=?', (user['session_hash'],))
        return 200, {'ok': True}, {'Set-Cookie': cookie(service, '', 0)}
    if path == '/status' and method == 'GET':
        return 200, status(service), {}
    if path == '/jobs' and method == 'POST':
        prompt, workflow, request_id = payload.get('prompt'), payload.get('workflow'), payload.get('requestId')
        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 12000:
            raise Problem(400, '提示词不能为空，最多 12000 字。')
        if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', request_id):
            raise Problem(400, '请求编号无效。')
        with service.store.connect() as db:
            old = db.execute('SELECT * FROM local_jobs WHERE user_id=? AND request_id=?', (user['id'], request_id)).fetchone()
            if old:
                return 200, public(old), {}
        info = status(service)
        selected = next((item for item in info['workflows'] if item['id'] == workflow), None)
        if not info['online'] or not selected:
            raise Problem(409, '本机尚未连接或工作流不可用。')
        reference = payload.get('reference')
        data = None
        if selected['reference']:
            if not isinstance(reference, str) or len(reference) > 2_666_668:
                raise Problem(400, '该工作流需要一张 2 MB 内的参考图。')
            try:
                data = base64.b64decode(reference, validate=True)
                image_type(data)
            except (ValueError, Problem):
                raise Problem(400, '参考图无效。')
            if len(data) > 2_000_000:
                raise Problem(413, '参考图不能超过 2 MB。')
        elif reference is not None:
            raise Problem(400, '当前工作流不接受参考图。')
        if not service.storage.ready:
            raise Problem(503, '服务器存储尚未就绪。')
        service.storage.put(service.storage.key('local-studio/write-check'), b'ready', 'text/plain')
        service.store.rate_limit('local-generate:' + user['id'], 30, 3600)
        now, job_id = int(time.time()), uuid.uuid4().hex
        with service.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            expire(service, db)
            old = db.execute('SELECT * FROM local_jobs WHERE user_id=? AND request_id=?', (user['id'], request_id)).fetchone()
            if old:
                return 200, public(old), {}
            if db.execute("SELECT count(*) FROM local_jobs WHERE status IN ('queued','running')").fetchone()[0] >= 5:
                raise Problem(429, '本机队列已满，请等待现有任务完成。')
            db.execute('INSERT INTO local_jobs(id,user_id,request_id,workflow,label,kind,prompt,reference,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (job_id, user['id'], request_id, workflow, selected['label'], selected['kind'], prompt.strip(), service.store.cipher.encrypt(data) if data else None, 'queued', now, now))
            result = public(db.execute('SELECT * FROM local_jobs WHERE id=?', (job_id,)).fetchone())
        service.dirty()
        return 202, result, {}
    if path == '/jobs' and method == 'GET':
        with service.store.connect() as db:
            expire(service, db)
            jobs = db.execute('SELECT * FROM local_jobs WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 50', (user['id'],)).fetchall()
        return 200, {'jobs': [public(job) for job in jobs]}, {}
    match = re.fullmatch(r'/jobs/([a-f0-9]{32})(/asset)?', path)
    if match:
        with service.store.connect() as db:
            job = db.execute('SELECT * FROM local_jobs WHERE id=? AND user_id=?', (match[1], user['id'])).fetchone()
            if not job:
                raise Problem(404, '任务不存在。')
            if match[2] and method == 'GET' and job['status'] == 'complete':
                data = service.storage.get(job['object_key'])
                extra = {'Content-Type': job['mime'], 'Accept-Ranges': 'bytes'}
                if query.get('download') == ['1']:
                    extra['Content-Disposition'] = f'attachment; filename="{job["id"]}.{job["object_key"].rsplit(".", 1)[-1]}"'
                if headers.get('range'):
                    part = re.fullmatch(r'bytes=(\d+)-(\d*)', headers['range'])
                    if not part or int(part[1]) >= len(data):
                        return 416, b'', {'Content-Range': f'bytes */{len(data)}'}
                    start, end = int(part[1]), min(int(part[2]) if part[2] else len(data) - 1, len(data) - 1)
                    if start > end:
                        return 416, b'', {'Content-Range': f'bytes */{len(data)}'}
                    extra['Content-Range'] = f'bytes {start}-{end}/{len(data)}'
                    return 206, data[start:end + 1], extra
                return 200, data, extra
    raise Problem(404, '接口不存在。')
