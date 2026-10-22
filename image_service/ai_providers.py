"""Bounded, pinned transports. Adapters never accept browser supplied credentials."""
import http.client
import io
import ipaddress
import json
import os
import socket
import subprocess
import tempfile
import time
import wave
from contextlib import contextmanager
from urllib.parse import urlsplit

from .ai_security import AIProblem, fail, packed
from .security import PinnedHTTPSConnection, public_addresses

MAX_AUDIO = 50 * 1024 * 1024


class UnknownOutcome(Exception):
    """The request may have reached the provider; never automatically re-POST."""


def validate_base(endpoint, locality):
    if not isinstance(endpoint, str) or len(endpoint) > 500 or any(ord(c) <= 32 for c in endpoint):
        fail(422, 'INVALID_ENDPOINT', '请输入有效的模型服务地址。')
    try:
        url = urlsplit(endpoint)
        port = url.port
    except ValueError:
        fail(422, 'INVALID_ENDPOINT', '模型服务地址无效。')
    if not url.hostname or url.username or url.password or url.query or url.fragment or '..' in url.path or '%' in url.path:
        fail(422, 'INVALID_ENDPOINT', '地址不能包含凭据、查询参数或相对路径。')
    if locality == 'cloud':
        if url.scheme != 'https' or port not in (None, 443):
            fail(422, 'INVALID_ENDPOINT', '在线 API 必须使用标准 HTTPS。')
        public_addresses(url.hostname, 443)
    else:
        # A UI administrator cannot expand this deployment-level allowlist.
        allow = {v.rstrip('/') for v in os.environ.get('AI_LOCAL_ENDPOINTS', '').split(',') if v}
        if endpoint.rstrip('/') not in allow or url.scheme != 'http':
            fail(422, 'NODE_NOT_ALLOWED', '本地服务需先由运维登记到 AI_LOCAL_ENDPOINTS，并通过私有网络访问。')
        try:
            address = ipaddress.ip_address(url.hostname)
        except ValueError:
            fail(422, 'NODE_NOT_ALLOWED', '私有节点必须使用固定内网 IP，避免 DNS 重绑定。')
        tailscale = isinstance(address, ipaddress.IPv4Address) and address in ipaddress.ip_network('100.64.0.0/10')
        if not (address.is_private or address.is_loopback or tailscale) or address.is_link_local or address.is_unspecified or address.is_multicast:
            fail(422, 'NODE_NOT_ALLOWED', '该地址不是允许的私有节点。')
    return url


@contextmanager
def response(config, path, body=None, timeout=180):
    base = validate_base(config['endpoint'], config['locality'])
    if not path.startswith('/') or path.startswith('//') or any(c in path for c in ('\r', '\n', '#')):
        fail(502, 'INVALID_PROVIDER_RESPONSE', '模型返回的资源地址无效。')
    connection = (PinnedHTTPSConnection(base.hostname, public_addresses(base.hostname, 443)[0], timeout)
                  if config['locality'] == 'cloud' else http.client.HTTPConnection(base.hostname, base.port or 80, timeout=timeout))
    headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
    key = config.get('api_key', '')
    if key:
        headers['xi-api-key' if config['adapter'] == 'eleven' else 'Authorization'] = key if config['adapter'] == 'eleven' else 'Bearer ' + key
    try:
        connection.request('GET' if body is None else 'POST', base.path.rstrip('/') + path, body=None if body is None else packed(body).encode(), headers=headers)
        upstream = connection.getresponse()
        if upstream.status >= 500 or upstream.status in (408, 429):
            raise UnknownOutcome('上游暂不可用，正在核对请求结果。')
        if not 200 <= upstream.status < 300:
            fail(502, 'PROVIDER_REJECTED', '模型服务拒绝了请求，请检查模型配置和账号权限。')
        yield upstream
    except (OSError, http.client.HTTPException) as error:
        raise UnknownOutcome('模型请求中断，系统将核对结果。') from error
    finally:
        connection.close()


def request_json(config, path, body=None, timeout=180):
    with response(config, path, body, timeout=timeout) as upstream:
        raw = upstream.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        fail(502, 'INVALID_PROVIDER_RESPONSE', '模型响应过大。')
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError):
        fail(502, 'INVALID_PROVIDER_RESPONSE', '模型返回了无效响应。')


