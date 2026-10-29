from pathlib import Path
import json
import re
import tempfile
import unittest
import xml.etree.ElementTree as ET

import build


class PanoramaBuildTests(unittest.TestCase):
    def test_panorama_routes_assets_chrome_and_sitemap_are_built_for_both_homes(self):
        for variant in ('classic', 'hub'):
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as temporary:
                output = build.build(output=Path(temporary), home_variant=variant)
                page = (output / '360/index.html').read_text()
                self.assertNotIn('{{', page)
                self.assertIn('data-strgo-ui="experience"', page)
                self.assertIn('https://strgo.com/360/', page)
                self.assertEqual(page.count('<strgo-navigation'), 1)
                self.assertEqual(page.count('site-navigation.js'), 1)
                self.assertNotIn('experience-navigation.js', page)
                self.assertNotIn(' style=', page)
                for asset in re.findall(r'(?:src|href)="(/(?:360|assets|shared|hub)/[^"?#]+)', page):
                    if asset.endswith('/'):
                        continue
                    self.assertTrue((output / asset.lstrip('/')).is_file(), asset)
                for name in ('app.js', 'core.js', 'renderer.js', 'style.css', 'items.js', 'store.js', 'generation.js'):
                    self.assertTrue((output / '360' / name).is_file())
                image = (output / 'assets/panoramas/campus.webp').read_bytes()
                self.assertEqual(image[:4], b'RIFF')
                self.assertLess(len(image), 700_000)
                for name in ('hub/registry.json', 'shared/registry.json'):
                    entries = json.loads((output / name).read_text())['entries']
                    self.assertEqual(next(e for e in entries if e['id'] == 'S09')['route'], '/360/')
                sitemap = ET.parse(output / 'sitemap.xml')
                self.assertIn('https://strgo.com/360/', [n.text for n in sitemap.iter()])
                self.assertIn('three.module.js', build.VENDORS)

if __name__ == '__main__':
    unittest.main()
