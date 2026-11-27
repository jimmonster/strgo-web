"""Validated private references and scoped, expiring upstream download links."""
import base64
import binascii
import hashlib
import io
import json
import re
import secrets
import subprocess
import tempfile
import time
import uuid

from PIL import Image, UnidentifiedImageError

from .ai_providers import inspect_audio
from .security import Problem, digest

MAX_BYTES = 4 * 1024 * 1024
SCHEMA = '''
CREATE TABLE IF NOT EXISTS video_inputs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, slot INTEGER,
 name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
 content BLOB NOT NULL, created INTEGER NOT NULL, request_id TEXT NOT NULL,
 UNIQUE(user_id,request_id));
CREATE TABLE IF NOT EXISTS video_input_slots (
 user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, slot INTEGER NOT NULL,
 input_id TEXT NOT NULL REFERENCES video_inputs(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,kind,slot));
CREATE TABLE IF NOT EXISTS video_job_inputs (
 job_id TEXT NOT NULL REFERENCES video_jobs(id),
 input_id TEXT NOT NULL REFERENCES video_inputs(id) ON DELETE CASCADE,
 field TEXT NOT NULL, PRIMARY KEY(job_id,field));
'''

def reference_audio(data):
    if len(data) > 8 and data[4:8] == b'ftyp':
        # iPhone recordings commonly use an M4A/MP4 container.
        with tempfile.NamedTemporaryFile(suffix='.m4a') as handle:
            handle.write(data)
            handle.flush()
            try:
                result = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file',
                                         '-show_entries', 'format=duration:stream=codec_type',
                                         '-of', 'json', handle.name], capture_output=True, timeout=15, check=True)
                info = json.loads(result.stdout)
                duration = float(info['format']['duration'])
                if not any(stream['codec_type'] == 'audio' for stream in info.get('streams', [])) or not 0 < duration <= 605:
                    raise ValueError()
                return 'audio/mp4', duration
            except (OSError, subprocess.SubprocessError, ValueError, KeyError) as error:
                raise Problem(400, 'M4A / MP4 参考音频无效，或服务器缺少 ffprobe。') from error
    return inspect_audio(data)


