"""Isolated real-HTTP admin browser fixture; synthetic accounts, no models."""
import argparse
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cryptography.fernet import Fernet
from image_service.app import HTTPHandler, Service, ThreadingHTTPServer
from image_service.security import password_hash
from image_service.store import Store
from tests.test_image_service import FakeStorage, FakeProvider


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo', action='store_true', required=True)
    parser.add_argument('--origin', required=True)
    parser.add_argument('--with-ai', action='store_true')
    parser.add_argument('--panorama', action='store_true')
    args = parser.parse_args()
    os.environ['IMAGE_ENV'] = 'development'
    with tempfile.TemporaryDirectory(prefix='strgo-admin-qa-') as directory:
        store = Store(directory, Fernet(Fernet.generate_key()))
        service = Service(store, FakeStorage(), FakeProvider(), args.origin, start_worker=False)
        hashed, now = password_hash('admin-demo-only-2026'), int(time.time())
        with store.connect() as db:
            for identifier, name, role in [('a' * 32, 'admin-demo', 'admin'), ('b' * 32, 'member-demo', 'member')]:
                db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (identifier, name, hashed, role, now, now))
            db.execute('INSERT INTO forum_posts(id,user_id,title,body,category,created) VALUES(?,?,?,?,?,?)', ('c' * 32, 'b' * 32, '后台验收测试帖子', '这是一条临时测试内容。', 'general', now))
        if args.panorama:
            class PanoramaProvider(FakeProvider):
                def generate(self, config, job):
                    self.calls += 1
                    data = (Path(__file__).resolve().parents[1] / 'src/assets/panoramas/campus.webp').read_bytes()
                    return [{'b64_json': base64.b64encode(data).decode()} for _ in range(job['count'])]
            service.provider = PanoramaProvider()
            from tests.test_panorama_tours import FakeWorld
            from tests.panorama_world_fixture import room_bytes
            class PanoramaWorldProvider(FakeWorld):
                def asset(self, url):
                    self.downloads += 1
                    return room_bytes()
            service.panorama_tours.provider = PanoramaWorldProvider()
            config = store.cipher.encrypt(json.dumps({'endpoint': 'https://images.example/v1/images/generations', 'model': 'panorama-fixture', 'apiKey': 'fixture-only-key'}).encode())
            with store.connect() as db:
                for user_id in ('a' * 32, 'b' * 32):
                    db.execute('INSERT INTO configs VALUES(?,?)', (user_id, config))
            service.worker = threading.Thread(target=service._loop, daemon=True)
            service.worker.start()
        if args.with_ai:
            from tests.test_ai_workspace import AIWorkspaceTests, FakeAI
            service.ai.providers = FakeAI()
            csrf, cookie = service.create_session('a' * 32)
            fixture = AIWorkspaceTests()
            fixture.app, fixture.ai, fixture.store = service, service.ai, store
            fixture.member = fixture.owner = {'id': 'a' * 32, 'csrf': csrf, 'cookie': cookie['Set-Cookie'].split(';')[0]}
            fixture.grant(fixture.owner)
            fixture.configure('ollama', 'chat')
            fixture.configure('ace-step', 'music')
            # Helpers use the production origin; restore the local fixture origin
            # before accepting browser requests. All providers are in-process fake.
            service.origin = 'https://strgo.com'
            song = fixture.music()
            service.ai.execute(song['id'])
            service.origin = args.origin
            with store.connect() as db:
                original = dict(db.execute('SELECT * FROM ai_assets').fetchone())
                task = dict(db.execute('SELECT * FROM ai_tasks WHERE id=?', (song['id'],)).fetchone())
                for n in range(1, 106):
                    task_id, asset_id, conversation_id = f'{n:032x}', f'{n + 500:032x}', f'{n + 1000:032x}'
                    db.execute('''INSERT INTO ai_tasks(id,user_id,kind,form_id,model_id,model_revision,config,input,state,created,updated)
                        VALUES(?,?,'music',?,'ace-step',1,?,?,'SUCCEEDED',?,?)''',
                        (task_id, 'a' * 32, song['form_id'], task['config'], task['input'], now - n, now - n))
                    db.execute('INSERT INTO ai_assets VALUES(?,?,?,?,?,?,?,?,?,?,0,0)', (asset_id, 'a' * 32, task_id, '验收作品 ' + str(n), original['object_key'], original['mime'], original['bytes'], original['sha256'], original['duration'], now - n))
                    db.execute("INSERT INTO ai_conversations VALUES(?,?,?,'global',NULL,?,?,0)", (conversation_id, 'a' * 32, '历史对话 ' + str(n), now - n, now - n))
            service.ai.worker = threading.Thread(target=service.ai.loop, daemon=True)
            service.ai.worker.start()
        server = ThreadingHTTPServer(('127.0.0.1', 8092), HTTPHandler)
        server.service, server.daemon_threads = service, True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print('READY isolated admin fixture', flush=True)
        try:
            sys.stdin.read()
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()
            service.close()


if __name__ == '__main__':
    main()
