import secrets
from urllib.parse import parse_qs, urlsplit
import unittest
from unittest.mock import patch

from image_service import comfy_auth
from image_service.security import Problem, digest
from tests import test_image_service as fixtures


class ComfyAuthTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ImageServiceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.service = self.fixture.app
        self.store = self.fixture.store
        self.bridge = secrets.token_urlsafe(32)
        bridge = patch.object(comfy_auth, 'bridge_secret', return_value=self.bridge)
        bridge.start()
        self.addCleanup(bridge.stop)

    def internal(self, action, payload, token=None):
        return self.service.dispatch('POST', comfy_auth.INTERNAL + action, payload,
                                     {'X-STRGO-Comfy-Bridge': self.bridge if token is None else token})[1]

    def authorize(self, cookie):
        state = secrets.token_urlsafe(32)
        status, _, headers = self.service.dispatch('GET', comfy_auth.PUBLIC + '?state=' + state,
                                                   headers={'Cookie': cookie})
        self.assertEqual(status, 303)
        location = urlsplit(headers['Location'])
        if not location.netloc:
            return location.path
        self.assertEqual(location.netloc, 'comfyui.strgo.com')
        self.assertEqual(location.path, '/auth/callback')
        return {key: value[0] for key, value in parse_qs(location.query).items()}

    def status(self, expected, fn, *args):
        with self.assertRaises(Problem) as raised:
            fn(*args)
        self.assertEqual(raised.exception.status, expected)

    def test_parent_required_role_and_duplicate_cookie(self):
        self.assertEqual(self.authorize(''), '/image-playground/')
        cookie = self.fixture.admin['cookie']
        self.assertEqual(self.authorize(cookie + '; ' + cookie), '/image-playground/')
        member = self.fixture.register('regular')
        self.status(403, self.authorize, member['cookie'])

    def test_codes_and_child_tokens_are_hashed_and_single_use(self):
        grant = self.authorize(self.fixture.admin['cookie'])
        self.status(404, self.internal, 'exchange', grant, secrets.token_urlsafe(32))
        self.status(401, self.internal, 'exchange', {**grant, 'state': secrets.token_urlsafe(32)})
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM comfy_sso_codes').fetchone()
            self.assertEqual(row['hash'], digest(grant['code']))
            self.assertEqual(row['state'], digest(grant['state']))
        child = self.internal('exchange', grant)
        self.status(401, self.internal, 'exchange', grant)
        self.assertEqual(self.internal('check', {'token': child['token']})['user'],
                         self.fixture.admin['user']['id'])
        self.internal('logout', {'token': child['token']})
        self.status(401, self.internal, 'check', {'token': child['token']})
        self.assertIsNotNone(self.service.session({'cookie': self.fixture.admin['cookie']}))

    def test_role_ai_expiry_and_parent_revocation_are_current(self):
        parent = self.fixture.admin
        grant = self.authorize(parent['cookie'])
        child = {'token': self.internal('exchange', grant)['token']}
        with self.store.connect() as db:
            db.execute("UPDATE users SET role='member' WHERE id=?", (parent['user']['id'],))
        self.status(403, self.internal, 'check', child)
        with self.store.connect() as db:
            db.execute("UPDATE users SET role='admin' WHERE id=?", (parent['user']['id'],))
            db.execute("INSERT INTO ai_members(user_id,expires) VALUES(?,0)", (parent['user']['id'],))
        self.status(403, self.internal, 'check', child)
        with self.store.connect() as db:
            db.execute('DELETE FROM sessions WHERE user_id=?', (parent['user']['id'],))
        self.status(401, self.internal, 'check', child)

    def test_expired_codes_and_disabled_accounts(self):
        grant = self.authorize(self.fixture.admin['cookie'])
        with self.store.connect() as db:
            db.execute('UPDATE comfy_sso_codes SET expires=0')
        self.status(401, self.internal, 'exchange', grant)
        grant = self.authorize(self.fixture.admin['cookie'])
        child = {'token': self.internal('exchange', grant)['token']}
        with self.store.connect() as db:
            db.execute("INSERT INTO account_controls VALUES(?,'disabled')", (self.fixture.admin['user']['id'],))
        self.status(403, self.internal, 'check', child)
