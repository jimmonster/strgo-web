"""Build the additive portal from one public entry registry."""
import html
import json
import re
import shutil
from urllib.parse import urlparse


def load_registry(path):
    value = json.loads(path.read_text(encoding='utf-8'))
    seen = set()
    for entry in value['entries']:
        if not re.fullmatch(r'[A-Z]\d{2}', entry['id']) or entry['id'] in seen:
            raise ValueError('Duplicate or invalid portal entry ID')
        seen.add(entry['id'])
        if any(not isinstance(entry.get(key), str) or not entry[key] for key in
               ('name', 'en', 'group', 'route', 'description', 'type', 'access', 'symbol')):
            raise ValueError('Portal entry fields must be nonempty strings')
        route = entry['route']
        if not (route.startswith('/') and not route.startswith('//')) and not (entry['id'] == 'C05' and urlparse(route).scheme == 'https'):
            raise ValueError('Portal routes must be local, except Workflow')
        if any(c.isspace() or c in '<>"\'`\\' for c in route):
            raise ValueError('Unsafe portal route')
    for key, token in value['tokens'].items():
        if key in ('radius', 'spacing'):
            if type(token) is not int or not 0 <= token <= 64:
                raise ValueError('Invalid design dimension')
        elif not re.fullmatch(r'#[0-9a-fA-F]{6}', token):
            raise ValueError('Invalid design color')
    return value


def build_hub(root, output, config, context, replace):
    registry = load_registry(root / 'content/app-registry.json')
    variant = config['HOME_VARIANT']
    registry.update(homeVariant=variant, classicRoute='/classic/',
                    workflowOrigin=(config.get('WORKFLOW_ORIGIN') or 'https://workflow.strgo.com').rstrip('/') + '/')
    for entry in registry['entries']:
        if entry['route'].startswith('/#'):
            entry['route'] = '/classic/' + entry['route'][1:]
        elif entry['id'] == 'N07':
            entry['route'] = '/classic/'
        elif entry['id'] == 'C05':
            entry['route'] = registry['workflowOrigin']
        elif entry['id'] == 'C04':
            entry['route'] = config.get('TERMINAL_TARGET_URL') or '/terminal/'
    for directory in ('hub', 'shared'):
        destination = output / directory
        if destination.exists(): shutil.rmtree(destination)
        shutil.copytree(root / 'src' / directory, destination)
    serialized = json.dumps(registry, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    (output / 'hub/registry.js').write_text('window.STRGO = ' + serialized + ';\n', encoding='utf-8')
    (output / 'hub/registry.json').write_text(serialized + '\n', encoding='utf-8')
    tokens = ';'.join('--strgo-' + key + ':' + (str(value) + 'px' if isinstance(value, int) else value)
                      for key, value in registry['tokens'].items())
    (output / 'hub/tokens.css').write_text(':root{' + tokens + '}\n', encoding='utf-8')
    template = (root / 'src/hub/index.html').read_text(encoding='utf-8')
    for route in ['hub', 'ai/tasks', 'ai/assets', *([''] if variant == 'hub' else [])]:
        context['hub_canonical'] = html.escape(context['origin'] + '/' + (route + '/' if route else ''), quote=True)
        page = re.sub(r'\{\{([a-z_]+)\}\}', replace, template)
        if route.startswith('ai/'):
            page = page.replace('</head>', '<meta name="robots" content="noindex,nofollow">\n</head>')
        (output / route / 'index.html').write_text(page, encoding='utf-8')
    # Existing experiences keep their layout and runtime. The switcher mounts
    # only where a source template explicitly provides its inline slot.
    script = '<script type="module" src="/shared/site-navigation.js?v=' + context['asset_version'] + '"></script>'
    for page in output.rglob('*.html'):
        source = page.read_text(encoding='utf-8')
        if '<strgo-navigation' in source and '/shared/site-navigation.js' not in source:
            page.write_text(source.replace('</body>', script + '\n</body>'), encoding='utf-8')
