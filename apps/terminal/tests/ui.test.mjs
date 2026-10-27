import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { Terminal: Xterm } = createRequire(import.meta.url)('../web/vendor/xterm.js');

const html = readFileSync(new URL('../web/session.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function application({ authenticated = true, storageFailure = false, mobile = false, realTerminal = false, params = '' } = {}) {
  class Element {
    constructor(id, tag = 'div') {
      this.id = id; this.tag = tag; this.value = ''; this.type = 'text'; this.checked = false;
      this.hidden = false; this.disabled = false; this.open = true; this.textContent = '';
      this.dataset = {}; this.attributes = {}; this.listeners = {}; this.clientHeight = 400; this.clientWidth = 800;
      this.children = []; this.scrollTop = 0; this.scrollHeight = 44; this.selectionStart = 0; this.selectionEnd = 0;
      this.style = { setProperty: (key, value) => { this.attributes[key] = value; } };
      const classes = new Set(); this.classList = {
        add: (...names) => names.forEach(c => classes.add(c)), remove: (...names) => names.forEach(c => classes.delete(c)), contains: c => classes.has(c),
        toggle: (name, force) => { const value = force ?? !classes.has(name); if (value) classes.add(name); else classes.delete(name); return value; },
      };
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    async trigger(type, event = {}) {
      const data = { target: this, preventDefault() {}, stopImmediatePropagation() {}, ...event };
      await Promise.all((this.listeners[type] || []).map(callback => callback(data)));
      await tick();
    }
    focus() { app.focus = this.id; app.document.activeElement = this; }
    blur() { app.document.activeElement = null; }
    click() { return this.trigger('click'); }
    requestSubmit() { return this.trigger('submit'); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    get firstElementChild() { return this.children[0]; }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    contains(element) { return element === this || this.children.some(c => c.contains(element)); }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); this.setSelectionRange(start + text.length, start + text.length); }
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
  for (const key of ['esc', 'tab', 'interrupt', 'up', 'down', 'left', 'right', 'enter', 'home', 'end', 'delete', 'clear', 'eof', 'undo-line', 'suspend']) {
    const button = new Element(`key-${key}`, 'button'); button.dataset.key = key; button.disabled = true; keyButtons.push(button);
  }
  keyButtons.push(...['ctrl-key', 'paste', 'font-size', 'more-keys', 'keyboard-toggle', 'scroll-bottom'].map(id => elements.get(id)));
  const storage = new Map(), requests = [], sockets = [], timers = new Map();
  const app = { elements, storage, requests, sockets, focus: null, key: key => keyButtons.find(b => b.dataset.key === key) };
  class Terminal {
    constructor(options) { this.options = options; this.cols = 80; this.rows = 24; this.output = []; app.terminal = this; }
    loadAddon(addon) { addon.terminal = this; }
    open() {}
    onData(handler) { this.ondata = handler; }
    onResize(handler) { this.onresize = handler; }
    reset() { this.output = []; }
    write(data, callback) { this.output.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')); callback?.(); }
    writeln(data) { this.output.push(data + '\r\n'); }
    paste(data) { this.ondata(data); }
    focus() { app.focus = 'terminal'; }
    scrollToBottom() {}
    dispose() { this.disposed = true; }
    attachCustomKeyEventHandler(handler) { this.onkey = handler; }
    hasSelection() { return !!this.selection; }
    getSelection() { return this.selection; }
  }
  class ParsedTerminal extends Xterm {
    constructor(options) { super(options); this.output = []; app.terminal = this; }
    open() { this._core.textarea = { value: '', focus() {} }; }
    write(data, callback) { this.output.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')); super.write(data, callback); }
    onData(handler) { this.ondata = handler; return super.onData(handler); }
    onResize(handler) { this.onresize = handler; return super.onResize(handler); }
    focus() { app.focus = 'terminal'; }
    scrollToBottom() {}
  }
  class FitAddon { activate(terminal) { this.terminal = terminal; } dispose() {} fit() { this.terminal.onresize?.({ cols: this.terminal.cols, rows: this.terminal.rows }); } }
  class WebSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    send(packet) { this.sent.push(JSON.parse(packet)); }
    receive(packet) { this.onmessage?.({ data: JSON.stringify(packet) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const document = { getElementById: id => elements.get(id), createElement: tag => new Element('', tag), body: new Element('body'), documentElement: new Element('root') };
  const events = {}, parent = { messages: [], postMessage: message => parent.messages.push(message) };
  const window = { parent, Terminal: realTerminal ? ParsedTerminal : Terminal, FitAddon: { FitAddon }, innerHeight: 700, matchMedia: query => ({ matches: mobile && /coarse|max-width/.test(query) }),
    addEventListener(type, handler) { (events[type] ||= []).push(handler); }, visualViewport: { height: 620, addEventListener() {} } };
  const context = { window, document, WebSocket, TextEncoder, Uint8Array, Date, console, URLSearchParams, AbortController,
    location: { protocol: 'https:', host: 'strgo.com', origin: 'https://strgo.com', search: params }, navigator: {},
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
  app.message = async (action, data = {}) => { for (const fn of events.message || []) fn({ origin: 'https://strgo.com', source: parent, data: { source: 'strgo-workspace', action, ...data } }); await tick(); };
  app.parent = parent;
  app.bubbles = side => elements.get('chat-log').children.filter(row => !side || row.className.includes(side)).map(row => row.children[1].children[1]);
  app.output = async bytes => {
    sockets.at(-1).receive({ type: 'output', data: Buffer.from(bytes).toString('base64') });
    if (realTerminal) await new Promise(resolve => app.terminal.write('', resolve));
  };
  app.connect = async () => {
    await tick(); elements.get('host').value = 'ssh.example.com';
    await elements.get('connect-form').trigger('submit');
    const socket = sockets.at(-1); socket.open(); socket.receive({ type: 'ready' }); await tick(); return socket;
  };
  vm.runInNewContext(script, context);
  return app;
}

test('unauthenticated session frames cannot create a socket and show the account entry', async () => {
  const app = application({ authenticated: false }); await tick();
  await app.elements.get('connect-form').trigger('submit'); assert.equal(app.sockets.length, 0);
  assert.equal(app.elements.get('access-panel').hidden, false);
  assert.equal(app.elements.get('connection-fields').disabled, true);
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

test('chat composition sends once, Enter edits, and passwords never become chat text', async () => {
  const app = application({ mobile: true }); const socket = await app.connect();
  const input = app.elements.get('command-editor');
  await input.trigger('compositionstart'); input.value = '你好';
  await input.trigger('keydown', { key: 'Enter', isComposing: true, ctrlKey: true });
  await app.elements.get('submit-input').trigger('click');
  assert.equal(socket.sent.filter(p => p.type === 'input').length, 0);
  await input.trigger('compositionend');
  await input.trigger('keydown', { key: 'Enter' });
  assert.equal(socket.sent.filter(p => p.type === 'input').length, 0, 'plain Enter must not execute');
  await input.trigger('keydown', { key: 'Enter', ctrlKey: true });
  assert.equal(socket.sent.filter(p => p.type === 'input').map(p => p.data).join(''), '你好\r');
  assert.equal(input.value, ''); assert.equal(app.bubbles('sent').at(-1).textContent, '你好');
  await app.elements.get('secret-input').trigger('click');
  const password = app.elements.get('mobile-input'); assert.equal(password.type, 'password');
  password.value = 'ssh-password'; await app.elements.get('submit-input').trigger('click');
  assert.equal(password.value, '');
  assert.equal(app.bubbles('sent').at(-1).textContent, '［密码已发送］');
  assert.ok(!app.bubbles().some(b => b.textContent.includes('ssh-password')));
  assert.equal(app.storage.size, 0); assert.equal(app.document.body.classList.contains('connected'), true);
});

test('shortcut Tab hands completion to the terminal and Ctrl+C discards the local draft', async () => {
  const app = application(); const socket = await app.connect(); const input = app.elements.get('command-editor');
  input.value = 'ls'; await app.elements.get('keys').trigger('click', { target: app.key('enter') });
  assert.equal(socket.sent.slice(-2).map(p => p.data).join(''), 'ls\r');
  input.value = 'systemc'; await app.elements.get('keys').trigger('click', { target: app.key('tab') });
  assert.equal(socket.sent.at(-2).data, 'systemc'); assert.equal(socket.sent.at(-1).data, '\t'); assert.equal(input.value, '');
  assert.equal(app.document.body.classList.contains('direct-input'), true);
  await app.elements.get('edit-mode').trigger('click');
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

test('session frames never store SSH metadata or chat in unscoped browser storage', async () => {
  const app = application(); app.elements.get('remember-target').checked = true; await app.connect();
  assert.equal(app.storage.size, 0);
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
  await app.elements.get('logout').trigger('click'); assert.equal(app.context.location.href, '/terminal/');
  assert.equal(app.elements.get('connection-fields').disabled, false);
});

test('clipboard denial falls back to mobile input and binary UTF-8 output is decoded', async () => {
  const app = application(); const socket = await app.connect();
  await app.elements.get('paste').trigger('click'); assert.equal(app.focus, 'command-editor');
  socket.receive({ type: 'output', data: Buffer.from('彩色输出\x1b[31m').toString('base64') });
  assert.equal(app.terminal.output.at(-1), '彩色输出\x1b[31m');
});

test('multiline chat sends a single message and a final Enter without modifying the draft', async () => {
  const app = application(); const socket = await app.connect();
  const editor = app.elements.get('command-editor'); editor.value = 'printf "你好"\nprintf "世界"';
  await app.elements.get('expand-editor').trigger('click');
  assert.equal(editor.value, 'printf "你好"\nprintf "世界"');
  await app.elements.get('submit-input').trigger('click');
  assert.equal(socket.sent.filter(p => p.type === 'input').map(p => p.data).join(''), 'printf "你好"\nprintf "世界"\r');
  assert.equal(app.bubbles('sent').at(-1).textContent, 'printf "你好"\nprintf "世界"');
  assert.equal(editor.value, '');
});

test('clipboard content is reviewed in the composer before any command is sent', async () => {
  const app = application(); const socket = await app.connect();
  app.context.navigator.clipboard = { readText: async () => 'echo first\necho second' };
  await app.elements.get('paste').trigger('click');
  assert.equal(app.elements.get('command-editor').value, 'echo first\necho second');
  assert.equal(socket.sent.filter(p => p.type === 'input').length, 0);
});

test('a blocked send retains the entire draft and creates no sent bubble', async () => {
  const app = application(); const socket = await app.connect();
  socket.bufferedAmount = 300 * 1024;
  const editor = app.elements.get('command-editor'); editor.value = 'important draft';
  await app.elements.get('submit-input').trigger('click');
  assert.equal(editor.value, 'important draft'); assert.equal(app.bubbles('sent').length, 0);
  assert.equal(socket.sent.filter(p => p.type === 'input').length, 0);
  socket.bufferedAmount = 0;
  await app.elements.get('submit-input').trigger('click');
  assert.equal(editor.value, ''); assert.equal(app.bubbles('sent').length, 1);
});

test('reusing a command only edits the draft and never executes it', async () => {
  const app = application(); const socket = await app.connect();
  const editor = app.elements.get('command-editor'); editor.value = 'ls -la';
  await app.elements.get('submit-input').trigger('click');
  const sent = app.elements.get('chat-log').children.find(row => row.className.includes('sent'));
  const reuse = sent.children[1].children[2].children[1];
  const before = socket.sent.length;
  await app.elements.get('chat-log').trigger('click', { target: reuse });
  assert.equal(editor.value, 'ls -la'); assert.equal(socket.sent.length, before);
});

test('chat stream uses real xterm parsing for ANSI, carriage returns, echo and Unicode', async () => {
  const app = application({ realTerminal: true }); await app.connect();
  try {
    await app.output('root@ecs:~# ');
    const editor = app.elements.get('command-editor'); editor.value = 'echo 你好';
    await app.elements.get('submit-input').trigger('click');
    await app.output('echo 你好\r\n\x1b[32m你好\x1b[0m\r\n10%');
    assert.equal(app.bubbles('received').at(-1).textContent, '你好\n10%');
    assert.equal(Object.hasOwn(app.bubbles('received').at(-1).attributes, 'data-terminal-ui'), false);
    await app.output('\r\x1b[2K100%\r\nroot@ecs:~# ');
    const text = app.bubbles('received').at(-1).textContent;
    assert.equal(text, '你好\n100%\nroot@ecs:~# ');
    assert.ok(!text.includes('\x1b'));
    const bytes = Buffer.from('中文🐉');
    await app.output(bytes.subarray(0, 2)); await app.output(bytes.subarray(2));
    assert.ok(app.bubbles('received').at(-1).textContent.includes('中文🐉'));
  } finally { app.terminal.dispose(); }
});

test('bracketed paste keeps multiline text intact before execution', async () => {
  const app = application({ realTerminal: true }); const socket = await app.connect();
  try {
    await app.output('\x1b[?2004h');
    app.elements.get('command-editor').value = 'echo one\necho two';
    await app.elements.get('submit-input').trigger('click');
    const input = socket.sent.filter(p => p.type === 'input').map(p => p.data).join('');
    assert.equal(input, '\x1b[200~echo one\recho two\x1b[201~\r');
  } finally { app.terminal.dispose(); }
});

test('fullscreen terminal programs switch views while preserving the unsubmitted draft', async () => {
  const app = application({ realTerminal: true }); await app.connect();
  try {
    app.elements.get('command-editor').value = 'unsubmitted draft';
    await app.output('\x1b[?1049h\x1b[2Jvim screen');
    assert.equal(app.document.body.classList.contains('direct-input'), true);
    assert.equal(app.elements.get('chat-log').hidden, true);
    assert.equal(app.elements.get('command-editor').value, 'unsubmitted draft');
    await app.output('\x1b[?1049l');
    await app.elements.get('edit-mode').trigger('click');
    assert.equal(app.elements.get('chat-log').hidden, false);
  } finally { app.terminal.dispose(); }
});

test('long-running output keeps scrolling history bounded and preserves the latest output', async () => {
  const app = application({ realTerminal: true }); await app.connect();
  try {
    await app.output('root# ');
    app.elements.get('command-editor').value = 'stream';
    await app.elements.get('submit-input').trigger('click');
    await app.output('stream\r\n' + Array.from({ length: 4500 }, (_, i) => `line ${i}\r\n`).join(''));
    const text = app.bubbles('received').at(-1).textContent;
    assert.ok(text.includes('line 4499')); assert.ok(text.length < 48050);
    assert.ok(text.includes('较早输出已省略'));
  } finally { app.terminal.dispose(); }
});

test('password mode also suppresses a server echo split across output frames', async () => {
  const app = application({ realTerminal: true }); await app.connect();
  try {
    await app.output('Password: ');
    await app.elements.get('secret-input').trigger('click');
    app.elements.get('mobile-input').value = 'private-password';
    await app.elements.get('submit-input').trigger('click');
    await app.output('private-');
    assert.ok(!app.bubbles().some(b => b.textContent.includes('private-')));
    await app.output('password\r\nPermission denied\r\nPassword: ');
    assert.ok(!app.bubbles().some(b => b.textContent.includes('private-password')));
    assert.ok(app.bubbles('received').at(-1).textContent.includes('Permission denied'));
  } finally { app.terminal.dispose(); }
});

test('an account workspace opens directly without an SSH target or client-chosen owner', async () => {
  const app = application({ params: '?embed=1&mode=workspace&auto=1' }); await tick(); await tick();
  assert.equal(app.sockets.length, 1); app.sockets[0].open();
  assert.deepEqual(app.sockets[0].sent[0], { type: 'workspace', cols: 80, rows: 24 });
  app.sockets[0].receive({ type: 'ready' });
  assert.ok(app.bubbles('received').some(b => b.textContent.includes('可以直接发送命令')));
  assert.ok(app.parent.messages.some(m => m.type === 'status' && m.state === 'ready'));
});

test('switching windows clears passwords while retaining ordinary unsubmitted drafts', async () => {
  const app = application({ params: '?embed=1&mode=ssh' }); await app.connect();
  app.elements.get('command-editor').value = 'keep this draft';
  await app.message('deactivate'); assert.equal(app.elements.get('command-editor').value, 'keep this draft');
  await app.message('activate'); await app.elements.get('secret-input').click();
  app.elements.get('mobile-input').value = 'private-password';
  await app.message('deactivate');
  assert.equal(app.elements.get('mobile-input').value, '');
  assert.equal(app.elements.get('mobile-input').type, 'text');
  assert.ok(!app.bubbles().some(b => b.textContent.includes('private-password')));
});

test('disconnect retains unsent ordinary drafts and does not replay them on reconnect', async () => {
  const app = application(); const socket = await app.connect();
  app.elements.get('command-editor').value = 'never run automatically';
  socket.close(); assert.equal(app.elements.get('command-editor').value, 'never run automatically');
  const next = await app.connect();
  assert.equal(app.elements.get('command-editor').value, 'never run automatically');
  assert.equal(next.sent.filter(p => p.type === 'input').length, 0);
});

test('native paste in terminal mode is captured into the composer without sending bytes', async () => {
  const app = application(); const socket = await app.connect();
  await app.elements.get('direct-mode').click();
  let prevented = false;
  await app.elements.get('terminal').trigger('paste', { clipboardData: { getData: () => 'echo first\necho second' }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(app.elements.get('command-editor').value, 'echo first\necho second');
  assert.equal(socket.sent.filter(p => p.type === 'input').length, 0);
  assert.equal(app.document.body.classList.contains('direct-input'), false);
});

test('copying a terminal selection never emits interrupt bytes', async () => {
  const app = application(); const socket = await app.connect(); const copied = [];
  app.context.navigator.clipboard = { writeText: async value => copied.push(value) };
  app.terminal.selection = 'select this output';
  assert.equal(app.terminal.onkey({ type: 'keydown', key: 'c', ctrlKey: true }), false);
  await tick(); assert.equal(copied[0], 'select this output');
  assert.equal(socket.sent.filter(p => p.type === 'input').length, 0);
});

test('separate window runtimes cannot share sockets, buffers, chats or drafts', async () => {
  const a = application(), b = application(), c = application();
  const sa = await a.connect(), sb = await b.connect(), sc = await c.connect();
  a.elements.get('command-editor').value = 'draft-a'; b.elements.get('command-editor').value = 'draft-b';
  await a.elements.get('submit-input').click();
  assert.equal(sa.sent.filter(p => p.type === 'input').map(p => p.data).join(''), 'draft-a\r');
  assert.equal(sb.sent.filter(p => p.type === 'input').length, 0); assert.equal(sc.sent.filter(p => p.type === 'input').length, 0);
  assert.equal(b.elements.get('command-editor').value, 'draft-b');
  assert.equal(b.bubbles('sent').length, 0); assert.equal(c.bubbles('sent').length, 0);
});

test('password prefixes following banners stay hidden during fragmented echo and later commands', async () => {
  const app = application({ realTerminal: true }); await app.connect();
  try {
    await app.output('Password: '); await app.elements.get('secret-input').click();
    app.elements.get('mobile-input').value = 'private-password'; await app.elements.get('submit-input').click();
    await app.output('notice\r\nprivate-');
    assert.ok(!app.bubbles().some(b => b.textContent.includes('private-')));
    assert.ok(app.bubbles('received').at(-1).textContent.includes('notice'));
    await app.output('password\r\nPermission denied\r\nPassword: ');
    assert.ok(!app.bubbles().some(b => b.textContent.includes('private-password')));
    await app.elements.get('secret-input').click(); app.elements.get('command-editor').value = 'echo next';
    await app.elements.get('submit-input').click(); await app.output('echo next\r\nlate echo private-');
    assert.ok(!app.bubbles().some(b => b.textContent.includes('private-')));
    await app.output('password\r\n');
    assert.ok(!app.bubbles().some(b => b.textContent.includes('private-password')));
  } finally { app.terminal.dispose(); }
});

test('character-only output truncation is explicitly disclosed even below the line limit', async () => {
  const app = application({ realTerminal: true }); await app.connect();
  try {
    app.terminal.resize(400, 24); await app.output('X'.repeat(60000));
    const text = app.bubbles('received').at(-1).textContent;
    assert.ok(text.includes('较早输出已省略')); assert.ok(text.length < 48050);
  } finally { app.terminal.dispose(); }
});

test('embedded iPhone sessions use iframe height without applying visual keyboard reduction twice', async () => {
  const app = application({ mobile: true, params: '?embed=1&mode=workspace&auto=0' }); await tick();
  app.context.window.innerHeight = 330;
  app.context.window.visualViewport.height = 140;
  await app.message('viewport', { viewport: { compact: true, keyboard: true } });
  assert.equal(app.document.documentElement.attributes['--viewport-height'], '330px');
  assert.equal(app.document.documentElement.attributes['--viewport-top'], '0px');
  assert.equal(app.document.body.classList.contains('compact-mobile'), true);
  assert.equal(app.document.body.classList.contains('keyboard-open'), true);
  const editor = app.elements.get('command-editor'); editor.scrollHeight = 1000;
  await editor.trigger('input'); assert.ok(parseFloat(editor.style.height) <= 73);
});

test('mobile direct view retains bottom controls and tools do not send commands', async () => {
  const app = application({ mobile: true, params: '?embed=1&mode=workspace' }); const socket = await app.connect();
  await app.elements.get('direct-mode').click(); assert.equal(app.elements.get('composer-body').hidden, false);
  await app.elements.get('mobile-tools-toggle').click();
  assert.equal(app.document.body.classList.contains('mobile-tools-open'), true);
  await app.elements.get('session-list-toggle').click();
  assert.ok(app.parent.messages.some(m => m.type === 'sessions'));
  assert.equal(socket.sent.filter(p => p.type === 'input').length, 0);
  await app.message('dismiss-keyboard'); assert.equal(app.document.body.classList.contains('mobile-tools-open'), false);
});
