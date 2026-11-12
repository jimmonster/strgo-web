"""Single-origin HTTP and WebSocket gate for a private, API-only ComfyUI."""
import asyncio
from contextlib import suppress
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import re
import secrets
import tempfile
import time
from urllib.parse import urlencode

import aiohttp
from aiohttp import web
from yarl import URL

from .ledger import Ledger
from .strgo_api_only.config import credential, load
from .strgo_api_only.policy import OFFICIAL_MODEL, Rejected, compile_graph, uuid4

ORIGIN = 'https://comfyui.strgo.com'
MAIN_ORIGIN = 'https://strgo.com'
COOKIE = 'strgo_comfyui_session'
STATE = 'strgo_comfyui_state'
ENGINE_HEADER = 'X-STRGO-Engine'
TOKEN = re.compile(r'[A-Za-z0-9_-]{43}')
CLIENT = re.compile(r'[A-Za-z0-9_-]{1,80}')
MAX_JSON = 512 * 1024
MAX_UPLOAD = 16 * 1024 * 1024
FILE_LIMIT = 256 * 1024 * 1024
LOG = logging.getLogger(__name__)
EXAMPLES = ('01_text_api', '02_image_api', '03_video_async_api', '04_text_image_video_pipeline',
            '05_official_partner_example', '06_provider_switch_demo')
READ = re.compile(r'/(?:api/)?(?:system_stats|features|extensions|embeddings|models(?:/[a-z_]+)?|'
                  r'object_info(?:/[A-Za-z0-9_]+)?|prompt|queue|history(?:/[a-f0-9-]+)?|'
                  r'jobs(?:/[a-f0-9-]+)?|settings|userdata|view)')
STATIC = re.compile(r'/(?:assets|scripts|extensions|static|locales|icons|web|fonts)/[A-Za-z0-9_./@+-]+')
WRITE = {'/interrupt', '/queue', '/history', '/settings'}
SETTINGS = re.compile(r'/settings/[A-Za-z0-9._-]{1,120}')
USERDATA = re.compile(r'/userdata/(?:workflows/)?[^/\\]{1,160}\.json')
STATE_COOKIE = 'strgo_comfyui_csrf'


def cookie(request, name):
    prefix = name + '='
    values = [part.strip()[len(prefix):] for header in request.headers.getall('Cookie', [])
              for part in header.split(';') if part.strip().startswith(prefix)]
    return values[0] if len(values) == 1 and TOKEN.fullmatch(values[0]) else ''


def set_cookie(response, name, value, age):
    response.set_cookie(name, value, max_age=age, secure=True, httponly=True, samesite='Strict', path='/')


def failed(message, status):
    return web.json_response({'error': {'type': 'strgo_request', 'message': message, 'details': '',
                                         'extra_info': {}}, 'node_errors': {}}, status=status)


def redirect(target):
    return web.Response(status=303, headers={'Location': target})


def verify_origin(request):
    if request.headers.getall('Origin', []) != [ORIGIN]:
        raise Rejected('Request origin is invalid.', 403)


async def read_json(request, maximum=MAX_JSON):
    if request.content_type != 'application/json' or request.headers.get('Content-Encoding', 'identity') != 'identity':
        raise Rejected('Use uncompressed application/json.', 415)
    buffer = bytearray()
    async for chunk in request.content.iter_chunked(16384):
        buffer.extend(chunk)
        if len(buffer) > maximum:
            raise Rejected('The JSON request is too large.', 413)
    try:
        body = json.loads(buffer)
    except (ValueError, RecursionError):
        raise Rejected('Invalid JSON.') from None
    if not isinstance(body, dict):
        raise Rejected('Expected a JSON object.')
    return body


async def limit_response(response, limit=MAX_JSON):
    data = bytearray()
    async for chunk in response.content.iter_chunked(16384):
        data.extend(chunk)
        if len(data) > limit:
            raise Rejected('Upstream response exceeds the limit.', 502)
    return json.loads(data)


async def prepare(_request, response):
    response.headers.update({'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
                             'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
                             'Cross-Origin-Resource-Policy': 'same-origin'})


@web.middleware
async def errors(request, handler):
    try:
        return await handler(request)
    except Rejected as error:
        return failed(str(error), error.status)
    except (aiohttp.ClientError, OSError, TimeoutError):
        return failed('The STRGO gateway or engine is temporarily unavailable.', 503)
    except (ValueError, RecursionError):
        return failed('Invalid request or upstream response.', 400)
    except Exception:
        LOG.error('Gateway request failed; request data withheld.')
        return failed('Internal gateway failure.', 500)


