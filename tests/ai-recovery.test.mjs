import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { AIClient } from '../src/ai-workspace/client.js';

const { window, document } = parseHTML('<html><body></body></html>');
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, customElements: window.customElements, CustomEvent: window.CustomEvent });
const { StrgoAssistant } = await import('../src/ai-workspace/assistant.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const finalMessages = [{ role: 'user', content: '你好', task_id: 'run' }, { role: 'assistant', content: '完整回复', task_id: 'run', state: 'SUCCEEDED' }];
function fixture(events) {
  const calls = [], assistant = new StrgoAssistant();
  assistant.client = {
    session: { user: { id: 'member' }, usage: { chat: { remaining: 3 } } },
    events,
    request: async path => { calls.push(path); return path === '/models' ? [] : { messages: finalMessages, conversation: { scope: 'global' }, runs: [] }; },
    refreshSession: async () => {},
    submit: () => { throw Error('Recovery must never create a run'); }
  };
  assistant.context = { scope: 'global', conversationId: 'conversation' }; assistant.render();
  return { assistant, calls };
}

test('manual recovery resumes the same saved run without duplicating messages or generating again', async () => {
  let attempts = 0;
  const { assistant, calls } = fixture(async function* (id) {
    assert.equal(id, 'run');
    if (++attempts === 1) throw new TypeError('connection interrupted');
    yield { type: 'snapshot', data: { output: '完整回复', state: 'SUCCEEDED' } };
  });
  assistant.messages = [{ role: 'user', content: '你好' }];
  await assistant.follow('run', '部分回复');
  assert.equal(assistant.recoverRun, 'run'); assert.equal(assistant.busy, false);
  assert.equal(assistant.shadowRoot.querySelector('.recover').hidden, false);
  assert.equal(assistant.shadowRoot.querySelector('.send').hidden, true);
  await assistant.shadowRoot.querySelector('.recover').onclick();
  assert.equal(attempts, 2); assert.deepEqual(assistant.messages, finalMessages);
  assert.equal(assistant.recoverRun, null); assert.equal(assistant.activeRun, null);
  assert.equal(assistant.shadowRoot.querySelector('.recover').hidden, true);
  assert.equal(assistant.shadowRoot.querySelector('.send').hidden, false);
  assert.deepEqual(calls, ['/conversations/conversation']);
});

test('restoring an active conversation reuses the persisted assistant message', async () => {
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const { assistant } = fixture(async function* () { await gate; yield { type: 'state', data: { state: 'SUCCEEDED' } }; });
  const base = assistant.client.request;
  let loads = 0;
  assistant.client.request = path => path.startsWith('/conversations/') && ++loads === 1
    ? Promise.resolve({ conversation: { scope: 'global' }, messages: [{ role: 'user', content: '你好' }, { role: 'assistant', task_id: 'run', content: '部分回复', state: 'RUNNING' }], runs: [{ id: 'run', state: 'RUNNING', output: '部分回复' }] })
    : base(path);
  await assistant.loadConversation('conversation');
  assert.equal(assistant.messages.length, 2); assert.equal(assistant.busy, true);
  finish(); await tick();
  assert.equal(assistant.busy, false); assert.equal(assistant.messages.length, 2);
});

test('late stream results and cleanup cannot replace another conversation or unlock its composer', async () => {
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const { assistant } = fixture(async function* () { await gate; yield { type: 'delta', data: { text: '旧账号的回复' } }; });
  const previous = assistant.follow('run');
  const nextClient = { session: { user: null }, request: async () => [] };
  await assistant.configure({ client: nextClient });
  assistant.setBusy(true);
  finish(); await previous;
  assert.deepEqual(assistant.messages, []); assert.equal(assistant.busy, true);
  assert.ok(!assistant.shadowRoot.innerHTML.includes('旧账号的回复'));
});

test('switching context while a form save is pending cannot submit the old message', async () => {
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const { assistant } = fixture(async function* () {});
  let submissions = 0; assistant.client.submit = async () => { submissions++; return { id: 'run' }; };
  assistant.modelId = 'model'; assistant.beforeSend = () => gate;
  assistant.shadowRoot.querySelector('textarea').value = '旧消息';
  const sending = assistant.send();
  await assistant.configure({ client: { session: { user: null } } });
  finish({ id: 'old-form', revision: 2 }); await sending;
  assert.equal(submissions, 0); assert.equal(assistant.context.formId, undefined);
});

test('CRLF SSE and split multibyte text preserve every saved event exactly once', async () => {
  const originalFetch = globalThis.fetch;
  const encoded = new TextEncoder().encode('id: 1\r\nevent: delta\r\ndata: {"text":"你好🌏"}\r\n\r\nid: 2\r\nevent: state\r\ndata: {"state":"SUCCEEDED"}\r\n\r\n');
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { for (let i = 0; i < encoded.length; i++) controller.enqueue(encoded.slice(i, i + 1)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  try {
    const events = []; for await (const event of new AIClient().events('run')) events.push(event);
    assert.deepEqual(events.map(event => event.seq), [1, 2]); assert.equal(events[0].data.text, '你好🌏');
  } finally { globalThis.fetch = originalFetch; }
});

test('expired stream authentication requests login without creating another model task', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: '登录已过期' } }), { status: 401 });
  try {
    const client = new AIClient(); let required = 0; client.addEventListener('auth-required', () => required++);
    await assert.rejects(async () => { for await (const _ of client.events('run')) {} }, error => error.status === 401);
    assert.equal(required, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('retry preserves an unsent draft and requires a fresh explicit send with the original run relation', async () => {
  const { assistant } = fixture(async function* () {});
  assistant.messages = [{ role: 'user', task_id: 'failed-run', content: '原始消息', state: 'FAILED' }]; assistant.renderMessages();
  const input = assistant.shadowRoot.querySelector('textarea'); input.value = '未发送的草稿';
  assistant.shadowRoot.querySelector('[data-retry]').onclick(); assert.equal(input.value, '未发送的草稿');
  input.value = ''; assistant.shadowRoot.querySelector('[data-retry]').onclick();
  assert.equal(input.value, '原始消息'); assert.equal(assistant.retryOf, 'failed-run');
  let body; assistant.modelId = 'local'; assistant.client.quote = async () => ({ locality: 'local', id: 'new-quote' });
  assistant.client.submit = async (_, value) => { body = value; return { id: 'new-run' }; }; assistant.follow = async () => {};
  assert.equal(body, undefined); await assistant.send();
  assert.equal(body.retry_of_run_id, 'failed-run'); assert.equal(body.quote_id, 'new-quote'); assert.equal(assistant.retryOf, null);
});
