"""Verify engine registration, loopback isolation, and the public login boundary."""
import argparse
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def expect(url, status, headers=None):
    try:
        with urlopen(Request(url, headers=headers or {}), timeout=8) as response:
            assert response.status == status, (url, response.status)
            return response.read()
    except HTTPError as error:
        if error.code != status:
            raise RuntimeError(f'{url} returned HTTP {error.code}, expected {status}') from None
        return b''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--public', action='store_true')
    args = parser.parse_args()
    base = 'http://127.0.0.1:8188'
    expect(base + '/system_stats', 404)
    engine_key = Path('/etc/strgo-comfyui/engine.token').read_text().strip()
    headers = {'X-STRGO-Engine': engine_key}
    expect(base + '/system_stats', 200, headers)
    for node in ('OpenAIChatNode', 'OpenAIChatConfig', 'StrgoText', 'StrgoDisplay', 'StrgoMockImage', 'StrgoMockVideo'):
        nodes = json.loads(expect(base + '/object_info/' + node, 200, headers))
        if node not in nodes:
            raise RuntimeError(f'{node} is missing.')
    gateway = 'http://127.0.0.1:8189'
    expect(gateway + '/login/', 200)
    expect(gateway + '/api/object_info', 401)
    if args.public:
        origin = 'https://comfyui.strgo.com'
        expect(origin + '/login/', 200)
        expect(origin + '/api/object_info', 401)
        expect(origin + '/internal/auth', 404)
    print('Engine registration and anonymous access checks passed.')


if __name__ == '__main__':
    main()
