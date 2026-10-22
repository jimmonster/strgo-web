"""Exercise the real Bash HTTP helpers with offline curl responses."""
import json
import os
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXPECTED_BODY = '<!doctype html><title>POLYVERSE test release</title>'
EXPECTED_HASH = 'sha256-offline-regression-test'
URL = 'https://strgo.com/polyverse/'
checks = []

with tempfile.TemporaryDirectory(prefix='polyverse-deploy-test-') as temporary:
    temporary = pathlib.Path(temporary)
    bin_directory = temporary / 'bin'
    bin_directory.mkdir()
    mock = bin_directory / 'curl'
    mock.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
assert '--noproxy' in args and args[args.index('--noproxy')+1] == '*'
assert '--resolve' in args and args[args.index('--resolve')+1] == 'strgo.com:443:127.0.0.1'
assert '--connect-timeout' in args
count_file = pathlib.Path(os.environ['TEST_CURL_COUNT'])
count = int(count_file.read_text()) if count_file.exists() else 0
plan = json.loads(pathlib.Path(os.environ['TEST_CURL_PLAN']).read_text())
response = plan[min(count, len(plan)-1)]
count_file.write_text(str(count+1))
status = str(response.get('status',200))
headers = 'HTTP/1.1 ' + status + ' Mock\\r\\n'
if response.get('hash'):
    headers += "Content-Security-Policy: script-src 'self' '" + response['hash'] + "';\\r\\n"
if '-D' in args:
    pathlib.Path(args[args.index('-D')+1]).write_text(headers+'\\r\\n')
if '-o' in args:
    pathlib.Path(args[args.index('-o')+1]).write_text(response.get('body',''))
if '-w' in args:
    sys.stdout.write(status)
exit_code = response.get('exit',0)
if '--fail' in args and int(status) >= 400:
    exit_code = 22
if exit_code:
    sys.stderr.write('Simulated curl failure\\n')
sys.exit(exit_code)
''')
    mock.chmod(0o755)
    expected_file = temporary / 'expected.html'
    expected_file.write_text(EXPECTED_BODY)

    def run(name, plan, timeout=0, fetch=False):
        directory = temporary / name
        directory.mkdir()
        plan_file = directory / 'plan.json'
        count_file = directory / 'count'
        plan_file.write_text(json.dumps(plan))
        environment = dict(os.environ, **{
            'PATH': str(bin_directory) + os.pathsep + os.environ['PATH'],
            'TEST_CURL_PLAN': str(plan_file), 'TEST_CURL_COUNT': str(count_file),
            'POLYVERSE_TEST_ROOT': str(ROOT), 'EXPECTED_FILE': str(expected_file),
            'EXPECTED_HASH': EXPECTED_HASH, 'TEST_URL': URL,
            'DIAGNOSTICS': str(directory), 'READY_TIMEOUT': str(timeout),
        })
        command = ('polyverse_fetch "$TEST_URL" -o "$DIAGNOSTICS/download"' if fetch else
                   'polyverse_wait_for_release "$EXPECTED_FILE" "$EXPECTED_HASH" "$TEST_URL" "$DIAGNOSTICS" "$READY_TIMEOUT" 0')
        result = subprocess.run(['bash', '-c',
            'set -Eeuo pipefail\nsource "$POLYVERSE_TEST_ROOT/lib/deploy-http.sh"\nDOMAIN=strgo.com\n' + command],
            env=environment, text=True, capture_output=True, timeout=8)
        return result, int(count_file.read_text()), directory

    ready = {'status': 200, 'body': EXPECTED_BODY, 'hash': EXPECTED_HASH}
    result, count, directory = run('reload-transition', [
        {'status': 404, 'body': 'Old worker: not found'},
        {'status': 0, 'exit': 7},
        {'status': 200, 'body': 'Old homepage', 'hash': EXPECTED_HASH},
        {'status': 200, 'body': EXPECTED_BODY},
        ready,
    ], timeout=3)
    assert result.returncode == 0, result.stderr
    assert count == 5, count
    log = (directory / 'readiness.log').read_text()
    for text in ['http=404', 'curl=7', 'content=no csp=yes', 'content=yes csp=no',
                 'attempt=5', 'content=yes csp=yes']:
        assert text in log, log
    checks.append('Reload transition retries 404/connection failure/stale content/missing CSP; accepts only matching page and CSP')

    for name, response in [
        ('persistent-404', {'status': 404, 'body': 'Not found'}),
        ('stale-200', {'status': 200, 'body': 'Old page', 'hash': EXPECTED_HASH}),
        ('wrong-csp', {'status': 200, 'body': EXPECTED_BODY, 'hash': 'sha256-wrong'}),
    ]:
        result, count, directory = run(name, [response])
        assert result.returncode == 1, result.stderr
        assert count == 1
        assert URL in result.stderr
        assert 'readiness.{log,headers,body,error}' in result.stderr
        assert (directory / 'readiness.body').read_text() == response['body']
        checks.append(name + ': readiness fails with URL and retained diagnostics')

    result, count, directory = run('permanent-route-error', [{'status': 404}], fetch=True)
    assert result.returncode == 22, result.stderr
    assert URL in result.stderr
    assert count == 1
    checks.append('Route verification preserves real 404 failures and names the failed URL')

script = (ROOT / 'deploy.sh').read_text()
reload_stage = script.index("STAGE='重载 Nginx 并等待新配置就绪'")
assert (script.index('systemctl reload nginx', reload_stage)
        < script.index('polyverse_wait_for_release', reload_stage)
        < script.index("STAGE='逐页校验'", reload_stage))
for relative in ['deploy.sh', 'lib/deploy-http.sh']:
    subprocess.run(['bash', '-n', str(ROOT / relative)], check=True)
checks.append('Deployment waits between reload and route checks; both Bash files pass syntax validation')
report = {'status': 'passed',
          'type': 'Offline regression tests with simulated HTTP; no real Nginx or network validation',
          'checks': checks}
(ROOT / 'artifacts/deployment').mkdir(parents=True, exist_ok=True)
(ROOT / 'artifacts/deployment/http-regression.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
