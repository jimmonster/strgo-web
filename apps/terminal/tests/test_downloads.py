import base64
import hashlib
import importlib.util
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import download


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


assets = load('fetch_assets', 'fetch-assets.py')
rootfs = load('fetch_rootfs', 'fetch-rootfs.py')


def archive_bytes(name, version, files, symlink=False):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as tar:
        info = json.dumps({'name': name, 'version': version}).encode()
        for filename, content in [('package/package.json', info)] + [(key, key.encode()) for key in files]:
            entry = tarfile.TarInfo(filename)
            entry.size = len(content)
            if symlink and filename in files:
                entry.type = tarfile.SYMTYPE
                entry.linkname = '/etc/passwd'
                entry.size = 0
                tar.addfile(entry)
            else:
                tar.addfile(entry, io.BytesIO(content))
        entry = tarfile.TarInfo('../../outside')
        entry.size = 4
        tar.addfile(entry, io.BytesIO(b'evil'))
    return stream.getvalue()


class DownloadVerificationTests(unittest.TestCase):
    def test_checksum_must_match_and_cannot_name_another_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'archive'
            checksum = Path(directory) / 'archive.sha256'
            path.write_bytes(b'checked')
            checksum.write_text(hashlib.sha256(b'checked').hexdigest() + '  /etc/passwd\n')
            download.verify_sha256(path, checksum)
            path.write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, '不匹配'):
                download.verify_sha256(path, checksum)
            checksum.write_text('not-a-digest\n')
            with self.assertRaisesRegex(ValueError, '无效'):
                download.verify_sha256(path, checksum)

    def test_downloads_reject_http_and_embedded_credentials(self):
        for url in ['http://mirror.example/a', 'file:///etc/passwd', 'https://user:secret@mirror.example/a']:
            with self.assertRaises(ValueError):
                download.https_url(url)
        self.assertEqual(download.https_url('https://mirror.example/a'), 'https://mirror.example/a')

    def test_sri_rejects_modified_package(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'package.tgz'
            path.write_bytes(b'package')
            integrity = 'sha512-' + base64.b64encode(hashlib.sha512(b'package').digest()).decode()
            assets.verify_integrity(path, integrity)
            path.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, '不匹配'):
                assets.verify_integrity(path, integrity)
            with self.assertRaises(ValueError):
                assets.verify_integrity(path, 'sha256-abc')

    def test_asset_archive_paths_cannot_escape_the_output_directory(self):
        name, version, files = assets.PACKAGES[0]
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            archive = directory / 'package.tgz'
            archive.write_bytes(archive_bytes(name, version, files))
            output = directory / 'out'
            assets.extract_assets(archive, output, files, name, version)
            self.assertEqual(sorted(p.name for p in output.iterdir()), sorted(files.values()))
            self.assertFalse((directory / 'outside').exists())
            self.assertEqual((output / 'xterm.js').read_text(), 'package/lib/xterm.js')

    def test_symlink_resources_and_wrong_package_versions_are_rejected(self):
        name, version, files = assets.PACKAGES[0]
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            archive = directory / 'package.tgz'
            archive.write_bytes(archive_bytes(name, version, files, symlink=True))
            with self.assertRaisesRegex(ValueError, '类型'):
                assets.extract_assets(archive, directory / 'out', files, name, version)
            archive.write_bytes(archive_bytes(name, '99.0.0', files))
            with self.assertRaisesRegex(ValueError, '版本'):
                assets.extract_assets(archive, directory / 'out', files, name, version)

    def test_mirrored_fetch_checks_package_before_writing_assets(self):
        archives = {name: archive_bytes(name, version, files) for name, version, files in assets.PACKAGES}
        urls = []
        def fake_download(url, destination):
            urls.append(url)
            if url.endswith('.tgz'):
                name = next(name for name in archives if url.endswith(name.rsplit('/', 1)[1] + '.tgz'))
                Path(destination).write_bytes(archives[name])
            else:
                name, version, _ = next(package for package in assets.PACKAGES if package[0].replace('/', '%2F') in url)
                dist = {'tarball': 'https://mirror.example/' + name.rsplit('/', 1)[1] + '.tgz', 'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(archives[name]).digest()).decode()}
                Path(destination).write_text(json.dumps({'name': name, 'version': version, 'dist': dist}))
        with tempfile.TemporaryDirectory() as directory, patch.object(assets, 'download', fake_download):
            directory = Path(directory)
            assets.fetch('https://mirror.example', directory / 'cache', directory / 'out')
            self.assertTrue((directory / 'out/xterm.js').is_file())
            self.assertTrue((directory / 'out/addon-fit.js').is_file())
            self.assertEqual(len(json.loads((directory / 'cache/asset-integrity.json').read_text())), 2)
            self.assertTrue(all(url.startswith('https://mirror.example/') for url in urls))

    def test_rootfs_uses_available_stable_patch_for_the_right_architecture(self):
        index = '''<a href="alpine-minirootfs-3.21.2-x86_64.tar.gz">old</a>
            <a href="alpine-minirootfs-3.21.11-x86_64.tar.gz">stable</a>
            <a href="alpine-minirootfs-3.21.12_rc1-x86_64.tar.gz">rc</a>
            <a href="alpine-minirootfs-3.21.99-aarch64.tar.gz">other arch</a>
            <a href="alpine-minirootfs-3.22.9-x86_64.tar.gz">other branch</a>
            <a href="alpine-minirootfs-3.21.100-x86_64.tar.gz.sha256">checksum</a>'''
        self.assertEqual(rootfs.release_name(index, 'x86_64'), 'alpine-minirootfs-3.21.11-x86_64.tar.gz')
        with self.assertRaises(ValueError):
            rootfs.release_name('<a href="unrelated">none</a>', 'x86_64')


if __name__ == '__main__':
    unittest.main()
