import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
let parseHTML;
try { ({ parseHTML } = require('linkedom')); }
catch { ({ parseHTML } = require(process.env.TERMINAL_LINKEDOM || '/root/strgo-homepage/node_modules/linkedom')); }
const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../web/workspace.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const owner = { id: 'a'.repeat(32), username: 'owner', role: 'member' };

async function application({ loggedIn = true, storageFailure = false, saved = null, mobile = false } = {}) {
  const { document } = parseHTML(html), listeners = {}, requests = [], frames = [];
  const storage = new Map();
  if (saved) storage.set(`strgo-terminal-windows:${owner.id}`, JSON.stringify(saved));
  let currentUser = owner, logoutFailure = false;
  const create = document.createElement.bind(document);
  document.createElement = tag => {
    const el = create(tag);
    if (tag === 'iframe') { const packets = []; Object.defineProperty(el, 'contentWindow', { value: { packets, postMessage: data => packets.push(data) } }); frames.push(el); }
    return el;
  };
  const dialog = document.getElementById('action-dialog');
  dialog.showModal = () => dialog.setAttribute('open', ''); dialog.close = () => dialog.removeAttribute('open');
  for (const id of ['rename-value', 'account-name', 'account-password', 'session-search']) {
    const el = document.getElementById(id); el.select = () => {}; el.focus = () => {}; el.value ||= '';
  }
  const visualListeners = {};
  const window = { matchMedia: () => ({ matches: mobile }), addEventListener: (type, listener) => (listeners[type] ||= []).push(listener), visualViewport: { height: 840, offsetTop: 0, scale: 1, addEventListener: (type, listener) => (visualListeners[type] ||= []).push(listener) } };
  const context = { window, document, crypto: { randomUUID }, URLSearchParams, AbortController, setTimeout, clearTimeout, location: { origin: 'https://strgo.test' }, innerHeight: 840,
    localStorage: { getItem: key => { if (storageFailure) throw new Error('denied'); return storage.get(key); }, setItem: (key, value) => { if (storageFailure) throw new Error('denied'); storage.set(key, value); } },
    setInterval() {},
    fetch: async (url, options) => {
      requests.push({ url, ...options }); let status = 200, data;
      if (url.endsWith('/login')) {
        const body = JSON.parse(options.body); loggedIn = body.username === 'owner' && body.password === 'valid-password';
        status = loggedIn ? 200 : 401; data = loggedIn ? { user: currentUser, csrf: 'csrf-token' } : { error: '用户名或密码错误。' };
      } else if (url.endsWith('/logout')) {
        if (logoutFailure) { status = 503; data = { error: '暂时不可用' }; }
        else { loggedIn = false; data = { ok: true }; }
      } else { status = loggedIn ? 200 : 401; data = loggedIn ? { user: currentUser, csrf: 'csrf-token', maxWindows: 8 } : { error: '请先登录' }; }
      return { status, ok: status === 200, json: async () => data };
    },
  };
  vm.runInNewContext(script, context); await tick(); await tick();
  const $ = id => document.getElementById(id);
  return { $, document, window, frames, storage, requests,
    visual: window.visualViewport,
    viewport: async type => { for (const fn of visualListeners[type || 'resize'] || []) fn(); await tick(); },
    flush: async () => { await tick(); await tick(); },
    emit: async (type, data) => { for (const fn of listeners[type] || []) fn(data); await tick(); },
    event: async (id, type = 'click') => { $(id).dispatchEvent(new document.defaultView.Event(type, { bubbles: true, cancelable: true })); await tick(); await tick(); },
    failLogout: () => { logoutFailure = true; },
    switchAccount: info => { currentUser = info; },
  };
}

test('first login opens a workspace immediately and stores only account-scoped metadata', async () => {
  const app = await application();
  assert.equal(app.$('auth-view').hidden, true); assert.equal(app.frames.length, 1);
  assert.match(app.frames[0].src, /mode=workspace/); assert.match(app.frames[0].src, /auto=1/);
  assert.equal(app.$('account-label').textContent, 'owner');
  const data = JSON.parse(app.storage.get(`strgo-terminal-windows:${owner.id}`));
  assert.deepEqual(Object.keys(data.sessions[0]).sort(), ['id', 'mode', 'name']);
  assert.equal(data.sessions[0].name, '我的终端');
});

