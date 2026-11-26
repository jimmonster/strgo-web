"""Paid video submission, permissions, replacement and disk recovery."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
import time
import unittest
from unittest.mock import patch
import uuid

from image_service.autodl_video import AutoDL, links, normalize, validate_fields, workflow_id
from image_service.security import Problem
from image_service.video import VideoService
from tests import test_image_service as fixtures

MP4 = b'\x00\x00\x00\x18ftypisom' + b'\x00' * 20
DETAIL = {'name': 'H3 文生视频', 'input_rules': {
    'prompt': {'type': 'string', 'required': True},
    'duration': {'type': 'integer', 'default': 5, 'min': 1, 'max': 15},
    'resolution': {'type': 'string', 'options': ['480p竖', '768p横'], 'default': '480p竖'},
}, 'output_example': {'data': {'results': [{'type': 'video', 'file_type': 'mp4'}]}}}


class FakeAutoDL:
    def __init__(self):
        self.calls = []
        self.fail_submit = self.fail_download = False

    def workflow(self, identifier):
        return normalize(identifier, {**DETAIL, 'name': '官方标题 ' + identifier})

    def catalog(self):
        return [{'id': 'one', 'title': '官方标题 one', **links('one')}]

    def submit(self, identifier, fields):
        self.calls.append((identifier, fields))
        if self.fail_submit:
            raise TimeoutError()
        return 'remote-one'

    def result(self, task):
        return {'status': 'SUCCESS', 'results': [{'type': 'video', 'file_type': 'mp4', 'url': 'https://cdn.example/video.mp4'}]}

    def download(self, url, path):
        if self.fail_download:
            path.write_bytes(b'partial')
            raise OSError()
        path.write_bytes(MP4)


class VideoTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ImageServiceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.app, self.store = self.fixture.app, self.fixture.store
        self.provider = FakeAutoDL()
        self.app.video.close()
        self.app.video = VideoService(self.store, provider=self.provider)
        self.admin = self.fixture.admin
        self.member = self.fixture.register('video_member')
        self.other = self.fixture.register('other_member')
        self.call('POST', '/admin/video/workflows', {'workflow': 'one'})

    def call(self, method, path, payload=None, session=None, extra=None):
        return self.fixture.call(method, path, payload, session or self.admin, extra)

    def submit(self, session=None, request_id=None):
        return self.call('POST', '/video/jobs', {'requestId': request_id or str(uuid.uuid4()),
            'workflowId': 'one', 'fields': {'prompt': 'A sunny garden'}, 'acknowledged': True}, session)[1]

    def deny(self, status, callback):
        with self.assertRaises(Problem) as error:
            callback()
        self.assertEqual(error.exception.status, status)

    def due(self):
        with self.store.connect() as db:
            db.execute('UPDATE video_jobs SET next_poll=0')
        self.app.video.run_one()

    def test_permissions_cannot_be_bypassed_and_csrf_is_required(self):
        self.deny(403, lambda: self.submit(self.member))
        self.deny(403, lambda: self.call('POST', '/admin/video/grants', {'username': 'other_member'}, self.member))
        self.deny(403, lambda: self.call('POST', '/video/jobs', {}, extra={'X-CSRF-Token': 'bad'}))
        self.deny(403, lambda: self.call('POST', '/video/jobs', {}, extra={'Origin': 'https://evil.example'}))
        self.call('POST', '/admin/video/grants', {'username': 'video_member'})
        self.assertTrue(self.call('GET', '/video/workflows', session=self.member)[1]['allowed'])
        job = self.submit(self.member)
        self.call('DELETE', '/admin/video/grants/' + self.member['user']['id'])
        self.due()
        self.assertEqual(self.call('GET', '/video/jobs/' + job['id'], session=self.member)[1]['status'], 'failed')
        self.assertEqual(self.provider.calls, [])

    def test_duplicate_concurrent_requests_create_one_paid_job(self):
        request_id = str(uuid.uuid4())
        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs = list(pool.map(lambda _: self.submit(request_id=request_id), range(4)))
        self.assertEqual(len({job['id'] for job in jobs}), 1)
        self.due()
        self.assertEqual(len(self.provider.calls), 1)
        self.assertEqual(self.provider.calls[0][1]['duration'], 5)
        self.assertEqual(self.submit(request_id=request_id)['id'], jobs[0]['id'])

    def test_private_video_is_saved_and_supports_range_download(self):
        job = self.submit()
        self.due()
        self.due()
        complete = self.call('GET', '/video/jobs/' + job['id'])[1]
        self.assertEqual(complete['status'], 'complete')
        path = '/video/jobs/' + job['id'] + '/0.mp4'
        status, stream, headers = self.call('GET', path, extra={'Range': 'bytes=4-7'})
        output = BytesIO()
        stream.write(output)
        self.assertEqual((status, output.getvalue()), (206, b'ftyp'))
        self.assertEqual(headers['Content-Type'], 'video/mp4')
        self.assertEqual(self.call('GET', path, extra={'Range': 'bytes=-0'})[0], 416)
        self.assertEqual(self.call('GET', path, extra={'Range': 'bytes=999-1000'})[0], 416)
        self.assertEqual(self.call('GET', path + '?download=1')[2]['Content-Disposition'].split(';')[0], 'attachment')
        self.deny(404, lambda: self.call('GET', path, session=self.other))

    def test_replacement_keeps_historical_identity_and_cancels_queued_old_workflow(self):
        job = self.submit()
        new = self.call('POST', '/admin/video/workflows', {
            'workflow': 'https://www.autodl.art/large-model/comfyui/two', 'replace': 'one'})[1]
        self.assertEqual(new['title'], '官方标题 two')
        self.assertTrue(new['submitUrl'].endswith('/two'))
        self.assertEqual([item['id'] for item in self.call('GET', '/video/workflows')[1]['workflows']], ['two'])
        self.assertEqual(self.call('GET', '/video/jobs/' + job['id'])[1]['title'], '官方标题 one')
        self.due()
        self.assertEqual(self.provider.calls, [])
        self.deny(409, lambda: self.call('POST', '/admin/video/workflows', {'workflow': 'three', 'replace': 'one'}))
        self.assertEqual([item['id'] for item in self.call('GET', '/video/workflows')[1]['workflows']], ['two'])

    def test_timeout_never_automatically_resubmits(self):
        self.provider.fail_submit = True
        job = self.submit()
        self.due()
        self.due()
        self.assertEqual(self.call('GET', '/video/jobs/' + job['id'])[1]['status'], 'unknown')
        self.assertEqual(len(self.provider.calls), 1)

    def test_restart_recovers_polling_and_interrupted_submission_is_unknown(self):
        job = self.submit()
        with self.store.connect() as db:
            db.execute("UPDATE video_jobs SET status='submitting' WHERE id=?", (job['id'],))
        with patch.dict('os.environ', {'AUTODL_COMFYUI_TOKEN': ''}):
            recovered = VideoService(self.store, start_worker=True)
        recovered.close()
        self.assertEqual(self.call('GET', '/video/jobs/' + job['id'])[1]['status'], 'unknown')
        with self.store.connect() as db:
            db.execute("UPDATE video_jobs SET status='running',remote_id='remote-one',next_poll=0 WHERE id=?", (job['id'],))
        self.due()
        self.assertEqual(self.call('GET', '/video/jobs/' + job['id'])[1]['status'], 'complete')
        self.assertEqual(self.provider.calls, [])

    def test_partial_disk_save_retries_download_only(self):
        self.provider.fail_download = True
        job = self.submit()
        self.due()
        self.due()
        self.assertEqual(self.call('GET', '/video/jobs/' + job['id'])[1]['status'], 'saving')
        self.assertEqual(list(self.app.video.directory.rglob('*.part')), [])
        self.provider.fail_download = False
        self.due()
        self.assertEqual(self.call('GET', '/video/jobs/' + job['id'])[1]['status'], 'complete')
        self.assertEqual(len(self.provider.calls), 1)

    def test_low_disk_and_invalid_parameters_do_not_enqueue(self):
        with patch.object(self.app.video, 'disk_ready', return_value=False):
            self.deny(503, self.submit)
        self.deny(400, lambda: self.call('POST', '/video/jobs', {
            'requestId': str(uuid.uuid4()), 'workflowId': 'one', 'fields': {'prompt': 'x'},
        }))
        schema = normalize('one', DETAIL)['fields']
        for values in ({'prompt': ''}, {'prompt': 'x', 'duration': 16},
                       {'prompt': 'x', 'duration': True}, {'prompt': 'x', 'url': 'https://evil.example'}):
            self.deny(400, lambda: validate_fields(schema, values))
        self.assertEqual(self.provider.calls, [])

    def test_workflow_metadata_must_match_autodl_url(self):
        self.assertEqual(workflow_id('https://www.autodl.art/large-model/comfyui/one'), 'one')
        for value in ('https://evil.example/one', 'https://www.autodl.art@evil.example/one', '../one'):
            self.deny(400, lambda: workflow_id(value))
        self.deny(422, lambda: normalize('one', {**DETAIL, 'input_rules': {'prompt': {'type': 'string'}, 'image': {'type': 'image', 'required': True}}}))
        with patch('image_service.autodl_video.https_request', return_value=b'{"code":"Success","data":{"list":[{"uuid":"one","name":"Official title"}]}}') as call:
            self.assertEqual(AutoDL('server-secret').catalog()[0]['title'], 'Official title')
            self.assertEqual(call.call_args.args[1], 'POST')
            self.assertEqual(call.call_args.args[3]['Authorization'], 'server-secret')
        with patch('image_service.autodl_video.public_addresses') as addresses:
            self.deny(502, lambda: AutoDL('').download('http://127.0.0.1/video.mp4', self.app.video.directory / 'test'))
            addresses.assert_not_called()
