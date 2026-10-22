"""AI workspace API. All reservations and state transitions use SQLite transactions.

This package deliberately shares the image/forum/terminal identity and storage.
No provider is enabled by a migration, and no external call is made on startup.
"""
import concurrent.futures
import hashlib
import json
import logging
import math
import shutil
import re
import secrets
import sqlite3
import threading
import time
from urllib.parse import parse_qs, quote, urlsplit

from .ai_providers import MAX_AUDIO, Providers, UnknownOutcome, inspect_audio, validate_base
from .ai_schema import DEFAULT_MODELS, SCHEMA
from .ai_security import AIProblem, check_key, day_key, fail, fingerprint, music_fields, new_totp_secret, packed, text, uid, verify_totp
from .security import Problem, password_matches

API = '/api/ai/v1'
TERMINAL = ('SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')
ACTIVE = ('QUEUED', 'DISPATCHING', 'RUNNING', 'SAVING', 'CANCEL_REQUESTED', 'RECONCILING')
LOGGER = logging.getLogger('strgo-ai')


class EventStream:
    def __init__(self, service, user_id, session_hash, task_id, after):
        self.service, self.user_id, self.session_hash, self.task_id, self.after = service, user_id, session_hash, task_id, after

    def write(self, handler):
        service = self.service
        with service.lock:
            if service.user_streams.get(self.user_id, 0) >= 4:
                handler.send_error(429)
                return
            service.user_streams[self.user_id] = service.user_streams.get(self.user_id, 0) + 1
        if not service.stream_slots.acquire(blocking=False):
            with service.lock:
                service.user_streams[self.user_id] -= 1
            handler.send_error(503)
            return
        try:
            handler.send_response(200)
            for key, value in {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store',
                               'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff', 'Connection': 'close'}.items():
                handler.send_header(key, value)
            handler.end_headers()
            handler.close_connection = True
            handler.connection.settimeout(20)
            deadline, heartbeat = time.monotonic() + 55, 0
            while time.monotonic() < deadline and not service.stopping.is_set():
                with service.store.connect() as db:
                    session = db.execute('SELECT 1 FROM sessions WHERE hash=? AND user_id=? AND expires>?', (self.session_hash, self.user_id, int(time.time()))).fetchone()
                    member = service.member(db, self.user_id)
                    if not session or member['status'] != 'active':
                        break
                    task = service.owned(db, 'ai_tasks', self.task_id, self.user_id)
                    events = db.execute('SELECT * FROM ai_events WHERE task_id=? AND seq>? ORDER BY seq LIMIT 100', (self.task_id, self.after)).fetchall()
                for event in events:
                    handler.wfile.write(f'id: {event["seq"]}\nevent: {event["type"]}\ndata: {event["data"]}\n\n'.encode())
                    self.after = event['seq']
                if time.monotonic() >= heartbeat:
                    handler.wfile.write(b': heartbeat\n\n')
                    heartbeat = time.monotonic() + 15
                handler.wfile.flush()
                if task['state'] in TERMINAL and len(events) < 100:
                    break
                service.stopping.wait(.25)
        except (OSError, Problem):
            pass  # A closed browser never cancels the durable task.
        finally:
            service.stream_slots.release()
            with service.lock:
                service.user_streams[self.user_id] -= 1
                if not service.user_streams[self.user_id]:
                    del service.user_streams[self.user_id]