test('account login uses the existing image API and clears the password on success or failure', async () => {
  const app = await application({ loggedIn: false });
  assert.equal(app.frames.length, 0); assert.equal(app.$('app-view').hidden, true);
  app.$('account-name').value = 'owner'; app.$('account-password').value = 'wrong';
  await app.event('account-login', 'submit');
  assert.equal(app.$('account-password').value, ''); assert.equal(app.frames.length, 0);
  assert.match(app.$('auth-message').textContent, /密码错误/);
  app.$('account-password').value = 'valid-password'; await app.event('account-login', 'submit');
  assert.equal(app.frames.length, 1); assert.equal(app.$('account-password').value, '');
  assert.ok(!JSON.stringify([...app.storage.values()]).includes('valid-password'));
  assert.equal(app.requests.find(r => r.url.endsWith('/login')).credentials, 'same-origin');
});

test('three windows preserve independent connections and only trust their own message source', async () => {
  const app = await application(); await app.event('new-terminal'); await app.event('new-terminal');
  const [a, b, c] = app.frames;
  assert.equal(a.hidden, true); assert.equal(c.hidden, false);
  assert.ok(a.contentWindow.packets.some(p => p.action === 'deactivate'));
  assert.ok(!a.contentWindow.packets.some(p => p.action === 'dispose'));
  await app.emit('message', { origin: 'https://strgo.test', source: a.contentWindow, data: { source: 'strgo-terminal', type: 'output', text: 'window A only' } });
  assert.match(app.$('conversation-list').textContent, /window A only/);
  assert.ok(!app.$('conversation-name').textContent.includes('window A only'));
  await app.emit('message', { origin: 'https://evil.test', source: b.contentWindow, data: { source: 'strgo-terminal', type: 'output', text: 'injected' } });
  assert.ok(!app.$('conversation-list').textContent.includes('injected'));
  await app.emit('message', { origin: 'https://strgo.test', source: {}, data: { source: 'strgo-terminal', type: 'output', text: 'forged' } });
  assert.ok(!app.$('conversation-list').textContent.includes('forged'));
  app.$('conversation-list').firstElementChild.click(); await app.flush();
  assert.equal(a.hidden, false); assert.equal(c.hidden, true);
});

test('restore is disconnected, never replays commands, and uses only the current account namespace', async () => {
  const saved = { active: 'two', sessions: [{ id: 'one', name: '工作', mode: 'workspace', password: 'should-not-load' }, { id: 'two', name: '服务器', mode: 'ssh', target: { host: 'server.example', username: 'user', port: 22, password: 'private' } }] };
  const app = await application({ saved });
  assert.equal(app.frames.length, 2); for (const frame of app.frames) assert.match(frame.src, /auto=0/);
  assert.equal(app.frames[1].hidden, false); assert.equal(app.$('conversation-name').textContent, '服务器');
  assert.ok(!JSON.stringify([...app.storage.values()]).includes('private'));
  assert.match(app.$('workspace-message').textContent, /不会自动执行/);
  // A translated notice must still clear when a restored session becomes ready.
  app.$('workspace-message').textContent = 'Restored window settings';
  await app.emit('message', { origin: 'https://strgo.test', source: app.frames[1].contentWindow, data: { source: 'strgo-terminal', type: 'status', state: 'ready', text: '会话已就绪' } });
  assert.equal(app.$('workspace-message').hidden, true);
  app.switchAccount({ id: 'b'.repeat(32), username: 'other', role: 'member' }); await app.emit('focus'); await app.flush();
  assert.equal(app.$('account-label').textContent, 'other'); assert.equal(app.frames.length, 3);
  assert.equal(app.frames[0].parentElement, null); assert.ok(app.frames[0].contentWindow.packets.some(p => p.action === 'dispose'));
  assert.equal(app.$('conversation-name').textContent, '我的终端');
});

