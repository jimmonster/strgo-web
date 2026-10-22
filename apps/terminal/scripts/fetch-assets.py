#!/usr/bin/env python3
"""Download the pinned browser assets without needing a Node base image or npm."""
import argparse
import base64
import hashlib
import json
import tarfile
from pathlib import Path
from urllib.parse import quote

from download import download, https_url

PACKAGES = [
    ('@xterm/xterm', '5.5.0', {
        'package/lib/xterm.js': 'xterm.js',
        'package/css/xterm.css': 'xterm.css',
        'package/LICENSE': 'XTERM-LICENSE.txt',
    }),
    ('@xterm/addon-fit', '0.10.0', {
        'package/lib/addon-fit.js': 'addon-fit.js',
        'package/LICENSE': 'ADDON-FIT-LICENSE.txt',
    }),
]


def verify_integrity(path, integrity):
    # npm SRI permits several algorithms; require the publisher's SHA-512 value.
    entries = [entry for entry in integrity.split() if entry.startswith('sha512-')]
    if len(entries) != 1:
        raise ValueError('包元数据缺少唯一 SHA-512 校验值')
    expected = base64.b64decode(entries[0].removeprefix('sha512-'), validate=True)
    if len(expected) != 64:
        raise ValueError('包元数据 SHA-512 长度无效')
    digest = hashlib.sha512()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.digest() != expected:
        raise ValueError('前端包 SHA-512 不匹配')


def extract_assets(archive, output, files, name, version):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, 'r:gz') as tar:
        member = tar.getmember('package/package.json')
        if not member.isfile() or member.size > 65536:
            raise ValueError('前端包 package.json 无效')
        info = json.load(tar.extractfile(member))
        if info.get('name') != name or info.get('version') != version:
            raise ValueError('前端包名称或固定版本不匹配')
        for source, destination in files.items():
            member = tar.getmember(source)
            if not member.isfile() or member.size > 8 * 1024 * 1024:
                raise ValueError(f'前端资源类型或大小无效：{source}')
            # Copy only known members to fixed local names; never extract archive paths.
            data = tar.extractfile(member).read()
            partial = output / (destination + '.partial')
            partial.write_bytes(data)
            partial.replace(output / destination)


def fetch(registry, cache, output):
    registry = https_url(registry).rstrip('/')
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    records = []
    for name, version, files in PACKAGES:
        slug = name.replace('@', '').replace('/', '-') + '-' + version
        metadata_file = cache / (slug + '.json')
        archive = cache / (slug + '.tgz')
        download(f'{registry}/{quote(name, safe="@")}/{version}', metadata_file)
        info = json.loads(metadata_file.read_text())
        if info.get('name') != name or info.get('version') != version:
            raise ValueError('仓库返回的前端包版本不匹配')
        dist = info['dist']
        verified = False
        if archive.is_file():
            try:
                verify_integrity(archive, dist['integrity'])
                verified = True
            except ValueError:
                pass
        if not verified:
            download(https_url(dist['tarball']), archive)
            verify_integrity(archive, dist['integrity'])
        extract_assets(archive, output, files, name, version)
        records.append({'name': name, 'version': version, 'integrity': dist['integrity'], 'tarball': dist['tarball']})
        print(f'{name}@{version}：校验与本地资源准备完成')
    (cache / 'asset-integrity.json').write_text(json.dumps(records, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--registry', required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    fetch(args.registry, args.cache, args.output)


if __name__ == '__main__':
    main()

