"""Durable private video jobs, explicit member grants and workflow replacement."""
from dataclasses import dataclass
import json
import logging
from pathlib import Path
import os
import re
import shutil
import threading
import time
import uuid

from .autodl_video import AutoDL, MAX_VIDEO_BYTES, is_mp4, links, validate_fields, workflow_id
from .security import Problem

PREFIX = '/api/image/video'
ADMIN = '/api/image/admin/video'
SCHEMA = '''
CREATE TABLE IF NOT EXISTS video_grants (
 user_id TEXT PRIMARY KEY REFERENCES users(id), granted_by TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS video_workflows (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, fields TEXT NOT NULL, enabled INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS video_jobs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
 workflow_id TEXT NOT NULL, title TEXT NOT NULL, parameters TEXT NOT NULL,
 status TEXT NOT NULL, remote_id TEXT, video_count INTEGER NOT NULL DEFAULT 0,
 error TEXT, created INTEGER NOT NULL, next_poll INTEGER NOT NULL,
 UNIQUE(user_id, request_id));
CREATE INDEX IF NOT EXISTS video_owner ON video_jobs(user_id, created DESC, id DESC);
CREATE INDEX IF NOT EXISTS video_poll ON video_jobs(status, next_poll);
'''
LOGGER = logging.getLogger('strgo-video')


@dataclass
class VideoStream:
    path: Path
    start: int
    length: int

    def write(self, output):
        with self.path.open('rb') as source:
            source.seek(self.start)
            remaining = self.length
            while remaining:
                data = source.read(min(128 * 1024, remaining))
                if not data:
                    break
                output.write(data)
                remaining -= len(data)


