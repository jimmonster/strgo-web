import asyncio
import copy
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import web
from aiohttp.test_utils import TestServer

from comfyui.strgo_api_only.config import Model, Registry
from comfyui.strgo_api_only.policy import Rejected, compile_graph
from comfyui.strgo_api_only.providers import Mock, OpenAICompatible, ProviderError, PublicResolver

WORKFLOWS = Path(__file__).resolve().parents[1] / 'comfyui/workflows'


def workflow(name='01_text_api'):
    return json.loads((WORKFLOWS / (name + '.json')).read_text())


class ComfyPolicyTests(unittest.TestCase):
    def test_samples_have_a_single_route(self):
        for file in WORKFLOWS.glob('*.json'):
            plan = compile_graph(json.loads(file.read_text()))
            self.assertEqual(plan.route, 'official' if file.stem.startswith('05') else 'mock')

    def test_local_unknown_or_unselected_nodes_are_rejected(self):
        for kind in ('CheckpointLoaderSimple', 'KSampler', 'VAEDecode', 'UnreviewedExtension', 'LoadImage'):
            graph = workflow()
            graph['3'] = {'class_type': kind, 'inputs': {}}
            with self.subTest(kind=kind), self.assertRaises(Rejected):
                compile_graph(graph)
        graph = workflow('05_official_partner_example')
        graph['4'] = workflow()['1']
        with self.assertRaises(Rejected):
            compile_graph(graph)

    def test_rejects_client_url_hidden_fields_cycle_and_override(self):
        base = workflow()
        for field, value in [('url', 'https://169.254.169.254/'), ('api_key_comfy_org', 'do-not-use'),
                             ('selection', 'https://example.org/v1')]:
            graph = copy.deepcopy(base)
            graph['1']['inputs'][field] = value
            with self.assertRaises(Rejected):
                compile_graph(graph)
        graph = workflow('04_text_image_video_pipeline')
        graph['2']['inputs']['prompt'] = ['3', 0]
        with self.assertRaises(Rejected):
            compile_graph(graph)
        graph = workflow('05_official_partner_example')
        graph['3']['inputs']['max_output_tokens'] = 8000
        with self.assertRaises(Rejected):
            compile_graph(graph)

    def test_fixed_https_endpoints(self):
        for url in ('http://provider.example/v1/chat/completions', 'https://127.0.0.1/chat/completions',
                    'https://trusted.example@evil.example/v1/chat/completions',
                    'https://provider.example:8443/v1/chat/completions',
                    'https://provider.example/v1/chat/completions?key=secret'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                Registry({'byok': {'x': {'endpoint': url, 'models': {}}}})


class ComfyTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_dns_mixed_public_private_answers_fail_closed(self):
        answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('1.1.1.1', 443)),
                   (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('169.254.169.254', 443))]
        with patch.object(asyncio.get_running_loop(), 'getaddrinfo', new=AsyncMock(return_value=answers)):
            with self.assertRaises(ProviderError):
                await PublicResolver().resolve('api.example')
        with patch.object(asyncio.get_running_loop(), 'getaddrinfo', new=AsyncMock(return_value=answers[:1])):
            resolved = await PublicResolver().resolve('api.example')
        self.assertEqual(resolved[0]['host'], '1.1.1.1')
        self.assertEqual(resolved[0]['hostname'], 'api.example')

    async def test_media_mock_contract_has_result_and_cancellation(self):
        mock = Mock()
        task = await mock.submit('test', 'video')
        self.assertEqual(await mock.status(task), 'succeeded')
        self.assertEqual(json.loads(await mock.result(task))['kind'], 'video')
        await mock.cancel(task)
        with self.assertRaises(ProviderError):
            await mock.result(task)

    async def test_byok_adapter_submits_once_and_does_not_echo_error_bodies(self):
        requests = []
        secret = 'temporary-provider-fixture-key'

        async def provider(request):
            self.assertEqual(request.headers['Authorization'], 'Bearer ' + secret)
            data = await request.json()
            requests.append(data)
            if data['messages'][0]['content'] == 'return 503':
                return web.json_response({'error': secret}, status=503)
            return web.json_response({'id': 'mock-response',
                                      'choices': [{'message': {'content': 'fixture result'}}]})

        app = web.Application()
        app.router.add_post('/v1/chat/completions', provider)
        async with TestServer(app) as upstream:
            endpoint = str(upstream.make_url('/v1/chat/completions'))
            model = Model('fixture', 'text', 'fixture-model', endpoint, secret, 'micro-USD', 10, 1)
            adapter = OpenAICompatible(model)
            self.assertEqual(await adapter.submit('hello'), ('fixture result', 'mock-response'))
            with self.assertRaisesRegex(ProviderError, 'HTTP 503') as caught:
                await adapter.submit('return 503')
            self.assertNotIn(secret, str(caught.exception))
        self.assertEqual(len(requests), 2)
        self.assertTrue(all(item['max_tokens'] == 1024 and not item['stream'] for item in requests))
