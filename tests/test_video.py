"""Paid video submission, permissions, replacement and disk recovery."""
import base64
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
import time
import unittest
from unittest.mock import patch
import uuid
import wave
from urllib.parse import urlsplit

from PIL import Image

from image_service.autodl_video import AutoDL, links, normalize, validate_fields, workflow_id
from image_service.security import Problem
from image_service.video import VideoService
from tests import test_image_service as fixtures

MP4 = base64.b64decode(
    'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAARSbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAA310cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABaAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAIAAABAAAAAAL1bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAYABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACoG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAmBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAWgBIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2UKN+TARAAADAAEAAAMAGA8SJZYBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAETwAAAAAAAAAGHN0dHMAAAAAAAAAAQAAABgAAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAADIY3R0cwAAAAAAAAAXAAAAAQAACAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAAAQAABAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAEAAAAAACAAAEAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAGAAAAAEAAAB0c3RzegAAAAAAAAAAAAAAGAAAAusAAAAQAAAADQAAAA0AAAANAAAAFgAAAA8AAAANAAAADQAAABYAAAAPAAAADQAAAA0AAAAWAAAADwAAAA0AAAANAAAAFgAAAA8AAAANAAAADQAAABUAAAAPAAAADQAAABRzdGNvAAAAAAAAAAEAAASCAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2MS43LjEwMwAAAAhmcmVlAAAEV21kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MyBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MTIgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAA1ZYiEABH//ufj/AprfpHEyvWPwY9bXcqLo14dXGIU8gurtjqjfh3cMtTgUH12BEgAF7Br68EAAAAMQZokbEEP/qpVADxgAAAACUGeQniG/wCUgQAAAAkBnmF0Qz8AtoAAAAAJAZ5jakM/ALaBAAAAEkGaaEmoQWiZTAgh//6qVQA8YQAAAAtBnoZFESw3/wCUgQAAAAkBnqV0Qz8AtoEAAAAJAZ6nakM/ALaAAAAAEkGarEmoQWyZTAgh//6qVQA8YAAAAAtBnspFFSw3/wCUgQAAAAkBnul0Qz8AtoAAAAAJAZ7rakM/ALaAAAAAEkGa8EmoQWyZTAgh//6qVQA8YQAAAAtBnw5FFSw3/wCUgQAAAAkBny10Qz8AtoEAAAAJAZ8vakM/ALaAAAAAEkGbNEmoQWyZTAh///6plgDmgAAAAAtBn1JFFSw3/wCUgQAAAAkBn3F0Qz8AtoAAAAAJAZ9zakM/ALaAAAAAEUGbd0moQWyZTAhn//6eEAbNAAAAC0GflUUVLDf/AJSAAAAACQGftmpDPwC2gQ=='
)
DETAIL = {'name': 'H3 文生视频', 'input_rules': {
    'prompt': {'type': 'string', 'required': True},
    'duration': {'type': 'integer', 'default': 5, 'min': 1, 'max': 15},
    'seed': {'type': 'integer', 'min': 0, 'max': 4294967295},
    'resolution': {'type': 'string', 'options': ['480p竖', '768p横'], 'default': '480p竖'},
}, 'output_example': {'data': {'results': [{'type': 'video', 'file_type': 'mp4'}]}}}


