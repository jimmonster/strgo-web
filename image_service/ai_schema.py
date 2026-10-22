"""Additive AI workspace migration; the existing accounts remain authoritative."""

SCHEMA = '''
CREATE TABLE IF NOT EXISTS ai_members (
 user_id TEXT PRIMARY KEY REFERENCES users(id), status TEXT NOT NULL DEFAULT 'active',
 chat INTEGER NOT NULL DEFAULT 0, music INTEGER NOT NULL DEFAULT 0,
 chat_limit INTEGER NOT NULL DEFAULT 50, music_limit INTEGER NOT NULL DEFAULT 600,
 storage_limit INTEGER NOT NULL DEFAULT 1073741824, expires INTEGER);
CREATE TABLE IF NOT EXISTS ai_model_grants (
 user_id TEXT NOT NULL REFERENCES users(id), model_id TEXT NOT NULL, PRIMARY KEY(user_id,model_id));
CREATE TABLE IF NOT EXISTS ai_models (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, adapter TEXT NOT NULL,
 locality TEXT NOT NULL, revision INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
 verified INTEGER NOT NULL DEFAULT 0, config BLOB NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_nodes (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, endpoint TEXT NOT NULL, resource_group TEXT NOT NULL,
 draining INTEGER NOT NULL DEFAULT 0, health TEXT NOT NULL DEFAULT 'unknown', checked INTEGER,
 UNIQUE(endpoint));
CREATE TABLE IF NOT EXISTS ai_mfa (
 user_id TEXT PRIMARY KEY REFERENCES users(id), secret BLOB NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0,
 last_counter INTEGER NOT NULL DEFAULT -1);
CREATE TABLE IF NOT EXISTS ai_stepups (
 session_hash TEXT PRIMARY KEY REFERENCES sessions(hash) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_conversations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
 scope TEXT NOT NULL, form_id TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ai_conversation_owner ON ai_conversations(user_id,scope,updated DESC);
CREATE TABLE IF NOT EXISTS ai_forms (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, fields TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_drafts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), form_id TEXT NOT NULL REFERENCES ai_forms(id),
 base_revision INTEGER NOT NULL, patch TEXT NOT NULL, expires INTEGER NOT NULL, applied INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ai_quotes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), model_id TEXT NOT NULL,
 revision INTEGER NOT NULL, kind TEXT NOT NULL, input_hash TEXT NOT NULL, config BLOB NOT NULL,
 units INTEGER NOT NULL, max_cost INTEGER NOT NULL, currency TEXT NOT NULL, expires INTEGER NOT NULL, consumed TEXT);
CREATE TABLE IF NOT EXISTS ai_tasks (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 conversation_id TEXT REFERENCES ai_conversations(id), form_id TEXT REFERENCES ai_forms(id),
 model_id TEXT NOT NULL, model_revision INTEGER NOT NULL, config BLOB NOT NULL, input TEXT NOT NULL,
 state TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
 dispatched INTEGER NOT NULL DEFAULT 0, remote_id TEXT, result_key TEXT,
 created INTEGER NOT NULL, updated INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0,
 resource_group TEXT, worker TEXT, cancel INTEGER NOT NULL DEFAULT 0, reconcile_after INTEGER);
CREATE INDEX IF NOT EXISTS ai_task_queue ON ai_tasks(state,created);
CREATE INDEX IF NOT EXISTS ai_task_owner ON ai_tasks(user_id,created DESC);
CREATE TABLE IF NOT EXISTS ai_messages (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES ai_conversations(id),
 task_id TEXT REFERENCES ai_tasks(id), role TEXT NOT NULL, content TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_events (
 task_id TEXT NOT NULL REFERENCES ai_tasks(id), seq INTEGER NOT NULL, type TEXT NOT NULL,
 data TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(task_id,seq));
CREATE TABLE IF NOT EXISTS ai_idempotency (
 user_id TEXT NOT NULL, key TEXT NOT NULL, input_hash TEXT NOT NULL, resource_id TEXT NOT NULL,
 created INTEGER NOT NULL, PRIMARY KEY(user_id,key));
CREATE TABLE IF NOT EXISTS ai_usage (
 user_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
 reserved INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,day,kind));
CREATE TABLE IF NOT EXISTS ai_budgets (
 currency TEXT PRIMARY KEY, daily INTEGER NOT NULL, monthly INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_costs (
 period TEXT NOT NULL, currency TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
 reserved INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(period,currency));
CREATE TABLE IF NOT EXISTS ai_reservations (
 task_id TEXT PRIMARY KEY REFERENCES ai_tasks(id), user_id TEXT NOT NULL, day TEXT NOT NULL,
 kind TEXT NOT NULL, units INTEGER NOT NULL, storage_bytes INTEGER NOT NULL,
 max_cost INTEGER NOT NULL, currency TEXT NOT NULL, settled INTEGER NOT NULL DEFAULT 0,
 cost INTEGER, provisional INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ai_leases (
 resource_group TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, worker TEXT NOT NULL,
 fence INTEGER NOT NULL DEFAULT 1, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_assets (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT NOT NULL UNIQUE REFERENCES ai_tasks(id),
 title TEXT NOT NULL, object_key TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
 sha256 TEXT NOT NULL, duration REAL NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
 delete_pending INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ai_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), modules TEXT NOT NULL,
 reason TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL, reviewed INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS ai_one_request ON ai_requests(user_id) WHERE state='pending';
CREATE TABLE IF NOT EXISTS ai_audit (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL,
 detail TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ai_tombstones (
 id TEXT PRIMARY KEY, object_key TEXT NOT NULL, created INTEGER NOT NULL);
'''

DEFAULT_MODELS = (
 ('ollama', 'Ollama', 'chat', 'ollama', 'local', {'endpoint': '', 'model': '', 'node_id': '', 'max_output': 2048}),
 ('ace-step', 'ACE-Step 1.5', 'music', 'ace', 'local', {'endpoint': '', 'model': 'acestep-v15-turbo', 'node_id': ''}),
 ('deepseek', 'DeepSeek', 'chat', 'openai', 'cloud', {'endpoint': 'https://api.deepseek.com', 'model': 'deepseek-chat', 'currency': 'CNY', 'max_output': 2048}),
 ('elevenlabs', 'ElevenLabs Music', 'music', 'eleven', 'cloud', {'endpoint': 'https://api.elevenlabs.io', 'model': 'music_v1', 'currency': 'USD'}),
)
