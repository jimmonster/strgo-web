import importlib.util
import json
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location('broker_smoke', Path(__file__).with_name('broker-smoke.py'))
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)


class FragmentedStream:
    def __init__(self, data=b''):
        self.data = data
        self.sent = b''

    def recv(self, count):
        result, self.data = self.data[:min(1, count)], self.data[min(1, count):]
        return result

    def sendall(self, data):
        self.sent += data


class BrokerSmokeTests(unittest.TestCase):
    def test_broker_length_prefix_and_json_survive_fragmented_reads(self):
        packet = {'type': 'workspace', 'owner': 'a' * 32, 'cols': 80, 'rows': 24}
        stream = FragmentedStream()
        broker.send(stream, packet)
        self.assertEqual(struct.unpack('!I', stream.sent[:4])[0], len(stream.sent) - 4)
        stream.data = stream.sent
        self.assertEqual(broker.receive(stream), packet)

    def test_server_error_and_truncated_or_oversized_frames_fail_the_probe(self):
        data = json.dumps({'type': 'error', 'message': '沙箱启动权限异常'}).encode()
        with self.assertRaisesRegex(RuntimeError, '沙箱启动权限异常'):
            broker.receive(FragmentedStream(struct.pack('!I', len(data)) + data))
        for data in (b'\x00', struct.pack('!I', 0), struct.pack('!I', broker.FRAME_LIMIT + 1)):
            with self.assertRaises(RuntimeError):
                broker.receive(FragmentedStream(data))


if __name__ == '__main__':
    unittest.main()
