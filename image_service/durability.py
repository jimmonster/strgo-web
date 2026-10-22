"""Durable directory changes on POSIX; atomic file replacement on Windows."""
import os


def sync_directory(path):
    # Windows does not expose directory fsync through Python. Callers still
    # flush/fsync the file before same-volume os.replace. Do not suppress real
    # POSIX errors: a failed durability guarantee must remain retryable.
    if os.name == 'nt':
        return
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
