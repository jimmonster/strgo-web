"""Isolated UI QA fixture: python3 tests/ai-preview.py --demo.

Temporary database, synthetic silent audio and in-process fake providers only.
Never import this module into the production entrypoint.
"""
import argparse
import os
from pathlib import Path
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_ai_workspace import AIWorkspaceTests, FakeAI, MemoryStorage, packed, uid, uuid7
from cryptography.fernet import Fernet
from image_service.app import HTTPHandler, Service, ThreadingHTTPServer
from image_service.security import password_hash
from image_service.store import Store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo', action='store_true', required=True)
    args = parser.parse_args()
    os.environ['IMAGE_ENV'] = 'development'
    with tempfile.TemporaryDirectory(prefix='strgo-ai-demo-') as directory:
        store = Store(directory, Fernet(Fernet.generate_key()))
        service = Service(store, MemoryStorage(), origin='http://127.0.0.1:4173', start_worker=False)
        # This known fixture origin belongs only to the internal QA proxy.
        service.origin = 'https://strgo.com'
        ai = service.ai
        ai.providers = FakeAI()
        ai.demo = True
        username, password = 'creator', 'strgo-demo-only-2026'
        with store.connect() as db:
            user_id = uid()
            db.execute('INSERT INTO users VALUES(?,?,?,\'admin\',?,?)', (user_id, username, password_hash(password), int(time.time()), int(time.time())))
        csrf, cookies = service.create_session(user_id)
        fixture = AIWorkspaceTests()
        fixture.store, fixture.ai, fixture.app, fixture.provider = store, ai, service, ai.providers
        fixture.member = fixture.owner = {'id': user_id, 'csrf': csrf, 'cookie': cookies['Set-Cookie'].split(';')[0]}
        fixture.grant(fixture.member)
        fixture.configure('ollama', 'chat')
        fixture.configure('ace-step', 'music')
        # Distinct private node endpoints are rendered for the two services.
        with store.connect() as db:
            db.execute("UPDATE ai_nodes SET name='创作工作站 · RTX GPU' WHERE id='test-node'")
        first = fixture.music()
        ai.execute(first['id'])
        second_form = fixture.form(title='星河独白', prompt='空灵的钢琴与弦乐，电影感纯音乐', instrumental=True)
        body = {'model_id': 'ace-step', 'form_id': second_form['id'], 'revision': 1}
        q = fixture.call('POST', '/quotes/music', body)
        second = fixture.call('POST', '/music/jobs', {**body, 'quote_id': q['id']}, key=uuid7())
        ai.execute(second['id'])
        conversation = fixture.call('POST', '/conversations', {'scope': 'music', 'form_id': first['form_id']})
        ai.providers.answer = packed({'patch': {'lyrics': '[Verse]\n雨停在站台边\n风轻轻拥着你的肩\n我们向明天走去\n让温柔的光落在心里面\n\n[Chorus]\n把心事写成旋律\n让下一站有你'}})
        chat_body = {'model_id': 'ollama', 'conversation_id': conversation['id'], 'content': '帮我把副歌写得更温暖一点。', 'mode': 'music_draft', 'form_revision': 1}
        q = fixture.call('POST', '/quotes/chat', chat_body)
        run = fixture.call('POST', '/runs', {**chat_body, 'quote_id': q['id']}, key=uuid7())
        ai.execute(run['id'])
        ai.providers.answer = '当然。我们可以从雨后的车站出发，用温暖的钢琴与弦乐，讲一个关于告别与重逢的故事。\n\n[Verse]\n雨停在站台边\n风轻轻拥着你的肩\n我们向明天走去\n让温柔的光落在心里面\n\n你也可以选中这段歌词，带入音乐工作台继续创作。'
        global_run = fixture.chat()
        ai.execute(global_run['id'])
        service.origin = 'http://terminal.local:4173'
        ai.worker = threading.Thread(target=ai.loop, daemon=True)
        ai.worker.start()
        server = ThreadingHTTPServer(('127.0.0.1', 8092), HTTPHandler)
        server.service, server.daemon_threads = service, True
        print('ISOLATED DEMO: fake providers; generated audio is silent. No real API calls.', flush=True)
        print('Login: creator / strgo-demo-only-2026', flush=True)
        print('/ai/music/?form=' + first['form_id'] + '&conversation=' + conversation['id'], flush=True)
        print('/ai/chat/?conversation=' + global_run['conversation_id'], flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close()
            service.close()


if __name__ == '__main__':
    main()
