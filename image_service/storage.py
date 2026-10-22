"""Private persistent storage, using the ECS disk by default."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile

from .security import Problem


class DiskStorage:
    kind = 'local'
    label = 'ECS 硬盘'

    def __init__(self, directory=None):
        data_root = Path(os.environ.get('IMAGE_DATA_DIR', '/var/lib/strgo-image'))
        self.directory = Path(directory or os.environ.get('IMAGE_FILES_DIR') or data_root / 'files').resolve()
        self.prefix = 'image-playground'
        self.min_free_bytes = int(os.environ.get('IMAGE_MIN_FREE_MB', '256')) * 1024 * 1024
        if self.min_free_bytes < 0:
            raise RuntimeError('IMAGE_MIN_FREE_MB 不能小于零。')
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)

    @property
    def ready(self):
        return self.directory.is_dir() and os.access(self.directory, os.W_OK)

    def key(self, suffix):
        return self.prefix + '/' + suffix.lstrip('/')

    def _path(self, key):
        if (not isinstance(key, str) or not key or '\\' in key or '\x00' in key
                or key.startswith('/') or any(part in ('', '.', '..') for part in key.split('/'))
                or not (key == self.prefix or key.startswith(self.prefix + '/'))):
            raise Problem(400, '存储文件路径无效。')
        path = self.directory.joinpath(*PurePosixPath(key).parts)
        resolved = path.resolve()
        if not resolved.is_relative_to(self.directory):
            raise Problem(400, '存储文件路径无效。')
        return path

    def put(self, key, data, mime):
        path = self._path(key)
        if not isinstance(data, bytes):
            raise Problem(400, '存储内容格式无效。')
        name = None
        try:
            free = shutil.disk_usage(self.directory).free
            if free < self.min_free_bytes + len(data):
                raise Problem(507, 'ECS 硬盘可用空间不足，已停止写入，请清理或扩容硬盘后重试。')
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(prefix='.pending-', dir=path.parent)
            with os.fdopen(fd, 'wb') as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            # Re-check after creating parents, then replace on the same disk.
            self._path(key)
            os.replace(name, path)
            name = None
            directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            if path.stat().st_size != len(data) or hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(data).digest():
                raise Problem(502, 'ECS 硬盘写入校验失败，图片保留在待保存队列。')
        except Problem:
            raise
        except OSError as error:
            raise Problem(503, 'ECS 硬盘暂时无法写入，请检查数据目录权限和可用空间。') from error
        finally:
            if name is not None:
                try:
                    os.unlink(name)
                except OSError:
                    pass

    def get(self, key):
        path = self._path(key)
        try:
            if path.stat().st_size > 256 * 1024 * 1024:
                raise Problem(502, '存储文件超过允许读取大小。')
            with path.open('rb') as handle:
                data = handle.read(256 * 1024 * 1024 + 1)
            if len(data) > 256 * 1024 * 1024:
                raise Problem(502, '存储文件超过允许读取大小。')
            return data
        except OSError as error:
            raise Problem(502, '暂时无法读取服务器上的文件，请检查数据目录。') from error

    def delete(self, key):
        path = self._path(key)
        try:
            path.unlink(missing_ok=True)
            if path.parent.exists():
                directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        except OSError as error:
            raise Problem(503, 'ECS 硬盘文件删除失败，将自动重试清理。') from error

    def iter_keys(self, prefix):
        start = self._path(prefix.rstrip('/'))
        if not start.exists():
            return
        for path in sorted(start.rglob('*')):
            if path.is_file() and not path.is_symlink() and not path.name.startswith('.pending-'):
                key = path.relative_to(self.directory).as_posix()
                self._path(key)
                yield key


def create_storage():
    kind = os.environ.get('IMAGE_STORAGE', 'local').strip().lower()
    if kind in ('local', 'disk'):
        return DiskStorage()
    if kind == 'oss':
        from .cloud import OSSStorage
        return OSSStorage()
    raise RuntimeError('IMAGE_STORAGE 仅支持 local 或 oss。')
