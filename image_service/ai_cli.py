"""Offline administration. Run under the account-service OS user with its env file."""
import argparse
import os
import time

from .ai_security import packed, uid
from .cli import load_env
from .security import encryption_key
from .store import Store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env')
    sub = parser.add_subparsers(dest='command', required=True)
    bootstrap = sub.add_parser('bootstrap', help='Explicitly grant the existing administrator AI modules and model permissions')
    bootstrap.add_argument('username')
    reset = sub.add_parser('reset-mfa', help='Revoke MFA and ALL sessions of this administrator; bind again after login')
    reset.add_argument('username')
    release = sub.add_parser('release-resource', help='Release a terminal task lock only after stopping ALL services in this GPU group')
    release.add_argument('resource_group')
    release.add_argument('--confirm-services-stopped', action='store_true', required=True)
    sub.add_parser('status', help='Non-content task and reservation summary')
    sub.add_parser('replay-deletions', help='After restoring data, replay the LATEST separate encrypted deletion journal before starting the web service')
    args = parser.parse_args()
    load_env(args.env)
    store = Store(os.environ.get('IMAGE_DATA_DIR', '/var/lib/strgo-image'), encryption_key())
    # Initialize the additive schema without opening network or storage clients.
    from .ai_schema import SCHEMA, DEFAULT_MODELS
    with store.connect() as db:
        db.executescript(SCHEMA)
        db.execute('BEGIN IMMEDIATE')
        for identifier, name, kind, adapter, locality, config in DEFAULT_MODELS:
            db.execute('INSERT OR IGNORE INTO ai_models VALUES(?,?,?,?,?,1,0,0,?,?)', (identifier, name, kind, adapter, locality, store.cipher.encrypt(packed({**config, 'adapter': adapter, 'locality': locality}).encode()), int(time.time())))
        if args.command in ('bootstrap', 'reset-mfa'):
            user = db.execute("SELECT * FROM users WHERE username=? AND role='admin'", (args.username.lower(),)).fetchone()
            if not user:
                raise SystemExit('需要已有的主站管理员账号；本命令不会创建第二套账号。')
            if args.command == 'bootstrap':
                db.execute('INSERT OR IGNORE INTO ai_members(user_id) VALUES(?)', (user['id'],))
                db.execute('UPDATE ai_members SET chat=1,music=1 WHERE user_id=?', (user['id'],))
                db.executemany('INSERT OR IGNORE INTO ai_model_grants VALUES(?,?)', ((user['id'], r[0]) for r in db.execute('SELECT id FROM ai_models').fetchall()))
                print('管理员 AI 使用权已显式授予；额度仍生效，模型仍需配置、验证与启用。')
            else:
                db.execute('DELETE FROM ai_mfa WHERE user_id=?', (user['id'],))
                db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
                print('动态口令和所有登录已撤销。请重新登录并绑定。')
            db.execute('INSERT INTO ai_audit VALUES(?,?,?,?,?,?)', (uid(), 'cli', args.command, user['id'], '{}', int(time.time())))
        elif args.command == 'release-resource':
            lease = db.execute('SELECT l.*,t.state FROM ai_leases l JOIN ai_tasks t ON t.id=l.task_id WHERE resource_group=?', (args.resource_group,)).fetchone()
            if not lease:
                raise SystemExit('该资源组没有待释放的锁。')
            if lease['state'] not in ('FAILED', 'CANCELLED', 'INTERRUPTED', 'SUCCEEDED'):
                raise SystemExit('任务尚未结算。请先核对上游任务，等待正常完成或24小时结果核对期限。')
            if db.execute('SELECT 1 FROM ai_nodes WHERE resource_group=? AND draining=0', (args.resource_group,)).fetchone():
                raise SystemExit('请先在管理页排空该资源组的全部服务节点，再停止模型服务。')
            db.execute('DELETE FROM ai_leases WHERE resource_group=?', (args.resource_group,))
            db.execute('INSERT INTO ai_audit VALUES(?,?,?,?,?,?)', (uid(), 'cli', 'resource.release', args.resource_group, packed({'task_id': lease['task_id'], 'services_stopped': True}), int(time.time())))
            print('资源锁已释放。先重启私有模型服务并检查连接，再取消排空。')
        elif args.command == 'replay-deletions':
            from .storage import create_storage
            import json
            import re
            storage = create_storage()
            prefix = storage.key('system/ai-deletions/')
            records = {}
            for path in store.spool.glob('deletion-*.enc'):
                record = json.loads(store.pending_bytes(path.stem))
                records[record['id']] = record
            for journal_key in storage.iter_keys(prefix):
                if not journal_key.endswith('.fernet'):
                    continue
                record = json.loads(store.cipher.decrypt(storage.get(journal_key)))
                records[record['id']] = record
            count = 0
            from .ai_service import AIService
            for record in records.values():
                identifier, object_key = record.get('id', ''), record.get('object_key', '')
                if not re.fullmatch(r'[a-f0-9]{32}', identifier) or not (object_key.startswith(storage.key('ai/audio/')) or object_key == 'conversation:' + identifier):
                    raise SystemExit('删除日志校验失败。未开放站点，请检查日志来源。')
                store.stage('deletion-' + identifier, packed(record).encode())
                if object_key.startswith('conversation:'):
                    AIService.erase_conversation(db, identifier)
                else:
                    storage.delete(object_key)
                    db.execute('UPDATE ai_assets SET deleted=1,delete_pending=0 WHERE id=? OR object_key=?', (identifier, object_key))
                db.execute('INSERT OR IGNORE INTO ai_tombstones VALUES(?,?,?)', (record['id'], record['object_key'], record['created']))
                db.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', ('ai-deleted:' + record['id'], str(int(time.time()))))
                count += 1
            print('已重放删除日志：' + str(count) + ' 条。确认使用最新独立日志后再开放站点。')
        else:
            print(packed({'tasks': [dict(r) for r in db.execute('SELECT kind,state,COUNT(*) AS count FROM ai_tasks GROUP BY kind,state')], 'locks': [dict(r) for r in db.execute('SELECT resource_group,task_id,expires FROM ai_leases')], 'provisional_costs': db.execute('SELECT COUNT(*) FROM ai_reservations WHERE provisional=1').fetchone()[0]}))


if __name__ == '__main__':
    main()