def eleven_payload(config, fields):
    result = {'model_id': config['model']}
    style = fields['prompt'] + ('; ' + ', '.join(fields['tags']) if fields.get('tags') else '')
    if fields['instrumental']:
        result.update(prompt=style, music_length_ms=fields['duration'] * 1000, force_instrumental=True)
    else:
        result['composition_plan'] = {
            'positive_global_styles': [style], 'negative_global_styles': [],
            'sections': [{'section_name': fields['title'] or 'Song', 'positive_local_styles': [],
                          'negative_local_styles': [], 'duration_ms': fields['duration'] * 1000,
                          'lines': fields['lyrics'].splitlines()}]}
        if fields.get('seed') is not None:
            result['seed'] = fields['seed']
    return result


def ace_payload(config, fields):
    result = {'model': config['model'], 'prompt': fields['prompt'] + '; ' + ', '.join(fields.get('tags', [])),
              'lyrics': '[Instrumental]' if fields['instrumental'] else fields['lyrics'],
              'audio_duration': fields['duration'], 'batch_size': 1}
    for source, target in [('bpm', 'bpm'), ('key', 'key_scale'), ('seed', 'seed')]:
        if fields.get(source) is not None:
            result[target] = fields[source]
    return result


class Providers:
    def check(self, config):
        if config['adapter'] == 'ollama':
            tags = request_json(config, '/api/tags', timeout=10)
            names = {v.get('name') for v in tags.get('models', []) if not v.get('remote_model') and not v.get('remote_host')}
            if config['model'] not in names or ':cloud' in config['model'].lower():
                fail(422, 'MODEL_NOT_LOCAL', '模型未安装在该节点，或该模型使用云端推理。')
        elif config['adapter'] == 'openai':
            data = request_json(config, '/v1/models' if not config['endpoint'].endswith('/v1') else '/models', timeout=10)
            if config['model'] not in {v.get('id') for v in data.get('data', [])}:
                fail(422, 'MODEL_NOT_FOUND', '模型列表中未找到配置的模型。')
        elif config['adapter'] == 'ace':
            request_json(config, '/health', timeout=10)
        elif config['adapter'] == 'eleven':
            request_json(config, '/v1/models', timeout=10)
        return {'ok': True, 'billable': False}

    def chat(self, config, messages):
        if config['adapter'] == 'ollama':
            yield from self.ollama_chat(config, messages)
            return
        base = '/chat/completions' if config['endpoint'].endswith('/v1') else '/v1/chat/completions'
        body = {'model': config['model'], 'messages': messages, 'stream': True,
                'max_tokens': config.get('max_output', 2048), 'stream_options': {'include_usage': True}}
        with response(config, base, body) as upstream:
            if 'text/event-stream' not in upstream.getheader('Content-Type', ''):
                fail(502, 'INVALID_PROVIDER_RESPONSE', '对话接口需要支持 SSE 流式响应。')
            total, deadline = 0, time.monotonic() + 600
            while True:
                line = upstream.readline(65537)
                total += len(line)
                if len(line) > 65536 or total > 2 * 1024 * 1024 or time.monotonic() > deadline:
                    fail(502, 'INVALID_PROVIDER_RESPONSE', '对话响应超过限制。')
                if not line:
                    raise UnknownOutcome('对话连接提前结束。')
                if not line.startswith(b'data:'):
                    continue
                raw = line[5:].strip()
                if raw == b'[DONE]':
                    return
                try:
                    data = json.loads(raw)
                    if data.get('usage'):
                        yield 'usage', data['usage']
                    for choice in data.get('choices', []):
                        delta = choice.get('delta', {}).get('content')
                        if isinstance(delta, str) and delta:
                            yield 'delta', delta
                except (ValueError, TypeError, AttributeError):
                    fail(502, 'INVALID_PROVIDER_RESPONSE', '模型流响应格式不正确。')

    def ollama_chat(self, config, messages):
        self.check(config)  # Verify the local model again immediately before use.
        body = {'model': config['model'], 'messages': messages, 'stream': True, 'keep_alive': 0,
                'options': {'num_predict': config.get('max_output', 2048), 'num_ctx': 16384}}
        with response(config, '/api/chat', body) as upstream:
            total, deadline = 0, time.monotonic() + 600
            while True:
                line = upstream.readline(65537)
                total += len(line)
                if not line:
                    raise UnknownOutcome('本地模型流提前结束。')
                if len(line) > 65536 or total > 2 * 1024 * 1024 or time.monotonic() > deadline:
                    raise UnknownOutcome('本地模型响应超出限制。')
                try:
                    data = json.loads(line)
                    if data.get('error'):
                        fail(502, 'PROVIDER_FAILED', '本地对话模型执行失败。')
                    delta = data.get('message', {}).get('content')
                    if isinstance(delta, str) and delta:
                        yield 'delta', delta
                    if data.get('done'):
                        yield 'usage', {'prompt_tokens': data.get('prompt_eval_count', 0), 'completion_tokens': data.get('eval_count', 0)}
                        return
                except (ValueError, TypeError, AttributeError):
                    fail(502, 'INVALID_PROVIDER_RESPONSE', '本地模型流响应格式不正确。')

    def start_music(self, config, fields):
        if config['adapter'] == 'ace':
            result = request_json(config, '/release_task', ace_payload(config, fields))
            task_id = result.get('data', {}).get('task_id')
            if not isinstance(task_id, str) or not 1 <= len(task_id) <= 200:
                raise UnknownOutcome('节点未返回任务编号，需要人工核对。')
            return {'remote_id': task_id}
        with response(config, '/v1/music', eleven_payload(config, fields), timeout=600) as upstream:
            data = upstream.read(MAX_AUDIO + 1)
        if len(data) > MAX_AUDIO:
            fail(502, 'AUDIO_TOO_LARGE', '生成音频超过50 MiB限制。')
        return {'audio': data}

    def poll_music(self, config, remote_id):
        result = request_json(config, '/query_result', {'task_id_list': [remote_id]})
        rows = result.get('data', [])
        item = next((v for v in rows if v.get('task_id') == remote_id), None)
        if not item or item.get('status') not in (1, 2):
            return None
        if item['status'] == 2:
            fail(502, 'PROVIDER_FAILED', '本地音乐节点生成失败。')
        files = item.get('result', [])
        if isinstance(files, str):
            files = json.loads(files)
        path = files[0].get('file', '') if isinstance(files, list) and files else ''
        # Only the documented audio endpoint of this exact registered node.
        base = config['endpoint'].rstrip('/')
        if path.startswith(base + '/'):
            path = path[len(base):]
        if not path.startswith('/v1/audio?path=') or '\\' in path:
            fail(502, 'INVALID_PROVIDER_RESPONSE', '节点返回了不受信任的音频地址。')
        with response(config, path) as upstream:
            audio = upstream.read(MAX_AUDIO + 1)
        if len(audio) > MAX_AUDIO:
            fail(502, 'AUDIO_TOO_LARGE', '生成音频超过50 MiB限制。')
        return {'audio': audio}


