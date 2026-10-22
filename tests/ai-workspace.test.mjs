import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { parseHTML } from 'linkedom';
import { AIClient, APIError, uuid7, escapeHTML, costLabel } from '../src/ai-workspace/client.js';
import { PagedList } from '../src/ai-workspace/pagination.js';

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
const json = data => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
const stream = text => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });

test('UUIDv7 has timestamp, version, variant and fresh randomness', () => {
  const now = 1792627200123, key = uuid7(now);
  assert.match(key, /^[a-f\d]{8}-[a-f\d]{4}-7[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
  assert.equal(Number(BigInt('0x' + key.replaceAll('-', '').slice(0, 12))), now);
  assert.notEqual(key, uuid7(now));
});

test('cursor lists preserve loaded rows, deduplicate and retry the failed page', async () => {
  const paths = []; let fail = false;
  const list = new PagedList({ request: async path => { paths.push(path); if (fail) throw new Error('offline'); return path.includes('cursor=') ? { items: [{ id: 'first' }, { id: 'second' }], next_cursor: null } : { items: [{ id: 'first' }], next_cursor: 'older' }; } }, '/assets');
  await list.load({ reset: true }); fail = true;
  await assert.rejects(list.load(), /offline/);
  assert.equal(list.cursor, 'older'); assert.equal(list.items.length, 1);
  fail = false; await list.load();
  assert.deepEqual(list.items.map(item => item.id), ['first', 'second']);
  assert.equal(list.cursor, null); assert.match(paths.at(-1), /limit=20&cursor=older/);
});

test('a stale conversation search cannot overwrite a newer server result', async () => {
  let resolveOld;
  const list = new PagedList({ request: path => path.includes('q=old') ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ items: [{ id: 'new' }], next_cursor: null }) }, '/conversations');
  const pending = list.load({ reset: true, query: { q: 'old' } });
  await list.load({ reset: true, query: { q: 'new' } });
  resolveOld({ items: [{ id: 'old' }], next_cursor: 'stale' }); await pending;
  assert.deepEqual(list.items, [{ id: 'new' }]); assert.equal(list.cursor, null);
});

test('mutations carry same-origin credentials, CSRF and an explicit idempotency key', async () => {
  const calls = []; globalThis.fetch = async (path, options) => { calls.push({ path, options }); return path.endsWith('/session') ? json({ user: { id: 'member' }, csrf: 'csrf-value' }) : json({ id: 'run' }); };
  const client = new AIClient(); await client.refreshSession(); const key = uuid7();
  await client.submit('chat', { quote_id: 'quote' }, key);
  const { path, options } = calls[1];
  assert.equal(path, '/api/ai/v1/runs'); assert.equal(options.credentials, 'same-origin');
  assert.equal(options.headers['X-CSRF-Token'], 'csrf-value'); assert.equal(options.headers['Idempotency-Key'], key);
  assert.deepEqual(JSON.parse(options.body), { quote_id: 'quote' });
});

test('structured permission failures retain code and request id', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'PERMISSION_REQUIRED', message: '请申请权限' }, request_id: 'trace-01' }), { status: 403 });
  await assert.rejects(new AIClient().request('/models'), e => e instanceof APIError && e.code === 'PERMISSION_REQUIRED' && e.requestId === 'trace-01');
});

test('replayed SSE sequences are deduplicated and terminal state stops replay', async () => {
  let calls = 0;
  globalThis.fetch = async path => { calls++; assert.match(path, /after_seq=2$/); return stream('id: 2\nevent: delta\ndata: {"text":"duplicate"}\n\nid: 3\nevent: delta\ndata: {"text":"你好"}\n\nid: 4\nevent: state\ndata: {"state":"SUCCEEDED"}\n\n'); };
  const received = []; for await (const event of new AIClient().events('task', { after: 2 })) received.push(event);
  assert.deepEqual(received.map(e => e.seq), [3, 4]); assert.equal(calls, 1); assert.equal(received[0].data.text, '你好');
});

test('a terminal snapshot closes an empty replay without creating another run', async () => {
  const calls = []; globalThis.fetch = async (path, options) => { calls.push([path, options?.method]); return path.includes('/events') ? stream(': heartbeat\n\n') : json({ id: 'task', state: 'INTERRUPTED', output: '已保存内容' }); };
  const received = []; for await (const event of new AIClient().events('task')) received.push(event);
  assert.equal(received[0].type, 'snapshot'); assert.equal(received[0].data.output, '已保存内容'); assert.ok(calls.every(([, method]) => !method || method === 'GET'));
});

test('untrusted content is escaped and cost display keeps currencies distinct', () => {
  assert.equal(escapeHTML('<img src=x onerror="bad()">'), '&lt;img src=x onerror=&quot;bad()&quot;&gt;');
  assert.equal(costLabel({ currency: 'LOCAL' }), '本地推理 · 无在线 API 费用');
  assert.match(costLabel({ currency: 'USD', max_cost_micro: 125000 }), /USD 0.1250/);
});

test('a failed SSE connection recovers its terminal task with GET and never reposts', async () => {
  const calls = [];
  globalThis.fetch = async (path, options) => { calls.push([path, options?.method]); if (path.includes('/events')) throw new TypeError('network interrupted'); return json({ id: 'task', state: 'SUCCEEDED', output: '完成' }); };
  const events = []; for await (const event of new AIClient().events('task')) events.push(event);
  assert.deepEqual(events.map(e => e.type), ['connection', 'snapshot']);
  assert.ok(calls.every(([, method]) => !method || method === 'GET'));
});

test('switching a shared account emits an auth change to clear host state', async () => {
  let id = 'first'; globalThis.fetch = async () => json({ user: { id }, csrf: 'token' });
  const client = new AIClient(); let changes = 0; client.addEventListener('auth-changed', () => changes++);
  await client.refreshSession(); id = 'second'; await client.refreshSession();
  assert.equal(changes, 1);
});

test('expired event replay reads the saved snapshot without a new model request', async () => {
  globalThis.fetch = async path => path.includes('/events') ? new Response('{}', { status: 410 }) : json({ state: 'SUCCEEDED', output: '完整内容' });
  const events = []; for await (const event of new AIClient().events('task')) events.push(event);
  assert.equal(events.length, 1); assert.equal(events[0].type, 'snapshot'); assert.equal(events[0].data.output, '完整内容');
});

test('workspace and isolated assistant styles parse across responsive media rules', async () => {
  for (const file of ['styles.css', 'assistant.css']) {
    const css = await readFile(new URL('../src/ai-workspace/' + file, import.meta.url), 'utf8');
    const ast = postcss.parse(css, { from: file }); assert.ok(ast.nodes.length > 10);
  }
});

test('applying an assistant draft saves pending human edits before revision validation', async () => {
  const { window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.HTMLElement = window.HTMLElement; globalThis.customElements = window.customElements;
  const { StrgoAssistant } = await import('../src/ai-workspace/assistant.js');
  const assistant = new StrgoAssistant(); let saved = false, submittedRevision;
  assistant.context = { scope: 'music', formId: 'form', revision: 1 }; assistant.draft = { id: 'draft' };
  assistant.beforeSend = async () => { saved = true; return { id: 'form', revision: 2 }; };
  assistant.client = { request: async (path, options) => { submittedRevision = options.body.revision; assert.ok(saved); throw new APIError(409, { error: { code: 'FORM_REVISION_CONFLICT', message: '表单已修改' } }); } };
  await assert.rejects(assistant.applyDraft(), e => e.code === 'FORM_REVISION_CONFLICT');
  assert.equal(submittedRevision, 2);
});
