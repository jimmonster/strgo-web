"""Member forum using the existing account service, database and backups."""
import re
import time
import uuid

from .security import Problem


PREFIX = '/api/image/forum/posts'
CATEGORIES = ('general', 'ai', 'terminal', 'help')
PAGE_SIZE = 20
SELECT = '''SELECT forum_posts.*, users.username, users.role,
            (SELECT COUNT(*) FROM forum_comments WHERE post_id=forum_posts.id AND deleted=0) AS comment_count
            FROM forum_posts
            JOIN users ON users.id=forum_posts.user_id'''
NOTIFICATIONS = '/api/image/forum/notifications'
INBOX = '''FROM forum_notifications n
           JOIN forum_comments c ON c.id=n.comment_id AND c.deleted=0
           JOIN forum_posts p ON p.id=c.post_id AND p.deleted=0
           JOIN users u ON u.id=c.user_id WHERE n.user_id=?'''


def public_post(row, user, preview=False):
    return {
        'id': row['id'], 'title': row['title'],
        'body': row['body'][:240] if preview else row['body'],
        'category': row['category'], 'pinned': bool(row['pinned']),
        'created': row['created'],
        'updated': row['updated'], 'revision': row['revision'],
        'commentCount': row['comment_count'], 'canEdit': row['user_id'] == user['id'],
        'author': {'id': row['user_id'], 'username': row['username'], 'role': row['role']},
        'canDelete': row['user_id'] == user['id'] or user['role'] == 'admin',
    }


def text_field(payload, name, maximum, label):
    value = payload.get(name)
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum or '\x00' in value:
        raise Problem(400, f'{label}需为 1–{maximum} 个字符。')
    return value.strip()


def offset_value(query):
    value = query.get('offset', ['0'])[0]
    if not re.fullmatch(r'\d{1,6}', value):
        raise Problem(400, '分页条件无效。')
    return int(value)


def public_comment(row, user):
    return {'id': row['id'], 'body': row['body'], 'created': row['created'],
            'author': {'id': row['user_id'], 'username': row['username'], 'role': row['role']},
            'canDelete': row['user_id'] == user['id'] or user['role'] == 'admin'}


def notifications(service, method, path, query, payload, user):
    if path == NOTIFICATIONS and method == 'GET':
        offset = offset_value(query)
        with service.store.connect() as db:
            db.execute('BEGIN')
            total = db.execute('SELECT COUNT(*) ' + INBOX, (user['id'],)).fetchone()[0]
            unread = db.execute('SELECT COUNT(*) ' + INBOX + ' AND n.read=0', (user['id'],)).fetchone()[0]
            rows = db.execute('''SELECT n.id,n.read,n.created,p.id AS post_id,p.title,c.body,u.username ''' +
                              INBOX + ' ORDER BY n.created DESC,n.id DESC LIMIT ? OFFSET ?',
                              (user['id'], PAGE_SIZE, offset)).fetchall()
        return 200, {'notifications': [{**dict(row), 'read': bool(row['read']), 'body': row['body'][:160]} for row in rows],
                     'total': total, 'unreadCount': unread, 'hasMore': offset + len(rows) < total}, {}
    if path == NOTIFICATIONS + '/read' and method == 'PUT':
        ids = payload.get('ids')
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(i, str) or not re.fullmatch(r'[a-f0-9]{32}', i) for i in ids):
            raise Problem(400, '请选择 1–100 条通知。')
        with service.store.connect() as db:
            db.execute('UPDATE forum_notifications SET read=1 WHERE user_id=? AND id IN (' + ','.join('?' for _ in ids) + ')', (user['id'], *ids))
        service.dirty()
        return 200, {'ok': True}, {}
    raise Problem(405 if path in (NOTIFICATIONS, NOTIFICATIONS + '/read') else 404, '通知接口或请求方法无效。')


