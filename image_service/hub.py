"""Read-only, owner-scoped indexes for the STRGO portal.

Only local, already authenticated services participate. Workflow deliberately
keeps its separate host-only session; no credentials or provider URLs leave here.
Mutations and binary downloads remain on their original module endpoints.
"""
import base64
import json
import re
import sqlite3
import time

from .security import Problem


STATES = {
    'queued': '排队中', 'running': '执行中', 'saving': '保存中',
    'save_failed': '保存失败', 'unknown': '待核实', 'complete': '已完成',
    'failed': '生成失败', 'cancelled': '已取消', 'cancelling': '取消中',
    'interrupted': '已中断', 'partial': '部分完成',
}
AI_STATES = {'QUEUED': 'queued', 'DISPATCHING': 'running', 'RUNNING': 'running',
             'SAVING': 'saving', 'RECONCILING': 'unknown', 'SUCCEEDED': 'complete',
             'FAILED': 'failed', 'CANCELLED': 'cancelled',
             'CANCEL_REQUESTED': 'cancelling', 'INTERRUPTED': 'interrupted'}


def encode_cursor(kind, source, state, row):
    value = [kind, source, state, row['created'], row['key']]
    return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')


def decode_cursor(token, kind, source, state):
    if not token:
        return None
    try:
        if len(token) > 500 or not re.fullmatch(r'[A-Za-z0-9_-]+', token):
            raise ValueError()
        value = json.loads(base64.urlsafe_b64decode(token + '=' * (-len(token) % 4)))
        if (not isinstance(value, list) or len(value) != 5 or value[:3] != [kind, source, state]
                or type(value[3]) is not int or value[3] < 0 or value[3] > 2**53
                or not isinstance(value[4], str) or not re.fullmatch(r'(image|music|chat):[a-f0-9]{32}', value[4])):
            raise ValueError()
        return value[3], value[4]
    except (ValueError, TypeError, UnicodeError):
        raise Problem(400, '分页游标无效，请刷新列表。')


def permitted_kinds(db, user, now):
    member = db.execute('SELECT * FROM ai_members WHERE user_id=?', (user['id'],)).fetchone()
    if not member or member['status'] != 'active' or (member['expires'] is not None and member['expires'] <= now):
        return []
    return [kind for kind in ('music', 'chat') if member[kind]]


def image_rows(db, user, kind):
    if kind == 'tasks':
        return ("""SELECT j.id, substr(j.prompt,1,80) AS title, j.created,
            j.status AS raw_status, j.error,
            CASE WHEN j.status='uploading' AND EXISTS
                (SELECT 1 FROM images i WHERE i.job_id=j.id AND i.user_id=j.user_id AND i.state='pending' AND i.error<>'')
                THEN 'save_failed' WHEN j.status='uploading' THEN 'saving'
                WHEN j.status='generating' THEN 'running' WHEN j.status='complete' THEN 'complete'
                ELSE j.status END AS status
            FROM jobs j WHERE j.user_id=? AND j.deleted=0""", (user['id'],))
    return ("""SELECT i.id, i.job_id, substr(j.prompt,1,80) AS title, i.created,
        i.state AS raw_status, i.error, i.mime, i.bytes,
        CASE WHEN i.state='saved' THEN 'complete' WHEN i.state='pending' AND i.error<>''
            THEN 'save_failed' ELSE 'saving' END AS status
        FROM images i JOIN jobs j ON j.id=i.job_id AND j.user_id=i.user_id
        WHERE i.user_id=? AND j.deleted=0 AND i.state NOT IN ('deleting','deleted')""", (user['id'],))


def ai_rows(db, user, kind, allowed, now):
    if not allowed:
        return []
    params = [user['id'], *allowed]
    markers = ','.join('?' for _ in allowed)
    # A withdrawn model grant must not expose its task/asset metadata in the hub.
    grants = 'EXISTS(SELECT 1 FROM ai_model_grants g WHERE g.user_id=t.user_id AND g.model_id=t.model_id)'
    if kind == 'tasks':
        return (f"""SELECT t.id, t.kind, t.form_id, t.conversation_id,
            t.created,t.updated,t.state AS raw_status,t.error,
            CASE WHEN t.kind='music' THEN '音乐创作' ELSE 'AI 对话' END AS title
            FROM ai_tasks t WHERE t.user_id=? AND t.kind IN ({markers}) AND {grants}
            AND (t.conversation_id IS NULL OR EXISTS(SELECT 1 FROM ai_conversations c
                WHERE c.id=t.conversation_id AND c.user_id=t.user_id AND c.deleted=0))""", params)
    if 'music' not in allowed:
        return []
    return (f"""SELECT a.id,a.task_id,a.title,a.created,a.mime,a.bytes,a.duration,
        t.form_id,t.conversation_id,'music' AS kind,'SUCCEEDED' AS raw_status,'' AS error
        FROM ai_assets a JOIN ai_tasks t ON t.id=a.task_id AND t.user_id=a.user_id
        WHERE a.user_id=? AND a.deleted=0 AND a.delete_pending=0 AND a.created>? AND {grants}""",
        (user['id'], now - 90 * 86400))


