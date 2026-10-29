from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest

from cryptography.fernet import Fernet

from image_service.app import Service
from image_service.presets import DEFAULT_PRESETS, DEFAULT_PANORAMA_PRESETS
from image_service.store import Store
from tests import test_image_service as fixtures
from tests.test_image_service import FakeProvider, FakeStorage, ORIGIN


class PresetServiceTests(unittest.TestCase):
    call = fixtures.ImageServiceTests.call
    register = fixtures.ImageServiceTests.register
    assert_problem = fixtures.ImageServiceTests.assert_problem

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cipher = Fernet(Fernet.generate_key())
        self.store = Store(Path(self.temp.name) / 'data', self.cipher)
        self.cloud, self.provider = FakeStorage(), FakeProvider()
        self.app = Service(self.store, self.cloud, self.provider, ORIGIN, start_worker=False)
        self.admin = self.register('presetowner', role='admin')

    def tearDown(self):
        self.app.close()
        self.temp.cleanup()

    def presets(self, session=None, query=''):
        return self.call('GET', '/preset-inspirations' + query, session=session or self.admin)[1]['presets']

    def create(self, **values):
        body = {'title': 'Portrait Glow', 'description': '自然光', 'prompt': 'Keep the identity, composition and natural light.', 'sortOrder': 0, **values}
        status, result, _ = self.call('POST', '/preset-inspirations', body, self.admin)
        self.assertEqual(status, 201)
        return result

    def restart(self, store=None):
        self.app.close()
        self.store = store or Store(self.store.directory, self.cipher)
        self.app = Service(self.store, self.cloud, self.provider, ORIGIN, start_worker=False)

    def test_defaults_are_seeded_once_and_readable_after_login(self):
        self.assert_problem(401, lambda: self.call('GET', '/preset-inspirations'))
        initial = self.presets()
        self.assertEqual(len(initial), 9)
        self.assertEqual([item['title'] for item in initial], [item['title'] for item in DEFAULT_PRESETS])
        self.assertEqual([item['prompt'] for item in initial], [item['prompt'] for item in DEFAULT_PRESETS])
        self.assertIn('保持同一人物的身份特征', initial[0]['prompt'])
        member = self.register('presetreader')
        self.assertEqual(self.presets(member), initial)
        self.assertEqual(self.call('GET', '/preset-inspirations/' + initial[0]['id'], session=member)[1], initial[0])
        self.restart()
        self.assertEqual(self.presets(), initial)

    def test_admin_crud_search_order_is_shared_with_members(self):
        created = self.create(title='  Portrait Glow  ', description='  自然光  ')
        self.assertEqual(created['title'], 'Portrait Glow')
        self.assertEqual(created['description'], '自然光')
        self.assertEqual(self.presets()[0]['id'], created['id'])
        self.assertEqual([item['id'] for item in self.presets(query='?search=gLoW')], [created['id']])
        self.assertEqual([item['id'] for item in self.presets(query='?search=composition')], [created['id']])
        status, updated, _ = self.call('PUT', '/preset-inspirations/' + created['id'], {**created, 'title': 'New title', 'prompt': 'Updated prompt', 'sortOrder': 100000}, self.admin)
        self.assertEqual(status, 200)
        self.assertGreater(updated['updated'], created['updated'])
        member = self.register('sharedreader')
        self.assertEqual(self.presets(member)[-1], updated)
        self.assertEqual(self.call('GET', '/preset-inspirations/' + created['id'], session=member)[1]['prompt'], 'Updated prompt')
        self.assertEqual(self.call('DELETE', '/preset-inspirations/' + created['id'], session=self.admin)[0], 200)
        self.assertEqual(len(self.presets(member)), 9)
        self.assert_problem(404, lambda: self.call('GET', '/preset-inspirations/' + created['id'], session=self.admin))
        self.assert_problem(404, lambda: self.call('DELETE', '/preset-inspirations/' + created['id'], session=self.admin))

    def test_member_and_unauthenticated_requests_cannot_mutate(self):
        preset = self.presets()[0]
        member = self.register('ordinaryreader')
        for method, path in [('POST', '/preset-inspirations'), ('PUT', '/preset-inspirations/' + preset['id']), ('DELETE', '/preset-inspirations/' + preset['id'])]:
            with self.subTest(method=method):
                self.assert_problem(401, lambda: self.call(method, path, preset))
                self.assert_problem(403, lambda: self.call(method, path, {**preset, 'role': 'admin'}, member))
                self.assert_problem(403, lambda: self.call(method, path, preset, self.admin, {'X-CSRF-Token': 'wrong'}))
                self.assert_problem(403, lambda: self.call(method, path, preset, self.admin, {'Origin': 'https://other.example'}))
        self.assertEqual(self.presets()[0], preset)

    def test_validation_and_stale_update_prevent_silent_overwrite(self):
        preset = self.create()
        invalid = [
            {'title': ''}, {'title': ' '}, {'title': 'a' * 81}, {'title': 123},
            {'description': 'a' * 201}, {'description': None},
            {'prompt': ''}, {'prompt': ' '}, {'prompt': 'a' * 8001}, {'prompt': []},
            {'sortOrder': -1}, {'sortOrder': 100001}, {'sortOrder': 1.5}, {'sortOrder': True},
        ]
        for values in invalid:
            with self.subTest(values=list(values)):
                self.assert_problem(400, lambda: self.call('POST', '/preset-inspirations', {**preset, **values}, self.admin))
        self.call('PUT', '/preset-inspirations/' + preset['id'], {**preset, 'prompt': 'Latest saved prompt'}, self.admin)
        self.assert_problem(409, lambda: self.call('PUT', '/preset-inspirations/' + preset['id'], {**preset, 'prompt': 'Stale overwrite'}, self.admin))
        self.assertEqual(self.call('GET', '/preset-inspirations/' + preset['id'], session=self.admin)[1]['prompt'], 'Latest saved prompt')
        self.assert_problem(404, lambda: self.call('PUT', '/preset-inspirations/' + '0' * 32, preset, self.admin))
        self.assert_problem(405, lambda: self.call('PUT', '/preset-inspirations', preset, self.admin))

    def test_modified_deleted_and_added_presets_survive_restart(self):
        initial = self.presets()
        self.call('PUT', '/preset-inspirations/' + initial[0]['id'], {**initial[0], 'prompt': 'Admin custom default prompt'}, self.admin)
        self.call('DELETE', '/preset-inspirations/' + initial[1]['id'], session=self.admin)
        self.create(title='Persistent extra')
        expected = self.presets()
        self.restart()
        self.assertEqual(self.presets(), expected)
        self.assertEqual(len(expected), 9)
        self.assertNotIn(initial[1]['id'], [item['id'] for item in expected])

    def test_deleting_all_presets_stays_empty_after_restart_and_backup_restore(self):
        for item in self.presets():
            self.call('DELETE', '/preset-inspirations/' + item['id'], session=self.admin)
        self.restart()
        self.assertEqual(self.presets(), [])
        restored = Path(self.temp.name) / 'restored'
        restored.mkdir()
        (restored / 'playground.sqlite3').write_bytes(self.cipher.decrypt(self.store.backup_bytes()))
        self.restart(Store(restored, self.cipher))
        self.assertEqual(self.presets(), [])
        self.create(title='First after cleanup')
        self.assertEqual(len(self.presets()), 1)

    def test_legacy_database_migrates_without_changing_personal_notes(self):
        personal = self.call('POST', '/inspirations', {'prompt': 'Private prompt', 'title': 'Private note', 'size': '1024x1024', 'quality': '', 'count': 1}, self.admin)[1]
        self.app.close()
        with self.store.connect() as db:
            db.execute('DROP TABLE preset_inspirations')
            db.execute("DELETE FROM meta WHERE key='preset_inspirations_initialized'")
        self.restart()
        self.assertEqual(len(self.presets()), 9)
        preset = self.presets()[0]
        self.call('PUT', '/preset-inspirations/' + preset['id'], {**preset, 'prompt': 'Updated shared prompt'}, self.admin)
        self.call('DELETE', '/preset-inspirations/' + preset['id'], session=self.admin)
        self.assertEqual(self.call('GET', '/inspirations', session=self.admin)[1]['inspirations'], [personal])

    def test_concurrent_initialization_does_not_duplicate_defaults(self):
        self.app.close()
        with self.store.connect() as db:
            db.execute('DROP TABLE preset_inspirations')
            db.execute("DELETE FROM meta WHERE key='preset_inspirations_initialized'")
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(Store, self.store.directory, self.cipher) for _ in range(2)]
            for future in futures:
                future.result(timeout=10)
        self.restart()
        self.assertEqual(len(self.presets()), 9)


