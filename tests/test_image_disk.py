import contextlib
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import uuid

from cryptography.fernet import Fernet

from image_service import cli
from image_service.app import Service, API
from image_service.security import Problem
from image_service.storage import DiskStorage, create_storage
from image_service.store import Store
from tests.test_image_service import FakeProvider, PNG


class DiskStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.storage = DiskStorage(self.root / 'files')

    def tearDown(self):
        self.temp.cleanup()

    def test_atomic_private_files_survive_reinitializing_storage(self):
        key = self.storage.key('images/user/photo.png')
        self.storage.put(key, PNG, 'image/png')
        path = self.storage.directory / key
        self.assertEqual(self.storage.get(key), PNG)
        if os.name != 'nt':
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(self.storage.directory.stat().st_mode), 0o700)
        restarted = DiskStorage(self.storage.directory)
        self.assertEqual(restarted.get(key), PNG)
        self.assertEqual(list(restarted.iter_keys('image-playground/images/')), [key])

    def test_write_failure_preserves_old_file_and_cleans_temporary_content(self):
        key = self.storage.key('images/user/photo.png')
        self.storage.put(key, PNG, 'image/png')
        with patch('image_service.storage.os.replace', side_effect=OSError('disk error')):
            with self.assertRaises(Problem):
                self.storage.put(key, b'new data', 'application/octet-stream')
        self.assertEqual(self.storage.get(key), PNG)
        self.assertFalse(list(self.storage.directory.rglob('.pending-*')))

    def test_traversal_absolute_paths_rejected(self):
        invalid = ['/etc/passwd', '../outside', 'image-playground/../../outside', 'image-playground/a//b', 'image-playground/a\\b', 'image-playground/./b', 'other/picture.png']
        for key in invalid:
            with self.subTest(key=key), self.assertRaises(Problem):
                self.storage.put(key, PNG, 'image/png')
    @unittest.skipIf(os.name == 'nt', 'Creating Windows symlinks requires host privileges; Linux CI checks escape rejection.')
    def test_symlink_escape_rejected(self):
        outside = self.root / 'outside'
        outside.mkdir()
        link = self.storage.directory / 'image-playground'
        link.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(Problem):
            self.storage.put('image-playground/escape.png', PNG, 'image/png')
        self.assertFalse((outside / 'escape.png').exists())

    def test_low_disk_space_stops_new_writes_with_explicit_error(self):
        with patch('image_service.storage.shutil.disk_usage', return_value=type('Usage', (), {'free': 0})()):
            with self.assertRaises(Problem) as caught:
                self.storage.put(self.storage.key('system/check'), b'check', 'text/plain')
        self.assertEqual(caught.exception.status, 507)
        self.assertIn('空间不足', caught.exception.message)

    def test_delete_is_idempotent_and_rejects_paths_outside_storage(self):
        key = self.storage.key('images/user/photo.png')
        self.storage.put(key, PNG, 'image/png')
        self.storage.delete(key)
        self.storage.delete(key)
        self.assertFalse((self.storage.directory / key).exists())
        outside = self.root / 'outside.png'
        outside.write_bytes(PNG)
        for invalid in ('../outside.png', str(outside), 'image-playground/../../outside.png'):
            with self.assertRaises(Problem):
                self.storage.delete(invalid)
    @unittest.skipIf(os.name == 'nt', 'Creating Windows symlinks requires host privileges; Linux CI checks deletion safety.')
    def test_delete_symlink_escape_rejected(self):
        outside = self.root / 'outside.png'
        outside.write_bytes(PNG)
        (self.storage.directory / 'image-playground').mkdir()
        (self.storage.directory / 'image-playground/link').symlink_to(outside)
        with self.assertRaises(Problem):
            self.storage.delete('image-playground/link')
        self.assertEqual(outside.read_bytes(), PNG)

    def test_default_factory_uses_disk_without_oss_configuration_or_sdk(self):
        with patch.dict(os.environ, {'IMAGE_DATA_DIR': str(self.root / 'data'), 'IMAGE_STORAGE': 'local'}, clear=False), \
             patch.dict('sys.modules', {'oss2': None}):
            storage = create_storage()
            self.assertIsInstance(storage, DiskStorage)
            self.assertEqual(storage.directory, self.root / 'data' / 'files')
            storage.put(storage.key('system/check'), b'local only', 'text/plain')


class DiskServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.key = Fernet.generate_key()
        self.cipher = Fernet(self.key)
        self.root = Path(self.temp.name)
        self.store = Store(self.root / 'data', self.cipher)
        self.storage = DiskStorage(self.store.directory / 'files')
        self.provider = FakeProvider()
        self.app = Service(self.store, self.storage, self.provider, 'https://strgo.com', start_worker=False)
        invite = self.app.invite('operator', 'admin')['code']
        _, result, headers = self.app.dispatch('POST', API + '/register', {'username': 'diskowner', 'password': 'disk-private-password-2026', 'invite': invite}, {'Origin': 'https://strgo.com'})
        self.headers = {'Origin': 'https://strgo.com', 'Cookie': headers['Set-Cookie'].split(';')[0], 'X-CSRF-Token': result['csrf']}
        self.user_id = result['user']['id']
        self.app.dispatch('PUT', API + '/config', {'endpoint': 'https://images.example/v1/images/generations', 'model': 'disk-model', 'apiKey': 'private-model-key-test'}, self.headers)

    def tearDown(self):
        self.app.close()
        self.temp.cleanup()

    def create_job(self):
        return self.app.dispatch('POST', API + '/jobs', {'prompt': 'Test image on the ECS disk', 'size': '1024x1024', 'quality': '', 'count': 1, 'requestId': str(uuid.uuid4())}, self.headers)[1]

    def test_account_config_and_image_persist_across_service_restart(self):
        job = self.create_job()
        self.app.run_job(job['id'])
        result = self.app.dispatch('GET', API + '/jobs/' + job['id'], headers=self.headers)[1]
        self.assertEqual(result['status'], 'complete')
        image = result['images'][0]
        data = self.app.dispatch('GET', image['url'], headers=self.headers)[1]
        self.assertEqual(data, PNG)
        config_file = self.storage.directory / self.storage.key(f'system/configs/{self.user_id}.fernet')
        self.assertNotIn(b'private-model-key-test', config_file.read_bytes())
        self.assertEqual(json.loads(self.cipher.decrypt(config_file.read_bytes()))['apiKey'], 'private-model-key-test')
        self.app.close()
        self.app = Service(Store(self.store.directory, self.cipher), DiskStorage(self.storage.directory), self.provider, 'https://strgo.com', start_worker=False)
        session = self.app.dispatch('GET', API + '/session', headers=self.headers)[1]
        self.assertEqual(session['user']['id'], self.user_id)
        self.assertEqual(session['storage']['kind'], 'local')
        self.assertEqual(self.app.dispatch('GET', image['url'], headers=self.headers)[1], PNG)

    def test_deleted_disk_image_and_manifest_do_not_return_after_reindex(self):
        job = self.create_job()
        self.app.run_job(job['id'])
        image = self.app.dispatch('GET', API + '/jobs/' + job['id'], headers=self.headers)[1]['images'][0]
        with self.store.connect() as db:
            row = db.execute('SELECT object_key FROM images WHERE id=?', (image['id'],)).fetchone()
        path = self.storage.directory / row['object_key']
        manifest = Path(str(path) + '.metadata.fernet')
        self.assertTrue(path.exists())
        self.assertTrue(manifest.exists())
        self.assertEqual(self.app.dispatch('DELETE', API + '/images/' + image['id'], headers=self.headers)[0], 200)
        self.assertFalse(path.exists())
        self.assertFalse(manifest.exists())
        recovered = self.root / 'after-delete-db'
        with patch.dict(os.environ, {'IMAGE_STORAGE': 'local', 'IMAGE_DATA_DIR': str(recovered), 'IMAGE_FILES_DIR': str(self.storage.directory), 'IMAGE_ENCRYPTION_KEY': self.key.decode()}), \
             patch('sys.argv', ['cli', 'reindex']), contextlib.redirect_stdout(io.StringIO()):
            cli.main()
        with Store(recovered, self.cipher).connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM images').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0], 1)
        self.assertEqual(self.provider.calls, 1)

    def test_full_disk_prevents_billable_generation(self):
        job = self.create_job()
        with patch('image_service.storage.shutil.disk_usage', return_value=type('Usage', (), {'free': 0})()):
            self.app.run_job(job['id'])
        result = self.app.dispatch('GET', API + '/jobs/' + job['id'], headers=self.headers)[1]
        self.assertEqual(result['status'], 'failed')
        self.assertIn('空间不足', result['error'])
        self.assertEqual(self.provider.calls, 0)

    def test_disk_files_rebuild_accounts_config_and_images_after_db_loss(self):
        job = self.create_job()
        self.app.run_job(job['id'])
        recovered = self.root / 'recovered-db'
        with patch.dict(os.environ, {'IMAGE_STORAGE': 'local', 'IMAGE_DATA_DIR': str(recovered), 'IMAGE_FILES_DIR': str(self.storage.directory), 'IMAGE_ENCRYPTION_KEY': self.key.decode()}), \
             patch('sys.argv', ['cli', 'reindex']), contextlib.redirect_stdout(io.StringIO()):
            cli.main()
        store = Store(recovered, self.cipher)
        self.assertEqual(store.config(self.user_id)['apiKey'], 'private-model-key-test')
        with store.connect() as db:
            self.assertIsNotNone(db.execute('SELECT id FROM users WHERE id=?', (self.user_id,)).fetchone())
            self.assertEqual(db.execute('SELECT state FROM images WHERE job_id=?', (job['id'],)).fetchone()['state'], 'saved')
        self.assertEqual(self.provider.calls, 1)


if __name__ == '__main__':
    unittest.main()
