import unittest
from unittest.mock import patch

from image_service.durability import sync_directory


class DurabilityTests(unittest.TestCase):
    def test_windows_does_not_open_a_directory_as_file(self):
        with patch('image_service.durability.os.name', 'nt'), patch('os.open') as opened:
            sync_directory('unused')
        opened.assert_not_called()

    def test_posix_fsync_failure_is_reported_and_descriptor_closed(self):
        with patch('image_service.durability.os.name', 'posix'), \
                patch('image_service.durability.os.O_DIRECTORY', 0x10000, create=True), \
                patch('os.open', return_value=123), patch('os.close') as closed, \
                patch('os.fsync', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                sync_directory('unused')
        closed.assert_called_once_with(123)
