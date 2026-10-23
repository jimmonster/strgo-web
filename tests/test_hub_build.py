import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys

import build
from hub_build import load_registry


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
            build.build(output=output, home_variant='hub')
            self.assertIn('/hub/app.js', (output / 'index.html').read_text())
            self.assertIn('floating-navbar', (output / 'classic/index.html').read_text())
            self.assertEqual(json.loads((output / 'build-manifest.json').read_text())['homeVariant'], 'hub')
            build.build(output=output, home_variant='classic')
            self.assertEqual((output / 'index.html').read_text(), classic)

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
        self.assertIn('/shared/site-navigation.css', (build.ROOT / 'src/shared/site-navigation.js').read_text())
        self.assertIn('/hub/core.js', (build.ROOT / 'src/ai-workspace/app.js').read_text())

    def test_registry_and_design_documentation_are_in_sync(self):
        subprocess.run([sys.executable, str(build.ROOT / 'scripts/sync-hub-docs.py'), '--check'], check=True)


if __name__ == '__main__': unittest.main()
