"""Small, independently testable boundaries for the shared AI API."""
import base64
import hashlib
import hmac
import json
import re
import secrets
import struct
import time
import uuid
from datetime import datetime, timezone, timedelta

from .security import Problem


class AIProblem(Problem):
    def __init__(self, status, code, message):
        super().__init__(status, message)
        self.code = code


def fail(status, code, message):
    raise AIProblem(status, code, message)


def packed(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def fingerprint(value):
    return hashlib.sha256(packed(value).encode()).hexdigest()


def uid():
    return uuid.uuid4().hex


def day_key(now=None):
    return datetime.fromtimestamp(now or time.time(), timezone(timedelta(hours=8))).strftime('%Y-%m-%d')


def check_key(value, now=None):
    try:
        parsed = uuid.UUID(value)
        if parsed.version != 7:
            raise ValueError()
    except (ValueError, AttributeError, TypeError):
        fail(400, 'INVALID_IDEMPOTENCY_KEY', '请使用 UUIDv7 幂等键。')
    age = (now or time.time()) - (parsed.int >> 80) / 1000
    if age > 7 * 86400:
        fail(410, 'IDEMPOTENCY_EXPIRED', '请求标识超过七天，请重新确认。')
    if age < -300:
        fail(400, 'INVALID_IDEMPOTENCY_KEY', '请求标识时间超前，请校准设备时间。')
    return str(parsed)


def text(value, name, maximum, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        fail(422, 'VALIDATION_ERROR', f'{name}应为{maximum}字以内的文本。')
    return value.strip()


def music_fields(value):
    if not isinstance(value, dict) or set(value) - {'title', 'prompt', 'lyrics', 'instrumental', 'duration', 'tags', 'bpm', 'key', 'seed'}:
        fail(422, 'VALIDATION_ERROR', '音乐表单包含未知字段。')
    result = {name: text(value.get(name, ''), label, limit, name == 'prompt') for name, label, limit in (
        ('title', '标题', 100), ('prompt', '风格描述', 2000), ('lyrics', '歌词', 3500))}
    if type(value.get('instrumental', False)) is not bool or type(value.get('duration', 60)) is not int or value.get('duration', 60) not in (15, 30, 60, 120):
        fail(422, 'VALIDATION_ERROR', '请选择有效的音乐模式和时长。')
    result.update(instrumental=value.get('instrumental', False), duration=value.get('duration', 60))
    tags = value.get('tags', [])
    if not isinstance(tags, list) or len(tags) > 8 or any(not isinstance(v, str) or not 1 <= len(v) <= 30 for v in tags):
        fail(422, 'VALIDATION_ERROR', '最多添加八个风格标签，每个不超过30字。')
    result['tags'] = tags
    if not result['instrumental'] and not result['lyrics']:
        fail(422, 'VALIDATION_ERROR', '自定义歌曲需要歌词，可使用助手起草。')
    for name, minimum, maximum in [('bpm', 30, 300), ('seed', 0, 2147483647)]:
        if value.get(name) is not None:
            if type(value[name]) is not int or not minimum <= value[name] <= maximum:
                fail(422, 'VALIDATION_ERROR', f'{name}参数无效。')
            result[name] = value[name]
    if value.get('key'):
        if not isinstance(value['key'], str) or not re.fullmatch(r'[A-G](#|b)? (major|minor)', value['key']):
            fail(422, 'VALIDATION_ERROR', '调性格式应为 C major 或 A minor。')
        result['key'] = value['key']
    return result


def totp(secret, counter=None):
    counter = int(time.time()) // 30 if counter is None else counter
    raw = base64.b32decode(secret + '=' * (-len(secret) % 8))
    digest = hmac.new(raw, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return str((struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000).zfill(6)


def verify_totp(secret, code, last_counter=-1):
    if not isinstance(code, str) or not re.fullmatch(r'\d{6}', code):
        fail(401, 'MFA_INVALID', '请输入六位动态验证码。')
    current = int(time.time()) // 30
    for counter in (current, current - 1, current + 1):
        if counter > last_counter and hmac.compare_digest(totp(secret, counter), code):
            return counter
    fail(401, 'MFA_INVALID', '动态验证码无效、已使用或已过期。')


def new_totp_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')
