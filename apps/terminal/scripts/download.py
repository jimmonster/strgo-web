#!/usr/bin/env python3
"""Bounded HTTPS downloads with optional SHA-256 verification; no shell evaluation."""
import argparse
import hashlib
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit


def https_url(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError('下载地址必须是无凭据的 HTTPS URL')
    return value


def download(url, destination):
    https_url(url)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + '.partial')
    try:
        subprocess.run([
            'curl', '--fail', '--location', '--show-error', '--silent',
            '--proto', '=https', '--proto-redir', '=https', '--tlsv1.2',
            '--connect-timeout', '15', '--max-time', '600',
            '--retry', '2', '--retry-delay', '2',
            '--output', str(partial), url,
        ], check=True)
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


def verify_sha256(path, checksum):
    fields = Path(checksum).read_text().split()
    if not fields:
        raise ValueError('空的 SHA-256 校验文件')
    expected = fields[0]
    if not re.fullmatch(r'[0-9a-fA-F]{64}', expected):
        raise ValueError('无效的 SHA-256 校验文件')
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != expected.lower():
        raise ValueError(f'{Path(path).name} SHA-256 不匹配，停止使用该下载')


def checked_download(url, destination):
    destination = Path(destination)
    checksum = destination.with_name(destination.name + '.sha256')
    download(url + '.sha256', checksum)
    if destination.is_file():
        try:
            verify_sha256(destination, checksum)
            return
        except (ValueError, IndexError):
            pass
    download(url, destination)
    verify_sha256(destination, checksum)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('url')
    parser.add_argument('destination', type=Path)
    parser.add_argument('--sha256', action='store_true')
    args = parser.parse_args()
    if args.sha256:
        checked_download(args.url, args.destination)
    else:
        download(args.url, args.destination)


if __name__ == '__main__':
    main()

