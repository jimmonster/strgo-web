// Exercise the shipped event handlers with an isolated DOM and API. No model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { escapeHTML, modelLabel, stateLabel, terminalStates } from '../src/ai-workspace/client.js';

const source = readFileSync(new URL('../src/ai-workspace/app.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^start\(\);\r?$/m, '');
async function fixture() {
  const { document, window } = parseHTML('<html><body><div id="main"></div><span id="top-quota"></span><p id="toast"></p><dialog id="dialog"><button class="dialog-x"></button><div id="dialog-content"></div></dialog><div id="admin-content"></div></body></html>');
  const elementPrototype = window.HTMLElement.prototype;
  if (!Object.getOwnPropertyDescriptor(elementPrototype, 'elements')) Object.defineProperty(elementPrototype, 'elements', { get() { return Object.fromEntries([...this.querySelectorAll('[name]')].map(el => [el.name, el])); } });
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, get() { return this.getAttribute('data-test-value') ?? this.querySelector('option')?.getAttribute('value') ?? ''; }, set(value) { this.setAttribute('data-test-value', value); } });
  const callbacks = new Map(), calls = [];
  let sequence = 0, draining = 0;
  const form = { id: 'f'.repeat(32), revision: 1, kind: 'music', fields: { title: '', prompt: '', lyrics: '', duration: 60, instrumental: false, tags: [] } };
  const client = {
    session: { user: { id: 'member' } },
    request: async (path, options) => {
      calls.push({ path, ...options });
      if (path === '/admin/nodes') return [{ id: 'node', draining, name: 'GPU', resource_group: 'gpu', endpoint: 'http://127.0.0.1:8001' }];
      if (path === '/admin/nodes/node') { draining = Number(options.body.draining); return {}; }
      if (path === '/forms') return structuredClone(form);
      if (path.startsWith('/forms/')) { Object.assign(form, { revision: form.revision + 1, fields: options.body.fields }); return structuredClone(form); }
      if (path === '/usage') return { music: { remaining: 600 } };
      return [];
    }, addEventListener() {}
  };
  const configure = window.HTMLElement.prototype.configure;
  window.HTMLElement.prototype.configure = async () => {};
  window.HTMLElement.prototype.updateForm = () => {};
  const create = new Function('document', 'window', 'location', 'history', 'AIClient', 'esc', 'modelLabel', 'stateLabel', 'terminalStates', 'setTimeout', 'clearTimeout', 'setInterval', `${source}\nreturn { state, musicPage, adminNodes };`);
  const app = create(document, { addEventListener() {} }, { pathname: '/ai/music/', search: '' }, { replaceState() {} }, function () { return client; }, escapeHTML, modelLabel, stateLabel, terminalStates, fn => { callbacks.set(++sequence, fn); return sequence; }, id => callbacks.delete(id), () => 1);
  app.state.session = client.session;
  await app.musicPage();
  return { document, calls, app, async save() { for (const [id, fn] of [...callbacks]) { callbacks.delete(id); fn(); } await app.state.saving; }, restore() { if (configure) elementPrototype.configure = configure; else delete elementPrototype.configure; delete elementPrototype.updateForm; } };
}

test('changing only duration or mode autosaves the server draft without typing or generating', async () => {
  const env = await fixture();
  try {
    env.document.querySelector('[data-duration="30"]').onclick(); await env.save();
    env.document.querySelector('[data-mode="instrumental"]').onclick(); await env.save();
    const saves = env.calls.filter(call => call.method === 'PUT');
    assert.equal(saves.length, 2); assert.equal(saves[0].body.fields.duration, 30);
    assert.equal(saves[1].body.fields.instrumental, true); assert.equal(saves[1].body.revision, 2);
    assert.equal(env.app.state.formDirty, false);
    assert.equal(env.calls.some(call => /quotes|jobs/.test(call.path) && call.method === 'POST'), false);
  } finally { env.restore(); }
});

test('node scheduling can drain and resume repeatedly using the returned server state', async () => {
  const env = await fixture();
  try {
    for (const value of [true, false, true, false]) {
      await env.app.adminNodes(); const button = env.document.querySelector('.drain-node');
      await button.onclick();
      assert.equal(env.calls.filter(call => call.method === 'PUT' && call.path.includes('/nodes/')).at(-1).body.draining, value);
      assert.equal(button.disabled, false);
    }
  } finally { env.restore(); }
});

test('an assistant patch response arriving during manual editing preserves the human text and saves its new revision', async () => {
  const env = await fixture();
  try {
    const form = env.document.querySelector('#music-form'); form.elements.prompt.value = '人工修改，保留这段文字'; form.oninput();
    const applied = { ...env.app.state.form, revision: 3, fields: { ...env.app.state.form.fields, prompt: '助手的旧建议' } };
    env.document.querySelector('strgo-assistant').dispatchEvent(new env.document.defaultView.CustomEvent('strgo:draft-applied', { detail: applied }));
    await env.app.state.saving;
    assert.equal(form.elements.prompt.value, '人工修改，保留这段文字');
    const saved = env.calls.filter(call => call.method === 'PUT').at(-1);
    assert.equal(saved.body.revision, 3); assert.equal(saved.body.fields.prompt, '人工修改，保留这段文字');
  } finally { env.restore(); }
});
