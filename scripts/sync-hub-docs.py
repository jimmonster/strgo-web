#!/usr/bin/env python3
"""Generate the portal's reviewable entry and token tables; --check detects drift."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def render(registry):
    entries = registry['entries']
    spaces = sum(e['group'] == '沉浸空间' for e in entries)
    public = sum(e['group'] != '管理' for e in entries)
    lines = ['# 门户功能与视觉清单', '',
             '由 `content/app-registry.json` 生成；请修改源清单后执行 `python3 scripts/sync-hub-docs.py`。', '',
             f'共 {len(entries)} 个主入口、{spaces} 个沉浸空间。访客和成员可见 {public} 个入口；管理员额外可见管理分类入口。可见入口不表示已取得模块或模型授权。', '',
             '| 编号 | 功能 | 路径基准 | 分类 | 访问条件 |', '| --- | --- | --- | --- | --- |']
    for item in registry['entries']:
        route = item['route']
        if route.startswith('/#'): route = '/classic/' + route[1:]
        if item['id'] == 'N07': route = '/classic/'
        lines.append(f"| {item['id']} | {item['name']} | `{route}` | {item['group']} | {item['access']} |")
    lines += ['', '终端地址和 Workflow 域名由 `site.json` 的 `TERMINAL_TARGET_URL`、`WORKFLOW_ORIGIN` 覆盖；构建产物中的注册表保存实际地址。', '',
              '## 视觉变量', '', '| 变量 | 值 |', '| --- | --- |']
    for name, value in registry['tokens'].items(): lines.append(f'| `{name}` | `{value}` |')
    lines += ['', '颜色使用十六进制；radius 和 spacing 的单位为 px。构建输出 `/hub/tokens.css`，供门户、生图和 AI 工作区共用。', '']
    return '\n'.join(lines)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    text = render(json.loads((ROOT / 'content/app-registry.json').read_text(encoding='utf-8')))
    output = ROOT / 'doc/hub/registry.md'
    if args.check:
        if not output.is_file() or output.read_text(encoding='utf-8') != text:
            raise SystemExit('Portal documentation differs from the registry; run python3 scripts/sync-hub-docs.py')
        print('Portal entry and token documentation is current.')
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text, encoding='utf-8')
