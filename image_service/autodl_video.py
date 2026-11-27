"""AutoDL workflow metadata, paid submissions and bounded MP4 downloads."""
import http.client
import json
import os
import re
from urllib.parse import urlsplit, urlunsplit

from .security import PinnedHTTPSConnection, Problem, https_request, public_addresses

ORIGIN = 'https://www.autodl.art'
API = ORIGIN + '/api/v1/comfyui'
CATALOG = ORIGIN + '/large-model/comfyui'
IDENTIFIER = re.compile(r'[A-Za-z0-9_-]{1,96}')
MAX_VIDEO_BYTES = 128 * 1024 * 1024
TYPES = {'string': 'text', 'str': 'text', 'text': 'text', 'int': 'integer',
         'integer': 'integer', 'float': 'number', 'number': 'number',
         'bool': 'boolean', 'boolean': 'boolean', 'enum': 'text'}


def workflow_id(value):
    if isinstance(value, str) and IDENTIFIER.fullmatch(value):
        return value
    if isinstance(value, str):
        match = re.fullmatch(r'https://(?:www\.)?autodl\.art/(?:large-model/comfyui|api/v1/comfyui/comfyui_workflow)/([A-Za-z0-9_-]{1,96})/?', value.strip())
        if match:
            return match[1]
    raise Problem(400, '请输入 AutoDL 工作流详情 URL 或工作流 ID。')


def links(identifier):
    return {'url': CATALOG + '/' + identifier, 'submitUrl': API + '/comfyui_workflow/' + identifier}


def decode(value):
    return json.loads(value) if isinstance(value, str) else value


def is_mp4(item):
    return isinstance(item, dict) and (
        str(item.get('file_type', '')).lower() in ('mp4', 'video/mp4')
        or str(item.get('type', '')).lower() == 'video'
        and urlsplit(str(item.get('url', ''))).path.lower().endswith('.mp4'))


def normalize(identifier, detail):
    """Keep official names and map reference fields to fixed image/audio slots."""
    try:
        title = detail.get('name') or detail.get('title')
        rules = decode(detail.get('input_rules'))
        example = decode(detail.get('output_example')) or {}
        outputs = (example.get('data') or example).get('results') or []
        if isinstance(rules, list):
            rules = {rule['name']: rule for rule in rules}
        if not isinstance(title, str) or not title.strip() or len(title) > 180:
            raise ValueError()
        if not isinstance(rules, dict) or not 1 <= len(rules) <= 40 or not any(map(is_mp4, outputs)):
            raise ValueError()
        fields = []
        occupied = {'image': set(), 'audio': set()}
        for name, rule in rules.items():
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}', name):
                raise ValueError()
            rule = {'type': rule} if isinstance(rule, str) else rule
            kind = TYPES.get(str(rule.get('type', '')).lower())
            reference = re.fullmatch(r'ref_(image|audio)_(\d+)', name)
            slot = None
            if reference:
                kind, slot = reference[1], int(reference[2])
            elif name in ('first_frame', 'last_frame'):
                kind, slot = 'image', int(name == 'last_frame')
            elif rule.get('type') in ('image', 'audio'):
                kind = rule['type']
                slot = next((index for index in range(9 if kind == 'image' else 3) if index not in occupied[kind]), None)
            if kind in occupied:
                if slot is None or slot >= (9 if kind == 'image' else 3) or slot in occupied[kind]:
                    raise ValueError()
                occupied[kind].add(slot)
            if not kind:
                if rule.get('required'):
                    raise ValueError()
                continue
            field = {'name': name, 'kind': kind, 'required': bool(rule.get('required'))}
            if slot is not None:
                field['slot'] = slot
            for key in ('min', 'max', 'min_length', 'max_length'):
                if type(rule.get(key)) in (int, float):
                    field[key] = rule[key]
            if kind not in occupied and type(rule.get('default')) in (str, int, float, bool):
                field['default'] = rule['default']
            for key in ('options', 'choices', 'enum'):
                options = rule.get(key)
                if isinstance(options, list) and options:
                    values = [item['value'] if isinstance(item, dict) and 'value' in item else item for item in options]
                    if len(values) > 100 or any(type(value) not in (str, int, float, bool) for value in values):
                        raise ValueError()
                    field['options'] = values
                    break
            fields.append(field)
        prompt = next((field for field in fields if field['name'] == 'prompt' and field['kind'] == 'text'), None)
        if not prompt:
            raise ValueError()
        prompt['required'] = True
        return {'id': identifier, 'title': title.strip(), 'fields': fields, **links(identifier)}
    except (AttributeError, KeyError, TypeError, ValueError) as error:
        raise Problem(422, '该工作流没有可核对的视频参数和 MP4 输出，或超出 9 图 / 3 音频范围。') from error


