"""Internal engine credentials and authorization before an external paid submit."""
import hmac
import os
from pathlib import Path
import re

import aiohttp
from aiohttp import web

CREDENTIAL = (Path(os.environ['CREDENTIALS_DIRECTORY']) / 'engine.token').read_text().strip()
if not re.fullmatch(r'[A-Za-z0-9_-]{43}', CREDENTIAL):
    raise RuntimeError('Missing STRGO engine credential.')

HEADER = 'X-STRGO-Engine'
GATEWAY = 'http://127.0.0.1:8189'


@web.middleware
async def engine_only(request, handler):
    if not hmac.compare_digest(request.headers.get(HEADER, '').encode(), CREDENTIAL.encode()):
        raise web.HTTPNotFound()
    return await handler(request)


async def gateway(path, body):
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8), trust_env=False) as client:
            async with client.post(GATEWAY + '/internal/' + path, json=body, allow_redirects=False,
                                   headers={HEADER: CREDENTIAL}) as response:
                return response.status == 200
    except (aiohttp.ClientError, OSError, TimeoutError):
        return False


async def claim_current_job():
    from server import PromptServer
    job = PromptServer.instance.last_prompt_id
    if not await gateway('dispatch', {'job': job}):
        raise RuntimeError('STRGO blocked a revoked or duplicate paid submission.')
    return job


async def record_receipt(job, provider_id):
    if isinstance(provider_id, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', provider_id):
        await gateway('receipt', {'job': job, 'provider_id': provider_id})