class PanoramaPresetTests(unittest.TestCase):
    call = fixtures.ImageServiceTests.call
    register = fixtures.ImageServiceTests.register
    assert_problem = fixtures.ImageServiceTests.assert_problem
    setUp = PresetServiceTests.setUp
    tearDown = PresetServiceTests.tearDown
    restart = PresetServiceTests.restart

    def presets(self, session=None):
        return self.call('GET', '/panorama-presets', session=session or self.admin)[1]['presets']

    def test_panorama_templates_are_separate_and_members_read_admin_changes(self):
        initial = self.presets()
        self.assertEqual([p['prompt'] for p in initial], [p['prompt'] for p in DEFAULT_PANORAMA_PRESETS])
        self.assertIn('2:1', initial[0]['prompt'])
        self.assertIn('equirectangular', initial[0]['prompt'])
        general = self.call('GET', '/preset-inspirations', session=self.admin)[1]['presets']
        self.assertEqual(len(general), len(DEFAULT_PRESETS))
        item = initial[0]
        path = '/panorama-presets/' + item['id']
        updated = self.call('PUT', path, {**item, 'prompt': 'Admin custom panorama instruction'}, self.admin)[1]
        member = self.register('panoramareader')
        self.assertEqual(self.presets(member)[0], updated)
        self.assert_problem(409, lambda: self.call('PUT', path, item, self.admin))
        self.assert_problem(404, lambda: self.call('GET', '/preset-inspirations/' + item['id'], session=self.admin))
        self.assertEqual(self.call('GET', '/preset-inspirations', session=self.admin)[1]['presets'], general)

    def test_panorama_mutations_require_admin_origin_and_csrf(self):
        member = self.register('panoramamember')
        item = self.presets()[0]
        self.assert_problem(401, lambda: self.call('GET', '/panorama-presets'))
        for method, path in [('POST', '/panorama-presets'), ('PUT', '/panorama-presets/' + item['id']), ('DELETE', '/panorama-presets/' + item['id'])]:
            with self.subTest(method=method):
                self.assert_problem(401, lambda: self.call(method, path, item))
                self.assert_problem(403, lambda: self.call(method, path, item, member))
                self.assert_problem(403, lambda: self.call(method, path, item, self.admin, {'X-CSRF-Token': 'wrong'}))
                self.assert_problem(403, lambda: self.call(method, path, item, self.admin, {'Origin': 'https://other.example'}))
        self.assertEqual(self.presets()[0], item)

    def test_changes_and_empty_collection_survive_restart_and_backup(self):
        item = self.presets()[0]
        updated = self.call('PUT', '/panorama-presets/' + item['id'], {**item, 'title': 'Persistent panorama'}, self.admin)[1]
        self.restart()
        self.assertEqual(self.presets()[0], updated)
        self.call('DELETE', '/panorama-presets/' + item['id'], session=self.admin)
        self.restart()
        self.assertEqual(self.presets(), [])
        restored = Path(self.temp.name) / 'restored'
        restored.mkdir()
        (restored / 'playground.sqlite3').write_bytes(self.cipher.decrypt(self.store.backup_bytes()))
        self.restart(Store(restored, self.cipher))
        self.assertEqual(self.presets(), [])

    def test_existing_database_adds_panorama_templates_without_overwriting_general_presets(self):
        general = self.call('GET', '/preset-inspirations', session=self.admin)[1]['presets']
        first = general[0]
        changed = self.call('PUT', '/preset-inspirations/' + first['id'], {**first, 'prompt': 'Existing administrator edit'}, self.admin)[1]
        with self.store.connect() as db:
            db.execute('DROP TABLE panorama_presets')
            db.execute("DELETE FROM meta WHERE key='panorama_presets_initialized'")
        self.restart()
        self.assertEqual(self.call('GET', '/preset-inspirations', session=self.admin)[1]['presets'][0], changed)
        self.assertEqual(len(self.presets()), len(DEFAULT_PANORAMA_PRESETS))
        self.restart()
        self.assertEqual(len(self.presets()), len(DEFAULT_PANORAMA_PRESETS))


if __name__ == '__main__':
    unittest.main()
