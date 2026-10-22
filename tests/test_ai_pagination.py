import base64
import unittest

from tests import test_ai_workspace as fixtures


class AIPaginationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixtures.AIWorkspaceTests.setUpClass()

    def setUp(self):
        self.fixture = fixtures.AIWorkspaceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.store, self.call = self.fixture.store, self.fixture.call

    def seed(self, count=105):
        with self.store.connect() as db:
            for n in range(1, count + 1):
                identifier = f'{n:032x}'
                db.execute('''INSERT INTO ai_tasks(id,user_id,kind,model_id,model_revision,config,input,state,created,updated)
                    VALUES(?,?,'music','ace-step',1,?,'{}','SUCCEEDED',1700000000,1700000000)''', (identifier, self.fixture.member['id'], b'unused'))
                db.execute('INSERT INTO ai_assets VALUES(?,?,?,?,?,?,?,?,?,?,0,0)', (f'{n + 500:032x}', self.fixture.member['id'], identifier, 'Song', 'test/' + identifier, 'audio/wav', 100, 'a' * 64, 30, 1700000000))
                db.execute("INSERT INTO ai_conversations VALUES(?,?,?,'global',NULL,1700000000,1700000000,0)", (f'{n + 1000:032x}', self.fixture.member['id'], 'Searchable ' + str(n)))

    def collect(self, path):
        rows, cursor = [], None
        while True:
            result = self.call('GET', path + ('&' if '?' in path else '?') + 'limit=17' + ('&cursor=' + cursor if cursor else ''))
            self.assertLessEqual(len(result['items']), 17)
            rows.extend(result['items'])
            cursor = result['next_cursor']
            if not cursor:
                return rows

    def test_equal_timestamps_paginate_all_private_tasks_assets_and_conversations(self):
        self.seed()
        for path in ('/tasks', '/music/jobs', '/assets', '/conversations?scope=global'):
            items = self.collect(path)
            self.assertEqual(len(items), 105)
            self.assertEqual(len({item['id'] for item in items}), 105)
            self.assertEqual(len(self.call('GET', path)), 100)  # Compatibility for existing clients.
            self.assertEqual(self.call('GET', path + ('&' if '?' in path else '?') + 'limit=20', user=self.fixture.stranger)['items'], [])

    def test_cursor_survives_deleted_boundary_and_does_not_include_newer_inserts(self):
        self.seed(25)
        first = self.call('GET', '/assets?limit=10')
        boundary = first['items'][-1]['id']
        with self.store.connect() as db:
            db.execute('UPDATE ai_assets SET deleted=1 WHERE id=?', (boundary,))
            db.execute('UPDATE ai_assets SET created=1700000001 WHERE id=?', (first['items'][0]['id'],))
        second = self.call('GET', '/assets?limit=20&cursor=' + first['next_cursor'])
        self.assertEqual(len(second['items']), 15)
        self.assertFalse({row['id'] for row in first['items']} & {row['id'] for row in second['items']})
        self.assertIsNone(second['next_cursor'])

    def test_music_filter_precedes_limit_and_conversation_search_is_server_side(self):
        self.seed()
        with self.store.connect() as db:
            db.execute("UPDATE ai_tasks SET kind='chat' WHERE id<>?", (f'{1:032x}',))
            db.execute("UPDATE ai_conversations SET deleted=1 WHERE id=?", (f'{1001:032x}',))
        self.assertEqual([row['id'] for row in self.call('GET', '/music/jobs')], [f'{1:032x}'])
        self.assertEqual(len(self.collect('/conversations?scope=global&q=Searchable+105')), 1)
        self.assertEqual(self.collect('/conversations?scope=music'), [])
        self.assertEqual(self.collect('/conversations?scope=global&q=%25'), [])

    def test_invalid_cursor_and_page_size_are_rejected(self):
        malformed = base64.urlsafe_b64encode(b'[true,"id"]').decode().rstrip('=')
        for path in ('/tasks', '/assets', '/music/jobs', '/conversations'):
            for query in ('limit=0', 'limit=101', 'limit=NaN'):
                self.fixture.problem('INVALID_PAGE', lambda: self.call('GET', path + '?' + query))
            for query in ('cursor=invalid!', 'cursor=' + malformed, 'cursor=' + 'x' * 201):
                self.fixture.problem('INVALID_CURSOR', lambda: self.call('GET', path + '?' + query))
