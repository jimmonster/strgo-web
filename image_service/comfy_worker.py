"""Outbound-only local ComfyUI connector. Uses the Python standard library."""
import argparse
import base64
import contextlib
import copy
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

PREFIX = '/api/image/local-studio'
CHUNK = 1024 * 1024
MAX_FILE = 200 * CHUNK


class ExecutionError(Exception):
    pass


class HTTPError(Exception):
    def __init__(self, status):
        self.status = status
        super().__init__('HTTP ' + str(status))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(url, body=None, headers=None, limit=8 * CHUNK):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers={
        **({'Content-Type': 'application/json'} if body is not None else {}), **(headers or {})})
    try:
        # Never forward the worker credential to a redirect target or env proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(req, timeout=30) as response:
            data = response.read(limit + 1)
            if len(data) > limit:
                raise ExecutionError('response exceeds configured limit')
            return json.loads(data)
    except urllib.error.HTTPError as error:
        raise HTTPError(error.code) from None


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as handle:
        os.chmod(temporary, 0o600)
        json.dump(value, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


@contextlib.contextmanager
def exclusive(path):
    with path.open('a+b') as handle:
        handle.write(b'0')
        handle.flush()
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            if os.name == 'nt':
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def load_config(path):
    config = json.loads(path.read_text(encoding='utf-8-sig'))
    workflows = config.get('workflows')
    if not isinstance(workflows, list) or not 1 <= len(workflows) <= 20:
        raise ExecutionError('configure 1-20 approved workflows')
    ids = set()
    for spec in workflows:
        if spec['id'] in ids or spec['kind'] not in ('image', 'video'):
            raise ExecutionError('invalid workflow registry')
        ids.add(spec['id'])
        graph = json.loads((path.parent / spec['file']).read_text(encoding='utf-8-sig'))
        if not isinstance(graph, dict) or not graph or 'nodes' in graph:
            raise ExecutionError('workflow must use ComfyUI API format')
        if any(not isinstance(node, dict) or not isinstance(node.get('class_type'), str) or not isinstance(node.get('inputs'), dict) for node in graph.values()):
            raise ExecutionError('invalid API graph')
        for name in ('prompt', 'seed', 'reference', 'outputPrefix'):
            binding = spec.get('bindings', {}).get(name)
            if binding and (not isinstance(binding, list) or len(binding) != 2 or binding[0] not in graph or binding[1] not in graph[binding[0]]['inputs']):
                raise ExecutionError('binding does not exist in graph')
        if not spec.get('bindings', {}).get('prompt') or spec.get('output') not in graph:
            raise ExecutionError('prompt and output bindings are required')
        spec['graph'] = graph
    return config


class Worker:
    def __init__(self, config, directory, site, comfy, token, allow_local_http=False):
        parsed = urllib.parse.urlsplit(site)
        local_site = allow_local_http and parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost')
        if (parsed.scheme != 'https' and not local_site) or not parsed.hostname or parsed.path not in ('', '/') or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ExecutionError('site must be an HTTPS origin')
        target = urllib.parse.urlsplit(comfy)
        try:
            loopback = target.hostname == 'localhost' or ipaddress.ip_address(target.hostname).is_loopback
        except ValueError:
            loopback = False
        if not loopback or target.scheme != 'http' or target.username or target.password or target.path not in ('', '/') or target.query or target.fragment:
            raise ExecutionError('ComfyUI must be an HTTP loopback address')
        if len(token) < 32 or any(ord(char) < 33 or ord(char) > 126 for char in token):
            raise ExecutionError('LOCAL_STUDIO_WORKER_TOKEN requires at least 32 printable characters')
        self.specs = {spec['id']: spec for spec in config['workflows']}
        self.directory = directory.resolve()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)
        self.pending = self.directory / 'pending.json'
        self.site, self.comfy, self.token = site.rstrip('/'), comfy.rstrip('/'), token
        self.timeout = int(config.get('timeoutSeconds', 7200))

    def remote(self, path, body):
        return request(self.site + PREFIX + path, body, {'Authorization': 'Bearer ' + self.token})

    def local(self, path, body=None):
        return request(self.comfy + path, body)

    def advertisement(self):
        return [{key: spec.get(key, '') for key in ('id', 'kind', 'label', 'description')} | {'reference': bool(spec.get('bindings', {}).get('reference'))} for spec in self.specs.values()]

    def validate_job(self, job):
        if (not isinstance(job, dict) or not isinstance(job.get('id'), str) or not re.fullmatch(r'[a-f0-9]{32}', job['id'])
                or not isinstance(job.get('workflow'), str) or job['workflow'] not in self.specs or not isinstance(job.get('prompt'), str) or not 1 <= len(job['prompt']) <= 12000
                or not isinstance(job.get('claim'), str) or not 20 <= len(job['claim']) <= 100):
            raise ExecutionError('invalid task received; no local execution allowed')
        if bool(self.specs[job['workflow']]['bindings'].get('reference')) != bool(job.get('reference')):
            raise ExecutionError('reference input does not match the approved workflow')
        if job.get('reference') is not None:
            if not isinstance(job['reference'], str) or len(job['reference']) > 2_666_668:
                raise ExecutionError('invalid reference size')
            data = base64.b64decode(job['reference'], validate=True)
            if len(data) > 2_000_000 or not (data.startswith(b'\x89PNG\r\n\x1a\n') or data.startswith(b'\xff\xd8\xff') or (data[:4] == b'RIFF' and data[8:12] == b'WEBP')):
                raise ExecutionError('invalid reference image')

    def upload_reference(self, job):
        data = base64.b64decode(job['reference'], validate=True)
        extension = 'png' if data.startswith(b'\x89PNG') else ('jpg' if data.startswith(b'\xff\xd8\xff') else 'webp')
        filename = 'strgo-' + job['id'] + '.' + extension
        boundary = 'strgo-' + secrets.token_hex(16)
        raw = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{filename}"\r\nContent-Type: image/{extension}\r\n\r\n'.encode()
               + data + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{boundary}--\r\n'.encode())
        req = urllib.request.Request(self.comfy + '/upload/image', data=raw, headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(req, timeout=30) as response:
            uploaded = json.loads(response.read(CHUNK))
        return (uploaded.get('subfolder', '').rstrip('/') + '/' if uploaded.get('subfolder') else '') + uploaded['name']

    def execute(self, state):
        job = state['job']
        spec = self.specs.get(job['workflow'])
        if not spec:
            raise ExecutionError('workflow no longer configured')
        if state.get('output'):
            return
        if not state.get('submission'):
            graph = copy.deepcopy(spec['graph'])
            values = {'prompt': job['prompt'], 'seed': secrets.randbelow(2 ** 53), 'outputPrefix': 'strgo-workflow/' + job['id']}
            if job.get('reference'):
                if not spec['bindings'].get('reference'):
                    raise ExecutionError('unexpected reference image')
                values['reference'] = self.upload_reference(job)
            for key, binding in spec['bindings'].items():
                if key in values:
                    graph[binding[0]]['inputs'][binding[1]] = values[key]
            state['prompt_id'] = str(uuid.uuid4())
            state['submission'] = 'submitting'
            state['started'] = time.time()
            # Persist BEFORE POST. An ambiguous POST is never submitted again.
            atomic_json(self.pending, state)
            queued = self.local('/prompt', {'prompt': graph, 'prompt_id': state['prompt_id'], 'client_id': 'strgo-workflow'})
            if queued.get('prompt_id') != state['prompt_id']:
                raise ExecutionError('ComfyUI did not preserve the supplied prompt id; update ComfyUI')
            state['submission'] = 'submitted'
            atomic_json(self.pending, state)
        absent = 0
        while time.time() - state['started'] < self.timeout:
            history = self.local('/history/' + state['prompt_id']).get(state['prompt_id'])
            if history:
                if history.get('status', {}).get('status_str') == 'error':
                    raise ExecutionError('ComfyUI execution failed; inspect ComfyUI history')
                output = history.get('outputs', {}).get(spec['output'], {})
                candidates = output.get('images', []) if spec['kind'] == 'image' else output.get('videos', output.get('gifs', output.get('images', [])))
                candidates = [item for item in candidates if item.get('type') == 'output' and isinstance(item.get('filename'), str)]
                if len(candidates) != 1:
                    raise ExecutionError('approved output must produce exactly one image or video')
                item = candidates[0]
                query = urllib.parse.urlencode({key: item.get(key, '') for key in ('filename', 'subfolder', 'type')})
                target = self.directory / (job['id'] + '.result')
                temporary = target.with_suffix('.download')
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
                size = 0
                try:
                    with opener.open(self.comfy + '/view?' + query, timeout=30) as response, temporary.open('wb') as handle:
                        os.chmod(temporary, 0o600)
                        while chunk := response.read(CHUNK):
                            size += len(chunk)
                            if size > MAX_FILE:
                                raise ExecutionError('output exceeds 200 MiB')
                            handle.write(chunk)
                        handle.flush()
                        os.fsync(handle.fileno())
                    if not size:
                        raise ExecutionError('empty output')
                    temporary.replace(target)
                finally:
                    temporary.unlink(missing_ok=True)
                state['output'] = target.name
                atomic_json(self.pending, state)
                return
            queue = self.local('/queue')
            known = any(item[1] == state['prompt_id'] for key in ('queue_running', 'queue_pending') for item in queue.get(key, []))
            absent = 0 if known else absent + 1
            if absent >= 4:
                raise ExecutionError('prompt absent from queue/history; no automatic resubmission')
            time.sleep(3)
        raise ExecutionError('local execution timed out; original ComfyUI task may still be running')

    def return_output(self, state):
        job = state['job']
        path = '/worker/jobs/' + job['id']
        sha, parts = hashlib.sha256(), 0
        with (self.directory / state['output']).open('rb') as handle:
            while chunk := handle.read(CHUNK):
                self.remote(path + '/chunk', {'claim': job['claim'], 'part': parts, 'data': base64.b64encode(chunk).decode()})
                sha.update(chunk)
                parts += 1
        self.remote(path + '/complete', {'claim': job['claim'], 'parts': parts, 'sha256': sha.hexdigest()})

    def step(self):
        if self.pending.exists():
            state = json.loads(self.pending.read_text(encoding='utf-8'))
        else:
            # Only advertise readiness after ComfyUI itself responds.
            self.local('/system_stats')
            job = self.remote('/worker/poll', {'workflows': self.advertisement()}).get('job')
            if not job:
                return
            self.validate_job(job)
            state = {'job': job}
            atomic_json(self.pending, state)
        job = state['job']
        stop = threading.Event()
        def heartbeat():
            while not stop.wait(25):
                try:
                    self.remote('/worker/jobs/' + job['id'] + '/heartbeat', {'claim': job['claim']})
                except Exception:
                    # Execution history/output remains journaled for reconnect.
                    pass
        receipt = self.remote('/worker/jobs/' + job['id'] + '/heartbeat', {'claim': job['claim']})
        if receipt.get('complete'):
            if state.get('output'):
                (self.directory / state['output']).unlink(missing_ok=True)
            self.pending.unlink(missing_ok=True)
            return
        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        try:
            if state.get('failure'):
                raise ExecutionError(state['failure'])
            self.execute(state)
            self.return_output(state)
        except ExecutionError as error:
            state['failure'] = str(error)
            atomic_json(self.pending, state)
            self.remote('/worker/jobs/' + job['id'] + '/fail', {'claim': job['claim']})
            atomic_json(self.directory / 'last-failure.json', state)
        else:
            print('Completed local job ' + job['id'], flush=True)
        finally:
            stop.set()
            thread.join(timeout=31)
        if state.get('output'):
            (self.directory / state['output']).unlink(missing_ok=True)
        self.pending.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--site', default='https://workflow.strgo.com')
    parser.add_argument('--comfy', default='http://127.0.0.1:8188')
    parser.add_argument('--state-dir', type=Path)
    parser.add_argument('--env', type=Path, help='Private KEY=VALUE file containing LOCAL_STUDIO_WORKER_TOKEN')
    parser.add_argument('--allow-local-http', action='store_true', help='Development only: allow loopback HTTP site')
    parser.add_argument('--check', action='store_true', help='Validate local workflow files without connecting or generating')
    args = parser.parse_args()
    config = load_config(args.config.resolve())
    if args.check:
        print(json.dumps({'valid': True, 'workflows': [{'id': spec['id'], 'label': spec['label']} for spec in config['workflows']]}, ensure_ascii=True))
        return
    if args.env:
        for line in args.env.read_text(encoding='utf-8-sig').splitlines():
            key, separator, value = line.strip().partition('=')
            if key == 'LOCAL_STUDIO_WORKER_TOKEN' and separator:
                os.environ[key] = value.strip()
    runner = Worker(config, args.state_dir or args.config.parent / 'state', args.site, args.comfy,
                    os.environ.get('LOCAL_STUDIO_WORKER_TOKEN', ''), args.allow_local_http)
    with exclusive(runner.directory / 'worker.lock'):
        print('Local connector ready; only approved workflows will execute.', flush=True)
        while True:
            try:
                runner.step()
            except HTTPError as error:
                print('Connection returned ' + str(error.status) + '; no workflow was resubmitted.', flush=True)
                if error.status == 409 and runner.pending.exists():
                    state = json.loads(runner.pending.read_text(encoding='utf-8'))
                    state['failure'] = 'server claim expired; inspect ComfyUI before submitting a new task'
                    atomic_json(runner.directory / 'last-failure.json', state)
                    runner.pending.unlink()
            except (OSError, ValueError, ExecutionError):
                print('Connection unavailable; preserving local execution journal.', flush=True)
            time.sleep(5)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, ExecutionError, KeyError) as error:
        print('Connector stopped: ' + type(error).__name__ + '. Check the private configuration and workflow files.', file=sys.stderr)
        sys.exit(1)