def comments(service, method, match, query, payload, user):
    post_id, comment_id = match[1], match[2]
    if (comment_id and method != 'DELETE') or (not comment_id and method not in ('GET', 'POST')):
        raise Problem(405, '不支持该请求方法。')
    offset = offset_value(query) if method == 'GET' else 0
    body = text_field(payload, 'body', 3000, '评论') if method == 'POST' else ''
    request_id = payload.get('request_id', '')
    if method == 'POST':
        if not isinstance(request_id, str) or not re.fullmatch(r'[a-f0-9]{32}', request_id):
            raise Problem(400, '评论缺少有效的请求标识，请刷新页面后重试。')
        service.store.rate_limit('forum-comment:' + user['id'], 30, 300)
    comment_select = '''SELECT c.*,u.username,u.role FROM forum_comments c JOIN users u ON u.id=c.user_id'''
    with service.store.connect() as db:
        db.execute('BEGIN' if method == 'GET' else 'BEGIN IMMEDIATE')
        post = db.execute('SELECT * FROM forum_posts WHERE id=? AND deleted=0', (post_id,)).fetchone()
        if not post:
            raise Problem(404, '帖子不存在或已被删除。')
        if method == 'GET':
            total = db.execute('SELECT COUNT(*) FROM forum_comments WHERE post_id=? AND deleted=0', (post_id,)).fetchone()[0]
            rows = db.execute(comment_select + ' WHERE post_id=? AND c.deleted=0 ORDER BY c.created,c.id LIMIT ? OFFSET ?', (post_id, PAGE_SIZE, offset)).fetchall()
            return 200, {'comments': [public_comment(row, user) for row in rows], 'total': total, 'hasMore': offset + len(rows) < total}, {}
        if method == 'POST':
            previous = db.execute(comment_select + ' WHERE c.user_id=? AND request_id=?', (user['id'], request_id)).fetchone()
            if previous:
                if previous['post_id'] != post_id or previous['body'] != body or previous['deleted']:
                    raise Problem(409, '这次评论请求已被使用，请重新提交。')
                return 200, public_comment(previous, user), {}
            identifier, now = uuid.uuid4().hex, int(time.time())
            db.execute('INSERT INTO forum_comments(id,post_id,user_id,body,created,request_id) VALUES(?,?,?,?,?,?)',
                       (identifier, post_id, user['id'], body, now, request_id))
            if post['user_id'] != user['id']:
                db.execute('INSERT INTO forum_notifications(id,user_id,comment_id,created) VALUES(?,?,?,?)',
                           (uuid.uuid4().hex, post['user_id'], identifier, now))
            result = public_comment(db.execute(comment_select + ' WHERE c.id=?', (identifier,)).fetchone(), user)
        else:
            row = db.execute('SELECT * FROM forum_comments WHERE id=? AND post_id=? AND deleted=0', (comment_id, post_id)).fetchone()
            if not row:
                raise Problem(404, '评论不存在或已被删除。')
            if row['user_id'] != user['id'] and user['role'] != 'admin':
                raise Problem(403, '你只能删除自己发布的评论。')
            db.execute('UPDATE forum_comments SET deleted=1 WHERE id=?', (comment_id,))
            result = {'ok': True}
    service.dirty()
    return (201 if method == 'POST' else 200), result, {}


def dispatch(service, method, path, query, payload, user):
    # Service.dispatch has already verified the shared session, Origin and CSRF.
    if path == NOTIFICATIONS or path.startswith(NOTIFICATIONS + '/'):
        return notifications(service, method, path, query, payload, user)
    reply_match = re.fullmatch(re.escape(PREFIX) + r'/([a-f0-9]{32})/comments(?:/([a-f0-9]{32}))?', path)
    if reply_match:
        return comments(service, method, reply_match, query, payload, user)
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
        if (match[2] and method != 'PUT') or (not match[2] and method not in ('GET', 'PUT', 'DELETE')):
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
            elif method == 'PUT':
                if row['user_id'] != user['id']:
                    raise Problem(403, '只有作者可以编辑帖子。')
                if type(payload.get('revision')) is not int or payload['revision'] != row['revision']:
                    raise Problem(409, '帖子已在其他页面更新。请重新打开帖子后再编辑，当前输入仍保留。')
                title = text_field(payload, 'title', 80, '标题')
                body = text_field(payload, 'body', 10000, '正文')
                category = payload.get('category')
                if not isinstance(category, str) or category not in CATEGORIES:
                    raise Problem(400, '请选择有效分类。')
                db.execute('UPDATE forum_posts SET title=?,body=?,category=?,revision=revision+1,updated=? WHERE id=?',
                           (title, body, category, int(time.time()), row['id']))
                result = public_post(db.execute(SELECT + ' WHERE forum_posts.id=?', (row['id'],)).fetchone(), user)
            else:
                if row['user_id'] != user['id'] and user['role'] != 'admin':
                    raise Problem(403, '你只能删除自己发布的帖子。')
                db.execute('UPDATE forum_posts SET deleted=1,pinned=0 WHERE id=?', (match[1],))
                result = {'ok': True}
        service.dirty()
        return 200, result, {}
    raise Problem(405, '不支持该请求方法。')
