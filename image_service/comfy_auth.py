"""Short-lived STRGO SSO grants and child sessions for the ComfyUI origin."""
import hmac
from pathlib import Path
import re
import secrets
import time
from urllib.parse import urlencode

from .security import Problem, digest

ORIGIN = 'https://comfyui.strgo.com'
PUBLIC = '/api/image/comfyui-sso/authorize'
INTERNAL = '/internal/strgo-comfyui/'
PARENT_COOKIE = 'strgo_account_session'
BRIDGE_FILE = Path('/etc/strgo-comfyui/account.token')
CODE_AGE = 60
SESSION_AGE = 12 * 3600
TOKEN = re.compile(r'[A-Za-z0-9_-]{43,64}')
SCHEMA = '''
CREATE TABLE IF NOT EXISTS comfy_sso_codes (
    hash TEXT PRIMARY KEY, parent TEXT NOT NULL REFERENCES sessions(hash) ON DELETE CASCADE,
    state TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comfy_sessions (
    hash TEXT PRIMARY KEY, parent TEXT NOT NULL REFERENCES sessions(hash) ON DELETE CASCADE,
    expires INTEGER NOT NULL
);
'''
ACCOUNT = '''
SELECT s.hash, s.expires, u.id, u.role, COALESCE(c.status,'active') AS account_status,
       COALESCE(m.status,'active') AS ai_status, m.expires AS ai_expires
FROM sessions s JOIN users u ON u.id=s.user_id
LEFT JOIN account_controls c ON c.user_id=u.id
LEFT JOIN ai_members m ON m.user_id=u.id
'''


def valid_token(value):
    return isinstance(value, str) and TOKEN.fullmatch(value) is not None


def unique_cookie(header, name):
    prefix = name + '='
    items = [part.strip()[len(prefix):] for part in header.split(';')
             if part.strip().startswith(prefix)]
    return items[0] if len(items) == 1 and valid_token(items[0]) else ''


def redirect(destination):
    return 303, b'', {'Location': destination, 'Referrer-Policy': 'no-referrer'}


def require_admin(row, now):
    if row is None or row['expires'] <= now:
        raise Problem(401, '请先登录 STRGO。')
    if (row['role'] != 'admin' or row['account_status'] != 'active' or row['ai_status'] != 'active'
            or (row['ai_expires'] is not None and row['ai_expires'] <= now)):
        raise Problem(403, '仅已启用 AI 权限的 STRGO 管理员可访问。')
    return row


def bridge_secret():
    try:
        value = BRIDGE_FILE.read_text(encoding='ascii').strip()
    except (OSError, UnicodeError):
        return ''
    return value if valid_token(value) else ''


def authorize(service, method, query, headers, ip):
    if method != 'GET' or not bridge_secret():
        raise Problem(404, '接口不存在。')
    values = query.get('state', [])
    if set(query) != {'state'} or len(values) != 1 or not valid_token(values[0]):
        raise Problem(400, '无效的 ComfyUI 登录请求。')
    state = values[0]
    service.store.rate_limit('comfy-sso:' + digest(ip), 30, 300)
    token = unique_cookie(headers.get('cookie', ''), PARENT_COOKIE)
    if not token:
        return redirect('/image-playground/')
    now = int(time.time())
    with service.store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute(ACCOUNT + ' WHERE s.hash=?', (digest(token),)).fetchone()
        if not row or row['expires'] <= now:
            return redirect('/image-playground/')
        require_admin(row, now)
        db.execute('DELETE FROM comfy_sso_codes WHERE expires<=?', (now,))
        code = secrets.token_urlsafe(32)
        from .admin import audit
        audit(db, row['id'], 'comfyui.sso.authorize')
        db.execute('INSERT INTO comfy_sso_codes VALUES(?,?,?,?)',
                   (digest(code), row['hash'], digest(state), now + CODE_AGE))
    return redirect(ORIGIN + '/auth/callback?' + urlencode({'code': code, 'state': state}))


def internal(service, method, path, payload, headers, ip):
    expected = bridge_secret()
    supplied = headers.get('x-strgo-comfy-bridge', '')
    if method != 'POST' or not expected or not valid_token(supplied) or not hmac.compare_digest(expected, supplied):
        raise Problem(404, '接口不存在。')
    now = int(time.time())
    if path == INTERNAL + 'exchange':
        code, state = payload.get('code'), payload.get('state')
        if not valid_token(code) or not valid_token(state):
            raise Problem(401, 'ComfyUI 登录请求已失效。')
        service.store.rate_limit('comfy-exchange:' + digest(ip), 30, 300)
        with service.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            parent = db.execute(
                'DELETE FROM comfy_sso_codes WHERE hash=? AND state=? AND expires>? RETURNING parent',
                (digest(code), digest(state), now)).fetchone()
            if not parent:
                raise Problem(401, 'ComfyUI 登录请求已失效。')
            row = require_admin(db.execute(ACCOUNT + ' WHERE s.hash=?', (parent['parent'],)).fetchone(), now)
            db.execute('DELETE FROM comfy_sessions WHERE expires<=?', (now,))
            token = secrets.token_urlsafe(32)
            age = min(SESSION_AGE, row['expires'] - now)
            db.execute('INSERT INTO comfy_sessions VALUES(?,?,?)', (digest(token), row['hash'], now + age))
        return 200, {'token': token, 'age': age}, {}
    if path not in (INTERNAL + 'check', INTERNAL + 'logout'):
        raise Problem(404, '接口不存在。')
    token = payload.get('token')
    if not valid_token(token):
        raise Problem(401, '请先登录 STRGO。')
    token_hash = digest(token)
    with service.store.connect() as db:
        if path.endswith('/logout'):
            db.execute('DELETE FROM comfy_sessions WHERE hash=?', (token_hash,))
            return 200, {'ok': True}, {}
        row = db.execute(ACCOUNT + '''
            JOIN comfy_sessions cs ON cs.parent=s.hash WHERE cs.hash=? AND cs.expires>?
        ''', (token_hash, now)).fetchone()
        return 200, {'user': require_admin(row, now)['id']}, {}
