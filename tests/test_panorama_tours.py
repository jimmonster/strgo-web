"""Private fixed cameras share a single paid world and immutable cached asset."""
import base64
from concurrent.futures import ThreadPoolExecutor
import json
import os
import unittest
from unittest.mock import patch
import uuid

from image_service.panorama_tours import PanoramaTours, WorldProvider
from image_service.security import Problem
from tests import test_image_service as fixture

PNG = fixture.PNG


class FakeWorld:
    enabled = True

    def __init__(self):
        self.starts, self.downloads = [], 0
        self.result = {'id': 'world-one', 'assets': {'splats': {'spz_urls': {'500k': 'https://assets.example/private.spz?token=private'},
                                                              'semantics_metadata': {'metric_scale_factor': 1.5, 'ground_plane_offset': .2}}}}
        self.done, self.fail = True, False

    def start(self, row, reference):
        self.starts.append((dict(row), reference))
        return {'operation_id': 'operation-one'}

    def operation(self, identifier):
        assert identifier == 'operation-one'
        return {'done': self.done, 'response': self.result, 'error': {'code': 1} if self.fail else None}

    def world(self, identifier):
        assert identifier == 'world-one'
        return self.result

    def asset(self, url):
        assert url.startswith('https://assets.example/')
        self.downloads += 1
        return b'ply\none immutable test scene'


