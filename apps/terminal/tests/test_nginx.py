import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('integrate_nginx', ROOT / 'scripts/integrate-nginx.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

CONFIG = '''# existing homepage
server {
    listen 80;
    server_name strgo.com www.strgo.com;
    location / { return 301 https://strgo.com$request_uri; }
}
server {
    listen 443 ssl;
    server_name strgo.com;
    add_header Content-Security-Policy "default-src 'none'; style-src 'self'" always;
    root /var/www/strgo/current;
    location / { try_files $uri $uri/ =404; }
}
server {
    listen 443 ssl;
    server_name other.example;
    location / { return 200 'literal } { braces'; }
}
'''


class NginxIntegrationTests(unittest.TestCase):
    def test_only_terminal_https_host_receives_include(self):
        result = module.integrate(CONFIG)
        self.assertEqual(result.count(module.INCLUDE), 1)
        self.assertIn('    root /var/www/strgo/current;', result)
        self.assertIn("return 200 'literal } { braces'", result)
        blocks = result.split('server {')
        self.assertNotIn(module.INCLUDE, blocks[1])
        self.assertIn(module.INCLUDE, blocks[2])
        self.assertNotIn(module.INCLUDE, blocks[3])

    def test_repeated_install_is_idempotent(self):
        once = module.integrate(CONFIG)
        self.assertEqual(once, module.integrate(once))

    def test_http_only_site_is_not_silently_exposed(self):
        with self.assertRaisesRegex(ValueError, 'HTTPS'):
            module.integrate('server {\n listen 80;\n server_name strgo.com;\n}\n')

    def test_existing_terminal_route_is_preserved(self):
        for prefix in ['', '^~ ', '= ']:
            text = CONFIG.replace('    root /var/www/strgo/current;', f'    location {prefix}/terminal/ {{ return 404; }}')
            with self.assertRaisesRegex(ValueError, '已有 /terminal'):
                module.integrate(text)

    def test_ipv6_https_listener_is_supported(self):
        text = CONFIG.replace('listen 443 ssl;', 'listen [::]:443 ssl;')
        self.assertEqual(module.integrate(text).count(module.INCLUDE), 1)


if __name__ == '__main__': unittest.main()

