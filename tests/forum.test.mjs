import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const html = readFileSync(new URL('../src/forum/index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/forum/app.js', import.meta.url), 'utf8');
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const member = { id: 'member-id', username: 'member', role: 'member' };
const other = { id: 'other-id', username: 'other', role: 'member' };
const fixturePost = (overrides = {}) => ({ id: 'a'.repeat(32), title: '分享一个想法', body: '你好，社区！', category: 'general', pinned: false, author: member, canDelete: true, created: 1792640000, ...overrides });

async function environment({ user = member, posts = [fixturePost()], failure = null } = {}) {
  const { window: dom, document } = parseHTML(html);
  const window = new dom.EventTarget();
  const requests = [], timers = new Map();
  const session = { user, csrf: 'test-csrf' };
  let fail = failure, defer = null, nextId = 0;
  document.querySelectorAll('input,textarea').forEach(input => { input.value = ''; });
  document.querySelectorAll('form').forEach(form => { form.reset = () => {
    form.querySelectorAll('input,textarea').forEach(input => { input.value = ''; });
  }; });
  document.querySelectorAll('select').forEach(select => Object.defineProperty(select, 'value', { writable: true, configurable: true, value: 'general' }));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.showModal = () => { dialog.open = true; dialog.setAttribute('open', ''); };
    dialog.close = () => { dialog.open = false; dialog.removeAttribute('open'); dialog.dispatchEvent(new dom.Event('close')); };
  });
  const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const sandbox = { window, document, URLSearchParams, Intl, Date, console,
    setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url, options) {
      const path = url.replace('/api/image', '');
      const body = options.body ? JSON.parse(options.body) : {};
      requests.push({ path, ...options, body });
      if (path === '/session') return response({ ...session });
      if (path === '/login' || path === '/register') { session.user = member; return response({ ...session }); }
      if (path === '/logout') { session.user = null; return response({ ok: true }); }
      if (fail) return response({ error: fail.message }, fail.status);
      if (path.startsWith('/forum/posts?')) {
        if (defer) { const callback = defer; defer = null; return callback(); }
        const query = new URL(url, 'http://local').searchParams;
        const filtered = posts.filter(post => (query.get('scope') !== 'mine' || post.author.id === session.user.id) && (!query.get('q') || post.title.includes(query.get('q'))));
        return response({ posts: filtered, total: filtered.length, hasMore: false, stats: { posts: posts.length, contributors: 2, mine: posts.filter(post => post.author.id === session.user.id).length } });
      }
      if (path === '/forum/posts' && options.method === 'POST') {
        const post = fixturePost({ ...body, id: String(++nextId).padStart(32, '0') }); posts.unshift(post); return response(post, 201);
      }
      const id = path.split('/')[3]; const post = posts.find(post => post.id === id);
      if (options.method === 'DELETE') { posts.splice(posts.indexOf(post), 1); return response({ ok: true }); }
      if (path.endsWith('/pin')) { post.pinned = body.pinned; return response(post); }
      return response(post);
    },
  };
  vm.runInNewContext(source, sandbox, { timeout: 5000 }); await tick();
  const click = selector => document.querySelector(selector).dispatchEvent(new dom.Event('click', { bubbles: true }));
  const input = (selector, value) => { const field = document.querySelector(selector); field.value = value; field.dispatchEvent(new dom.Event('input', { bubbles: true })); };
  const submit = selector => document.querySelector(selector).dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }));
  return { document, window, requests, session, posts, click, input, submit, response,
    focus() { window.dispatchEvent(new dom.Event('focus')); },
    fail(value) { fail = value; }, defer(callback) { defer = callback; },
  };
}

test('Shared login opens the forum; anonymous visitors never load private posts', async () => {
  const locked = await environment({ user: null });
  assert.equal(locked.document.querySelector('#workspace').hidden, true);
  assert.equal(locked.requests.some(request => request.path.startsWith('/forum')), false);
  locked.input('#username', 'member'); locked.input('#password', 'test-private-password'); locked.submit('#auth-form'); await tick();
  assert.equal(locked.document.querySelector('#workspace').hidden, false);
  assert.equal(locked.document.querySelector('#password').value, '');
  assert.equal(locked.requests.find(request => request.path === '/login').credentials, 'same-origin');
});

