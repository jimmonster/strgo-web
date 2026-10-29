import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('setup_local_ssh', Path(__file__).resolve().parents[1] / 'scripts/setup-local-ssh.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
PUBLIC_KEY = 'ssh-ed25519 AAAATESTPUBLICKEY'
PRIVATE_KEY = b'private-key-must-not-be-printed'


class LocalSshTests(unittest.TestCase):
    def test_existing_authorizations_and_restrictions_are_preserved(self):
        previous = 'restrict,from="10.0.0.1" ' + PUBLIC_KEY + ' existing\n'
        self.assertEqual(module.authorize(previous, PUBLIC_KEY), previous)
        previous = '# keep this comment\nssh-ed25519 AAAAOTHERKEY old'
        result = module.authorize(previous, PUBLIC_KEY)
        self.assertTrue(result.startswith(previous + '\n'))
        self.assertEqual(module.authorize(result, PUBLIC_KEY), result)

    def test_duplicate_config_and_invalid_keys_fail_closed(self):
        with self.assertRaises(ValueError):
            module.setting('KEY=one\nKEY=two\n', 'KEY')
        with self.assertRaises(ValueError):
            module.authorize('', 'not-a-key')

    @contextlib.contextmanager
    def installation(self, failure=None):
        with tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
            root = Path(directory)
            home = root / 'home'; home.mkdir()
            config = root / 'broker.env'; config.write_text('TERMINAL_ALLOW_PRIVATE=0\nTERMINAL_BLOCKED_IPS=47.108.255.179\n')
            host_keys = root / 'host-keys'; host_keys.mkdir()
            (host_keys / 'ssh_host_ed25519_key.pub').write_text(PUBLIC_KEY + ' local-host\n')
            identity = root / 'identity'
            commands = []
            failed_restart = False

            def command(args, **kwargs):
                nonlocal failed_restart
                commands.append(args)
                if args[:2] == ['ssh-keygen', '-q']:
                    Path(args[-1]).write_bytes(PRIVATE_KEY)
                if args[0] == 'ssh':
                    self.assertIn('BatchMode=yes', args)
                    self.assertIn('StrictHostKeyChecking=yes', args)
                    self.assertIn('PreferredAuthentications=publickey', args)
                    pinned = next(arg.split('=', 1)[1] for arg in args if arg.startswith('UserKnownHostsFile='))
                    self.assertEqual(Path(pinned).read_text(), '47.108.255.179 ' + PUBLIC_KEY + '\n')
                    if failure == 'auth':
                        raise subprocess.CalledProcessError(255, args)
                if args[:2] == ['systemctl', 'restart'] and failure == 'restart' and not failed_restart:
                    failed_restart = True
                    raise subprocess.CalledProcessError(1, args)
                return SimpleNamespace(returncode=0)

            for name, value in [('CONFIG', config), ('IDENTITY', identity), ('LOCK', root / 'lock'), ('HOST_KEY_DIR', host_keys)]:
                stack.enter_context(patch.object(module, name, value))
            stack.enter_context(patch.object(module, 'require_root'))
            stack.enter_context(patch.object(module.shutil, 'which', return_value='test-command'))
            stack.enter_context(patch.object(module.subprocess, 'run', side_effect=command))
            stack.enter_context(patch.object(module.subprocess, 'check_output', return_value=PUBLIC_KEY))
            stack.enter_context(patch.dict(sys.modules, {
                'pwd': SimpleNamespace(getpwnam=lambda name: SimpleNamespace(pw_dir=str(home), pw_uid=0, pw_gid=0)),
                'fcntl': SimpleNamespace(flock=lambda *args: None, LOCK_EX=1, LOCK_NB=2),
            }))
            # System services, network and ownership are simulated; exercise real file transactions.
            ownership = stack.enter_context(patch.object(module.os, 'fchown', create=True))
            stack.enter_context(patch.object(module.os, 'chown', create=True))
            if os.name != 'posix':
                stack.enter_context(patch.object(module.os, 'fchmod', create=True))
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            def run(check=False):
                with patch.object(sys, 'argv', ['setup-local-ssh.py', '--host', '47.108.255.179', *(['--check'] if check else [])]):
                    module.main()
            yield SimpleNamespace(config=config, identity=identity, authorized=home / '.ssh/authorized_keys', run=run, commands=commands, output=output, ownership=ownership)

    def test_setup_reuses_the_key_and_never_discloses_private_material(self):
        with self.installation() as app:
            app.run(); app.run()
            self.assertEqual(app.identity.read_bytes(), PRIVATE_KEY)
            self.assertEqual(app.authorized.read_text().count('AAAATESTPUBLICKEY'), 1)
            self.assertEqual(sum(args[:2] == ['ssh-keygen', '-q'] for args in app.commands), 1)
            self.assertIn('TERMINAL_ALLOW_PRIVATE=0\n', app.config.read_text())
            self.assertIn('TERMINAL_ALLOWED_TARGETS=47.108.255.179:22\n', app.config.read_text())
            self.assertNotIn(PRIVATE_KEY.decode(), app.output.getvalue())
            self.assertTrue(any(call.args[1:] == (10001, 10001) for call in app.ownership.call_args_list))
            if os.name == 'posix':
                self.assertEqual(app.identity.stat().st_mode & 0o777, 0o400)
                self.assertEqual(app.config.stat().st_mode & 0o777, 0o600)

    def test_failed_key_login_restores_config_and_removes_new_authorization(self):
        with self.installation(failure='auth') as app:
            before = app.config.read_bytes()
            with self.assertRaises(subprocess.CalledProcessError):
                app.run()
            self.assertEqual(app.config.read_bytes(), before)
            self.assertFalse(app.identity.exists())
            self.assertFalse(app.authorized.exists())
            self.assertFalse(app.authorized.parent.exists())

    def test_failed_service_restart_restores_preexisting_key_and_authorizations(self):
        with self.installation(failure='restart') as app:
            app.identity.write_bytes(PRIVATE_KEY)
            app.authorized.parent.mkdir(); app.authorized.write_text('ssh-ed25519 AAAAOTHERKEY previous\n')
            before = {path: path.read_bytes() for path in [app.identity, app.authorized, app.config]}
            with self.assertRaises(subprocess.CalledProcessError):
                app.run()
            for path, contents in before.items():
                self.assertEqual(path.read_bytes(), contents)
            self.assertEqual(sum(args[:2] == ['systemctl', 'restart'] for args in app.commands), 2)

    def test_check_does_not_create_keys_or_modify_files_or_restart_services(self):
        with self.installation() as app:
            before = app.config.read_bytes()
            app.run(check=True)
            self.assertEqual(app.config.read_bytes(), before)
            self.assertFalse(app.identity.exists())
            self.assertFalse(app.authorized.exists())
            self.assertFalse(any(args[0] in ['ssh', 'ssh-keygen'] or args[:2] == ['systemctl', 'restart'] for args in app.commands))


if __name__ == '__main__':
    unittest.main()
