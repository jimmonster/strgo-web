"""Build the four content additions using the existing static templates."""
import datetime
import html
import json
from pathlib import Path
import re
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
UPDATE_TYPES = ('新作品', '改进', '创作记录')
CHAPTERS = {'origin': '创作起点', 'work': '我的工作', 'process': '过程与取舍', 'next': '接下来的想法'}


def esc(value):
    return html.escape(str(value), quote=True)


def safe_link(value):
    if not isinstance(value, str) or not value or re.search(r'[\s\\<>"\x00-\x1f]', value):
        raise ValueError('Content links must be nonempty safe URLs')
    parsed = urlparse(value)
    if value.startswith(('/', '#')) and not value.startswith('//'):
        return value
    if parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password:
        return value
    raise ValueError('Content links must be site paths, anchors or public HTTPS URLs')


def load_content(path):
    content = json.loads(Path(path).read_text(encoding='utf-8'))
    for group in ('filters', 'spaces', 'routes', 'projects', 'updates'):
        items = content[group]
        ids = [item['id'] for item in items]
        if len(ids) != len(set(ids)) or any(not re.fullmatch(r'[a-z0-9-]+', key) for key in ids):
            raise ValueError(f'{group} needs unique stable identifiers')
    categories = {item['id'] for item in content['filters']}
    if 'all' not in categories:
        raise ValueError('The all filter is required')
    spaces = {item['id']: item for item in content['spaces']}
    for space in spaces.values():
        safe_link(space['path'])
        if not space['categories'] or not set(space['categories']) <= categories - {'all'}:
            raise ValueError('Unknown space category')
        if not 0 < len(space['tags']) <= 2:
            raise ValueError('Spaces need one or two visible tags')
        if not re.fullmatch(r'[a-z-]+', space['style']):
            raise ValueError('Invalid portal style')
    for route in content['routes']:
        if not route['stops'] or not set(route['stops']) <= spaces.keys() | {'about', 'projects', 'contact'}:
            raise ValueError('Unknown route stop')
    slugs = set()
    for project in content['projects']:
        slug = project['slug']
        if not re.fullmatch(r'[a-z0-9-]+', slug) or slug in slugs:
            raise ValueError('Project slugs must be unique stable path segments')
        slugs.add(slug)
        project['storyPath'] = f'/projects/{slug}/'
        if project['contentState'] not in ('introduction', 'full-story'):
            raise ValueError('Unknown project content state')
        if project['cover'] not in ('galaxy', 'terminal', 'optical'):
            raise ValueError('Unknown existing project cover')
        for field in ('experience', 'secondaryExperience', 'source'):
            if project.get(field):
                safe_link(project[field]['href'])
        if project.get('preview'):
            preview = project['preview']
            if not preview['src'].startswith('/assets/') or not (ROOT / 'src' / preview['src'].lstrip('/')).is_file():
                raise ValueError('Project preview must refer to an existing local asset')
        for chapter in project.get('chapters', []):
            if chapter['id'] not in CHAPTERS:
                raise ValueError('Unknown story chapter')
    if not set(content['author']['featuredProjects']) <= {project['id'] for project in content['projects']}:
        raise ValueError('Unknown representative project')
    now = content['author'].get('now')
    if now and now.get('href'):
        safe_link(now['href'])
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
    for update in content['updates']:
        if type(update.get('published')) is not bool:
            raise ValueError('Update published must be a boolean')
        if update['type'] not in UPDATE_TYPES:
            raise ValueError('Unknown update type')
        if update.get('link'):
            safe_link(update['link']['href'])
        if update['published']:
            date = update.get('date')
            if not isinstance(date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
                raise ValueError('Published updates need an actual ISO event date')
            if datetime.date.fromisoformat(date) > today:
                raise ValueError('Future events cannot appear as published updates')
            if not update.get('title', '').strip() or not update.get('description', '').strip():
                raise ValueError('Published updates need a title and description')
    return content


def render_tags(tags, class_name):
    return f'<div class="{class_name}">' + ''.join(f'<span>{esc(tag)}</span>' for tag in tags) + '</div>'


def render_spaces(content):
    spaces = {space['id']: space for space in content['spaces']}
    stops = {**spaces, 'about': {'name': '个人介绍', 'path': '#stack'}, 'projects': {'name': '精选作品', 'path': '#projects'}, 'contact': {'name': '联系区', 'path': '#contact'}}
    routes = []
    for index, route in enumerate(content['routes'], 1):
        stations = ''.join(f'<li><a href="{esc(stops[key]["path"])}">{esc(stops[key]["name"])} <span aria-hidden="true">↗</span></a></li>' for key in route['stops'])
        routes.append(f'''<article class="explore-route route-{esc(route['id'])}">
          <p class="mono route-eyebrow">0{index} / {esc(route['eyebrow'])}</p><h3>{esc(route['name'])}</h3>
          <p class="route-description">{esc(route['description'])}</p><ol aria-label="{esc(route['name'])}站点顺序">{stations}</ol>
          <a class="button button-secondary route-start" href="{esc(stops[route['stops'][0]]['path'])}">{esc(route['action'])} <span aria-hidden="true">↗</span></a>
        </article>''')
    filters = ''.join(f'<button type="button" data-space-filter="{esc(item["id"])}" aria-pressed="{str(item["id"] == "all").lower()}" aria-controls="space-portals">{esc(item["name"])}</button>' for item in content['filters'])
    cards = []
    for index, space in enumerate(content['spaces'], 1):
        symbol_path = ROOT / 'src/partials' / f'portal-{space["style"]}.html'
        symbol = symbol_path.read_text(encoding='utf-8') if symbol_path.is_file() else f'<span class="portal-symbol" aria-hidden="true">{esc(space["symbol"])}</span>'
        cards.append(f'''<a class="space-portal portal-{esc(space['style'])}" href="{esc(space['path'])}" data-space-id="{esc(space['id'])}" data-space-categories="{esc(' '.join(space['categories']))}">
          <span class="portal-number mono">{index:02d} / {esc(space['eyebrow'])}</span>{symbol}
          <div class="portal-copy"><h3>{esc(space['name'])}</h3><p>{esc(space['description'])}</p></div>
          {render_tags(space['tags'], 'space-tags')}<span class="portal-enter">进入体验 <span aria-hidden="true">↗</span></span></a>''')
    return {
        'explore_routes': '<div class="explore-routes">' + ''.join(routes) + '</div>',
        'space_filters': f'<div class="space-filter-bar" hidden data-space-filter-bar><div class="space-filters" role="group" aria-label="按主题筛选空间">{filters}</div><p class="space-status" data-space-status role="status" aria-live="polite">全部 · {len(spaces)} 个空间</p></div>',
        'space_cards': ''.join(cards)
    }


def cover_markup(project):
    if project.get('preview'):
        preview = project['preview']
        return f'<img class="project-image" src="{esc(preview["src"])}" alt="{esc(preview["alt"])}" width="1200" height="720" loading="lazy">'
    return (ROOT / 'src/partials' / f'{project["cover"]}-cover.html').read_text(encoding='utf-8')


def render_projects(content):
    cards = []
    for project in content['projects']:
        cards.append(f'''<article class="project-card" data-theme="{esc(project['theme'])}">
          <button class="project-preview {esc(project['cover'])}-preview" type="button" data-project="{esc(project['id'])}" aria-label="查看{esc(project['name'])}项目预览">{cover_markup(project)}<span class="preview-open" aria-hidden="true">↗</span></button>
          <div class="project-information"><div><p class="mono project-category">{esc(project['category'])}</p><h3>{esc(project['name'])}<span>{esc(project['englishName'])}</span></h3></div><button class="project-open" data-project="{esc(project['id'])}" type="button" aria-label="查看{esc(project['name'])}项目详情">↗</button></div>
          <p class="project-description">{esc(project['description'])}</p>{render_tags(project['tags'], 'project-tags mono')}
          <a class="project-story-link" href="{esc(project['storyPath'])}">作品故事 <span aria-hidden="true">↗</span><span class="sr-only">：{esc(project['name'])}</span></a>
        </article>''')
    return ''.join(cards)


def published_updates(content):
    return sorted((entry for entry in content['updates'] if entry['published']), key=lambda entry: entry['date'], reverse=True)


def render_update(entry):
    date = datetime.date.fromisoformat(entry['date'])
    link = entry.get('link')
    action = f'<a class="update-link" href="{esc(link["href"])}">{esc(link["label"])} <span aria-hidden="true">↗</span></a>' if link else ''
    return f'''<article class="update-card" data-update-id="{esc(entry['id'])}"><div class="update-meta"><time datetime="{entry['date']}">{date.year}.{date.month:02d}.{date.day:02d}</time><span>{esc(entry['type'])}</span></div><h3>{esc(entry['title'])}</h3><p>{esc(entry['description'])}</p>{action}</article>'''


def render_recent(content):
    entries = published_updates(content)
    if not entries:
        return ''
    return '<section class="section updates-section" id="updates" aria-labelledby="updates-title"><div class="section-topline mono"><p>FIELD NOTES / 最近更新</p><a href="/updates/">全部记录 ↗</a></div><div class="section-intro"><h2 id="updates-title">这个宇宙，<span class="muted-title">又有了新变化。</span></h2></div><div class="updates-grid">' + ''.join(render_update(entry) for entry in entries[:3]) + '</div></section>'


def render_author(content, config):
    author = content['author']
    projects = {project['id']: project for project in content['projects']}
    links = ''.join(f'<a href="{esc(projects[key]["storyPath"])}">{esc(projects[key]["name"])} <span aria-hidden="true">↗</span></a>' for key in author['featuredProjects'])
    contact = f'<a href="mailto:{esc(config["email"])}">{esc(config["email"])}</a>' if config.get('email') else ''
    if config.get('github'):
        contact += f'<a href="{esc(config["github"])}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>'
    collaboration = f'<p>{esc(author["collaboration"])}</p>' if author.get('collaboration') else ''
    now = author.get('now')
    current = ''
    if now and now.get('confirmed') is True and now.get('text'):
        text = f'<a href="{esc(now["href"])}">{esc(now["text"])} ↗</a>' if now.get('href') else esc(now['text'])
        current = f'<p class="creating-now"><span class="status-dot" aria-hidden="true"></span> 正在创作 · {text}</p>'
    return {
        'author_introduction': esc(author['introduction']),
        'author_focus': render_tags(author['focus'], 'profile-tags'),
        'author_links': f'<div class="author-links"><div><p class="mono">SELECTED WORK / 我做过什么</p><div class="author-projects">{links}</div></div><div class="author-contact"><p class="mono">SAY HELLO / 如何找到我</p><p>{esc(author["contactText"])}</p><div class="author-contact-links">{contact}</div>{collaboration}</div></div>',
        'contact_text': esc(author['contactText']),
        'creating_now': current,
        'profile_coordinates': f'<span data-coordinates>{esc(config["coordinates"])}</span>' if config.get('coordinates') else ''
    }


def story_body(project, next_project, config):
    preview = project.get('preview')
    caption = preview.get('caption', project['previewCaption']) if preview else project['previewCaption']
    visual = f'<figure class="story-figure"><div class="project-preview {esc(project["cover"])}-preview story-preview" role="img" aria-label="{esc(project["coverLabel"])}">{cover_markup(project)}</div><figcaption>{esc(caption)}</figcaption></figure>'
    experience = project.get('experience')
    experience_section = ''
    if experience:
        experience_section = f'<section class="story-section" aria-labelledby="experience-title"><p class="mono cyber">01 / EXPERIENCE</p><h2 id="experience-title">作品体验</h2><p>{esc(experience["description"])}</p><div class="story-actions"><a class="button button-primary" href="{esc(experience["href"])}">{esc(experience["label"])} <span aria-hidden="true">↗</span></a>'
        for key in ('secondaryExperience', 'source'):
            if project.get(key):
                action = project[key]
                experience_section += f'<a class="button button-secondary" href="{esc(action["href"])}">{esc(action["label"])} ↗</a>'
        experience_section += '</div></section>'
    chapters = ''
    for chapter in project.get('chapters', []):
        if chapter.get('confirmed') is not True or not chapter.get('body', '').strip():
            continue
        paragraphs = ''.join(f'<p>{esc(paragraph)}</p>' for paragraph in chapter['body'].split('\n\n') if paragraph.strip())
        chapters += f'<section class="story-section"><h2>{CHAPTERS[chapter["id"]]}</h2>{paragraphs}</section>'
    contact = f'<a class="button button-secondary" href="mailto:{esc(config["email"])}">联系作者 ↗</a>' if config.get('email') else '<a class="button button-secondary" href="/#contact">联系作者 ↗</a>'
    return f'''<article class="project-story">
      <a class="content-back mono" href="/#projects">← SELECTED WORK / 返回作品列表</a>
      <header class="story-heading"><p class="mono cyber">{esc(project['englishName'])}</p><h1>{esc(project['name'])}</h1><p class="story-lead">{esc(project['description'])}</p><dl class="story-facts"><div><dt>项目类型</dt><dd>{esc(project['type'])}</dd></div><div><dt>体验入口</dt><dd>{esc(project['status'])}</dd></div></dl>{render_tags(project['tags'], 'project-tags mono')}</header>
      {visual}<div class="story-copy">{experience_section}{chapters}</div>
      <nav class="story-next" aria-label="接下来"><div><p class="mono">NEXT EXPLORATION</p><a class="next-project" href="{esc(next_project['storyPath'])}">下一件 · {esc(next_project['name'])} ↗</a></div><div class="story-actions"><a class="button button-secondary" href="/#projects">返回作品列表</a>{contact}</div></nav>
    </article>'''


def updates_body(content):
    entries = published_updates(content)
    listing = '<div class="updates-list">' + ''.join(render_update(entry) for entry in entries) + '</div>' if entries else '<div class="updates-empty"><span class="empty-orbit" aria-hidden="true">✳</span><p>新的创作记录，会陆续放在这里。</p><a class="button button-secondary" href="/#spaces">先去逛逛空间 <span aria-hidden="true">↗</span></a></div>'
    return '<a class="content-back mono" href="/">← 返回主站</a><header class="updates-heading"><p class="mono cyber">FIELD NOTES / STRGO</p><h1>最近更新<span class="muted-title">与创作记录。</span></h1><p class="story-lead">记录这个小宇宙里，慢慢发生的变化。</p></header>' + listing