test('Member controls only expose own deletion, while admins see moderation controls', async () => {
  const env = await environment({ posts: [fixturePost(), fixturePost({ id: 'b'.repeat(32), author: other, canDelete: false })] });
  assert.equal(env.document.querySelectorAll('.delete-post').length, 1);
  assert.equal(env.document.querySelectorAll('.pin-post').length, 0);
  assert.equal(env.document.querySelector('#admin-note').hidden, true);
  const admin = await environment({ user: { ...member, role: 'admin' }, posts: [fixturePost(), fixturePost({ id: 'b'.repeat(32), author: other })] });
  assert.equal(admin.document.querySelectorAll('.pin-post').length, 2);
  assert.equal(admin.document.querySelectorAll('.delete-post').length, 2);
});

test('Untrusted titles, author names and bodies stay plain text in feed and detail', async () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const env = await environment({ posts: [fixturePost({ title: malicious, body: '<script>alert(2)</script>', author: { ...other, username: malicious } })] });
  assert.equal(env.document.querySelector('#posts img'), null);
  assert.equal(env.document.querySelector('#posts script'), null);
  assert.match(env.document.querySelector('#posts').textContent, /<img/);
  env.click('.post-open'); await tick();
  assert.equal(env.document.querySelector('#detail-content script'), null);
  assert.equal(env.document.querySelector('.detail-body').textContent, '<script>alert(2)</script>');
});

test('Publishing sends CSRF, blocks duplicate submits, and clears drafts only on success', async () => {
  const env = await environment();
  env.click('[data-compose]'); env.input('#post-title', '新作品'); env.input('#post-body', '一个新想法');
  env.fail({ message: '暂时不可用', status: 503 }); env.submit('#post-form'); await tick();
  assert.equal(env.document.querySelector('#post-title').value, '新作品');
  assert.match(env.document.querySelector('#post-message').textContent, /暂时不可用/);
  env.fail(null); env.submit('#post-form'); env.submit('#post-form'); await tick();
  assert.equal(env.posts.length, 2);
  assert.equal(env.document.querySelector('#post-title').value, '');
  assert.equal(env.document.querySelector('#compose-dialog').open, false);
  assert.equal(env.requests.find(request => request.method === 'POST').headers['X-CSRF-Token'], 'test-csrf');
});

test('Delete cancellation and failure preserve the post; successful deletion updates the feed', async () => {
  const env = await environment();
  env.click('.delete-post'); env.click('#delete-cancel');
  assert.equal(env.requests.some(request => request.method === 'DELETE'), false);
  env.click('.delete-post'); env.fail({ status: 503, message: '删除失败' }); env.click('#delete-confirm'); await tick();
  assert.equal(env.posts.length, 1); assert.equal(env.document.querySelector('#delete-dialog').open, true);
  env.fail(null); env.click('#delete-confirm'); await tick();
  assert.equal(env.posts.length, 0); assert.equal(env.document.querySelector('#empty-state').hidden, false);
});

test('A stale list response cannot replace a more recent search result', async () => {
  const env = await environment(); let resolveOld;
  env.defer(() => new Promise(resolve => { resolveOld = resolve; }));
  env.click('#refresh'); await tick();
  env.input('#search', '没有结果'); env.submit('#search-form'); await tick();
  resolveOld(env.response({ posts: [fixturePost()], total: 1, hasMore: false, stats: { posts: 1, contributors: 1, mine: 1 } })); await tick();
  assert.equal(env.document.querySelectorAll('.post-card').length, 0);
  assert.equal(env.document.querySelector('#result-count').textContent, '0 篇话题');
});

test('Session expiry closes private dialogs and erases data and drafts', async () => {
  const env = await environment();
  env.click('[data-compose]'); env.input('#post-body', 'private draft');
  env.fail({ status: 401, message: '请重新登录' }); env.click('#refresh'); await tick();
  assert.equal(env.document.querySelector('#workspace').hidden, true);
  assert.equal(env.document.querySelector('#compose-dialog').open, false);
  assert.equal(env.document.querySelector('#post-body').value, '');
  assert.equal(env.document.querySelector('#posts').textContent, '');
});

test('Returning from another app detects account changes and clears the previous draft', async () => {
  const env = await environment();
  env.click('[data-compose]'); env.input('#post-body', 'private draft');
  env.session.user = other; env.session.csrf = 'other-csrf'; env.focus(); await tick();
  assert.equal(env.document.querySelector('#post-body').value, '');
  assert.equal(env.document.querySelector('#side-name').textContent, 'other');
});