class Gateway:
    def __init__(self, registry, ledger, state, bridge_key, engine_key, *,
                 account='http://127.0.0.1:8092', engine='http://127.0.0.1:8188', recheck=30):
        self.registry = registry
        self.ledger = ledger
        self.state = state
        self.bridge_key = bridge_key
        self.engine_key = engine_key
        self.account = account
        self.engine = engine
        self.recheck = recheck
        self.pending_tokens = {}
        self.submit_lock = asyncio.Lock()
        self.upload_lock = asyncio.Lock()
        self.sockets = 0

    def app(self):
        app = web.Application(middlewares=[errors], client_max_size=MAX_UPLOAD + 65536)
        app.router.add_route('*', '/{path:.*}', self.handle)
        app.on_response_prepare.append(prepare)
        app.cleanup_ctx.append(self.lifetime)
        return app

    async def lifetime(self, _app):
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12),
                                         trust_env=False, auto_decompress=False) as self.http:
            task = asyncio.create_task(self.poll())
            try:
                yield
            finally:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    async def account_call(self, action, payload, ip='gateway'):
        async with self.http.post(
            self.account + '/internal/strgo-comfyui/' + action, json=payload, allow_redirects=False,
            headers={'X-STRGO-Comfy-Bridge': self.bridge_key, 'X-Real-IP': ip},
        ) as response:
            if response.status in (401, 403):
                raise Rejected('Administrator access is required.', response.status)
            if response.status != 200:
                raise Rejected('The STRGO account service is unavailable.', 503)
            return await limit_response(response, 4096)

    async def account_user(self, token):
        if not token:
            raise Rejected('Sign in using your STRGO account.', 401)
        return (await self.account_call('check', {'token': token}))['user']

    def engine_headers(self):
        return {ENGINE_HEADER: self.engine_key, 'Accept-Encoding': 'identity'}

    def engine_id(self, token, client):
        return hmac.new(self.engine_key.encode(), (token + ':' + client).encode(), hashlib.sha256).hexdigest()

    async def handle(self, request):
        path, method = request.path, request.method
        token = cookie(request, COOKIE)
        if path.startswith('/internal/'):
            return await self.internal(request, path, method, token)
        if path in ('/login/', '/auth/start', '/auth/callback', '/auth/logout'):
            return await self.auth(request, path, method, token)
        owner = await self.account_user(token)
        if method not in ('GET', 'HEAD') or path in ('/ws', '/api/ws'):
            verify_origin(request)
        if path in ('/ws', '/api/ws') and method == 'GET':
            return await self.websocket(request, token)
        if path == '/strgo/settings' and method == 'GET':
            return web.json_response({'text': self.registry.selections(),
                                      'official': self.registry.model('official', OFFICIAL_MODEL).enabled})
        if path == '/strgo/jobs' and method == 'GET':
            return web.json_response({'jobs': self.ledger.history(owner)})
        if path.startswith('/strgo/workflows/') and method == 'GET':
            name = path.rsplit('/', 1)[-1]
            if name in EXAMPLES:
                return web.FileResponse(Path(__file__).with_name('workflows') / (name + '.json'))
        canonical = path.removeprefix('/api') if path.startswith('/api/') else path
        if canonical == '/prompt' and method == 'POST':
            return await self.submit(request, owner, token)
        if canonical == '/upload/image' and method == 'POST':
            return await self.upload(request, canonical)
        if method in ('GET', 'HEAD') and (path in ('/', '/favicon.ico', '/robots.txt')
                or READ.fullmatch(path) or STATIC.fullmatch(path) or USERDATA.fullmatch(canonical)
                or SETTINGS.fullmatch(canonical)):
            if any(part in ('.', '..') for part in path.split('/')):
                raise Rejected('Invalid path.')
            return await self.forward(request, path)
        if method in ('POST', 'DELETE') and (canonical in WRITE or SETTINGS.fullmatch(canonical)
                                             or USERDATA.fullmatch(canonical)):
            if canonical != '/interrupt' and request.can_read_body:
                data = await read_json(request)
                if self.sensitive(data):
                    raise Rejected('Credentials are configured on the server.')
            else:
                data = {}
            return await self.forward(request, path, json_data=data)
        return failed('This route is unavailable in API-only mode.', 404)

    @staticmethod
    def sensitive(value):
        if isinstance(value, dict):
            return any(re.search(r'api.?key|auth.?token|authorization|password|credential', field, re.I)
                       or Gateway.sensitive(item) for field, item in value.items())
        return isinstance(value, list) and any(Gateway.sensitive(item) for item in value)

    async def internal(self, request, path, method, token):
        if path == '/internal/auth' and method == 'GET':
            await self.account_user(token)
            return web.Response(status=204)
        if method != 'POST' or not hmac.compare_digest(
                request.headers.get(ENGINE_HEADER, '').encode(), self.engine_key.encode()):
            return web.Response(status=404)
        body = await read_json(request, 4096)
        job = uuid4(body.get('job'))
        if not job:
            return web.Response(status=400)
        if path == '/internal/dispatch':
            original = self.pending_tokens.get(job)
            if not original:
                return web.Response(status=403)
            await self.account_user(original)
            return web.Response(status=200 if self.ledger.claim(job) else 409)
        if path == '/internal/receipt':
            vendor_id = body.get('provider_id')
            if (isinstance(vendor_id, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', vendor_id)
                    and all(model.api_key not in vendor_id for model in self.registry.entries.values()
                            if model.api_key)):
                self.ledger.receipt(job, vendor_id)
                return web.Response(status=200)
        return web.Response(status=404)

    async def auth(self, request, path, method, token):
        if path == '/login/' and method == 'GET':
            csrf = secrets.token_urlsafe(32)
            response = web.Response(content_type='text/html', text=f'''<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>STRGO ComfyUI</title><main><h1>STRGO ComfyUI</h1>
<form method="post" action="/auth/start"><input type="hidden" name="csrf" value="{csrf}">
<button>用 STRGO 账号登录</button></form></main></html>''')
            response.headers['Content-Security-Policy'] = "default-src 'none'; form-action 'self'; frame-ancestors 'none'"
            set_cookie(response, STATE_COOKIE, csrf, 600)
            return response
        if path == '/auth/start' and method == 'POST':
            verify_origin(request)
            if request.content_type != 'application/x-www-form-urlencoded' or not 1 <= (request.content_length or 0) <= 256:
                raise Rejected('Invalid sign-in form.')
            csrf = (await request.post()).get('csrf')
            if not isinstance(csrf, str) or not TOKEN.fullmatch(csrf) or not hmac.compare_digest(csrf, cookie(request, STATE_COOKIE)):
                raise Rejected('Invalid sign-in verification.', 403)
            state = secrets.token_urlsafe(32)
            response = redirect(MAIN_ORIGIN + '/api/image/comfyui-sso/authorize?' + urlencode({'state': state}))
            set_cookie(response, STATE, state, 180)
            return response
        if path == '/auth/callback' and method == 'GET':
            code, state = request.query.get('code', ''), request.query.get('state', '')
            if (sorted(request.query) != ['code', 'state'] or not TOKEN.fullmatch(code)
                    or not TOKEN.fullmatch(state) or not hmac.compare_digest(state, cookie(request, STATE))):
                raise Rejected('Invalid or expired sign-in request.', 401)
            ip = request.headers.get('X-Real-IP', 'gateway')
            result = await self.account_call('exchange', {'state': state, 'code': code}, ip)
            response = redirect('/')
            set_cookie(response, COOKIE, result['token'], result['age'])
            set_cookie(response, STATE, '', 0)
            return response
        if path == '/auth/logout' and method == 'POST':
            verify_origin(request)
            if request.headers.get('X-STRGO-Request') != 'logout':
                raise Rejected('Invalid sign-out verification.', 403)
            if token:
                await self.account_call('logout', {'token': token})
            response = web.json_response({'ok': True})
            set_cookie(response, COOKIE, '', 0)
            return response
        return web.Response(status=405)

    async def submit(self, request, owner, token):
        body = await read_json(request)
        if set(body) - {'prompt', 'extra_data', 'client_id', 'prompt_id'}:
            raise Rejected('Unsupported submission fields.')
        extra = body.get('extra_data', {})
        if (not isinstance(extra, dict) or set(extra) - {'extra_pnginfo', 'api_key_comfy_org', 'auth_token_comfy_org'}
                or extra.get('api_key_comfy_org') or extra.get('auth_token_comfy_org')):
            raise Rejected('Official credentials are injected by STRGO. Sign out of browser-side Comfy credentials.')
        client = body.get('client_id', '')
        if client and (not isinstance(client, str) or not CLIENT.fullmatch(client)):
            raise Rejected('Invalid client ID.')
        request_id = uuid4(request.headers.get('X-STRGO-Request-ID') or body.get('prompt_id'))
        if not request_id:
            raise Rejected('A UUIDv4 request ID is required.')
        plan = compile_graph(body.get('prompt'))
        model = self.registry.model(plan.route, plan.model)
        async with self.submit_lock:
            job, previous = self.ledger.reserve(owner, request_id, plan, model)
            if previous in ('unknown', 'failed'):
                raise Rejected('The job needs verification before another submission.', 409)
            if previous:
                return web.json_response({'prompt_id': job, 'number': 0, 'node_errors': {}})
            if model.enabled:
                self.pending_tokens[job] = token
            payload = {'prompt': plan.graph, 'prompt_id': job}
            if client:
                payload['client_id'] = self.engine_id(token, client)
            if plan.route == 'official':
                payload['extra_data'] = {'api_key_comfy_org': model.api_key}
            try:
                async with self.http.post(self.engine + '/prompt', json=payload, headers=self.engine_headers(),
                                          allow_redirects=False) as response:
                    if response.status == 400:
                        self.ledger.update(job, 'failed', 'submitted')
                        self.pending_tokens.pop(job, None)
                        raise Rejected('ComfyUI rejected the workflow. Check node inputs.')
                    if response.status != 200:
                        raise OSError('Engine submission uncertain.')
                    result = await limit_response(response, 16384)
                    if result.get('prompt_id') != job:
                        raise OSError('Mismatched engine job ID.')
            except (aiohttp.ClientError, OSError, TimeoutError, ValueError):
                self.ledger.update(job, 'unknown' if model.enabled else 'failed', 'submitted')
                self.pending_tokens.pop(job, None)
                raise Rejected('Submission could not be confirmed. Check the task status.', 503) from None
            self.ledger.update(job, 'queued', 'submitted')
            return web.json_response({'prompt_id': job, 'number': result.get('number', 0), 'node_errors': {}})

    async def poll(self):
        while True:
            try:
                await self.reconcile()
            except (Rejected, OSError, aiohttp.ClientError, TimeoutError, ValueError):
                pass
            await asyncio.sleep(4)

    async def engine_json(self, path):
        async with self.http.get(self.engine + path, headers=self.engine_headers(), allow_redirects=False) as response:
            if response.status != 200:
                raise OSError('Engine state unavailable.')
            return await limit_response(response, 1024 * 1024)

    async def reconcile(self):
        jobs = self.ledger.active()
        if not jobs:
            return
        queue = await self.engine_json('/queue')
        running = {item[1] for item in queue['queue_running']}
        queued = {item[1] for item in queue['queue_pending']}
        now = int(time.time())
        for row in jobs:
            job, state = row['id'], row['state']
            if job in running or job in queued:
                self.ledger.update(job, 'running' if job in running else 'queued', state)
                continue
            history = (await self.engine_json('/history/' + job)).get(job)
            if history:
                succeeded = history.get('status', {}).get('status_str') == 'success'
                result = 'succeeded' if succeeded else ('unknown' if row['dispatched'] else 'failed')
            elif now - row['updated'] > 25:
                result = 'unknown' if row['reserved'] else 'failed'
            else:
                continue
            self.ledger.update(job, result, state)
            self.pending_tokens.pop(job, None)

    async def forward(self, request, path, json_data=None, form=None):
        query = request.query
        view = path in ('/view', '/api/view')
        if view:
            query = [(k, v) for k, v in query.items() if k in ('filename', 'type', 'subfolder')]
        headers = self.engine_headers()
        if view and 'Range' in request.headers:
            headers['Range'] = request.headers['Range']
        url = URL(self.engine).with_path(path).with_query(query)
        async with self.http.request(request.method, url, json=json_data, data=form,
                                     headers=headers, allow_redirects=False) as upstream:
            if 300 <= upstream.status < 400:
                return failed('Redirects from the engine are blocked.', 502)
            selected = {key: value for key, value in upstream.headers.items() if key.lower() in
                        ('content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition')}
            if view:
                content_type = upstream.content_type
                if content_type not in ('image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'application/json'):
                    selected['Content-Type'] = 'application/octet-stream'
                    selected['Content-Disposition'] = 'attachment'
            response = web.StreamResponse(status=upstream.status, headers=selected)
            await response.prepare(request)
            try:
                async for chunk in upstream.content.iter_chunked(64 * 1024):
                    await response.write(chunk)
            except (aiohttp.ClientError, ConnectionError, TimeoutError):
                response.force_close()
            return response

    async def upload(self, request, path):
        if request.content_type != 'multipart/form-data' or request.headers.get('Content-Encoding', 'identity') != 'identity':
            raise Rejected('Use a multipart image upload.', 415)
        if self.upload_lock.locked():
            raise Rejected('Another upload is in progress.', 429)
        async with self.upload_lock, asyncio.timeout(60):
            media = await request.multipart()
            with tempfile.TemporaryFile(dir=self.state) as stream:
                found = False
                while field := await media.next():
                    if field.name in ('type', 'subfolder', 'overwrite') and not field.filename:
                        if len(await field.read_chunk()) > 128:
                            raise Rejected('Invalid upload metadata.')
                        continue
                    if found or field.name != 'image' or not field.filename:
                        raise Rejected('Upload exactly one image.')
                    if field.headers.get('Content-Encoding') or field.headers.get('Content-Transfer-Encoding'):
                        raise Rejected('Compressed upload parts are unavailable.', 415)
                    found = True
                    while chunk := await field.read_chunk(64 * 1024):
                        stream.write(chunk)
                        if stream.tell() > MAX_UPLOAD:
                            raise Rejected('The image exceeds the size limit.', 413)
                if not found:
                    raise Rejected('Image is missing.')
                size = stream.tell()
                stream.seek(0)
                header = stream.read(16)
                if header.startswith(b'\x89PNG\r\n\x1a\n'):
                    suffix, mime = 'png', 'image/png'
                elif header.startswith(b'\xff\xd8\xff'):
                    suffix, mime = 'jpg', 'image/jpeg'
                elif header[:4] == b'RIFF' and header[8:12] == b'WEBP':
                    suffix, mime = 'webp', 'image/webp'
                else:
                    raise Rejected('Only PNG, JPEG and WebP images are supported.', 415)
                assets = self.state.parent / 'engine' / 'input'
                total = sum(p.stat().st_size for p in assets.iterdir() if p.is_file())
                if total + size > FILE_LIMIT:
                    raise Rejected('The upload cache is full.', 507)
                stream.seek(0)
                form = aiohttp.FormData()
                form.add_field('image', stream, filename=f'{secrets.token_hex(16)}.{suffix}', content_type=mime)
                return await self.forward(request, path, form=form)

    async def websocket(self, request, token):
        if self.sockets >= 16:
            raise Rejected('Too many WebSocket connections.', 429)
        client = request.query.get('clientId') or secrets.token_hex(16)
        if not CLIENT.fullmatch(client):
            raise Rejected('Invalid WebSocket client ID.')
        self.sockets += 1
        try:
            async with self.http.ws_connect(self.engine + '/ws', params={'clientId': self.engine_id(token, client)},
                                            headers=self.engine_headers(), heartbeat=20, max_msg_size=MAX_JSON) as upstream:
                browser = web.WebSocketResponse(heartbeat=20, max_msg_size=16384)
                await browser.prepare(request)

                async def downstream():
                    async for message in upstream:
                        if message.type == aiohttp.WSMsgType.TEXT:
                            event = json.loads(message.data)
                            if event.get('type') == 'status' and 'sid' in event.get('data', {}):
                                event['data']['sid'] = client
                            await browser.send_json(event)
                        elif message.type == aiohttp.WSMsgType.BINARY:
                            await browser.send_bytes(message.data)

                async def upstream_messages():
                    async for message in browser:
                        if message.type != aiohttp.WSMsgType.TEXT:
                            continue
                        with suppress(ValueError):
                            event = json.loads(message.data)
                            if isinstance(event, dict) and event.get('type') == 'feature_flags':
                                await upstream.send_str(message.data)

                async def access():
                    while True:
                        await asyncio.sleep(self.recheck)
                        try:
                            await self.account_user(token)
                        except (Rejected, OSError, aiohttp.ClientError, TimeoutError):
                            return

                tasks = [asyncio.create_task(operation()) for operation in (downstream, upstream_messages, access)]
                try:
                    await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                finally:
                    for task in tasks:
                        task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
                    await browser.close(code=1008, message=b'Reconnect to STRGO')
                return browser
        finally:
            self.sockets -= 1


def main():
    os.umask(0o077)
    state = Path('/var/lib/strgo-comfyui/gateway')
    gateway = Gateway(load(), Ledger(state / 'jobs.sqlite3'), state, credential('account.token'),
                      credential('engine.token'))
    web.run_app(gateway.app(), host='127.0.0.1', port=8189, access_log=None)


if __name__ == '__main__':
    main()
