"""Real SQLite/shared-session regression for edits, replies and private notifications."""
import sqlite3
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

from image_service.security import Problem
from image_service.store import Store
from tests import test_forum_service as forum_fixtures


class DiscussionTests(unittest.TestCase):
    setUp = forum_fixtures.ForumTests.setUp
    call = forum_fixtures.ForumTests.call
    post = forum_fixtures.ForumTests.post
    problem = forum_fixtures.ForumTests.problem

    def comment(self, post, session=None, **fields):
        return self.call('POST', '/' + post['id'] + '/comments',
                         {'body': '收到，继续一起探索。', 'request_id': uuid.uuid4().hex, **fields}, session or self.bob)

    def inbox(self, session=None, suffix='', method='GET', body=None):
        return self.fixture.call(method, '/forum/notifications' + suffix, body, session or self.alice)[1]

    def edit(self, post, session=None, **fields):
        return self.call('PUT', '/' + post['id'], {'title': '更新后的标题', 'body': '保留讨论，更新内容。',
                         'category': 'ai', 'revision': post['revision'], **fields}, session or self.alice)[1]

    def test_only_author_can_edit_and_revision_prevents_lost_updates(self):
        post = self.post()
        self.assertTrue(post['canEdit'])
        self.assertFalse(self.call(path='/' + post['id'], session=self.bob)[1]['canEdit'])
        for session in (self.bob, self.admin):
            self.problem(403, lambda: self.edit(post, session))
        updated = self.edit(post)
        self.assertEqual(2, updated['revision'])
        self.assertGreater(updated['updated'], 0)
        self.assertEqual(post['author'], updated['author'])
        self.problem(409, lambda: self.edit(post))
        self.problem(400, lambda: self.edit(updated, body=' '))
        self.problem(400, lambda: self.edit(updated, category=[]))
        self.assertEqual('更新后的标题', self.call(path='/' + post['id'], session=self.alice)[1]['title'])

    def test_simultaneous_edits_accept_exactly_one_revision(self):
        post = self.post()
        def update(index):
            try:
                self.edit(post, title=str(index))
                return 200
            except Problem as error:
                return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual([200, 409], sorted(pool.map(update, range(2))))

    def test_comment_retry_is_atomic_and_notifies_once(self):
        post, key = self.post(), uuid.uuid4().hex
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: self.comment(post, request_id=key), range(2)))
        self.assertEqual([200, 201], sorted(r[0] for r in responses))
        self.assertEqual(responses[0][1]['id'], responses[1][1]['id'])
        self.assertEqual(1, self.call(path='/' + post['id'], session=self.alice)[1]['commentCount'])
        self.assertEqual(1, self.inbox()['total'])
        self.problem(409, lambda: self.comment(post, request_id=key, body='不同的请求'))

    def test_comment_permissions_validation_and_plain_text(self):
        post = self.post()
        for body in (' ', None, '\x00', 'x' * 3001):
            self.problem(400, lambda: self.comment(post, body=body))
        self.problem(400, lambda: self.comment(post, request_id='invalid'))
        comment = self.comment(post, body='<script>hello</script>\n你好 👋')[1]
        self.assertEqual(self.bob['user'], comment['author'])
        path = '/' + post['id'] + '/comments'
        self.assertEqual(comment['body'], self.call(path=path, session=self.alice)[1]['comments'][0]['body'])
        self.problem(403, lambda: self.call('DELETE', path + '/' + comment['id'], session=self.alice))
        self.call('DELETE', path + '/' + comment['id'], session=self.admin)
        self.assertEqual(0, self.call(path=path, session=self.bob)[1]['total'])
        self.assertEqual(0, self.inbox()['unreadCount'])

    def test_comment_pagination_has_stable_order_and_bounded_page(self):
        post = self.post()
        for index in range(25):
            self.comment(post, body=str(index))
        path = '/' + post['id'] + '/comments'
        first = self.call(path=path, session=self.alice)[1]
        second = self.call(path=path + '?offset=20', session=self.alice)[1]
        self.assertEqual([20, 5], [len(first['comments']), len(second['comments'])])
        self.assertEqual(25, len({row['id'] for row in first['comments'] + second['comments']}))
        self.assertTrue(first['hasMore']); self.assertFalse(second['hasMore'])
        self.problem(400, lambda: self.call(path=path + '?offset=-1', session=self.alice))

    def test_notification_recipient_scope_and_read_snapshot(self):
        own, other = self.post(), self.post(self.admin)
        self.comment(own); self.comment(other)
        notice = self.inbox()['notifications'][0]
        admin_notice = self.inbox(self.admin)['notifications'][0]
        self.assertEqual(1, self.inbox()['unreadCount'])
        self.assertEqual(0, self.inbox(self.bob)['total'])
        self.inbox(suffix='/read', method='PUT', body={'ids': [admin_notice['id']]})
        self.assertEqual(1, self.inbox(self.admin)['unreadCount'])
        self.comment(own, body='刚刚到达的新回复')
        self.inbox(suffix='/read', method='PUT', body={'ids': [notice['id']]})
        self.assertEqual(1, self.inbox()['unreadCount'])
        self.problem(400, lambda: self.inbox(suffix='/read', method='PUT', body={'ids': []}))

    def test_deleted_post_hides_comments_and_notifications(self):
        post = self.post(); self.comment(post)
        self.call('DELETE', '/' + post['id'], session=self.alice)
        self.assertEqual(0, self.inbox()['total'])
        self.problem(404, lambda: self.call(path='/' + post['id'] + '/comments', session=self.bob))
        self.problem(404, lambda: self.comment(post))

    def test_no_notification_for_self_reply_and_deleted_retry_never_resurrects(self):
        post, key = self.post(), uuid.uuid4().hex
        comment = self.comment(post, self.alice, request_id=key)[1]
        self.assertEqual(0, self.inbox()['total'])
        self.call('DELETE', '/' + post['id'] + '/comments/' + comment['id'], session=self.alice)
        self.problem(409, lambda: self.comment(post, self.alice, request_id=key))

    def test_reply_limit_and_csrf_are_enforced(self):
        post = self.post()
        path = '/' + post['id'] + '/comments'
        self.problem(401, lambda: self.call(path=path))
        self.problem(403, lambda: self.call('POST', path, {'body': 'hello'}, self.bob, {'X-CSRF-Token': ''}))
        for index in range(30):
            self.comment(post, body=str(index))
        self.problem(429, lambda: self.comment(post))

    def test_additive_migration_and_backup_keep_entire_discussion(self):
        post = self.post(); self.comment(post)
        Store(self.fixture.temp.name, self.fixture.cipher)
        self.assertEqual(1, self.call(path='/' + post['id'], session=self.alice)[1]['revision'])
        target = self.fixture.store.directory / 'discussion-backup.sqlite3'
        target.write_bytes(self.fixture.cipher.decrypt(self.fixture.store.backup_bytes()))
        with closing(sqlite3.connect(target)) as db:
            self.assertEqual(1, db.execute('SELECT COUNT(*) FROM forum_comments').fetchone()[0])
            self.assertEqual(1, db.execute('SELECT COUNT(*) FROM forum_notifications').fetchone()[0])

    def test_new_endpoints_reject_unknown_methods_and_parent_comment_mismatch(self):
        post, other = self.post(), self.post()
        comment = self.comment(post)[1]
        self.problem(404, lambda: self.call('DELETE', '/' + other['id'] + '/comments/' + comment['id'], session=self.bob))
        self.problem(405, lambda: self.call('PUT', '/' + post['id'] + '/comments', {}, self.bob))
        self.problem(405, lambda: self.inbox(method='POST', body={}))


if __name__ == '__main__':
    unittest.main()
