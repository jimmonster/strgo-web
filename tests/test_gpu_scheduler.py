"""Both server queues compete for the same durable GPU lock (no hardware)."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
import time
import unittest
from unittest.mock import patch
import uuid

from image_service.app import Service
from image_service import local_studio as studio
from image_service.security import Problem
from tests import test_ai_workspace as ai_fixtures
from tests.test_image_service import PNG


class GPUSchedulerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ai_fixtures.AIWorkspaceTests.setUpClass()

    def setUp(self):
        self.environment = patch.dict(os.environ, {'LOCAL_STUDIO_RESOURCE_GROUP': 'gpu-01', 'LOCAL_STUDIO_WORKER_TOKEN': 'x' * 40})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.fixture = ai_fixtures.AIWorkspaceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.app, self.ai, self.store = self.fixture.app, self.fixture.ai, self.fixture.store
        code, body, headers = self.app.dispatch('POST', studio.PREFIX + '/login', {'username': 'owner', 'password': 'preview-test-password'}, {'Origin': 'https://workflow.strgo.com'})
        self.headers = {'Origin': 'https://workflow.strgo.com', 'Cookie': headers['Set-Cookie'].split(';')[0], 'X-CSRF-Token': body['csrf']}
        self.worker('/poll', {'workflows': self.workflows()})

    def workflows(self):
        return [{'id': 'test-image', 'kind': 'image', 'label': 'Test', 'reference': False}]

    def worker(self, path, body):
        return self.app.dispatch('POST', studio.PREFIX + '/worker' + path, body, {'Authorization': 'Bearer ' + 'x' * 40})[1]

    def queued(self):
        return self.app.dispatch('POST', studio.PREFIX + '/jobs', {'workflow': 'test-image', 'prompt': 'Test', 'requestId': str(uuid.uuid4())}, self.headers)[1]

    def poll(self):
        return self.worker('/poll', {'workflows': self.workflows()})['job']

    def test_ai_and_workflow_competing_claims_have_one_winner(self):
        task = self.fixture.chat()
        self.queued()
        with ThreadPoolExecutor(max_workers=2) as pool:
            claims = [pool.submit(self.ai.claim, task['id']), pool.submit(self.poll)]
            results = [future.result() for future in claims]
        self.assertEqual(sum(result is not None for result in results), 1)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM ai_leases').fetchone()[0], 1)
        self.assertEqual(self.fixture.provider.calls, 0)

    def test_workflow_complete_holds_gpu_until_idle_unload_receipt(self):
        self.queued()
        job = self.poll()
        task = self.fixture.chat()
        self.assertIsNone(self.ai.claim(task['id']))
        self.worker('/jobs/' + job['id'] + '/chunk', {'claim': job['claim'], 'part': 0, 'data': base64.b64encode(PNG).decode()})
        self.worker('/jobs/' + job['id'] + '/complete', {'claim': job['claim'], 'parts': 1, 'sha256': hashlib.sha256(PNG).hexdigest()})
        self.assertIsNone(self.ai.claim(task['id']))
        with self.assertRaises(Problem):
            self.worker('/jobs/' + job['id'] + '/release', {'claim': job['claim'], 'gpuIdle': False})
        self.worker('/jobs/' + job['id'] + '/release', {'claim': job['claim'], 'gpuIdle': True})
        self.assertIsNotNone(self.ai.claim(task['id']))
        # A delayed old receipt cannot delete the new AI owner's lock.
        self.worker('/jobs/' + job['id'] + '/release', {'claim': job['claim'], 'gpuIdle': True})
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT task_id FROM ai_leases').fetchone()[0], task['id'])

    def test_expired_or_failed_workflow_does_not_free_gpu_or_regenerate(self):
        self.queued()
        job = self.poll()
        self.queued()
        with self.store.connect() as db:
            db.execute('UPDATE local_jobs SET expires=0 WHERE id=?', (job['id'],))
            db.execute('UPDATE ai_leases SET expires=0')
        self.assertIsNone(self.poll())
        task = self.fixture.music()
        self.assertIsNone(self.ai.claim(task['id']))
        self.assertTrue(self.worker('/jobs/' + job['id'] + '/heartbeat', {'claim': job['claim']})['terminal'])
        restarted = Service(self.store, self.fixture.storage, origin='https://strgo.com', start_worker=False)
        restarted.close()
        self.assertIsNone(self.poll())
        self.worker('/jobs/' + job['id'] + '/release', {'claim': job['claim'], 'gpuIdle': True})
        self.assertIsNotNone(self.poll())

    def test_running_task_cannot_release_or_bypass_drain(self):
        self.queued()
        with patch.dict(os.environ, {'LOCAL_STUDIO_DRAINING': '1'}):
            self.assertIsNone(self.poll())
        job = self.poll()
        with self.assertRaises(Problem):
            self.worker('/jobs/' + job['id'] + '/release', {'claim': job['claim'], 'gpuIdle': True})

    def test_upgrade_reserves_legacy_running_job_and_blocks_group_reassignment(self):
        self.queued()
        job = self.poll()
        with self.store.connect() as db:
            db.execute('DELETE FROM ai_leases')
        restarted = Service(self.store, self.fixture.storage, origin='https://strgo.com', start_worker=False)
        restarted.close()
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT task_id FROM ai_leases').fetchone()[0], 'workflow:' + job['id'])
        with patch.dict(os.environ, {'LOCAL_STUDIO_RESOURCE_GROUP': 'other-gpu'}), self.store.connect() as db:
            with self.assertRaises(RuntimeError):
                studio.reserve_existing(db)
