import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function application({ authenticated = true, storageFailure = false, mobile = false } = {}) {
  class Element {
    constructor(id, tag = 'div') {
      this.id = id; this.tag = tag; this.value = ''; this.type = 'text'; this.checked = false;
      this.hidden = false; this.disabled = false; this.open = true; this.textContent = '';
      this.dataset = {}; this.attributes = {}; this.listeners = {}; this.clientHeight = 400; this.clientWidth = 800;
      this.style = { setProperty: (key, value) => { this.attributes[key] = value; } };
      const classes = new Set(); this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) };
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    async trigger(type, event = {}) {
      const data = { target: this, preventDefault() {}, ...event };
      await Promise.all((this.listeners[type] || []).map(callback => callback(data)));
      await tick();
    }
    focus() { app.focus = this.id; }
    closest(selector) { return selector === 'button' && this.tag === 'button' ? this : null; }
    querySelectorAll() { return this.id === 'keys' ? keyButtons : []; }
  }
  const elements = new Map();
  for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = new Element(match[3], match[1]);
    element.disabled = /\bdisabled\b/.test(match[2]); element.hidden = /\bhidden\b/.test(match[2]);
    element.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || '';
    element.type = match[2].match(/\btype="([^"]*)"/)?.[1] || 'text';
    elements.set(element.id, element);
  }
  const keyButtons = [];
  for (const key of ['esc', 'tab', 'interrupt', 'up', 'down', 'left', 'right', 'enter']) {
    const button = new Element(`key-${key}`, 'button'); button.dataset.key = key; button.disabled = true; keyButtons.push(button);
  }
  keyButtons.push(...['ctrl-key', 'paste', 'font-size'].map(id => elements.get(id)));
  const storage = new Map(), requests = [], sockets = [], timers = new Map();
  const app = { elements, storage, requests, sockets, focus: null, key: key => keyButtons.find(b => b.dataset.key === key) };
  class Terminal {
    constructor(options) { this.options = options; this.cols = 80; this.rows = 24; this.output = []; app.terminal = this; }
    loadAddon(addon) { addon.terminal = this; }
    open() {}
    onData(handler) { this.ondata = handler; }
    onResize(handler) { this.onresize = handler; }
    reset() { this.output = []; }
    write(data) { this.output.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')); }
    writeln(data) { this.output.push(data + '\r\n'); }
    paste(data) { this.ondata(data); }
    focus() { app.focus = 'terminal'; }
  }
  class FitAddon { fit() { this.terminal.onresize?.({ cols: this.terminal.cols, rows: this.terminal.rows }); } }
  class WebSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    send(packet) { this.sent.push(JSON.parse(packet)); }
    receive(packet) { this.onmessage?.({ data: JSON.stringify(packet) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const document = { getElementById: id => elements.get(id), body: new Element('body'), documentElement: new Element('root') };
  const window = { Terminal, FitAddon: { FitAddon }, innerHeight: 700, matchMedia: query => ({ matches: mobile && /coarse|max-width/.test(query) }),
    addEventListener() {}, visualViewport: { height: 620, addEventListener() {} } };
  const context = { window, document, WebSocket, TextEncoder, Uint8Array, Date, console,
    location: { protocol: 'https:', host: 'strgo.com' }, navigator: {},
    localStorage: { getItem: key => { if (storageFailure) throw new Error('denied'); return storage.get(key); },
      setItem: (key, value) => { if (storageFailure) throw new Error('denied'); storage.set(key, value); },
      removeItem: key => { if (storageFailure) throw new Error('denied'); storage.delete(key); } },
    atob: text => Buffer.from(text, 'base64').toString('binary'),
    ResizeObserver: class { observe() {} },
    setTimeout: handler => { const id = timers.size + 1; timers.set(id, handler); return id; }, clearTimeout: id => timers.delete(id), setInterval() {},
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      let status = 200, data = { ok: true };
      if (url.endsWith('/session')) { status = authenticated ? 200 : 401; data = { authenticated }; }
      if (url.endsWith('/login')) { authenticated = JSON.parse(options.body).token === 'valid-token'; status = authenticated ? 200 : 401; data = { message: '访问口令不正确' }; }
      if (url.endsWith('/logout')) authenticated = false;
      return { status, ok: status === 200, json: async () => data };
    },
  };
  app.context = context; app.document = document;
  app.connect = async () => {
    await tick(); elements.get('host').value = 'ssh.example.com';
    await elements.get('connect-form').trigger('submit');
    const socket = sockets.at(-1); socket.open(); socket.receive({ type: 'ready' }); await tick(); return socket;
  };
  vm.runInNewContext(script, context);
  return app;
}

test('unauthenticated browsers cannot create a socket; successful login clears the token', async () => {
  const app = application({ authenticated: false }); await tick();
  await app.elements.get('connect-form').trigger('submit'); assert.equal(app.sockets.length, 0);
  app.elements.get('access-token').value = 'valid-token';
  await app.elements.get('login-form').trigger('submit');
  assert.equal(app.elements.get('access-token').value, ''); assert.equal(app.elements.get('access-panel').hidden, true);
  assert.equal(app.elements.get('connection-fields').disabled, false);
  assert.equal(app.storage.size, 0);
});

test('SSH uses the /terminal WSS path and enables input only after sandbox readiness', async () => {
  const app = application(); await tick(); app.elements.get('host').value = 'ssh.example.com';
  await app.elements.get('connect-form').trigger('submit');
  const socket = app.sockets[0]; assert.equal(socket.url, 'wss://strgo.com/terminal/ws');
  assert.equal(app.elements.get('mobile-input').disabled, true); socket.open();
  assert.deepEqual(socket.sent[0], { type: 'connect', host: 'ssh.example.com', username: 'root', port: 22, cols: 80, rows: 24 });
  socket.receive({ type: 'ready' }); assert.equal(app.elements.get('mobile-input').disabled, false);
  assert.equal(app.elements.get('status').textContent, '会话已就绪');
});

test('mobile composition is submitted once and password inputs are cleared', async () => {
  const app = application({ mobile: true }); const socket = await app.connect();
  const input = app.elements.get('mobile-input');
  await input.trigger('compositionstart'); input.value = '你好';
  await input.trigger('keydown', { key: 'Enter', isComposing: true });
  assert.equal(socket.sent.filter(p => p.type === 'input').length, 0);
  await input.trigger('compositionend');
  await input.trigger('keydown', { key: 'Enter' });
  assert.equal(socket.sent.at(-1).data, '你好\r'); assert.equal(input.value, '');
  await app.elements.get('secret-input').trigger('click'); assert.equal(input.type, 'password');
  input.value = 'ssh-password'; await app.elements.get('submit-input').trigger('click');
  assert.equal(socket.sent.at(-1).data, 'ssh-password\r'); assert.equal(input.value, '');
  assert.equal(app.storage.size, 0); assert.equal(app.document.body.classList.contains('connected'), true);
});

test('shortcut Enter and Tab flush buffered mobile input; Ctrl+C discards it', async () => {
  const app = application(); const socket = await app.connect(); const input = app.elements.get('mobile-input');
  input.value = 'ls'; await app.elements.get('keys').trigger('click', { target: app.key('enter') });
  assert.equal(socket.sent.at(-1).data, 'ls\r');
  input.value = 'systemc'; await app.elements.get('keys').trigger('click', { target: app.key('tab') });
  assert.equal(socket.sent.at(-2).data, 'systemc'); assert.equal(socket.sent.at(-1).data, '\t'); assert.equal(input.value, '');
  input.value = 'do-not-run'; await app.elements.get('keys').trigger('click', { target: app.key('interrupt') });
  assert.equal(socket.sent.at(-1).data, '\x03'); assert.equal(input.value, '');
});

test('Ctrl latch maps ASCII keys and arrow sequences reach SSH', async () => {
  const app = application(); const socket = await app.connect();
  await app.elements.get('keys').trigger('click', { target: app.elements.get('ctrl-key') });
  app.terminal.ondata('d'); assert.equal(socket.sent.at(-1).data, '\x04');
  assert.equal(app.elements.get('ctrl-key').attributes['aria-pressed'], 'false');
  for (const [key, expected] of [['up', '\x1b[A'], ['down', '\x1b[B'], ['left', '\x1b[D'], ['right', '\x1b[C']]) {
    await app.elements.get('keys').trigger('click', { target: app.key(key) }); assert.equal(socket.sent.at(-1).data, expected);
  }
});

test('Unicode paste chunks preserve characters and stay below the broker limit', async () => {
  const app = application(); const socket = await app.connect();
  const text = '中文🐉'.repeat(1200); app.terminal.ondata(text);
  const chunks = socket.sent.filter(p => p.type === 'input').map(p => p.data);
  assert.ok(chunks.length > 1); assert.equal(chunks.join(''), text);
  for (const chunk of chunks) { assert.ok(Buffer.byteLength(chunk) <= 4096); assert.ok(!chunk.includes('\uFFFD')); }
});

test('target storage is opt-in and includes only address, username and port', async () => {
  const app = application(); app.elements.get('remember-target').checked = true; await app.connect();
  const target = JSON.parse(app.storage.get('strgo-terminal-target'));
  assert.deepEqual(Object.keys(target).sort(), ['host', 'port', 'username']);
  assert.ok(!JSON.stringify(target).includes('token'));
  const blocked = application({ storageFailure: true }); await blocked.connect(); assert.equal(blocked.sockets.length, 1);
});

test('disconnect requests sandbox cleanup; stale events do not break the next session', async () => {
  const app = application(); const old = await app.connect();
  await app.elements.get('disconnect').trigger('click'); assert.equal(old.sent.at(-1).type, 'disconnect');
  assert.equal(app.elements.get('mobile-input').disabled, true);
  const next = await app.connect(); old.receive({ type: 'error', message: 'stale' }); old.onclose();
  assert.equal(app.elements.get('status').textContent, '会话已就绪'); assert.equal(next.readyState, 1);
});

test('server errors are shown as text and logout invalidates browser controls', async () => {
  const app = application(); const socket = await app.connect();
  socket.receive({ type: 'error', message: '<img src=x onerror=bad>' });
  assert.equal(app.elements.get('connect-message').textContent, '<img src=x onerror=bad>');
  assert.equal(app.elements.get('mobile-input').disabled, true);
  await app.elements.get('logout').trigger('click'); assert.equal(app.elements.get('access-panel').hidden, false);
  assert.equal(app.elements.get('connection-fields').disabled, true);
});

test('clipboard denial falls back to mobile input and binary UTF-8 output is decoded', async () => {
  const app = application(); const socket = await app.connect();
  await app.elements.get('paste').trigger('click'); assert.equal(app.focus, 'mobile-input');
  socket.receive({ type: 'output', data: Buffer.from('彩色输出\x1b[31m').toString('base64') });
  assert.equal(app.terminal.output.at(-1), '彩色输出\x1b[31m');
});
