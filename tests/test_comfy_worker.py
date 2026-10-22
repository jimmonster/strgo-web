import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from image_service.comfy_worker import Worker, ExecutionError, atomic_json, load_config

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_local_studio', ROOT / 'scripts/prepare-local-studio.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class ComfyWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.graph = {'1': {'class_type': 'TextNode', 'inputs': {'text': ''}}, '2': {'class_type': 'SaveImage', 'inputs': {'filename_prefix': 'test'}}}
        self.config = {'workflows': [{'id': 'qwen', 'kind': 'image', 'label': 'Qwen', 'graph': self.graph, 'output': '2', 'bindings': {'prompt': ['1', 'text'], 'outputPrefix': ['2', 'filename_prefix']}}]}
        self.worker = Worker(self.config, self.root, 'https://workflow.strgo.com', 'http://127.0.0.1:8188', 'x' * 40)
        self.job = {'id': uuid.uuid4().hex, 'workflow': 'qwen', 'prompt': 'A lake', 'claim': 'secret-claim', 'reference': None}

    def test_only_loopback_comfy_and_https_site(self):
        for site, comfy in [('http://workflow.strgo.com', 'http://127.0.0.1:8188'), ('https://workflow.strgo.com', 'http://192.168.1.4:8188'), ('https://workflow.strgo.com/other', 'http://127.0.0.1:8188')]:
            with self.subTest(site=site, comfy=comfy), self.assertRaises(ExecutionError):
                Worker(self.config, self.root, site, comfy, 'x' * 40)

    def test_ambiguous_submission_is_journaled_before_request_and_never_reposted(self):
        state = {'job': self.job}
        def local(path, body=None):
            if path == '/prompt':
                saved = json.loads(self.worker.pending.read_text())
                self.assertEqual(saved['submission'], 'submitting')
                self.assertEqual(body['prompt']['1']['inputs']['text'], 'A lake')
                self.assertEqual(body['prompt']['2']['inputs']['filename_prefix'], 'strgo-workflow/' + self.job['id'])
                raise OSError('response lost')
            if path.startswith('/history/'):
                return {}
            if path == '/queue':
                return {'queue_running': [], 'queue_pending': []}
            self.fail('unexpected local request: ' + path)
        with patch.object(self.worker, 'local', side_effect=local), self.assertRaises(OSError):
            self.worker.execute(state)
        self.assertEqual(self.graph['1']['inputs']['text'], '')
        saved = json.loads(self.worker.pending.read_text())
        with patch.object(self.worker, 'local', side_effect=local) as calls, patch('image_service.comfy_worker.time.sleep'), self.assertRaises(ExecutionError):
            self.worker.execute(saved)
        self.assertFalse(any(call.args[0] == '/prompt' for call in calls.call_args_list))

    def test_completed_output_retries_upload_without_running_comfy(self):
        target = self.root / (self.job['id'] + '.result')
        target.write_bytes(b'\x89PNG\r\n\x1a\nresult')
        state = {'job': self.job, 'output': target.name}
        atomic_json(self.worker.pending, state)
        with patch.object(self.worker, 'local') as local, patch.object(self.worker, 'remote', return_value={'ok': True}) as remote:
            self.worker.step()
        local.assert_not_called()
        self.assertTrue(any(call.args[0].endswith('/complete') for call in remote.call_args_list))
        self.assertFalse(self.worker.pending.exists())

    def test_saved_failure_is_reported_without_executing_again(self):
        atomic_json(self.worker.pending, {'job': self.job, 'failure': 'ComfyUI failed'})
        with patch.object(self.worker, 'local') as local, patch.object(self.worker, 'remote', return_value={'ok': True}) as remote:
            self.worker.step()
        local.assert_not_called()
        self.assertTrue(any(call.args[0].endswith('/fail') for call in remote.call_args_list))
        self.assertTrue((self.root / 'last-failure.json').exists())

    def test_server_ack_lost_and_untrusted_job_paths(self):
        atomic_json(self.worker.pending, {'job': self.job})
        with patch.object(self.worker, 'local') as local, patch.object(self.worker, 'remote', return_value={'complete': True}):
            self.worker.step()
        local.assert_not_called()
        self.assertFalse(self.worker.pending.exists())
        for changes in ({'id': '../../outside'}, {'workflow': {}}, {'reference': 'not-base64'}):
            with self.subTest(changes=changes), self.assertRaises(ExecutionError):
                self.worker.validate_job({**self.job, 'claim': 'x' * 40, **changes})

    def test_custom_deployment_domain_and_injection_rejection(self):
        spec = importlib.util.spec_from_file_location('configure_workflow', ROOT / 'scripts/configure-workflow.py')
        configure = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(configure)
        configure.render('creative.example.com', '/srv/web', '/etc/certs/creative', 9012, self.root / 'deployment')
        text = (self.root / 'deployment/workflow.conf').read_text()
        self.assertIn('server_name creative.example.com;', text)
        self.assertIn('root /srv/web/current/local-studio;', text)
        self.assertIn('proxy_pass http://127.0.0.1:9012;', text)
        self.assertNotIn('{{', text)
        for domain in ('bad.example.com;return 200;', 'https://creative.example.com', '../example.com'):
            with self.subTest(domain=domain), self.assertRaises(ValueError):
                configure.render(domain, '/srv/web', '/etc/certs', 8092, self.root)

    def test_binding_validation_and_named_widget_conversion(self):
        (self.root / 'graph.json').write_text(json.dumps(self.graph))
        spec = {**self.config['workflows'][0], 'file': 'graph.json'}
        spec.pop('graph')
        path = self.root / 'worker.json'
        path.write_text(json.dumps({'workflows': [spec]}))
        self.assertEqual(load_config(path)['workflows'][0]['graph'], self.graph)
        spec['bindings'] = {'prompt': ['1', 'missing']}
        path.write_text(json.dumps({'workflows': [spec]}))
        with self.assertRaises(ExecutionError):
            load_config(path)
        ui = {'links': [[1, 1, 0, 2, 0, 'IMAGE']], 'nodes': [
            {'id': 1, 'type': 'LoadImage', 'widgets_values_named': {'image': 'private.png', 'upload': 'image'}, 'inputs': [{'name': 'image', 'type': 'COMBO', 'widget': {'name': 'image'}}, {'name': 'upload', 'type': 'IMAGEUPLOAD', 'widget': {'name': 'upload'}}]},
            {'id': 2, 'type': 'SaveImage', 'inputs': [{'name': 'images', 'link': 1}]}]}
        converted = prepare.api_graph(ui)
        self.assertEqual(converted['1']['inputs'], {'image': 'private.png'})
        self.assertEqual(converted['2']['inputs']['images'], ['1', 0])
        self.assertEqual(prepare.without_reference(converted), {'2': {'class_type': 'SaveImage', 'inputs': {}}})
