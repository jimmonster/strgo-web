"""Cross-application account behavior, including legacy image login migration."""
import time
import unittest
from email.message import Message
from io import BytesIO
from types import SimpleNamespace

from image_service.app import ACCOUNT_COOKIE, COOKIE, Service, HTTPHandler
from image_service.security import digest
from tests import test_image_service as fixture_module


class TerminalAccountTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture_module.ImageServiceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)

    def test_both_roles_use_terminal_without_image_config_or_storage(self):
        f = self.fixture
        member = f.register('regular_member')
        f.cloud.ready = False
        for session in (f.admin, member):
            status, body, _ = f.call('GET', '/terminal-session', session=session)
            self.assertEqual(status, 200)
            self.assertEqual(body['user'], session['user'])
            self.assertEqual(set(body), {'user', 'csrf', 'expires', 'maxWindows'})
            self.assertEqual(body['maxWindows'], 8)
            self.assertNotIn('password', str(body))

    def test_image_login_cookie_is_shared_and_remains_after_service_recreation(self):
        f = self.fixture
        _, result, headers = f.call('POST', '/login', {'username': 'owner', 'password': fixture_module.PASSWORD})
        self.assertTrue(headers['Set-Cookie'].startswith(ACCOUNT_COOKIE + '='))
        self.assertIn('Path=/;', headers['Set-Cookie'])
        other = Service(f.store, f.cloud, f.provider, 'https://strgo.com', start_worker=False)
        self.addCleanup(other.close)
        account = other.session({'cookie': headers['Set-Cookie'].split(';')[0]})
        self.assertEqual(account['id'], result['user']['id'])
        self.assertEqual(account['csrf'], result['csrf'])

    def test_legacy_cookie_is_migrated_without_extending_expiry(self):
        f = self.fixture
        token = f.admin['cookie'].split('=', 1)[1]
        expiry = int(time.time()) + 90
        with f.store.connect() as db:
            db.execute('UPDATE sessions SET expires=? WHERE hash=?', (expiry, digest(token)))
        legacy = {**f.admin, 'cookie': COOKIE + '=' + token}
        for path in ('/session', '/terminal-session'):
            _, body, headers = f.call('GET', path, session=legacy)
            self.assertIn(ACCOUNT_COOKIE + '=' + token, headers['Set-Cookie'])
            age = int(headers['Set-Cookie'].split('Max-Age=')[1].split(';')[0])
            self.assertTrue(0 < age <= 90)
        with f.store.connect() as db:
            self.assertEqual(db.execute('SELECT expires FROM sessions WHERE hash=?', (digest(token),)).fetchone()[0], expiry)

    def test_invalid_shared_cookie_cannot_fall_back_to_legacy_account(self):
        f = self.fixture
        token = f.admin['cookie'].split('=', 1)[1]
        mixed = COOKIE + '=' + token + '; ' + ACCOUNT_COOKIE + '=invalid'
        f.assert_problem(401, lambda: f.call('GET', '/terminal-session', extra={'Cookie': mixed}))

    def test_shared_logout_revokes_both_apps_and_old_migrated_cookie(self):
        f = self.fixture
        token = f.admin['cookie'].split('=', 1)[1]
        f.call('POST', '/logout', session=f.admin)
        for session in (f.admin, {**f.admin, 'cookie': COOKIE + '=' + token}):
            f.assert_problem(401, lambda: f.call('GET', '/terminal-session', session=session))
            self.assertIsNone(f.call('GET', '/session', session=session)[1]['user'])

    def test_logout_requires_origin_and_csrf_and_expired_sessions_are_rejected(self):
        f = self.fixture
        f.assert_problem(403, lambda: f.call('POST', '/logout', session=f.admin, extra={'Origin': 'https://attacker.test'}))
        f.assert_problem(403, lambda: f.call('POST', '/logout', session=f.admin, extra={'X-CSRF-Token': 'wrong'}))
        with f.store.connect() as db:
            db.execute('UPDATE sessions SET expires=0')
        f.assert_problem(401, lambda: f.call('GET', '/terminal-session', session=f.admin))

    def test_http_migration_sets_shared_cookie_and_removes_legacy_path_cookie(self):
        f = self.fixture
        handler = HTTPHandler.__new__(HTTPHandler)
        handler.headers = Message()
        handler.headers['Cookie'] = COOKIE + '=' + f.admin['cookie'].split('=', 1)[1]
        handler.path = '/api/image/terminal-session'
        handler.client_address = ('127.0.0.1', 1)
        handler.server = SimpleNamespace(service=f.app)
        handler.wfile = BytesIO()
        captured = []
        handler.send_response = lambda status: self.assertEqual(status, 200)
        handler.send_header = lambda key, value: captured.append((key, value))
        handler.end_headers = lambda: None
        handler.handle_request('GET')
        values = [value for key, value in captured if key == 'Set-Cookie']
        self.assertEqual(len(values), 2)
        self.assertTrue(values[0].startswith(ACCOUNT_COOKIE + '='))
        self.assertIn('Path=/;', values[0])
        self.assertIn(COOKIE + '=; Path=/api/image/', values[1])
        self.assertIn('Max-Age=0', values[1])


if __name__ == '__main__':
    unittest.main()
