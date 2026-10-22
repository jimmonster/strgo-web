"""Site administration over shared accounts; never expose private AI content."""
import json
import re
import secrets
import shutil
import time
import uuid

from . import forum, local_studio
from .security import Problem, digest

PREFIX = '/api/image/admin'
SCHEMA = '''
CREATE TABLE IF NOT EXISTS account_controls (
 user_id TEXT PRIMARY KEY REFERENCES users(id), status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE IF NOT EXISTS admin_audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
 detail TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS admin_audit_time ON admin_audit(created DESC,id DESC);
'''


def audit(db, actor, action, target='', detail=None):
    db.execute('INSERT INTO admin_audit VALUES(?,?,?,?,?,?)',
               (uuid.uuid4().hex, actor, action, target, json.dumps(detail or {}), int(time.time())))


def page(query):
    offset, limit = query.get('offset', ['0'])[0], query.get('limit', ['20'])[0]
    if not re.fullmatch(r'\d{1,7}', offset) or not re.fullmatch(r'\d{1,3}', limit) or not 1 <= int(limit) <= 100:
        raise Problem(400, '分页参数无效，每页需为 1–100 条。')
    search = query.get('q', [''])[0].strip()
    if len(search) > 80:
        raise Problem(400, '搜索关键词最多 80 字。')
    return int(offset), int(limit), search


def listing(db, select, count, values, offset, limit):
    total = db.execute(count, values).fetchone()[0]
    rows = db.execute(select + ' LIMIT ? OFFSET ?', (*values, limit, offset)).fetchall()
    return {'items': [dict(row) for row in rows], 'total': total, 'hasMore': offset + len(rows) < total}


def summary(service, db):
    counts = {name: db.execute(sql).fetchone()[0] for name, sql in {
        'users': 'SELECT COUNT(*) FROM users',
        'sessions': 'SELECT COUNT(*) FROM sessions WHERE expires>' + str(int(time.time())),
        'posts': 'SELECT COUNT(*) FROM forum_posts WHERE deleted=0',
        'images': "SELECT COUNT(*) FROM images WHERE state='saved'",
        'audio': 'SELECT COUNT(*) FROM ai_assets WHERE deleted=0',
        'imageBytes': "SELECT COALESCE(SUM(bytes),0) FROM images WHERE state='saved'",
        'audioBytes': 'SELECT COALESCE(SUM(bytes),0) FROM ai_assets WHERE deleted=0',
    }.items()}
    groups = {}
    for module, table, column in [('image', 'jobs', 'status'), ('ai', 'ai_tasks', 'state'), ('workflow', 'local_jobs', 'status')]:
        groups[module] = [dict(row) for row in db.execute(f'SELECT {column} AS state,COUNT(*) AS count FROM {table} GROUP BY {column}')]
    free = None
    if getattr(service.storage, 'directory', None):
        try:
            free = shutil.disk_usage(service.storage.directory).free
        except OSError:
            pass
    return {'counts': counts, 'tasks': groups,
            'storage': {'ready': service.storage.ready, 'label': getattr(service.storage, 'label', '私有存储'), 'freeBytes': free},
            'backup': {'last': service.store.metadata('last_backup'), 'hasError': bool(service.store.metadata('backup_error'))},
            'workflow': local_studio.status(service)}


