"""Member forum using the existing account service, database and backups."""
import re
import time
import uuid

from .security import Problem


PREFIX = '/api/image/forum/posts'
CATEGORIES = ('general', 'ai', 'terminal', 'help')
PAGE_SIZE = 20
SELECT = '''SELECT forum_posts.*, users.username, users.role FROM forum_posts
            JOIN users ON users.id=forum_posts.user_id'''


def public_post(row, user, preview=False):
    return {
        'id': row['id'], 'title': row['title'],
        'body': row['body'][:240] if preview else row['body'],
        'category': row['category'], 'pinned': bool(row['pinned']),
        'created': row['created'],
        'author': {'id': row['user_id'], 'username': row['username'], 'role': row['role']},
        'canDelete': row['user_id'] == user['id'] or user['role'] == 'admin',
    }


def text_field(payload, name, maximum, label):
    value = payload.get(name)
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum or '\x00' in value:
        raise Problem(400, f'{label}需为 1–{maximum} 个字符。')
    return value.strip()


def dispatch(service, method, path, query, payload, user):
    # Service.dispatch has already verified the shared session, Origin and CSRF.
    match = re.fullmatch(re.escape(PREFIX) + r'/([a-f0-9]{32})(/pin)?', path)
    if path != PREFIX and not match:
        raise Problem(404, '论坛接口不存在。')

    if path == PREFIX and method == 'GET':
        category = query.get('category', [''])[0]
        scope = query.get('scope', ['all'])[0]
        search = query.get('q', [''])[0].strip()
        offset = query.get('offset', ['0'])[0]
        if category and category not in CATEGORIES:
            raise Problem(400, '请选择有效分类。')
        if scope not in ('all', 'mine') or len(search) > 80 or not re.fullmatch(r'\d{1,6}', offset):
            raise Problem(400, '筛选条件无效。')
        offset = int(offset)
        where, values = ['forum_posts.deleted=0'], []
        if category:
            where.append('forum_posts.category=?')
            values.append(category)
        if scope == 'mine':
            where.append('forum_posts.user_id=?')
            values.append(user['id'])
        if search:
            # instr treats user-entered SQL LIKE wildcards as ordinary text.
            where.append('(instr(lower(forum_posts.title),lower(?))>0 OR instr(lower(forum_posts.body),lower(?))>0)')
            values.extend((search, search))
        clause = ' WHERE ' + ' AND '.join(where)
        with service.store.connect() as db:
            db.execute('BEGIN')
            total = db.execute('SELECT COUNT(*) FROM forum_posts' + clause, values).fetchone()[0]
            rows = db.execute(SELECT + clause + ' ORDER BY pinned DESC,created DESC,id DESC LIMIT ? OFFSET ?',
                              (*values, PAGE_SIZE, offset)).fetchall()
            stats = db.execute('''SELECT COUNT(*) AS posts, COUNT(DISTINCT user_id) AS contributors,
                                  COALESCE(SUM(user_id=?),0) AS mine FROM forum_posts WHERE deleted=0''', (user['id'],)).fetchone()
        return 200, {'posts': [public_post(row, user, preview=True) for row in rows],
                     'total': total, 'hasMore': offset + len(rows) < total, 'stats': dict(stats)}, {}

    if path == PREFIX and method == 'POST':
        title = text_field(payload, 'title', 80, '标题')
        body = text_field(payload, 'body', 10000, '正文')
        category = payload.get('category', 'general')
        if not isinstance(category, str) or category not in CATEGORIES:
            raise Problem(400, '请选择有效分类。')
        service.store.rate_limit('forum-post:' + user['id'], 10, 300)
        post_id = uuid.uuid4().hex
        with service.store.connect() as db:
            # Author and pin status are always assigned on the server.
            db.execute('INSERT INTO forum_posts(id,user_id,title,body,category,created) VALUES(?,?,?,?,?,?)',
                       (post_id, user['id'], title, body, category, int(time.time())))
            row = db.execute(SELECT + ' WHERE forum_posts.id=?', (post_id,)).fetchone()
        service.dirty()
        return 201, public_post(row, user), {}

    if match:
        if (match[2] and method != 'PUT') or (not match[2] and method not in ('GET', 'DELETE')):
            raise Problem(405, '不支持该请求方法。')
        with service.store.connect() as db:
            if method != 'GET':
                db.execute('BEGIN IMMEDIATE')
            row = db.execute(SELECT + ' WHERE forum_posts.id=? AND deleted=0', (match[1],)).fetchone()
            if not row:
                raise Problem(404, '帖子不存在或已被删除。')
            if method == 'GET':
                return 200, public_post(row, user), {}
            if match[2]:
                if user['role'] != 'admin':
                    raise Problem(403, '仅管理员可以置顶帖子。')
                if type(payload.get('pinned')) is not bool:
                    raise Problem(400, '置顶状态需为布尔值。')
                db.execute('UPDATE forum_posts SET pinned=? WHERE id=?', (int(payload['pinned']), match[1]))
                result = {**public_post(row, user), 'pinned': payload['pinned']}
            else:
                if row['user_id'] != user['id'] and user['role'] != 'admin':
                    raise Problem(403, '你只能删除自己发布的帖子。')
                db.execute('UPDATE forum_posts SET deleted=1,pinned=0 WHERE id=?', (match[1],))
                result = {'ok': True}
        service.dirty()
        return 200, result, {}
    raise Problem(405, '不支持该请求方法。')
