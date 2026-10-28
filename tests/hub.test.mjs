import { icon } from '../src/shared/icons.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sanitizePreferences, readPreferences, writePreferences, filterEntries, safeReturnPath, requestJSON, allowedAction } from '../src/hub/core.js';
import { requestedJob } from '../src/image-playground/hub-links.js';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { escapeHTML as esc } from '../src/hub/core.js';

const registry = JSON.parse(await readFile(new URL('../content/app-registry.json', import.meta.url)));
test('public catalogue hides administrative routes and searches Chinese, English and paths', () => {
  assert.equal(registry.entries.length, 28);
  assert.equal(registry.entries.filter(e => e.group === '沉浸空间').length, 9);
  assert.equal(filterEntries(registry.entries, { role: 'guest' }).length, 25);
  assert.equal(filterEntries(registry.entries, { role: 'admin' }).length, 28);
  assert.equal(filterEntries(registry.entries, { query: '/home' })[0].id, 'S01');
  assert.equal(filterEntries(registry.entries, { query: '  音乐  ' })[0].id, 'C03');
  assert.deepEqual(filterEntries(registry.entries, { group: '我的收藏', favorites: ['A01'] }), []);
});
test('preferences tolerate corruption, filter unknown IDs and separate account keys', () => {
  const data = new Map(), storage = { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v) };
  writePreferences(storage, 'one', { favs: ['C01','C01','bogus'], recent: ['C02'], motion: 'off' }, registry.entries);
  assert.deepEqual(readPreferences(storage, 'one', registry.entries).favs, ['C01']);
  assert.deepEqual(readPreferences(storage, 'two', registry.entries).favs, []);
  data.set('strgo:hub:v1:one', '{broken');
  assert.deepEqual(readPreferences(storage, 'one', registry.entries).recent, []);
  assert.equal(readPreferences(undefined, null, registry.entries).mode, 'console');
  assert.equal(sanitizePreferences({ mode: 'admin', motion: 'all' }, registry.entries).motion, 'auto');
});
test('login return and job links cannot navigate off origin or trigger arbitrary requests', () => {
  assert.equal(safeReturnPath('/hub/#tasks'), '/hub/#tasks');
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/\nevil.test', 'javascript:alert(1)', null]) assert.equal(safeReturnPath(value), '/hub/');
  const id = 'a'.repeat(32);
  assert.deepEqual(requestedJob('?reuse=' + id), { id, reuse: true });
  assert.equal(requestedJob('?job=../../session'), null);
});
test('only exact owner item actions can call existing mutation routes', () => {
  const id = 'a'.repeat(32), item = { id, source: 'image', status: 'save_failed' };
  assert.equal(allowedAction({ type: 'retry_save', endpoint: `/api/image/images/${id}/retry` }, item), true);
  assert.equal(allowedAction({ type: 'retry_save', endpoint: '/api/image/jobs' }, item), false);
  assert.equal(allowedAction({ type: 'retry_save', endpoint: `/api/image/images/${id}/retry` }, {...item, status:'complete'}), false);
  assert.equal(allowedAction({ type: 'delete_asset', endpoint: `/api/ai/v1/assets/${id}` }, item), false);
  assert.equal(allowedAction({ type: 'cancel', endpoint: `/api/ai/v1/tasks/${id}/cancel` }, {...item,source:'music',status:'unknown'}), false);
});
test('API transport uses private credentials, CSRF, no caching and AI envelopes', async () => {
  const fetcher = async (url, options) => {
    assert.equal(url, '/api/ai/v1/forms'); assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store'); assert.equal(options.headers['X-CSRF-Token'], 'csrf');
    assert.equal(options.body, '{"kind":"music"}');
    return new Response(JSON.stringify({ data:{id:1} }), {headers:{'Content-Type':'application/json'}});
  };
  assert.deepEqual(await requestJSON('/api/ai/v1/forms', { method:'POST',body:{kind:'music'},csrf:'csrf',fetcher }), {id:1});
  await assert.rejects(requestJSON('https://evil.test/api/image/session', { fetcher }), /不支持/);
  await assert.rejects(requestJSON('/api/image/session', {fetcher:async()=>new Response('<html>bad')}), /不可用/);
  await assert.rejects(requestJSON('/api/image/session', {fetcher:async()=>new Response('{"error":"expired"}',{status:401,headers:{'Content-Type':'application/json'}})}), error=>error.status===401);
});

test('all space covers render with their registered accessible labels', async () => {
  globalThis.window = { STRGO: registry };
  try {
    const { art } = await import('../src/hub/visuals.js');
    for (const entry of registry.entries.filter(e => e.group === '沉浸空间')) {
      assert.match(art(entry.type), new RegExp(entry.name + '视觉示意'));
    }
  } finally { delete globalThis.window; }
});

