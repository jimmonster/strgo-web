from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import time
import unittest
from unittest.mock import patch

from image_service.security import Problem, digest
from image_service import cli
from image_service.app import Service
from image_service.store import Store
from tests import test_image_service as fixtures

PASSWORD = fixtures.PASSWORD


class AdminTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ImageServiceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.app, self.store = self.fixture.app, self.fixture.store
        self.owner = self.fixture.admin
        self.member = self.fixture.register('member')

    def call(self, method, path, body=None, session=None, extra=None):
        return self.fixture.call(method, '/admin' + path, body, session or self.owner, extra)[1]

    def update(self, session, **changes):
        user_id = session['user']['id']
        with self.store.connect() as db:
            revision = db.execute('SELECT updated FROM users WHERE id=?', (user_id,)).fetchone()[0]
        return self.call('PUT', '/users/' + user_id, {'revision': revision, **changes})

    def error(self, code, action):
        with self.assertRaises(Problem) as caught:
            action()
        self.assertEqual(caught.exception.status, code)

    def test_admin_auth_origin_csrf_and_no_private_fields(self):
        self.error(401, lambda: self.fixture.call('GET', '/admin/users'))
        for path in ('/session', '/summary', '/users', '/invites', '/tasks', '/audit', '/forum/posts', '/policy'):
            self.error(403, lambda: self.call('GET', path, session=self.member))
        self.error(403, lambda: self.call('POST', '/invites', {}, extra={'Origin': 'https://evil.test'}))
        self.error(403, lambda: self.call('POST', '/invites', {}, extra={'X-CSRF-Token': 'wrong'}))
        text = json.dumps(self.call('GET', '/users'))
        for field in ('password', 'csrf', 'session_hash', 'scrypt', 'apiKey'):
            self.assertNotIn(field, text)

    def test_pagination_search_and_invalid_queries(self):
        users = self.call('GET', '/users?limit=1')
        self.assertEqual(users['total'], 2)
        self.assertTrue(users['hasMore'])
        self.assertEqual(len(users['items']), 1)
        self.assertEqual(self.call('GET', '/users?q=MEMB')['items'][0]['username'], 'member')
        self.assertEqual(self.call('GET', '/users?q=%25')['items'], [])
        for query in ('limit=0', 'limit=101', 'offset=-1', 'limit=no', 'q=' + 'x' * 81):
            self.error(400, lambda: self.call('GET', '/users?' + query))

    def test_disable_revokes_shared_and_workflow_sessions_and_login(self):
        identifier = self.member['user']['id']
        csrf, cookie = self.app.create_session(identifier)
        self.update(self.member, status='disabled')
        self.assertIsNone(self.app.session({'cookie': cookie['Set-Cookie'].split(';')[0]}))
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM sessions WHERE user_id=?', (identifier,)).fetchone()[0], 0)
        self.error(401, lambda: self.fixture.call('POST', '/login', {'username': 'member', 'password': PASSWORD}))
        self.error(401, lambda: self.app.create_session(identifier))
        snapshot = json.loads(self.fixture.cipher.decrypt(self.fixture.cloud.objects['tests/system/users/' + identifier + '.fernet']))
        self.assertEqual(snapshot['account_status'], 'disabled')
        self.update(self.member, status='active')
        self.fixture.call('POST', '/login', {'username': 'member', 'password': PASSWORD})

    def test_role_change_and_revoke_sessions_audited(self):
        self.update(self.member, role='admin')
        self.assertIsNone(self.app.session({'cookie': self.member['cookie']}))
        self.fixture.call('POST', '/login', {'username': 'member', 'password': PASSWORD})
        self.call('DELETE', '/users/' + self.member['user']['id'] + '/sessions')
        actions = {row['action'] for row in self.call('GET', '/audit')['items']}
        self.assertEqual(actions, {'user.update', 'user.sessions.revoke'})
        self.error(409, lambda: self.update(self.owner, role='member'))
        self.error(409, lambda: self.update(self.owner, status='disabled'))
        self.error(409, lambda: self.call('DELETE', '/users/' + self.owner['user']['id'] + '/sessions'))

    def test_optimistic_revision_and_storage_failure_preserve_account(self):
        identifier = self.member['user']['id']
        self.error(409, lambda: self.call('PUT', '/users/' + identifier, {'revision': 0, 'status': 'disabled'}))
        with patch.object(self.app, 'persist_user', side_effect=Problem(503, 'storage unavailable')):
            self.error(503, lambda: self.update(self.member, status='disabled'))
        self.assertIsNotNone(self.app.session({'cookie': self.member['cookie']}))
        self.assertEqual(self.call('GET', '/audit')['total'], 0)

    def test_pending_invite_revocation_never_returns_plaintext_in_lists(self):
        invitation = self.call('POST', '/invites', {})
        listed = self.call('GET', '/invites')
        self.assertNotIn(invitation['code'], json.dumps(listed))
        self.call('DELETE', '/invites/' + digest(invitation['code']))
        self.error(400, lambda: self.fixture.register('another', invite=invitation['code']))
        row = next(r for r in self.call('GET', '/invites')['items'] if r['id'] == digest(invitation['code']))
        self.assertEqual(row['status'], 'revoked')

    def test_policy_values_and_audit(self):
        for value in (0, 20, None):
            self.assertEqual(self.call('PUT', '/policy', {'dailyImageLimit': value})['dailyImageLimit'], value)
        for value in (-1, True, 100001, '20'):
            self.error(400, lambda: self.call('PUT', '/policy', {'dailyImageLimit': value}))
        self.assertEqual(self.call('GET', '/audit')['total'], 3)

    def test_summary_and_tasks_exclude_prompts_and_credentials(self):
        job = self.fixture.create_job(self.member, prompt='private prompt must stay private')
        for module in ('image', 'ai', 'workflow'):
            data = self.call('GET', '/tasks?module=' + module)
            self.assertNotIn('private prompt', json.dumps(data))
            self.assertNotIn('provider_config', json.dumps(data))
        self.assertEqual(self.call('GET', '/tasks?module=image')['items'][0]['id'], job['id'])
        self.assertEqual(self.call('GET', '/summary')['counts']['users'], 2)
        self.error(400, lambda: self.call('GET', '/tasks?module=unknown'))

    def test_forum_pin_delete_and_audit(self):
        post = self.fixture.call('POST', '/forum/posts', {'title': 'Hello', 'body': 'Community post', 'category': 'general'}, self.member)[1]
        path = '/forum/posts/' + post['id']
        self.call('PUT', path + '/pin', {'pinned': True})
        self.assertTrue(self.call('GET', '/forum/posts')['posts'][0]['pinned'])
        self.call('DELETE', path)
        self.assertEqual(self.call('GET', '/forum/posts')['total'], 0)
        self.assertEqual(self.call('GET', '/audit')['total'], 2)

    def test_restore_does_not_override_independent_ai_block(self):
        self.update(self.member, status='disabled')
        with self.store.connect() as db:
            db.execute("INSERT INTO ai_members(user_id,status) VALUES(?,'disabled')", (self.member['user']['id'],))
        self.update(self.member, status='active')
        self.error(401, lambda: self.fixture.call('POST', '/login', {'username': 'member', 'password': PASSWORD}))

    def test_disabled_admin_cannot_count_as_last_effective_admin_in_ai(self):
        self.update(self.member, role='admin')
        self.update(self.member, status='disabled')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            actor = self.app.session({'cookie': self.owner['cookie']})
            db.execute('INSERT INTO ai_stepups VALUES(?,?)', (actor['session_hash'], int(time.time()) + 300))
            self.error(409, lambda: self.app.ai.admin_route(db, actor, 'PUT', '/members/' + actor['id'], {'status': 'disabled'}))

    def test_reindex_and_password_reset_preserve_role_and_disabled_status(self):
        self.update(self.member, role='admin')
        self.update(self.member, status='disabled')
        destination = Path(self.fixture.temp.name) / 'reindexed'
        with patch.dict(os.environ, {'IMAGE_DATA_DIR': str(self.store.directory), 'IMAGE_ENCRYPTION_KEY': self.fixture.fernet_key.decode()}), \
                patch('image_service.cli.create_storage', return_value=self.fixture.cloud), \
                patch('getpass.getpass', return_value='Another-private-password-2026'), patch('builtins.print'), \
                patch('sys.argv', ['cli', 'reset-password', 'member']):
            cli.main()
        with patch.dict(os.environ, {'IMAGE_DATA_DIR': str(destination), 'IMAGE_ENCRYPTION_KEY': self.fixture.fernet_key.decode()}), \
                patch('image_service.cli.create_storage', return_value=self.fixture.cloud), patch('builtins.print'), \
                patch('sys.argv', ['cli', 'reindex']):
            cli.main()
        restored = Store(destination, self.fixture.cipher)
        service = Service(restored, self.fixture.cloud, self.fixture.provider, 'https://strgo.com', start_worker=False)
        self.addCleanup(service.close)
        with restored.connect() as db:
            self.assertEqual(db.execute("SELECT role FROM users WHERE username='member'").fetchone()[0], 'admin')
            self.assertEqual(db.execute('SELECT status FROM account_controls WHERE user_id=?', (self.member['user']['id'],)).fetchone()[0], 'disabled')
        self.error(401, lambda: service.authenticate('member', 'Another-private-password-2026'))

    def test_competing_administrators_cannot_disable_each_other_to_remove_all_admins(self):
        self.update(self.member, role='admin')
        _, body, headers = self.fixture.call('POST', '/login', {'username': 'member', 'password': PASSWORD})
        member = {'user': body['user'], 'csrf': body['csrf'], 'cookie': headers['Set-Cookie'].split(';')[0]}
        with self.store.connect() as db:
            revisions = {row['id']: row['updated'] for row in db.execute('SELECT id,updated FROM users')}
        def disable(actor, target):
            try:
                self.call('PUT', '/users/' + target['user']['id'], {'status': 'disabled', 'revision': revisions[target['user']['id']]}, session=actor)
                return 200
            except Problem as error:
                return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            calls = [pool.submit(disable, self.owner, member), pool.submit(disable, member, self.owner)]
            codes = [call.result() for call in calls]
        self.assertEqual(codes.count(200), 1)
        self.assertTrue(any(code in (401, 403) for code in codes))
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM users u LEFT JOIN account_controls c ON c.user_id=u.id WHERE u.role='admin' AND COALESCE(c.status,'active')='active'").fetchone()[0], 1)