def validate_fields(schema, values):
    if not isinstance(values, dict) or set(values) - {field['name'] for field in schema}:
        raise Problem(400, '参数与工作流不匹配。')
    result = {}
    for field in schema:
        name, kind = field['name'], field['kind']
        if name not in values or values[name] == '':
            if field['required']:
                raise Problem(400, f'请填写 {name}。')
            if 'default' not in field:
                continue
            value = field['default']
        else:
            value = values[name]
        valid = (kind == 'text' and isinstance(value, str)
                 or kind in ('image', 'audio') and isinstance(value, str) and re.fullmatch(r'[a-f0-9]{32}', value)
                 or kind == 'integer' and type(value) is int
                 or kind == 'number' and type(value) in (int, float)
                 or kind == 'boolean' and type(value) is bool)
        if not valid or 'options' in field and value not in field['options']:
            raise Problem(400, f'{name} 的值无效。')
        if kind == 'text':
            value = value.strip()
            if not int(field.get('min_length', int(field['required']))) <= len(value) <= min(12000, int(field.get('max_length', 12000))):
                raise Problem(400, f'{name} 的文字长度无效。')
        if kind in ('integer', 'number') and not float(field.get('min', -2**53)) <= value <= float(field.get('max', 2**53)):
            raise Problem(400, f'{name} 超出可用范围。')
        result[name] = value
    return result


class AutoDL:
    def __init__(self, token):
        self.token = token

    def call(self, path, method='GET', body=None):
        headers = {'Accept': 'application/json'}
        if self.token:
            headers['Authorization'] = self.token
        if body is not None:
            headers['Content-Type'] = 'application/json'
        raw = https_request(API + path, method, json.dumps(body).encode() if body is not None else None,
                            headers, max_bytes=4_000_000, timeout=20)
        data = json.loads(raw)
        if isinstance(data, dict):
            if 'code' not in data:
                return data
            if str(data['code']).lower() in ('success', 'ok', '200') and isinstance(data.get('data'), dict):
                return data['data']
        raise Problem(502, 'AutoDL 响应无效，请检查工作流、令牌及余额。')

    def catalog(self):
        result = {}
        for item in self.call('/workflows', 'POST', {}).get('list', []):
            if not isinstance(item, dict):
                continue
            identifier, title = item.get('uuid'), item.get('name')
            if isinstance(identifier, str) and IDENTIFIER.fullmatch(identifier) and isinstance(title, str) and title.strip():
                result[identifier] = {'id': identifier, 'title': title, **links(identifier)}
        return list(result.values())

    def workflow(self, identifier):
        return normalize(identifier, self.call('/workflows/' + identifier))

    def submit(self, identifier, fields):
        task = self.call('/comfyui_workflow/' + identifier, 'POST', fields).get('task_id')
        if not isinstance(task, str) or not IDENTIFIER.fullmatch(task):
            raise Problem(502, 'AutoDL 未返回任务编号。')
        return task

    def result(self, task_id):
        return self.call('/comfyui_workflow/result/' + task_id)

    def download(self, url, destination):
        try:
            parsed = urlsplit(url)
            if not (parsed.scheme == 'https' and parsed.hostname and parsed.port in (None, 443)
                    and not (parsed.username or parsed.password or parsed.fragment)):
                raise ValueError()
            address = public_addresses(parsed.hostname, 443)[0]
            connection = PinnedHTTPSConnection(parsed.hostname, address, 25)
            try:
                connection.request('GET', urlunsplit(('', '', parsed.path or '/', parsed.query, '')))
                response = connection.getresponse()
                length = response.getheader('Content-Length')
                if response.status != 200 or length and not 8 <= int(length) <= MAX_VIDEO_BYTES:
                    raise ValueError()
                first = response.read(8)
                if len(first) != 8 or first[4:] != b'ftyp':
                    raise ValueError()
                size = len(first)
                with destination.open('wb') as output:
                    output.write(first)
                    while chunk := response.read(128 * 1024):
                        size += len(chunk)
                        if size > MAX_VIDEO_BYTES:
                            raise ValueError()
                        output.write(chunk)
                    if length and size != int(length):
                        raise ValueError()
                    output.flush()
                    os.fsync(output.fileno())
            finally:
                connection.close()
        except (ValueError, OSError, http.client.HTTPException) as error:
            raise Problem(502, 'AutoDL 视频暂时无法保存到硬盘。') from error
