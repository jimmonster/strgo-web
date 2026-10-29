"""One persistent world per tour; every fixed camera renders that same world."""
import base64
import hashlib
import json
import math
import os
import re
import time
import uuid

from .security import Problem, https_request, image_type

PREFIX = '/api/image/panorama-tours'
SCHEMA = '''
CREATE TABLE IF NOT EXISTS panorama_tours (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL, scene TEXT NOT NULL, camera_count INTEGER NOT NULL,
 status TEXT NOT NULL, model TEXT NOT NULL, reference BLOB, is_pano INTEGER NOT NULL,
 operation_id TEXT, world_id TEXT, result BLOB, asset_key TEXT, asset_sha TEXT,
 error TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL,
 UNIQUE(user_id,request_id));
CREATE INDEX IF NOT EXISTS panorama_tour_owner ON panorama_tours(user_id,created DESC);
'''
ACTIVE = ('queued', 'submitting', 'generating')
ID = re.compile(r'^[a-f0-9]{32}$')
REMOTE_ID = re.compile(r'^[A-Za-z0-9_-]{1,128}$')


class WorldProvider:
    """World API v1, not independent text-to-image calls for each camera."""
    @property
    def enabled(self):
        return bool(os.environ.get('PANORAMA_WORLD_API_KEY', '').strip())

    def api(self, path, body=None):
        key = os.environ.get('PANORAMA_WORLD_API_KEY', '').strip()
        if not key:
            raise Problem(503, '管理员尚未配置空间模型，暂不能生成固定机位全景。')
        raw = https_request('https://api.worldlabs.ai/marble/v1/' + path,
                            method='POST' if body is not None else 'GET',
                            body=json.dumps(body).encode() if body is not None else None,
                            headers={'WLT-Api-Key': key, 'Content-Type': 'application/json'},
                            max_bytes=4 * 1024 * 1024)
        try:
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, TypeError) as error:
            raise Problem(502, '空间模型返回格式异常，请稍后刷新状态。') from error

    def start(self, row, reference):
        prompt = {'type': 'image' if reference else 'text', 'text_prompt': row['scene'] or None}
        if reference:
            prompt.update(image_prompt={'source': 'data_base64', 'data_base64': base64.b64encode(reference).decode()},
                          is_pano=bool(row['is_pano']))
        return self.api('worlds:generate', {'display_name': (row['scene'] or 'STRGO panorama')[:64],
                                         'model': row['model'], 'permission': {'public': False}, 'world_prompt': prompt})

    def operation(self, identifier):
        return self.api('operations/' + identifier)

    def world(self, identifier):
        return self.api('worlds/' + identifier)

    def asset(self, url):
        # The shared HTTPS transport rejects non-public addresses and redirects.
        # No API credentials are sent to the asset host.
        return https_request(url, max_bytes=24 * 1024 * 1024)


