import asyncio
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import aiohttp
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from comfyui.gateway import COOKIE, ENGINE_HEADER, ORIGIN, STATE, STATE_COOKIE, Gateway
from comfyui.ledger import Ledger
from comfyui.strgo_api_only.config import Registry
from image_service import comfy_auth
from image_service.app import HTTPHandler
from tests import test_image_service as fixtures
from tests.test_comfy_security import workflow


class ComfyHTTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.fixture = fixtures.ImageServiceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'gateway'
        self.path.mkdir()
        (self.path.parent / 'engine' / 'input').mkdir(parents=True)
        self.bridge, self.engine_key = (secrets.token_urlsafe(32) for _ in range(2))
        secret_patch = patch.object(comfy_auth, 'bridge_secret', return_value=self.bridge)
        secret_patch.start()
        self.addCleanup(secret_patch.stop)
        self.account = ThreadingHTTPServer(('127.0.0.1', 0), HTTPHandler)
        self.account.service = self.fixture.app
        threading.Thread(target=self.account.serve_forever, kwargs={'poll_interval': 0.02}, daemon=True).start()
        self.addCleanup(self.account.server_close)
        self.addCleanup(self.account.shutdown)
        self.submissions, self.results = [], {}
        self.fail_after_dispatch = False
        engine = web.Application()
        engine.router.add_post('/prompt', self.accept)
        engine.router.add_get('/queue', self.engine_queue)
        engine.router.add_get('/history/{job}', self.engine_history)
        engine.router.add_get('/object_info', self.engine_catalog)
        engine.router.add_get('/ws', self.fake_socket)
        engine.router.add_post('/upload/image', self.accept_upload)
        self.fake_engine = TestServer(engine)
        await self.fake_engine.start_server()
        self.addAsyncCleanup(self.fake_engine.close)
        self.registry = Registry({
            'official': {'api_key': 'mock-official-secret', 'daily_limit': 15, 'reserve': 10},
            'byok': {'provider': {'endpoint': 'https://provider.example/v1/chat/completions',
                                  'api_key': 'mock-byok-secret', 'daily_limit': 15,
                                  'models': {'text': {'model': 'text-v1', 'reserve': 10}}}},
        })
        self.ledger = Ledger(self.path / 'jobs.sqlite3')
        self.gateway = Gateway(self.registry, self.ledger, self.path, self.bridge, self.engine_key,
                               account=f'http://127.0.0.1:{self.account.server_port}',
                               engine=str(self.fake_engine.make_url('')).rstrip('/'), recheck=0.05)
        self.client = TestClient(TestServer(self.gateway.app()), cookie_jar=aiohttp.DummyCookieJar())
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def engine_queue(self, _request):
        return web.json_response({'queue_running': [], 'queue_pending': []})

    async def engine_history(self, request):
        return web.json_response(self.results.get(request.match_info['job'], {}))

    async def engine_catalog(self, _request):
        return web.json_response({'OpenAIChatNode': {}, 'StrgoText': {}})

    async def accept(self, req):
        self.assertEqual(req.headers[ENGINE_HEADER], self.engine_key)
        body = await req.json()
        self.submissions.append(body)
        job = body['prompt_id']
        official = body['prompt']['1']['class_type'] == 'OpenAIChatNode'
        byok = body['prompt']['1']['inputs'].get('selection') == 'provider:text'
        if official or byok:
            headers = {ENGINE_HEADER: self.engine_key}
            for action, data in [('dispatch', {}), ('receipt', {'provider_id': 'mock-provider-result'})]:
                async with self.client.post('/internal/' + action, headers=headers, json={'job': job, **data}) as response:
                    self.assertEqual(response.status, 200)
            async with self.client.post('/internal/dispatch', headers=headers, json={'job': job}) as response:
                self.assertEqual(response.status, 409)
        if self.fail_after_dispatch:
            return web.Response(status=502)
        self.results[job] = {job: {'status': {'status_str': 'success'}}}
        return web.json_response({'prompt_id': job, 'number': 1})

    async def accept_upload(self, request):
        part = await (await request.multipart()).next()
        self.assertRegex(part.filename, r'^[a-f0-9]{32}\.png$')
        self.assertEqual(await part.read(), fixtures.PNG)
        return web.json_response({'name': part.filename, 'type': 'input'})

    async def fake_socket(self, req):
        self.assertEqual(req.headers[ENGINE_HEADER], self.engine_key)
        response = web.WebSocketResponse()
        await response.prepare(req)
        await response.send_json({'type': 'status', 'data': {'sid': req.query['clientId']}})
        async for _ in response:
            pass
        return response

    async def sign_in(self):
        r = await self.client.get('/login/')
        csrf = r.cookies[STATE_COOKIE].value
        response = await self.client.post('/auth/start', data={'csrf': csrf}, headers={
            'Cookie': STATE_COOKIE + '=' + csrf, 'Origin': ORIGIN}, allow_redirects=False)
        self.assertEqual(response.status, 303)
        state = response.cookies[STATE].value
        path = urlsplit(response.headers['Location']).path
        account_url = f'http://127.0.0.1:{self.account.server_port}{path}?state={state}'
        async with self.client.session.get(account_url, headers={'Cookie': self.fixture.admin['cookie']},
                                           allow_redirects=False) as grant:
            self.assertEqual(grant.status, 303)
            callback = urlsplit(grant.headers['Location'])
        self.assertEqual(set(parse_qs(callback.query)), {'state', 'code'})
        headers = {'Cookie': STATE + '=' + state}
        response = await self.client.get(callback.path + '?' + callback.query, headers=headers, allow_redirects=False)
        self.assertEqual(response.status, 303)
        again = await self.client.get(callback.path + '?' + callback.query, headers=headers, allow_redirects=False)
        self.assertEqual(again.status, 401)
        self.assertIn('HttpOnly', response.cookies[COOKIE].OutputString())
        self.assertIn('Secure', response.cookies[COOKIE].OutputString())
        self.assertIn('SameSite=Strict', response.cookies[COOKIE].OutputString())
        self.assertNotIn('Domain', response.cookies[COOKIE].OutputString())
        return COOKIE + '=' + response.cookies[COOKIE].value

    async def prompt(self, cookie, graph, request=None, extra=None):
        headers = {'Origin': ORIGIN, 'Cookie': cookie, 'X-STRGO-Request-ID': str(request or uuid4())}
        return await self.client.post('/api/prompt', headers=headers,
                                      json={'prompt': graph, **({'extra_data': extra} if extra else {})})

    async def test_session_authenticates_all_routes_and_revokes_open_socket(self):
        for path in ('/object_info', '/ws', '/some-future-route'):
            self.assertEqual((await self.client.get(path)).status, 401)
        token = await self.sign_in()
        self.assertEqual((await self.client.get('/object_info', headers={'Cookie': token})).status, 200)
        self.assertEqual((await self.client.get('/object_info', headers={'Cookie': token + '; ' + token})).status, 401)
        self.assertEqual((await self.client.get('/ws', headers={'Cookie': token, 'Origin': 'https://other.invalid'})).status, 403)
        async with self.client.ws_connect('/ws?clientId=browser1', headers={'Cookie': token, 'Origin': ORIGIN}) as ws:
            self.assertEqual((await ws.receive_json())['data']['sid'], 'browser1')
            with self.fixture.store.connect() as db:
                db.execute("UPDATE users SET role='member' WHERE id=?", (self.fixture.admin['user']['id'],))
            self.assertEqual((await self.client.get('/object_info', headers={'Cookie': token})).status, 403)
            self.assertEqual((await ws.receive(timeout=2)).data, 1008)

    async def test_http_mock_official_and_byok_are_isolated_with_budget_and_idempotency(self):
        token = await self.sign_in()
        official = workflow('05_official_partner_example')
        request = uuid4()
        first = await self.prompt(token, official, request)
        self.assertEqual(first.status, 200, await first.text())
        result = await first.json()
        second = await self.prompt(token, official, request)
        self.assertEqual(await second.json(), result)
        self.assertEqual(len(self.submissions), 1)
        self.assertEqual(self.submissions[0]['extra_data'], {'api_key_comfy_org': 'mock-official-secret'})
        await self.gateway.reconcile()
        official['1']['inputs']['prompt'] += ' 2'
        self.assertEqual((await self.prompt(token, official)).status, 403)
        byok = workflow()
        byok['1']['inputs']['selection'] = 'provider:text'
        self.assertEqual((await self.prompt(token, byok)).status, 200)
        self.assertNotIn('extra_data', self.submissions[1])
        await self.gateway.reconcile()
        response = await self.client.get('/strgo/jobs', headers={'Cookie': token})
        audit = await response.json()
        self.assertEqual({row['unit'] for row in audit['jobs']}, {'milli-Comfy-Credit', 'micro-USD'})
        self.assertEqual({row['vendor_job'] for row in audit['jobs']}, {'mock-provider-result'})
        self.assertNotIn('secret', json.dumps(audit))
        self.assertTrue(all(row['confirmed_amount'] is None for row in audit['jobs']))

    async def test_ambiguous_submission_never_replays_after_ledger_reopen(self):
        token = await self.sign_in()
        self.fail_after_dispatch = True
        official = workflow('05_official_partner_example')
        request = uuid4()
        self.assertEqual((await self.prompt(token, official, request)).status, 503)
        self.gateway.ledger = Ledger(self.path / 'jobs.sqlite3')
        await self.gateway.reconcile()
        self.assertEqual((await self.prompt(token, official, request)).status, 409)
        self.assertEqual((await self.prompt(token, official)).status, 409)
        self.assertEqual(len(self.submissions), 1)

    async def test_write_limits_and_rejections_happen_before_engine(self):
        token = await self.sign_in()
        graph = workflow()
        graph['1']['inputs']['url'] = 'http://169.254.169.254/'
        self.assertEqual((await self.prompt(token, graph)).status, 400)
        self.assertEqual((await self.prompt(token, workflow(), extra={'api_key_comfy_org': 'client-secret'})).status, 400)
        headers = {'Origin': ORIGIN, 'Cookie': token}
        self.assertEqual((await self.client.post('/prompt', json={'prompt': workflow()},
                                                headers={**headers, 'Origin': 'https://evil.example'})).status, 403)
        bad = aiohttp.FormData()
        bad.add_field('image', b'<html>invalid</html>', filename='payload.png')
        self.assertEqual((await self.client.post('/upload/image', headers=headers, data=bad)).status, 415)
        valid = aiohttp.FormData()
        valid.add_field('image', fixtures.PNG, filename='portrait.png')
        result = await self.client.post('/upload/image', headers=headers, data=valid)
        self.assertEqual(result.status, 200, await result.text())
        self.assertEqual(len(self.submissions), 0)
