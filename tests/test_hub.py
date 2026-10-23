import json
import sqlite3
import time
import unittest
import uuid
from unittest.mock import patch

from image_service import hub
from image_service.security import Problem
import test_image_service as image_tests


class HubTests(unittest.TestCase):
    setUp = image_tests.ImageServiceTests.setUp
    tearDown = image_tests.ImageServiceTests.tearDown
    call = image_tests.ImageServiceTests.call
    register = image_tests.ImageServiceTests.register
    assert_problem = image_tests.ImageServiceTests.assert_problem

    def seed(self, session, kind='image', status='complete', created=None, asset=False, image_error=''):
        owner = session['user']['id']
        task_id, asset_id = uuid.uuid4().hex, uuid.uuid4().hex
        now = int(time.time()) if created is None else created
        with self.store.connect() as db:
            if kind == 'image':
                db.execute('INSERT INTO jobs(id,user_id,prompt,model,size,quality,count,status,created,request_id,provider_config) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                           (task_id, owner, 'private image prompt', 'image-model', '1024x1024', '', 1, status, now, task_id, b'private-config'))
                if asset:
                    db.execute('INSERT INTO images(id,job_id,user_id,object_key,mime,extension,bytes,sha256,state,error,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                               (asset_id, task_id, owner, 'private-disk-key/' + asset_id, 'image/png', 'png', 72, 'hash', 'pending' if image_error else 'saved', image_error, now))
            else:
                db.execute('INSERT OR REPLACE INTO ai_members(user_id,chat,music) VALUES(?,1,1)', (owner,))
                db.execute('INSERT OR IGNORE INTO ai_model_grants VALUES(?,?)', (owner, 'test-' + kind))
                db.execute('INSERT INTO ai_tasks(id,user_id,kind,model_id,model_revision,config,input,state,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',
                           (task_id, owner, kind, 'test-' + kind, 1, b'private-config', '{"prompt":"private-task-input"}', status, now, now))
                if asset:
                    db.execute('INSERT INTO ai_assets(id,user_id,task_id,title,object_key,mime,bytes,sha256,duration,created) VALUES(?,?,?,?,?,?,?,?,?,?)',
                               (asset_id, owner, task_id, 'My private music', 'private-disk-key/' + asset_id, 'audio/mpeg', 99, 'hash', 15, now))
        return task_id, asset_id

    def get(self, kind='tasks', query='', session=None):
        return self.call('GET', '/hub/' + kind + query, session=session or self.admin)[1]

    def test_owner_isolation_including_admin_and_private_field_projection(self):
        member = self.register('member')
        mine = [self.seed(self.admin, asset=True), self.seed(self.admin, 'music', 'SUCCEEDED', asset=True)]
        self.seed(member, asset=True); self.seed(member, 'music', 'SUCCEEDED', asset=True)
        for kind, index in [('tasks', 0), ('assets', 1)]:
            result = self.get(kind)
            self.assertEqual({x['id'] for x in result['items']}, {x[index] for x in mine})
            self.assertEqual(result['user_id'], self.admin['user']['id'])
            encoded = json.dumps(result)
            for secret in ['private-config', 'private-task-input', 'private-disk-key', 'object_key', 'provider_config']:
                self.assertNotIn(secret, encoded)
            self.assertEqual(len(self.get(kind, session=member)['items']), 2)
        self.assert_problem(401, lambda: self.call('GET', '/hub/tasks'))

    def test_revoke_module_model_expiry_and_disabled_member(self):
        self.seed(self.admin, 'music', 'SUCCEEDED', asset=True)
        owner = self.admin['user']['id']
        with self.store.connect() as db: db.execute('DELETE FROM ai_model_grants WHERE user_id=?', (owner,))
        self.assertFalse(self.get()['items']); self.assertFalse(self.get('assets')['items'])
        with self.store.connect() as db:
            db.execute('INSERT INTO ai_model_grants VALUES(?,?)', (owner, 'test-music'))
            db.execute('UPDATE ai_members SET music=0 WHERE user_id=?', (owner,))
        self.assertFalse(self.get('tasks', '?source=music')['items'])
        self.assertEqual(self.get('tasks', '?source=music')['sources'][0]['status'], 'permission_required')
        with self.store.connect() as db: db.execute('UPDATE ai_members SET music=1,expires=1 WHERE user_id=?', (owner,))
        self.assertFalse(self.get()['items'])
        with self.store.connect() as db: db.execute("UPDATE ai_members SET status='disabled' WHERE user_id=?", (owner,))
        self.assert_problem(401, lambda: self.get())

    def test_status_mapping_separates_save_failure_from_generation_and_unknown(self):
        self.seed(self.admin, status='uploading', asset=True, image_error='disk temporarily unavailable')
        self.seed(self.admin, status='failed')
        self.seed(self.admin, 'music', 'RECONCILING')
        self.seed(self.admin, 'chat', 'UNRECOGNIZED')
        states = {item['status'] for item in self.get()['items']}
        self.assertEqual(states, {'save_failed', 'failed', 'unknown'})
        self.assertEqual(len(self.get('tasks', '?status=unknown')['items']), 2)
        image = self.get('assets')['items'][0]
        retry = next(a for a in image['actions'] if a['type'] == 'retry_save')
        self.assertEqual(retry['endpoint'], '/api/image/images/' + image['id'] + '/retry')
        self.assertEqual(self.provider.calls, 0)

    def test_cursor_merges_equal_timestamps_without_duplicates_or_filter_drift(self):
        for _ in range(4):
            self.seed(self.admin, created=100)
            self.seed(self.admin, 'music', 'QUEUED', created=100)
            self.seed(self.admin, 'chat', 'SUCCEEDED', created=100)
        all_items, cursor = [], ''
        for _ in range(8):
            result = self.get('tasks', '?limit=2' + ('&cursor=' + cursor if cursor else ''))
            all_items.extend(result['items']); cursor = result['next_cursor']
            if not cursor: break
        self.assertEqual(len(all_items), 12)
        keys = [item['key'] for item in all_items]
        self.assertEqual(keys, sorted(set(keys), reverse=True))
        first = self.get('tasks', '?limit=2')['next_cursor']
        self.assert_problem(400, lambda: self.get('tasks', '?source=music&cursor=' + first))
        self.assert_problem(400, lambda: self.get('assets', '?cursor=' + first))
        for query in ['?cursor=!', '?cursor=a', '?limit=0', '?limit=51', '?status=bad', '?source=workflow']:
            self.assert_problem(400, lambda: self.get('tasks', query))

    def test_partial_failure_is_explicit_and_does_not_hide_other_source(self):
        self.seed(self.admin); self.seed(self.admin, 'music', 'QUEUED')
        with patch('image_service.hub.ai_rows', side_effect=sqlite3.OperationalError('private-db-path')):
            result = self.get()
        self.assertTrue(result['partial'])
        self.assertEqual([i['source'] for i in result['items']], ['image'])
        self.assertIn({'id': 'ai', 'status': 'unavailable'}, result['sources'])
        self.assertNotIn('private-db-path', json.dumps(result))

    def test_retention_deleted_assets_and_no_writes(self):
        self.seed(self.admin, 'music', 'SUCCEEDED', created=int(time.time()) - 91 * 86400, asset=True)
        _, current = self.seed(self.admin, 'music', 'SUCCEEDED', asset=True)
        task, image = self.seed(self.admin, asset=True)
        with self.store.connect() as db:
            db.execute('UPDATE ai_assets SET delete_pending=1 WHERE id=?', (current,))
            db.execute('UPDATE jobs SET deleted=1 WHERE id=?', (task,))
        self.assertFalse(self.get('assets')['items'])
        for method in ['POST', 'PUT', 'DELETE']:
            self.assert_problem(405, lambda: self.call(method, '/hub/tasks', {}, self.admin))
        self.assert_problem(404, lambda: self.get('unknown'))
        self.assertEqual(self.provider.calls, 0)


if __name__ == '__main__': unittest.main()