test('root hub opens its registered spaces and preserves classic root anchors', async () => {
  const builtRegistry = JSON.parse(await readFile(new URL('../dist/hub/registry.json', import.meta.url), 'utf8'));
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const source = (await readFile(new URL('../dist/hub/app.js', import.meta.url), 'utf8')).replace(/^import .*$/gm, '');
  function mount(initialHash = '') {
    const { document, window: dom } = parseHTML(html);
    const window = new dom.EventTarget();
    window.STRGO = builtRegistry;
    window.localStorage = { getItem:()=>null, setItem:()=>{} };
    window.scrollTo = () => {};
    document.querySelector('#main').focus = () => {};
    const modal = document.querySelector('#modal');
    modal.close = () => { modal.open = false; };
    modal.showModal = () => { modal.open = true; };
    let currentHash = initialHash, redirected = null;
    const location = { pathname: '/', get hash() { return currentHash; },
      set hash(value) { currentHash = value && !value.startsWith('#') ? '#' + value : value; },
      replace(value) { redirected = value; }, assign() {} };
    const context = vm.createContext({ window, document, location, esc, icon, readPreferences, writePreferences,
      filterEntries, allowedAction, startOrbit:()=>()=>{}, art:()=>'', URLSearchParams, AbortController,
      Date, setTimeout, clearTimeout, matchMedia:()=>({matches:false,addEventListener(){}}),
      requestJSON:()=>new Promise(()=>{}) });
    vm.runInContext(source, context);
    return { document, window, dom, location, get redirected() { return redirected; } };
  }

  const page = mount();
  assert.equal(page.redirected, null);
  const panorama = page.document.querySelector('.space-card[data-open="S09"]');
  assert.ok(panorama);
  panorama.dispatchEvent(new page.dom.Event('click', { bubbles:true, cancelable:true }));
  assert.equal(page.location.hash, '#space-panorama');
  page.window.dispatchEvent(new page.dom.Event('hashchange'));
  assert.equal(page.document.querySelector('a.entry-link').getAttribute('href'), '/360/');

  for (const hash of ['home','projects','stack','lab','contact']) {
    assert.equal(mount('#'+hash).redirected, '/classic/#'+hash);
  }
  const alreadyOpen = mount();
  alreadyOpen.location.hash = '#projects';
  alreadyOpen.window.dispatchEvent(new alreadyOpen.dom.Event('hashchange'));
  assert.equal(alreadyOpen.redirected, '/classic/#projects');
});

test('account revalidation clears private UI and discards an old account response', async () => {
  const { document, window: dom } = parseHTML(await readFile(new URL('../src/hub/index.html', import.meta.url), 'utf8'));
  const window = new dom.EventTarget();
  window.STRGO = { ...registry, classicRoute:'/classic/',workflowOrigin:'https://workflow.strgo.com/' };
  window.localStorage = { getItem:()=>null,setItem:()=>{} };
  const modal = document.querySelector('#modal'); modal.close = () => { modal.open = false; }; modal.showModal = () => { modal.open = true; };
  let currentUser = 'owner-one'; const requests = [];
  const source = (await readFile(new URL('../src/hub/app.js', import.meta.url), 'utf8')).replace(/^import .*$/gm, '');
  const context = vm.createContext({ window, document, esc, icon, readPreferences, writePreferences, filterEntries, allowedAction,
    startOrbit:()=>()=>{}, art:()=>'', URLSearchParams, AbortController, Date, setTimeout, clearTimeout,
    location:{pathname:'/hub/',hash:'#tasks'}, matchMedia:()=>({matches:false,addEventListener(){}}),
    requestJSON: async (path) => path.endsWith('/session') ? {user:{id:currentUser,username:currentUser,role:'member'},csrf:'token'} : await new Promise(resolve=>requests.push(resolve)) });
  const tick = async () => { for(let i=0;i<5;i++) await new Promise(resolve=>setImmediate(resolve)); };
  vm.runInContext(source,context); await tick();
  assert.equal(requests.length,1);
  currentUser = 'owner-two'; window.dispatchEvent(new dom.Event('focus')); await tick();
  assert.equal(requests.length,2);
  requests[1]({user_id:'owner-two',items:[],sources:[{id:'image',status:'ok'}],next_cursor:null,partial:false}); await tick();
  requests[0]({user_id:'owner-one',items:[{id:'a'.repeat(32),title:'PRIVATE OLD RECORD',source:'image',status:'complete',status_label:'已完成',actions:[]}],sources:[],next_cursor:null}); await tick();
  assert.equal(document.body.textContent.includes('PRIVATE OLD RECORD'),false);
  assert.match(document.querySelector('#accountStatus').textContent,/owner-two/);
  assert.match(document.querySelector('#collectionResults').textContent,/从一次创作开始/);
});