class AIService:
    def __init__(self, accounts, start_worker=True, providers=None):
        self.accounts, self.store, self.storage = accounts, accounts.store, accounts.storage
        self.providers = providers or Providers()
        self.worker_id = uid()
        self.stopping = threading.Event()
        self.stream_slots = threading.BoundedSemaphore(32)
        self.user_streams = {}
        self.inflight = set()
        self.lock = threading.Lock()
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix='ai')
        self.health_pool = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix='ai-health')
        self.health_inflight = set()
        with self.store.connect() as db:
            db.executescript(SCHEMA)
            for model_id, name, kind, adapter, locality, config in DEFAULT_MODELS:
                config.update(adapter=adapter, locality=locality)
                db.execute('INSERT OR IGNORE INTO ai_models VALUES(?,?,?,?,?,1,0,0,?,?)',
                           (model_id, name, kind, adapter, locality, self.encrypt(config), int(time.time())))
        self.recover_deletions()
        self.worker = threading.Thread(target=self.loop, name='ai-scheduler', daemon=True) if start_worker else None
        if self.worker:
            self.worker.start()

    def close(self):
        self.stopping.set()
        if self.worker:
            self.worker.join(timeout=3)
        self.pool.shutdown(wait=True)
        self.health_pool.shutdown(wait=True)

    def encrypt(self, value):
        return self.store.cipher.encrypt(packed(value).encode())

    def decrypt(self, value):
        return json.loads(self.store.cipher.decrypt(value))

    def audit(self, db, actor, action, resource='', detail=None):
        # Call sites supply metadata only; prompts, lyrics and credentials never enter audit.
        db.execute('INSERT INTO ai_audit VALUES(?,?,?,?,?,?)', (uid(), actor, action, resource, packed(detail or {}), int(time.time())))

    def record_deletion(self, db, identifier, object_key, now):
        record = {'id': identifier, 'object_key': object_key, 'created': now}
        # Monotonic deletion intent is independent of older database snapshots.
        self.store.stage('deletion-' + identifier, packed(record).encode())
        db.execute('INSERT OR IGNORE INTO ai_tombstones VALUES(?,?,?)', (identifier, object_key, now))

    def recover_deletions(self):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for path in self.store.spool.glob('deletion-*.enc'):
                record = json.loads(self.store.pending_bytes(path.stem))
                identifier, key = record.get('id', ''), record.get('object_key', '')
                if not re.fullmatch(r'[a-f0-9]{32}', identifier) or path.stem != 'deletion-' + identifier:
                    raise RuntimeError('AI 删除意图日志校验失败；请先核对备份。')
                if key == 'conversation:' + identifier:
                    self.erase_conversation(db, identifier)
                elif key.startswith(self.storage.key('ai/audio/')):
                    db.execute('UPDATE ai_assets SET deleted=1 WHERE id=? OR object_key=?', (identifier, key))
                else:
                    raise RuntimeError('AI 删除日志资源类型无效。')
                db.execute('INSERT OR IGNORE INTO ai_tombstones VALUES(?,?,?)', (identifier, key, record['created']))

    @staticmethod
    def erase_conversation(db, identifier):
        db.execute("UPDATE ai_conversations SET deleted=1,title='已删除' WHERE id=?", (identifier,))
        db.execute("UPDATE ai_messages SET content='' WHERE conversation_id=?", (identifier,))
        db.execute("UPDATE ai_tasks SET input='{}',output='' WHERE conversation_id=?", (identifier,))
        db.execute('DELETE FROM ai_events WHERE task_id IN (SELECT id FROM ai_tasks WHERE conversation_id=?)', (identifier,))

    def member(self, db, user_id):
        existing = db.execute('SELECT * FROM ai_members WHERE user_id=?', (user_id,)).fetchone()
        if existing:
            return existing
        db.execute('INSERT OR IGNORE INTO ai_members(user_id) VALUES(?)', (user_id,))
        return db.execute('SELECT * FROM ai_members WHERE user_id=?', (user_id,)).fetchone()

    def owned(self, db, table, resource_id, user_id):
        assert table in ('ai_conversations', 'ai_forms', 'ai_drafts', 'ai_tasks', 'ai_assets', 'ai_quotes')
        if not isinstance(resource_id, str) or not re.fullmatch(r'[a-f0-9]{32}', resource_id):
            fail(404, 'NOT_FOUND', '资源不存在。')
        row = db.execute(f'SELECT * FROM {table} WHERE id=? AND user_id=?', (resource_id, user_id)).fetchone()
        if not row or ('deleted' in row.keys() and row['deleted']):
            fail(404, 'NOT_FOUND', '资源不存在。')
        return row

    def authorize(self, db, user, kind, model_id=None):
        member = self.member(db, user['id'])
        control = db.execute('SELECT status FROM account_controls WHERE user_id=?', (user['id'],)).fetchone()
        if member['status'] != 'active' or (control and control['status'] != 'active'):
            fail(403, 'ACCOUNT_DISABLED', '账号已停用。')
        if not member[kind] or (member['expires'] is not None and member['expires'] <= int(time.time())):
            fail(403, 'PERMISSION_REQUIRED', '当前模块尚未授权或授权已过期，请申请权限。')
        if model_id and not db.execute('SELECT 1 FROM ai_model_grants WHERE user_id=? AND model_id=?', (user['id'], model_id)).fetchone():
            fail(403, 'MODEL_PERMISSION_REQUIRED', '没有该模型的使用权限。')
        return member

    def require_admin(self, db, user, mutation=False):
        current = db.execute("""SELECT u.role FROM users u JOIN sessions s ON s.user_id=u.id
            LEFT JOIN account_controls c ON c.user_id=u.id LEFT JOIN ai_members m ON m.user_id=u.id
            WHERE u.id=? AND s.hash=? AND s.expires>? AND COALESCE(c.status,'active')='active'
            AND COALESCE(m.status,'active')='active'""", (user['id'], user['session_hash'], int(time.time()))).fetchone()
        if not current or current['role'] != 'admin':
            fail(403, 'ADMIN_REQUIRED', '仅管理员可访问。')
        if mutation and not db.execute('SELECT 1 FROM ai_stepups WHERE session_hash=? AND expires>?', (user['session_hash'], int(time.time()))).fetchone():
            fail(403, 'MFA_REQUIRED', '管理操作需要验证动态口令，有效期五分钟。')

    def public_model(self, row, admin=False):
        config = self.decrypt(row['config'])
        value = {k: row[k] for k in ('id', 'name', 'kind', 'adapter', 'locality', 'revision', 'enabled', 'verified', 'updated')}
        value['model'] = config.get('model', '')
        value['resource_group'] = config.get('resource_group', '')
        value['available'] = bool(row['enabled'] and row['verified'])
        if row['locality'] == 'local':
            with self.store.connect() as db:
                node = db.execute('SELECT health,draining,checked FROM ai_nodes WHERE id=?', (config.get('node_id'),)).fetchone()
            value['available'] = bool(value['available'] and node and node['health'] == 'online' and not node['draining'] and node['checked'] and node['checked'] > int(time.time()) - 90)
        if admin:
            value['config'] = {k: v for k, v in config.items() if k != 'api_key'}
            value['has_key'] = bool(config.get('api_key'))
        return value

    def usage(self, db, user):
        member = self.member(db, user['id'])
        today = day_key()
        result = {'day': today, 'timezone': 'Asia/Shanghai'}
        for kind in ('chat', 'music'):
            row = db.execute('SELECT * FROM ai_usage WHERE user_id=? AND day=? AND kind=?', (user['id'], today, kind)).fetchone()
            used, reserved = (row['used'], row['reserved']) if row else (0, 0)
            result[kind] = {'limit': member[kind + '_limit'], 'used': used, 'reserved': reserved, 'remaining': max(0, member[kind + '_limit'] - used - reserved)}
        result['storage'] = {'limit': member['storage_limit'], 'used': db.execute('SELECT COALESCE(SUM(bytes),0) FROM ai_assets WHERE user_id=? AND (deleted=0 OR delete_pending=1)', (user['id'],)).fetchone()[0],
                             'reserved': db.execute('SELECT COALESCE(SUM(storage_bytes),0) FROM ai_reservations WHERE user_id=? AND settled=0', (user['id'],)).fetchone()[0]}
        return result

    def event(self, db, task_id, event_type, data):
        seq = db.execute('SELECT COALESCE(MAX(seq),0)+1 FROM ai_events WHERE task_id=?', (task_id,)).fetchone()[0]
        db.execute('INSERT INTO ai_events VALUES(?,?,?,?,?)', (task_id, seq, event_type, packed(data), int(time.time())))

    def task_public(self, db, row):
        result = {k: row[k] for k in ('id', 'kind', 'conversation_id', 'form_id', 'model_id', 'model_revision', 'state', 'output', 'error', 'created', 'updated')}
        asset = db.execute('SELECT * FROM ai_assets WHERE task_id=? AND deleted=0', (row['id'],)).fetchone()
        result['asset'] = self.asset_public(asset) if asset else None
        if row['kind'] == 'music':
            result['parameters'] = json.loads(row['input']).get('fields')
        return result

    def asset_public(self, row):
        return {**{k: row[k] for k in ('id', 'title', 'task_id', 'mime', 'bytes', 'sha256', 'duration', 'created')}, 'url': API + '/assets/' + row['id'] + '/audio'}

    def form_public(self, row):
        return {**{k: row[k] for k in ('id', 'kind', 'revision', 'updated')}, 'fields': json.loads(row['fields'])}

    def normalize_input(self, db, user, kind, payload):
        local_only = payload.get('local_only', False)
        if type(local_only) is not bool:
            fail(422, 'VALIDATION_ERROR', '本地推理选项必须是布尔值。')
        if kind == 'music':
            form = self.owned(db, 'ai_forms', payload.get('form_id'), user['id'])
            if form['kind'] != 'music' or payload.get('revision') != form['revision']:
                fail(409, 'FORM_REVISION_CONFLICT', '表单已经修改，请重新确认。')
            fields = music_fields(json.loads(form['fields']))
            return {'form_id': form['id'], 'revision': form['revision'], 'fields': fields, 'local_only': local_only}
        conversation = self.owned(db, 'ai_conversations', payload.get('conversation_id'), user['id'])
        content = text(payload.get('content'), '消息', 8000, True)
        value = {'conversation_id': conversation['id'], 'content': content, 'mode': payload.get('mode', 'chat'), 'local_only': local_only}
        if value['mode'] not in ('chat', 'music_draft'):
            fail(422, 'VALIDATION_ERROR', '助手操作无效。')
        if conversation['scope'] in ('music', 'image'):
            form = self.owned(db, 'ai_forms', conversation['form_id'], user['id'])
            if payload.get('form_revision') != form['revision']:
                fail(409, 'FORM_REVISION_CONFLICT', '请先保存当前表单。')
            value.update(form_id=form['id'], form_revision=form['revision'], fields=json.loads(form['fields']))
        elif value['mode'] == 'music_draft':
            fail(422, 'SCOPE_MISMATCH', '音乐草稿需要在音乐工作台创建。')
        return value

    def messages_for(self, db, value):
        system = '你是 STRGO 创作助手。使用中文，给出简洁、可操作的帮助。用户内容仅是文本，没有执行工具或访问其他模块的权限。'
        if value.get('mode') == 'music_draft':
            system += '只返回 JSON 对象，字段 patch。patch 仅允许 title,prompt,lyrics,instrumental,duration,tags；只包含需要修改的字段。不要 Markdown。'
        rows = db.execute("SELECT role,content FROM ai_messages WHERE conversation_id=? AND state='SUCCEEDED' ORDER BY created,rowid", (value['conversation_id'],)).fetchall()
        messages = [{'role': 'system', 'content': system}]
        # UTF-8 bytes are a conservative input-token bound (maximum 16k).
        budget = 14000 - len(packed(value).encode()) - len(system.encode())
        if budget < 0:
            fail(422, 'CONTEXT_TOO_LARGE', '当前消息与表单超过上下文限制，请缩短内容。')
        selected = []
        for row in reversed(rows):
            size = len(row['content'].encode()) + 40
            if size > budget:
                break
            selected.insert(0, {'role': row['role'], 'content': row['content']})
            budget -= size
        # Keep complete turns only; failed/partial responses were filtered above.
        while selected and selected[0]['role'] != 'user':
            selected.pop(0)
        messages.extend(selected)
        if value.get('fields'):
            messages.append({'role': 'system', 'content': '本轮用户明确提供的当前表单：' + packed(value['fields'])})
        messages.append({'role': 'user', 'content': value['content']})
        return messages

    def estimate(self, config, kind, value):
        if config['locality'] == 'local':
            return 0, 'LOCAL'
        currency = config.get('currency')
        if currency not in ('CNY', 'USD'):
            fail(409, 'PRICE_NOT_CONFIGURED', '管理员尚未配置价格和币种。')
        fields = ('input_price', 'output_price') if kind == 'chat' else ('second_price',)
        if any(type(config.get(v)) is not int or config[v] < 0 for v in fields) or not config.get('price_version'):
            fail(409, 'PRICE_NOT_CONFIGURED', '该在线模型尚未登记有效价格版本。')
        # Prices are integer micro currency units per token / per second, rounded up by the operator.
        cost = 16000 * config['input_price'] + config.get('max_output', 2048) * config['output_price'] if kind == 'chat' else value['fields']['duration'] * config['second_price']
        return cost, currency

    def quote(self, db, user, kind, payload):
        self.authorize(db, user, kind)
        model_id = payload.get('model_id')
        if not isinstance(model_id, str) or not re.fullmatch(r'[a-z0-9-]{1,64}', model_id):
            fail(422, 'VALIDATION_ERROR', '请选择有效模型。')
        self.authorize(db, user, kind, model_id)
        row = db.execute('SELECT * FROM ai_models WHERE id=? AND kind=? AND enabled=1 AND verified=1', (model_id, kind)).fetchone()
        if not row:
            fail(409, 'MODEL_UNAVAILABLE', '该模型尚未连接或已停用，请联系管理员。')
        config = self.decrypt(row['config'])
        if config['locality'] == 'local':
            node = db.execute('SELECT * FROM ai_nodes WHERE id=?', (config.get('node_id'),)).fetchone()
            if not node or node['health'] != 'online' or node['draining'] or not node['checked'] or node['checked'] < int(time.time()) - 90:
                fail(409, 'NODE_UNAVAILABLE', '所选本地节点暂不可用或正在排空，请稍后重试。')
        value = self.normalize_input(db, user, kind, payload)
        if value['local_only'] and config['locality'] != 'local':
            fail(403, 'LOCAL_ONLY', '已选择仅本地推理，不能使用在线 API。')
        if kind == 'chat':
            value['messages'] = self.messages_for(db, value)
        if kind == 'music' and config['adapter'] == 'eleven':
            if value['fields'].get('bpm') is not None or value['fields'].get('key') or (value['fields']['instrumental'] and value['fields'].get('seed') is not None):
                fail(422, 'UNSUPPORTED_PARAMETER', '当前在线音乐模型不支持这些高级参数。')
            if config['model'] != 'music_v1':
                fail(422, 'UNSUPPORTED_MODEL_VERSION', '当前适配器只发布 music_v1，请验证新版计划结构后再扩展。')
            if any(len(line) > 200 for line in value['fields']['lyrics'].splitlines()):
                fail(422, 'VALIDATION_ERROR', '当前在线音乐模型要求每行歌词不超过200字。')
        maximum, currency = self.estimate(config, kind, value)
        if config['locality'] == 'cloud' and not db.execute('SELECT 1 FROM ai_budgets WHERE currency=?', (currency,)).fetchone():
            fail(409, 'BUDGET_NOT_CONFIGURED', '在线 API 尚未设置日预算和月预算。')
        identifier, expires = uid(), int(time.time()) + 300
        units = 1 if kind == 'chat' else value['fields']['duration']
        db.execute('INSERT INTO ai_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)', (identifier, user['id'], model_id, row['revision'], kind, fingerprint(value), self.encrypt(config), units, maximum, currency, expires))
        return {'id': identifier, 'expires': expires, 'kind': kind, 'units': units, 'max_cost_micro': maximum, 'currency': currency, 'locality': config['locality'], 'model_revision': row['revision']}

    def submit(self, db, user, kind, payload, headers):
        now = int(time.time())
        key = check_key(headers.get('idempotency-key'), now)
        request_hash = fingerprint({'kind': kind, 'payload': payload})
        previous = db.execute('SELECT * FROM ai_idempotency WHERE user_id=? AND key=?', (user['id'], key)).fetchone()
        if previous:
            if previous['input_hash'] != request_hash:
                fail(409, 'IDEMPOTENCY_CONFLICT', '相同请求标识不能用于不同内容。')
            return self.task_public(db, self.owned(db, 'ai_tasks', previous['resource_id'], user['id']))
        quote_row = self.owned(db, 'ai_quotes', payload.get('quote_id'), user['id'])
        member = self.authorize(db, user, kind, quote_row['model_id'])
        if quote_row['kind'] != kind or quote_row['expires'] <= now or quote_row['consumed']:
            fail(409, 'QUOTE_EXPIRED', '确认信息已过期或已使用，请重新确认。')
        model = db.execute('SELECT * FROM ai_models WHERE id=?', (quote_row['model_id'],)).fetchone()
        if not model['enabled'] or not model['verified'] or model['revision'] != quote_row['revision']:
            fail(409, 'MODEL_REVISION_CONFLICT', '模型配置已更新，请重新确认。')
        value = self.normalize_input(db, user, kind, payload)
        if kind == 'chat':
            value['messages'] = self.messages_for(db, value)
        if fingerprint(value) != quote_row['input_hash']:
            fail(409, 'QUOTE_INPUT_CHANGED', '内容已修改，请重新确认。')
        busy = db.execute("SELECT COUNT(*) FROM ai_tasks WHERE user_id=? AND kind=? AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')", (user['id'], kind)).fetchone()[0]
        if kind == 'chat' and db.execute("SELECT 1 FROM ai_tasks WHERE conversation_id=? AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')", (value['conversation_id'],)).fetchone():
            fail(409, 'CONVERSATION_BUSY', '该对话正在回复，请等待或停止当前回复。')
        if busy >= (1 if kind == 'chat' else 4):
            fail(429, 'CONCURRENCY_LIMIT', '已达到并发或排队上限，请等待现有任务完成。')
        today = day_key(now)
        db.execute('INSERT OR IGNORE INTO ai_usage(user_id,day,kind) VALUES(?,?,?)', (user['id'], today, kind))
        changed = db.execute('UPDATE ai_usage SET reserved=reserved+? WHERE user_id=? AND day=? AND kind=? AND used+reserved+?<=?', (quote_row['units'], user['id'], today, kind, quote_row['units'], member[kind + '_limit'])).rowcount
        if not changed:
            fail(429, 'QUOTA_EXCEEDED', '今日额度不足，预占额度将在任务结束后结算。')
        storage_bytes = MAX_AUDIO if kind == 'music' else 0
        usage = self.usage(db, user)['storage']
        if usage['used'] + usage['reserved'] + storage_bytes > member['storage_limit']:
            fail(409, 'STORAGE_QUOTA_EXCEEDED', '私有存储空间不足，请先删除作品。')
        cost, currency = quote_row['max_cost'], quote_row['currency']
        if currency != 'LOCAL':
            budget = db.execute('SELECT * FROM ai_budgets WHERE currency=?', (currency,)).fetchone()
            if not budget:
                fail(409, 'BUDGET_NOT_CONFIGURED', '平台预算尚未配置。')
            for period, limit in ((today, budget['daily']), (today[:7], budget['monthly'])):
                db.execute('INSERT OR IGNORE INTO ai_costs(period,currency) VALUES(?,?)', (period, currency))
                if not db.execute('UPDATE ai_costs SET reserved=reserved+? WHERE period=? AND currency=? AND used+reserved+?<=?', (cost, period, currency, cost, limit)).rowcount:
                    fail(429, 'BUDGET_EXCEEDED', '平台在线 API 预算不足，请稍后重试或选用本地模型。')
        identifier = uid()
        config = self.decrypt(quote_row['config'])
        db.execute('INSERT INTO ai_tasks(id,user_id,kind,conversation_id,form_id,model_id,model_revision,config,input,state,created,updated,resource_group) VALUES(?,?,?,?,?,?,?,?,?,\'QUEUED\',?,?,?)',
                   (identifier, user['id'], kind, value.get('conversation_id'), value.get('form_id'), model['id'], model['revision'], quote_row['config'], packed(value), now, now, config.get('resource_group')))
        db.execute('INSERT INTO ai_reservations VALUES(?,?,?,?,?,?,?,?,0,NULL,0)', (identifier, user['id'], today, kind, quote_row['units'], storage_bytes, cost, currency))
        db.execute('INSERT INTO ai_idempotency VALUES(?,?,?,?,?)', (user['id'], key, request_hash, identifier, now))
        db.execute('UPDATE ai_quotes SET consumed=? WHERE id=?', (identifier, quote_row['id']))
        if kind == 'chat':
            db.execute('INSERT INTO ai_messages VALUES(?,?,?,?,?,?,?)', (uid(), value['conversation_id'], identifier, 'user', value['content'], 'QUEUED', now))
            db.execute('UPDATE ai_conversations SET updated=?,title=CASE WHEN title=\'新对话\' THEN ? ELSE title END WHERE id=?', (now, value['content'][:30], value['conversation_id']))
        self.event(db, identifier, 'state', {'state': 'QUEUED'})
        self.audit(db, user['id'], 'task.create', identifier, {'kind': kind, 'model_id': model['id'], 'revision': model['revision']})
        return self.task_public(db, self.owned(db, 'ai_tasks', identifier, user['id']))

    def settle(self, db, task, state, error='', cost=None, provisional=False):
        if task['state'] in TERMINAL:
            return
        reservation = db.execute('SELECT * FROM ai_reservations WHERE task_id=?', (task['id'],)).fetchone()
        if reservation and not reservation['settled']:
            consume = reservation['units'] if (state == 'SUCCEEDED' or (task['kind'] == 'chat' and task['dispatched'])) else 0
            actual = cost if cost is not None else (reservation['max_cost'] if task['dispatched'] else 0)
            db.execute('UPDATE ai_usage SET reserved=MAX(0,reserved-?),used=used+? WHERE user_id=? AND day=? AND kind=?', (reservation['units'], consume, task['user_id'], reservation['day'], task['kind']))
            if reservation['currency'] != 'LOCAL':
                for period in (reservation['day'], reservation['day'][:7]):
                    db.execute('UPDATE ai_costs SET reserved=MAX(0,reserved-?),used=used+? WHERE period=? AND currency=?', (reservation['max_cost'], actual, period, reservation['currency']))
            db.execute('UPDATE ai_reservations SET settled=1,cost=?,provisional=?,storage_bytes=0 WHERE task_id=? AND settled=0', (actual, int(provisional), task['id']))
            if actual > reservation['max_cost']:
                db.execute('UPDATE ai_models SET enabled=0 WHERE id=?', (task['model_id'],))
                self.audit(db, 'worker', 'model.price_overrun', task['model_id'], {'actual': actual, 'reserved': reservation['max_cost']})
        db.execute('UPDATE ai_tasks SET state=?,error=?,updated=?,lease_until=0 WHERE id=?', (state, error, int(time.time()), task['id']))
        if not (provisional and task['dispatched'] and self.decrypt(task['config'])['locality'] == 'local'):
            db.execute('DELETE FROM ai_leases WHERE task_id=?', (task['id'],))
        if task['kind'] == 'chat':
            db.execute('UPDATE ai_messages SET state=? WHERE task_id=?', (state, task['id']))
            if task['output'] and not db.execute("SELECT 1 FROM ai_messages WHERE task_id=? AND role='assistant'", (task['id'],)).fetchone():
                db.execute('INSERT INTO ai_messages VALUES(?,?,?,?,?,?,?)', (uid(), task['conversation_id'], task['id'], 'assistant', task['output'], state, int(time.time())))
        self.event(db, task['id'], 'state', {'state': state, 'error': error})
        self.audit(db, 'worker', 'task.settle', task['id'], {'state': state, 'provisional': provisional})

    def dispatch(self, method, target, payload, headers, ip):
        url = urlsplit(target)
        path, query = url.path[len(API):].rstrip('/') or '/', parse_qs(url.query)
        request_id = uid()
        headers = {k.lower(): v for k, v in (headers or {}).items()}
        if method not in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE'):
            fail(405, 'METHOD_NOT_ALLOWED', '不支持该请求方法。')
        if method != 'GET' and headers.get('origin') != self.accounts.origin:
            fail(403, 'ORIGIN_INVALID', '请从本站发起请求。')
        if path in ('/auth/login', '/auth/register') and method == 'POST':
            code, value, extra = self.accounts.dispatch(method, '/api/image/' + path.rsplit('/', 1)[-1], payload, headers, ip)
            return code, {'data': value, 'request_id': request_id}, extra
        user = self.accounts.session(headers)
        if path == '/session' and method == 'GET':
            with self.store.connect() as db:
                value = self.session_info(db, user)
            return 200, {'data': value, 'request_id': request_id}, self.accounts.shared_cookie(headers, user)
        if not user:
            fail(401, 'AUTH_REQUIRED', '请先使用 STRGO 账号登录。')
        if method != 'GET' and not secrets.compare_digest(headers.get('x-csrf-token', ''), user['csrf']):
            fail(403, 'CSRF_INVALID', '登录校验已失效，请刷新页面。')
        self.store.rate_limit('ai-api:' + user['id'], 240, 60)
        if path == '/admin/mfa/verify' and method == 'POST':
            self.store.rate_limit('ai-mfa:' + user['id'], 6, 300)
        check = re.fullmatch(r'/admin/models/([a-z0-9-]{1,64})/check', path)
        if check and method == 'POST':
            # Never hold a database write lock during a network operation.
            with self.store.connect() as db:
                self.require_admin(db, user, True)
                model = db.execute('SELECT * FROM ai_models WHERE id=?', (check[1],)).fetchone()
                if not model:
                    fail(404, 'NOT_FOUND', '模型不存在。')
                config = self.decrypt(model['config'])
            self.providers.check(config)
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                self.require_admin(db, user, True)
                if not db.execute('UPDATE ai_models SET verified=1,updated=? WHERE id=? AND revision=?', (int(time.time()), model['id'], model['revision'])).rowcount:
                    fail(409, 'MODEL_REVISION_CONFLICT', '配置在检查过程中发生变化，请重试。')
                if config.get('node_id'):
                    db.execute("UPDATE ai_nodes SET health='online',checked=? WHERE id=?", (int(time.time()), config['node_id']))
                self.audit(db, user['id'], 'model.check', model['id'], {'billable': False})
            self.accounts.dirty()
            return 200, {'data': {'ok': True, 'billable': False}, 'request_id': request_id}, {}
        with self.store.connect() as db:
            if method != 'GET':
                db.execute('BEGIN IMMEDIATE')
            member = self.member(db, user['id'])
            if member['status'] != 'active':
                fail(403, 'ACCOUNT_DISABLED', '账号已停用。')
            status, value, extra = self.route(db, user, method, path, query, payload, headers)
        if method != 'GET':
            self.accounts.dirty()
        if isinstance(value, (bytes, EventStream)):
            return status, value, extra
        return status, {'data': value, 'request_id': request_id}, extra

    def session_info(self, db, user):
        if not user:
            return {'user': None, 'csrf': None}
        member = self.member(db, user['id'])
        mfa = db.execute('SELECT confirmed FROM ai_mfa WHERE user_id=?', (user['id'],)).fetchone()
        verified = db.execute('SELECT expires FROM ai_stepups WHERE session_hash=? AND expires>?', (user['session_hash'], int(time.time()))).fetchone()
        return {'user': self.accounts.user_info(user), 'csrf': user['csrf'], 'permissions': dict(member),
                'demo': bool(getattr(self, 'demo', False)),
                'model_grants': [r[0] for r in db.execute('SELECT model_id FROM ai_model_grants WHERE user_id=?', (user['id'],))],
                'usage': self.usage(db, user), 'mfa_enrolled': bool(mfa and mfa['confirmed']), 'stepup_expires': verified[0] if verified else None,
                'storage_ready': bool(self.storage.ready)}

    def route(self, db, user, method, path, query, payload, headers):
        now = int(time.time())
        if path == '/auth/logout' and method == 'POST':
            db.execute('DELETE FROM sessions WHERE hash=?', (user['session_hash'],))
            return 200, {'ok': True}, {'Set-Cookie': self.accounts.set_cookie('', 0)}
        if path == '/usage' and method == 'GET':
            return 200, self.usage(db, user), {}
        if path == '/models' and method == 'GET':
            rows = db.execute('SELECT m.* FROM ai_models m JOIN ai_model_grants g ON g.model_id=m.id WHERE g.user_id=? AND m.enabled=1 AND m.verified=1 ORDER BY m.locality DESC,m.id', (user['id'],)).fetchall()
            return 200, [self.public_model(r) for r in rows], {}
        if path == '/access-requests':
            if method == 'GET':
                return 200, [dict(r) for r in db.execute('SELECT * FROM ai_requests WHERE user_id=? ORDER BY created DESC LIMIT 20', (user['id'],))], {}
            if method == 'POST':
                modules = payload.get('modules')
                if not isinstance(modules, list) or not modules or any(v not in ('chat', 'music') for v in modules):
                    fail(422, 'VALIDATION_ERROR', '请选择申请的模块。')
                reason = text(payload.get('reason', ''), '申请说明', 500)
                if db.execute("SELECT 1 FROM ai_requests WHERE user_id=? AND state='pending'", (user['id'],)).fetchone():
                    fail(409, 'REQUEST_PENDING', '已有待处理的申请。')
                identifier = uid()
                db.execute('INSERT INTO ai_requests(id,user_id,modules,reason,created) VALUES(?,?,?,?,?)', (identifier, user['id'], packed(modules), reason, now))
                return 201, {'id': identifier, 'state': 'pending'}, {}
        if path == '/forms' and method == 'POST':
            kind = payload.get('kind', 'music')
            if kind not in ('music', 'image'):
                fail(422, 'VALIDATION_ERROR', '表单类型无效。')
            fields = self.validate_form_fields(kind, payload.get('fields', {}))
            identifier = uid()
            db.execute('INSERT INTO ai_forms VALUES(?,?,?,1,?,?)', (identifier, user['id'], kind, packed(fields), now))
            return 201, self.form_public(self.owned(db, 'ai_forms', identifier, user['id'])), {}
        form_match = re.fullmatch(r'/forms/([a-f0-9]{32})', path)
        if form_match:
            row = self.owned(db, 'ai_forms', form_match[1], user['id'])
            if row['fields'] == '{}':
                fail(410, 'FORM_EXPIRED', '该草稿已过保存期限，请创建新的草稿。')
            if method == 'GET':
                return 200, self.form_public(row), {}
            if method in ('PUT', 'PATCH'):
                if payload.get('revision') != row['revision']:
                    fail(409, 'FORM_REVISION_CONFLICT', '表单已在其他窗口修改，请刷新。')
                fields = self.validate_form_fields(row['kind'], payload.get('fields', {}))
                db.execute('UPDATE ai_forms SET fields=?,revision=revision+1,updated=? WHERE id=? AND revision=?', (packed(fields), now, row['id'], row['revision']))
                return 200, self.form_public(self.owned(db, 'ai_forms', row['id'], user['id'])), {}
        if path == '/conversations':
            if method == 'GET':
                scope = query.get('scope', ['global'])[0]
                return 200, [dict(r) for r in db.execute('SELECT * FROM ai_conversations WHERE user_id=? AND scope=? AND deleted=0 ORDER BY updated DESC,id DESC LIMIT 100', (user['id'], scope))], {}
            if method == 'POST':
                scope, form_id = payload.get('scope', 'global'), payload.get('form_id')
                if scope not in ('global', 'music', 'image'):
                    fail(422, 'VALIDATION_ERROR', '对话场景无效。')
                if scope != 'global':
                    form = self.owned(db, 'ai_forms', form_id, user['id'])
                    if form['kind'] != scope:
                        fail(422, 'SCOPE_MISMATCH', '对话与表单场景不一致。')
                elif form_id is not None:
                    fail(422, 'SCOPE_MISMATCH', '普通对话不能绑定其他模块的表单。')
                identifier = uid()
                db.execute('INSERT INTO ai_conversations VALUES(?,?,?,?,?,?,?,0)', (identifier, user['id'], '新对话', scope, form_id, now, now))
                return 201, dict(self.owned(db, 'ai_conversations', identifier, user['id'])), {}
        conversation_match = re.fullmatch(r'/conversations/([a-f0-9]{32})(/messages|/transfer)?', path)
        if conversation_match:
            conversation = self.owned(db, 'ai_conversations', conversation_match[1], user['id'])
            suffix = conversation_match[2]
            if method == 'GET':
                messages = [dict(r) for r in db.execute('SELECT * FROM ai_messages WHERE conversation_id=? ORDER BY created,rowid', (conversation['id'],))]
                runs = [self.task_public(db, r) for r in db.execute("SELECT * FROM ai_tasks WHERE conversation_id=? ORDER BY created DESC LIMIT 5", (conversation['id'],))]
                drafts = [{**dict(r), 'patch': json.loads(r['patch'])} for r in db.execute('SELECT * FROM ai_drafts WHERE form_id=? AND user_id=? AND applied=0 AND expires>? ORDER BY expires DESC LIMIT 1', (conversation['form_id'], user['id'], now))] if conversation['form_id'] else []
                return 200, {'conversation': dict(conversation), 'messages': messages, 'runs': runs, 'drafts': drafts}, {}
            if method == 'DELETE' and not suffix:
                if db.execute("SELECT 1 FROM ai_tasks WHERE conversation_id=? AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')", (conversation['id'],)).fetchone():
                    fail(409, 'TASK_ACTIVE', '请先停止正在进行的回复。')
                self.record_deletion(db, conversation['id'], 'conversation:' + conversation['id'], now)
                self.erase_conversation(db, conversation['id'])
                return 200, {'ok': True}, {}
            if method == 'POST' and suffix == '/transfer':
                selected = payload.get('message_id')
                message = db.execute("SELECT * FROM ai_messages WHERE id=? AND conversation_id=? AND state='SUCCEEDED'", (selected, conversation['id'])).fetchone()
                if not message:
                    fail(404, 'NOT_FOUND', '选中的消息不存在。')
                content = text(payload.get('selection'), '选中文本', 3500, True)
                if content not in message['content']:
                    fail(422, 'SELECTION_INVALID', '仅可带入该消息中明确选中的文本。')
                identifier, target_conversation = uid(), uid()
                fields = {'title': '', 'prompt': '', 'lyrics': content, 'duration': 60, 'instrumental': False, 'tags': []}
                db.execute('INSERT INTO ai_forms VALUES(?,?,\'music\',1,?,?)', (identifier, user['id'], packed(fields), now))
                db.execute('INSERT INTO ai_conversations VALUES(?,?,?,\'music\',?,?,?,0)', (target_conversation, user['id'], '音乐创作', identifier, now, now))
                self.audit(db, user['id'], 'conversation.transfer', conversation['id'], {'target': target_conversation})
                return 201, {'form_id': identifier, 'conversation_id': target_conversation}, {}
        if path in ('/quotes/chat', '/quotes/music') and method == 'POST':
            return 201, self.quote(db, user, path.rsplit('/', 1)[-1], payload), {}
        if path in ('/runs', '/music/jobs') and method == 'POST':
            return 202, self.submit(db, user, 'chat' if path == '/runs' else 'music', payload, headers), {}
        if path in ('/tasks', '/music/jobs') and method == 'GET':
            rows = db.execute('SELECT * FROM ai_tasks WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 100', (user['id'],)).fetchall()
            return 200, [self.task_public(db, r) for r in rows if path == '/tasks' or r['kind'] == 'music'], {}
        task_match = re.fullmatch(r'/(?:tasks|runs|music/jobs)/([a-f0-9]{32})(/events|/cancel)?', path)
        if task_match:
            task = self.owned(db, 'ai_tasks', task_match[1], user['id'])
            if method == 'GET' and task_match[2] == '/events':
                try:
                    after = max(0, int(headers.get('last-event-id', query.get('after_seq', ['0'])[0])))
                except ValueError:
                    fail(400, 'INVALID_CURSOR', '事件游标无效。')
                first = db.execute('SELECT MIN(seq) FROM ai_events WHERE task_id=?', (task['id'],)).fetchone()[0]
                if (first and first > after + 1) or (first is None and task['created'] < now - 7 * 86400):
                    fail(410, 'EVENT_CURSOR_EXPIRED', '事件已超过保留期限，请读取任务快照。')
                return 200, EventStream(self, user['id'], user['session_hash'], task['id'], after), {}
            if method == 'GET' and not task_match[2]:
                return 200, self.task_public(db, task), {}
            if method == 'POST' and task_match[2] == '/cancel':
                if task['state'] not in TERMINAL:
                    db.execute('UPDATE ai_tasks SET cancel=1,updated=? WHERE id=?', (now, task['id']))
                    if not task['dispatched']:
                        self.settle(db, task, 'CANCELLED', cost=0)
                    else:
                        db.execute("UPDATE ai_tasks SET state='CANCEL_REQUESTED' WHERE id=?", (task['id'],))
                        self.event(db, task['id'], 'state', {'state': 'CANCEL_REQUESTED'})
                return 200, self.task_public(db, self.owned(db, 'ai_tasks', task['id'], user['id'])), {}
        draft_match = re.fullmatch(r'/drafts/([a-f0-9]{32})(/apply)?', path)
        if draft_match:
            draft = self.owned(db, 'ai_drafts', draft_match[1], user['id'])
            form = self.owned(db, 'ai_forms', draft['form_id'], user['id'])
            if draft['expires'] <= now:
                fail(410, 'DRAFT_EXPIRED', '建议已过期，请重新生成。')
            patch = json.loads(draft['patch'])
            if method == 'GET':
                return 200, {**dict(draft), 'patch': patch, 'before': json.loads(form['fields'])}, {}
            if method == 'POST' and draft_match[2] == '/apply':
                if draft['applied']:
                    return 200, self.form_public(form), {}
                if form['revision'] != draft['base_revision'] or payload.get('revision') != form['revision']:
                    fail(409, 'FORM_REVISION_CONFLICT', '表单已修改，不能覆盖当前内容。请重新起草。')
                merged = self.validate_form_fields(form['kind'], {**json.loads(form['fields']), **patch})
                db.execute('UPDATE ai_forms SET fields=?,revision=revision+1,updated=? WHERE id=?', (packed(merged), now, form['id']))
                db.execute('UPDATE ai_drafts SET applied=1 WHERE id=?', (draft['id'],))
                self.audit(db, user['id'], 'draft.apply', draft['id'], {'form_id': form['id']})
                return 200, self.form_public(self.owned(db, 'ai_forms', form['id'], user['id'])), {}
        if path == '/assets' and method == 'GET':
            return 200, [self.asset_public(r) for r in db.execute('SELECT * FROM ai_assets WHERE user_id=? AND deleted=0 ORDER BY created DESC LIMIT 100', (user['id'],))], {}
        asset_match = re.fullmatch(r'/assets/([a-f0-9]{32})(/audio)?', path)
        if asset_match:
            asset = self.owned(db, 'ai_assets', asset_match[1], user['id'])
            if method == 'DELETE' and not asset_match[2]:
                db.execute('UPDATE ai_assets SET deleted=1,delete_pending=1 WHERE id=?', (asset['id'],))
                self.record_deletion(db, asset['id'], asset['object_key'], now)
                return 200, {'ok': True}, {}
            if method == 'GET' and asset_match[2] == '/audio':
                data = self.storage.get(asset['object_key'])
                if hashlib.sha256(data).hexdigest() != asset['sha256']:
                    fail(503, 'ASSET_UNAVAILABLE', '音频校验失败，请联系管理员。')
                extra = {'Content-Type': asset['mime'], 'Accept-Ranges': 'bytes', 'Content-Disposition': ('attachment' if query.get('download') else 'inline') + '; filename="strgo-' + asset['id'] + ('.wav' if asset['mime'] == 'audio/wav' else '.mp3' if asset['mime'] == 'audio/mpeg' else '.flac') + '"'}
                range_header = headers.get('range')
                if range_header:
                    match = re.fullmatch(r'bytes=(\d*)-(\d*)', range_header)
                    if not match or not any(match.groups()):
                        fail(416, 'INVALID_RANGE', '音频范围无效。')
                    start = int(match[1]) if match[1] else max(0, len(data) - int(match[2]))
                    end = min(len(data) - 1, int(match[2])) if match[1] and match[2] else len(data) - 1
                    if start >= len(data) or start > end:
                        fail(416, 'INVALID_RANGE', '音频范围无效。')
                    extra['Content-Range'] = f'bytes {start}-{end}/{len(data)}'
                    return 206, data[start:end + 1], extra
                return 200, data, extra
        if path.startswith('/admin/'):
            return self.admin_route(db, user, method, path[6:], payload)
        fail(404, 'NOT_FOUND', '接口不存在。')

    def validate_form_fields(self, kind, fields):
        if kind == 'image':
            if not isinstance(fields, dict) or set(fields) != {'prompt'}:
                fail(422, 'VALIDATION_ERROR', '生图助手仅接受当前文字提示词。')
            return {'prompt': text(fields['prompt'], '提示词', 8000)}
        # Draft forms may be incomplete; strict generation validation happens at quote time.
        if not isinstance(fields, dict):
            fail(422, 'VALIDATION_ERROR', '表单内容无效。')
        for name in ('prompt', 'lyrics'):
            if name in fields and not isinstance(fields[name], str):
                fail(422, 'VALIDATION_ERROR', '风格和歌词必须是文字。')
        complete = {**fields, 'prompt': fields.get('prompt') or '草稿', 'lyrics': fields.get('lyrics') or '草稿'}
        validated = music_fields(complete)
        validated['prompt'], validated['lyrics'] = fields.get('prompt', ''), fields.get('lyrics', '')
        return validated

    def admin_route(self, db, user, method, path, payload):
        self.require_admin(db, user)
        now = int(time.time())
        if path == '/mfa/setup' and method == 'POST':
            if not password_matches(payload.get('password'), user['password']):
                fail(401, 'PASSWORD_INVALID', '请验证当前账号密码。')
            existing = db.execute('SELECT * FROM ai_mfa WHERE user_id=?', (user['id'],)).fetchone()
            if existing and existing['confirmed']:
                fail(409, 'MFA_ALREADY_ENROLLED', '动态口令已绑定；恢复请使用服务器 CLI。')
            secret = new_totp_secret()
            db.execute('INSERT OR REPLACE INTO ai_mfa VALUES(?,?,0,-1)', (user['id'], self.encrypt(secret)))
            self.audit(db, user['id'], 'mfa.setup')
            return 201, {'secret': secret, 'uri': 'otpauth://totp/STRGO:' + quote(user['username']) + '?secret=' + secret + '&issuer=STRGO&digits=6&period=30'}, {}
        if path == '/mfa/verify' and method == 'POST':
            record = db.execute('SELECT * FROM ai_mfa WHERE user_id=?', (user['id'],)).fetchone()
            if not record:
                fail(409, 'MFA_NOT_ENROLLED', '请先绑定动态口令。')
            counter = verify_totp(self.decrypt(record['secret']), payload.get('code'), record['last_counter'])
            db.execute('UPDATE ai_mfa SET confirmed=1,last_counter=? WHERE user_id=?', (counter, user['id']))
            db.execute('INSERT OR REPLACE INTO ai_stepups VALUES(?,?)', (user['session_hash'], now + 300))
            self.audit(db, user['id'], 'mfa.verify')
            return 200, {'expires': now + 300}, {}
        self.require_admin(db, user, method != 'GET')
        if path == '/models' and method == 'GET':
            return 200, [self.public_model(r, True) for r in db.execute('SELECT * FROM ai_models ORDER BY locality DESC,id')], {}
        model_match = re.fullmatch(r'/models/([a-z0-9-]{1,64})(/check)?', path)
        if model_match:
            row = db.execute('SELECT * FROM ai_models WHERE id=?', (model_match[1],)).fetchone()
            if not row:
                fail(404, 'NOT_FOUND', '模型不存在。')
            if method == 'POST' and model_match[2] == '/check':
                config = self.decrypt(row['config'])
                self.providers.check(config)
                db.execute('UPDATE ai_models SET verified=1,updated=? WHERE id=?', (now, row['id']))
                if config.get('node_id'):
                    db.execute("UPDATE ai_nodes SET health='online',checked=? WHERE id=?", (now, config['node_id']))
                self.audit(db, user['id'], 'model.check', row['id'], {'billable': False})
                return 200, {'ok': True, 'billable': False}, {}
            if method == 'PUT' and not model_match[2]:
                if payload.get('revision') != row['revision']:
                    fail(409, 'MODEL_REVISION_CONFLICT', '模型配置已更新，请刷新。')
                old = self.decrypt(row['config'])
                config = self.validate_model(db, row, payload.get('config', {}), old)
                changed = packed(config) != packed(old)
                enabled = payload.get('enabled', False)
                if type(enabled) is not bool:
                    fail(422, 'VALIDATION_ERROR', '启用状态无效。')
                if enabled and (changed or not row['verified']):
                    fail(409, 'MODEL_NOT_VERIFIED', '请先保存配置并检查连接，再启用模型。')
                if enabled and row['locality'] == 'cloud':
                    self.estimate(config, row['kind'], {'fields': {'duration': 60}})
                    if not db.execute('SELECT 1 FROM ai_budgets WHERE currency=?', (config.get('currency'),)).fetchone():
                        fail(409, 'BUDGET_NOT_CONFIGURED', '请先设置平台日预算与月预算。')
                db.execute('UPDATE ai_models SET name=?,config=?,revision=revision+1,enabled=?,verified=?,updated=? WHERE id=?', (text(payload.get('name', row['name']), '名称', 80, True), self.encrypt(config), int(enabled), 0 if changed else row['verified'], now, row['id']))
                self.audit(db, user['id'], 'model.update', row['id'], {'enabled': enabled, 'revision': row['revision'] + 1})
                return 200, self.public_model(db.execute('SELECT * FROM ai_models WHERE id=?', (row['id'],)).fetchone(), True), {}
        if path == '/members' and method == 'GET':
            rows = db.execute('SELECT id,username,role FROM users ORDER BY username').fetchall()
            return 200, [{**dict(r), **dict(self.member(db, r['id'])), 'models': [g[0] for g in db.execute('SELECT model_id FROM ai_model_grants WHERE user_id=?', (r['id'],))]} for r in rows], {}
        member_match = re.fullmatch(r'/members/([a-f0-9]{32})', path)
        if member_match and method == 'PUT':
            target = db.execute('SELECT * FROM users WHERE id=?', (member_match[1],)).fetchone()
            if not target:
                fail(404, 'NOT_FOUND', '成员不存在。')
            self.member(db, target['id'])
            status = payload.get('status', 'active')
            if status not in ('active', 'disabled'):
                fail(422, 'VALIDATION_ERROR', '账号状态无效。')
            if target['role'] == 'admin' and status == 'disabled':
                active_admins = db.execute("SELECT COUNT(*) FROM users u LEFT JOIN ai_members m ON m.user_id=u.id LEFT JOIN account_controls c ON c.user_id=u.id WHERE u.role='admin' AND COALESCE(m.status,'active')='active' AND COALESCE(c.status,'active')='active'").fetchone()[0]
                if active_admins <= 1:
                    fail(409, 'LAST_ADMIN', '不能停用最后一位管理员。')
            for field, maximum in [('chat_limit', 10000), ('music_limit', 86400)]:
                if type(payload.get(field)) is not int or not 0 <= payload[field] <= maximum:
                    fail(422, 'VALIDATION_ERROR', '每日额度无效。')
            if any(type(payload.get(k)) is not bool for k in ('chat', 'music')):
                fail(422, 'VALIDATION_ERROR', '模块权限无效。')
            expires = payload.get('expires')
            if expires is not None and (type(expires) is not int or expires <= now):
                fail(422, 'VALIDATION_ERROR', '授权有效期无效。')
            models = payload.get('models', [])
            known = {r[0] for r in db.execute('SELECT id FROM ai_models')}
            if not isinstance(models, list) or any(m not in known for m in models):
                fail(422, 'VALIDATION_ERROR', '模型授权无效。')
            db.execute('UPDATE ai_members SET status=?,chat=?,music=?,chat_limit=?,music_limit=?,expires=? WHERE user_id=?', (status, payload['chat'], payload['music'], payload['chat_limit'], payload['music_limit'], expires, target['id']))
            db.execute('DELETE FROM ai_model_grants WHERE user_id=?', (target['id'],))
            db.executemany('INSERT INTO ai_model_grants VALUES(?,?)', ((target['id'], m) for m in set(models)))
            if status == 'disabled':
                db.execute('DELETE FROM sessions WHERE user_id=?', (target['id'],))
            self.audit(db, user['id'], 'member.grant', target['id'], {'chat': payload['chat'], 'music': payload['music'], 'models': models, 'status': status})
            return 200, {'ok': True}, {}
        if path == '/budgets':
            if method == 'GET':
                return 200, {'budgets': [dict(r) for r in db.execute('SELECT * FROM ai_budgets')], 'usage': [dict(r) for r in db.execute('SELECT * FROM ai_costs ORDER BY period DESC LIMIT 60')]}, {}
            if method == 'PUT':
                currency = payload.get('currency')
                if currency not in ('USD', 'CNY') or any(type(payload.get(k)) is not int or not 0 <= payload[k] <= 10**12 for k in ('daily', 'monthly')) or payload['daily'] > payload['monthly']:
                    fail(422, 'VALIDATION_ERROR', '预算应为同币种整数微单位，日预算不能大于月预算。')
                db.execute('INSERT OR REPLACE INTO ai_budgets VALUES(?,?,?)', (currency, payload['daily'], payload['monthly']))
                self.audit(db, user['id'], 'budget.update', currency, payload)
                return 200, {'ok': True}, {}
        if path == '/nodes':
            if method == 'GET':
                return 200, [{**dict(r), 'lease': dict(lease) if (lease := db.execute('SELECT task_id,expires,fence FROM ai_leases WHERE resource_group=?', (r['resource_group'],)).fetchone()) else None} for r in db.execute('SELECT * FROM ai_nodes')], {}
            if method == 'POST':
                endpoint = text(payload.get('endpoint'), '节点地址', 500, True).rstrip('/')
                validate_base(endpoint, 'local')
                identifier = uid()
                group = text(payload.get('resource_group'), '资源组', 80, True)
                if not re.fullmatch(r'[a-zA-Z0-9_-]+', group):
                    fail(422, 'VALIDATION_ERROR', '资源组仅允许字母、数字、下划线和连字符。')
                try:
                    db.execute('INSERT INTO ai_nodes(id,name,endpoint,resource_group) VALUES(?,?,?,?)', (identifier, text(payload.get('name'), '节点名称', 80, True), endpoint, group))
                except sqlite3.IntegrityError:
                    fail(409, 'NODE_EXISTS', '节点地址已登记。')
                self.audit(db, user['id'], 'node.create', identifier)
                return 201, {'id': identifier}, {}
        node_match = re.fullmatch(r'/nodes/([a-f0-9]{32})', path)
        if node_match and method == 'PUT':
            if type(payload.get('draining')) is not bool:
                fail(422, 'VALIDATION_ERROR', '排空状态无效。')
            if not db.execute('UPDATE ai_nodes SET draining=? WHERE id=?', (payload['draining'], node_match[1])).rowcount:
                fail(404, 'NOT_FOUND', '节点不存在。')
            self.audit(db, user['id'], 'node.drain', node_match[1], payload)
            return 200, {'ok': True}, {}
        if path == '/requests' and method == 'GET':
            return 200, [dict(r) for r in db.execute('SELECT q.*,u.username FROM ai_requests q JOIN users u ON u.id=q.user_id ORDER BY q.created DESC LIMIT 100')], {}
        request_match = re.fullmatch(r'/requests/([a-f0-9]{32})', path)
        if request_match and method == 'PUT':
            row = db.execute("SELECT * FROM ai_requests WHERE id=? AND state='pending'", (request_match[1],)).fetchone()
            if not row:
                fail(404, 'NOT_FOUND', '待审核申请不存在。')
            state = payload.get('state')
            if state not in ('approved', 'rejected'):
                fail(422, 'VALIDATION_ERROR', '审核结果无效。')
            if state == 'approved':
                self.member(db, row['user_id'])
                models = payload.get('models', [])
                known = {r[0] for r in db.execute('SELECT id FROM ai_models')}
                if not isinstance(models, list) or any(m not in known for m in models):
                    fail(422, 'VALIDATION_ERROR', '模型授权无效。')
                for kind in json.loads(row['modules']):
                    db.execute(f'UPDATE ai_members SET {kind}=1,expires=? WHERE user_id=?', (now + 30 * 86400, row['user_id']))
                db.executemany('INSERT OR IGNORE INTO ai_model_grants VALUES(?,?)', ((row['user_id'], m) for m in models))
            db.execute('UPDATE ai_requests SET state=?,reviewed=? WHERE id=?', (state, now, row['id']))
            self.audit(db, user['id'], 'request.review', row['id'], {'state': state})
            return 200, {'ok': True}, {}
        if path == '/audit' and method == 'GET':
            return 200, [dict(r) for r in db.execute('SELECT * FROM ai_audit ORDER BY created DESC,id DESC LIMIT 200')], {}
        if path == '/reconciliation' and method == 'GET':
            return 200, [dict(r) for r in db.execute('SELECT r.task_id,r.max_cost,r.cost,r.currency,r.provisional,t.state,t.remote_id FROM ai_reservations r JOIN ai_tasks t ON t.id=r.task_id WHERE r.provisional=1 OR t.state=\'RECONCILING\'')], {}
        reconcile_match = re.fullmatch(r'/reconciliation/([a-f0-9]{32})', path)
        if reconcile_match and method == 'PUT':
            row = db.execute('SELECT * FROM ai_reservations WHERE task_id=?', (reconcile_match[1],)).fetchone()
            if not row or not row['settled'] or not row['provisional']:
                fail(409, 'NOT_RECONCILABLE', '任务尚未进入可人工对账状态。')
            cost = payload.get('cost_micro')
            reference = text(payload.get('reference'), '供应商对账编号', 100, True)
            if type(cost) is not int or cost < 0:
                fail(422, 'VALIDATION_ERROR', '实际费用应为非负整数微单位。')
            for period in (row['day'], row['day'][:7]):
                db.execute('UPDATE ai_costs SET used=MAX(0,used+?) WHERE period=? AND currency=?', (cost - row['cost'], period, row['currency']))
            db.execute('UPDATE ai_reservations SET cost=?,provisional=0 WHERE task_id=?', (cost, row['task_id']))
            self.audit(db, user['id'], 'cost.reconcile', row['task_id'], {'cost_micro': cost, 'reference': reference})
            return 200, {'ok': True}, {}
        fail(404, 'NOT_FOUND', '管理接口不存在。')

    def validate_model(self, db, row, value, old):
        allowed = {'endpoint', 'model', 'api_key', 'clear_key', 'node_id', 'max_output', 'currency', 'price_version', 'input_price', 'output_price', 'second_price'}
        if not isinstance(value, dict) or set(value) - allowed:
            fail(422, 'VALIDATION_ERROR', '模型配置包含未知字段。')
        config = {**old, **{k: v for k, v in value.items() if k not in ('api_key', 'clear_key')}}
        config['adapter'], config['locality'] = row['adapter'], row['locality']
        config['endpoint'] = text(config.get('endpoint'), '服务地址', 500, True).rstrip('/')
        validate_base(config['endpoint'], row['locality'])
        config['model'] = text(config.get('model'), '模型标识', 200, True)
        if row['adapter'] == 'ollama' and ':cloud' in config['model'].lower():
            fail(422, 'MODEL_NOT_LOCAL', '本地连接不能使用云端 Ollama 模型。')
        if row['adapter'] == 'eleven' and config['model'] != 'music_v1':
            fail(422, 'UNSUPPORTED_MODEL_VERSION', '当前音乐适配器发布版本为 music_v1。')
        if value.get('clear_key'):
            config.pop('api_key', None)
        if value.get('api_key'):
            key = text(value['api_key'], 'API Key', 1000, True)
            if any(ord(c) < 33 or ord(c) > 126 for c in key):
                fail(422, 'VALIDATION_ERROR', 'API Key不能包含空格或控制字符。')
            config['api_key'] = key
        elif row['locality'] == 'cloud' and old.get('endpoint') != config['endpoint']:
            config.pop('api_key', None)
        if row['locality'] == 'cloud' and not config.get('api_key'):
            fail(422, 'KEY_REQUIRED', '在线模型需要设置 API Key。')
        if row['locality'] == 'local':
            node = db.execute('SELECT * FROM ai_nodes WHERE id=? AND endpoint=?', (config.get('node_id'), config['endpoint'])).fetchone()
            if not node:
                fail(422, 'NODE_REQUIRED', '请选择与服务地址匹配的已登记节点。')
            config['resource_group'] = node['resource_group']
        else:
            config.pop('resource_group', None)
        output = config.get('max_output', 2048)
        if type(output) is not int or not 1 <= output <= 2048:
            fail(422, 'VALIDATION_ERROR', '最大输出不得超过2048 tokens。')
        config['max_output'] = output
        for key in ('input_price', 'output_price', 'second_price'):
            if key in config and (type(config[key]) is not int or not 0 <= config[key] <= 10**9):
                fail(422, 'VALIDATION_ERROR', '价格须为非负整数微单位。')
        if 'price_version' in config:
            config['price_version'] = text(config['price_version'], '价格版本', 80)
        if config.get('currency') not in (None, 'CNY', 'USD'):
            fail(422, 'VALIDATION_ERROR', '币种无效。')
        return config

    def loop(self):
        cleanup_after, health_after = 0, 0
        while not self.stopping.is_set():
            try:
                self.recover_expired()
                with self.store.connect() as db:
                    rows = db.execute("SELECT id FROM ai_tasks WHERE state IN ('QUEUED','RUNNING','SAVING','CANCEL_REQUESTED','RECONCILING') AND lease_until<? ORDER BY created LIMIT 20", (int(time.time()),)).fetchall()
                for row in rows:
                    with self.lock:
                        if len(self.inflight) >= 4 or row['id'] in self.inflight:
                            continue
                        self.inflight.add(row['id'])
                    self.pool.submit(self.execute_guarded, row['id'])
                if time.time() >= cleanup_after:
                    self.cleanup()
                    cleanup_after = time.time() + 3600
                if time.time() >= health_after:
                    with self.store.connect() as db:
                        models = db.execute("SELECT * FROM ai_models WHERE locality='local' AND enabled=1 AND verified=1").fetchall()
                    for model in models:
                        with self.lock:
                            if model['id'] in self.health_inflight:
                                continue
                            self.health_inflight.add(model['id'])
                        self.health_pool.submit(self.check_health, dict(model))
                    health_after = time.time() + 30
            except Exception:
                LOGGER.error('AI调度失败；不记录任务正文或凭据。')
            self.stopping.wait(1)

    def check_health(self, model):
        config = self.decrypt(model['config'])
        try:
            self.providers.check(config)
            health = 'online'
        except Exception:
            health = 'offline'
        try:
            with self.store.connect() as db:
                current = db.execute('SELECT revision FROM ai_models WHERE id=?', (model['id'],)).fetchone()
                if current and current['revision'] == model['revision']:
                    db.execute('UPDATE ai_nodes SET health=?,checked=? WHERE id=?', (health, int(time.time()), config.get('node_id')))
        finally:
            with self.lock:
                self.health_inflight.discard(model['id'])

    def execute_guarded(self, task_id):
        try:
            self.execute(task_id)
        except Exception:
            LOGGER.error('AI任务执行异常；任务将按持久化状态恢复。')
        finally:
            with self.lock:
                self.inflight.discard(task_id)

    def recover_expired(self):
        now = int(time.time())
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for task in db.execute("SELECT * FROM ai_tasks WHERE state='QUEUED' AND dispatched=0 AND created<?", (now - 86400,)).fetchall():
                self.settle(db, task, 'FAILED', '排队超过24小时，未调用模型，使用额度已退回。', cost=0)
            # Expired dispatching leases represent an ambiguous upstream submission.
            for task in db.execute("SELECT * FROM ai_tasks WHERE state='DISPATCHING' AND lease_until<?", (now,)).fetchall():
                if task['kind'] == 'music' and (self.store.spool / (task['id'] + '.enc')).is_file():
                    db.execute("UPDATE ai_tasks SET state='SAVING',result_key=?,lease_until=0 WHERE id=?", (task['id'], task['id']))
                    self.event(db, task['id'], 'state', {'state': 'SAVING'})
                    continue
                db.execute("UPDATE ai_tasks SET state='RECONCILING',reconcile_after=COALESCE(reconcile_after,?),lease_until=0 WHERE id=?", (now + 86400, task['id']))
                self.event(db, task['id'], 'state', {'state': 'RECONCILING'})
            for task in db.execute("SELECT * FROM ai_tasks WHERE state IN ('RECONCILING','CANCEL_REQUESTED','RUNNING') AND dispatched=1 AND reconcile_after IS NOT NULL AND reconcile_after<?", (now,)).fetchall():
                self.settle(db, task, 'CANCELLED' if task['cancel'] else 'FAILED', '上游结果在24小时内无法确认，使用额度已退回，费用待对账。', provisional=True)
            # Resource locks are intentionally NOT stolen on lease timeout. A private
            # node may still be executing: only completion or an operator's verified
            # maintenance action can release its GPU lock.

    def claim(self, task_id):
        now = int(time.time())
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            task = db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone()
            if not task or task['state'] in TERMINAL or task['lease_until'] > now:
                return None
            if task['cancel'] and not task['dispatched']:
                self.settle(db, task, 'CANCELLED', cost=0)
                return None
            user = db.execute('SELECT * FROM users WHERE id=?', (task['user_id'],)).fetchone()
            try:
                self.authorize(db, user, task['kind'], task['model_id'])
                model = db.execute('SELECT * FROM ai_models WHERE id=?', (task['model_id'],)).fetchone()
                if not model['enabled'] or model['revision'] != task['model_revision']:
                    fail(403, 'MODEL_REVOKED', '模型已停用或配置已更新。')
            except Problem:
                if not task['dispatched']:
                    self.settle(db, task, 'FAILED', '权限或模型已变更，任务未调用模型，额度已退回。', cost=0)
                    return None
                db.execute('UPDATE ai_tasks SET cancel=1 WHERE id=?', (task_id,))
            config = self.decrypt(task['config'])
            if not task['dispatched']:
                if task['kind'] == 'music' and db.execute("SELECT 1 FROM ai_tasks WHERE user_id=? AND kind='music' AND id<>? AND dispatched=1 AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')", (task['user_id'], task_id)).fetchone():
                    return None
                if config['locality'] == 'local':
                    node = db.execute('SELECT * FROM ai_nodes WHERE id=?', (config.get('node_id'),)).fetchone()
                    if not node or node['draining'] or node['health'] != 'online':
                        return None
                    if db.execute('SELECT 1 FROM ai_leases WHERE resource_group=?', (config['resource_group'],)).fetchone():
                        return None
                    db.execute('INSERT INTO ai_leases VALUES(?,?,?,1,?)', (config['resource_group'], task_id, self.worker_id, now + 720))
                db.execute("UPDATE ai_tasks SET state='DISPATCHING',dispatched=1,worker=?,lease_until=?,updated=?,reconcile_after=? WHERE id=?", (self.worker_id, now + 720, now, now + 86400, task_id))
                self.event(db, task_id, 'state', {'state': 'DISPATCHING'})
            else:
                db.execute('UPDATE ai_tasks SET worker=?,lease_until=? WHERE id=?', (self.worker_id, now + 720, task_id))
            return dict(db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone())

    def execute(self, task_id):
        with self.store.connect() as db:
            queued = db.execute("SELECT * FROM ai_tasks WHERE id=? AND kind='music' AND state='QUEUED' AND dispatched=0", (task_id,)).fetchone()
        if queued:
            try:
                if not self.storage.ready:
                    fail(503, 'STORAGE_UNAVAILABLE', '私有存储尚未就绪，未调用音乐模型。')
                if hasattr(self.storage, 'directory'):
                    with self.store.connect() as db:
                        reserved = db.execute('SELECT COALESCE(SUM(storage_bytes),0) FROM ai_reservations WHERE settled=0').fetchone()[0]
                    if shutil.disk_usage(self.storage.directory).free < getattr(self.storage, 'min_free_bytes', 268435456) + math.ceil(reserved * 2.5):
                        fail(507, 'STORAGE_UNAVAILABLE', '私有存储可用空间不足，未调用音乐模型。')
                probe = self.storage.key('system/ai-checks/' + uid())
                marker = secrets.token_bytes(32)
                self.storage.put(probe, marker, 'application/octet-stream')
                if self.storage.get(probe) != marker:
                    fail(503, 'STORAGE_UNAVAILABLE', '私有存储校验失败，未调用音乐模型。')
                self.storage.delete(probe)
            except Exception:
                with self.store.connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    current = db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone()
                    if current and not current['dispatched']:
                        self.settle(db, current, 'FAILED', '私有存储检查失败，未调用模型，额度已退回。', cost=0)
                return
        task = self.claim(task_id)
        if not task:
            return
        config, value = self.decrypt(task['config']), json.loads(task['input'])
        try:
            if task['state'] == 'RECONCILING' and not task['remote_id']:
                with self.store.connect() as db:
                    db.execute('UPDATE ai_tasks SET lease_until=? WHERE id=?', (int(time.time()) + 60, task_id))
                return
            if task['kind'] == 'chat':
                if task['state'] != 'DISPATCHING':
                    with self.store.connect() as db:
                        db.execute('BEGIN IMMEDIATE')
                        current = db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone()
                        self.settle(db, current, 'INTERRUPTED', '上次回复中断，保留内容，可手动重新发送。', provisional=True)
                    return
                self.execute_chat(task, config, value)
                return
            if task['result_key']:
                self.save_music(task_id, self.store.pending_bytes(task['result_key']))
                return
            result = self.providers.poll_music(config, task['remote_id']) if task['remote_id'] else self.providers.start_music(config, value['fields'])
            if result is None or result.get('remote_id'):
                with self.store.connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    current = db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone()
                    if current['state'] not in TERMINAL:
                        remote_id = result.get('remote_id') if result else task['remote_id']
                        state = 'CANCEL_REQUESTED' if current['cancel'] else 'RUNNING'
                        db.execute('UPDATE ai_tasks SET remote_id=?,state=?,lease_until=?,updated=? WHERE id=?', (remote_id, state, int(time.time()) + 5, int(time.time()), task_id))
                        self.event(db, task_id, 'state', {'state': state})
                return
            # Durably encrypted spool survives object-storage outages and restart.
            self.store.stage(task_id, result['audio'])
            with self.store.connect() as db:
                db.execute("UPDATE ai_tasks SET result_key=?,state='SAVING',updated=? WHERE id=? AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')", (task_id, int(time.time()), task_id))
                self.event(db, task_id, 'state', {'state': 'SAVING'})
            self.save_music(task_id, result['audio'])
        except UnknownOutcome:
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                current = db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone()
                if current['kind'] == 'chat':
                    self.settle(db, current, 'INTERRUPTED', '模型连接中断，部分回复已保存，可手动重新发送。', provisional=True)
                elif current['state'] not in TERMINAL:
                    db.execute("UPDATE ai_tasks SET state='RECONCILING',error=?,lease_until=? WHERE id=?", ('正在核对上游结果，请勿重复提交。', int(time.time()) + 30, task_id))
                    self.event(db, task_id, 'state', {'state': 'RECONCILING'})
        except Problem as error:
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                current = db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone()
                if current['state'] == 'SAVING' and current['result_key'] and not isinstance(error, AIProblem):
                    db.execute('UPDATE ai_tasks SET lease_until=?,error=? WHERE id=?', (int(time.time()) + 30, '私有音频保存暂未完成，正在重试。', task_id))
                else:
                    self.settle(db, current, 'FAILED', error.message, cost=0 if getattr(error, 'code', '') == 'PROVIDER_REJECTED' else None, provisional=getattr(error, 'code', '') != 'PROVIDER_REJECTED')
        except Exception:
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                current = db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone()
                if current['state'] == 'SAVING' and current['result_key']:
                    db.execute('UPDATE ai_tasks SET lease_until=?,error=? WHERE id=?', (int(time.time()) + 30, '私有音频保存暂未完成，正在重试。', task_id))
                else:
                    db.execute("UPDATE ai_tasks SET state='RECONCILING',lease_until=?,error=? WHERE id=? AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')", (int(time.time()) + 30, '任务结果待核对。', task_id))
            LOGGER.error('AI执行失败；正文与上游凭据未写入日志。')
        finally:
            self.accounts.dirty()

    def execute_chat(self, task, config, value):
        task_id, output, usage = task['id'], '', None
        with self.store.connect() as db:
            db.execute("UPDATE ai_tasks SET state='RUNNING' WHERE id=?", (task_id,))
            self.event(db, task_id, 'state', {'state': 'RUNNING'})
        for event_type, content in self.providers.chat(config, value['messages']):
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                current = db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone()
                user = db.execute('SELECT * FROM users WHERE id=?', (task['user_id'],)).fetchone()
                revoked = False
                try:
                    self.authorize(db, user, 'chat', task['model_id'])
                except Problem:
                    revoked = True
                if current['cancel'] or revoked:
                    self.settle(db, current, 'CANCELLED', '已停止回复，已生成内容保留。', provisional=True)
                    return
                if event_type == 'usage':
                    usage = content
                    continue
                output += content
                if len(output.encode()) > 65536:
                    fail(502, 'OUTPUT_LIMIT', '回复超过平台输出限制。')
                db.execute('UPDATE ai_tasks SET output=?,updated=?,lease_until=? WHERE id=?', (output, int(time.time()), int(time.time()) + 720, task_id))
                self.event(db, task_id, 'delta', {'text': content})
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone()
            if not output:
                fail(502, 'EMPTY_RESPONSE', '模型没有返回内容。')
            if value.get('mode') == 'music_draft' and not current['cancel']:
                self.create_draft(db, current, value, output)
            actual = None
            if config['locality'] == 'cloud' and isinstance(usage, dict):
                tokens_in, tokens_out = usage.get('prompt_tokens'), usage.get('completion_tokens')
                if type(tokens_in) is int and type(tokens_out) is int and tokens_in >= 0 and tokens_out >= 0:
                    actual = tokens_in * config['input_price'] + tokens_out * config['output_price']
            self.settle(db, current, 'CANCELLED' if current['cancel'] else 'SUCCEEDED', cost=actual, provisional=config['locality'] == 'cloud' and actual is None)

    def create_draft(self, db, task, value, output):
        try:
            result = json.loads(output)
            patch = result['patch']
            if set(result) != {'patch'} or not isinstance(patch, dict) or not patch or set(patch) - {'title', 'prompt', 'lyrics', 'instrumental', 'duration', 'tags'}:
                raise ValueError()
            self.validate_form_fields('music', {**value['fields'], **patch})
        except (ValueError, TypeError, KeyError, Problem):
            self.event(db, task['id'], 'draft_invalid', {'message': '模型建议未通过格式校验，未修改表单。可重新起草。'})
            return
        identifier = uid()
        db.execute('INSERT INTO ai_drafts VALUES(?,?,?,?,?,?,0)', (identifier, task['user_id'], value['form_id'], value['form_revision'], packed(patch), int(time.time()) + 86400))
        self.event(db, task['id'], 'draft', {'id': identifier, 'patch': patch, 'base_revision': value['form_revision'], 'form_id': value['form_id']})

    def save_music(self, task_id, audio):
        mime, duration = inspect_audio(audio)
        with self.store.connect() as db:
            task = db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone()
        if task['state'] in TERMINAL:
            return
        fields = json.loads(task['input'])['fields']
        if abs(duration - fields['duration']) > max(3, fields['duration'] * .15):
            fail(502, 'AUDIO_DURATION_MISMATCH', '音频时长超出请求允许误差，作品未发布，使用额度退回。')
        object_key = self.storage.key('ai/audio/' + task['user_id'] + '/' + task_id + ('.wav' if mime == 'audio/wav' else '.mp3' if mime == 'audio/mpeg' else '.flac'))
        stored = not task['cancel']
        if stored:
            self.storage.put(object_key, audio, mime)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT * FROM ai_tasks WHERE id=?', (task_id,)).fetchone()
            if current['state'] in TERMINAL:
                return
            # Recheck revocation after a long upstream call, before publishing.
            user = db.execute('SELECT * FROM users WHERE id=?', (task['user_id'],)).fetchone()
            revoked = False
            try:
                self.authorize(db, user, 'music', task['model_id'])
            except Problem:
                revoked = True
            if current['cancel'] or revoked:
                asset_id = uid() if stored else task_id
                if stored:
                    db.execute('INSERT OR IGNORE INTO ai_assets VALUES(?,?,?,?,?,?,?,?,?,?,1,1)', (asset_id, task['user_id'], task_id, fields['title'] or '未命名音乐', object_key, mime, len(audio), hashlib.sha256(audio).hexdigest(), duration, int(time.time())))
                self.settle(db, current, 'CANCELLED', '生成已结束，取消的作品不予发布。')
                self.record_deletion(db, asset_id, object_key, int(time.time()))
            else:
                db.execute('INSERT OR IGNORE INTO ai_assets VALUES(?,?,?,?,?,?,?,?,?,?,0,0)', (uid(), task['user_id'], task_id, fields['title'] or '未命名音乐', object_key, mime, len(audio), hashlib.sha256(audio).hexdigest(), duration, int(time.time())))
                self.settle(db, current, 'SUCCEEDED', provisional=self.decrypt(current['config'])['locality'] == 'cloud')
        (self.store.spool / (task_id + '.enc')).unlink(missing_ok=True)

    def cleanup(self):
        now = int(time.time())
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for asset in db.execute('SELECT * FROM ai_assets WHERE deleted=0 AND created<?', (now - 90 * 86400,)).fetchall():
                db.execute('UPDATE ai_assets SET deleted=1,delete_pending=1 WHERE id=?', (asset['id'],))
                self.record_deletion(db, asset['id'], asset['object_key'], now)
            tombstones = db.execute('SELECT * FROM ai_tombstones').fetchall()
            db.execute('DELETE FROM ai_events WHERE created<?', (now - 7 * 86400,))
            db.execute('DELETE FROM ai_drafts WHERE expires<?', (now,))
            db.execute("UPDATE ai_tasks SET input='{}',output='' WHERE updated<? AND state IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')", (now - 90 * 86400,))
            db.execute("UPDATE ai_messages SET content='' WHERE created<?", (now - 90 * 86400,))
            db.execute("UPDATE ai_conversations SET title='已过保存期限' WHERE updated<?", (now - 90 * 86400,))
            db.execute('DELETE FROM ai_quotes WHERE expires<?', (now - 8 * 86400,))
            db.execute("UPDATE ai_tasks SET config=? WHERE updated<? AND state IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')", (self.encrypt({}), now - 7 * 86400))
            db.execute('DELETE FROM ai_idempotency WHERE created<?', (now - 8 * 86400,))
            db.execute('DELETE FROM ai_audit WHERE created<?', (now - 180 * 86400,))
            db.execute('DELETE FROM ai_requests WHERE created<?', (now - 180 * 86400,))
            db.execute("UPDATE ai_forms SET fields='{}' WHERE updated<? AND NOT EXISTS(SELECT 1 FROM ai_tasks t WHERE t.form_id=ai_forms.id AND t.state NOT IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED'))", (now - 30 * 86400,))
        for tombstone in tombstones:
            if self.store.metadata('ai-deleted:' + tombstone['id']):
                continue
            try:
                # A separate encrypted deletion journal prevents an older DB backup
                # from resurrecting removed audio when an operator replays it.
                journal_key = self.storage.key('system/ai-deletions/' + tombstone['id'] + '.fernet')
                self.storage.put(journal_key, self.encrypt(dict(tombstone)), 'application/octet-stream')
                if not tombstone['object_key'].startswith('conversation:'):
                    self.storage.delete(tombstone['object_key'])
                with self.store.connect() as db:
                    db.execute('UPDATE ai_assets SET delete_pending=0 WHERE id=?', (tombstone['id'],))
                    db.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', ('ai-deleted:' + tombstone['id'], str(now)))
                # Keep tombstones in encrypted backups for restore-time deletion replay.
            except Exception:
                continue
        with self.store.connect() as db:
            terminal_spools = [r[0] for r in db.execute("SELECT id FROM ai_tasks WHERE state IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED') AND updated<?", (now - 86400,))]
        for identifier in terminal_spools:
            (self.store.spool / (identifier + '.enc')).unlink(missing_ok=True)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            cutoff = now - 180 * 86400
            db.execute('DELETE FROM ai_assets WHERE deleted=1 AND delete_pending=0 AND created<?', (cutoff,))
            old = db.execute("SELECT id FROM ai_tasks t WHERE state IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED') AND updated<? AND NOT EXISTS(SELECT 1 FROM ai_assets a WHERE a.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM ai_leases l WHERE l.task_id=t.id) LIMIT 500", (cutoff,)).fetchall()
            for row in old:
                for table in ('ai_events', 'ai_messages', 'ai_reservations'):
                    db.execute(f'DELETE FROM {table} WHERE task_id=?', (row['id'],))
                db.execute('DELETE FROM ai_tasks WHERE id=?', (row['id'],))
            db.execute('DELETE FROM ai_conversations WHERE updated<? AND NOT EXISTS(SELECT 1 FROM ai_tasks t WHERE t.conversation_id=ai_conversations.id) AND NOT EXISTS(SELECT 1 FROM ai_messages m WHERE m.conversation_id=ai_conversations.id)', (cutoff,))
            db.execute('DELETE FROM ai_forms WHERE updated<? AND NOT EXISTS(SELECT 1 FROM ai_tasks t WHERE t.form_id=ai_forms.id) AND NOT EXISTS(SELECT 1 FROM ai_drafts d WHERE d.form_id=ai_forms.id)', (cutoff,))
            db.execute('DELETE FROM ai_usage WHERE day<? AND reserved=0', (day_key(cutoff),))
            db.execute('DELETE FROM ai_costs WHERE period<? AND reserved=0', (day_key(cutoff)[:7],))
