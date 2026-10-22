#!/usr/bin/env python3
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.resources = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, f"Duplicate id: {attrs['id']}"
            self.ids.add(attrs['id'])
        if tag == 'script': self.resources.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet': self.resources.append(attrs['href'])


page = Page()
page.feed((ROOT / 'web/index.html').read_text())
for identifier in re.findall(r"\$\('([^']+)'\)", (ROOT / 'web/app.js').read_text()):
    assert identifier in page.ids, f'Missing element: {identifier}'
assert all(resource.startswith('/terminal/') for resource in page.resources)
backend = (ROOT / 'src/web.rs').read_text()
for resource in page.resources:
    assert f'.route("{resource}"' in backend, f'Missing route: {resource}'
    if '/vendor/' not in resource: assert (ROOT / 'web' / resource.removeprefix('/terminal/')).is_file()
manifest = (ROOT / 'Cargo.toml').read_text()
assert '[package]' in manifest and '[dependencies]' in manifest
assert 'name = "strgo-terminal"' in manifest and 'build = "build.rs"' in manifest
broker = (ROOT / 'src/broker.rs').read_text()
for limit in ['--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--pids-limit=32', '--memory=128m', '--user=10001:10001', '--log-driver=none']:
    assert limit in broker
assert '--privileged' not in broker and '--network=host' not in broker
assert '/var/www' not in broker and '/docker.sock' not in broker
native_sandbox = (ROOT / 'deploy/Dockerfile.sandbox-rootfs').read_text()
assert 'FROM scratch' in native_sandbox and 'ADD alpine-minirootfs.tar.gz /' in native_sandbox
assert 'FROM alpine:' not in native_sandbox
native_build = (ROOT / 'scripts/build-native.sh').read_text()
assert 'docker pull' not in native_build and 'docker.io' not in native_build
assert 'fetch-rootfs.py' in native_build and 'fetch-assets.py' in native_build
print('文件检查通过：HTML 元素、资源子路径、Rust 路由、Cargo 配置与沙箱参数。')

