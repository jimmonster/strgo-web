import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(shutil.which('bash') and shutil.which('readlink') and os.name == 'posix', 'requires Linux shell tools')
class ECSCommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='strgo-command-tests-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.scripts = self.root / 'project/scripts'
        self.bin = self.root / 'bin'
        self.scripts.mkdir(parents=True)
        self.bin.mkdir()
        source = Path(__file__).resolve().parents[1] / 'scripts'
        for name in ('strgo', 'install-ecs-command.sh'):
            shutil.copy2(source / name, self.scripts / name)
        (self.scripts / 'strgo').chmod(0o755)
        (self.scripts / 'deploy_ecs.py').write_text('# fixture only\n')
        self.log = self.root / 'calls'
        self.env = dict(os.environ, STRGO_BIN_DIR=str(self.bin), ECS_TEST_LOG=str(self.log),
                        PATH=str(self.bin) + os.pathsep + os.environ['PATH'])
        self.put('git', '''#!/bin/sh
printf 'git %s\\n' "$*" >> "$ECS_TEST_LOG"
case "$1" in
branch) printf 'main\\n';;
status) printf '%s' "${ECS_TEST_DIRTY:-}";;
pull) exit "${ECS_TEST_PULL_EXIT:-0}";;
rev-parse) if [ "$2" = HEAD ] && [ -n "${ECS_TEST_LOCAL_COMMIT:-}" ]; then printf 'local-only-sha\\n'; else printf 'same-sha\\n'; fi;;
esac
''')
        self.put('python3', '#!/bin/sh\nprintf "python3 %s\\n" "$*" >> "$ECS_TEST_LOG"\n')

    def put(self, name, text):
        path = self.bin / name
        path.write_text(text)
        path.chmod(0o755)

    def install(self):
        return subprocess.run(['bash', str(self.scripts / 'install-ecs-command.sh')], env=self.env, capture_output=True, text=True)

    def command(self, *args):
        return subprocess.run([str(self.bin / 'strgo'), *args], cwd=self.root, env=self.env, capture_output=True, text=True)

    def test_installer_is_idempotent_and_preserves_an_existing_unrelated_command(self):
        path = self.bin / 'strgo'
        path.write_text('unrelated existing command')
        self.assertNotEqual(self.install().returncode, 0)
        self.assertEqual(path.read_text(), 'unrelated existing command')
        path.unlink()
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(path.resolve(), self.scripts / 'strgo')

    def test_deploy_pulls_main_before_running_the_updated_program(self):
        self.assertEqual(self.install().returncode, 0)
        result = self.command('deploy', '--skip-terminal')
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.log.read_text().splitlines()
        self.assertIn('git pull --ff-only origin main', calls)
        self.assertEqual(calls[-1], f'python3 {self.scripts}/deploy_ecs.py --skip-terminal')

    def test_local_changes_or_failed_pull_cannot_start_deployment(self):
        self.assertEqual(self.install().returncode, 0)
        self.env['ECS_TEST_DIRTY'] = ' M site.json'
        self.assertNotEqual(self.command('deploy').returncode, 0)
        self.assertNotIn('git pull', self.log.read_text())
        self.assertNotIn('python3 ', self.log.read_text())
        self.log.unlink()
        self.env.pop('ECS_TEST_DIRTY')
        self.env['ECS_TEST_PULL_EXIT'] = '7'
        self.assertEqual(self.command('deploy').returncode, 7)
        self.assertNotIn('python3 ', self.log.read_text())

    def test_check_does_not_pull_and_invalid_deploy_flags_do_not_run_commands(self):
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.command('check').returncode, 0)
        self.assertEqual(self.log.read_text(), f'python3 {self.scripts}/deploy_ecs.py --check\n')
        before = self.log.read_bytes()
        self.assertEqual(self.command('deploy', '--unknown').returncode, 2)
        self.assertEqual(self.log.read_bytes(), before)

    def test_unpushed_local_commit_cannot_be_deployed_as_origin_main(self):
        self.assertEqual(self.install().returncode, 0)
        self.env['ECS_TEST_LOCAL_COMMIT'] = '1'
        self.assertNotEqual(self.command('deploy').returncode, 0)
        self.assertIn('git pull --ff-only origin main', self.log.read_text())
        self.assertNotIn('python3 ', self.log.read_text())


if __name__ == '__main__':
    unittest.main()
