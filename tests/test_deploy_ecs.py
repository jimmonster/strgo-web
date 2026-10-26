import hashlib
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest

from scripts.deploy_ecs import DeploymentError, ensure_idle, read_env, terminal_manifest, validate_configuration


class ECSDeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='strgo-ecs-tests-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def configuration(self, **overrides):
        (self.root / 'site.json').write_text('{"BASE_ORIGIN":"https://strgo.com"}')
        values = dict(IMAGE_STORAGE='local', IMAGE_PUBLIC_ORIGIN='https://strgo.com',
                      IMAGE_ENCRYPTION_KEY='test-only', IMAGE_DATA_DIR=str(self.root / 'private'))
        values.update(overrides)
        path = self.root / 'account.env'
        path.write_text('\n'.join(key + '=' + value for key, value in values.items()) + '\n')
        return path

    def database(self):
        path = self.root / 'playground.sqlite3'
        with sqlite3.connect(path) as db:
            db.execute('CREATE TABLE jobs(status TEXT)')
            db.execute('CREATE TABLE local_jobs(status TEXT)')
            db.execute('CREATE TABLE ai_tasks(state TEXT)')
        return path

    def test_environment_parser_preserves_secret_literals_without_execution(self):
        path = self.root / 'account.env'
        marker = self.root / 'executed'
        literal = '$(touch ' + str(marker) + ')`whoami`$HOME'
        path.write_text('# comment\nKEY="' + literal + '"\n')
        self.assertEqual(read_env(path), {'KEY': literal})
        self.assertFalse(marker.exists())

    def test_configuration_accepts_local_data_and_rejects_oss_or_origin_mismatch(self):
        self.assertEqual(validate_configuration(self.root, self.configuration()), self.root / 'private')
        for overrides in ({'IMAGE_STORAGE': 'oss'}, {'IMAGE_PUBLIC_ORIGIN': 'http://strgo.com'},
                          {'IMAGE_ENCRYPTION_KEY': ''}):
            with self.subTest(overrides=overrides), self.assertRaises(DeploymentError):
                validate_configuration(self.root, self.configuration(**overrides))

    def test_pending_jobs_in_any_queue_block_deployment_without_writes(self):
        path = self.database()
        for table, column, status in [('jobs', 'status', 'uploading'),
                                      ('local_jobs', 'status', 'running'),
                                      ('ai_tasks', 'state', 'RECONCILING')]:
            with self.subTest(table=table):
                with sqlite3.connect(path) as db:
                    db.execute(f'INSERT INTO {table}({column}) VALUES(?)', (status,))
                before = path.read_bytes()
                with self.assertRaisesRegex(DeploymentError, table):
                    ensure_idle(path)
                self.assertEqual(path.read_bytes(), before)
                with sqlite3.connect(path) as db:
                    db.execute(f'DELETE FROM {table}')

    def test_completed_jobs_and_old_schema_are_allowed_without_migration(self):
        path = self.database()
        with sqlite3.connect(path) as db:
            db.execute("INSERT INTO jobs VALUES('complete')")
            db.execute("INSERT INTO local_jobs VALUES('succeeded')")
            db.execute("INSERT INTO ai_tasks VALUES('SUCCEEDED')")
        before = path.read_bytes()
        ensure_idle(path)
        self.assertEqual(path.read_bytes(), before)
        with sqlite3.connect(path) as db:
            db.execute('DROP TABLE local_jobs')
            db.execute('DROP TABLE ai_tasks')
        before = path.read_bytes()
        ensure_idle(path)
        self.assertEqual(path.read_bytes(), before)

    def test_missing_database_is_not_created(self):
        path = self.root / 'missing.sqlite3'
        with self.assertRaises(DeploymentError):
            ensure_idle(path)
        self.assertFalse(path.exists())

    @unittest.skipUnless(shutil.which('sha256sum'), 'requires Linux sha256sum')
    def test_terminal_manifest_matches_publisher_and_rejects_tampering(self):
        terminal = self.root / 'apps/terminal'
        files = ['.build/strgo-terminal', 'Cargo.toml', 'Cargo.lock', 'build.rs', 'src/main.rs',
                 'web/index.html', 'web/app.js', 'web/style.css', 'web/vendor/xterm.js',
                 'web/vendor/xterm.css', '../../image_service/app.py', 'tests/ui.test.mjs',
                 'tests/smoke.py', 'deploy/web.service', 'deploy/web.conf',
                 'update-account.sh', 'update-mobile.sh', 'repair-sandbox.sh']
        for name in files:
            path = terminal / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'test file\n')
        terminal_manifest(terminal)
        manifest = terminal / '.build/account-release/SHA256SUMS'
        self.assertIn(hashlib.sha256(b'test file\n').hexdigest(), manifest.read_text())
        result = subprocess.run(['sha256sum', '--check', '--status', str(manifest)], cwd=terminal)
        self.assertEqual(result.returncode, 0)
        (terminal / 'web/style.css').write_text('changed after build')
        result = subprocess.run(['sha256sum', '--check', '--status', str(manifest)], cwd=terminal)
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
