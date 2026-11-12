"""Durable queue admission and conservative reservations per billing provider."""
from contextlib import contextmanager
import sqlite3
import time
import uuid

from .strgo_api_only.policy import Rejected

ACTIVE = ('submitted', 'queued', 'running')
SELECT = 'SELECT * FROM jobs'


class Ledger:
    def __init__(self, path):
        self.path = path
        with self.db() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, request TEXT NOT NULL,
                    graph TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
                    nodes INTEGER NOT NULL, state TEXT NOT NULL, reserved INTEGER NOT NULL,
                    unit TEXT NOT NULL, day INTEGER NOT NULL, created INTEGER NOT NULL,
                    updated INTEGER NOT NULL, dispatched INTEGER, vendor_job TEXT, position INTEGER DEFAULT 0,
                    UNIQUE(owner,request));
                CREATE INDEX IF NOT EXISTS job_admission ON jobs(state,owner,graph);
                CREATE INDEX IF NOT EXISTS job_budget ON jobs(provider,day);
                CREATE INDEX IF NOT EXISTS job_owner ON jobs(owner,created);
            ''')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=3)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def reserve(self, owner, request, plan, model):
        now = int(time.time())
        day = (now + 8 * 3600) // 86400
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute(SELECT + ' WHERE owner=? AND request=?', (owner, request)).fetchone()
            if previous:
                if previous['graph'] != plan.digest:
                    raise Rejected('The request ID belongs to a different workflow.', 409)
                return previous['id'], previous['state'], previous['position']
            if db.execute(SELECT + '''
                WHERE owner=? AND graph=? AND (state IN ('submitted','queued','running','unknown'))
            ''', (owner, plan.digest)).fetchone():
                raise Rejected('An identical workflow is active or its billing status is unknown.', 409)
            if db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('submitted','queued','running')").fetchone()[0] >= 4:
                raise Rejected('The queue is full. Try again once a job finishes.', 429)
            if plan.route != 'mock':
                used = db.execute('SELECT COALESCE(SUM(reserved),0) FROM jobs WHERE provider=? AND day=?',
                                  (model.provider, day)).fetchone()[0]
                if not model.enabled or used + model.reserve > model.daily_limit:
                    raise Rejected('This provider is disabled or its daily budget is exhausted.', 403)
            job = str(uuid.uuid4())
            db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,0)',
                       (job, owner, request, plan.digest, model.provider, model.model, plan.node_count,
                        'submitted', model.reserve, model.unit, day, now, now))
        return job, None, 0

    def claim(self, job):
        with self.db() as db:
            now = int(time.time())
            return bool(db.execute("""
                UPDATE jobs SET dispatched=?, state='running', updated=? WHERE id=?
                AND state IN ('submitted','queued','running') AND dispatched IS NULL AND reserved>0 AND day=?
            """, (now, now, job, (now + 8 * 3600) // 86400)).rowcount)

    def update(self, job, state, expected):
        with self.db() as db:
            db.execute('UPDATE jobs SET state=?,updated=? WHERE id=? AND state=?',
                       (state, int(time.time()), job, expected))

    def accepted(self, job, position):
        with self.db() as db:
            db.execute("""UPDATE jobs SET position=?, state=CASE WHEN state='submitted' THEN 'queued' ELSE state END
                          WHERE id=?""", (position, job))

    def uncertain(self, job, paid):
        with self.db() as db:
            db.execute("""UPDATE jobs SET state=?,updated=? WHERE id=?
                          AND state IN ('submitted','queued','running')""",
                       ('unknown' if paid else 'failed', int(time.time()), job))

    def receipt(self, job, vendor_id):
        with self.db() as db:
            db.execute('UPDATE jobs SET vendor_job=COALESCE(vendor_job,?) WHERE id=? AND dispatched IS NOT NULL',
                       (vendor_id, job))

    def active(self):
        with self.db() as db:
            return db.execute(SELECT + " WHERE state IN ('submitted','queued','running')").fetchall()

    def history(self, owner):
        with self.db() as db:
            rows = db.execute('''
                SELECT id AS job, provider, model, nodes, state, created, updated, vendor_job,
                       dispatched, reserved AS estimated_max, unit
                FROM jobs WHERE owner=? ORDER BY created DESC LIMIT 100
            ''', (owner,)).fetchall()
        return [dict(row, confirmed_amount=None) for row in rows]
