"""Keep shared login cookies when the response also deletes the legacy cookie."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlsplit

spec = importlib.util.spec_from_file_location('terminal_smoke', Path(__file__).with_name('smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class AccountSmokeTests(unittest.TestCase):
    def test_login_retains_shared_cookie_in_multi_cookie_response(self):
        response = Mock(status=200)
        shared = 'strgo_account_session=test-token; Path=/; HttpOnly; Secure; SameSite=Strict'
        response.getheaders.return_value = [
            ('Set-Cookie', shared),
            ('Set-Cookie', 'strgo_image_session=; Path=/api/image/; Max-Age=0'),
        ]
        response.read.return_value = b'{"csrf":"test-csrf"}'
        connection = Mock()
        connection.getresponse.return_value = response
        with patch.object(smoke.http.client, 'HTTPConnection', return_value=connection):
            status, headers, body = smoke.account_request(urlsplit('http://127.0.0.1:8092'), 'POST', '/login', 'https://strgo.com', {'username': 'test', 'password': 'fixture'})
        self.assertEqual(status, 200)
        self.assertEqual(headers['set-cookie'], shared)
        self.assertEqual(body['csrf'], 'test-csrf')
        self.assertEqual(connection.request.call_args.args[1], '/api/image/login')
        self.assertEqual(connection.request.call_args.args[3]['Origin'], 'https://strgo.com')
        connection.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
