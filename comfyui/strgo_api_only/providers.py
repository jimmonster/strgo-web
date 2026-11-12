"""Bounded text transport and a deterministic asynchronous media test provider."""
import asyncio
import ipaddress
import json
import socket
import uuid

import aiohttp
from aiohttp.abc import AbstractResolver

MAX_RESPONSE = 256 * 1024


class ProviderError(RuntimeError):
    pass


class PublicResolver(AbstractResolver):
    async def resolve(self, host, port=443, family=socket.AF_UNSPEC):
        addresses = await asyncio.get_running_loop().getaddrinfo(
            host, port, family=family, type=socket.SOCK_STREAM)
        resolved = []
        for af, _, protocol, _, sockaddr in addresses:
            address = ipaddress.ip_address(sockaddr[0])
            if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
                address = address.ipv4_mapped
            if (not address.is_global or address.is_multicast or address.is_reserved
                    or getattr(address, 'is_site_local', False)):
                raise ProviderError('Provider DNS did not resolve exclusively to public addresses.')
            resolved.append({'hostname': host, 'host': sockaddr[0], 'port': port, 'family': af,
                             'proto': protocol, 'flags': socket.AI_NUMERICHOST})
        return resolved

    async def close(self):
        pass


class OpenAICompatible:
    def __init__(self, model):
        self.model = model

    async def submit(self, prompt):
        connector = aiohttp.TCPConnector(resolver=PublicResolver(), use_dns_cache=False)
        timeout = aiohttp.ClientTimeout(total=60, sock_connect=10)
        try:
            async with aiohttp.ClientSession(connector=connector, timeout=timeout, trust_env=False) as client:
                async with client.post(
                    self.model.endpoint, allow_redirects=False,
                    headers={'Authorization': 'Bearer ' + self.model.api_key},
                    json={'model': self.model.model, 'messages': [{'role': 'user', 'content': prompt}],
                          'max_tokens': 1024, 'stream': False},
                ) as response:
                    if not 200 <= response.status < 300:
                        raise ProviderError(f'BYOK provider returned HTTP {response.status}.')
                    body = bytearray()
                    async for chunk in response.content.iter_chunked(16384):
                        body.extend(chunk)
                        if len(body) > MAX_RESPONSE:
                            raise ProviderError('BYOK response exceeds the size limit.')
                    payload = json.loads(body)
                    content = payload['choices'][0]['message']['content']
                    if not isinstance(content, str) or not content.strip():
                        raise ProviderError('BYOK returned an empty text result.')
                    if self.model.api_key in content:
                        raise ProviderError('BYOK returned sensitive data.')
                    return content, payload.get('id')
        except (aiohttp.ClientError, TimeoutError, OSError):
            raise ProviderError('BYOK connection failed; verify billing before submitting again.') from None
        except (ValueError, KeyError, IndexError, TypeError):
            raise ProviderError('BYOK returned an invalid response.') from None

    async def status(self, _job):
        raise ProviderError('This synchronous provider offers no status API.')

    async def result(self, job):
        return job

    async def cancel(self, _job):
        raise ProviderError('This synchronous provider offers no cancellation API.')


class Mock:
    async def submit(self, prompt, kind):
        return {'id': str(uuid.uuid4()), 'kind': kind, 'prompt': prompt[:240]}

    async def status(self, job):
        return 'cancelled' if job.get('cancelled') else 'succeeded'

    async def result(self, job):
        if await self.status(job) == 'cancelled':
            raise ProviderError('Mock task cancelled.')
        if job['kind'] == 'text':
            return 'Mock: ' + job['prompt']
        return json.dumps({'provider': 'mock', 'kind': job['kind'], 'asset': 'mock:' + job['id'],
                           'status': 'succeeded'}, ensure_ascii=False)

    async def cancel(self, job):
        job['cancelled'] = True