class PanoramaTours:
    def __init__(self, service, provider=None):
        self.service, self.store = service, service.store
        self.provider = provider or WorldProvider()
        with self.store.connect() as db:
            db.execute("UPDATE panorama_tours SET status='unknown',reference=NULL,error=? WHERE status='submitting'",
                       ('空间模型提交被中断，结果未知；未自动重新生成，请管理员检查供应商记录。',))

    def get(self, identifier, owner=None):
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM panorama_tours WHERE id=?' + (' AND user_id=?' if owner else ''),
                             (identifier, owner) if owner else (identifier,)).fetchone()
        if not row:
            raise Problem(404, '固定机位项目不存在。')
        return row

    def quota(self, user, db=None):
        if db is None:
            with self.store.connect() as connection:
                return self.quota(user, connection)
        now = int(time.time())
        start = ((now + 28800) // 86400) * 86400 - 28800
        limit = max(0, int(os.environ.get('PANORAMA_WORLD_DAILY_LIMIT', '3')))
        used = db.execute('SELECT COUNT(*) FROM panorama_tours WHERE user_id=? AND created>=? AND created<?',
                          (user['id'], start, start + 86400)).fetchone()[0]
        return {'remaining': None if user['role'] == 'admin' else max(0, limit - used), 'used': used,
                'resetsAt': start + 86400, 'timezone': 'Asia/Shanghai'}

    def public(self, row):
        value = {key: row[key] for key in ('id', 'scene', 'status', 'error', 'created')}
        value.update(userId=row['user_id'], cameraCount=row['camera_count'], requestId=row['request_id'])
        if row['status'] == 'ready':
            world = json.loads(self.store.cipher.decrypt(row['result']))
            semantics = world.get('assets', {}).get('splats', {}).get('semantics_metadata') or {}
            scale = semantics.get('metric_scale_factor', 1)
            if type(scale) not in (int, float) or not math.isfinite(scale) or scale <= 0 or scale > 10000:
                raise Problem(502, '空间模型的尺寸信息无效。')
            # Positions use the source camera origin; all cameras share its
            # height, orientation and the same reconstructed scene coordinates.
            offsets = [0, -.45, .45] if row['camera_count'] == 3 else [0, -.45, .45, -.9, .9]
            value.update(splatUrl=PREFIX + '/' + row['id'] + '/splat', metricScale=scale,
                         cameras=[{'id': str(i), 'position': [x, 0, 0]} for i, x in enumerate(offsets)])
        return value

    def create(self, user, payload):
        scene, count = payload.get('scene', ''), payload.get('cameraCount', 3)
        request_id, reference = payload.get('requestId'), payload.get('referenceImage')
        if not isinstance(scene, str) or len(scene) > 4000 or (not scene.strip() and reference is None):
            raise Problem(400, '请输入场景文字或选择一张示例图。')
        if type(count) is not int or count not in (3, 5) or not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9-]{16,80}', request_id):
            raise Problem(400, '固定机位参数或请求编号无效。')
        if type(payload.get('isPano', False)) is not bool:
            raise Problem(400, '示例图参数无效。')
        image = None
        if reference is not None:
            try:
                if not isinstance(reference, dict) or not isinstance(reference.get('data'), str) or len(reference['data']) > 2666668:
                    raise ValueError()
                image = base64.b64decode(reference['data'], validate=True)
                mime, _ = image_type(image)
                if mime != reference.get('mime') or not 0 < len(image) <= 2000000:
                    raise ValueError()
            except (Problem, ValueError, TypeError) as error:
                raise Problem(400, '示例图需为 2 MB 内的 PNG、JPEG 或 WebP 图片。') from error
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM panorama_tours WHERE user_id=? AND request_id=?', (user['id'], request_id)).fetchone()
            if previous:
                return 200, {**self.public(previous), 'quota': self.quota(user, db)}, {}
            if not self.provider.enabled:
                raise Problem(503, '管理员尚未配置空间模型，暂不能生成固定机位全景。')
            if not self.service.storage.ready:
                raise Problem(503, '服务器存储尚未就绪，暂不能生成图片。')
            remaining = self.quota(user, db)['remaining']
            if remaining == 0:
                raise Problem(429, '今日空间生成额度已用完，请明天再试。')
            if db.execute("SELECT 1 FROM panorama_tours WHERE user_id=? AND status IN ('queued','submitting','generating')", (user['id'],)).fetchone():
                raise Problem(429, '已有空间任务正在进行，请等待完成。')
            identifier, now = uuid.uuid4().hex, int(time.time())
            model = os.environ.get('PANORAMA_WORLD_MODEL', 'marble-1.1')
            if model not in ('marble-1.1', 'marble-1.1-plus', 'marble-1.0', 'marble-1.0-draft'):
                raise Problem(503, '空间模型配置无效，请联系管理员。')
            db.execute('INSERT INTO panorama_tours(id,user_id,request_id,scene,camera_count,status,model,reference,is_pano,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (identifier, user['id'], request_id, scene.strip(), count, 'queued', model,
                        self.store.cipher.encrypt(image) if image else None, int(payload.get('isPano', False)), now, now))
        self.service.dirty()
        self.service._submit('tour:' + identifier, self.start, identifier)
        return 202, {**self.public(self.get(identifier)), 'quota': self.quota(user)}, {}

    def start(self, identifier):
        with self.store.connect() as db:
            changed = db.execute("UPDATE panorama_tours SET status='submitting' WHERE id=? AND status='queued'", (identifier,)).rowcount
        if not changed:
            return
        row = self.get(identifier)
        submitted = False
        try:
            self.service.storage.put(self.service.storage.key('system/write-check.txt'), b'World storage ready', 'text/plain')
            reference = self.store.cipher.decrypt(row['reference']) if row['reference'] else None
            submitted = True
            response = self.provider.start(row, reference)
            operation = response.get('operation_id')
            if not isinstance(operation, str) or not REMOTE_ID.fullmatch(operation):
                raise Problem(502, '空间模型未返回有效任务编号。')
            with self.store.connect() as db:
                db.execute("UPDATE panorama_tours SET status='generating',operation_id=?,reference=NULL,updated=? WHERE id=?",
                           (operation, int(time.time()), identifier))
        except Exception:
            # A timeout is not proof that the paid request was rejected.
            with self.store.connect() as db:
                db.execute('UPDATE panorama_tours SET status=?,reference=NULL,error=? WHERE id=?',
                           ('unknown' if submitted else 'failed',
                            '空间模型提交结果未知；未自动重试生成，请管理员检查供应商记录。' if submitted else '存储预检失败，未向空间模型提交请求。', identifier))
        self.service.dirty()

    def poll(self, row):
        if row['status'] != 'generating':
            return row
        with self.service.image_locks[int(row['id'][:4], 16) % 64]:
            row = self.get(row['id'])
            if row['status'] != 'generating':
                return row
            response = self.provider.operation(row['operation_id'])
            if not response.get('done'):
                return row
            if response.get('error'):
                with self.store.connect() as db:
                    db.execute("UPDATE panorama_tours SET status='failed',error=? WHERE id=?", ('空间生成失败，请管理员检查供应商任务。', row['id']))
            else:
                result = response.get('response') or {}
                world_id = result.get('id') or result.get('world_id')
                if not isinstance(world_id, str) or not REMOTE_ID.fullmatch(world_id):
                    raise Problem(502, '空间模型未返回有效场景编号，请刷新状态。')
                if not result.get('assets', {}).get('splats', {}).get('spz_urls'):
                    result = self.provider.world(world_id)
                urls = result.get('assets', {}).get('splats', {}).get('spz_urls', {})
                if not any(isinstance(urls.get(key), str) and urls[key].startswith('https://') for key in ('500k', '100k', 'full_res')):
                    raise Problem(502, '空间模型没有返回共同的三维场景，不能生成一致的机位。')
                with self.store.connect() as db:
                    db.execute("UPDATE panorama_tours SET status='ready',world_id=?,result=?,updated=? WHERE id=?",
                               (world_id, self.store.cipher.encrypt(json.dumps(result).encode()), int(time.time()), row['id']))
            self.service.dirty()
            return self.get(row['id'])

    def asset(self, row):
        if row['status'] != 'ready':
            raise Problem(409, '共同空间尚未生成完成。')
        with self.service.image_locks[int(row['id'][:4], 16) % 64]:
            row = self.get(row['id'])
            if row['asset_key']:
                data = self.service.storage.get(row['asset_key'])
                if hashlib.sha256(data).hexdigest() != row['asset_sha']:
                    raise Problem(502, '空间文件内容校验失败。')
            else:
                # Refresh signed asset URLs without resubmitting generation.
                world = self.provider.world(row['world_id'])
                urls = world.get('assets', {}).get('splats', {}).get('spz_urls', {})
                candidates = [urls[key] for key in ('500k', '100k', 'full_res') if isinstance(urls.get(key), str) and urls[key].startswith('https://')]
                if not candidates:
                    raise Problem(502, '空间文件暂时不可用，请刷新重试。')
                for index, url in enumerate(candidates):
                    try:
                        data = self.provider.asset(url)
                        if not data or len(data) > 24 * 1024 * 1024 or not data.startswith((b'\x1f\x8b', b'NGSP', b'ply\n', b'ply\r\n')):
                            raise Problem(502, '空间文件无效或超过大小限制。')
                        break
                    except Problem:
                        if index == len(candidates) - 1:
                            raise
                key = self.service.storage.key('panorama-worlds/' + row['user_id'] + '/' + row['id'] + '.spz')
                self.service.storage.put(key, data, 'application/octet-stream')
                with self.store.connect() as db:
                    db.execute('UPDATE panorama_tours SET asset_key=?,asset_sha=? WHERE id=?', (key, hashlib.sha256(data).hexdigest(), row['id']))
                self.service.dirty()
        return 200, data, {'Content-Type': 'application/octet-stream'}

    def dispatch(self, user, method, path, payload):
        if path == PREFIX:
            if method == 'POST':
                return self.create(user, payload)
            if method == 'GET':
                with self.store.connect() as db:
                    rows = db.execute('SELECT * FROM panorama_tours WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 20', (user['id'],)).fetchall()
                return 200, {'enabled': self.provider.enabled, 'quota': self.quota(user), 'projects': [self.public(row) for row in rows]}, {}
        match = re.fullmatch(PREFIX + r'/([a-f0-9]{32})(/splat)?', path)
        if match and method == 'GET':
            row = self.get(match[1], user['id'])
            if match[2]:
                return self.asset(row)
            return 200, self.public(self.poll(row)), {}
        raise Problem(404, '接口不存在。')
