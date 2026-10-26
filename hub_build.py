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
    (output / 'shared/registry.json').write_text(serialized + '\n', encoding='utf-8')
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
    script = '<script type="module" src="/shared/site-navigation.js?v=' + context['asset_version'] + '"></script>'
    for name in ('dreams', 'nexus'):
        shutil.copytree(output / 'shared', output / name / '_strgo', dirs_exist_ok=True)
        shutil.copy2(output / 'hub/tokens.css', output / name / '_strgo/tokens.css')
    for page in list(output.rglob('*.html')):
        source = page.read_text(encoding='utf-8')
        route = page.relative_to(output).as_posix()
        tool = route.startswith(('ai/', 'admin/', 'forum/', 'image-playground/', 'local-studio/'))
        experience = route.startswith(('home/', 'dance/', 'dreams/', 'nexus/', 'archive/'))
        surface = 'tool' if tool else 'experience' if experience else 'hub' if route.startswith('hub/') or variant == 'hub' and route == 'index.html' else 'classic'
        source = source.replace('<html ', '<html data-strgo-ui="' + surface + '" ', 1)
        styles = '<link rel="stylesheet" href="/shared/design-system.css?v=' + context['asset_version'] + '">'
        if '/hub/tokens.css' not in source:
            styles = '<link rel="stylesheet" href="/hub/tokens.css?v=' + context['asset_version'] + '">' + styles
        source = source.replace('</head>', styles + '\n</head>')
        if experience and '<strgo-navigation' not in source:
            source = source.replace('</body>', '<script type="module" src="/shared/experience-navigation.js"></script>\n</body>')
        if route == 'admin/index.html' and '<strgo-navigation' not in source:
            source = source.replace('<span id="account">', '<strgo-navigation></strgo-navigation><span id="account">')
        if '<strgo-navigation' in source and '/shared/site-navigation.js' not in source:
            source = source.replace('</body>', script + '\n</body>')
        if route.startswith(('dreams/', 'nexus/')):
            prefix = '/' + route.split('/')[0] + '/_strgo/'
            source = source.replace('/hub/tokens.css', prefix + 'tokens.css').replace('/shared/', prefix)
        # Workflow is also deployed as a standalone origin with an independent
        # account cookie. Bundle its chrome and keep navigation session-free.
        if route == 'local-studio/index.html':
            shared = output / 'local-studio/_strgo'
            shutil.copytree(output / 'shared', shared, dirs_exist_ok=True)
            shutil.copy2(output / 'hub/tokens.css', shared / 'tokens.css')
            workflow_registry = json.loads(serialized)
            workflow_registry['navigationOrigin'] = context['origin']
            for entry in workflow_registry['entries']:
                if entry['route'].startswith('/'):
                    entry['route'] = context['origin'] + entry['route']
            (shared / 'registry.json').write_text(json.dumps(workflow_registry, ensure_ascii=False), encoding='utf-8')
            source = source.replace('/hub/tokens.css', './_strgo/tokens.css').replace('/shared/design-system.css', './_strgo/design-system.css')
            source = source.replace('</body>', '<strgo-navigation class="strgo-space-navigation" data-session="none"></strgo-navigation><script type="module" src="./_strgo/site-navigation.js"></script>\n</body>')
        page.write_text(source, encoding='utf-8')