def dispatch(service, method, path, query, payload, user):
    path = path[len(PREFIX):]
    offset, limit, search = page(query)
    if method == 'POST' and path == '/invites':
        service.store.rate_limit('invite:' + user['id'], 20, 86400)
    with service.store.connect() as db:
        db.execute('BEGIN IMMEDIATE' if method != 'GET' else 'BEGIN')
        # Recheck inside the mutation transaction: another administrator may
        # have revoked this session since the request's initial authentication.
        actor = db.execute("""SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
            LEFT JOIN account_controls c ON c.user_id=u.id LEFT JOIN ai_members m ON m.user_id=u.id
            WHERE s.hash=? AND s.expires>? AND COALESCE(c.status,'active')='active'
            AND COALESCE(m.status,'active')='active'""", (user['session_hash'], int(time.time()))).fetchone()
        if not actor:
            raise Problem(401, '登录已失效，请重新登录。')
        if actor['role'] != 'admin':
            raise Problem(403, '仅管理员可访问全站后台。')
        if path == '/session' and method == 'GET':
            return 200, {'user': service.user_info(actor), 'csrf': user['csrf']}, {}
        if path == '/summary' and method == 'GET':
            return 200, summary(service, db), {}
        if path == '/users' and method == 'GET':
            where = ' WHERE instr(u.username,lower(?))>0'
            source = " FROM users u LEFT JOIN account_controls c ON c.user_id=u.id LEFT JOIN ai_members m ON m.user_id=u.id"
            result = listing(db, "SELECT u.id,u.username,u.role,u.created,u.updated,COALESCE(c.status,'active') AS status,COALESCE(m.status,'active') AS aiStatus,(SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires>" + str(int(time.time())) + ') AS sessions' + source + where + ' ORDER BY u.created DESC,u.id DESC',
                             'SELECT COUNT(*)' + source + where, (search,), offset, limit)
            return 200, result, {}
        match = re.fullmatch(r'/users/([a-f0-9]{32})(/sessions)?', path)
        if match and ((method == 'PUT' and not match[2]) or (method == 'DELETE' and match[2])):
            target = db.execute("SELECT u.*,COALESCE(c.status,'active') AS account_status FROM users u LEFT JOIN account_controls c ON c.user_id=u.id WHERE u.id=?", (match[1],)).fetchone()
            if not target:
                raise Problem(404, '账号不存在。')
            if match[2]:
                if target['id'] == actor['id']:
                    raise Problem(409, '请使用退出登录结束自己的会话。')
                db.execute('DELETE FROM sessions WHERE user_id=?', (target['id'],))
                audit(db, actor['id'], 'user.sessions.revoke', target['id'])
            else:
                if not payload or set(payload) - {'role', 'status', 'revision'}:
                    raise Problem(400, '账号修改字段无效。')
                if type(payload.get('revision')) is not int or payload['revision'] != target['updated']:
                    raise Problem(409, '账号已被修改，请刷新列表后重试。')
                role, status = payload.get('role', target['role']), payload.get('status', target['account_status'])
                if role not in ('admin', 'member') or status not in ('active', 'disabled'):
                    raise Problem(400, '账号角色或状态无效。')
                if target['id'] == actor['id'] and (role != 'admin' or status != 'active'):
                    raise Problem(409, '不能停用自己或移除自己的管理员角色。')
                if role == target['role'] and status == target['account_status']:
                    return 200, {'ok': True}, {}
                if role != 'admin' or status != 'active':
                    remaining = db.execute("""SELECT COUNT(*) FROM users u LEFT JOIN account_controls c ON c.user_id=u.id
                        LEFT JOIN ai_members m ON m.user_id=u.id WHERE u.role='admin' AND u.id<>?
                        AND COALESCE(c.status,'active')='active' AND COALESCE(m.status,'active')='active'""", (target['id'],)).fetchone()[0]
                    if remaining == 0:
                        raise Problem(409, '必须保留至少一名启用的管理员。')
                snapshot = {**dict(target), 'role': role, 'account_status': status,
                            'updated': max(int(time.time()), target['updated'] + 1)}
                service.persist_user(snapshot)
                db.execute('UPDATE users SET role=?,updated=? WHERE id=?', (role, snapshot['updated'], target['id']))
                db.execute('INSERT INTO account_controls VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status', (target['id'], status))
                db.execute('DELETE FROM sessions WHERE user_id=?', (target['id'],))
                audit(db, actor['id'], 'user.update', target['id'], {'role': role, 'status': status})
            result = {'ok': True}
        elif path == '/invites' and method == 'GET':
            return 200, listing(db, '''SELECT i.hash AS id,i.expires,i.role,u.username AS usedBy,
                CASE WHEN i.used_by IS NOT NULL THEN 'used' WHEN i.expires<=0 THEN 'revoked'
                WHEN i.expires<=strftime('%s','now')*1 THEN 'expired' ELSE 'active' END AS status
                FROM invites i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.expires DESC,i.hash DESC''',
                'SELECT COUNT(*) FROM invites', (), offset, limit), {}
        elif path == '/invites' and method == 'POST':
            token, expires = 'STRGO-' + secrets.token_urlsafe(24), int(time.time()) + 7 * 86400
            db.execute('INSERT INTO invites VALUES(?,?,?,?,?)', (digest(token), expires, None, actor['id'], 'member'))
            audit(db, actor['id'], 'invite.create', digest(token))
            result = {'code': token, 'expires': expires}
        elif re.fullmatch(r'/invites/[a-f0-9]{64}', path) and method == 'DELETE':
            identifier = path.rsplit('/', 1)[-1]
            if not db.execute('UPDATE invites SET expires=0 WHERE hash=? AND used_by IS NULL', (identifier,)).rowcount:
                raise Problem(404, '未使用的邀请码不存在。')
            audit(db, actor['id'], 'invite.revoke', identifier)
            result = {'ok': True}
        elif path == '/policy' and method in ('GET', 'PUT'):
            if method == 'PUT':
                value = payload.get('dailyImageLimit')
                if set(payload) != {'dailyImageLimit'} or (value is not None and (type(value) is not int or not 0 <= value <= 100000)):
                    raise Problem(400, '每日额度需为 0–100000 的整数，或 null 表示不限制。')
                db.execute("INSERT INTO meta VALUES('daily_image_limit',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ('' if value is None else str(value),))
                audit(db, actor['id'], 'image.policy.update', detail={'dailyImageLimit': value})
            result = {'dailyImageLimit': service.generation_quota(actor, db)['dailyImageLimit']}
        elif path == '/tasks' and method == 'GET':
            module = query.get('module', ['image'])[0]
            tables = {'image': ('jobs', 'status', 'model'), 'ai': ('ai_tasks', 'state', 'kind'), 'workflow': ('local_jobs', 'status', 'workflow')}
            if module not in tables:
                raise Problem(400, '任务模块无效。')
            table, column, kind = tables[module]
            source = f' FROM {table} t JOIN users u ON u.id=t.user_id WHERE instr(u.username,lower(?))>0'
            return 200, listing(db, f'SELECT t.id,u.username,t.{column} AS state,t.{kind} AS kind,t.created' + source + ' ORDER BY t.created DESC,t.id DESC',
                                'SELECT COUNT(*)' + source, (search,), offset, limit), {}
        elif path == '/audit' and method == 'GET':
            return 200, listing(db, '''SELECT a.id,a.actor_id,COALESCE(u.username,'已移除账号') AS actor,a.action,a.target,a.detail,a.created
                FROM admin_audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created DESC,a.id DESC''',
                'SELECT COUNT(*) FROM admin_audit', (), offset, limit), {}
        elif path == '/forum/posts' and method == 'GET':
            # Delegate after releasing the transaction: existing forum owns its
            # search/category semantics and member-visible content policy.
            result = None
        elif re.fullmatch(r'/forum/posts/[a-f0-9]{32}(/pin)?', path) and method in ('PUT', 'DELETE'):
            identifier = path.split('/')[3]
            post = db.execute('SELECT * FROM forum_posts WHERE id=? AND deleted=0', (identifier,)).fetchone()
            if not post:
                raise Problem(404, '帖子不存在。')
            if method == 'PUT' and path.endswith('/pin') and type(payload.get('pinned')) is bool:
                db.execute('UPDATE forum_posts SET pinned=? WHERE id=?', (int(payload['pinned']), identifier))
                audit(db, actor['id'], 'forum.pin', identifier, {'pinned': payload['pinned']})
            elif method == 'DELETE' and not path.endswith('/pin'):
                db.execute('UPDATE forum_posts SET deleted=1 WHERE id=?', (identifier,))
                audit(db, actor['id'], 'forum.delete', identifier)
            else:
                raise Problem(400, '社区管理操作无效。')
            result = {'ok': True}
        else:
            raise Problem(404, '管理接口不存在。')
    if result is None:
        return forum.dispatch(service, method, forum.PREFIX, query, payload, user)
    if method != 'GET':
        service.dirty()
    return (201 if method == 'POST' and path == '/invites' else 200), result, {}
