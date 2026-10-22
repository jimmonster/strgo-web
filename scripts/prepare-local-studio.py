"""Prepare private, sanitized API workflows from this PC's existing H3/Qwen files."""
import argparse
import copy
import json
from pathlib import Path
import os
import secrets


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def api_graph(document):
    if 'nodes' not in document:
        if not document or not all(isinstance(node, dict) and 'class_type' in node and isinstance(node.get('inputs'), dict) for node in document.values()):
            raise ValueError('Expected an API graph')
        return copy.deepcopy(document)
    links = {item[0]: item for item in document['links']}
    graph = {}
    for node in document['nodes']:
        if node['type'] in ('Note', 'MarkdownNote'):
            continue
        if node.get('mode', 0) != 0:
            raise ValueError('Export bypassed/muted workflows through ComfyUI instead')
        named = node.get('widgets_values_named', {})
        inputs = {}
        for item in node.get('inputs', []):
            name = item['name']
            if item.get('link') is not None:
                link = links[item['link']]
                inputs[name] = [str(link[1]), link[2]]
            elif item.get('widget') and item.get('type') not in ('IMAGEUPLOAD', 'VIDEOUPLOAD', 'AUDIOUPLOAD'):
                if name not in named:
                    raise ValueError('Missing named widget values; export this workflow in API format')
                inputs[name] = named[name]
        graph[str(node['id'])] = {'class_type': node['type'], 'inputs': inputs}
    return graph


def without_reference(graph):
    graph = copy.deepcopy(graph)
    removed = {key for key, node in graph.items() if node['class_type'] == 'LoadImage'}
    for key in removed:
        del graph[key]
    for node in graph.values():
        node['inputs'] = {key: value for key, value in node['inputs'].items() if not (isinstance(value, list) and value and value[0] in removed)}
    return graph


def prepare(ai_root, destination):
    if destination.exists():
        raise ValueError('Destination already exists; choose a new directory to preserve local settings')
    source = ai_root / 'ComfyUI_windows_portable/ComfyUI/user/default/workflows/Qwen-Image-2.1-Reference-Image.json'
    qwen = api_graph(read(source))
    h3 = api_graph(read(ai_root / 'yz-h3-3080/reference-360p-5s-api.json'))
    h3_long = api_graph(read(ai_root / 'yz-h3-3080/reference-360p-12s-api.json'))
    specs = []
    entries = [
        ('qwen21-text', 'Qwen-Image-2.1 · 文生图', 'image', without_reference(qwen), False, '本机 Qwen-Image-2.1，沿用现有图片参数。'),
        ('qwen21-reference', 'Qwen-Image-2.1 · 参考图', 'image', qwen, True, '一张参考图片，沿用本机已适配的 Qwen 工作流。'),
        ('h3-text-5s', 'MiniMax H3 · 文生视频 · 约 5 秒', 'video', without_reference(h3), False, '640 × 352，124 帧，原生音视频，本机 3080 预设。'),
        ('h3-reference-5s', 'MiniMax H3 · 参考图视频 · 约 5 秒', 'video', h3, True, '640 × 352，124 帧，使用一张参考图片。'),
        ('h3-reference-12s', 'MiniMax H3 · 参考图视频 · 约 12 秒', 'video', h3_long, True, '640 × 352，294 帧，使用一张参考图片。'),
    ]
    prepared = []
    for key, label, kind, graph, reference, description in entries:
        graph = copy.deepcopy(graph)
        prompt_id = next(k for k, n in graph.items() if n['class_type'] == ('TextEncodeQwenImage21' if kind == 'image' else 'MiniMaxH3ReferenceToVideo'))
        seed_id = next(k for k, n in graph.items() if n['class_type'] == ('KSampler' if kind == 'image' else 'RandomNoise'))
        output = next(k for k, n in graph.items() if n['class_type'] == ('SaveImageAdvanced' if kind == 'image' else 'SaveVideo'))
        bindings = {'prompt': [prompt_id, 'prompt'], 'seed': [seed_id, 'seed' if kind == 'image' else 'noise_seed'], 'outputPrefix': [output, 'filename_prefix']}
        graph[prompt_id]['inputs']['prompt'] = ''
        if kind == 'image':
            graph[prompt_id]['inputs']['negative_prompt'] = ''
        if reference:
            reference_id = next(k for k, n in graph.items() if n['class_type'] == 'LoadImage')
            bindings['reference'] = [reference_id, 'image']
            graph[reference_id]['inputs']['image'] = 'reference.png'
        graph[output]['inputs']['filename_prefix'] = 'strgo-workflow/result'
        graph[seed_id]['inputs'][bindings['seed'][1]] = 0
        filename = key + '.api.json'
        prepared.append((filename, graph))
        specs.append({'id': key, 'label': label, 'description': description, 'kind': kind, 'file': filename, 'output': output, 'bindings': bindings})
    destination.mkdir(parents=True, mode=0o700)
    for filename, graph in prepared:
        (destination / filename).write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding='utf-8')
    (destination / 'worker.json').write_text(json.dumps({'timeoutSeconds': 7200, 'workflows': specs}, ensure_ascii=False, indent=2), encoding='utf-8')
    credential = destination / '.env'
    credential.write_text('LOCAL_STUDIO_WORKER_TOKEN=' + secrets.token_urlsafe(48) + '\n', encoding='utf-8')
    os.chmod(credential, 0o600)
    return specs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ai-root', type=Path, default=Path('D:/soft/ai'))
    parser.add_argument('--output', type=Path, default=Path('.local-studio'))
    args = parser.parse_args()
    specs = prepare(args.ai_root, args.output)
    print(json.dumps({'prepared': len(specs), 'config': str((args.output / 'worker.json').resolve())}))


if __name__ == '__main__':
    main()
