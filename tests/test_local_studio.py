import base64
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
import unittest
from unittest.mock import patch
import uuid

from image_service import local_studio as studio
from image_service import cli
from image_service.app import Service
from image_service.security import Problem
from tests import test_image_service as fixtures

ORIGIN = 'https://workflow.strgo.com'
TOKEN = 'local-worker-test-token-' + 'x' * 32
WORKFLOWS = [{'id': 'h3-video', 'label': 'MiniMax H3', 'kind': 'video', 'reference': False},
             {'id': 'qwen-image', 'label': 'Qwen-Image-2.1', 'kind': 'image', 'reference': True}]
VIDEO = b'\x00\x00\x00\x20ftypisom' + b'v' * (studio.CHUNK + 13)


class LocalStudioTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'LOCAL_STUDIO_ORIGIN': ORIGIN, 'LOCAL_STUDIO_WORKER_TOKEN': TOKEN})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.fixture = fixtures.ImageServiceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.app = self.fixture.app
        self.member = self.fixture.register('ordinary')
        self.admin = self.login()

    def call(self, method, path, body=None, session=None, extra=None):
        headers = {'Origin': ORIGIN}
        if session:
            headers.update({'Cookie': session['cookie'], 'X-CSRF-Token': session['csrf']})
        headers.update(extra or {})
        return self.app.dispatch(method, studio.PREFIX + path, body, headers, 'test-local')

    def login(self, username='owner', password=fixtures.PASSWORD):
        code, body, headers = self.call('POST', '/login', {'username': username, 'password': password})
        self.assertEqual(code, 200)
        return {'cookie': headers['Set-Cookie'].split(';')[0], 'csrf': body['csrf'], 'headers': headers}

    def worker(self, path='/poll', body=None, token=TOKEN):
        return self.app.dispatch('POST', studio.PREFIX + '/worker' + path, body or {'workflows': WORKFLOWS}, {'Authorization': 'Bearer ' + token})[1]

    def create(self, **changes):
        return self.call('POST', '/jobs', {'workflow': 'h3-video', 'prompt': 'A quiet street', 'requestId': str(uuid.uuid4()), **changes}, self.admin)[1]

    def claimed(self, **changes):
        self.worker()
        job = self.create(**changes)
        claim = self.worker()['job']
        self.assertEqual(claim['id'], job['id'])
        return claim

    def result(self, job, data=VIDEO):
        parts = [data[offset:offset + studio.CHUNK] for offset in range(0, len(data), studio.CHUNK)]
        for index, chunk in enumerate(parts):
            body = {'claim': job['claim'], 'part': index, 'data': base64.b64encode(chunk).decode()}
            self.worker('/jobs/' + job['id'] + '/chunk', body)
            self.worker('/jobs/' + job['id'] + '/chunk', body)
        complete = {'claim': job['claim'], 'parts': len(parts), 'sha256': hashlib.sha256(data).hexdigest()}
        self.worker('/jobs/' + job['id'] + '/complete', complete)
        self.worker('/jobs/' + job['id'] + '/complete', complete)

    def problem(self, status, action):
        with self.assertRaises(Problem) as caught:
            action()
        self.assertEqual(caught.exception.status, status)

    def test_shared_credentials_admin_role_and_host_only_cookie(self):
        self.assertTrue(self.admin['cookie'].startswith('strgo_workflow_session='))
        for flag in ('HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/;'):
            self.assertIn(flag, self.admin['headers']['Set-Cookie'])
        self.assertNotIn('Domain=', self.admin['headers']['Set-Cookie'])
        self.problem(403, lambda: self.login('ordinary'))
        self.problem(401, lambda: self.login(password='incorrect'))
        self.problem(401, lambda: self.call('GET', '/jobs', session=self.fixture.admin))
        forged = {**self.member, 'cookie': self.member['cookie'].replace('strgo_account_session=', 'strgo_workflow_session=')}
        for method, path, body in [('GET', '/status', None), ('GET', '/jobs', None), ('POST', '/jobs', {})]:
            self.problem(403, lambda: self.call(method, path, body, forged))
        self.assertIsNone(self.call('GET', '/session')[1]['user'])
        self.problem(404, lambda: self.call('POST', '/register', {}, self.admin))

    def test_origin_csrf_worker_secret_and_separate_logout(self):
        self.problem(403, lambda: self.call('POST', '/logout', {}, self.admin, {'Origin': 'https://strgo.com'}))
        self.problem(403, lambda: self.call('POST', '/logout', {}, self.admin, {'X-CSRF-Token': 'wrong'}))
        self.problem(401, lambda: self.worker(token='wrong'))
        self.problem(401, lambda: self.call('POST', '/worker/poll', {'workflows': WORKFLOWS}, self.admin, {'Authorization': 'Bearer ' + TOKEN}))
        self.call('POST', '/logout', {}, self.admin)
        self.problem(401, lambda: self.call('GET', '/jobs', session=self.admin))
        self.assertIsNotNone(self.fixture.call('GET', '/session', session=self.fixture.admin)[1]['user'])

    def test_password_change_revokes_workflow_session_and_uses_new_password(self):
        password = 'Changed-private-password-2026'
        self.fixture.call('PUT', '/password', {'oldPassword': fixtures.PASSWORD, 'newPassword': password}, self.fixture.admin)
        self.problem(401, lambda: self.call('GET', '/jobs', session=self.admin))
        self.problem(401, lambda: self.login())
        self.login(password=password)

    def test_isolated_jobs_need_no_paid_config_or_quota_and_are_idempotent(self):
        self.worker()
        request_id = str(uuid.uuid4())
        first = self.create(requestId=request_id)
        self.assertEqual(first['id'], self.create(requestId=request_id)['id'])
        with self.app.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM jobs').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM local_jobs').fetchone()[0], 1)
        self.assertEqual(self.fixture.provider.calls, 0)
        self.assertEqual(self.call('GET', '/jobs', session=self.admin)[1]['jobs'][0]['status'], 'queued')

    def test_offline_disabled_registry_and_full_queue(self):
        self.problem(409, self.create)
        self.worker()
        for _ in range(5):
            self.create()
        self.problem(429, self.create)
        with patch.dict(os.environ, {'LOCAL_STUDIO_WORKER_TOKEN': ''}):
            self.assertFalse(self.call('GET', '/status', session=self.admin)[1]['enabled'])
            self.problem(503, self.worker)
        self.problem(400, lambda: self.worker(body={'workflows': WORKFLOWS * 2}))

    def test_reference_is_required_encrypted_and_cleared_after_completion(self):
        self.worker()
        self.problem(400, lambda: self.create(workflow='qwen-image'))
        encoded = base64.b64encode(fixtures.PNG).decode()
        claimed = self.claimed(workflow='qwen-image', reference=encoded)
        self.assertEqual(claimed['reference'], encoded)
        with self.app.store.connect() as db:
            encrypted = db.execute('SELECT reference FROM local_jobs').fetchone()[0]
        self.assertNotIn(fixtures.PNG, encrypted)
        self.result(claimed, fixtures.PNG)
        with self.app.store.connect() as db:
            self.assertIsNone(db.execute('SELECT reference FROM local_jobs').fetchone()[0])
            self.assertEqual(db.execute('SELECT count(*) FROM local_chunks').fetchone()[0], 0)

    def test_concurrent_claims_restart_and_lease_expiration_never_requeue(self):
        self.worker()
        self.create()
        self.create()
        with ThreadPoolExecutor(max_workers=2) as pool:
            claims = list(pool.map(lambda _: self.worker()['job'], range(2)))
        self.assertEqual(sum(job is not None for job in claims), 1)
        job = next(job for job in claims if job)
        restarted = Service(self.app.store, self.fixture.cloud, self.fixture.provider, fixtures.ORIGIN, start_worker=False)
        restarted.close()
        self.worker('/jobs/' + job['id'] + '/heartbeat', {'claim': job['claim']})
        with self.app.store.connect() as db:
            db.execute('UPDATE local_jobs SET expires=? WHERE id=?', (int(time.time()) - 1, job['id']))
        self.assertTrue(self.worker('/jobs/' + job['id'] + '/heartbeat', {'claim': job['claim']})['terminal'])
        self.assertIsNone(self.worker()['job'])
        self.worker('/jobs/' + job['id'] + '/release', {'claim': job['claim'], 'gpuIdle': True})
        other = self.worker()['job']
        self.assertNotEqual(other['id'], job['id'])
        jobs = self.call('GET', '/jobs', session=self.admin)[1]['jobs']
        self.assertEqual(next(row for row in jobs if row['id'] == job['id'])['status'], 'failed')

    def test_chunk_upload_idempotence_integrity_and_video_ranges(self):
        job = self.claimed()
        self.problem(409, lambda: self.worker('/jobs/' + job['id'] + '/chunk', {'claim': 'wrong', 'part': 0, 'data': 'dGVzdA=='}))
        self.worker('/jobs/' + job['id'] + '/chunk', {'claim': job['claim'], 'part': 0, 'data': base64.b64encode(VIDEO[:studio.CHUNK]).decode()})
        self.problem(409, lambda: self.worker('/jobs/' + job['id'] + '/chunk', {'claim': job['claim'], 'part': 0, 'data': 'dGVzdA=='}))
        self.problem(409, lambda: self.worker('/jobs/' + job['id'] + '/complete', {'claim': job['claim'], 'parts': 2, 'sha256': hashlib.sha256(VIDEO).hexdigest()}))
        self.result(job)
        path = '/jobs/' + job['id'] + '/asset'
        code, data, headers = self.call('GET', path, session=self.admin, extra={'Range': 'bytes=4-7'})
        self.assertEqual((code, data, headers['Content-Type']), (206, b'ftyp', 'video/mp4'))
        self.assertEqual(self.call('GET', path, session=self.admin)[1], VIDEO)
        self.assertEqual(self.call('GET', path, session=self.admin, extra={'Range': 'bytes=7-2'})[0], 416)
        self.problem(401, lambda: self.call('GET', path))

    def test_storage_failure_preserves_chunks_for_retry_without_regeneration(self):
        job = self.claimed()
        body = {'claim': job['claim'], 'part': 0, 'data': base64.b64encode(VIDEO[:100]).decode()}
        self.worker('/jobs/' + job['id'] + '/chunk', body)
        complete = {'claim': job['claim'], 'parts': 1, 'sha256': hashlib.sha256(VIDEO[:100]).hexdigest()}
        with patch.object(self.fixture.cloud, 'put', side_effect=Problem(507, 'disk full')):
            self.problem(507, lambda: self.worker('/jobs/' + job['id'] + '/complete', complete))
        self.worker('/jobs/' + job['id'] + '/complete', complete)
        self.assertEqual(self.fixture.provider.calls, 0)

    def test_backup_restore_stops_local_jobs_and_discards_incomplete_chunks(self):
        job = self.claimed()
        self.worker('/jobs/' + job['id'] + '/chunk', {'claim': job['claim'], 'part': 0, 'data': 'dGVzdA=='})
        self.app.backup()
        destination = Path(self.fixture.temp.name) / 'workflow-restored.sqlite3'
        with patch.dict(os.environ, {'IMAGE_ENCRYPTION_KEY': self.fixture.fernet_key.decode()}), patch('image_service.cli.create_storage', return_value=self.fixture.cloud), patch('sys.argv', ['cli', 'restore', self.app.store.metadata('backup_key'), str(destination)]), patch('builtins.print'):
            cli.main()
        with closing(sqlite3.connect(destination)) as db:
            self.assertEqual(db.execute('SELECT status FROM local_jobs').fetchone()[0], 'failed')
            self.assertEqual(db.execute('SELECT count(*) FROM local_chunks').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0], 0)
