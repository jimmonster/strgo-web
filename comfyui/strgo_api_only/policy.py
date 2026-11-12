"""The execution allowlist is deliberately narrower than the native node catalog."""
from dataclasses import dataclass
import hashlib
import json
import re
import uuid

OFFICIAL = 'OpenAIChatNode'
OFFICIAL_CONFIG = 'OpenAIChatConfig'
TEXT = 'StrgoText'
IMAGE = 'StrgoMockImage'
VIDEO = 'StrgoMockVideo'
DISPLAY = 'StrgoDisplay'
SAFE_NODES = {OFFICIAL, OFFICIAL_CONFIG, TEXT, IMAGE, VIDEO, DISPLAY}
NODE_ID = re.compile(r'[1-9][0-9]{0,7}')
OFFICIAL_MODEL = 'gpt-4.1-nano'


class Rejected(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Plan:
    graph: dict
    route: str
    model: str
    digest: str
    node_count: int


def uuid4(value):
    try:
        parsed = uuid.UUID(value, version=None)
    except (ValueError, AttributeError, TypeError):
        return None
    return str(parsed) if parsed.version == 4 and str(parsed) == value else None


def bounded_text(value, limit=4096):
    return isinstance(value, str) and 0 < len(value.encode('utf-8')) <= limit and '\x00' not in value


def compile_graph(graph):
    if not isinstance(graph, dict) or not 2 <= len(graph) <= 12:
        raise Rejected('A workflow requires 2–12 allowed nodes.')
    cleaned = {}
    outputs = []
    routes = []
    for node_id, node in graph.items():
        if not isinstance(node_id, str) or not NODE_ID.fullmatch(node_id) or not isinstance(node, dict):
            raise Rejected('Invalid node ID or definition.')
        if set(node) - {'class_type', 'inputs', '_meta'}:
            raise Rejected('Unexpected node fields.')
        kind, inputs = node.get('class_type'), node.get('inputs')
        if not isinstance(kind, str) or kind not in SAFE_NODES or not isinstance(inputs, dict):
            raise Rejected('This node is unavailable in API-only mode.')
        inputs = dict(inputs)
        cleaned[node_id] = {'class_type': kind, 'inputs': inputs}
        if kind == DISPLAY:
            if set(inputs) != {'value'}:
                raise Rejected('STRGO Display requires one linked input.')
            outputs.append(node_id)
        elif kind == TEXT:
            if set(inputs) != {'selection', 'prompt'} or not bounded_text(inputs.get('prompt')):
                raise Rejected('STRGO Text requires a server-listed model and a bounded prompt.')
            selection = inputs.get('selection')
            if not isinstance(selection, str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,31}:[a-z][a-z0-9_-]{0,63}', selection):
                raise Rejected('Invalid provider or model selection.')
            routes.append(tuple(selection.split(':', 1)))
        elif kind in (IMAGE, VIDEO):
            if set(inputs) != {'prompt'} or not isinstance(inputs.get('prompt'), (str, list)):
                raise Rejected('Mock asset nodes require a text input.')
            if isinstance(inputs['prompt'], str) and not bounded_text(inputs['prompt']):
                raise Rejected('Invalid mock prompt.')
            routes.append(('mock', 'image' if kind == IMAGE else 'video'))
        elif kind == OFFICIAL:
            if (set(inputs) - {'prompt', 'model', 'persist_context', 'advanced_options'}
                    or not bounded_text(inputs.get('prompt')) or inputs.get('model') != OFFICIAL_MODEL
                    or inputs.get('persist_context', False) is not False):
                raise Rejected('The official route supports gpt-4.1-nano text with bounded output.')
            routes.append(('official', OFFICIAL_MODEL))
        elif (set(inputs) - {'truncation', 'max_output_tokens', 'instructions'} or
              inputs.get('truncation') != 'disabled' or type(inputs.get('max_output_tokens')) is not int
              or not 16 <= inputs['max_output_tokens'] <= 1024
              or inputs.get('instructions', '') != ''):
            raise Rejected('Official text output must be capped at 1024 tokens.')

    if len(outputs) != 1 or not routes:
        raise Rejected('Use one STRGO Display and at least one generation node.')
    route, model = routes[0]
    if (route == 'mock' and any(item[0] != 'mock' for item in routes)) or (route != 'mock' and len(routes) != 1):
        raise Rejected('Select one provider route per paid execution.')
    if any(node['class_type'] == OFFICIAL_CONFIG for node in cleaned.values()) and route != 'official':
        raise Rejected('Official configuration requires an official route.')

    visited = set()
    visiting = set()

    def visit(node_id):
        if node_id in visiting:
            raise Rejected('Cyclic workflows are unavailable.')
        if node_id in visited:
            return
        visiting.add(node_id)
        node = cleaned[node_id]
        for name, value in node['inputs'].items():
            must_link = node['class_type'] == DISPLAY or name == 'advanced_options'
            if not isinstance(value, list) and not must_link:
                continue
            if (not isinstance(value, list) or len(value) != 2 or not isinstance(value[0], str)
                    or type(value[1]) is not int or value[1] != 0 or value[0] not in cleaned):
                raise Rejected('Invalid workflow connection.')
            target = cleaned[value[0]]['class_type']
            if ((name == 'advanced_options') != (target == OFFICIAL_CONFIG)) or target == DISPLAY:
                raise Rejected('Incompatible workflow connection.')
            visit(value[0])
        visiting.remove(node_id)
        visited.add(node_id)

    visit(outputs[0])
    if len(visited) != len(cleaned):
        raise Rejected('Remove the unused branch before submitting.')
    if route == 'official':
        official = next(node for node in cleaned.values() if node['class_type'] == OFFICIAL)
        if 'advanced_options' not in official['inputs']:
            raise Rejected('Add an official text output limit before submitting.')
    encoded = json.dumps(cleaned, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    return Plan(cleaned, route, model, hashlib.sha256(encoded).hexdigest(), len(cleaned))
