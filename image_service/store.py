import contextlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import uuid

from .presets import DEFAULT_PRESETS
from .local_studio import SCHEMA as LOCAL_STUDIO_SCHEMA
from .security import Problem


SCHEMA = '''
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'member', created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invites (
 hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, used_by TEXT, created_by TEXT, role TEXT NOT NULL DEFAULT 'member');
CREATE TABLE IF NOT EXISTS sessions (
 hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS configs (user_id TEXT PRIMARY KEY REFERENCES users(id), encrypted BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), prompt TEXT NOT NULL,
 model TEXT NOT NULL, size TEXT NOT NULL, quality TEXT NOT NULL, count INTEGER NOT NULL,
 status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, request_id TEXT NOT NULL,
 provider_config BLOB NOT NULL, has_reference INTEGER NOT NULL DEFAULT 0, reference_image BLOB,
 deleted INTEGER NOT NULL DEFAULT 0,
 UNIQUE(user_id, request_id));
CREATE INDEX IF NOT EXISTS job_owner_time ON jobs(user_id, created DESC, id DESC);
CREATE TABLE IF NOT EXISTS inspirations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
 prompt TEXT NOT NULL, size TEXT NOT NULL, quality TEXT NOT NULL, count INTEGER NOT NULL,
 created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS inspiration_owner_time ON inspirations(user_id, created DESC, id DESC);
CREATE TABLE IF NOT EXISTS preset_inspirations (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, prompt TEXT NOT NULL,
 sort_order INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS preset_order ON preset_inspirations(sort_order,created,id);
CREATE TABLE IF NOT EXISTS images (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), user_id TEXT NOT NULL REFERENCES users(id),
 object_key TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, extension TEXT NOT NULL, bytes INTEGER NOT NULL,
 sha256 TEXT NOT NULL, state TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0,
 created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS image_owner ON images(user_id, job_id);
CREATE TABLE IF NOT EXISTS limits (key TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL,
 PRIMARY KEY(key,bucket));
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS forum_posts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL,
 pinned INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
 created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS forum_feed ON forum_posts(deleted,pinned DESC,created DESC,id DESC);
CREATE INDEX IF NOT EXISTS forum_owner ON forum_posts(user_id,deleted,created DESC);
'''


class Store:
    def __init__(self, directory, cipher):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)
        self.spool = self.directory / 'pending'
        self.spool.mkdir(mode=0o700, exist_ok=True)
        self.path = self.directory / 'playground.sqlite3'
        self.cipher = cipher
        self._backup_lock = threading.Lock()
        with self.connect() as db:
            db.executescript(SCHEMA + LOCAL_STUDIO_SCHEMA)
            db.execute('BEGIN IMMEDIATE')
            columns = {row['name'] for row in db.execute('PRAGMA table_info(users)')}
            if 'updated' not in columns:
                db.execute('ALTER TABLE users ADD COLUMN updated INTEGER NOT NULL DEFAULT 0')
                db.execute('UPDATE users SET updated=created WHERE updated=0')
            job_columns = {row['name'] for row in db.execute('PRAGMA table_info(jobs)')}
            if 'has_reference' not in job_columns:
                db.execute('ALTER TABLE jobs ADD COLUMN has_reference INTEGER NOT NULL DEFAULT 0')
            if 'reference_image' not in job_columns:
                db.execute('ALTER TABLE jobs ADD COLUMN reference_image BLOB')
            if 'deleted' not in job_columns:
                db.execute('ALTER TABLE jobs ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
        os.chmod(self.path, 0o600)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute("SELECT 1 FROM meta WHERE key='preset_inspirations_initialized'").fetchone():
                now = int(time.time())
                for index, preset in enumerate(DEFAULT_PRESETS):
                    db.execute('INSERT INTO preset_inspirations VALUES(?,?,?,?,?,?,?)',
                               (uuid.uuid4().hex, preset['title'], preset['description'], preset['prompt'], (index + 1) * 10, now, now))
                # Keep this marker even when admins remove every preset.
                db.execute("INSERT INTO meta VALUES('preset_inspirations_initialized','1')")

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=20000')
        try:
            with db:
                yield db
        finally:
            db.close()

    def config(self, user_id):
        with self.connect() as db:
            row = db.execute('SELECT encrypted FROM configs WHERE user_id=?', (user_id,)).fetchone()
        if not row:
            raise Problem(409, '请先在接口设置中保存模型地址、模型 ID 和密钥。')
        return json.loads(self.cipher.decrypt(row['encrypted']))

    def rate_limit(self, key, amount, seconds):
        bucket = int(time.time()) // seconds
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM limits WHERE bucket < ? AND key=?', (bucket - 1, key))
            row = db.execute('SELECT count FROM limits WHERE key=? AND bucket=?', (key, bucket)).fetchone()
            if row and row['count'] >= amount:
                raise Problem(429, '请求过于频繁，请稍后再试。')
            db.execute('INSERT INTO limits VALUES(?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1', (key, bucket))

    def stage(self, image_id, data):
        encrypted = self.cipher.encrypt(data)
        fd, name = tempfile.mkstemp(prefix='stage-', dir=self.spool)
        try:
            with os.fdopen(fd, 'wb') as handle:
                handle.write(encrypted)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, self.spool / (image_id + '.enc'))
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def pending_bytes(self, image_id):
        return self.cipher.decrypt((self.spool / (image_id + '.enc')).read_bytes())

    def metadata(self, key, default=''):
        with self.connect() as db:
            row = db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return row['value'] if row else default

    def set_metadata(self, key, value):
        with self.connect() as db:
            db.execute('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))

    def backup_bytes(self):
        fd, name = tempfile.mkstemp(prefix='backup-', dir=self.directory)
        os.close(fd)
        try:
            source = sqlite3.connect(self.path)
            target = sqlite3.connect(name)
            try:
                source.backup(target)
            finally:
                target.close()
                source.close()
            return self.cipher.encrypt(Path(name).read_bytes())
        finally:
            os.unlink(name)
