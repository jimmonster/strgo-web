import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import socket

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('configure_target', ROOT / 'scripts/configure-target.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

CONFIG = '''TERMINAL_ALLOW_PRIVATE=0
TERMINAL_BLOCKED_IPS=127.0.0.1,172.30.79.58,47.108.255.179,::1
TERMINAL_MAX_SESSIONS=8
TERMINAL_SESSION_SECONDS=3600
'''


class TargetExceptionTests(unittest.TestCase):
    def test_same_host_is_allowed_without_removing_blocked_addresses(self):
        result, added = module.render(CONFIG, [module.canonical('47.108.255.179')], 22)
        self.assertEqual(added, ['47.108.255.179:22'])
        self.assertIn('TERMINAL_ALLOWED_TARGETS=47.108.255.179:22\n', result)
        for line in CONFIG.splitlines():
            self.assertIn(line + '\n', result)

    def test_private_exception_does_not_enable_all_private_networks(self):
        result, added = module.render(CONFIG, [module.canonical('10.0.0.5')], 2222)
        self.assertIn('TERMINAL_ALLOW_PRIVATE=0\n', result)
        self.assertEqual(added, ['10.0.0.5:2222'])

    def test_existing_exceptions_are_preserved_and_duplicates_removed(self):
        source = CONFIG + 'TERMINAL_ALLOWED_TARGETS=10.0.0.5:2222\nTERMINAL_ALLOWED_TARGETS=47.108.255.179:22\n'
        once, _ = module.render(source, [module.canonical('47.108.255.179')], 22)
        twice, _ = module.render(once, [module.canonical('47.108.255.179')], 22)
        self.assertEqual(once, twice)
        self.assertEqual(once.count('TERMINAL_ALLOWED_TARGETS='), 1)
        self.assertIn('10.0.0.5:2222,47.108.255.179:22', once)

    def test_ipv6_and_ipv4_mapped_addresses_are_normalized(self):
        addresses = [module.canonical('fc00::2'), module.canonical('::ffff:47.108.255.179')]
        result, added = module.render(CONFIG, addresses, 22)
        self.assertEqual(added, ['47.108.255.179:22', '[fc00::2]:22'])
        self.assertIn('[fc00::2]:22', result)

    def test_permanently_restricted_addresses_cannot_be_allowed(self):
        for address in ['127.0.0.1', '169.254.169.254', '0.0.0.0', '224.0.0.1', '100.64.0.1', '::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1']:
            with self.assertRaisesRegex(ValueError, '不能放行'):
                module.render(CONFIG, [module.canonical(address)], 22)

    def test_hostname_resolution_uses_fixed_numeric_endpoints(self):
        records = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('47.108.255.179', 0)),
                   (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('47.108.255.179', 0))]
        with patch.object(module.socket, 'getaddrinfo', return_value=records):
            addresses = module.resolve('strgo.com')
            result, added = module.render(CONFIG, addresses, 22)
        self.assertEqual(added, ['47.108.255.179:22'])
        self.assertNotIn('strgo.com:22', result)

    def test_ip_literal_requires_no_network_and_malicious_hosts_are_rejected(self):
        with patch.object(module.socket, 'getaddrinfo', side_effect=AssertionError('should not resolve IP')):
            self.assertEqual(module.resolve('47.108.255.179'), [module.canonical('47.108.255.179')])
            for host in ['-oProxyCommand=sh', 'https://strgo.com', 'strgo.com/path', 'host;id', 'a..b', 'host\nother']:
                with self.assertRaises(ValueError):
                    module.resolve(host)

    def test_invalid_ports_and_existing_policy_entries_are_rejected(self):
        for port in [0, -1, 65536]:
            with self.assertRaises(ValueError):
                module.render(CONFIG, [module.canonical('47.108.255.179')], port)
        for invalid in ['strgo.com:22', '127.0.0.1:22', '47.108.255.179:*']:
            with self.assertRaises(ValueError):
                module.render(CONFIG + 'TERMINAL_ALLOWED_TARGETS=' + invalid + '\n', [module.canonical('47.108.255.179')], 22)

    def test_cli_generates_a_private_file_without_mutating_the_original(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'broker.env'
            destination = Path(directory) / 'broker.new'
            source.write_text(CONFIG)
            with patch('sys.argv', ['configure-target.py', '--config', str(source), '--host', '47.108.255.179', '--port', '22', '--output', str(destination)]):
                module.main()
            self.assertEqual(source.read_text(), CONFIG)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertIn('TERMINAL_ALLOWED_TARGETS=47.108.255.179:22', destination.read_text())


if __name__ == '__main__':
    unittest.main()
