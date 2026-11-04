"""Private forum uploads, encrypted in the same database as posts and backups."""
import base64
import binascii
import hashlib
import re
import time
import uuid
from urllib.parse import quote

from .security import Problem, image_type


PREFIX = '/api/image/forum/attachments'
MAX_BYTES = 5 * 1024 * 1024  # Base64 plus JSON fits the existing 7 MiB HTTP limit.
USER_BYTES = 100 * 1024 * 1024
MAX_PER_POST = 12
DRAFT_AGE = 24 * 3600
REFERENCE = re.compile(re.escape(PREFIX) + r'/([a-f0-9]{32})(?![a-f0-9])')
TYPES = {'image/png': ('.png',), 'image/jpeg': ('.jpg', '.jpeg'),
         'image/webp': ('.webp',), 'application/pdf': ('.pdf',)}


def references(body):
    return set(REFERENCE.findall(body))


def bind(db, body, user_id, post_id):
    """Claim uploads atomically with a post write; conflicts leave drafts intact."""
    identifiers = references(body)
    if len(identifiers) > MAX_PER_POST:
        raise Problem(400, '每篇帖子最多插入 12 个附件。')
    for identifier in identifiers:
        row = db.execute('SELECT id,user_id,post_id,created FROM forum_attachments WHERE id=?', (identifier,)).fetchone()
        if not row or row['user_id'] != user_id or row['post_id'] not in (None, post_id):
            raise Problem(400, '附件不存在或不属于当前帖子，请重新上传。')
        if row['post_id'] is None and row['created'] < time.time() - DRAFT_AGE:
            raise Problem(400, '未发布的附件已过期，请重新上传。')
    for row in db.execute('SELECT id FROM forum_attachments WHERE post_id=?', (post_id,)).fetchall():
        if row['id'] not in identifiers:
            db.execute('DELETE FROM forum_attachments WHERE id=?', (row['id'],))
    for identifier in identifiers:
        db.execute('UPDATE forum_attachments SET post_id=? WHERE id=?', (post_id, identifier))


def public(row):
    url = PREFIX + '/' + row['id']
    return {key: row[key] for key in ('id', 'name', 'mime', 'bytes')} | {
        'url': url, 'downloadUrl': url + '?download=1'}


def dispatch(service, method, path, query, payload, user):
    if path == PREFIX and method == 'POST':
        name, mime = payload.get('name'), payload.get('mime')
        encoded, request_id = payload.get('data'), payload.get('request_id')
        if (not isinstance(name, str) or not 1 <= len(name.strip()) <= 160
                or any(ord(c) < 32 or ord(c) == 127 or c in '/\\' for c in name)
                or not isinstance(mime, str) or mime not in TYPES or not name.lower().endswith(TYPES[mime])):
            raise Problem(400, '请选择 PNG、JPEG、WebP 图片或 PDF 文件，文件名最多 160 字符。')
        if not isinstance(request_id, str) or not re.fullmatch(r'[a-f0-9]{32}', request_id):
            raise Problem(400, '上传缺少有效的请求标识，请重新选择文件。')
        if not isinstance(encoded, str) or not encoded or len(encoded) > 4 * ((MAX_BYTES + 2) // 3):
            raise Problem(413, '每个附件最多 5 MiB。')
        service.store.rate_limit('forum-upload:' + user['id'], 30, 300)
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise Problem(400, '文件编码无效，请重新选择文件。')
        if not data or len(data) > MAX_BYTES:
            raise Problem(413, '每个附件最多 5 MiB。')
        if mime == 'application/pdf':
            if not re.match(rb'%PDF-(?:1\.[0-7]|2\.0)[\r\n ]', data) or b'%%EOF' not in data[-4096:]:
                raise Problem(400, '文件不是有效的 PDF。')
        else:
            try:
                actual, _ = image_type(data)
            except Problem:
                raise Problem(400, '文件不是支持的图片。')
            if actual != mime:
                raise Problem(400, '图片格式与文件类型不一致。')
        fingerprint, now = hashlib.sha256(data).hexdigest(), int(time.time())
        with service.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM forum_attachments WHERE user_id=? AND request_id=?',
                                  (user['id'], request_id)).fetchone()
            if previous:
                if (previous['sha256'], previous['name'], previous['mime']) != (fingerprint, name.strip(), mime):
                    raise Problem(409, '这次上传请求已被使用，请重新选择文件。')
                return 200, public(previous), {}
            db.execute('DELETE FROM forum_attachments WHERE user_id=? AND post_id IS NULL AND created<?',
                       (user['id'], now - DRAFT_AGE))
            used = db.execute('SELECT COALESCE(SUM(bytes),0) FROM forum_attachments WHERE user_id=?',
                              (user['id'],)).fetchone()[0]
            if used + len(data) > USER_BYTES:
                raise Problem(413, '论坛附件总量已达到 100 MiB，请先移除不需要的附件。')
            identifier = uuid.uuid4().hex
            db.execute('''INSERT INTO forum_attachments
                       (id,user_id,name,mime,bytes,sha256,content,created,request_id)
                       VALUES(?,?,?,?,?,?,?,?,?)''',
                       (identifier, user['id'], name.strip(), mime, len(data), fingerprint,
                        service.store.cipher.encrypt(data), now, request_id))
            result = public(db.execute('SELECT * FROM forum_attachments WHERE id=?', (identifier,)).fetchone())
        service.dirty()
        return 201, result, {}
    match = re.fullmatch(re.escape(PREFIX) + r'/([a-f0-9]{32})', path)
    if match and method == 'GET':
        with service.store.connect() as db:
            row = db.execute('''SELECT a.*,p.body,p.deleted FROM forum_attachments a
                              LEFT JOIN forum_posts p ON p.id=a.post_id WHERE a.id=?''', (match[1],)).fetchone()
        if not row:
            raise Problem(404, '附件不存在或已被移除。')
        if row['post_id'] is None:
            allowed = row['user_id'] == user['id'] and row['created'] >= time.time() - DRAFT_AGE
        else:
            allowed = row['deleted'] == 0 and row['id'] in references(row['body'] or '')
        if not allowed:
            raise Problem(404, '附件不存在或已被移除。')
        disposition = 'attachment' if row['mime'] == 'application/pdf' or query.get('download') == ['1'] else 'inline'
        return 200, service.store.cipher.decrypt(row['content']), {
            'Content-Type': row['mime'],
            'Content-Disposition': disposition + "; filename*=UTF-8''" + quote(row['name'], safe=''),
            'Content-Security-Policy': "default-src 'none'; sandbox"}
    raise Problem(405 if match or path == PREFIX else 404, '附件接口或请求方法无效。')