def page_rows(db, query, adapter, state, cursor, limit):
    if not query:
        return []
    sql, params = query
    params = list(params)
    if adapter == 'image':
        status_sql = "CASE WHEN status IN (" + ','.join("'" + key + "'" for key in STATES) + ") THEN status ELSE 'unknown' END"
        source_sql = "'image'"
    else:
        status_sql = 'CASE raw_status ' + ' '.join("WHEN '" + key + "' THEN '" + value + "'" for key, value in AI_STATES.items()) + " ELSE 'unknown' END"
        source_sql = 'kind'
    normalized = f"WITH base AS ({sql}), normalized AS (SELECT base.*, {status_sql} AS hub_status, {source_sql} || ':' || id AS hub_key FROM base) SELECT * FROM normalized WHERE 1=1"
    if state != 'all':
        normalized += ' AND hub_status=?'
        params.append(state)
    if cursor:
        normalized += ' AND (created < ? OR (created = ? AND hub_key < ?))'
        params.extend((cursor[0], cursor[0], cursor[1]))
    normalized += ' ORDER BY created DESC, hub_key DESC LIMIT ?'
    params.append(limit + 1)
    return db.execute(normalized, params).fetchall()


def public_row(row, source, kind):
    row = dict(row)
    source = row.get('kind', source)
    status = row.get('hub_status') or row.get('status') or AI_STATES.get(row['raw_status'], 'unknown')
    value = {key: row[key] for key in ('id', 'title', 'created', 'raw_status', 'error')}
    value.update(key=source + ':' + row['id'], source=source, status=status,
                 status_label=STATES.get(status, '待核实'), updated=row.get('updated'), actions=[])
    if source == 'image':
        job_id = row['id'] if kind == 'tasks' else row['job_id']
        value['href'] = '/image-playground/?job=' + job_id
        value['reuse_href'] = '/image-playground/?reuse=' + job_id
        if kind == 'assets':
            value.update(mime=row['mime'], bytes=row['bytes'], expires_at=None,
                         preview_url='/api/image/assets/' + row['id'],
                         download_url='/api/image/assets/' + row['id'] + '?download=1')
            if status == 'save_failed':
                value['actions'].append({'type': 'retry_save', 'label': '重试保存',
                                         'endpoint': '/api/image/images/' + row['id'] + '/retry'})
            value['actions'].append({'type': 'delete_asset', 'label': '删除作品',
                                     'endpoint': '/api/image/images/' + row['id']})
    else:
        param = ('form=' + row['form_id']) if source == 'music' and row.get('form_id') else ('conversation=' + row['conversation_id']) if row.get('conversation_id') else ''
        value['href'] = '/ai/' + source + '/' + ('?' + param if param else '')
        if kind == 'tasks' and status in ('queued', 'running', 'saving'):
            value['actions'].append({'type': 'cancel', 'label': '取消任务',
                                     'endpoint': '/api/ai/v1/tasks/' + row['id'] + '/cancel'})
        if kind == 'assets':
            value.update(mime=row['mime'], bytes=row['bytes'], duration=row['duration'],
                         expires_at=row['created'] + 90 * 86400,
                         preview_url='/api/ai/v1/assets/' + row['id'] + '/audio',
                         download_url='/api/ai/v1/assets/' + row['id'] + '/audio?download=1',
                         reuse_href=value['href'])
            value['actions'].extend([
                {'type': 'reuse_music', 'label': '复用参数', 'endpoint': '/api/ai/v1/tasks/' + row['task_id']},
                {'type': 'delete_asset', 'label': '删除作品', 'endpoint': '/api/ai/v1/assets/' + row['id']},
            ])
            value['task_id'] = row['task_id']
    return value


def dispatch(service, user, method, path, query):
    kind = path.rsplit('/', 1)[-1]
    if kind not in ('tasks', 'assets'):
        raise Problem(404, '接口不存在。')
    if method != 'GET':
        raise Problem(405, '门户索引为只读接口。')
    source, state = query.get('source', ['all'])[0], query.get('status', ['all'])[0]
    if source not in ('all', 'image', 'music', 'chat') or (kind == 'assets' and source == 'chat') or state not in ('all', *STATES):
        raise Problem(400, '筛选参数无效。')
    try:
        limit = int(query.get('limit', ['24'])[0])
        if not 1 <= limit <= 50:
            raise ValueError()
    except ValueError:
        raise Problem(400, '每页数量应为 1–50。')
    cursor = decode_cursor(query.get('cursor', [''])[0], kind, source, state)
    now = int(time.time())
    results, sources = [], []
    service.store.rate_limit('hub:' + user['id'], 120, 60)
    # Each source is independent: a failed source is explicitly marked, never
    # converted into an empty successful collection. No exception text is exposed.
    for adapter in ('image', 'ai'):
        if (adapter == 'image' and source not in ('all', 'image')) or (adapter == 'ai' and source == 'image'):
            continue
        try:
            with service.store.connect() as db:
                if adapter == 'image':
                    rows = image_rows(db, user, kind)
                else:
                    allowed = permitted_kinds(db, user, now)
                    if source != 'all':
                        allowed = [k for k in allowed if k == source]
                    if kind == 'assets':
                        allowed = [k for k in allowed if k == 'music']
                    if not allowed:
                        sources.append({'id': adapter, 'status': 'permission_required'})
                        continue
                    rows = ai_rows(db, user, kind, allowed, now)
                rows = page_rows(db, rows, adapter, state, cursor, limit)
                results.extend(public_row(row, adapter, kind) for row in rows)
            sources.append({'id': adapter, 'status': 'ok'})
        except sqlite3.DatabaseError:
            sources.append({'id': adapter, 'status': 'unavailable'})
    results.sort(key=lambda item: (item['created'], item['key']), reverse=True)
    items = results[:limit]
    has_more = len(results) > limit
    return 200, {'user_id': user['id'], 'items': items, 'sources': sources,
                 'next_cursor': encode_cursor(kind, source, state, items[-1]) if has_more else None,
                 'partial': any(s['status'] == 'unavailable' for s in sources)}, {}
