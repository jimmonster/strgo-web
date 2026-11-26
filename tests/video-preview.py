"""Real account/video HTTP fixture with no paid upstream calls."""
import argparse
import os
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from image_service.app import HTTPHandler, ThreadingHTTPServer
from tests.test_video import VideoTests

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--origin', required=True)
args = parser.parse_args()
os.environ['IMAGE_ENV'] = 'development'
fixture = VideoTests()
fixture.setUp()
service = fixture.app
service.origin = args.origin
service.secure = False
service.video.thread = threading.Thread(target=service.video.work, daemon=True)
service.video.thread.start()
server = ThreadingHTTPServer(('127.0.0.1', 8092), HTTPHandler)
server.service = service
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
print('READY', flush=True)
try:
    sys.stdin.read()
finally:
    server.shutdown()
    server.server_close()
    fixture.doCleanups()
