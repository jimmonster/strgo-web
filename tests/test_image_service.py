import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid

from cryptography.fernet import Fernet

from image_service.app import Service, API
from image_service import cli, cloud
from image_service.cloud import ImageProvider
from image_service.security import Problem, digest, image_type, password_matches, public_addresses, validate_endpoint
from image_service.store import Store


PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=')
ORIGIN = 'https://strgo.com'
PASSWORD = 'Strong-private-password-2026'


class FakeStorage:
    ready = True
    label = '测试存储'

    def __init__(self):
        self.objects = {}
        self.fail_images = False

    def key(self, suffix):
        return 'tests/' + suffix

    def put(self, key, data, mime):
        if self.fail_images and '/images/' in key:
            raise Problem(502, 'OSS 暂时不可用。')
        self.objects[key] = data

    def get(self, key):
        return self.objects[key]

    def delete(self, key):
        self.objects.pop(key, None)

    def iter_keys(self, prefix):
        return (key for key in self.objects if key.startswith(prefix))


class FakeProvider:
    def __init__(self):
        self.calls = 0
        self.configs = []
        self.jobs = []

    def generate(self, config, job):
        self.calls += 1
        self.configs.append(config)
        self.jobs.append(job)
        return [{'b64_json': base64.b64encode(PNG).decode()} for _ in range(job['count'])]

    image_bytes = ImageProvider.image_bytes


class ImageServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.fernet_key = Fernet.generate_key()
        self.cipher = Fernet(self.fernet_key)
        self.store = Store(self.temp.name, self.cipher)
        self.cloud, self.provider = FakeStorage(), FakeProvider()
        self.app = Service(self.store, self.cloud, self.provider, ORIGIN, start_worker=False)
        self.admin = self.register('owner', role='admin')

    def tearDown(self):
        self.app.close()
        self.temp.cleanup()

    def call(self, method, path, body=None, session=None, extra=None):
        headers = {'Origin': ORIGIN}
        if session:
            headers.update({'Cookie': session['cookie'], 'X-CSRF-Token': session['csrf']})
        headers.update(extra or {})
        return self.app.dispatch(method, API + path, body, headers, ip='test')

    def register(self, username, role='member', invite=None):
        token = invite or self.app.invite('test', role)['code']
        status, body, headers = self.call('POST', '/register', {'username': username, 'password': PASSWORD, 'invite': token})
        self.assertEqual(status, 200)
        return {'cookie': headers['Set-Cookie'].split(';')[0], 'csrf': body['csrf'], 'user': body['user']}

    def configure(self, session=None, endpoint='https://images.example.com/v1/images/generations', key='test-provider-key-12345', model='test-model'):
        return self.call('PUT', '/config', {'endpoint': endpoint, 'apiKey': key, 'model': model}, session or self.admin)

    def create_job(self, session=None, count=1, request_id=None, prompt='A quiet lake'):
        session = session or self.admin
        self.configure(session)
        return self.call('POST', '/jobs', {'prompt': prompt, 'size': '1024x1024', 'count': count, 'quality': '', 'requestId': request_id or str(uuid.uuid4())}, session)[1]

    def assert_problem(self, status, callback):
        with self.assertRaises(Problem) as caught:
            callback()
        self.assertEqual(caught.exception.status, status)

    def test_signup_requires_unused_unexpired_invite_and_hashes_password(self):
        token = self.app.invite('test')['code']
        self.register('member', invite=token)
        self.assert_problem(400, lambda: self.register('stranger', invite=token))
        self.assert_problem(400, lambda: self.register('other', invite='guessed'))
        with self.store.connect() as db:
            row = db.execute("SELECT * FROM users WHERE username='member'").fetchone()
            self.assertNotEqual(row['password'], PASSWORD)
            self.assertTrue(password_matches(PASSWORD, row['password']))
            invite = db.execute('SELECT * FROM invites WHERE hash=?', (digest(token),)).fetchone()
            self.assertEqual(invite['used_by'], row['id'])
            self.assertNotEqual(invite['hash'], token)
            account_object = self.cloud.objects['tests/system/users/' + row['id'] + '.fernet']
            account = json.loads(self.cipher.decrypt(account_object))
            self.assertEqual(account['password'], row['password'])
            self.assertNotIn(PASSWORD.encode(), account_object)
        self.assertNotIn(PASSWORD.encode(), self.store.path.read_bytes())

    def test_expired_invite_rejected_without_consumption(self):
        token = self.app.invite('test')['code']
        with self.store.connect() as db:
            db.execute('UPDATE invites SET expires=0 WHERE hash=?', (digest(token),))
        self.assert_problem(400, lambda: self.register('late', invite=token))

    def test_concurrent_registration_consumes_one_invitation_once(self):
        token = self.app.invite('test')['code']
        def signup(name):
            try:
                self.register(name, invite=token)
                return 'ok'
            except Problem as error:
                return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(signup, ['first', 'second']))
        self.assertEqual(results.count('ok'), 1)
        self.assertEqual(results.count(400), 1)

    def test_session_cookie_is_secure_and_tokens_are_hashed_at_rest(self):
        _, body, headers = self.call('POST', '/login', {'username': 'OWNER', 'password': PASSWORD})
        cookie = headers['Set-Cookie']
        for flag in ('Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/api/image/'):
            self.assertIn(flag, cookie)
        token = cookie.split(';')[0].split('=')[1]
        with self.store.connect() as db:
            self.assertIsNotNone(db.execute('SELECT * FROM sessions WHERE hash=?', (digest(token),)).fetchone())
        self.assertNotIn(token.encode(), self.store.path.read_bytes())
        self.assert_problem(401, lambda: self.call('POST', '/login', {'username': 'owner', 'password': 'wrong'}))

    def test_authentication_origin_and_csrf_enforced(self):
        self.assert_problem(401, lambda: self.call('GET', '/jobs'))
        self.assert_problem(403, lambda: self.call('PUT', '/config', {}, self.admin, {'Origin': 'https://evil.example'}))
        self.assert_problem(403, lambda: self.call('PUT', '/config', {}, self.admin, {'X-CSRF-Token': 'wrong'}))
        self.assert_problem(403, lambda: self.call('POST', '/login', {}, extra={'Origin': ''}))

    def test_password_change_revokes_other_sessions_and_keeps_current_login(self):
        _, second, headers = self.call('POST', '/login', {'username': 'owner', 'password': PASSWORD})
        other = {'cookie': headers['Set-Cookie'].split(';')[0], 'csrf': second['csrf']}
        _, result, fresh_headers = self.call('PUT', '/password', {'oldPassword': PASSWORD, 'newPassword': 'Updated-private-password-2026'}, self.admin)
        with self.store.connect() as db:
            user = db.execute("SELECT * FROM users WHERE username='owner'").fetchone()
        cloud_user = json.loads(self.cipher.decrypt(self.cloud.objects['tests/system/users/' + user['id'] + '.fernet']))
        self.assertTrue(password_matches('Updated-private-password-2026', cloud_user['password']))
        self.assertGreater(cloud_user['updated'], cloud_user['created'])
        self.assert_problem(401, lambda: self.call('GET', '/jobs', session=other))
        self.assert_problem(401, lambda: self.call('GET', '/jobs', session=self.admin))
        fresh = {'cookie': fresh_headers['Set-Cookie'].split(';')[0], 'csrf': result['csrf']}
        self.assertEqual(self.call('GET', '/jobs', session=fresh)[0], 200)

    def test_logout_invalidates_server_session(self):
        self.call('POST', '/logout', session=self.admin)
        self.assert_problem(401, lambda: self.call('GET', '/jobs', session=self.admin))

    def test_configuration_is_encrypted_never_returned_and_retained_only_for_same_endpoint(self):
        self.configure()
        _, info, _ = self.call('GET', '/session', session=self.admin)
        self.assertTrue(info['config']['hasKey'])
        self.assertNotIn('test-provider-key-12345', json.dumps(info))
        self.assertNotIn(b'test-provider-key-12345', self.store.path.read_bytes())
        remote_config = self.cloud.objects['tests/system/configs/' + self.admin['user']['id'] + '.fernet']
        self.assertNotIn(b'test-provider-key-12345', remote_config)
        self.assertEqual(json.loads(self.cipher.decrypt(remote_config))['apiKey'], 'test-provider-key-12345')
        self.configure(key='')
        self.assertEqual(self.store.config(self.admin['user']['id'])['apiKey'], 'test-provider-key-12345')
        self.assert_problem(400, lambda: self.configure(endpoint='https://other.example/v1/images/generations', key=''))

    def test_private_addresses_and_cloud_metadata_blocked(self):
        for address in ('127.0.0.1', '10.0.0.1', '169.254.169.254', '100.100.100.200', '::1', '::ffff:127.0.0.1'):
            with patch('image_service.security.socket.getaddrinfo', return_value=[(None, None, None, None, (address, 443))]):
                self.assert_problem(400, lambda: public_addresses('example.com', 443))
        for value in ('http://example.com/v1/images/generations', 'https://user:key@example.com/v1/images/generations', 'https://example.com:8080/v1/images/generations', 'https://example.com/v1/images/generations?token=abc'):
            self.assert_problem(400, lambda: validate_endpoint(value))

    def test_generation_requires_cloud_config_and_provider_config(self):
        self.cloud.ready = False
        payload = {'prompt': 'test', 'size': '1024x1024', 'count': 1, 'requestId': str(uuid.uuid4())}
        self.assert_problem(503, lambda: self.call('POST', '/jobs', payload, self.admin))
        self.cloud.ready = True
        self.assert_problem(409, lambda: self.call('POST', '/jobs', payload, self.admin))
        self.assertEqual(self.provider.calls, 0)

    def test_job_snapshots_config_and_duplicate_submission_does_not_regenerate(self):
        request_id = str(uuid.uuid4())
        job = self.create_job(request_id=request_id)
        duplicate = self.create_job(request_id=request_id)
        self.assertEqual(job['id'], duplicate['id'])
        self.configure(model='changed-after-submit')
        self.app.run_job(job['id'])
        self.app.run_job(job['id'])
        self.assertEqual(self.provider.calls, 1)
        self.assertEqual(self.provider.configs[0]['model'], 'test-model')

    def test_custom_size_and_reference_image_are_encrypted_queued_and_used_once(self):
        self.configure()
        encoded = base64.b64encode(PNG).decode()
        status, job, _ = self.call('POST', '/jobs', {
            'prompt': 'Use the light and composition from this reference', 'size': '2048x768',
            'quality': '', 'count': 1, 'requestId': str(uuid.uuid4()),
            'referenceImage': {'mime': 'image/png', 'data': encoded},
        }, self.admin)
        self.assertEqual(status, 202)
        self.assertEqual(job['size'], '2048x768')
        self.assertTrue(job['hasReference'])
        with self.store.connect() as db:
            row = db.execute('SELECT reference_image FROM jobs WHERE id=?', (job['id'],)).fetchone()
        self.assertNotIn(PNG, row['reference_image'])
        self.assertEqual(self.cipher.decrypt(row['reference_image']), PNG)
        self.app.run_job(job['id'])
        self.assertEqual(self.provider.jobs[0]['reference_image'], PNG)
        with self.store.connect() as db:
            self.assertIsNone(db.execute('SELECT reference_image FROM jobs WHERE id=?', (job['id'],)).fetchone()['reference_image'])
        result = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]
        self.assertTrue(result['hasReference'])

    def test_reference_image_and_custom_size_are_strictly_validated(self):
        self.configure()
        base = {'prompt': 'A prompt', 'size': '1024x1024', 'count': 1, 'quality': '', 'requestId': str(uuid.uuid4())}
        bad_size = dict(base, size='2048x750', requestId=str(uuid.uuid4()))
        self.assert_problem(400, lambda: self.call('POST', '/jobs', bad_size, self.admin))
        bad_image = dict(base, requestId=str(uuid.uuid4()), referenceImage={'mime': 'image/png', 'data': base64.b64encode(b'not a png').decode()})
        self.assert_problem(400, lambda: self.call('POST', '/jobs', bad_image, self.admin))
        oversized = dict(base, requestId=str(uuid.uuid4()), referenceImage={'mime': 'image/png', 'data': 'A' * 7_000_001})
        self.assert_problem(400, lambda: self.call('POST', '/jobs', oversized, self.admin))

    def test_compressed_reference_has_an_exact_2mb_binary_limit(self):
        self.configure()
        for size in (2_000_001, 2_000_000):
            data = PNG + b'\x00' * (size - len(PNG))
            payload = {'prompt': 'Use this compressed reference', 'size': '1024x1024', 'count': 1,
                       'requestId': str(uuid.uuid4()), 'referenceImage': {'mime': 'image/png', 'data': base64.b64encode(data).decode()}}
            if size > 2_000_000:
                self.assert_problem(400, lambda: self.call('POST', '/jobs', payload, self.admin))
            else:
                self.assertEqual(self.call('POST', '/jobs', payload, self.admin)[0], 202)

    def test_provider_sends_reference_as_multipart_edits_without_redirecting_credentials(self):
        captured = {}
        def fake_request(url, **options):
            captured.update({'url': url, **options})
            return b'{"data": [{"b64_json": "' + base64.b64encode(PNG) + b'"}]}'
        with patch.object(cloud, 'https_request', side_effect=fake_request):
            result = ImageProvider().generate(
                {'endpoint': 'https://images.example.com/v1/images/generations', 'apiKey': 'test-key', 'model': 'test-model'},
                {'prompt': 'Preserve the reference composition', 'size': '2048x768', 'quality': 'high', 'count': 1, 'reference_image': PNG},
            )
        self.assertEqual(result, [{'b64_json': base64.b64encode(PNG).decode()}])
        self.assertEqual(captured['url'], 'https://images.example.com/v1/images/edits')
        self.assertTrue(captured['headers']['Content-Type'].startswith('multipart/form-data; boundary='))
        self.assertEqual(captured['headers']['Authorization'], 'Bearer test-key')
        self.assertIn(b'name="size"\r\n\r\n2048x768', captured['body'])
        self.assertIn(b'name="prompt"\r\n\r\nPreserve the reference composition', captured['body'])
        self.assertIn(b'filename="reference.png"', captured['body'])
        self.assertIn(PNG, captured['body'])

    def test_inspirations_are_saved_reusable_deletable_and_private_per_account(self):
        status, saved, _ = self.call('POST', '/inspirations', {
            'prompt': 'A quiet lake at dawn', 'title': '湖边晨雾', 'size': '2048x768', 'quality': 'high', 'count': 2,
        }, self.admin)
        self.assertEqual(status, 201)
        self.assertEqual(saved['size'], '2048x768')
        self.assertEqual(saved['title'], '湖边晨雾')
        _, result, _ = self.call('GET', '/inspirations', session=self.admin)
        self.assertEqual([item['id'] for item in result['inspirations']], [saved['id']])
        member = self.register('member')
        _, result, _ = self.call('GET', '/inspirations', session=member)
        self.assertEqual(result['inspirations'], [])
        self.assert_problem(404, lambda: self.call('DELETE', '/inspirations/' + saved['id'], session=member))
        self.call('DELETE', '/inspirations/' + saved['id'], session=self.admin)
        self.assertEqual(self.call('GET', '/inspirations', session=self.admin)[1]['inspirations'], [])
        self.assert_problem(400, lambda: self.call('POST', '/inspirations', {'prompt': 'A prompt', 'size': '512x511', 'quality': '', 'count': 1}, self.admin))

    def test_generated_images_saved_and_served_from_private_oss(self):
        job = self.create_job(count=2)
        self.app.run_job(job['id'])
        _, result, _ = self.call('GET', '/jobs/' + job['id'], session=self.admin)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(len(result['images']), 2)
        for image in result['images']:
            self.assertEqual(image['state'], 'saved')
            self.assertNotIn('aliyuncs.com', image['url'])
            status, data, headers = self.call('GET', '/assets/' + image['id'] + '?download=1', session=self.admin)
            self.assertEqual(status, 200)
            self.assertEqual(data, PNG)
            self.assertIn('attachment', headers['Content-Disposition'])
            self.assertFalse((self.store.spool / (image['id'] + '.enc')).exists())

    def test_delete_one_image_removes_files_and_preserves_other_images(self):
        job = self.create_job(count=2)
        self.app.run_job(job['id'])
        images = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]['images']
        removed, kept = images
        with self.store.connect() as db:
            key = db.execute('SELECT object_key FROM images WHERE id=?', (removed['id'],)).fetchone()['object_key']
        result = self.call('DELETE', '/images/' + removed['id'], session=self.admin)
        self.assertEqual(result[:2], (200, {'deleted': True, 'cleanupPending': False}))
        self.assertNotIn(key, self.cloud.objects)
        self.assertNotIn(key + '.metadata.fernet', self.cloud.objects)
        remaining = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]
        self.assertEqual([image['id'] for image in remaining['images']], [kept['id']])
        self.assertEqual(remaining['status'], 'complete')
        self.assertEqual(self.call('GET', '/assets/' + kept['id'], session=self.admin)[1], PNG)
        self.assert_problem(404, lambda: self.call('GET', '/assets/' + removed['id'], session=self.admin))
        self.assert_problem(404, lambda: self.call('PUT', '/images/' + removed['id'] + '/favorite', {'favorite': True}, self.admin))
        self.assert_problem(404, lambda: self.call('POST', '/images/' + removed['id'] + '/retry', session=self.admin))
        self.assertEqual(self.call('DELETE', '/images/' + removed['id'], session=self.admin)[0], 200)
        self.app.upload_image(removed['id'])
        self.assertNotIn(key, self.cloud.objects)
        self.assertEqual(self.provider.calls, 1)

    def test_deleting_last_image_hides_job_from_library_search_and_favorites(self):
        job = self.create_job()
        self.app.run_job(job['id'])
        image = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]['images'][0]
        self.call('PUT', '/images/' + image['id'] + '/favorite', {'favorite': True}, self.admin)
        self.call('DELETE', '/images/' + image['id'], session=self.admin)
        for query in ('', '?search=lake', '?favorite=true'):
            self.assertEqual(self.call('GET', '/jobs' + query, session=self.admin)[1], {'jobs': [], 'hasMore': False})
        self.app.close()
        self.app = Service(self.store, self.cloud, self.provider, ORIGIN, start_worker=False)
        self.assertEqual(self.call('GET', '/jobs', session=self.admin)[1]['jobs'], [])
        self.assert_problem(404, lambda: self.call('GET', '/assets/' + image['id'] + '?download=1', session=self.admin))
        self.assertTrue(self.call('GET', '/session', session=self.admin)[1]['config']['hasKey'])

    def test_deletion_requires_owner_session_csrf_and_same_origin(self):
        job = self.create_job()
        self.app.run_job(job['id'])
        image = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]['images'][0]
        member = self.register('member')
        self.assert_problem(401, lambda: self.call('DELETE', '/images/' + image['id']))
        self.assert_problem(404, lambda: self.call('DELETE', '/images/' + image['id'], session=member))
        self.assert_problem(403, lambda: self.call('DELETE', '/images/' + image['id'], session=self.admin, extra={'X-CSRF-Token': 'invalid'}))
        self.assert_problem(403, lambda: self.call('DELETE', '/images/' + image['id'], session=self.admin, extra={'Origin': 'https://other.example'}))
        self.assertEqual(self.call('GET', '/assets/' + image['id'], session=self.admin)[1], PNG)

    def test_pending_image_deletion_removes_spool_and_prevents_upload_retry(self):
        self.cloud.fail_images = True
        job = self.create_job()
        self.app.run_job(job['id'])
        image = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]['images'][0]
        spool = self.store.spool / (image['id'] + '.enc')
        self.assertTrue(spool.exists())
        self.assertEqual(self.call('DELETE', '/images/' + image['id'], session=self.admin)[0], 200)
        self.assertFalse(spool.exists())
        self.cloud.fail_images = False
        self.app.upload_image(image['id'])
        self.assertEqual(self.call('GET', '/jobs', session=self.admin)[1]['jobs'], [])
        self.assertEqual(self.provider.calls, 1)

    def test_failed_file_cleanup_is_hidden_durable_and_retryable(self):
        job = self.create_job()
        self.app.run_job(job['id'])
        image = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]['images'][0]
        with patch.object(self.cloud, 'delete', side_effect=Problem(503, '存储不可用')):
            status, result, _ = self.call('DELETE', '/images/' + image['id'], session=self.admin)
        self.assertEqual(status, 202)
        self.assertTrue(result['cleanupPending'])
        self.assertEqual(self.call('GET', '/jobs', session=self.admin)[1]['jobs'], [])
        self.assert_problem(404, lambda: self.call('GET', '/assets/' + image['id'], session=self.admin))
        self.app.close()
        self.app = Service(self.store, self.cloud, self.provider, ORIGIN, start_worker=False)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT state FROM images WHERE id=?', (image['id'],)).fetchone()['state'], 'deleting')
        self.assertTrue(self.app.delete_image(image['id']))
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM images WHERE id=?', (image['id'],)).fetchone()
            self.assertEqual(row['state'], 'deleted')
            self.assertNotIn(row['object_key'], self.cloud.objects)
            self.assertNotIn(row['object_key'] + '.metadata.fernet', self.cloud.objects)
        self.assertEqual(self.provider.calls, 1)

    def test_inflight_upload_cannot_recreate_a_deleted_image(self):
        self.cloud.fail_images = True
        job = self.create_job()
        self.app.run_job(job['id'])
        image = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]['images'][0]
        self.cloud.fail_images = False
        started, release = threading.Event(), threading.Event()
        original_put = self.cloud.put
        def delayed_put(key, data, mime):
            if '/images/' in key and not key.endswith('.metadata.fernet'):
                started.set()
                if not release.wait(5):
                    raise RuntimeError('test upload timed out')
            return original_put(key, data, mime)
        with patch.object(self.cloud, 'put', side_effect=delayed_put), ThreadPoolExecutor(max_workers=2) as pool:
            upload = pool.submit(self.app.upload_image, image['id'])
            self.assertTrue(started.wait(5))
            deletion = pool.submit(self.call, 'DELETE', '/images/' + image['id'], None, self.admin)
            release.set()
            upload.result(timeout=10)
            self.assertEqual(deletion.result(timeout=10)[0], 200)
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM images WHERE id=?', (image['id'],)).fetchone()
        self.assertEqual(row['state'], 'deleted')
        self.assertNotIn(row['object_key'], self.cloud.objects)
        self.assertNotIn(row['object_key'] + '.metadata.fernet', self.cloud.objects)
        self.assertEqual(self.provider.calls, 1)

    def test_cross_account_jobs_images_config_and_admin_operations_are_isolated(self):
        job = self.create_job()
        self.app.run_job(job['id'])
        image = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]['images'][0]
        member = self.register('member')
        self.assertEqual(self.call('GET', '/jobs', session=member)[1]['jobs'], [])
        self.assertFalse(self.call('GET', '/session', session=member)[1]['config']['hasKey'])
        self.assert_problem(404, lambda: self.call('GET', '/jobs/' + job['id'], session=member))
        self.assert_problem(404, lambda: self.call('GET', '/assets/' + image['id'], session=member))
        self.assert_problem(404, lambda: self.call('PUT', '/images/' + image['id'] + '/favorite', {'favorite': True}, member))
        self.assert_problem(403, lambda: self.call('POST', '/invites', session=member))
        self.assert_problem(403, lambda: self.call('POST', '/backup', session=member))

    def test_upload_failure_retains_encrypted_image_and_retry_does_not_call_model(self):
        self.cloud.fail_images = True
        job = self.create_job()
        self.app.run_job(job['id'])
        result = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]
        self.assertEqual(result['status'], 'uploading')
        image = result['images'][0]
        self.assertEqual(image['state'], 'pending')
        file = self.store.spool / (image['id'] + '.enc')
        self.assertTrue(file.exists())
        self.assertNotEqual(file.read_bytes(), PNG)
        self.assertEqual(self.cipher.decrypt(file.read_bytes()), PNG)
        self.app.close()
        self.app = Service(self.store, self.cloud, self.provider, ORIGIN, start_worker=False)
        self.cloud.fail_images = False
        self.app.upload_image(image['id'])
        after = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]
        self.assertEqual(after['status'], 'complete')
        self.assertEqual(after['images'][0]['state'], 'saved')
        self.assertEqual(self.provider.calls, 1)

    def test_restart_does_not_repeat_an_interrupted_paid_generation(self):
        job = self.create_job()
        with self.store.connect() as db:
            db.execute("UPDATE jobs SET status='generating' WHERE id=?", (job['id'],))
        self.app.recover()
        result = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]
        self.assertEqual(result['status'], 'failed')
        self.assertIn('重复计费', result['error'])
        self.app.run_job(job['id'])
        self.assertEqual(self.provider.calls, 0)

    def test_cloud_backup_encrypted_and_restorable(self):
        self.configure()
        self.app.backup()
        key = self.store.metadata('backup_key')
        data = self.cloud.objects[key]
        self.assertFalse(data.startswith(b'SQLite'))
        restored = self.cipher.decrypt(data)
        self.assertTrue(restored.startswith(b'SQLite format 3'))
        target = Path(self.temp.name) / 'restore.sqlite3'
        target.write_bytes(restored)
        with sqlite3.connect(target) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            encrypted = db.execute('SELECT encrypted FROM configs').fetchone()[0]
            config = json.loads(self.cipher.decrypt(encrypted))
            self.assertEqual(config['apiKey'], 'test-provider-key-12345')

    def test_search_and_favorite_filters_use_cloud_backed_records(self):
        first = self.create_job(prompt='Mountain with flowers')
        self.app.run_job(first['id'])
        second = self.create_job(prompt='City at night')
        self.app.run_job(second['id'])
        image = self.call('GET', '/jobs/' + first['id'], session=self.admin)[1]['images'][0]
        self.call('PUT', '/images/' + image['id'] + '/favorite', {'favorite': True}, self.admin)
        favorites = self.call('GET', '/jobs?favorite=true', session=self.admin)[1]['jobs']
        self.assertEqual([x['id'] for x in favorites], [first['id']])
        search = self.call('GET', '/jobs?search=night', session=self.admin)[1]['jobs']
        self.assertEqual([x['id'] for x in search], [second['id']])

    def test_api_validates_numeric_types_and_limits_guessed_logins(self):
        self.configure()
        self.assert_problem(400, lambda: self.call('POST', '/jobs', {'prompt': 'x', 'size': '1024x1024', 'count': True, 'requestId': str(uuid.uuid4())}, self.admin))
        with self.store.connect() as db:
            db.execute('DELETE FROM limits')
        for _ in range(15):
            self.assert_problem(401, lambda: self.call('POST', '/login', {'username': 'owner', 'password': 'wrong'}))
        self.assert_problem(429, lambda: self.call('POST', '/login', {'username': 'owner', 'password': 'wrong'}))

    def test_invalid_or_corrupt_image_never_reported_as_saved(self):
        self.assert_problem(502, lambda: image_type(b'<html>not an image</html>'))
        self.assert_problem(502, lambda: self.provider.image_bytes({'b64_json': 'broken'}))
        job = self.create_job()
        self.app.run_job(job['id'])
        image = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]['images'][0]
        with self.store.connect() as db:
            record = db.execute('SELECT * FROM images WHERE id=?', (image['id'],)).fetchone()
        self.cloud.objects[record['object_key']] = b'corrupted'
        self.assert_problem(502, lambda: self.call('GET', '/assets/' + image['id'], session=self.admin))

    def test_reindex_restores_account_config_and_saved_images_without_model_calls(self):
        job = self.create_job()
        self.app.run_job(job['id'])
        original = self.call('GET', '/jobs/' + job['id'], session=self.admin)[1]
        calls = self.provider.calls
        target = Path(self.temp.name) / 'disaster-recovery'
        with patch.dict('os.environ', {'IMAGE_DATA_DIR': str(target), 'IMAGE_ENCRYPTION_KEY': self.fernet_key.decode()}), \
             patch('image_service.cli.create_storage', return_value=self.cloud), \
             patch('sys.argv', ['cli', 'reindex']), patch('builtins.print'):
            cli.main()
            cli.main()  # Repeated recovery is idempotent.
        restored = Store(target, self.cipher)
        with restored.connect() as db:
            owner = db.execute('SELECT * FROM users WHERE id=?', (self.admin['user']['id'],)).fetchone()
            self.assertTrue(password_matches(PASSWORD, owner['password']))
            rows = db.execute('SELECT * FROM images WHERE user_id=?', (owner['id'],)).fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['state'], 'saved')
            self.assertEqual(rows[0]['id'], original['images'][0]['id'])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0], 0)
        self.assertEqual(restored.config(owner['id'])['apiKey'], 'test-provider-key-12345')
        self.assertEqual(self.provider.calls, calls)

    def test_registration_cloud_failure_does_not_consume_invitation(self):
        token = self.app.invite('test')['code']
        with patch.object(self.cloud, 'put', side_effect=Problem(502, 'Cloud unavailable')):
            self.assert_problem(502, lambda: self.register('waitcloud', invite=token))
        with self.store.connect() as db:
            self.assertIsNone(db.execute("SELECT * FROM users WHERE username='waitcloud'").fetchone())
            invite = db.execute('SELECT * FROM invites WHERE hash=?', (digest(token),)).fetchone()
            self.assertIsNone(invite['used_by'])
        self.register('waitcloud', invite=token)

    def test_restore_database_revokes_sessions_and_refuses_overwrite(self):
        invitation = self.app.invite('test')['code']
        self.app.backup()
        key = self.store.metadata('backup_key')
        destination = Path(self.temp.name) / 'recovered.sqlite3'
        with patch.dict('os.environ', {'IMAGE_ENCRYPTION_KEY': self.fernet_key.decode()}), \
             patch('image_service.cli.create_storage', return_value=self.cloud), \
             patch('sys.argv', ['cli', 'restore', key, str(destination)]), patch('builtins.print'):
            cli.main()
            with self.assertRaises(FileExistsError):
                cli.main()
        with sqlite3.connect(destination) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0], 0)
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute('SELECT expires FROM invites WHERE hash=?', (digest(invitation),)).fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
