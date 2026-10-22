import hashlib
import hmac
import http.client
import ipaddress
import json
import os
import secrets
import socket
import ssl
import time
from urllib.parse import urlsplit, urlunsplit

from cryptography.fernet import Fernet


class Problem(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password):
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise Problem(400, '密码需为 12–128 位。')
    salt = secrets.token_hex(16)
    hashed = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768, r=8, p=1, maxmem=64 * 1024 * 1024)
    return f'scrypt${salt}${hashed.hex()}'


def password_matches(password, encoded):
    if not isinstance(password, str) or len(password) > 128:
        return False
    try:
        _, salt, expected = encoded.split('$')
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768, r=8, p=1, maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(actual.hex(), expected)
    except (ValueError, TypeError):
        return False


def encryption_key():
    key = os.environ.get('IMAGE_ENCRYPTION_KEY', '')
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as error:
        raise RuntimeError('IMAGE_ENCRYPTION_KEY 必须是 Fernet 密钥，请先运行 python3 -m image_service.cli key。') from error


def validate_endpoint(value):
    if not isinstance(value, str) or len(value) > 500 or any(ord(c) < 33 for c in value):
        raise Problem(400, '请输入完整的 HTTPS 生图接口地址。')
    try:
        url = urlsplit(value)
        valid = url.scheme == 'https' and url.hostname and url.port in (None, 443) and not (url.username or url.password or url.query or url.fragment)
    except ValueError:
        valid = False
    if not valid or not url.path.endswith('/images/generations'):
        raise Problem(400, '地址需使用 HTTPS，端口为 443，并以 /images/generations 结尾。')
    return value


def public_addresses(hostname, port):
    try:
        addresses = list(dict.fromkeys(x[4][0] for x in socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)))
    except OSError as error:
        raise Problem(502, '无法解析上游服务地址。') from error
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise Problem(400, '服务地址必须指向公网，不能访问内网或云服务器元数据。')
    return addresses


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connect to the checked public IP while preserving TLS hostname checks."""

    def __init__(self, host, address, timeout):
        super().__init__(host, port=443, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        raw = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def https_request(url, method='GET', body=None, headers=None, max_bytes=24 * 1024 * 1024, timeout=150):
    parsed = urlsplit(url)
    try:
        allowed = parsed.scheme == 'https' and parsed.hostname and parsed.port in (None, 443) and not (parsed.username or parsed.password or parsed.fragment)
    except ValueError:
        allowed = False
    if not allowed:
        raise Problem(502, '上游返回了不支持的图片地址。')
    addresses = public_addresses(parsed.hostname, 443)
    connection = PinnedHTTPSConnection(parsed.hostname, addresses[0], timeout)
    try:
        path = urlunsplit(('', '', parsed.path or '/', parsed.query, ''))
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        # Redirects are deliberately never followed with provider credentials.
        if response.status < 200 or response.status >= 300:
            response.read(2048)
            if response.status in (401, 403):
                raise Problem(502, '模型服务拒绝访问，请检查密钥和账号权限。')
            if response.status == 429:
                raise Problem(502, '模型服务限流或额度不足，请稍后重试。')
            raise Problem(502, f'上游服务返回 HTTP {response.status}，请检查接口和模型参数。')
        length = response.getheader('Content-Length')
        if length and int(length) > max_bytes:
            raise Problem(502, '上游返回的数据超过允许大小。')
        data = response.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise Problem(502, '上游返回的数据超过允许大小。')
        return data
    except Problem:
        raise
    except (OSError, ValueError, http.client.HTTPException) as error:
        raise Problem(502, '上游连接中断或超时，请稍后检查任务状态。') from error
    finally:
        connection.close()


def image_type(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png', 'png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg', 'jpg'
    if len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp', 'webp'
    raise Problem(502, '上游未返回有效的 PNG、JPEG 或 WebP 图片。')
