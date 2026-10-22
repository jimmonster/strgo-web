import base64
import hashlib
import json
import os
import re
import threading
from urllib.parse import urlsplit, urlunsplit

from .security import Problem, https_request, image_type


class OSSStorage:
    kind = 'oss'
    label = '阿里云 OSS'

    def __init__(self):
        self.bucket = os.environ.get('OSS_BUCKET', '')
        self.endpoint = os.environ.get('OSS_ENDPOINT', '')
        self.prefix = os.environ.get('OSS_PREFIX', 'image-playground').strip('/')
        if not re.fullmatch(r'[a-zA-Z0-9/_-]+', self.prefix):
            raise RuntimeError('OSS_PREFIX 格式错误。')
        self._local = threading.local()

    @property
    def ready(self):
        return bool(self.bucket and re.fullmatch(r'https://oss-[a-z0-9-]+\.aliyuncs\.com', self.endpoint))

    def client(self):
        if not self.ready:
            raise Problem(503, '服务器尚未配置阿里云 OSS，暂不能生成图片。')
        if not getattr(self._local, 'bucket', None):
            try:
                import oss2
                key_id = os.environ.get('OSS_ACCESS_KEY_ID')
                key_secret = os.environ.get('OSS_ACCESS_KEY_SECRET')
                token = os.environ.get('OSS_SECURITY_TOKEN')
                if key_id and key_secret:
                    auth = oss2.StsAuth(key_id, key_secret, token) if token else oss2.Auth(key_id, key_secret)
                else:
                    auth = oss2.ProviderAuth(oss2.credentials.EcsRamRoleCredentialsProvider())
                self._local.bucket = oss2.Bucket(auth, self.endpoint, self.bucket, connect_timeout=30, enable_crc=True)
            except ImportError as error:
                raise Problem(503, '服务器缺少 OSS SDK，请安装 image_service/requirements.txt。') from error
        return self._local.bucket

    def key(self, suffix):
        return self.prefix + '/' + suffix.lstrip('/')

    def put(self, key, data, mime):
        client = self.client()
        try:
            md5 = base64.b64encode(hashlib.md5(data).digest()).decode()
            result = client.put_object(key, data, headers={
                'Content-Type': mime, 'Content-MD5': md5,
                'x-oss-server-side-encryption': 'AES256', 'x-oss-object-acl': 'private',
                'Cache-Control': 'private, no-store',
            })
            check = client.head_object(key)
            if result.status != 200 or check.content_length != len(data) or check.etag.lower().strip('"') != hashlib.md5(data).hexdigest():
                raise Problem(502, 'OSS 写入校验失败，图片保留在待同步队列。')
        except Problem:
            raise
        except Exception as error:
            raise Problem(502, '阿里云 OSS 保存失败，图片保留在待同步队列。') from error

    def get(self, key):
        try:
            result = self.client().get_object(key)
            try:
                data = result.read(24 * 1024 * 1024 + 1)
            finally:
                result.close()
            if len(data) > 24 * 1024 * 1024:
                raise Problem(502, '云端对象超过允许大小。')
            return data
        except Problem:
            raise
        except Exception as error:
            raise Problem(502, '暂时无法读取云端图片，请稍后重试。') from error

    def delete(self, key):
        try:
            result = self.client().delete_object(key)
            if result.status not in (200, 204):
                raise Problem(502, '云端文件删除失败，将自动重试清理。')
        except Problem:
            raise
        except Exception as error:
            raise Problem(502, '云端文件删除失败，将自动重试清理。') from error

    def iter_keys(self, prefix):
        import oss2
        for item in oss2.ObjectIterator(self.client(), prefix=prefix):
            yield item.key


class ImageProvider:
    def generate(self, config, job):
        payload = {'model': config['model'], 'prompt': job['prompt'], 'size': job['size'], 'n': job['count']}
        if job['quality']:
            payload['quality'] = job['quality']
        if job.get('reference_image'):
            mime, extension = image_type(job['reference_image'])
            parts = urlsplit(config['endpoint'])
            path = parts.path.rsplit('/', 1)[0] + '/edits'
            endpoint = urlunsplit((parts.scheme, parts.netloc, path, '', ''))
            boundary = 'strgo-' + os.urandom(18).hex()
            chunks = []
            for name, value in payload.items():
                chunks.extend((f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode(), str(value).encode('utf-8'), b'\r\n'))
            chunks.extend((
                f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="reference.{extension}"\r\nContent-Type: {mime}\r\n\r\n'.encode(),
                job['reference_image'], b'\r\n', f'--{boundary}--\r\n'.encode(),
            ))
            raw = https_request(endpoint, method='POST', body=b''.join(chunks),
                                headers={'Authorization': 'Bearer ' + config['apiKey'], 'Content-Type': 'multipart/form-data; boundary=' + boundary},
                                max_bytes=112 * 1024 * 1024)
        else:
            raw = https_request(config['endpoint'], method='POST',
                                body=json.dumps(payload, ensure_ascii=False).encode(),
                                headers={'Authorization': 'Bearer ' + config['apiKey'], 'Content-Type': 'application/json'},
                                max_bytes=112 * 1024 * 1024)
        try:
            response = json.loads(raw)
            items = response.get('data')
            if not isinstance(items, list) or not items or len(items) > job['count']:
                raise ValueError()
            return items
        except (ValueError, TypeError, AttributeError) as error:
            raise Problem(502, '模型服务未返回支持的 data 图片列表。') from error

    def image_bytes(self, item):
        try:
            if item.get('b64_json'):
                value = item['b64_json']
                if not isinstance(value, str) or len(value) > 32 * 1024 * 1024:
                    raise ValueError()
                data = base64.b64decode(value, validate=True)
            elif isinstance(item.get('url'), str):
                data = https_request(item['url'])
            else:
                raise ValueError()
            if len(data) > 24 * 1024 * 1024:
                raise ValueError()
            image_type(data)
            return data
        except Problem:
            raise
        except (ValueError, TypeError, AttributeError) as error:
            raise Problem(502, '模型返回的图片数据无效或超过 24 MB。') from error
