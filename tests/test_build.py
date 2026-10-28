import importlib.util
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('strgo_build', ROOT / 'build.py')
builder = importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)

class Markup(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.tags = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))

class BuildTests(unittest.TestCase):
    def test_site_admin_keeps_shared_login_static_assets_and_ai_admin(self):
        with tempfile.TemporaryDirectory() as directory:
            output = builder.build(output=directory)
            page = (output / 'admin/index.html').read_text(encoding='utf-8')
            self.assertIn('noindex,nofollow', page)
            self.assertIn('全站管理', page)
            for asset in ('app.js', 'boot.js', 'styles.css'):
                self.assertTrue((output / 'admin' / asset).is_file())
            self.assertTrue((output / 'admin/ai/index.html').is_file())
            self.assertFalse(list((output / 'admin').rglob('*.py')))

    def test_local_studio_is_independent_and_ships_reference_compression(self):
        with tempfile.TemporaryDirectory() as directory:
            output = builder.build(output=directory)
            page = (output / 'local-studio/index.html').read_text(encoding='utf-8')
            self.assertIn('https://workflow.strgo.com/', page)
            self.assertIn('noindex,nofollow', page)
            self.assertIn('AI 生图的管理员账号', page)
            self.assertNotIn('api-key', page)
            for filename in ('app.js', 'styles.css', 'reference-image.js'):
                self.assertTrue((output / 'local-studio' / filename).is_file())

    def test_forum_route_assets_and_shared_account_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            output = builder.build(output=directory)
            page = (output / 'forum/index.html').read_text(encoding='utf-8')
            self.assertNotIn('{{', page)
            self.assertIn('https://strgo.com/forum/', page)
            self.assertIn('noindex,nofollow', page)
            self.assertIn('viewport-fit=cover', page)
            self.assertGreaterEqual((output / 'classic/index.html').read_text(encoding='utf-8').count('href="/forum/"'), 3)
            for asset in ('styles.css', 'app.js'):
                self.assertTrue((output / 'forum' / asset).is_file())
            self.assertIn('href="/forum/"', (output / 'image-playground/index.html').read_text(encoding='utf-8'))

    def setUp(self): self.config = json.loads((ROOT / 'site.json').read_text())
    def test_generated_site_has_no_missing_local_assets_or_template_tokens(self):
        import re
        with tempfile.TemporaryDirectory() as directory:
            output = builder.build(output=directory)
            page = (output / 'index.html').read_text()
            self.assertNotIn('{{', page)
            self.assertIn('渝ICP备2026024419号-1', page)
            for asset in re.findall(r'(?:src|href)="(\./assets/[^"?]+)', page):
                self.assertTrue((output / asset).is_file(), asset)
            self.assertNotIn('import ', (output / 'assets/main.js').read_text())
            self.assertTrue((output / 'archive/index.html').is_file())
    def test_script_data_and_markup_are_escaped(self):
        self.config['about'] = '</script><script>alert(1)</script>'
        with tempfile.TemporaryDirectory() as directory:
            config_file = Path(directory) / 'site.json'; config_file.write_text(json.dumps(self.config))
            output = builder.build(config_path=config_file, output=Path(directory) / 'dist')
            page = (output / 'classic/index.html').read_text()
            self.assertNotIn('</script><script>alert', page)
            self.assertIn('\\u003c/script\\u003e', page)
    def test_invalid_contact_timezone_and_contribution_data_are_rejected(self):
        for key, value in [('email', 'a@b.com?subject=bad'), ('domain', '../foo'), ('github', 'https://evil.com/user'), ('timezone', 'No/Timezone'), ('contributions', [4] * 195)]:
            config = {**self.config, key: value}
            with self.assertRaises((ValueError, KeyError)): builder.validate(config)
    def test_production_build_cannot_publish_without_required_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            if not all((ROOT / 'src/assets/vendor' / name).exists() for name in builder.VENDORS):
                with self.assertRaisesRegex(ValueError, 'Production libraries missing'):
                    builder.build(output=directory, require_vendor=True)
    def test_new_routes_and_root_assets_are_present(self):
        import re
        with tempfile.TemporaryDirectory() as directory:
            output = builder.build(output=directory)
            for route in ('home', 'dance', 'terminal'):
                page = (output / route / 'index.html').read_text()
                self.assertNotIn('{{', page)
                for asset in re.findall(r'(?:src|href)="(/assets/[^"?]+)', page):
                    self.assertTrue((output / asset.lstrip('/')).is_file(), asset)
                self.assertIn('href="/"', page)
            home = (output / 'classic/index.html').read_text()
            for route in ('home', 'dance', 'terminal'): self.assertIn(f'href="/{route}"', home)

    def test_ai_workspace_routes_and_reusable_module_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            output = builder.build(output=directory)
            for route in ('ai', 'ai/music', 'ai/chat', 'ai/tasks', 'ai/assets', 'ai/settings', 'ai/login', 'admin/ai'):
                page = (output / route / 'index.html').read_text()
                self.assertIn('noindex,nofollow', page)
                for asset in re.findall(r'(?:src|href)="(/ai/static/[^"?]+)', page):
                    self.assertTrue((output / asset.lstrip('/')).is_file(), asset)
            integration = (output / 'image-playground/assistant-integration.js').read_text()
            for imported in re.findall(r"from '(/ai/static/[^']+)'|import '(/ai/static/[^']+)'", integration):
                self.assertTrue((output / (imported[0] or imported[1]).lstrip('/')).is_file())
            for asset in (output / 'ai/static').glob('*.svg'):
                ET.parse(asset)
            self.assertIn('href="/ai/"', (output / 'classic/index.html').read_text())
            self.assertFalse(list((output / 'ai').rglob('*.py')))
            self.assertFalse(list((output / 'ai').rglob('*.sqlite3')))

    def test_image_playground_route_keeps_private_frontend_and_invite_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            output = builder.build(output=directory)
            page = (output / 'image-playground/index.html').read_text()
            home = (output / 'classic/index.html').read_text()
            self.assertIn('https://strgo.com/image-playground/', page)
            self.assertIn('noindex,nofollow', page)
            self.assertEqual((home.count('href="/image-playground/"')), 3)
            for asset in ('app.js', 'icons.js', 'reference-image.js', 'styles.css'):
                self.assertTrue((output / 'image-playground' / asset).is_file())
            self.assertIn('邀请码注册', page)
            self.assertNotIn('api-key-from-server', page)

    def test_polyverse_route_is_exposed_in_desktop_mobile_and_space_navigation(self):
        with tempfile.TemporaryDirectory() as directory:
            output = builder.build(output=directory)
            home = (output / 'classic/index.html').read_text()
            self.assertGreaterEqual(home.count('href="/polyverse/"'), 3)
            self.assertIn('data-label="POLYVERSE"', home)
            self.assertIn('POLYVERSE / 多维几何宇宙', home)
            self.assertIn('class="space-portal portal-polyverse"', home)
            self.assertIn('href="/polyverse/"', home)
            self.assertIn('.portal-polyverse', (output / 'assets/globals.css').read_text())
    def test_origin_and_terminal_configuration(self):
        for key, value in [('BASE_ORIGIN', 'https://example.com/path'), ('BASE_ORIGIN', 'javascript:alert(1)'), ('BASE_ORIGIN', 'https://user:pass@example.com'), ('TERMINAL_TARGET_URL', '//example.com'), ('TERMINAL_TARGET_URL', 'file:///etc/passwd'), ('TERMINAL_TARGET_URL', '/foo\\bar')]:
            with self.assertRaises(ValueError, msg=(key, value)): builder.validate({**self.config, key: value})
        builder.validate({**self.config, 'BASE_ORIGIN': 'https://example.com', 'TERMINAL_TARGET_URL': '/existing-app/'})

    def test_nexus_route_has_complete_resources_and_site_navigation(self):
        with tempfile.TemporaryDirectory() as directory:
            output = builder.build(output=directory, require_vendor=True)
            nexus = output / 'nexus'
            page = (nexus / 'index.html').read_text()
            tags = Markup(page).tags
            for tag, attrs in tags:
                self.assertNotIn('style', attrs, 'NEXUS must work with the existing style-src self policy')
                if tag == 'script':
                    self.assertTrue(attrs.get('src'), 'Scripts must stay external for the existing CSP')
                for name in ('src', 'href'):
                    reference = attrs.get(name, '')
                    if reference.startswith('./'):
                        target = (nexus / urlparse(reference).path).resolve()
                        self.assertTrue(target.is_relative_to(nexus.resolve()), reference)
                        self.assertTrue(target.is_file(), reference)
            for module in (nexus / 'src').glob('*.js'):
                for reference in re.findall(r'^import\s+.*?\s+from\s+[\'"]([^\'"]+)[\'"]', module.read_text(), re.M):
                    self.assertTrue(reference.startswith('.'), reference)
                    target = (module.parent / reference).resolve()
                    self.assertTrue(target.is_relative_to(nexus.resolve()), reference)
                    self.assertTrue(target.is_file(), f'{module.name}: {reference}')
            for stylesheet in (nexus / 'styles').glob('*.css'):
                for reference in re.findall(r'url\(\s*[\'"]?([^\'"\s)]+)', stylesheet.read_text()):
                    if reference.startswith(('data:', '#')):
                        continue
                    self.assertFalse(urlparse(reference).scheme, reference)
                    self.assertTrue((stylesheet.parent / urlparse(reference).path).is_file(), reference)
            self.assertIn(('a', {'class': 'site-return', 'href': '/'}), tags)
            canonical = [attrs['href'] for tag, attrs in tags if tag == 'link' and attrs.get('rel') == 'canonical']
            origin = self.config['BASE_ORIGIN'].rstrip('/')
            self.assertEqual(canonical, [origin + '/nexus/'])
            locations = ET.parse(output / 'sitemap.xml').findall('.//{*}loc')
            self.assertIn(origin + '/nexus/', [item.text for item in locations])
            home = Markup((output / 'classic/index.html').read_text()).tags
            self.assertGreaterEqual(sum(tag == 'a' and attrs.get('href') == '/nexus/' for tag, attrs in home), 3)
            for route in ('home', 'dance', 'terminal'):
                self.assertIn('href="/nexus/"', (output / route / 'index.html').read_text())

    @unittest.skipUnless(shutil.which('bash'), 'Nginx config generation requires Bash; Linux CI runs this check.')
    def test_deployed_nginx_redirect_preserves_nexus_query_and_strict_csp(self):
        script = (ROOT / 'deploy.sh').read_text()
        function = re.search(r'^render_content_config\(\) \{.*?^\}', script, re.M | re.S).group()
        command = "SITE_ROOT=/var/www/strgo\nTERMINAL_REUSE_PROXY=0\n" + function + '\nrender_content_config\n'
        result = subprocess.run(['bash', '-e'], input=command, capture_output=True, text=True, check=True)
        self.assertIn('location = /nexus { return 308 /nexus/$is_args$args; }', result.stdout)
        self.assertIn('location = /image-playground { return 308 /image-playground/$is_args$args; }', result.stdout)
        self.assertEqual(result.stdout.count('location = /image-playground {'), 1)
        if Path('/etc/nginx/snippets/strgo-image.conf').is_file():
            self.assertIn('include /etc/nginx/snippets/strgo-image.conf;', result.stdout)
        else:
            self.assertIn("location ^~ /api/image/ { default_type application/json; return 503", result.stdout)
        self.assertIn('location / { try_files $uri $uri/ =404; }', result.stdout)
        self.assertIn("style-src 'self'; script-src 'self';", result.stdout)
        self.assertNotIn('unsafe-inline', result.stdout)
        self.assertIn('for route in home dance nexus; do', script)

    def test_image_api_proxy_is_preserved_when_configured(self):
        source = (ROOT / 'image_service/deploy/strgo-image.conf').read_text()
        self.assertIn('proxy_pass http://127.0.0.1:8092;', source)
        self.assertIn('client_max_body_size 7m;', source)
        self.assertIn('proxy_cache off;', source)
        self.assertNotIn('aliyuncs.com', source)

    def test_subsequent_main_site_deployments_preserve_independent_meow_route(self):
        script = (ROOT / 'deploy.sh').read_text()
        self.assertIn('if [[ -f /etc/nginx/snippets/meow.conf ]]; then', script)
        self.assertIn("printf '%s\\n' '    include /etc/nginx/snippets/meow.conf;'", script)
        self.assertIn('$(readlink -f -- /var/www/meow/current)/meow/index.html', script)
        self.assertIn('verify_site "$MEOW_EXPECTED"', script)

    def test_dream_subdirectory_has_nine_direct_entries_and_local_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            output = builder.build(output=directory, require_vendor=True)
            root = (output / 'dreams').resolve()
            pages = [root / 'index.html', *[root / f'{number:02d}/index.html' for number in range(1, 9)]]
            locations = [item.text for item in ET.parse(output / 'sitemap.xml').findall('.//{*}loc')]
            for number, page in enumerate(pages):
                markup = Markup(page.read_text()).tags
                canonical = [a['href'] for tag, a in markup if tag == 'link' and a.get('rel') == 'canonical']
                route = '/dreams/' + page.relative_to(root).as_posix().removesuffix('index.html')
                self.assertEqual(canonical, [self.config['BASE_ORIGIN'].rstrip('/') + route])
                self.assertIn(canonical[0], locations)
                if number:
                    self.assertIn(('body', {'data-page': 'dream', 'data-dream': f'{number:02d}'}), markup)
                for tag, attrs in markup:
                    self.assertNotIn('style', attrs, page)
                    if tag == 'script': self.assertTrue(attrs.get('src'), page)
                    for key in ('href', 'src', 'srcset'):
                        ref = attrs.get(key, '')
                        if not ref or ref.startswith(('#', 'https:', 'data:')): continue
                        path = urlparse(ref).path
                        target = (output / path.lstrip('/')).resolve() if path.startswith('/') else (page.parent / path).resolve()
                        self.assertTrue(target.is_relative_to(root), ref)
                        self.assertTrue(target.exists(), ref)
            for module in (root / 'src').glob('*.js'):
                for ref in re.findall(r'^import\s+.*?\s+from\s+[\'"]([^\'"]+)[\'"]', module.read_text(), re.M):
                    target = (module.parent / ref).resolve()
                    self.assertTrue(target.is_relative_to(root), ref)
                    self.assertTrue(target.is_file(), ref)
            home = (output / 'classic/index.html').read_text()
            self.assertIn('href="/dreams/"', home)
            self.assertIn('href="/dreams/"', (root / '404.html').read_text())
            dream_home = Markup((root / 'index.html').read_text()).tags
            chapter_links = [attrs['href'] for tag, attrs in dream_home if tag == 'a' and 'data-dream-link' in attrs]
            self.assertEqual(chapter_links, [f'./{number:02d}/' for number in range(1, 9)])
            self.assertIn("chapterPath: ''", (root / 'src/config.js').read_text())
            self.assertFalse((root / 'dreams').exists(), 'Published chapters must avoid /dreams/dreams/ nesting')
            self.assertFalse((output / 'dream').exists(), 'The latest requested public route is /dreams/')
    @unittest.skipUnless(shutil.which('bash'), 'DREAMS Nginx config generation requires Bash; Linux CI runs this check.')
    def test_dream_nginx_route_keeps_query_error_page_and_csp(self):
        script = (ROOT / 'deploy.sh').read_text()
        function = re.search(r'^render_content_config\(\) \{.*?^\}', script, re.M | re.S).group()
        result = subprocess.run(['bash', '-e'], input='SITE_ROOT=/var/www/strgo\nTERMINAL_REUSE_PROXY=0\n' + function + '\nrender_content_config\n', capture_output=True, text=True, check=True)
        self.assertIn('location = /dreams { return 308 /dreams/$is_args$args; }', result.stdout)
        self.assertIn('error_page 404 /dreams/404.html;', result.stdout)
        self.assertNotIn('unsafe-inline', result.stdout)

if __name__ == '__main__': unittest.main()
