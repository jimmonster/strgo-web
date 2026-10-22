import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('enable_https', ROOT / 'scripts/enable-https.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

CONFIG = '''# Managed by strgo-homepage/deploy.sh
server {
    listen 80;
    server_name strgo.com www.strgo.com;
    location ^~ /.well-known/acme-challenge/ { default_type text/plain; try_files $uri =404; }
    root /var/www/strgo/current;
    add_header Content-Security-Policy "default-src 'none'; style-src 'self'" always;
    location / { try_files $uri $uri/ =404; }
}
'''


class HttpsUpgradeTests(unittest.TestCase):
    def test_existing_homepage_content_configuration_is_preserved(self):
        result = module.enable(CONFIG)
        self.assertEqual(module.webroot(CONFIG), '/var/www/strgo/current')
        self.assertIn('listen 443 ssl;', result)
        self.assertIn('ssl_certificate /etc/letsencrypt/live/strgo.com/fullchain.pem;', result)
        self.assertIn('ssl_certificate_key /etc/letsencrypt/live/strgo.com/privkey.pem;', result)
        self.assertIn("add_header Content-Security-Policy \"default-src 'none'; style-src 'self'\" always;", result)
        self.assertIn('location / { try_files $uri $uri/ =404; }', result)
        self.assertIn('return 301 https://strgo.com$request_uri;', result)

    def test_repeated_upgrade_is_idempotent(self):
        once = module.enable(CONFIG)
        self.assertEqual(module.enable(once), once)

    def test_unrelated_virtual_hosts_are_preserved(self):
        other = 'server {\n    listen 80;\n    server_name other.example;\n    return 200 "other";\n}\n'
        self.assertTrue(module.enable(CONFIG + other).endswith(other))

    def test_unmanaged_config_is_rejected(self):
        with self.assertRaisesRegex(ValueError, '管理标记'):
            module.enable(CONFIG.replace(module.MARKER, '# external config'))

    def test_redirect_only_site_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'location'):
            module.enable(CONFIG.replace('try_files $uri $uri/ =404;', 'return 301 https://elsewhere$request_uri;'))

    def test_ambiguous_http_and_invalid_roots_are_rejected(self):
        for text in [CONFIG.replace('listen 80;', 'listen 8080;'), CONFIG.replace('/var/www/strgo/current;', 'relative/root;'), CONFIG.replace('    root /var/www/strgo/current;', '    root /var/www/strgo/current;\n    root /var/www/other;')]:
            with self.assertRaises(ValueError):
                module.enable(text)

    def test_upgrade_supports_terminal_integration(self):
        result = module.nginx.integrate(module.enable(CONFIG))
        self.assertEqual(result.count(module.nginx.INCLUDE), 1)
        redirect, https = result.split('server {')[1:]
        self.assertNotIn(module.nginx.INCLUDE, redirect)
        self.assertIn(module.nginx.INCLUDE, https)


if __name__ == '__main__':
    unittest.main()
