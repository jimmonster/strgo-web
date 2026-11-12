"""Exercise rollback against an isolated fake host without touching system paths."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

DEPLOY = Path(__file__).resolve().parents[1] / 'comfyui/deploy'


@unittest.skipUnless(os.name == 'posix' and shutil.which('bash') and shutil.which('flock'), 'requires Bash and flock')
class ComfyDeployTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.snapshot = self.root / 'var/backups/strgo-comfyui/deploy.fixture'
        self.account = self.root / 'opt/strgo-image/image_service'
        self.service = self.root / 'opt/strgo-comfyui'
        self.nginx = self.root / 'etc/nginx'
        for path in (self.snapshot / 'account', self.account, self.service, self.nginx / 'sites-available',
                     self.nginx / 'sites-enabled', self.root / 'etc/systemd/system', self.root / 'run/lock',
                     self.root / 'run/systemd/system', self.root / 'bin'):
            path.mkdir(parents=True, exist_ok=True)
        (self.service / 'latest-backup').write_text(str(self.snapshot))
        (self.snapshot / 'activation').touch()
        (self.snapshot / 'complete').touch()
        self.name = 'comfyui.strgo.com.conf'
        self.available = self.nginx / 'sites-available' / self.name
        self.enabled = self.nginx / 'sites-enabled' / self.name
        self.available.write_text('# Managed by STRGO ComfyUI API-only\n')
        self.enabled.symlink_to(self.available)
        self.other = self.nginx / 'sites-available/workflow.conf'
        self.other.write_text('existing service')
        hashes = []
        for name in ('app.py', 'store.py', 'admin.py', 'comfy_auth.py'):
            (self.account / name).write_text('new')
            hashes.append(hashlib.sha256(b'new').hexdigest() + '  ' + name)
            if name != 'comfy_auth.py':
                (self.snapshot / 'account' / name).write_text('old')
        (self.snapshot / 'installed.sha256').write_text('\n'.join(hashes) + '\n')
        for command in ('nginx', 'systemctl'):
            script = self.root / 'bin' / command
            script.write_text('#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$TEST_COMFY_CALLS"\n')
            script.chmod(0o755)
        source = (DEPLOY / 'rollback.sh').read_text()
        source = source.replace('"$EUID" == 0 && ', '')
        for path in ('/opt/strgo-', '/etc/nginx/', '/etc/systemd/', '/run/', '/var/backups/'):
            source = source.replace(path, str(self.root) + path)
        self.script = self.root / 'rollback.sh'
        self.script.write_text(source)

    def rollback(self):
        return subprocess.run(['bash', self.script], capture_output=True, text=True,
                              env={**os.environ, 'PATH': str(self.root / 'bin') + os.pathsep + os.environ['PATH'],
                                   'TEST_COMFY_CALLS': str(self.root / 'calls')})

    def test_rollback_restores_only_managed_files_and_retains_data(self):
        database = self.root / 'persistent.sqlite3'
        database.write_text('existing account data')
        result = self.rollback()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.enabled.exists())
        self.assertFalse(self.available.exists())
        self.assertEqual(self.other.read_text(), 'existing service')
        self.assertEqual((self.account / 'app.py').read_text(), 'old')
        self.assertFalse((self.account / 'comfy_auth.py').exists())
        self.assertEqual(database.read_text(), 'existing account data')
        self.assertIn('restart strgo-image', (self.root / 'calls').read_text())

    def test_rollback_refuses_to_overwrite_an_external_account_update(self):
        (self.account / 'app.py').write_text('newer site release')
        result = self.rollback()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.enabled.is_symlink())
        self.assertEqual((self.account / 'app.py').read_text(), 'newer site release')
        self.assertFalse((self.root / 'calls').exists())
