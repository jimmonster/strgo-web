from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import threading
import time
import unittest
from unittest.mock import patch
import uuid

from image_service.app import Service
from image_service.security import Problem
from image_service.store import Store
from tests import test_image_service as fixtures


class ImagePermissionsTests(unittest.TestCase):
    setUp = fixtures.ImageServiceTests.setUp
    tearDown = fixtures.ImageServiceTests.tearDown
    call = fixtures.ImageServiceTests.call
    register = fixtures.ImageServiceTests.register
    configure = fixtures.ImageServiceTests.configure
    create_job = fixtures.ImageServiceTests.create_job
    assert_problem = fixtures.ImageServiceTests.assert_problem

    def policy(self, limit):
        return self.call('PUT', '/generation-policy', {'dailyImageLimit': limit}, self.admin)[1]

    def quota(self, session):
        return self.call('GET', '/generation-quota', session=session)[1]

    def payload(self, count=1, request_id=None):
        return {'prompt': 'Daily image quota test', 'size': '1024x1024', 'count': count,
                'requestId': request_id or str(uuid.uuid4())}

    def test_members_delete_only_their_own_images_and_admins_can_moderate_all(self):
        member, other = self.register('creator'), self.register('other')
        job = self.create_job(member)
        self.app.run_job(job['id'])
        image = self.call('GET', '/jobs/' + job['id'], session=member)[1]['images'][0]
        self.assertEqual(job['userId'], member['user']['id'])
        self.assertEqual(job['username'], 'creator')
        self.assert_problem(404, lambda: self.call('DELETE', '/images/' + image['id'], {'role': 'admin'}, other))
        self.assert_problem(403, lambda: self.call('GET', '/jobs?scope=all', session=other))
        self.assertEqual(self.call('GET', '/jobs', session=self.admin)[1]['jobs'], [])
        all_jobs = self.call('GET', '/jobs?scope=all&search=lake', session=self.admin)[1]['jobs']
        self.assertEqual([item['id'] for item in all_jobs], [job['id']])
        self.assertEqual(self.call('GET', '/assets/' + image['id'], session=self.admin)[1], fixtures.PNG)
        self.assert_problem(404, lambda: self.call('PUT', '/images/' + image['id'] + '/favorite', {'favorite': True}, self.admin))
        self.assertEqual(self.call('DELETE', '/images/' + image['id'], session=member)[0], 200)
        second = self.create_job(member)
        self.app.run_job(second['id'])
        second_image = self.call('GET', '/jobs/' + second['id'], session=member)[1]['images'][0]
        self.assertEqual(self.call('DELETE', '/images/' + second_image['id'], session=self.admin)[0], 200)
        self.assertEqual(self.call('GET', '/jobs?scope=all', session=self.admin)[1]['jobs'], [])
        self.assert_problem(404, lambda: self.call('GET', '/assets/' + second_image['id'], session=member))

    def test_policy_requires_admin_csrf_origin_and_valid_integer(self):
        member = self.register('member')
        self.assert_problem(401, lambda: self.call('GET', '/generation-quota'))
        self.assert_problem(401, lambda: self.call('PUT', '/generation-policy', {'dailyImageLimit': 10}))
        self.assert_problem(403, lambda: self.call('PUT', '/generation-policy', {'dailyImageLimit': 10, 'role': 'admin'}, member))
        for headers in ({'X-CSRF-Token': 'wrong'}, {'Origin': 'https://evil.example'}):
            self.assert_problem(403, lambda: self.call('PUT', '/generation-policy', {'dailyImageLimit': 10}, self.admin, headers))
        for value in (-1, True, '10', 1.5, 100001, [], {}):
            with self.subTest(value=value):
                self.assert_problem(400, lambda: self.policy(value))
        self.assert_problem(400, lambda: self.call('PUT', '/generation-policy', {}, self.admin))
        for value in (0, 1, 100000, None):
            self.assertEqual(self.policy(value)['dailyImageLimit'], value)

    def test_default_unlimited_zero_pauses_members_and_admins_are_exempt(self):
        member = self.register('member')
        self.assertIsNone(self.quota(member)['dailyImageLimit'])
        self.configure(member)
        self.policy(0)
        quota = self.quota(member)
        self.assertEqual(quota['remaining'], 0)
        self.assertFalse(quota['exempt'])
        self.assertEqual(self.call('GET', '/session', session=member)[1]['generationQuota'], quota)
        self.assert_problem(429, lambda: self.call('POST', '/jobs', self.payload(), member))
        admin_job = self.create_job(count=4)
        self.assertTrue(admin_job['generationQuota']['exempt'])
        self.assertIsNone(admin_job['generationQuota']['remaining'])
        self.assertEqual(self.provider.calls, 0)
        self.policy(None)
        self.assertEqual(self.call('POST', '/jobs', self.payload(4), member)[0], 202)

    def test_daily_quota_counts_images_per_member_and_rejects_oversized_batches(self):
        member, other = self.register('member'), self.register('other')
        self.configure(member)
        self.policy(3)
        self.assert_problem(429, lambda: self.call('POST', '/jobs', self.payload(4), member))
        self.assertEqual(self.quota(member)['used'], 0)
        job = self.call('POST', '/jobs', self.payload(2), member)[1]
        self.assertEqual(job['generationQuota']['used'], 2)
        self.assertEqual(job['generationQuota']['remaining'], 1)
        self.assert_problem(429, lambda: self.call('POST', '/jobs', self.payload(2), member))
        self.assertEqual(self.call('POST', '/jobs', self.payload(), member)[0], 202)
        self.assertEqual(self.quota(member)['remaining'], 0)
        self.assertEqual(self.quota(other)['remaining'], 3)
        self.assertEqual(self.provider.calls, 0)

    def test_duplicate_submission_and_deletion_do_not_change_used_quota(self):
        member = self.register('member')
        self.configure(member)
        self.policy(2)
        payload = self.payload(2)
        job = self.call('POST', '/jobs', payload, member)[1]
        self.assertEqual(self.call('POST', '/jobs', payload, member)[1]['id'], job['id'])
        self.assertEqual(self.quota(member)['used'], 2)
        self.app.run_job(job['id'])
        images = self.call('GET', '/jobs/' + job['id'], session=member)[1]['images']
        for image in images:
            self.call('DELETE', '/images/' + image['id'], session=member)
        self.assertEqual(self.quota(member)['used'], 2)
        self.assert_problem(429, lambda: self.call('POST', '/jobs', self.payload(), member))
        self.assertEqual(self.provider.calls, 1)

    def test_failed_generation_and_storage_retry_do_not_refund_or_double_charge(self):
        member = self.register('member')
        self.configure(member)
        self.policy(3)
        job = self.call('POST', '/jobs', self.payload(), member)[1]
        with patch.object(self.provider, 'generate', side_effect=Problem(502, 'Provider failed')):
            self.app.run_job(job['id'])
        self.assertEqual(self.quota(member)['used'], 1)
        self.cloud.fail_images = True
        second = self.call('POST', '/jobs', self.payload(2), member)[1]
        self.app.run_job(second['id'])
        images = self.call('GET', '/jobs/' + second['id'], session=member)[1]['images']
        self.cloud.fail_images = False
        for image in images:
            self.app.upload_image(image['id'])
        self.assertEqual(self.quota(member)['used'], 3)
        self.assertEqual(self.provider.calls, 1)

    def test_quota_resets_at_beijing_midnight_using_submission_time(self):
        member = self.register('member')
        self.configure(member)
        self.policy(1)
        offset = 8 * 3600
        midnight = (int(time.time()) + offset) // 86400 * 86400 - offset + 86400
        with patch('image_service.app.time.time', return_value=midnight - 1):
            job = self.call('POST', '/jobs', self.payload(), member)[1]
            self.assertEqual(self.quota(member)['resetsAt'], midnight)
            self.assertEqual(self.quota(member)['remaining'], 0)
        with patch('image_service.app.time.time', return_value=midnight):
            quota = self.quota(member)
            self.assertEqual(quota['timezone'], 'Asia/Shanghai')
            self.assertEqual(quota['used'], 0)
            self.assertEqual(quota['resetsAt'], midnight + 86400)
            # A task completing after midnight remains charged to its submission day.
            self.app.run_job(job['id'])
            self.assertEqual(self.quota(member)['used'], 0)
            self.assertEqual(self.call('POST', '/jobs', self.payload(), member)[0], 202)
            self.assertEqual(self.quota(member)['used'], 1)

    def test_concurrent_submissions_cannot_exceed_quota_and_duplicate_is_idempotent(self):
        member = self.register('member')
        self.configure(member)
        self.policy(1)
        barrier = threading.Barrier(2)

        def submit(payload):
            barrier.wait(timeout=5)
            try:
                return self.call('POST', '/jobs', payload, member)[0]
            except Problem as error:
                return error.status

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, [self.payload(), self.payload()]))
        self.assertEqual(sorted(results), [202, 429])
        self.assertEqual(self.quota(member)['used'], 1)
        self.policy(2)
        payload = self.payload()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, [payload, payload]))
        self.assertEqual(sorted(results), [200, 202])
        self.assertEqual(self.quota(member)['used'], 2)

    def test_policy_changes_preserve_usage_and_survive_restart_and_backup(self):
        member = self.register('member')
        job = self.create_job(member, count=2)
        self.app.run_job(job['id'])
        self.policy(1)
        self.assertEqual(self.quota(member)['remaining'], 0)
        self.policy(5)
        self.assertEqual(self.quota(member)['remaining'], 3)
        self.app.close()
        self.store = Store(self.store.directory, self.cipher)
        self.app = Service(self.store, self.cloud, self.provider, fixtures.ORIGIN, start_worker=False)
        self.assertEqual(self.quota(member)['dailyImageLimit'], 5)
        self.assertEqual(self.quota(member)['used'], 2)
        self.app.backup()
        restored = Path(self.temp.name) / 'restored.sqlite3'
        restored.write_bytes(self.cipher.decrypt(self.cloud.objects[self.store.metadata('backup_key')]))
        with closing(sqlite3.connect(restored)) as db:
            self.assertEqual(db.execute("SELECT value FROM meta WHERE key='daily_image_limit'").fetchone()[0], '5')
