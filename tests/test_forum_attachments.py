"""Actual upload/claim/read/backup behavior, with no cloud or paid models."""
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import sqlite3
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch

from image_service.security import Problem
from image_service import forum_attachments as attachments
from tests import test_image_service as image_fixtures


PDF = b'%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n'
PNG = image_fixtures.PNG


class ForumAttachmentTests(unittest.TestCase):
    def setUp(self):
        self.fixture = image_fixtures.ImageServiceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.alice = self.fixture.register('alice')
        self.bob = self.fixture.register('bob')

    def call(self, method, path, payload=None, session=None, extra=None):
        return self.fixture.call(method, '/forum' + path, payload, session or self.alice, extra)

    def upload(self, data=PNG, name='作品.png', mime='image/png', session=None, **changes):
        encoded = data if isinstance(data, str) else base64.b64encode(data).decode()
        payload = dict(name=name, mime=mime, data=encoded, request_id=uuid.uuid4().hex)
        payload.update(changes)
        return self.call('POST', '/attachments', payload, session)

    def post(self, body, session=None):
        return self.call('POST', '/posts', dict(title='分享文档', body=body, category='general'), session)[1]

    def read(self, upload, session=None, suffix=''):
        return self.call('GET', '/attachments/' + upload['id'] + suffix, session=session)

    def problem(self, status, action):
        with self.assertRaises(Problem) as caught:
            action()
        self.assertEqual(status, caught.exception.status)

    def test_upload_requires_login_origin_and_csrf(self):
        self.problem(401, lambda: self.fixture.call('POST', '/forum/attachments', {}))
        for extra in ({'Origin': 'https://other.example'}, {'X-CSRF-Token': ''}):
            self.problem(403, lambda: self.call('POST', '/attachments', {}, extra=extra))
        upload = self.upload()[1]
        self.fixture.call('POST', '/logout', session=self.alice)
        self.problem(401, lambda: self.read(upload))

    def test_draft_is_owner_private_then_members_can_read_published_attachments(self):
        upload = self.upload()[1]
        self.assertEqual(PNG, self.read(upload)[1])
        self.problem(404, lambda: self.read(upload, self.bob))
        self.problem(404, lambda: self.read(upload, self.fixture.admin))
        self.post('![图片说明](' + upload['url'] + ')')
        self.assertEqual(PNG, self.read(upload, self.bob)[1])
        self.problem(401, lambda: self.fixture.call('GET', '/forum/attachments/' + upload['id']))

    def test_cannot_claim_other_members_drafts_or_reuse_another_posts_attachment(self):
        upload = self.upload()[1]
        body = '![作品](' + upload['url'] + ')'
        self.problem(400, lambda: self.post(body, self.bob))
        self.post(body)
        self.problem(400, lambda: self.post(body))
        self.assertEqual(1, self.call('GET', '/posts')[1]['total'])

    def test_upload_retries_are_idempotent_even_when_concurrent(self):
        key = uuid.uuid4().hex
        with ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(pool.map(lambda _: self.upload(request_id=key), range(2)))
        self.assertEqual({200, 201}, {response[0] for response in replies})
        self.assertEqual(replies[0][1]['id'], replies[1][1]['id'])
        self.problem(409, lambda: self.upload(name='other.png', request_id=key))

    def test_file_validation_size_limits_and_safe_headers(self):
        cases = [
            dict(data='not-base64'), dict(mime={'bad': True}), dict(name='../escape.png'),
            dict(name='bad\r\nheader.png'), dict(name='script.svg', mime='image/svg+xml'),
            dict(data=base64.b64encode(b'<script>alert(1)</script>').decode()),
            dict(mime='image/jpeg', name='wrong.jpg'),
            dict(mime='application/pdf', name='bad.pdf'),
        ]
        for changes in cases:
            self.problem(400, lambda: self.upload(**changes))
        self.problem(413, lambda: self.upload(data=b'x' * (attachments.MAX_BYTES + 1)))
        upload = self.upload(data=PDF, name='报告.pdf', mime='application/pdf')[1]
        status, data, headers = self.read(upload)
        self.assertEqual((200, PDF), (status, data))
        self.assertEqual('application/pdf', headers['Content-Type'])
        self.assertIn("attachment; filename*=UTF-8''", headers['Content-Disposition'])
        self.assertIn("sandbox", headers['Content-Security-Policy'])
        image = self.upload()[1]
        self.assertTrue(self.read(image)[2]['Content-Disposition'].startswith('inline'))
        self.assertTrue(self.read(image, suffix='?download=1')[2]['Content-Disposition'].startswith('attachment'))

    def test_edit_conflicts_keep_uploads_and_removing_links_revokes_access(self):
        upload = self.upload()[1]
        post = self.post('![作品](' + upload['url'] + ')')
        body = dict(title=post['title'], body='已移除图片', category='general', revision=0)
        self.problem(409, lambda: self.call('PUT', '/posts/' + post['id'], body))
        self.assertEqual(PNG, self.read(upload, self.bob)[1])
        body['revision'] = post['revision']
        self.call('PUT', '/posts/' + post['id'], body)
        self.problem(404, lambda: self.read(upload))

    def test_post_deletion_removes_attachments_and_their_quota(self):
        upload = self.upload()[1]
        post = self.post('![作品](' + upload['url'] + ')')
        self.call('DELETE', '/posts/' + post['id'], session=self.fixture.admin)
        self.problem(404, lambda: self.read(upload))
        with self.fixture.store.connect() as db:
            self.assertEqual(0, db.execute('SELECT COUNT(*) FROM forum_attachments').fetchone()[0])

    def test_abandoned_uploads_expire_and_user_quota_is_enforced(self):
        upload = self.upload()[1]
        with patch.object(attachments, 'USER_BYTES', len(PNG)):
            self.problem(413, lambda: self.upload())
        with patch.object(attachments.time, 'time', return_value=time.time() + attachments.DRAFT_AGE + 1):
            self.problem(404, lambda: self.read(upload))
            self.problem(400, lambda: self.post('![expired](' + upload['url'] + ')'))
            self.upload()
        with self.fixture.store.connect() as db:
            self.assertIsNone(db.execute('SELECT id FROM forum_attachments WHERE id=?', (upload['id'],)).fetchone())

    def test_post_file_count_and_invalid_reference_are_atomic(self):
        first = self.upload()[1]
        with patch.object(attachments, 'MAX_PER_POST', 1):
            second = self.upload()[1]
            self.problem(400, lambda: self.post(first['url'] + '\n' + second['url']))
        self.problem(400, lambda: self.post(first['url'] + '\n' + attachments.PREFIX + '/' + '0' * 32))
        self.assertEqual(0, self.call('GET', '/posts')[1]['total'])
        self.post('![valid](' + first['url'] + ')')

    def test_site_admin_moderation_also_cleans_attachment_storage(self):
        upload = self.upload()[1]
        post = self.post('![作品](' + upload['url'] + ')')
        self.fixture.call('DELETE', '/admin/forum/posts/' + post['id'], session=self.fixture.admin)
        self.problem(404, lambda: self.read(upload))
        with self.fixture.store.connect() as db:
            self.assertEqual(0, db.execute('SELECT COUNT(*) FROM forum_attachments').fetchone()[0])

    def test_attachment_bytes_survive_encrypted_database_backup(self):
        upload = self.upload()[1]
        post = self.post('[报告.pdf](' + upload['url'] + ')')
        with self.fixture.store.connect() as db:
            record = db.execute('SELECT * FROM forum_attachments WHERE id=?', (upload['id'],)).fetchone()
            self.assertNotIn(PNG, record['content'])
            self.assertEqual(PNG, self.fixture.cipher.decrypt(record['content']))
        with tempfile.TemporaryDirectory() as directory:
            from pathlib import Path
            restored = Path(directory) / 'backup.sqlite3'
            restored.write_bytes(self.fixture.cipher.decrypt(self.fixture.store.backup_bytes()))
            with closing(sqlite3.connect(restored)) as db:
                content, post_id = db.execute('SELECT content,post_id FROM forum_attachments').fetchone()
                self.assertEqual(PNG, self.fixture.cipher.decrypt(content))
                self.assertEqual(post['id'], post_id)


if __name__ == '__main__':
    unittest.main()