def inspect_audio(data):
    if not data or len(data) > MAX_AUDIO:
        fail(502, 'INVALID_AUDIO', '音频内容无效或超过50 MiB。')
    if data[:4] == b'RIFF' and data[8:12] == b'WAVE':
        try:
            with wave.open(io.BytesIO(data)) as audio:
                duration = audio.getnframes() / audio.getframerate()
                if not 1 <= audio.getnchannels() <= 8 or not 0 < duration <= 605:
                    raise ValueError()
                if len(audio.readframes(audio.getnframes())) < audio.getnframes() * audio.getnchannels() * audio.getsampwidth():
                    raise ValueError()
            return 'audio/wav', duration
        except (wave.Error, ValueError, ZeroDivisionError):
            fail(502, 'INVALID_AUDIO', 'WAV音频未通过完整性检查。')
    # Probe a private local file. No untrusted URL is handed to ffmpeg.
    with tempfile.NamedTemporaryFile(suffix='.audio') as handle:
        handle.write(data)
        handle.flush()
        try:
            result = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file', '-show_entries',
                                     'format=duration,format_name:stream=codec_type,codec_name', '-of', 'json', handle.name],
                                    capture_output=True, timeout=15, check=True)
            info = json.loads(result.stdout)
            duration = float(info['format']['duration'])
            formats = info['format']['format_name'].split(',')
            mime = 'audio/mpeg' if 'mp3' in formats else 'audio/flac' if 'flac' in formats else None
            if not mime or not 0 < duration <= 605 or not info.get('streams') or any(s['codec_type'] != 'audio' for s in info['streams']):
                raise ValueError()
            return mime, duration
        except (OSError, subprocess.SubprocessError, ValueError, KeyError):
            fail(502, 'INVALID_AUDIO', '音频未通过检查；服务器需安装 ffprobe。')
