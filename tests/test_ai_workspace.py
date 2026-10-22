"""Contracts for auth, isolation, reservations and recovery (no external calls)."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
import io
import json
import os
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid
import wave

from cryptography.fernet import Fernet

from image_service.app import Service, HTTPHandler, ThreadingHTTPServer
from image_service.ai_providers import UnknownOutcome, ace_payload, eleven_payload, inspect_audio, validate_base
from image_service.ai_security import AIProblem, day_key, fingerprint, packed, totp, uid
from image_service.ai_service import API, EventStream
from image_service.security import Problem, password_hash
from image_service.store import Store


def uuid7(now=None):
    raw = ((int((now or time.time()) * 1000) << 80) | (7 << 76) | (2 << 62) | (uuid.uuid4().int & ((1 << 62) - 1)))
    return str(uuid.UUID(int=raw))


def wav(seconds=60):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(8000)
        handle.writeframes(b'\0\0' * 8000 * seconds)
    return buffer.getvalue()


class MemoryStorage:
    ready = True
    def __init__(self):
        self.objects, self.fail = {}, False
    def key(self, suffix):
        return 'test/' + suffix
    def put(self, key, data, mime):
        if self.fail and '/ai/audio/' in key:
            raise Problem(503, 'storage temporarily unavailable')
        self.objects[key] = data
    def get(self, key):
        return self.objects[key]
    def delete(self, key):
        if self.fail and '/ai/audio/' in key:
            raise OSError()
        self.objects.pop(key, None)
    def iter_keys(self, prefix):
        return (k for k in self.objects if k.startswith(prefix))


class FakeAI:
    def __init__(self):
        self.calls = 0
        self.polls = 0
        self.answer = '可以用钢琴与弦乐，写一首温暖的中文歌曲。'
        self.unknown = False
        self.async_music = False
    def check(self, config):
        return {'ok': True, 'billable': False}
    def chat(self, config, messages):
        self.calls += 1
        yield 'delta', self.answer[:5]
        if self.unknown:
            raise UnknownOutcome()
        yield 'delta', self.answer[5:]
        yield 'usage', {'prompt_tokens': 20, 'completion_tokens': 30}
    def start_music(self, config, fields):
        self.calls += 1
        if self.unknown:
            raise UnknownOutcome()
        return {'remote_id': 'remote-001'} if self.async_music else {'audio': wav(fields['duration'])}
    def poll_music(self, config, remote_id):
        self.polls += 1
        return {'audio': wav()}


class AIWorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = password_hash('preview-test-password')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name, Fernet(Fernet.generate_key()))
        self.storage = MemoryStorage()
        self.app = Service(self.store, self.storage, origin='https://strgo.com', start_worker=False)
        self.ai = self.app.ai
        self.provider = self.ai.providers = FakeAI()
        self.owner, self.member, self.stranger = (self.user(n, role) for n, role in [('owner', 'admin'), ('member', 'member'), ('stranger', 'member')])
        for session in (self.owner, self.member):
            self.grant(session)
        self.configure('ollama', 'chat')
        self.configure('ace-step', 'music')

    def tearDown(self):
        self.app.close()
        self.temp.cleanup()

    def user(self, username, role):
        user_id = uid()
        with self.store.connect() as db:
            db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (user_id, username, self.password, role, int(time.time()), int(time.time())))
        csrf, headers = self.app.create_session(user_id)
        return {'id': user_id, 'csrf': csrf, 'cookie': headers['Set-Cookie'].split(';')[0]}

    def grant(self, user, **values):
        with self.store.connect() as db:
            self.ai.member(db, user['id'])
            db.execute('UPDATE ai_members SET chat=1,music=1 WHERE user_id=?', (user['id'],))
            for key, value in values.items():
                db.execute('UPDATE ai_members SET ' + key + '=? WHERE user_id=?', (value, user['id']))
            db.executemany('INSERT OR IGNORE INTO ai_model_grants VALUES(?,?)', ((user['id'], model) for model in ('ollama', 'ace-step', 'deepseek', 'elevenlabs')))

    def configure(self, identifier, kind, cloud=False, group='gpu-01'):
        config = {'adapter': 'openai' if kind == 'chat' and cloud else 'eleven' if cloud else 'ollama' if kind == 'chat' else 'ace',
                  'locality': 'cloud' if cloud else 'local', 'model': 'test' if not cloud else 'deepseek-chat' if kind == 'chat' else 'music_v1',
                  'endpoint': 'https://api.example.com' if cloud else 'http://10.0.0.2:11434', 'node_id': 'test-node', 'max_output': 100,
                  **({'currency': 'CNY', 'input_price': 1, 'output_price': 2, 'second_price': 100, 'price_version': 'test-v1', 'api_key': 'SECRET-TEST-KEY'} if cloud else {'resource_group': group})}
        with self.store.connect() as db:
            db.execute("INSERT OR REPLACE INTO ai_nodes VALUES('test-node','test','http://10.0.0.2:11434',?,0,'online',?)", (group, int(time.time())))
            db.execute('UPDATE ai_models SET enabled=1,verified=1,config=? WHERE id=?', (self.ai.encrypt(config), identifier))
            if cloud:
                db.execute("INSERT OR REPLACE INTO ai_budgets VALUES('CNY',10000000,100000000)")
        return config

    def call(self, method, path, body=None, user=None, key=None, extra=None):
        user = user or self.member
        headers = {'Origin': 'https://strgo.com', 'Cookie': user['cookie'], 'X-CSRF-Token': user['csrf']}
        if key:
            headers['Idempotency-Key'] = key
        headers.update(extra or {})
        status, result, headers = self.app.dispatch(method, API + path, body, headers)
        return result['data'] if isinstance(result, dict) and 'data' in result else result

    def problem(self, code, fn):
        with self.assertRaises(AIProblem) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def form(self, **overrides):
        return self.call('POST', '/forms', {'kind': 'music', 'fields': {'title': '雨后的车站', 'prompt': '温暖的中文流行，钢琴与弦乐', 'lyrics': '[Verse]\n雨停在站台边', 'duration': 60, 'instrumental': False, 'tags': [], **overrides}})

    def music_request(self, model='ace-step'):
        form = self.form()
        payload = {'model_id': model, 'form_id': form['id'], 'revision': form['revision']}
        quote = self.call('POST', '/quotes/music', payload)
        return {**payload, 'quote_id': quote['id']}

    def music(self, **kwargs):
        return self.call('POST', '/music/jobs', self.music_request(**kwargs), key=uuid7())

    def chat_request(self, scope='global', form=None, mode='chat', model='ollama'):
        conversation = self.call('POST', '/conversations', {'scope': scope, **({'form_id': form['id']} if form else {})})
        body = {'model_id': model, 'conversation_id': conversation['id'], 'content': '帮我构思一段歌词', 'mode': mode, **({'form_revision': form['revision']} if form else {})}
        quote = self.call('POST', '/quotes/chat', body)
        return {**body, 'quote_id': quote['id']}

    def chat(self, **kwargs):
        return self.call('POST', '/runs', self.chat_request(**kwargs), key=uuid7())

    def advance(self, identifier):
        with self.store.connect() as db:
            db.execute('UPDATE ai_tasks SET lease_until=0 WHERE id=?', (identifier,))
        self.ai.execute(identifier)

    def stepup(self, session=None):
        user = session or self.owner
        with self.store.connect() as db:
            info = self.app.session({'cookie': user['cookie']})
            db.execute('INSERT OR REPLACE INTO ai_stepups VALUES(?,?)', (info['session_hash'], int(time.time()) + 300))

    def test_shared_login_and_cookie(self):
        result = self.call('GET', '/session')
        self.assertEqual(result['user']['id'], self.member['id'])
        self.assertEqual(result['csrf'], self.member['csrf'])

    def test_origin_and_csrf_are_both_required(self):
        self.problem('ORIGIN_INVALID', lambda: self.call('POST', '/forms', {}, extra={'Origin': 'https://evil.test'}))
        self.problem('CSRF_INVALID', lambda: self.call('POST', '/forms', {}, extra={'X-CSRF-Token': 'wrong'}))

    def test_new_member_and_admin_usage_not_implicitly_granted(self):
        self.problem('PERMISSION_REQUIRED', lambda: self.call('POST', '/quotes/chat', {}, user=self.stranger))
        second_admin = self.user('second-admin', 'admin')
        self.problem('PERMISSION_REQUIRED', lambda: self.call('POST', '/quotes/music', {}, user=second_admin))

    def test_expired_grant_and_model_grant(self):
        self.grant(self.member, expires=int(time.time()) - 1)
        self.problem('PERMISSION_REQUIRED', self.chat_request)
        self.grant(self.member, expires=None)
        with self.store.connect() as db:
            db.execute('DELETE FROM ai_model_grants WHERE user_id=?', (self.member['id'],))
        self.problem('MODEL_PERMISSION_REQUIRED', self.chat_request)

    def test_resource_isolation_and_scope(self):
        form = self.form()
        self.problem('NOT_FOUND', lambda: self.call('GET', '/forms/' + form['id'], user=self.stranger))
        self.problem('SCOPE_MISMATCH', lambda: self.call('POST', '/conversations', {'scope': 'global', 'form_id': form['id']}))
        run = self.chat()
        self.problem('NOT_FOUND', lambda: self.call('GET', '/tasks/' + run['id'] + '/events', user=self.stranger))

    def test_idempotency_replays_before_quote_expiry_and_once(self):
        body, key = self.music_request(), uuid7()
        first = self.call('POST', '/music/jobs', body, key=key)
        with self.store.connect() as db:
            db.execute('UPDATE ai_quotes SET expires=0')
        replay = self.call('POST', '/music/jobs', body, key=key)
        self.assertEqual(first['id'], replay['id'])
        self.assertEqual(self.call('GET', '/usage')['music']['reserved'], 60)
        self.problem('IDEMPOTENCY_CONFLICT', lambda: self.call('POST', '/music/jobs', {**body, 'revision': 2}, key=key))

    def test_idempotency_requires_valid_recent_uuid7(self):
        body = self.music_request()
        self.problem('INVALID_IDEMPOTENCY_KEY', lambda: self.call('POST', '/music/jobs', body, key=str(uuid.uuid4())))
        self.problem('IDEMPOTENCY_EXPIRED', lambda: self.call('POST', '/music/jobs', body, key=uuid7(time.time() - 8 * 86400)))

    def test_concurrent_replay_reserves_once(self):
        body, key = self.music_request(), uuid7()
        with ThreadPoolExecutor(max_workers=4) as pool:
            rows = list(pool.map(lambda _: self.call('POST', '/music/jobs', body, key=key), range(10)))
        self.assertEqual(len({r['id'] for r in rows}), 1)
        self.assertEqual(self.call('GET', '/usage')['music']['reserved'], 60)

    def test_quota_atomic_under_concurrent_different_submissions(self):
        self.grant(self.member, music_limit=60)
        bodies = [self.music_request(), self.music_request()]
        def submit(body):
            try:
                return self.call('POST', '/music/jobs', body, key=uuid7())['id']
            except AIProblem as error:
                return error.code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, bodies))
        self.assertEqual(results.count('QUOTA_EXCEEDED'), 1)
        self.assertEqual(self.call('GET', '/usage')['music']['reserved'], 60)

    def test_one_remaining_quota_under_100_concurrent_submissions(self):
        self.grant(self.member, music_limit=60)
        form = self.form()
        payload = {'model_id': 'ace-step', 'form_id': form['id'], 'revision': 1}
        bodies = [{**payload, 'quote_id': self.call('POST', '/quotes/music', payload)['id']} for _ in range(100)]
        def submit(body):
            try:
                return self.call('POST', '/music/jobs', body, key=uuid7())['state']
            except AIProblem as error:
                return error.code
        with ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(submit, bodies))
        self.assertEqual(results.count('QUEUED'), 1)
        self.assertEqual(results.count('QUOTA_EXCEEDED'), 99)
        self.assertEqual(self.call('GET', '/usage')['music']['reserved'], 60)

    def test_local_only_rejects_cloud_for_both_modules(self):
        self.configure('deepseek', 'chat', cloud=True)
        self.configure('elevenlabs', 'music', cloud=True)
        form = self.form()
        self.problem('LOCAL_ONLY', lambda: self.call('POST', '/quotes/music', {'model_id': 'elevenlabs', 'form_id': form['id'], 'revision': 1, 'local_only': True}))
        conversation = self.call('POST', '/conversations', {'scope': 'global'})
        self.problem('LOCAL_ONLY', lambda: self.call('POST', '/quotes/chat', {'model_id': 'deepseek', 'conversation_id': conversation['id'], 'content': 'hi', 'local_only': True}))
        self.assertEqual(self.provider.calls, 0)

    def test_settlement_uses_original_beijing_day_across_midnight(self):
        self.configure('elevenlabs', 'music', cloud=True)
        with patch('image_service.ai_service.day_key', return_value='2026-10-21'):
            task = self.music(model='elevenlabs')
        self.ai.execute(task['id'])
        with self.store.connect() as db:
            usage = db.execute("SELECT * FROM ai_usage WHERE day='2026-10-21' AND kind='music'").fetchone()
            self.assertEqual((usage['used'], usage['reserved']), (60, 0))
            self.assertEqual(db.execute("SELECT used FROM ai_costs WHERE period='2026-10-21'").fetchone()[0], 6000)

    def test_same_conversation_second_tab_returns_conflict(self):
        body = self.chat_request()
        self.call('POST', '/runs', body, key=uuid7())
        quote = self.call('POST', '/quotes/chat', body)
        self.problem('CONVERSATION_BUSY', lambda: self.call('POST', '/runs', {**body, 'quote_id': quote['id']}, key=uuid7()))

    def test_offline_or_draining_node_rejects_new_quotes_without_cloud_fallback(self):
        with self.store.connect() as db:
            db.execute('UPDATE ai_nodes SET draining=1')
        self.problem('NODE_UNAVAILABLE', self.music_request)
        self.assertEqual(self.provider.calls, 0)

    def test_budget_missing_or_exceeded_prevents_dispatch(self):
        self.configure('elevenlabs', 'music', cloud=True)
        with self.store.connect() as db:
            db.execute('DELETE FROM ai_budgets')
        self.problem('BUDGET_NOT_CONFIGURED', lambda: self.music_request('elevenlabs'))
        with self.store.connect() as db:
            db.execute("INSERT INTO ai_budgets VALUES('CNY',1,1)")
        self.problem('BUDGET_EXCEEDED', lambda: self.music(model='elevenlabs'))
        self.assertEqual(self.provider.calls, 0)
        self.assertEqual(self.call('GET', '/usage')['music']['reserved'], 0)

    def test_storage_reservation_before_dispatch(self):
        self.grant(self.member, storage_limit=1)
        self.problem('STORAGE_QUOTA_EXCEEDED', self.music)
        self.assertEqual(self.provider.calls, 0)

    def test_storage_preflight_failure_does_not_call_a_paid_model(self):
        self.configure('elevenlabs', 'music', cloud=True)
        task = self.music(model='elevenlabs')
        self.storage.ready = False
        self.ai.execute(task['id'])
        self.assertEqual(self.provider.calls, 0)
        self.assertEqual(self.call('GET', '/tasks/' + task['id'])['state'], 'FAILED')
        self.assertEqual(self.call('GET', '/usage')['music']['reserved'], 0)

    def test_quote_input_revision_and_model_revision_are_checked(self):
        body = self.music_request()
        with self.store.connect() as db:
            db.execute('UPDATE ai_forms SET revision=revision+1')
        self.problem('FORM_REVISION_CONFLICT', lambda: self.call('POST', '/music/jobs', body, key=uuid7()))
        body = self.music_request()
        with self.store.connect() as db:
            db.execute("UPDATE ai_models SET revision=revision+1 WHERE id='ace-step'")
        self.problem('MODEL_REVISION_CONFLICT', lambda: self.call('POST', '/music/jobs', body, key=uuid7()))

    def test_queue_cancel_refunds_once_and_terminal_immutable(self):
        task = self.music()
        self.call('POST', '/tasks/' + task['id'] + '/cancel', {})
        self.call('POST', '/tasks/' + task['id'] + '/cancel', {})
        self.advance(task['id'])
        self.assertEqual(self.call('GET', '/tasks/' + task['id'])['state'], 'CANCELLED')
        self.assertEqual(self.call('GET', '/usage')['music']['reserved'], 0)
        self.assertEqual(self.call('GET', '/usage')['music']['used'], 0)
        self.assertEqual(self.provider.calls, 0)

    def test_revocation_rechecked_at_dispatch(self):
        task = self.music()
        self.grant(self.member, music=0)
        self.ai.execute(task['id'])
        self.assertEqual(self.provider.calls, 0)
        self.assertEqual(self.call('GET', '/tasks/' + task['id'])['state'], 'FAILED')

    def test_music_saved_privately_checksum_range_and_original_parameters(self):
        task = self.music()
        self.ai.execute(task['id'])
        result = self.call('GET', '/tasks/' + task['id'])
        self.assertEqual(result['state'], 'SUCCEEDED')
        self.assertEqual(result['parameters']['title'], '雨后的车站')
        asset = result['asset']
        self.assertEqual(asset['sha256'], hashlib.sha256(wav()).hexdigest())
        self.problem('NOT_FOUND', lambda: self.call('GET', '/assets/' + asset['id'] + '/audio', user=self.stranger))
        self.assertEqual(self.call('GET', '/assets/' + asset['id'] + '/audio', extra={'Range': 'bytes=0-3'}), b'RIFF')
        self.problem('INVALID_RANGE', lambda: self.call('GET', '/assets/' + asset['id'] + '/audio', extra={'Range': 'bytes=99999999-'}))
        self.assertEqual(self.call('GET', '/usage')['music']['used'], 60)
        self.advance(task['id'])
        self.assertEqual(self.call('GET', '/usage')['music']['used'], 60)

    def test_storage_failure_retries_save_not_generation(self):
        task = self.music()
        self.storage.fail = True
        self.ai.execute(task['id'])
        self.assertEqual(self.call('GET', '/tasks/' + task['id'])['state'], 'SAVING')
        self.assertTrue((self.store.spool / (task['id'] + '.enc')).exists())
        self.storage.fail = False
        self.advance(task['id'])
        self.assertEqual(self.provider.calls, 1)
        self.assertEqual(self.call('GET', '/tasks/' + task['id'])['state'], 'SUCCEEDED')

    def test_crash_after_spool_before_database_write_recovers_without_new_call(self):
        task = self.music()
        claimed = self.ai.claim(task['id'])
        self.store.stage(task['id'], wav())
        with self.store.connect() as db:
            db.execute('UPDATE ai_tasks SET lease_until=0 WHERE id=?', (task['id'],))
        self.ai.recover_expired()
        self.ai.execute(task['id'])
        self.assertEqual(self.call('GET', '/tasks/' + task['id'])['state'], 'SUCCEEDED')
        self.assertEqual(self.provider.calls, 0)

    def test_http_error_envelope_audio_range_and_sse_transport(self):
        task = self.music()
        self.ai.execute(task['id'])
        asset = self.call('GET', '/assets')[0]
        server = ThreadingHTTPServer(('127.0.0.1', 0), HTTPHandler)
        server.service = self.app
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            connection.request('POST', API + '/forms', body='{}', headers={'Content-Type': 'application/json', 'Cookie': self.member['cookie'], 'Origin': 'https://strgo.com'})
            response = connection.getresponse()
            self.assertEqual(response.status, 403)
            self.assertEqual(json.loads(response.read())['error']['code'], 'CSRF_INVALID')
            connection.close()
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            connection.request('GET', asset['url'], headers={'Cookie': self.member['cookie'], 'Range': 'bytes=0-3'})
            response = connection.getresponse()
            self.assertEqual(response.status, 206)
            self.assertEqual(response.getheader('Content-Range'), 'bytes 0-3/' + str(len(wav())))
            self.assertEqual(response.read(), b'RIFF')
            connection.close()
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            connection.request('GET', API + '/tasks/' + task['id'] + '/events', headers={'Cookie': self.member['cookie']})
            response = connection.getresponse()
            self.assertEqual(response.getheader('Content-Type'), 'text/event-stream; charset=utf-8')
            self.assertIn(b'SUCCEEDED', response.read())
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_unknown_music_outcome_never_reposts_and_24h_refund(self):
        task = self.music()
        self.provider.unknown = True
        self.ai.execute(task['id'])
        self.advance(task['id'])
        self.assertEqual(self.provider.calls, 1)
        self.assertEqual(self.call('GET', '/tasks/' + task['id'])['state'], 'RECONCILING')
        with self.store.connect() as db:
            db.execute('UPDATE ai_tasks SET reconcile_after=1 WHERE id=?', (task['id'],))
        self.ai.recover_expired()
        self.assertEqual(self.call('GET', '/tasks/' + task['id'])['state'], 'FAILED')
        self.assertEqual(self.call('GET', '/usage')['music']['remaining'], 600)
        with self.store.connect() as db:
            self.assertIsNotNone(db.execute('SELECT 1 FROM ai_leases WHERE task_id=?', (task['id'],)).fetchone())

    def test_gpu_resource_group_shared_by_chat_and_music(self):
        music, chat = self.music(), self.chat()
        self.provider.async_music = True
        self.ai.execute(music['id'])
        self.ai.execute(chat['id'])
        self.assertEqual(self.provider.calls, 1)
        self.assertEqual(self.call('GET', '/tasks/' + chat['id'])['state'], 'QUEUED')
        self.advance(music['id'])
        self.ai.execute(chat['id'])
        self.assertEqual(self.call('GET', '/tasks/' + chat['id'])['state'], 'SUCCEEDED')

    def test_running_local_music_cancellation_does_not_release_gpu_early(self):
        task = self.music()
        self.provider.async_music = True
        self.ai.execute(task['id'])
        self.call('POST', '/tasks/' + task['id'] + '/cancel', {})
        with self.store.connect() as db:
            self.assertIsNotNone(db.execute('SELECT 1 FROM ai_leases WHERE task_id=?', (task['id'],)).fetchone())
        self.advance(task['id'])
        self.assertEqual(self.call('GET', '/tasks/' + task['id'])['state'], 'CANCELLED')
        self.assertEqual(self.call('GET', '/assets'), [])

    def test_chat_partial_saved_and_not_in_next_context(self):
        self.provider.unknown = True
        body = self.chat_request()
        task = self.call('POST', '/runs', body, key=uuid7())
        self.ai.execute(task['id'])
        result = self.call('GET', '/tasks/' + task['id'])
        self.assertEqual(result['state'], 'INTERRUPTED')
        self.assertTrue(result['output'])
        self.assertEqual(self.call('GET', '/usage')['chat']['used'], 1)
        with self.store.connect() as db:
            value = {'conversation_id': body['conversation_id'], 'content': '新的问题'}
            context = self.ai.messages_for(db, value)
        self.assertNotIn(result['output'], [m['content'] for m in context])

    def test_chat_2048_output_and_16k_context_limits(self):
        with self.store.connect() as db:
            model = db.execute("SELECT * FROM ai_models WHERE id='ollama'").fetchone()
            config = self.ai.decrypt(model['config'])
            with self.assertRaises(AIProblem):
                self.ai.validate_model(db, model, {'endpoint': 'http://10.0.0.2:11434', 'max_output': 2049}, config)
        self.problem('CONTEXT_TOO_LARGE', lambda: self.chat_request(form=self.form(lyrics='中' * 3400, prompt='中' * 1900), scope='music'))

    def test_structured_draft_apply_is_optimistic_and_never_generates(self):
        form = self.form()
        self.provider.answer = packed({'patch': {'lyrics': '雨停在站台边\n风轻轻拥着你的肩'}})
        task = self.chat(scope='music', form=form, mode='music_draft')
        self.ai.execute(task['id'])
        with self.store.connect() as db:
            draft = db.execute('SELECT * FROM ai_drafts').fetchone()
        self.assertIsNotNone(draft)
        result = self.call('POST', '/drafts/' + draft['id'] + '/apply', {'revision': form['revision']})
        self.assertEqual(result['revision'], 2)
        self.assertEqual(len(self.call('GET', '/music/jobs')), 0)
        again = self.call('POST', '/drafts/' + draft['id'] + '/apply', {'revision': 1})
        self.assertEqual(again['revision'], 2)

    def test_draft_conflict_and_invalid_schema_do_not_overwrite(self):
        form = self.form()
        self.provider.answer = packed({'patch': {'lyrics': 'new lyrics'}})
        task = self.chat(scope='music', form=form, mode='music_draft')
        self.ai.execute(task['id'])
        with self.store.connect() as db:
            draft = db.execute('SELECT * FROM ai_drafts').fetchone()
        self.call('PUT', '/forms/' + form['id'], {'revision': 1, 'fields': {**form['fields'], 'title': '已手动修改'}})
        self.problem('FORM_REVISION_CONFLICT', lambda: self.call('POST', '/drafts/' + draft['id'] + '/apply', {'revision': 2}))
        self.provider.answer = packed({'patch': {'endpoint': 'https://evil.test'}})
        second = self.chat(scope='music', form=self.form(), mode='music_draft')
        self.ai.execute(second['id'])
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM ai_drafts').fetchone()[0], 1)

    def test_explicit_transfer_only_selected_text_new_scope(self):
        task = self.chat()
        self.ai.execute(task['id'])
        messages = self.call('GET', '/conversations/' + task['conversation_id'])['messages']
        message = next(m for m in messages if m['role'] == 'assistant')
        selected = '钢琴与弦乐'
        target = self.call('POST', '/conversations/' + task['conversation_id'] + '/transfer', {'message_id': message['id'], 'selection': selected})
        new = self.call('GET', '/forms/' + target['form_id'])
        self.assertEqual(new['fields']['lyrics'], selected)
        self.assertEqual(self.call('GET', '/conversations/' + target['conversation_id'])['messages'], [])
        self.problem('SELECTION_INVALID', lambda: self.call('POST', '/conversations/' + task['conversation_id'] + '/transfer', {'message_id': message['id'], 'selection': 'not in source'}))

    def test_image_context_contains_only_explicit_current_prompt(self):
        form = self.call('POST', '/forms', {'kind': 'image', 'fields': {'prompt': '逆光，温暖的房间'}})
        body = self.chat_request(scope='image', form=form)
        with self.store.connect() as db:
            quote = db.execute('SELECT * FROM ai_quotes WHERE id=?', (body['quote_id'],)).fetchone()
            self.assertIsNotNone(quote)
            value = self.ai.normalize_input(db, {'id': self.member['id']}, 'chat', body)
            self.assertEqual(value['fields'], {'prompt': '逆光，温暖的房间'})

    def test_sse_replay_does_not_create_new_task(self):
        task = self.chat()
        self.ai.execute(task['id'])
        stream = self.call('GET', '/tasks/' + task['id'] + '/events?after_seq=2')
        self.assertIsInstance(stream, EventStream)
        class Handler:
            wfile = io.BytesIO()
            class Connection:
                def settimeout(self, value):
                    pass
            connection = Connection()
            def send_response(self, value):
                self.status = value
            def send_header(self, *args):
                pass
            def end_headers(self):
                pass
        handler = Handler()
        stream.write(handler)
        raw = handler.wfile.getvalue().decode()
        self.assertIn('event: delta', raw)
        self.assertNotIn('id: 1\n', raw)
        self.assertEqual(self.provider.calls, 1)

    def test_expired_event_cursor_returns_410_and_snapshot_remains(self):
        task = self.chat()
        self.ai.execute(task['id'])
        with self.store.connect() as db:
            db.execute('DELETE FROM ai_events WHERE task_id=? AND seq<3', (task['id'],))
        self.problem('EVENT_CURSOR_EXPIRED', lambda: self.call('GET', '/tasks/' + task['id'] + '/events'))
        self.assertTrue(self.call('GET', '/tasks/' + task['id'])['output'])

    def test_deleted_conversation_stays_deleted_after_older_database_restore(self):
        task = self.chat()
        self.ai.execute(task['id'])
        identifier = task['conversation_id']
        self.call('DELETE', '/conversations/' + identifier, {})
        with self.store.connect() as db:
            db.execute("UPDATE ai_conversations SET deleted=0,title='old backup' WHERE id=?", (identifier,))
            db.execute("UPDATE ai_messages SET content='restored private content' WHERE conversation_id=?", (identifier,))
            db.execute("UPDATE ai_tasks SET output='restored private content' WHERE id=?", (task['id'],))
            db.execute('DELETE FROM ai_tombstones')
        self.ai.recover_deletions()
        self.problem('NOT_FOUND', lambda: self.call('GET', '/conversations/' + identifier))
        self.assertEqual(self.call('GET', '/tasks/' + task['id'])['output'], '')

    def test_banned_account_loses_shared_session(self):
        with self.store.connect() as db:
            db.execute("UPDATE ai_members SET status='disabled' WHERE user_id=?", (self.member['id'],))
        self.assertIsNone(self.app.session({'cookie': self.member['cookie']}))
        self.problem('AUTH_REQUIRED', lambda: self.call('GET', '/tasks'))

    def test_mfa_required_secret_write_only_and_replay_denied(self):
        self.problem('MFA_REQUIRED', lambda: self.call('PUT', '/admin/budgets', {'currency': 'CNY', 'daily': 1, 'monthly': 2}, user=self.owner))
        setup = self.call('POST', '/admin/mfa/setup', {'password': 'preview-test-password'}, user=self.owner)
        code = totp(setup['secret'])
        self.call('POST', '/admin/mfa/verify', {'code': code}, user=self.owner)
        self.call('PUT', '/admin/budgets', {'currency': 'CNY', 'daily': 1, 'monthly': 2}, user=self.owner)
        self.problem('MFA_INVALID', lambda: self.call('POST', '/admin/mfa/verify', {'code': code}, user=self.owner))
        info = self.call('GET', '/session', user=self.owner)
        self.assertTrue(info['mfa_enrolled'])
        self.assertNotIn(setup['secret'], packed(info))

    def test_admin_model_config_never_returns_api_key(self):
        self.configure('deepseek', 'chat', cloud=True)
        models = self.call('GET', '/admin/models', user=self.owner)
        self.assertNotIn('SECRET-TEST-KEY', packed(models))
        self.assertNotIn('api_key', packed(models))
        self.assertTrue(next(m for m in models if m['id'] == 'deepseek')['has_key'])
        self.problem('ADMIN_REQUIRED', lambda: self.call('GET', '/admin/models'))

    def test_last_admin_cannot_be_disabled(self):
        self.stepup()
        self.problem('LAST_ADMIN', lambda: self.call('PUT', '/admin/members/' + self.owner['id'], {'status': 'disabled', 'chat': True, 'music': True, 'chat_limit': 50, 'music_limit': 600, 'expires': None, 'models': []}, user=self.owner))

    def test_free_model_check_and_revision_safeguards(self):
        self.stepup()
        self.call('POST', '/admin/models/ollama/check', {}, user=self.owner)
        self.assertEqual(self.provider.calls, 0)
        self.problem('MODEL_REVISION_CONFLICT', lambda: self.call('PUT', '/admin/models/ollama', {'revision': 0}, user=self.owner))

    def test_cloud_chat_cost_settles_actual_and_reservations_release(self):
        self.configure('deepseek', 'chat', cloud=True)
        task = self.chat(model='deepseek')
        self.ai.execute(task['id'])
        with self.store.connect() as db:
            cost = db.execute('SELECT * FROM ai_reservations WHERE task_id=?', (task['id'],)).fetchone()
        self.assertEqual(cost['cost'], 80)
        self.assertEqual(cost['settled'], 1)
        self.assertEqual(cost['provisional'], 0)

    def test_cloud_music_conservative_cost_can_be_reconciled_once(self):
        self.configure('elevenlabs', 'music', cloud=True)
        task = self.music(model='elevenlabs')
        self.ai.execute(task['id'])
        self.stepup()
        self.call('PUT', '/admin/reconciliation/' + task['id'], {'cost_micro': 4500, 'reference': 'invoice-01'}, user=self.owner)
        self.problem('NOT_RECONCILABLE', lambda: self.call('PUT', '/admin/reconciliation/' + task['id'], {'cost_micro': 4500, 'reference': 'invoice-01'}, user=self.owner))
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT used FROM ai_costs WHERE period=?', (day_key(),)).fetchone()[0], 4500)

    def test_deleted_audio_cleanup_retries_and_tombstone_persists(self):
        task = self.music()
        self.ai.execute(task['id'])
        asset = self.call('GET', '/assets')[0]
        self.call('DELETE', '/assets/' + asset['id'], {})
        self.storage.fail = True
        self.ai.cleanup()
        self.assertEqual(self.call('GET', '/assets'), [])
        self.problem('NOT_FOUND', lambda: self.call('GET', '/assets/' + asset['id'] + '/audio'))
        self.storage.fail = False
        self.ai.cleanup()
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT delete_pending FROM ai_assets').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM ai_tombstones').fetchone()[0], 1)

    def test_validation_rejects_unknown_fields_and_wrong_duration_type(self):
        self.problem('VALIDATION_ERROR', lambda: self.form(endpoint='https://evil.test'))
        self.problem('VALIDATION_ERROR', lambda: self.form(duration=60.0))
        self.problem('VALIDATION_ERROR', lambda: self.form(key={'bad': 'value'}))


class AIAdapterTests(unittest.TestCase):
    def test_ssrf_public_and_private_boundaries(self):
        for endpoint in ['http://127.0.0.1:11434', 'http://169.254.169.254', 'https://example.test@127.0.0.1', 'http://10.0.0.2:8001']:
            with self.assertRaises(Problem):
                validate_base(endpoint, 'cloud')
        with patch.dict(os.environ, {'AI_LOCAL_ENDPOINTS': 'http://10.0.0.2:8001'}):
            self.assertEqual(validate_base('http://10.0.0.2:8001', 'local').hostname, '10.0.0.2')
            with self.assertRaises(Problem):
                validate_base('http://10.0.0.3:8001', 'local')

    def test_eleven_vocal_and_instrumental_are_exclusive(self):
        fields = {'title': 'test', 'prompt': 'piano', 'lyrics': 'lyrics', 'duration': 60, 'tags': [], 'instrumental': False}
        vocal = eleven_payload({'model': 'music_v1'}, fields)
        self.assertIn('composition_plan', vocal)
        self.assertNotIn('prompt', vocal)
        self.assertNotIn('music_length_ms', vocal)
        instrumental = eleven_payload({'model': 'music_v1'}, {**fields, 'instrumental': True})
        self.assertNotIn('composition_plan', instrumental)
        self.assertTrue(instrumental['force_instrumental'])
        self.assertEqual(instrumental['music_length_ms'], 60000)

    def test_ace_uses_documented_instrumental_and_duration(self):
        payload = ace_payload({'model': 'ace'}, {'prompt': 'piano', 'lyrics': '', 'duration': 30, 'instrumental': True, 'tags': []})
        self.assertEqual(payload['lyrics'], '[Instrumental]')
        self.assertEqual(payload['audio_duration'], 30)

    def test_audio_validation_checks_content_not_extension(self):
        self.assertEqual(inspect_audio(wav(15)), ('audio/wav', 15))
        with self.assertRaises(Problem):
            inspect_audio(b'<html>not audio</html>')


if __name__ == '__main__':
    unittest.main()