test('locale changes translate system previews without rewriting session names or shell output', async () => {
  const saved = { active:'one', sessions:[{ id:'one', name:'连接', mode:'workspace' }] };
  const app = await application({saved});
  app.window.terminalI18n={text:value=>({'工作区':'Workspace','会话已就绪':'Session ready','连接':'Connect','有新输出':'New output'})[value]||value};
  await app.emit('message',{origin:'https://strgo.test',source:app.frames[0].contentWindow,data:{source:'strgo-terminal',type:'status',state:'ready',text:'会话已就绪'}});
  await app.emit('terminal:localechange',{});
  assert.equal(app.$('conversation-list').querySelector('strong').textContent,'连接');
  assert.match(app.$('conversation-list').textContent,/Workspace · Session ready/);
  await app.emit('message',{origin:'https://strgo.test',source:app.frames[0].contentWindow,data:{source:'strgo-terminal',type:'output',text:'连接'}});
  assert.match(app.$('conversation-list').textContent,/连接连接/);
  await app.emit('message',{origin:'https://strgo.test',source:app.frames[0].contentWindow,data:{source:'strgo-terminal',type:'output',text:'连接',ui:true}});
  assert.match(app.$('conversation-list').textContent,/连接Connect/);
});

test('rename and close target only the selected window and closing asks for confirmation', async () => {
  const app = await application(); await app.event('new-terminal');
  await app.event('rename-session'); assert.equal(app.$('action-dialog').hasAttribute('open'), true);
  app.$('rename-value').value = '部署窗口'; await app.event('action-form', 'submit');
  assert.equal(app.$('conversation-name').textContent, '部署窗口');
  await app.event('close-session'); assert.ok(app.frames[1].parentElement);
  await app.event('action-cancel'); assert.ok(app.frames[1].parentElement);
  await app.event('close-session'); await app.event('action-form', 'submit');
  assert.equal(app.frames[1].parentElement, null); assert.ok(app.frames[0].parentElement);
  assert.equal(app.$('conversation-name').textContent, '我的终端');
});

test('eight-window limit, search, and storage-denied recovery remain usable', async () => {
  const app = await application({ storageFailure: true });
  for (let i = 0; i < 10; i++) await app.event('new-terminal');
  assert.equal(app.frames.length, 8); assert.equal(app.$('new-terminal').disabled, true);
  app.$('session-search').value = '不存在'; await app.event('session-search', 'input');
  assert.equal(app.$('list-empty').hidden, false); assert.equal(app.$('conversation-list').children.length, 0);
  app.$('session-search').value = ''; await app.event('session-search', 'input');
  assert.equal(app.$('conversation-list').children.length, 8);
});

test('logout includes CSRF and destroys all windows; failed logout can be retried', async () => {
  const app = await application(); await app.event('new-terminal'); await app.event('account-logout');
  assert.equal(app.$('auth-view').hidden, false); assert.equal(app.$('app-view').hidden, true);
  assert.ok(app.frames.every(f => !f.parentElement && f.contentWindow.packets.some(p => p.action === 'dispose')));
  assert.equal(app.requests.at(-1).headers['X-CSRF-Token'], 'csrf-token');
  const failing = await application(); failing.failLogout(); await failing.event('account-logout');
  assert.equal(failing.$('app-view').hidden, false); assert.match(failing.$('workspace-message').textContent, /退出失败/);
});

test('iPhone keyboard height and Safari viewport panning are owned by the outer page', async () => {
  const app = await application({ mobile: true });
  app.visual.height = 350; app.visual.offsetTop = 92; await app.viewport('resize'); await app.viewport('scroll');
  assert.equal(app.document.documentElement.style.getPropertyValue('--app-height'), '350px');
  assert.equal(app.document.documentElement.style.getPropertyValue('--app-top'), '92px');
  assert.equal(app.document.body.classList.contains('keyboard-open'), true);
  const packet = app.frames[0].contentWindow.packets.filter(p => p.action === 'viewport').at(-1);
  assert.equal(packet.viewport.compact, true); assert.equal(packet.viewport.keyboard, true);
  app.visual.height = 840; app.visual.offsetTop = 0; await app.viewport();
  assert.equal(app.document.body.classList.contains('keyboard-open'), false);
});

test('the bottom window control opens the mobile list without losing connections', async () => {
  const app = await application({ mobile: true }), frame = app.frames[0];
  await app.emit('message', { origin: 'https://strgo.test', source: frame.contentWindow, data: { source: 'strgo-terminal', type: 'sessions' } });
  assert.equal(app.document.body.classList.contains('list-open'), true);
  assert.ok(frame.contentWindow.packets.some(p => p.action === 'dismiss-keyboard'));
  assert.ok(!frame.contentWindow.packets.some(p => p.action === 'dispose'));
  await app.event('mobile-connect'); assert.ok(frame.contentWindow.packets.some(p => p.action === 'connect'));
  assert.equal(app.document.body.classList.contains('list-open'), false);
});