def upload(store, user, payload):
    kind, name, request_id, slot = payload.get('kind'), payload.get('name'), payload.get('requestId'), payload.get('slot')
    encoded = payload.get('data')
    if kind not in ('image', 'audio') or not isinstance(name, str) or not 1 <= len(name) <= 160:
        raise Problem(400, '素材类型或文件名无效。')
    if type(slot) is not int or not 0 <= slot < (9 if kind == 'image' else 3):
        raise Problem(400, '素材位置无效。')
    if not isinstance(request_id, str) or not re.fullmatch(r'[a-f0-9-]{16,80}', request_id):
        raise Problem(400, '上传缺少请求编号。')
    if not isinstance(encoded, str) or not 0 < len(encoded) <= 4 * ((MAX_BYTES + 2) // 3):
        raise Problem(413, '每份参考素材最多 4 MiB。')
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise Problem(400, '素材编码无效。') from error
    if not 0 < len(data) <= MAX_BYTES:
        raise Problem(413, '每份参考素材最多 4 MiB。')
    if kind == 'image':
        try:
            with Image.open(io.BytesIO(data)) as image:
                mime = {'PNG': 'image/png', 'JPEG': 'image/jpeg', 'WEBP': 'image/webp'}.get(image.format)
                if not mime or max(image.size) > 8192 or image.width * image.height > 16_777_216:
                    raise ValueError()
                image.verify()
        except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
            raise Problem(400, '请选择有效的 JPG、PNG 或 WebP 图片，最多 1600 万像素。') from error
    else:
        try:
            mime, _ = reference_audio(data)
        except (Problem, ValueError) as error:
            raise Problem(400, '请选择有效的 MP3、WAV、FLAC 或 M4A 音频。') from error
    fingerprint, now = hashlib.sha256(data).hexdigest(), int(time.time())
    with store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        previous = db.execute('SELECT * FROM video_inputs WHERE user_id=? AND request_id=?', (user['id'], request_id)).fetchone()
        if previous:
            if (previous['kind'], previous['slot'], previous['name'], previous['sha256']) != (kind, slot, name, fingerprint):
                raise Problem(409, '上传编号已被使用，请重新选择素材。')
            return public(previous, slot)
        db.execute('''DELETE FROM video_inputs WHERE created<? AND NOT EXISTS(
            SELECT 1 FROM video_job_inputs i JOIN video_jobs j ON j.id=i.job_id
            WHERE i.input_id=video_inputs.id AND j.created>=?) AND NOT EXISTS(
            SELECT 1 FROM video_input_slots s WHERE s.input_id=video_inputs.id)''', (now - 86400, now - 86400))
        old_slot = db.execute('SELECT input_id FROM video_input_slots WHERE user_id=? AND kind=? AND slot=?',
                              (user['id'], kind, slot)).fetchone()
        excluded = old_slot['input_id'] if old_slot and not db.execute(
            'SELECT 1 FROM video_job_inputs WHERE input_id=?', (old_slot['input_id'],)).fetchone() else None
        used = db.execute('SELECT COALESCE(SUM(bytes),0) FROM video_inputs WHERE user_id=? AND id<>COALESCE(?,\'\')',
                          (user['id'], excluded)).fetchone()[0]
        if used + len(data) > 100 * 1024 * 1024:
            raise Problem(413, '暂存参考素材已达到 100 MiB，请移除未使用素材或稍后重试。')
        identifier = uuid.uuid4().hex
        db.execute('''INSERT INTO video_inputs(id,user_id,kind,slot,name,mime,bytes,sha256,content,created,request_id)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?)''',
                   (identifier, user['id'], kind, slot, name, mime, len(data), fingerprint,
                    store.cipher.encrypt(data), now, request_id))
        db.execute('''INSERT INTO video_input_slots VALUES(?,?,?,?)
                      ON CONFLICT(user_id,kind,slot) DO UPDATE SET input_id=excluded.input_id''',
                   (user['id'], kind, slot, identifier))
        if old_slot and excluded:
            db.execute('DELETE FROM video_inputs WHERE id=?', (old_slot['input_id'],))
        return public(db.execute('SELECT * FROM video_inputs WHERE id=?', (identifier,)).fetchone(), slot)


def public(row, slot=None):
    return {key: row[key] for key in ('id', 'kind', 'name', 'mime', 'bytes')} | {
        'slot': slot, 'sha256': row['sha256'], 'url': '/api/image/video/inputs/' + row['id']}


def slots(store, user_id):
    with store.connect() as db:
        rows = db.execute('''SELECT a.*,s.slot FROM video_input_slots s JOIN video_inputs a ON a.id=s.input_id
                             WHERE s.user_id=? ORDER BY s.kind,s.slot''', (user_id,)).fetchall()
        return [public(row, row['slot']) for row in rows]


def bind(db, job_id, user_id, schema, fields):
    for field in schema:
        if field['kind'] not in ('image', 'audio') or field['name'] not in fields:
            continue
        identifier = fields[field['name']]
        row = db.execute('SELECT * FROM video_inputs WHERE id=? AND user_id=? AND kind=?',
                         (identifier, user_id, field['kind'])).fetchone()
        if not row:
            raise Problem(400, '参考素材不存在或不属于当前账号，请重新选择。')
        db.execute('INSERT INTO video_job_inputs VALUES(?,?,?)', (job_id, identifier, field['name']))


def provider_fields(db, origin, job, token):
    values = json.loads(job['parameters'])
    for row in db.execute('SELECT * FROM video_job_inputs WHERE job_id=?', (job['id'],)):
        values[row['field']] = f'{origin}/api/image/video-source/{job["id"]}/{row["input_id"]}?token={token}'
    return values


def serve(store, job_id, input_id, token):
    if not isinstance(token, str) or len(token) > 100:
        raise Problem(404, '素材链接无效。')
    with store.connect() as db:
        job = db.execute('SELECT * FROM video_jobs WHERE id=?', (job_id,)).fetchone()
        if (not job or job['created'] < time.time() - 23 * 3600
                or job['status'] not in ('submitting', 'running', 'saving', 'unknown')
                or not secrets.compare_digest(job['source_hash'] or '', digest(token))):
            raise Problem(404, '素材链接已失效。')
        row = db.execute('''SELECT a.* FROM video_inputs a JOIN video_job_inputs i ON a.id=i.input_id
                            WHERE i.job_id=? AND a.id=?''', (job_id, input_id)).fetchone()
        if not row:
            raise Problem(404, '素材不存在。')
        return content(store, row)


def content(store, row):
    data = store.cipher.decrypt(row['content'])
    if hashlib.sha256(data).hexdigest() != row['sha256']:
        raise Problem(503, '素材校验失败，请重新上传。')
    return 200, data, {'Content-Type': row['mime'], 'Content-Disposition': 'inline',
                       'Content-Security-Policy': "default-src 'none'; sandbox"}