class VideoService:
    def __init__(self, store, start_worker=False, provider=None):
        self.store = store
        token = os.environ.get('AUTODL_COMFYUI_TOKEN', '').strip()
        self.provider = provider or AutoDL(token)
        self.ready = bool(token or provider)
        self.directory = store.directory / 'videos'
        self.stop = threading.Event()
        self.wake = threading.Event()
        with store.connect() as db:
            db.executescript(SCHEMA)
            if start_worker:
                db.execute("""UPDATE video_jobs SET status='unknown',error=?
                    WHERE status='submitting' AND remote_id IS NULL""",
                    ('上次提交结果待核实，请先检查 AutoDL 任务或账单。',))
        self.thread = None
        if start_worker and self.ready:
            self.thread = threading.Thread(target=self.work, name='strgo-video', daemon=True)
            self.thread.start()

    def close(self):
        self.stop.set()
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=25)

    def account(self, db, user):
        actor = db.execute("""SELECT u.id,u.role FROM users u JOIN sessions s ON s.user_id=u.id
            LEFT JOIN account_controls c ON c.user_id=u.id LEFT JOIN ai_members m ON m.user_id=u.id
            WHERE s.hash=? AND s.expires>? AND COALESCE(c.status,'active')='active'
            AND COALESCE(m.status,'active')='active'""", (user['session_hash'], int(time.time()))).fetchone()
        if not actor:
            raise Problem(401, '请重新登录。')
        return actor

    def require_admin(self, db, user):
        actor = self.account(db, user)
        if actor['role'] != 'admin':
            raise Problem(403, '仅管理员可配置工作流和成员权限。')
        return actor

    def permitted(self, db, user):
        return user['role'] == 'admin' or bool(db.execute(
            'SELECT 1 FROM video_grants WHERE user_id=?', (user['id'],)).fetchone())

    def disk_ready(self):
        try:
            self.directory.mkdir(mode=0o700, exist_ok=True)
            return shutil.disk_usage(self.directory).free >= 4 * MAX_VIDEO_BYTES
        except OSError:
            return False

    @staticmethod
    def workflow_public(row):
        return {'id': row['id'], 'title': row['title'], 'fields': json.loads(row['fields']),
                'enabled': bool(row['enabled']), **links(row['id'])}

    @staticmethod
    def job_public(row):
        return {'id': row['id'], 'title': row['title'], 'workflowId': row['workflow_id'],
                'prompt': json.loads(row['parameters']).get('prompt', ''), 'created': row['created'],
                'status': row['status'], 'error': row['error'],
                'videos': [f'{PREFIX}/jobs/{row["id"]}/{index}.mp4' for index in range(row['video_count'])]}

    def dispatch(self, user, method, path, query, payload, headers):
        if path.startswith(ADMIN + '/'):
            return self.admin(user, method, path[len(ADMIN):], payload)
        with self.store.connect() as db:
            if method == 'POST':
                db.execute('BEGIN IMMEDIATE')
            actor = self.account(db, user)
            if path == PREFIX + '/workflows' and method == 'GET':
                allowed = self.permitted(db, actor)
                rows = db.execute('SELECT * FROM video_workflows WHERE enabled=1 ORDER BY title,id').fetchall() if allowed else []
                return 200, {'allowed': allowed, 'ready': self.ready,
                             'workflows': [self.workflow_public(row) for row in rows]}, {}
            if path == PREFIX + '/jobs' and method == 'POST':
                return self.enqueue(db, actor, payload)
            if path == PREFIX + '/jobs' and method == 'GET':
                offset = query.get('offset', ['0'])[0]
                if not re.fullmatch(r'\d{1,6}', offset):
                    raise Problem(400, '分页参数无效。')
                rows = db.execute('SELECT * FROM video_jobs WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 21 OFFSET ?',
                                  (actor['id'], int(offset))).fetchall()
                return 200, {'jobs': [self.job_public(row) for row in rows[:20]], 'hasMore': len(rows) > 20}, {}
            match = re.fullmatch(PREFIX + r'/jobs/([a-f0-9]{32})(?:/([0-7])\.mp4)?', path)
            if match and method == 'GET':
                job = db.execute('SELECT * FROM video_jobs WHERE user_id=? AND id=?', (actor['id'], match[1])).fetchone()
                if not job:
                    raise Problem(404, '视频任务不存在。')
                if match[2] is None:
                    return 200, self.job_public(job), {}
                if job['status'] == 'complete' and int(match[2]) < job['video_count']:
                    return self.media(job['id'], int(match[2]), headers.get('range'), query.get('download') == ['1'])
        raise Problem(404, '视频接口不存在或文件未保存。')

    def enqueue(self, db, user, payload):
        request_id = payload.get('requestId')
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', request_id):
            raise Problem(400, '缺少请求编号。')
        previous = db.execute('SELECT * FROM video_jobs WHERE user_id=? AND request_id=?',
                              (user['id'], request_id)).fetchone()
        if previous:
            return 200, self.job_public(previous), {}
        if not self.permitted(db, user):
            raise Problem(403, '只有管理员和已获授权的成员可以生成视频。')
        if payload.get('acknowledged') is not True:
            raise Problem(400, '请先确认本次视频生成将产生费用。')
        if not self.ready or not self.disk_ready():
            raise Problem(503, 'AutoDL 令牌或服务器硬盘暂未就绪。')
        identifier = workflow_id(payload.get('workflowId'))
        workflow = db.execute('SELECT * FROM video_workflows WHERE id=? AND enabled=1', (identifier,)).fetchone()
        if not workflow:
            raise Problem(422, '该工作流尚未启用。')
        fields = validate_fields(json.loads(workflow['fields']), payload.get('fields'))
        if db.execute("""SELECT 1 FROM video_jobs WHERE user_id=?
                AND status IN ('queued','submitting','running','saving')""", (user['id'],)).fetchone():
            raise Problem(429, '请等待当前视频任务完成后再生成。')
        job_id, now = uuid.uuid4().hex, int(time.time())
        db.execute("""INSERT INTO video_jobs(id,user_id,request_id,workflow_id,title,parameters,status,created,next_poll)
                   VALUES(?,?,?,?,?,?,'queued',?,?)""",
                   (job_id, user['id'], request_id, identifier, workflow['title'], json.dumps(fields, ensure_ascii=False), now, now))
        self.wake.set()
        return 202, self.job_public(db.execute('SELECT * FROM video_jobs WHERE id=?', (job_id,)).fetchone()), {}

    def admin(self, user, method, route, payload):
        with self.store.connect() as db:
            self.require_admin(db, user)
        if route == '/catalog' and method == 'GET':
            return 200, {'workflows': self.provider.catalog()}, {}
        candidate = None
        if route == '/workflows' and method == 'POST':
            candidate = self.provider.workflow(workflow_id(payload.get('workflow')))
        from .admin import audit
        with self.store.connect() as db:
            db.execute('BEGIN' if method == 'GET' else 'BEGIN IMMEDIATE')
            actor = self.require_admin(db, user)
            if route == '/workflows':
                if method == 'GET':
                    return 200, {'ready': self.ready, 'workflows': [self.workflow_public(row) for row in
                                 db.execute('SELECT * FROM video_workflows ORDER BY title,id')]}, {}
                if candidate:
                    replacing = workflow_id(payload['replace']) if payload.get('replace') else None
                    if replacing and replacing != candidate['id']:
                        changed = db.execute('UPDATE video_workflows SET enabled=0 WHERE id=? AND enabled=1', (replacing,))
                        if not changed.rowcount:
                            raise Problem(409, '待替换的工作流已停用，请刷新列表。')
                        audit(db, actor['id'], 'video.workflow.disable', replacing)
                    db.execute("""INSERT INTO video_workflows VALUES(?,?,?,1)
                         ON CONFLICT(id) DO UPDATE SET title=excluded.title,fields=excluded.fields,enabled=1""",
                         (candidate['id'], candidate['title'], json.dumps(candidate['fields'], ensure_ascii=False)))
                    audit(db, actor['id'], 'video.workflow.enable', candidate['id'])
                    return 200, {**candidate, 'enabled': True}, {}
            match = re.fullmatch(r'/workflows/([A-Za-z0-9_-]{1,96})', route)
            if match and method == 'DELETE':
                db.execute('UPDATE video_workflows SET enabled=0 WHERE id=?', (match[1],))
                audit(db, actor['id'], 'video.workflow.disable', match[1])
                return 200, {'ok': True}, {}
            if route == '/grants' and method == 'GET':
                rows = db.execute('SELECT u.id,u.username FROM video_grants g JOIN users u ON u.id=g.user_id ORDER BY u.username')
                return 200, {'members': [dict(row) for row in rows]}, {}
            if route == '/grants' and method == 'POST':
                username = payload.get('username')
                if not isinstance(username, str) or not re.fullmatch(r'[A-Za-z0-9_-]{3,32}', username):
                    raise Problem(400, '请输入成员用户名。')
                target = db.execute("SELECT id FROM users WHERE username=? AND role='member'", (username.lower(),)).fetchone()
                if not target:
                    raise Problem(404, '普通成员不存在。')
                db.execute('INSERT OR IGNORE INTO video_grants VALUES(?,?,?)', (target['id'], actor['id'], int(time.time())))
                audit(db, actor['id'], 'video.grant.add', target['id'])
                return 200, {'ok': True}, {}
            match = re.fullmatch(r'/grants/([a-f0-9]{32})', route)
            if match and method == 'DELETE':
                db.execute('DELETE FROM video_grants WHERE user_id=?', (match[1],))
                audit(db, actor['id'], 'video.grant.remove', match[1])
                return 200, {'ok': True}, {}
        raise Problem(404, '视频管理接口不存在。')

    def work(self):
        while not self.stop.is_set():
            self.wake.clear()
            try:
                if self.run_one():
                    continue
            except Exception:
                LOGGER.error('视频队列暂无法处理任务。')
            self.wake.wait(2)

    def run_one(self):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            now = int(time.time())
            job = db.execute("""SELECT * FROM video_jobs WHERE status IN ('queued','running','saving')
                AND next_poll<=? ORDER BY next_poll,created LIMIT 1""", (now,)).fetchone()
            if not job:
                return False
            if job['status'] == 'queued':
                account = db.execute("""SELECT u.id,u.role FROM users u
                    LEFT JOIN account_controls c ON c.user_id=u.id LEFT JOIN ai_members m ON m.user_id=u.id
                    WHERE u.id=? AND COALESCE(c.status,'active')='active' AND COALESCE(m.status,'active')='active'""",
                    (job['user_id'],)).fetchone()
                enabled = db.execute('SELECT 1 FROM video_workflows WHERE id=? AND enabled=1', (job['workflow_id'],)).fetchone()
                if not account or not self.permitted(db, account) or not enabled or not self.disk_ready():
                    db.execute("UPDATE video_jobs SET status='failed',error=? WHERE id=?",
                               ('权限、工作流或硬盘状态已改变，任务未提交。', job['id']))
                    return True
                db.execute("UPDATE video_jobs SET status='submitting' WHERE id=?", (job['id'],))
            else:
                db.execute('UPDATE video_jobs SET next_poll=? WHERE id=?', (now + 10, job['id']))
        if job['status'] == 'queued':
            try:
                remote_id = self.provider.submit(job['workflow_id'], json.loads(job['parameters']))
            except Exception:
                self.update(job['id'], 'unknown', '提交结果待核实，请先检查 AutoDL 任务或账单。')
                return True
            with self.store.connect() as db:
                db.execute("UPDATE video_jobs SET status='running',remote_id=?,next_poll=? WHERE id=?",
                           (remote_id, now + 3, job['id']))
        else:
            self.poll(job)
        return True

    def update(self, job_id, status, error=None, count=0, delay=10):
        with self.store.connect() as db:
            db.execute('UPDATE video_jobs SET status=?,error=?,video_count=?,next_poll=? WHERE id=?',
                       (status, error, count, int(time.time()) + delay, job_id))

    def poll(self, job):
        if job['created'] < time.time() - 23 * 3600:
            self.update(job['id'], 'unknown', '任务已超过自动核对时间，请先到 AutoDL 查询。')
            return
        try:
            result = self.provider.result(job['remote_id'])
        except Exception:
            self.update(job['id'], job['status'], '状态暂时无法读取，稍后会继续查询。', delay=30)
            return
        status = str(result.get('status', '')).lower()
        if status in ('failure', 'failed', 'error', 'canceled', 'cancelled'):
            self.update(job['id'], 'failed', 'AutoDL 报告任务失败或取消。')
            return
        if status not in ('success', 'completed', 'succeeded'):
            return
        videos = [item['url'] for item in result.get('results', []) if is_mp4(item) and isinstance(item.get('url'), str)]
        if not 1 <= len(videos) <= 8:
            self.update(job['id'], 'failed', 'AutoDL 未返回可归档的 MP4，或单任务视频数超过 8 个。')
            return
        self.update(job['id'], 'saving')
        try:
            folder = self.directory / job['id']
            folder.mkdir(mode=0o700, exist_ok=True)
            for index, url in enumerate(videos):
                target = folder / f'{index}.mp4'
                if target.is_file():
                    continue
                if not self.disk_ready():
                    raise OSError('disk full')
                partial = target.with_suffix('.part')
                try:
                    self.provider.download(url, partial)
                    partial.replace(target)
                finally:
                    partial.unlink(missing_ok=True)
        except (Problem, OSError):
            self.update(job['id'], 'saving', '视频写入硬盘暂未完成，稍后会重试保存。', delay=30)
            return
        self.update(job['id'], 'complete', count=len(videos))

    def media(self, job_id, index, range_header, download):
        path = self.directory / job_id / f'{index}.mp4'
        if not path.is_file():
            raise Problem(404, '硬盘上的视频文件不存在。')
        size = path.stat().st_size
        extra = {'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
                 'Content-Disposition': f'{"attachment" if download else "inline"}; filename="strgo-{job_id}-{index}.mp4"'}
        start, end = 0, size - 1
        if range_header:
            match = re.fullmatch(r'bytes=(\d{0,14})-(\d{0,14})', range_header)
            if match and any(match.groups()):
                first, last = match.groups()
                start = int(first) if first else max(0, size - int(last))
                end = min(end, int(last)) if first and last else end
            if not match or not any(match.groups()) or start > end:
                extra['Content-Range'] = f'bytes */{size}'
                return 416, b'', extra
            extra['Content-Range'] = f'bytes {start}-{end}/{size}'
        return (206 if range_header else 200), VideoStream(path, start, end - start + 1), extra
