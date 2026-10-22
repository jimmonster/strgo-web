#!/usr/bin/env python3
"""Select an available stable Alpine patch release, then verify its archive."""
import argparse
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

from download import checked_download, download, https_url


class Directory(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            href = dict(attrs).get('href')
            if href:
                self.links.append(href)


def release_name(index, arch):
    if arch not in ('x86_64', 'aarch64'):
        raise ValueError('不支持的 Alpine 架构')
    directory = Directory()
    directory.feed(index)
    matches = []
    pattern = re.compile(rf'alpine-minirootfs-(3\.21\.(\d+))-{arch}\.tar\.gz')
    for link in directory.links:
        name = urlsplit(link).path.rsplit('/', 1)[-1]
        match = pattern.fullmatch(name)
        if match:
            matches.append((int(match[2]), name))
    if not matches:
        raise ValueError('下载源未列出此架构可用的 Alpine 3.21 稳定根文件系统')
    return max(matches)[1]


def fetch(mirror, arch, cache, output):
    mirror = https_url(mirror).rstrip('/')
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    index = cache / f'alpine-v3.21-{arch}-index.html'
    base = f'{mirror}/v3.21/releases/{arch}'
    download(base + '/', index)
    name = release_name(index.read_text(), arch)
    archive = cache / name
    checked_download(f'{base}/{name}', archive)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Preserve the named cached artifact; the Docker build uses a constant local name.
    import shutil
    shutil.copyfile(archive, output)
    print(f'{name}：SHA-256 校验完成')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mirror', required=True)
    parser.add_argument('--arch', required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    fetch(args.mirror, args.arch, args.cache, args.output)


if __name__ == '__main__':
    main()

