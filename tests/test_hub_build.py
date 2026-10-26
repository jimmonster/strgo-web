import json
import shutil
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys

import build
from hub_build import load_registry, build_hub


class HubBuildTests(unittest.TestCase):
    def test_default_home_is_preserved_and_switching_is_reversible(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            build.build(output=output)
            classic = (output / 'index.html').read_text()
            self.assertIn('floating-navbar', classic)
            self.assertIn('/hub/', classic)
            for route in ['hub', 'classic', 'ai/tasks', 'ai/assets', 'home', 'dance', 'nexus', 'terminal']:
                self.assertTrue((output / route / 'index.html').is_file())
            self.assertNotIn('="./assets/', (output / 'classic/index.html').read_text())
            for route in ['hub', 'ai/tasks', 'ai/assets']:
                self.assertIn('/hub/app.js', (output / route / 'index.html').read_text())
            registry = json.loads((output / 'hub/registry.json').read_text())
            self.assertEqual(registry['classicRoute'], '/classic/')
            self.assertEqual(next(e for e in registry['entries'] if e['id'] == 'N02')['route'], '/classic/#projects')
            self.assertNotIn('PRIVATE', (output / 'hub/registry.js').read_text())
            self.assertEqual(json.loads((output / 'shared/registry.json').read_text()), registry)
            self.assertEqual('/admin/', next(e for e in registry['entries'] if e['id'] == 'A01')['route'])
            workflow = (output / 'local-studio/index.html').read_text()
            self.assertIn('./_strgo/design-system.css', workflow)
            self.assertIn('data-session="none"', workflow)
            workflow_catalog = json.loads((output / 'local-studio/_strgo/registry.json').read_text())
            self.assertTrue(all(e['route'].startswith('https://') for e in workflow_catalog['entries']))
            self.assertTrue((output / 'dreams/_strgo/fonts/space-grotesk-latin.woff2').is_file())
            build.build(output=output, home_variant='hub')
            self.assertIn('/hub/app.js', (output / 'index.html').read_text())
            self.assertIn('floating-navbar', (output / 'classic/index.html').read_text())
            self.assertEqual(json.loads((output / 'build-manifest.json').read_text())['homeVariant'], 'hub')
            build.build(output=output, home_variant='classic')
            self.assertEqual((output / 'index.html').read_text(), classic)

    def test_dream_sync_rebases_shared_assets_and_root_build_does_not_duplicate_chrome(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary)
            (repository / 'package.json').write_text('{"name":"strgo-optical-homepage"}')
            app = repository / 'apps/dreams'
            (app / 'scripts').mkdir(parents=True)
            (app / 'src').mkdir()
            (app / 'src/config.js').write_text("export const CONFIG = {contentMode:'painted'};")
            shutil.copy2(build.ROOT / 'apps/dreams/scripts/sync-strgo.mjs', app / 'scripts/sync-strgo.mjs')
            dist = app / 'dist'
            modules = ['src/app.js', 'src/renderer.js', 'src/world.js', 'src/water.js', 'src/pond.js',
                       'styles/main.css', 'assets/vendor/three.module.js', '_strgo/tokens.css',
                       '_strgo/design-system.css', '_strgo/experience-navigation.js']
            for name in modules:
                target = dist / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('/* isolated built fixture */')
            (dist / 'src/config.js').write_text("export const CONFIG = {chapterPath: 'dreams/'};")
            markup = '<!doctype html><html lang="zh-CN" data-strgo-ui="experience"><head><link rel="stylesheet" href="/_strgo/tokens.css"><link rel="stylesheet" href="/_strgo/design-system.css"></head><body><h1>Dream</h1><script type="module" src="/_strgo/experience-navigation.js"></script></body></html>'
            for name in ['index.html', '404.html', *[f'dreams/{n:02d}/index.html' for n in range(1, 9)]]:
                target = dist / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(markup)
            subprocess.run(['node', str(app / 'scripts/sync-strgo.mjs')], check=True, capture_output=True)
            output = repository / 'site'
            shutil.copytree(repository / 'src/dreams', output / 'dreams')
            for route in ['ai/tasks', 'ai/assets']:
                (output / route).mkdir(parents=True)
            config = json.loads((build.ROOT / 'site.json').read_text())
            context = {'origin': 'https://strgo.com', 'asset_version': 'fixture', 'icp_link': ''}
            build_hub(build.ROOT, output, config, context, lambda match: context[match[1]])
            for name in ['index.html', '404.html', *[f'{n:02d}/index.html' for n in range(1, 9)]]:
                page = (output / 'dreams' / name).read_text()
                self.assertNotIn('="/_strgo/', page)
                self.assertIn('="/dreams/_strgo/', page)
                self.assertEqual(1, page.count('data-strgo-ui='))
                self.assertEqual(1, page.count('design-system.css'))
                self.assertEqual(1, page.count('experience-navigation.js'))
            self.assertTrue((output / 'dreams/_strgo/design-system.css').is_file())

    def test_invalid_variant_and_registry_fail_closed(self):
        config = json.loads((build.ROOT / 'site.json').read_text())
        with self.assertRaises(ValueError): build.validate({**config, 'HOME_VARIANT': 'bad'})
        registry = json.loads((build.ROOT / 'content/app-registry.json').read_text())
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'registry.json'
            registry['entries'][0]['route'] = '//other.test/'
            path.write_text(json.dumps(registry))
            with self.assertRaises(ValueError): load_registry(path)

    def test_new_markup_and_switcher_respect_production_csp(self):
        for file in ['src/hub/index.html', 'src/hub/app.js', 'src/shared/site-navigation.js']:
            content = (build.ROOT / file).read_text()
            self.assertNotIn('<style>', content)
            self.assertNotIn(' style=', content)
        self.assertIn("new URL('site-navigation.css', assets)", (build.ROOT / 'src/shared/site-navigation.js').read_text())
        self.assertIn('/hub/core.js', (build.ROOT / 'src/ai-workspace/app.js').read_text())

    def test_registry_and_design_documentation_are_in_sync(self):
        subprocess.run([sys.executable, str(build.ROOT / 'scripts/sync-hub-docs.py'), '--check'], check=True)


if __name__ == '__main__': unittest.main()
