"""Real HTTP interoperability with a local fake ComfyUI; no GPU/model calls."""
import json
import base64
import os
from pathlib import Path
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
from unittest.mock import patch
import urllib.request
import uuid

from image_service.app import HTTPHandler
from image_service.comfy_worker import Worker
from image_service.local_studio import PREFIX
from tests import test_image_service as fixtures


class FakeComfy(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers['Content-Length']))
        if self.path == '/upload/image':
            assert fixtures.PNG in raw
            self.server.reference_uploaded = True
            self.respond({'name': 'uploaded-reference.png', 'subfolder': '', 'type': 'input'})
            return
        body = json.loads(raw)
        assert self.path == '/prompt'
        self.server.submissions += 1
        self.server.prompt_id = body['prompt_id']
        self.server.prompt = body['prompt']
        self.respond({'prompt_id': body['prompt_id'], 'number': 0, 'node_errors': {}})

    def do_GET(self):
        if self.path.startswith('/view?'):
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(fixtures.PNG)))
            self.end_headers()
            self.wfile.write(fixtures.PNG)
        elif self.path.startswith('/history/'):
            prompt_id = self.server.prompt_id
            self.respond({prompt_id: {'status': {'status_str': 'success', 'completed': True}, 'outputs': {'2': {'images': [{'filename': 'result.png', 'subfolder': '', 'type': 'output'}]}}}})
        else:
            self.respond({})

    def respond(self, value):
        data = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class WorkflowHTTPTests(unittest.TestCase):
    def test_admin_task_round_trip_over_real_http_without_paid_provider(self):
        fixture = fixtures.ImageServiceTests()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        api = ThreadingHTTPServer(('127.0.0.1', 0), HTTPHandler)
        api.service = fixture.app
        comfy = ThreadingHTTPServer(('127.0.0.1', 0), FakeComfy)
        comfy.submissions = 0
        for server in (api, comfy):
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
        site = 'http://127.0.0.1:' + str(api.server_port)
        token = 'test-http-worker-' + 'x' * 40
        with patch.dict(os.environ, {'IMAGE_ENV': 'development', 'LOCAL_STUDIO_ORIGIN': site, 'LOCAL_STUDIO_WORKER_TOKEN': token}), tempfile.TemporaryDirectory() as directory:
            config = {'workflows': [{'id': 'qwen', 'label': 'Qwen-Image-2.1', 'kind': 'image', 'output': '2', 'bindings': {'prompt': ['1', 'text']}, 'graph': {'1': {'class_type': 'Text', 'inputs': {'text': ''}}, '2': {'class_type': 'SaveImage', 'inputs': {}}}}]}
            config['workflows'].append({'id': 'qwen-reference', 'label': 'Qwen reference', 'kind': 'image', 'output': '2', 'bindings': {'prompt': ['1', 'text'], 'reference': ['3', 'image']}, 'graph': {'1': {'class_type': 'Text', 'inputs': {'text': ''}}, '2': {'class_type': 'SaveImage', 'inputs': {}}, '3': {'class_type': 'LoadImage', 'inputs': {'image': 'reference.png'}}}})
            runner = Worker(config, Path(directory), site, 'http://127.0.0.1:' + str(comfy.server_port), token, allow_local_http=True)
            runner.step()  # advertise without a task
            def post(path, body, cookie='', csrf=''):
                req = urllib.request.Request(site + PREFIX + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'Origin': site, 'Cookie': cookie, 'X-CSRF-Token': csrf})
                with urllib.request.urlopen(req) as response:
                    return json.load(response), response.headers
            login, headers = post('/login', {'username': 'owner', 'password': fixtures.PASSWORD})
            cookie = headers['Set-Cookie'].split(';')[0]
            job, _ = post('/jobs', {'workflow': 'qwen', 'prompt': 'A quiet lake', 'requestId': str(uuid.uuid4())}, cookie, login['csrf'])
            runner.step()
            self.assertEqual(comfy.submissions, 1)
            self.assertEqual(comfy.prompt['1']['inputs']['text'], 'A quiet lake')
            req = urllib.request.Request(site + PREFIX + '/jobs/' + job['id'] + '/asset', headers={'Cookie': cookie, 'Range': 'bytes=0-7'})
            with urllib.request.urlopen(req) as response:
                self.assertEqual(response.status, 206)
                self.assertEqual(response.read(), fixtures.PNG[:8])
            self.assertEqual(fixture.provider.calls, 0)
            self.assertFalse(runner.pending.exists())
            post('/jobs', {'workflow': 'qwen-reference', 'prompt': 'Keep the reference identity', 'reference': base64.b64encode(fixtures.PNG).decode(), 'requestId': str(uuid.uuid4())}, cookie, login['csrf'])
            runner.step()
            self.assertTrue(comfy.reference_uploaded)
            self.assertEqual(comfy.submissions, 2)
            self.assertEqual(comfy.prompt['3']['inputs']['image'], 'uploaded-reference.png')