class PanoramaTourTests(unittest.TestCase):
    call = fixture.ImageServiceTests.call
    register = fixture.ImageServiceTests.register
    assert_problem = fixture.ImageServiceTests.assert_problem

    def setUp(self):
        fixture.ImageServiceTests.setUp(self)
        self.member = self.register('fixed-member')
        self.provider = FakeWorld()
        self.tours = self.app.panorama_tours
        self.tours.provider = self.provider
        self.submitter = patch.object(self.app, '_submit')
        self.submitter.start()

    def tearDown(self):
        self.submitter.stop()
        fixture.ImageServiceTests.tearDown(self)

    def create(self, **values):
        body = {'scene': 'A single courtyard', 'cameraCount': 3, 'requestId': str(uuid.uuid4()), **values}
        return self.call('POST', '/panorama-tours', body, self.member)[1]

    def ready(self, **values):
        project = self.create(**values)
        self.tours.start(project['id'])
        return self.call('GET', '/panorama-tours/' + project['id'], session=self.member)[1]

    def test_three_or_five_cameras_use_exactly_one_shared_world_and_cache(self):
        project = self.ready(cameraCount=5)
        self.tours.start(project['id'])
        self.assertEqual(len(self.provider.starts), 1)
        self.assertEqual(project['status'], 'ready')
        self.assertEqual(project['metricScale'], 1.5)
        self.assertEqual(len(project['cameras']), 5)
        self.assertEqual(len({tuple(camera['position']) for camera in project['cameras']}), 5)
        self.assertNotIn('private.spz', json.dumps(project))
        self.assertNotIn('world-one', json.dumps(project))
        path = '/panorama-tours/' + project['id'] + '/splat'
        first = self.call('GET', path, session=self.member)[1]
        second = self.call('GET', path, session=self.member)[1]
        self.assertEqual(first, second)
        self.assertEqual(self.provider.downloads, 1)
        self.assertEqual(len(self.provider.starts), 1)
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM panorama_tours').fetchone()
            self.assertNotIn(b'private.spz', row['result'])
            self.assertEqual(row['asset_key'], 'tests/panorama-worlds/' + self.member['user']['id'] + '/' + project['id'] + '.spz')

    def test_image_only_input_is_encrypted_and_cleared_after_submission(self):
        project = self.create(scene='', referenceImage={'mime': 'image/png', 'data': base64.b64encode(PNG).decode()}, isPano=True)
        row = self.tours.get(project['id'])
        self.assertNotIn(PNG, row['reference'])
        self.assertEqual(self.store.cipher.decrypt(row['reference']), PNG)
        self.tours.start(project['id'])
        self.assertEqual(self.provider.starts[0][1], PNG)
        self.assertTrue(self.provider.starts[0][0]['is_pano'])
        self.assertIsNone(self.tours.get(project['id'])['reference'])

    def test_retry_request_is_idempotent_even_when_service_is_later_disabled(self):
        request_id = str(uuid.uuid4())
        first = self.create(requestId=request_id)
        self.provider.enabled = False
        second = self.create(requestId=request_id)
        self.assertEqual(first['id'], second['id'])
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM panorama_tours').fetchone()[0], 1)
        self.assertEqual(self.provider.starts, [])

    def test_concurrent_retries_create_one_project_and_one_quota_reservation(self):
        request_id = str(uuid.uuid4())
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.create(requestId=request_id), range(2)))
        self.assertEqual(results[0]['id'], results[1]['id'])
        self.assertEqual(self.tours.quota(self.member['user'])['used'], 1)

    def test_members_and_administrators_cannot_read_another_owners_world(self):
        project = self.ready()
        stranger = self.register('fixed-stranger')
        for session in (stranger, self.admin):
            self.assertEqual(self.call('GET', '/panorama-tours', session=session)[1]['projects'], [])
            for suffix in ('', '/splat'):
                self.assert_problem(404, lambda suffix=suffix: self.call('GET', '/panorama-tours/' + project['id'] + suffix, session=session))
        self.assertEqual(self.provider.downloads, 0)

    def test_quota_failure_and_restart_never_repeat_a_paid_submission(self):
        with patch.dict(os.environ, {'PANORAMA_WORLD_DAILY_LIMIT': '1'}):
            project = self.create()
            self.provider.fail = True
            self.tours.start(project['id'])
            self.call('GET', '/panorama-tours/' + project['id'], session=self.member)
            self.tours.start(project['id'])
            self.assertEqual(len(self.provider.starts), 1)
            self.assert_problem(429, self.create)
            recovered = PanoramaTours(self.app, self.provider)
            self.assertEqual(recovered.get(project['id'])['status'], 'failed')
            self.assertEqual(recovered.quota(self.member['user'])['remaining'], 0)

    def test_interrupted_or_ambiguous_submission_is_not_automatically_resubmitted(self):
        project = self.create()
        with self.store.connect() as db:
            db.execute("UPDATE panorama_tours SET status='submitting',reference=?", (b'encrypted private input',))
        recovered = PanoramaTours(self.app, self.provider)
        recovered.start(project['id'])
        self.assertEqual(recovered.get(project['id'])['status'], 'unknown')
        self.assertIsNone(recovered.get(project['id'])['reference'])
        self.assertEqual(self.provider.starts, [])

    def test_invalid_inputs_and_missing_configuration_never_start_generation(self):
        for body in ({'scene': ''}, {'cameraCount': 4}, {'isPano': 'yes'}, {'referenceImage': {'mime': 'image/png', 'data': 'garbage'}}):
            self.assert_problem(400, lambda body=body: self.create(**body))
        self.provider.enabled = False
        self.assert_problem(503, self.create)
        self.assertEqual(self.provider.starts, [])
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM panorama_tours').fetchone()[0], 0)

    def test_storage_preflight_failure_does_not_call_the_world_model(self):
        project = self.create()
        with patch.object(self.cloud, 'put', side_effect=Problem(507, 'disk full')):
            self.tours.start(project['id'])
        self.assertEqual(self.provider.starts, [])
        self.assertEqual(self.tours.get(project['id'])['status'], 'failed')

    def test_common_origin_and_csrf_checks_apply_to_the_new_endpoint(self):
        body = {'scene': 'room', 'requestId': str(uuid.uuid4()), 'cameraCount': 3}
        for extra in ({'Origin': 'https://other.example'}, {'X-CSRF-Token': 'wrong'}):
            self.assert_problem(403, lambda extra=extra: self.call('POST', '/panorama-tours', body, self.member, extra))

    def test_world_provider_uses_private_single_world_contract_and_separate_asset_transport(self):
        with patch.dict(os.environ, {'PANORAMA_WORLD_API_KEY': 'private-test-key'}), patch('image_service.panorama_tours.https_request', return_value=b'{"operation_id":"one"}') as transport:
            provider = WorldProvider()
            provider.start({'scene': 'one room', 'model': 'marble-1.1', 'is_pano': 1}, PNG)
            args = transport.call_args
            self.assertEqual(args.args[0], 'https://api.worldlabs.ai/marble/v1/worlds:generate')
            payload = json.loads(args.kwargs['body'])
            self.assertEqual(payload['permission'], {'public': False})
            self.assertEqual(payload['world_prompt']['image_prompt']['source'], 'data_base64')
            self.assertTrue(payload['world_prompt']['is_pano'])
            provider.asset('https://assets.example/one.spz')
            self.assertNotIn('headers', transport.call_args.kwargs)


if __name__ == '__main__':
    unittest.main()
