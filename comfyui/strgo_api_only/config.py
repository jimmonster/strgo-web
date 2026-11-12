"""Read systemd-provided configuration without returning credential fields."""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

from .policy import OFFICIAL_MODEL, Rejected

PROVIDER = re.compile(r'[a-z][a-z0-9_-]{0,31}')
MODEL = re.compile(r'[a-z][a-z0-9_-]{0,63}')
HOST = re.compile(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}')
MOCK_MODELS = ('echo', 'image', 'video')


def credential(name):
    return (Path(os.environ['CREDENTIALS_DIRECTORY']) / name).read_text(encoding='utf-8').strip()


def key(value):
    if not isinstance(value, str) or len(value) > 1024 or any(not 33 <= ord(char) <= 126 for char in value):
        raise ValueError('Invalid API credential.')
    return value


@dataclass(frozen=True)
class Model:
    provider: str
    alias: str
    model: str
    endpoint: str
    api_key: str
    unit: str
    daily_limit: int
    reserve: int

    @property
    def enabled(self):
        return bool(self.api_key and 0 < self.reserve <= self.daily_limit)


class Registry:
    def __init__(self, document):
        self.entries = {}
        official = document.get('official', {})
        self.add('official', OFFICIAL_MODEL, OFFICIAL_MODEL, '', 'milli-Comfy-Credit', official)
        for provider, options in document.get('byok', {}).items():
            if not PROVIDER.fullmatch(provider) or provider in ('official', 'mock'):
                raise ValueError('Invalid BYOK provider alias.')
            endpoint = options['endpoint']
            url = urlsplit(endpoint)
            if (url.scheme != 'https' or not HOST.fullmatch(url.hostname or '') or url.netloc != url.hostname
                    or not re.fullmatch(r'/(?:[A-Za-z0-9_-]+/)*chat/completions', url.path)
                    or url.query or url.fragment):
                raise ValueError('BYOK endpoint must be a fixed HTTPS chat/completions URL.')
            for alias, entry in options['models'].items():
                model = entry['model']
                if not MODEL.fullmatch(alias) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}', model):
                    raise ValueError('Invalid BYOK model.')
                self.add(provider, alias, model, endpoint, 'micro-USD', {**entry,
                         'daily_limit': options.get('daily_limit', 0), 'api_key': options.get('api_key', '')})

    def add(self, provider, alias, model, endpoint, unit, options):
        daily, reserve = options.get('daily_limit', 0), options.get('reserve', 0)
        if any(type(value) is not int or not 0 <= value <= 100_000_000_000 for value in (daily, reserve)):
            raise ValueError('Invalid budget settings.')
        self.entries[(provider, alias)] = Model(provider, alias, model, endpoint, key(options.get('api_key', '')),
                                                unit, daily, reserve)

    def model(self, route, alias):
        if route == 'mock' and alias in MOCK_MODELS:
            return Model(route, alias, alias, '', '', '', 0, 0)
        model = self.entries.get((route, alias))
        if model is None:
            raise Rejected('The requested provider or model is unavailable.', 403)
        return model

    def selections(self):
        return ['mock:echo', *(f'{provider}:{alias}' for (provider, alias), model in self.entries.items()
                               if provider != 'official' and model.enabled)]


def load():
    return Registry(json.loads(credential('providers.json')))
