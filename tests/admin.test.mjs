import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createAdmin } from '../src/admin/app.js';

const owner = { id: 'a'.repeat(32), username: 'owner', role: 'admin' };
const member = { id: 'b'.repeat(32), username: '<img src=x onerror=alert(1)>', role: 'member', status: 'active', aiStatus: 'active', sessions: 2, created: 1700000000, updated: 5 };
const list = items => ({ items, total: items.length, hasMore: false });
async function fixture({ status = 200, fail = '', confirmed = true } = {}) {
  const { document } = parseHTML(await readFile(new URL('../src/admin/index.html', import.meta.url), 'utf8'));
  const calls = [], location = { hash: '', reload() {} };
  const fetch = async (path, options) => {
    calls.push({ path, ...options });
    const url = new URL(path, 'https://strgo.com'), route = url.pathname.replace('/api/image/admin', '');
    let data = { ok: true }, code = 200;
    if (route === '/session') { code = status; data = status === 200 ? { user: owner, csrf: 'admin-csrf' } : { error: '拒绝访问' }; }
    else if (route === '/summary') data = { counts: { users: 2, sessions: 3, posts: 0, images: 0, audio: 0, imageBytes: 0, audioBytes: 0 }, tasks: { image: [], ai: [], workflow: [] }, storage: { ready: true, label: '磁盘', freeBytes: 1048576 }, backup: {}, workflow: {} };
    else if (route === '/users' && options.method === 'GET') data = { items: [owner, member], total: 23, hasMore: !url.searchParams.get('offset') || url.searchParams.get('offset') === '0' };
    else if (route === '/invites') data = options.method === 'POST' ? { code: 'STRGO-new-secret', expires: 1800000000 } : list([{ id: 'c'.repeat(64), role: 'member', status: 'active', expires: 1800000000 }]);
    else if (route === '/policy') data = { dailyImageLimit: null };
    else if (route === '/forum/posts') data = { posts: [{ id: 'd'.repeat(32), title: '<script>bad</script>', body: 'Hello <img>', author: { username: 'member' }, category: 'general', created: 1700000000, pinned: false }], total: 1, hasMore: false };
    else if (route === '/tasks' || route === '/audit') data = list([]);
    if (fail && options.method !== 'GET' && path.includes(fail)) { code = 409; data = { error: '账号已被修改，请刷新重试。' }; }
    return { ok: code === 200, status: code, json: async () => structuredClone(data) };
  };
  const app = createAdmin({ document, fetch, confirm: () => confirmed, location });
  await app.start();
  async function click(selector) { const button = document.querySelector(selector); assert.ok(button, selector); await button.onclick({ currentTarget: button, preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); }
  return { document, calls, app, click, go: view => click(`[data-view="${view}"]`) };
}

test('admin handles anonymous login and denies member management', async () => {
  const anonymous = await fixture({ status: 401 });
  assert.ok(anonymous.document.querySelector('#login'));
  anonymous.document.querySelector('[name=username]').value = 'owner';
  anonymous.document.querySelector('[name=password]').value = 'private-test';
  const form = anonymous.document.querySelector('#login');
  await form.onsubmit({ target: form, preventDefault() {} });
  const login = anonymous.calls.find(call => call.path === '/api/image/login');
  assert.ok(login);
  assert.equal(login.credentials, 'same-origin');
  const member = await fixture({ status: 403 });
  assert.match(member.document.querySelector('#main').textContent, /需要管理员权限/);
  assert.ok(!member.calls.some(call => call.path.includes('/users')));
});

test('account controls escape names, preserve revision and carry CSRF', async () => {
  const env = await fixture(); await env.go('users');
  assert.equal(env.document.querySelector('#main img'), null);
  assert.equal(env.document.querySelector(`[data-user="${owner.id}"]`).disabled, true);
  await env.click(`[data-user="${member.id}"][data-action=status]`);
  const call = env.calls.find(call => call.method === 'PUT');
  assert.deepEqual(JSON.parse(call.body), { revision: 5, status: 'disabled' });
  assert.equal(call.headers['X-CSRF-Token'], 'admin-csrf');
});

test('cancelled destructive operations do not send requests', async () => {
  const env = await fixture({ confirmed: false }); await env.go('users');
  await env.click(`[data-user="${member.id}"][data-action=revoke]`);
  assert.equal(env.calls.some(call => call.method === 'DELETE'), false);
});

test('user search and pagination request the correct bounded page', async () => {
  const env = await fixture(); await env.go('users'); await env.click('#next');
  assert.ok(env.calls.at(-1).path.includes('offset=20'));
  env.document.querySelector('#search input').value = 'member';
  env.document.querySelector('#search').onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(env.calls.at(-1).path.includes('offset=0'));
  assert.ok(env.calls.at(-1).path.includes('q=member'));
});

test('invitation creation displays original once and clears on navigation', async () => {
  const env = await fixture(); await env.go('invites'); await env.click('#create-invite');
  assert.equal(env.document.querySelector('.invite-code').value, 'STRGO-new-secret');
  await env.go('users'); assert.ok(!env.document.querySelector('.invite-code'));
  assert.ok(!env.document.documentElement.outerHTML.includes('STRGO-new-secret'));
});

test('conflicts remain visible without claiming success', async () => {
  const env = await fixture({ fail: '/users/' }); await env.go('users');
  await env.click(`[data-user="${member.id}"][data-action=role]`);
  assert.equal(env.document.querySelector('#feedback').dataset.error, 'true');
  assert.match(env.document.querySelector('#feedback').textContent, /账号已被修改/);
});

test('community content is text and pin/delete use existing moderation semantics', async () => {
  const env = await fixture(); await env.go('forum');
  assert.equal(env.document.querySelector('#main script'), null);
  await env.click('[data-op=pin]');
  assert.deepEqual(JSON.parse(env.calls.find(call => call.method === 'PUT').body), { pinned: true });
  await env.click('[data-op=delete]');
  assert.ok(env.calls.some(call => call.method === 'DELETE' && call.path.endsWith('d'.repeat(32))));
  assert.deepEqual(JSON.parse(env.calls.find(call => call.method === 'DELETE').body), {});
});

test('policy accepts unlimited and zero; logout clears management content', async () => {
  const env = await fixture(); await env.go('policy');
  for (const raw of ['', '0']) {
    env.document.querySelector('#daily-limit').value = raw;
    const form = env.document.querySelector('#policy');
    await form.onsubmit({ target: form, preventDefault() {} });
    assert.equal(JSON.parse(env.calls.at(-1).body).dailyImageLimit, raw === '' ? null : 0);
  }
  await env.click('#logout');
  assert.ok(env.document.querySelector('#login'));
  assert.equal(env.document.querySelector('#account').textContent, '');
});