class FakeAutoDL:
    def __init__(self):
        self.calls = []
        self.fail_submit = self.fail_download = False

    def workflow(self, identifier):
        rules = dict(DETAIL['input_rules'])
        if identifier == 'multi':
            rules.update({f'ref_image_{index}': {'type': 'image'} for index in range(9)})
            rules.update({f'ref_audio_{index}': {'type': 'audio'} for index in range(3)})
        return normalize(identifier, {**DETAIL, 'name': '官方标题 ' + identifier, 'input_rules': rules})

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
        self.assertEqual(self.call('GET', path, extra={'Range': 'bytes=999999-1000000'})[0], 416)
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
        self.deny(422, lambda: normalize('one', {**DETAIL, 'input_rules': {'prompt': {'type': 'string'}, 'video': {'type': 'video', 'required': True}}}))
        with patch('image_service.autodl_video.https_request', return_value=b'{"code":"Success","data":{"list":[{"uuid":"one","name":"Official title"}]}}') as call:
            self.assertEqual(AutoDL('server-secret').catalog()[0]['title'], 'Official title')
            self.assertEqual(call.call_args.args[1], 'POST')
            self.assertEqual(call.call_args.args[3]['Authorization'], 'server-secret')
        with patch('image_service.autodl_video.public_addresses') as addresses:
            self.deny(502, lambda: AutoDL('').download('http://127.0.0.1/video.mp4', self.app.video.directory / 'test'))
            addresses.assert_not_called()

    def reference(self, kind='image', session=None, slot=0):
        data = BytesIO()
        if kind == 'image':
            Image.new('RGB', (16, 16), (100, 150, 200)).save(data, 'PNG')
            name = 'reference.png'
        else:
            with wave.open(data, 'wb') as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(8000)
                audio.writeframes(b'\0\0' * 8000)
            name = 'reference.wav'
        return self.call('POST', '/video/inputs', {
            'kind': kind, 'slot': slot, 'name': name, 'requestId': str(uuid.uuid4()),
            'data': base64.b64encode(data.getvalue()).decode(),
        }, session)[1]

    def test_nine_images_three_audio_bind_to_matching_fields_and_scoped_urls(self):
        self.call('POST', '/admin/video/workflows', {'workflow': 'multi'})
        images = [self.reference(slot=index) for index in range(9)]
        audio = [self.reference('audio', slot=index) for index in range(3)]
        fields = {'prompt': 'Use all references'}
        fields.update({f'ref_image_{index}': item['id'] for index, item in enumerate(images)})
        fields.update({f'ref_audio_{index}': item['id'] for index, item in enumerate(audio)})
        job = self.call('POST', '/video/jobs', {'workflowId': 'multi', 'fields': fields,
            'requestId': str(uuid.uuid4()), 'acknowledged': True})[1]
        self.due()
        submitted = self.provider.calls[0][1]
        for field, reference in fields.items():
            if not field.startswith('ref_'):
                continue
            url = urlsplit(submitted[field])
            self.assertIn(reference, url.path)
            target = url.path + '?' + url.query
            status, data, headers = self.app.dispatch('GET', target, headers={})
            self.assertEqual(status, 200)
            self.assertTrue(headers['Content-Type'].startswith('image/' if field.startswith('ref_image') else 'audio/'))
            self.deny(404, lambda: self.app.dispatch('GET', url.path + '?token=wrong', headers={}))
        source = urlsplit(submitted['ref_image_0'])
        self.call('DELETE', '/video/inputs/' + images[0]['id'])
        self.assertEqual(self.app.dispatch('GET', source.path + '?' + source.query, headers={})[0], 200)
        self.due()
        self.assertEqual(self.call('GET', '/video/jobs/' + job['id'])[1]['status'], 'complete')
        self.deny(404, lambda: self.app.dispatch('GET', source.path + '?' + source.query, headers={}))

    def test_reference_permissions_validation_and_unbound_deletion(self):
        self.deny(403, lambda: self.reference(session=self.member))
        reference = self.reference()
        self.deny(404, lambda: self.call('GET', '/video/inputs/' + reference['id'], session=self.other))
        self.deny(404, lambda: self.call('DELETE', '/video/inputs/' + reference['id'], session=self.other))
        self.call('POST', '/admin/video/grants', {'username': 'video_member'})
        self.call('POST', '/admin/video/workflows', {'workflow': 'multi'})
        self.deny(400, lambda: self.call('POST', '/video/jobs', {
            'workflowId': 'multi', 'fields': {'prompt': 'x', 'ref_image_0': reference['id']},
            'requestId': str(uuid.uuid4()), 'acknowledged': True,
        }, self.member))
        self.call('DELETE', '/video/inputs/' + reference['id'])
        self.deny(404, lambda: self.call('GET', '/video/inputs/' + reference['id']))
        for kind in ('image', 'audio'):
            self.deny(400, lambda: self.call('POST', '/video/inputs', {
                'kind': kind, 'slot': 0, 'name': 'bad.file', 'requestId': str(uuid.uuid4()),
                'data': base64.b64encode(b'<script>bad</script>').decode(),
            }))

    def test_reference_slots_persist_per_account_and_replacement_updates_one_slot(self):
        first = self.reference(slot=4)
        saved = self.call('GET', '/video/inputs')[1]['inputs']
        self.assertEqual([(item['kind'], item['slot'], item['id']) for item in saved], [('image', 4, first['id'])])
        replacement = self.reference(slot=4)
        saved = self.call('GET', '/video/inputs')[1]['inputs']
        self.assertEqual([(item['kind'], item['slot'], item['id']) for item in saved], [('image', 4, replacement['id'])])
        self.deny(404, lambda: self.call('GET', '/video/inputs/' + first['id']))
        self.assertEqual(self.call('GET', '/video/inputs', session=self.other)[1]['inputs'], [])
        self.assertEqual(self.call('GET', '/video/inputs/' + replacement['id'])[2]['Content-Type'], 'image/png')

    def test_media_schema_limits_and_required_uploads(self):
        for name in ('ref_image_9', 'ref_audio_3'):
            self.deny(422, lambda: normalize('multi', {**DETAIL, 'input_rules': {
                **DETAIL['input_rules'], name: {'type': 'string'},
            }}))
        schema = normalize('multi', {**DETAIL, 'input_rules': {
            **DETAIL['input_rules'], 'ref_image_0': {'type': 'string', 'required': True},
        }})['fields']
        self.assertEqual(schema[-1]['kind'], 'image')
        self.deny(400, lambda: validate_fields(schema, {'prompt': 'x'}))
        self.deny(400, lambda: validate_fields(schema, {'prompt': 'x', 'ref_image_0': 'https://evil.example/input.png'}))

    def test_admin_key_is_encrypted_masked_and_snapshotted_per_job(self):
        config = self.call('GET', '/admin/video/config')[1]
        self.deny(403, lambda: self.call('PUT', '/admin/video/config', {
            'apiKey': 'private-key-AAA', 'revision': config['revision'],
        }, self.member))
        result = self.call('PUT', '/admin/video/config', {
            'apiKey': 'private-key-AAA', 'revision': config['revision'],
        })[1]
        self.assertNotIn('apiKey', result)
        self.assertNotIn('private-key-AAA', self.store.metadata('video_api_key'))
        job = self.submit()
        self.call('PUT', '/admin/video/config', {'apiKey': 'private-key-BBB', 'revision': result['revision']})
        with self.store.connect() as db:
            row = db.execute('SELECT * FROM video_jobs WHERE id=?', (job['id'],)).fetchone()
            self.assertEqual(self.app.video.snapshot(row)['apiKey'], 'private-key-AAA')
        self.assertEqual(self.app.video.current_token(), 'private-key-BBB')
        self.assertNotIn('private-key', json.dumps(self.call('GET', '/video/jobs')[1]))
        self.deny(409, lambda: self.call('PUT', '/admin/video/config', {'apiKey': 'private-key-CCC', 'revision': 0}))
