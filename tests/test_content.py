import copy
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
import xml.etree.ElementTree as ET

from content_build import load_content

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('content_site_build', ROOT / 'build.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class ContentTests(unittest.TestCase):
    def setUp(self):
        self.content = json.loads((ROOT / 'content/site-content.json').read_text())

    def build_fixture(self, directory, content=None):
        source = Path(directory) / 'content.json'
        source.write_text(json.dumps(content or self.content))
        return builder.build(output=Path(directory) / 'dist', content_path=source)

    def test_stories_are_independent_and_use_consistent_public_content_and_local_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            output = self.build_fixture(directory)
            homepage = (output / 'classic/index.html').read_text()
            data = json.loads(re.search(r'<script type="application/json" id="site-config">(.*?)</script>', homepage, re.S)[1])
            locations = [item.text for item in ET.parse(output / 'sitemap.xml').findall('.//{*}loc')]
            for project in data['projects']:
                route = project['storyPath']
                self.assertIn(f'href="{route}"', homepage)
                page = (output / route.strip('/') / 'index.html').read_text()
                self.assertIn(project['name'], page)
                self.assertIn(project['description'], page)
                self.assertIn(f'href="{project["experience"]["href"]}"', page)
                self.assertIn('href="/"', page)
                self.assertIn('href="/#projects"', page)
                self.assertIn('https://strgo.com' + route, locations)
                self.assertNotIn('{{', page)
                for asset in re.findall(r'(?:src|href)="(/assets/[^"?]+)', page):
                    self.assertTrue((output / asset.lstrip('/')).is_file(), asset)
                share = re.search(r'property="og:image" content="https://strgo.com([^\"]+)"', page)[1]
                self.assertTrue((output / share.lstrip('/')).is_file(), share)
                self.assertNotIn('创作起点', page)
                self.assertNotIn('我的工作', page)
                self.assertNotIn('待补充', page)
            self.assertNotIn('坐标待配置', homepage)
            self.assertNotIn('github.com', homepage)
            self.assertIn('mailto:jim@strgo.com', homepage)
            self.assertIn('示例矩阵', homepage)
            self.assertIn('非实测数据', homepage)

    def test_empty_and_draft_updates_do_not_create_homepage_records(self):
        example = json.loads((ROOT / 'content/updates.example.json').read_text())
        self.content['updates'] = [example]
        with tempfile.TemporaryDirectory() as directory:
            output = self.build_fixture(directory)
            home = (output / 'classic/index.html').read_text()
            updates = (output / 'updates/index.html').read_text()
            self.assertNotIn('id="updates"', home)
            self.assertNotIn(example['title'], home + updates)
            self.assertIn('新的创作记录，会陆续放在这里。', updates)

    def test_published_updates_are_sorted_limited_and_can_have_no_link(self):
        # Fixture dates test ordering; these records never enter shipped content.
        self.content['updates'] = [
            {'id': f'fixture-{day}', 'date': f'2026-01-{day:02d}', 'type': '改进', 'title': f'Fixture {day}', 'description': f'Fixture description {day}', 'published': True}
            for day in (1, 4, 2, 3)
        ]
        self.content['updates'][1]['link'] = {'href': '/#spaces', 'label': '空间'}
        with tempfile.TemporaryDirectory() as directory:
            output = self.build_fixture(directory)
            home = (output / 'classic/index.html').read_text()
            updates = (output / 'updates/index.html').read_text()
            pattern = r'data-update-id="fixture-(\d)"'
            self.assertEqual(re.findall(pattern, home), ['4', '3', '2'])
            self.assertEqual(re.findall(pattern, updates), ['4', '3', '2', '1'])
            for day in (4, 3, 2):
                for page in (home, updates):
                    self.assertIn(f'datetime="2026-01-{day:02d}"', page)
                    self.assertIn(f'Fixture description {day}', page)
            self.assertIn('href="/#spaces"', updates)
            # Rebuilding after withdrawal must remove previously published data.
            for entry in self.content['updates']: entry['published'] = False
            output = self.build_fixture(directory)
            self.assertNotIn('Fixture', (output / 'updates/index.html').read_text())

    def test_unknown_story_material_is_private_and_optional_fields_hide(self):
        self.content['projects'][0]['chapters'] = [{'id': 'origin', 'body': 'PRIVATE UNCONFIRMED MATERIAL', 'confirmed': False}]
        self.content['projects'][0]['experience'] = None
        self.content['projects'][0]['secondaryExperience'] = None
        self.content['author']['now'] = {'text': 'PRIVATE CURRENT ACTIVITY', 'confirmed': False}
        with tempfile.TemporaryDirectory() as directory:
            output = self.build_fixture(directory)
            home = (output / 'classic/index.html').read_text()
            story = (output / 'projects/galactic-frontier/index.html').read_text()
            self.assertNotIn('PRIVATE', home + story)
            self.assertNotIn('id="experience-title"', story)

    def test_invalid_published_dates_and_unsafe_links_stop_the_build(self):
        fixtures = []
        for date in (None, '2026-02-30', '2099-01-01'):
            fixture = copy.deepcopy(self.content)
            fixture['updates'] = [{'id': 'invalid', 'date': date, 'type': '改进', 'title': 'Invalid', 'description': 'Invalid', 'published': True}]
            fixtures.append(fixture)
        fixture = copy.deepcopy(self.content)
        fixture['projects'][0]['experience']['href'] = 'javascript:alert(1)'
        fixtures.append(fixture)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'fixture.json'
            for fixture in fixtures:
                source.write_text(json.dumps(fixture))
                with self.assertRaises(ValueError): load_content(source)
