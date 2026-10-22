"""Forum permissions and shared-account integration, using the real store/service."""
import sqlite3
from contextlib import closing
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from image_service.security import Problem
from image_service.store import Store
from tests import test_image_service as fixtures


class ForumTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ImageServiceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.admin = self.fixture.admin
        self.alice = self.fixture.register('alice')
        self.bob = self.fixture.register('bob')

    def call(self, method='GET', path='', body=None, session=None, extra=None):
        return self.fixture.call(method, '/forum/posts' + path, body, session, extra)

    def post(self, session=None, **changes):
        return self.call('POST', body={'title': '新的想法', 'body': '分享创作与探索。', 'category': 'general', **changes}, session=session or self.alice)[1]

    def problem(self, status, action):
        with self.assertRaises(Problem) as caught:
            action()
        self.assertEqual(status, caught.exception.status)

    def test_login_required_for_reads_and_writes_and_origin_csrf_required(self):
        self.problem(401, lambda: self.call())
        self.problem(401, lambda: self.call('POST', body={'title': 'test'}))
        for extra in ({'Origin': 'https://other.example'}, {'X-CSRF-Token': ''}, {'X-CSRF-Token': 'invalid'}):
            self.problem(403, lambda: self.call('POST', session=self.alice, extra=extra))
        self.assertEqual(0, self.call(session=self.alice)[1]['total'])

    def test_same_login_identity_is_shared_with_images_terminal_and_forum(self):
        for session in (self.alice, self.admin):
            image = self.fixture.call('GET', '/session', session=session)[1]
            terminal = self.fixture.call('GET', '/terminal-session', session=session)[1]
            post = self.post(session)
            self.assertEqual(image['user'], terminal['user'])
            self.assertEqual(image['user'], post['author'])
        self.fixture.call('POST', '/logout', session=self.alice)
        self.problem(401, lambda: self.call(session=self.alice))

    def test_posts_work_without_image_provider_configuration_or_storage(self):
        self.fixture.cloud.ready = False
        self.post()
        self.assertEqual(1, self.call(session=self.alice)[1]['total'])

    def test_member_only_deletes_own_posts_and_admin_deletes_any_post(self):
        alice = self.post()
        bob = self.post(self.bob)
        feed = self.call(session=self.alice)[1]['posts']
        self.assertEqual({alice['id']: True, bob['id']: False}, {p['id']: p['canDelete'] for p in feed})
        self.problem(403, lambda: self.call('DELETE', '/' + bob['id'], session=self.alice))
        self.call('DELETE', '/' + alice['id'], session=self.alice)
        self.problem(404, lambda: self.call(path='/' + alice['id'], session=self.alice))
        self.call('DELETE', '/' + bob['id'], session=self.admin)
        self.assertEqual(0, self.call(session=self.admin)[1]['total'])

    def test_identity_role_and_pinned_fields_cannot_be_forged(self):
        post = self.post(user_id=self.admin['user']['id'], role='admin', pinned=True, author=self.admin['user'])
        self.assertEqual(self.alice['user']['id'], post['author']['id'])
        self.assertEqual('member', post['author']['role'])
        self.assertFalse(post['pinned'])
        self.problem(403, lambda: self.call('PUT', '/' + post['id'] + '/pin', {'pinned': True}, self.alice))

    def test_admin_pin_order_unpin_and_validation(self):
        with patch('image_service.forum.time.time', return_value=time.time() - 500):
            old = self.post()
        new = self.post(self.bob)
        path = '/' + old['id'] + '/pin'
        self.problem(400, lambda: self.call('PUT', path, {'pinned': 1}, self.admin))
        self.call('PUT', path, {'pinned': True}, self.admin)
        self.assertEqual(old['id'], self.call(session=self.bob)[1]['posts'][0]['id'])
        self.call('PUT', path, {'pinned': False}, self.admin)
        self.assertEqual(new['id'], self.call(session=self.bob)[1]['posts'][0]['id'])

    def test_search_categories_mine_and_literal_sql_wildcards(self):
        own = self.post(category='ai', title='AI 100% 创作')
        self.post(self.bob, category='terminal', title='终端里的 AI', body='hello_world')
        self.post(self.admin, title='Hello community')
        self.assertEqual(own['id'], self.call(path='?scope=mine&category=ai&q=100%25', session=self.alice)[1]['posts'][0]['id'])
        self.assertEqual(2, self.call(path='?q=AI', session=self.alice)[1]['total'])
        self.assertEqual(1, self.call(path='?q=hello_WORLD', session=self.alice)[1]['total'])
        self.assertEqual(0, self.call(path='?q=%27%20OR%201%3D1--', session=self.alice)[1]['total'])
        self.assertEqual({'posts': 3, 'contributors': 3, 'mine': 1}, self.call(session=self.alice)[1]['stats'])

    def test_pagination_is_bounded_and_has_no_overlap(self):
        # Different authors keep the per-member posting limit enabled.
        for author in (self.alice, self.bob, self.admin):
            for index in range(8):
                self.post(author, title=str(index))
        first = self.call(session=self.alice)[1]
        second = self.call(path='?offset=20', session=self.alice)[1]
        self.assertEqual(20, len(first['posts']))
        self.assertEqual(4, len(second['posts']))
        self.assertTrue(first['hasMore']); self.assertFalse(second['hasMore'])
        self.assertEqual(24, len({p['id'] for p in first['posts'] + second['posts']}))

    def test_invalid_input_and_queries_do_not_create_posts(self):
        for changes in ({'title': ''}, {'title': ' '}, {'title': 'x' * 81}, {'body': None}, {'body': 'x' * 10001}, {'body': '\x00'}, {'category': []}, {'category': 'unknown'}):
            self.problem(400, lambda: self.post(**changes))
        for query in ('?offset=-1', '?offset=Infinity', '?offset=99999999', '?category=nope', '?scope=admin', '?q=' + 'x' * 81):
            self.problem(400, lambda: self.call(path=query, session=self.admin))
        self.assertEqual(0, self.call(session=self.admin)[1]['total'])

    def test_full_body_is_available_only_on_detail_and_rendered_as_plain_text(self):
        body = '<script>alert("test")</script>\n' + '文字' * 180
        post = self.post(body=body)
        self.assertEqual(body, self.call(path='/' + post['id'], session=self.bob)[1]['body'])
        self.assertEqual(body[:240], self.call(session=self.bob)[1]['posts'][0]['body'])

    def test_rate_limit_blocks_post_spam(self):
        for index in range(10):
            self.post(title=str(index))
        self.problem(429, lambda: self.post())
        self.assertEqual(10, self.call(session=self.alice)[1]['total'])

    def test_deleted_post_cannot_be_pinned_or_deleted_again(self):
        post = self.post()
        self.call('DELETE', '/' + post['id'], session=self.alice)
        self.problem(404, lambda: self.call('DELETE', '/' + post['id'], session=self.admin))
        self.problem(404, lambda: self.call('PUT', '/' + post['id'] + '/pin', {'pinned': True}, self.admin))

    def test_concurrent_delete_only_succeeds_once(self):
        post = self.post()
        def remove(_):
            try:
                return self.call('DELETE', '/' + post['id'], session=self.admin)[0]
            except Problem as error:
                return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual([200, 404], sorted(pool.map(remove, range(2))))

    def test_additive_migration_preserves_accounts_and_posts(self):
        post = self.post()
        Store(self.fixture.temp.name, self.fixture.cipher)
        self.assertEqual(post['id'], self.call(session=self.alice)[1]['posts'][0]['id'])
        self.assertEqual(self.alice['user'], self.fixture.call('GET', '/terminal-session', session=self.alice)[1]['user'])

    def test_existing_encrypted_database_backup_includes_forum(self):
        self.post()
        backup = self.fixture.store.backup_bytes()
        target = self.fixture.store.directory / 'forum-backup.sqlite3'
        target.write_bytes(self.fixture.cipher.decrypt(backup))
        with closing(sqlite3.connect(target)) as db:
            self.assertEqual(1, db.execute('SELECT COUNT(*) FROM forum_posts').fetchone()[0])

    def test_unknown_paths_and_methods_fail_closed(self):
        self.problem(404, lambda: self.call(path='/../users', session=self.admin))
        self.problem(405, lambda: self.call('PUT', session=self.admin))
        self.problem(405, lambda: self.call('POST', '/' + 'a' * 32, {}, self.admin))


if __name__ == '__main__':
    unittest.main()
