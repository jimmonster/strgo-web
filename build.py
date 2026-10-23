#!/usr/bin/env python3
"""Build a self-contained static site, with no network or npm required for preview."""
import argparse
import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
from urllib.parse import quote, urlparse
from zoneinfo import ZoneInfo
from content_build import load_content, render_spaces, render_projects, render_author, render_recent, story_body, updates_body

ROOT = Path(__file__).resolve().parent
VENDORS = ('gsap.min.js', 'ScrollTrigger.min.js', 'lenis.min.js', 'confetti.min.js')

def validate(config):
    if config.get('HOME_VARIANT', 'classic') not in ('classic', 'hub'):
        raise ValueError('HOME_VARIANT must be classic or hub')
    for name in ('name', 'domain', 'description', 'about'):
        if not isinstance(config.get(name), str) or not config[name].strip():
            raise ValueError(f'{name} must be a nonempty string')
    if not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', config['domain']):
        raise ValueError('domain must be a plain hostname')
    if config.get('scheme', 'http') not in ('http', 'https'):
        raise ValueError('scheme must be http or https')
    for name in ('BASE_ORIGIN', 'TERMINAL_TARGET_URL', 'WORKFLOW_ORIGIN'):
        value = config.get(name, '')
        if not isinstance(value, str):
            raise ValueError(f'{name} must be a string')
        if not value: continue
        parsed = urlparse(value)
        relative = name == 'TERMINAL_TARGET_URL' and value.startswith('/') and not value.startswith('//')
        if any(ch.isspace() or ord(ch) < 32 or ch in '<>"\'`' for ch in value) or '\\' in value or (not relative and (parsed.scheme not in ('http', 'https') or not parsed.hostname)) or parsed.username or parsed.password:
            raise ValueError(f'{name} must be an HTTP(S) URL' + (' or an absolute site path' if name == 'TERMINAL_TARGET_URL' else ''))
        try: parsed.port
        except ValueError: raise ValueError(f'{name} has an invalid port')
        if name in ('BASE_ORIGIN', 'WORKFLOW_ORIGIN') and (parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise ValueError(name + ' must contain only scheme and hostname')
    if config.get('email') and not re.fullmatch(r'[^\s<>@?]+@[^\s<>@?]+\.[^\s<>@?]+', config['email']):
        raise ValueError('email must be a plain email address')
    github = config.get('github')
    if github:
        parsed = urlparse(github)
        if parsed.scheme != 'https' or parsed.netloc != 'github.com' or parsed.query or parsed.fragment or not re.fullmatch(r'/[a-zA-Z0-9-]+/?', parsed.path):
            raise ValueError('github must be a GitHub profile URL')
    ZoneInfo(config.get('timezone') or 'Asia/Shanghai')
    if config.get('contributions') is not None:
        data = config['contributions']
        if not isinstance(data, list) or len(data) != 196 or any(type(v) is not int or not 0 <= v <= 4 for v in data):
            raise ValueError('contributions must have 196 integer levels between 0 and 4')
    for name in ('icp_number', 'city', 'coordinates'):
        if name in config and not isinstance(config[name], str):
            raise ValueError(f'{name} must be a string')
    return config

def bundle(entry):
    """Bundle this project's static named-import modules into a file://-safe classic script.

    Limited deliberately to named and namespace imports and declaration/list exports.
    Unsupported syntax fails the build instead of silently producing a broken bundle.
    """
    modules, visiting, definitions = {}, set(), []
    pattern = re.compile(r'^import\s+(\{[^}]+\}|\*\s+as\s+\w+)\s+from\s+[\'"]([^\'"]+)[\'"];?\s*$', re.M)
    def visit(filename):
        filename = filename.resolve()
        if filename in modules:
            return modules[filename]
        if filename in visiting:
            raise ValueError('Circular module import')
        if not filename.is_relative_to((ROOT / 'src').resolve()):
            raise ValueError('Import escapes the source directory')
        visiting.add(filename)
        source = filename.read_text(encoding='utf-8')
        bindings = []
        for match in pattern.finditer(source):
            binding, relative = match.groups()
            dependency = visit(filename.parent / relative)
            if binding.startswith('*'):
                bindings.append(f'const {binding.split()[-1]} = {dependency};')
            else:
                binding = re.sub(r'\b(\w+)\s+as\s+(\w+)\b', r'\1: \2', binding)
                bindings.append(f'const {binding} = {dependency};')
        source = pattern.sub('', source)
        exported = []
        for match in re.finditer(r'^export\s+(?:async\s+)?(?:class|function|const|let)\s+(\w+)', source, re.M):
            exported.append(match.group(1))
        def export_list(match):
            for item in match.group(1).split(','):
                item = item.strip()
                if not item: continue
                parts = item.split(' as ')
                exported.append(parts[1] + ': ' + parts[0] if len(parts) == 2 else item)
            return ''
        source = re.sub(r'^export\s*\{([^}]+)\};?\s*$', export_list, source, flags=re.M)
        source = re.sub(r'^export\s+', '', source, flags=re.M)
        if re.search(r'^\s*(?:import|export)\s', source, re.M):
            raise ValueError(f'Unsupported module syntax in {filename}')
        name = f'__module_{len(modules)}'
        modules[filename] = name
        definitions.append(f'const {name} = (() => {{\n' + '\n'.join(bindings) + '\n' + source + '\nreturn {' + ', '.join(exported) + '};\n})();\n')
        visiting.remove(filename)
        return name
    visit(entry)
    return '/* STRGO offline module bundle. Three.js MIT license: assets/vendor/THREE-LICENSE.txt */\n(() => {\n"use strict";\n' + '\n'.join(definitions) + '\n})();\n'

def build(config_path=ROOT / 'site.json', output=ROOT / 'dist', scheme=None, require_vendor=False, content_path=ROOT / 'content/site-content.json', home_variant=None):
    config = json.loads(Path(config_path).read_text(encoding='utf-8'))
    if scheme: config['scheme'] = scheme
    if home_variant: config['HOME_VARIANT'] = home_variant
    config.setdefault('HOME_VARIANT', 'classic')
    validate(config)
    content = load_content(content_path)
    # Only the dialog's public fields are shipped to the browser. Draft story
    # material and internal editorial notes never enter the built site.
    config['projects'] = [{key: project[key] for key in ('id', 'name', 'category', 'description', 'tags', 'storyPath', 'experience', 'secondaryExperience')} for project in content['projects']]
    vendor_path = ROOT / 'src/assets/vendor'
    missing = [name for name in VENDORS if not (vendor_path / name).is_file()]
    if require_vendor and missing:
        raise ValueError('Production libraries missing: ' + ', '.join(missing) + '. Run npm install and npm run prepare:vendor.')
    # Treat GSAP, ScrollTrigger and Lenis as one integration unit.
    enabled = list(VENDORS[:3]) if not any(name in missing for name in VENDORS[:3]) else []
    if VENDORS[3] not in missing: enabled.append(VENDORS[3])
    compiled = bundle(ROOT / 'src/main.js')
    digest = hashlib.sha256(compiled.encode())
    digest.update(Path(content_path).read_bytes())
    digest.update((ROOT / 'content/app-registry.json').read_bytes())
    for directory in ('hub', 'shared'):
        for asset in sorted((ROOT / 'src' / directory).rglob('*')):
            if asset.is_file(): digest.update(asset.read_bytes())
    digest.update(json.dumps(config, ensure_ascii=False, sort_keys=True).encode())
    for template_path in sorted((ROOT / 'src').rglob('*.html')):
        digest.update(template_path.read_bytes())
    for asset in sorted((ROOT / 'src/assets').rglob('*')):
        if asset.is_file(): digest.update(asset.read_bytes())
    for asset in sorted((ROOT / 'src/dreams').rglob('*')):
        if asset.is_file(): digest.update(asset.read_bytes())
    for asset in sorted((ROOT / 'src/image-playground').rglob('*')):
        if asset.is_file(): digest.update(asset.read_bytes())
    for asset in sorted((ROOT / 'src/forum').rglob('*')):
        if asset.is_file(): digest.update(asset.read_bytes())
    for asset in sorted((ROOT / 'src/local-studio').rglob('*')):
        if asset.is_file(): digest.update(asset.read_bytes())
    for asset in sorted((ROOT / 'src/ai-workspace').rglob('*')):
        if asset.is_file(): digest.update(asset.read_bytes())
    version = digest.hexdigest()[:12]
    origin = config.get('BASE_ORIGIN', '').rstrip('/') or f"{config.get('scheme', 'http')}://{config['domain']}"
    if scheme: origin = re.sub(r'^https?:', scheme + ':', origin)
    if config.get('BASE_ORIGIN'): config['BASE_ORIGIN'] = origin
    context = {key: html.escape(value, quote=True) for key, value in config.items() if isinstance(value, str)}
    context.update(origin=origin, year=str(datetime.datetime.now(datetime.timezone.utc).year), asset_version=version)
    context.update(render_spaces(content))
    context.update(render_author(content, config))
    context.update(project_cards=render_projects(content), recent_updates=render_recent(content))
    context['site_config'] = json.dumps(config, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    context['vendor_scripts'] = '\n  '.join(f'<script src="./assets/vendor/{name}?v={version}" defer></script>' for name in enabled)
    links = []
    if config.get('email'): links.append(f'<a href="mailto:{quote(config["email"], safe="@.+-")}">EMAIL ↗</a>')
    if config.get('github'): links.append(f'<a href="{html.escape(config["github"], quote=True)}" target="_blank" rel="noopener noreferrer">GITHUB ↗</a>')
    context['contact_links'] = ''.join(links)
    context['contact_caption'] = html.escape(f'点击复制邮箱 · {config["email"]}' if config.get('email') else '点击复制小站地址')
    context['icp_link'] = f'<a class="icp-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{html.escape(config.get("icp_number", ""))}</a>' if config.get('icp_number') else ''
    template = (ROOT / 'src/index.html').read_text(encoding='utf-8')
    def replace(match):
        if match.group(1) not in context: raise ValueError('Unknown placeholder: ' + match.group(1))
        return context[match.group(1)]
    page = re.sub(r'\{\{([a-z_]+)\}\}', replace, template)
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / 'src/assets', output / 'assets', dirs_exist_ok=True)
    (output / 'assets/main.js').write_text(compiled, encoding='utf-8')
    (output / 'index.html').write_text(page, encoding='utf-8')
    classic = output / 'classic'
    classic.mkdir(exist_ok=True)
    classic_page = page.replace('="./assets/', '="/assets/')
    classic_page = classic_page.replace(f'rel="canonical" href="{origin}/"', f'rel="canonical" href="{origin}/classic/"')
    (classic / 'index.html').write_text(classic_page, encoding='utf-8')
    # Real directory indexes work with the existing Nginx try_files and simple
    # static hosts, including direct visits, reloads and browser history.
    scene_template = (ROOT / 'src/pages/scene.html').read_text(encoding='utf-8')
    home_controls = '''<div class="scene-dock" role="group" aria-label="卧室视角"><span class="dock-note">EXPLORE THE EVERYDAY</span><button type="button" data-view="room" aria-pressed="true">卧室全景</button><button type="button" data-view="garden" aria-pressed="false">阳台与花园</button><span class="dock-divider"></span><button type="button" data-action="reset-view">↺ 重置视角</button></div>'''
    dance_controls = '''<div class="scene-dock performance-dock" role="group" aria-label="表演控制"><div class="show-readout"><p id="show-section">01 · GROOVE / 律动开场</p><div><span id="show-time">00 / 48 SEC</span><progress id="show-progress" max="48" value="0" aria-label="表演进度"></progress></div></div><button type="button" data-action="play" aria-pressed="false">Ⅱ 暂停</button><button type="button" data-action="restart">↺ 重置表演</button><button type="button" data-action="reset-view">重置视角</button><button type="button" data-action="auto" aria-pressed="true">自动运镜 · 开</button></div>'''
    for route, title, english, description, eyebrow, coordinate, caption, controls in [
        ('home', '日光卧室', 'A slower kind of morning.', '窗边的日光，桌上的灵感，还有一整片绿意。', 'PERSONAL SPACE / DAYLIGHT STUDY', 'DAYLIGHT / WARM & QUIET\nSCENE 01 — A PLACE TO BE', '把日常，安放在阳光里。', home_controls),
        ('dance', '舞蹈舞台', 'After hours, we move.', '八个人，同一个节拍。让身体与光一起进入律动。', 'MOVEMENT STUDY / LIVE IN 3D', '8 DANCERS / 120 BPM\n48 SEC — INFINITE LOOP', '四段编舞 · 一个共同的节拍。', dance_controls)
    ]:
        context.update(scene_mode=route, scene_title=title, scene_english=english, scene_description=description,
            scene_eyebrow=eyebrow, scene_coordinate=coordinate, scene_caption=caption, scene_controls=controls,
            scene_color='#e5e8dc' if route == 'home' else '#0b101a', scene_index='01' if route == 'home' else '02',
            home_current='aria-current="page"' if route == 'home' else '', dance_current='aria-current="page"' if route == 'dance' else '',
            canvas_description='可拖动旋转、缩放的三维卧室，包含电脑、床、阳台和窗外花园' if route == 'home' else '八名三维人物在有灯光的舞台上跳舞，可拖动调整观看视角')
        (output / route).mkdir(exist_ok=True)
        (output / route / 'index.html').write_text(re.sub(r'\{\{([a-z_]+)\}\}', replace, scene_template), encoding='utf-8')
    # Self-contained directory route; relative resources stay under /nexus/.
    nexus_source = ROOT / 'src/nexus'
    nexus_files = ('index.html', 'src/app.js', 'src/shaders.js', 'styles/main.css', 'assets/three.module.js')
    if not all((nexus_source / name).is_file() for name in nexus_files):
        raise ValueError('NEXUS route source is incomplete; restore src/nexus before publishing.')
    shutil.copytree(nexus_source, output / 'nexus', dirs_exist_ok=True)
    nexus_page = (output / 'nexus/index.html').read_text(encoding='utf-8')
    nexus_page = nexus_page.replace('</head>', f'<link rel="canonical" href="{html.escape(origin, quote=True)}/nexus/">\n</head>')
    (output / 'nexus/index.html').write_text(nexus_page, encoding='utf-8')
    dream_source = ROOT / 'src/dreams'
    dream_entries = ['index.html', *[f'{number:02d}/index.html' for number in range(1, 9)]]
    dream_required = dream_entries + ['404.html', 'src/app.js', 'src/renderer.js', 'src/water.js', 'src/pond.js', 'assets/vendor/three.module.js', 'styles/main.css']
    if not all((dream_source / name).is_file() for name in dream_required):
        raise ValueError('DREAMS route source is incomplete; build /root/dreams and run node scripts/sync-strgo.mjs there before publishing.')
    # Replace this route as a whole, so removed assets cannot linger in a build.
    if (output / 'dreams').exists():
        shutil.rmtree(output / 'dreams')
    shutil.copytree(dream_source, output / 'dreams')
    dream_paths = []
    for name in dream_entries:
        route = '/dreams/' + name.removesuffix('index.html')
        dream_paths.append(route)
        page_path = output / 'dreams' / name
        dream_page = page_path.read_text(encoding='utf-8')
        dream_page = dream_page.replace('</head>', f'<link rel="canonical" href="{html.escape(origin + route, quote=True)}">\n</head>')
        page_path.write_text(dream_page, encoding='utf-8')
    (output / 'terminal').mkdir(exist_ok=True)
    (output / 'terminal/index.html').write_text(re.sub(r'\{\{([a-z_]+)\}\}', replace, (ROOT / 'src/pages/terminal.html').read_text(encoding='utf-8')), encoding='utf-8')
    image_source = ROOT / 'src/image-playground'
    if (output / 'image-playground').exists():
        shutil.rmtree(output / 'image-playground')
    shutil.copytree(image_source, output / 'image-playground')
    image_page = output / 'image-playground/index.html'
    image_page.write_text(image_page.read_text(encoding='utf-8').replace('{{origin}}', html.escape(origin, quote=True)), encoding='utf-8')
    forum_output = output / 'forum'
    if forum_output.exists():
        shutil.rmtree(forum_output)
    shutil.copytree(ROOT / 'src/forum', forum_output)
    forum_page = forum_output / 'index.html'
    forum_page.write_text(forum_page.read_text(encoding='utf-8').replace('{{origin}}', html.escape(origin, quote=True)), encoding='utf-8')
    studio_output = output / 'local-studio'
    if studio_output.exists():
        shutil.rmtree(studio_output)
    shutil.copytree(ROOT / 'src/local-studio', studio_output)
    studio_page = studio_output / 'index.html'
    studio_page.write_text(studio_page.read_text(encoding='utf-8').replace('{{workflow_origin}}', html.escape((config.get('WORKFLOW_ORIGIN') or 'https://workflow.strgo.com').rstrip('/'), quote=True)), encoding='utf-8')
    shutil.copy2(ROOT / 'src/image-playground/reference-image.js', studio_output / 'reference-image.js')
    admin_output = output / 'admin'
    if admin_output.exists():
        shutil.rmtree(admin_output)
    shutil.copytree(ROOT / 'src/admin', admin_output)
    ai_output = output / 'ai'
    if ai_output.exists():
        shutil.rmtree(ai_output)
    shutil.copytree(ROOT / 'src/ai-workspace', ai_output / 'static')
    ai_page = (ROOT / 'src/ai-workspace/index.html').read_text(encoding='utf-8')
    for route in ('ai', 'ai/music', 'ai/chat', 'ai/assets', 'ai/tasks', 'ai/settings', 'ai/login', 'admin/ai'):
        destination = output / route
        destination.mkdir(parents=True, exist_ok=True)
        (destination / 'index.html').write_text(ai_page, encoding='utf-8')
    if (ROOT / 'legacy/archive').is_dir():
        shutil.copytree(ROOT / 'legacy/archive', output / 'archive', dirs_exist_ok=True)
    content_template = (ROOT / 'src/pages/content.html').read_text(encoding='utf-8')
    # Rebuild these generated routes as a unit so retired pages cannot linger.
    for directory in ('projects', 'updates'):
        if (output / directory).exists(): shutil.rmtree(output / directory)
    content_paths = []
    projects = content['projects']
    for index, project in enumerate(projects):
        route = project['storyPath']
        context.update(page_title=html.escape(f'{project["name"]} · {project["englishName"]} — {config["name"]}'),
            page_description=html.escape(project['description'], quote=True), page_type='article',
            page_url=html.escape(origin + route, quote=True), page_image=f'{origin}/assets/projects/{project["slug"]}-share.png',
            page_image_alt=html.escape(f'{project["name"]} · STRGO 作品介绍封面', quote=True),
            page_body=story_body(project, projects[(index + 1) % len(projects)], config))
        destination = output / route.strip('/')
        destination.mkdir(parents=True, exist_ok=True)
        (destination / 'index.html').write_text(re.sub(r'\{\{([a-z_]+)\}\}', replace, content_template), encoding='utf-8')
        content_paths.append(route)
    context.update(page_title='最近更新与创作记录 — STRGO', page_description='记录 STRGO 小宇宙里慢慢发生的变化。', page_type='website',
        page_url=html.escape(origin + '/updates/', quote=True), page_image=f'{origin}/assets/projects/updates-share.png',
        page_image_alt='STRGO 创作记录封面', page_body=updates_body(content))
    (output / 'updates').mkdir(exist_ok=True)
    (output / 'updates/index.html').write_text(re.sub(r'\{\{([a-z_]+)\}\}', replace, content_template), encoding='utf-8')
    content_paths.append('/updates/')
    # The registry supplies both the portal and the shared application switcher.
    from hub_build import build_hub
    build_hub(ROOT, output, config, context, replace)
    (output / 'robots.txt').write_text(f'User-agent: *\nAllow: /\nSitemap: {origin}/sitemap.xml\n', encoding='utf-8')
    (output / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ''.join(f'<url><loc>{html.escape(origin + path)}</loc></url>' for path in ['/', '/hub/', '/classic/', '/home/', '/dance/', '/nexus/', '/terminal', *dream_paths, *content_paths]) + '</urlset>\n', encoding='utf-8')
    manifest = {'version': version, 'homeVariant': config['HOME_VARIANT'], 'mode': 'production' if not missing else 'offline-preview', 'vendors': enabled, 'missingVendors': missing}
    (output / 'build-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Built {output} for {origin} ({manifest["mode"]})')
    if missing: print('Offline preview uses local motion fallbacks. Production build requires npm run build:production.')
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'site.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    parser.add_argument('--scheme', choices=('http', 'https'))
    parser.add_argument('--require-vendor', action='store_true')
    parser.add_argument('--content', type=Path, default=ROOT / 'content/site-content.json')
    parser.add_argument('--home-variant', choices=('classic', 'hub'))
    args = parser.parse_args()
    build(args.config, args.output, args.scheme, args.require_vendor, args.content, args.home_variant)
