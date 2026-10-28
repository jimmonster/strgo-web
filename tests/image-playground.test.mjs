import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { icons } from '../src/image-playground/icons.js';
import { requestedJob, panoramaPath, panoramaDraft } from '../src/image-playground/hub-links.js';
import { servePreview } from '../scripts/preview.mjs';

const html = readFileSync(new URL('../dist/image-playground/index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/image-playground/app.js', import.meta.url), 'utf8')
  .replace("import { requestedJob, panoramaPath, panoramaDraft } from './hub-links.js';", '')
  .replace("import { icons } from './icons.js';", '')
  .replace("import { compressReferenceImage } from './reference-image.js';", '');
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const presetFixtures = [
  { id: 'd'.repeat(32), title: '自然美颜', description: '保留真实皮肤纹理', prompt: '保持同一人物的身份特征，不要过度改变五官。', sortOrder: 10, created: 1700000000, updated: 1700000000 },
  { id: 'e'.repeat(32), title: '身形与姿态优化', description: '自然微调比例与体态', prompt: '保留真实体型特征，不要让背景线条变形。', sortOrder: 20, created: 1700000000, updated: 1700000000 },
];

async function environment({ search = '', loggedIn = false, role = 'admin', storageReady = true, error = null, initialJobs = [], initialPresets = presetFixtures, presetLoadFailure = false, presetWriteError = null, confirmResult = true, deleteError = null, dailyImageLimit = null, imagesUsed = 0, compress = async () => ({ blob: { type: 'image/webp', size: 600000 }, width: 4096, height: 3072 }) } = {}) {
  const { window: dom, document } = parseHTML(html);
  const window = new dom.EventTarget();
  window.document = document;
  const requests = [], timers = new Map(), writes = [], confirmations = [];
  window.confirm = text => { confirmations.push(text); return confirmResult; };
  let timerId = 0;
  const quota = () => ({ dailyImageLimit, used: imagesUsed, remaining: role === 'admin' || dailyImageLimit == null ? null : Math.max(0, dailyImageLimit - imagesUsed), exempt: role === 'admin', resetsAt: 1790000000, timezone: 'Asia/Shanghai' });
  const session = { user: loggedIn ? { id: 'owner', username: 'creator', role } : null, csrf: loggedIn ? 'csrf-test' : null, storageReady, config: { endpoint: 'https://model.example/v1/images/generations', model: 'configured-model', hasKey: true }, generationQuota: loggedIn ? quota() : null, backup: { last: '', error: '' } };
  const jobs = initialJobs;
  const presets = initialPresets.map(item => ({ ...item }));
  const dialog = document.querySelector('#image-dialog'); dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  document.querySelectorAll('select').forEach(select => Object.defineProperty(select, 'value', { configurable: true, writable: true, value: select.querySelector('option').value }));
  document.querySelectorAll('form').forEach(form => { form.reset = () => { form.querySelectorAll('input').forEach(input => { input.value = ''; }); }; });
  document.querySelector('#old-password').value = '';
  const location = { hash: '', search, pathname: '/image-playground/' };
  class TestFileReader {
    readAsDataURL(file) { this.result = `data:${file.type};base64,UE5HLXRlc3Q=`; this.onload(); }
  }
  const sandbox = {
    window, document, icons, requestedJob, panoramaPath, panoramaDraft, URLSearchParams, AbortController, Event: dom.Event, FileReader: TestFileReader, crypto: { randomUUID }, location, compressReferenceImage: compress,
    history: { replaceState(_, __, hash) { location.hash = hash; } },
    navigator: { clipboard: { async writeText(value) { writes.push(value); } } },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); },
    fetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url, ...options, parsed: body });
      if (error) throw Object.assign(new Error('network failure'), { name: 'TypeError' });
      const path = url.replace('/api/image', '');
      let result;
      if (path === '/session') result = session;
      else if (path === '/register' || path === '/login') { session.user = { id: 'owner', username: body.username, role: 'admin' }; session.csrf = 'csrf-test'; result = { user: session.user, csrf: session.csrf }; }
      else if (path === '/logout') { session.user = null; session.csrf = ''; result = { ok: true }; }
      else if (path === '/config') { session.config = { endpoint: body.endpoint, model: body.model, hasKey: true }; result = session.config; }
      else if (path === '/password') result = { csrf: 'changed-csrf' };
      else if (path === '/generation-quota') result = quota();
      else if (path === '/generation-policy') { dailyImageLimit = body.dailyImageLimit; result = quota(); }
      else if (path.startsWith('/preset-inspirations')) {
        if (presetLoadFailure && options.method === 'GET') return { ok: false, status: 503, json: async () => ({ error: '预装灵感服务不可用。' }) };
        if (presetWriteError && options.method !== 'GET') return { ok: false, status: 409, json: async () => ({ error: presetWriteError }) };
        if (options.method === 'GET') result = { presets: [...presets] };
        else if (options.method === 'POST') {
          result = { id: 'f'.repeat(32), created: 1700000001, updated: 1700000001, ...body }; presets.push(result);
        } else if (options.method === 'PUT') {
          const index = presets.findIndex(item => path.endsWith('/' + item.id));
          result = { ...presets[index], ...body, updated: presets[index].updated + 1 }; presets[index] = result;
        } else if (options.method === 'DELETE') {
          const index = presets.findIndex(item => path.endsWith('/' + item.id)); presets.splice(index, 1); result = { ok: true };
        }
      }
      else if (/^\/images\/[a-f0-9]{32}$/.test(path) && options.method === 'DELETE') {
        if (deleteError) return { ok: false, status: 503, json: async () => ({ error: deleteError }) };
        const id = path.split('/').pop();
        for (let index = jobs.length - 1; index >= 0; index--) {
          jobs[index].images = jobs[index].images.filter(image => image.id !== id);
          if (!jobs[index].images.length) jobs.splice(index, 1);
        }
        result = { deleted: true, cleanupPending: false };
      }
      else if (path === '/jobs' && options.method === 'POST') {
        imagesUsed += body.count;
        const job = { id: 'a'.repeat(32), userId: session.user.id, username: session.user.username, prompt: body.prompt, model: session.config.model, size: body.size, count: body.count, quality: body.quality, hasReference: Boolean(body.referenceImage), status: 'queued', error: '', created: 1700000000, images: [], generationQuota: quota() };
        jobs.unshift(job); result = job;
      } else if (path === '/jobs' || path.startsWith('/jobs?')) result = { jobs, hasMore: false };
      else if (/^\/jobs\/[a-f0-9]{32}$/.test(path)) result = jobs.find(job => job.id === path.split('/').pop());
      else if (path === '/inspirations' && options.method === 'POST') result = { id: 'c'.repeat(32), created: 1700000000, ...body };
      else if (path.startsWith('/inspirations?')) result = { inspirations: [], hasMore: false };
      else if (path === '/invites') result = { code: 'TEST-ONLY-INVITE' };
      else if (path === '/backup') result = { last: 1700000000 };
      else result = { ok: true };
      return { ok: true, status: 200, json: async () => result };
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { timeout: 5000 });
  await tick();
  return { document, requests, jobs, presets, session, timers, writes, confirmations,
    click(selector) { document.querySelector(selector).dispatchEvent(new dom.Event('click', { bubbles: true })); },
    submit(selector) { const form = document.querySelector(selector); const event = new dom.Event('submit', { bubbles: true, cancelable: true }); event.submitter = form.querySelector('button[type=submit]'); form.dispatchEvent(event); },
    input(selector, value) { const input = document.querySelector(selector); input.value = value; input.dispatchEvent(new dom.Event('input', { bubbles: true })); },
    change(selector) { document.querySelector(selector).dispatchEvent(new dom.Event('change', { bubbles: true })); },
    close() { window.dispatchEvent(new dom.Event('pagehide')); },
  };
}

test('Private route builds independently, hides authenticated controls and exposes no provider secrets', async () => {
  assert.ok(html.includes('noindex,nofollow'));
  assert.ok(html.includes('https://strgo.com/image-playground/'));
  assert.ok(!html.includes('{{'));
  const result = {};
  await servePreview({ url: '/image-playground?from=home', method: 'GET' }, { writeHead(status, headers) { Object.assign(result, { status, headers }); }, end() {} });
  assert.equal(result.status, 308); assert.equal(result.headers.Location, '/image-playground/?from=home');
  const home = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.equal((home.match(/href="\/image-playground\/"/g) || []).length, 3);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  const env = await environment();
  assert.equal(env.document.querySelector('#workspace').hidden, true);
  assert.equal(env.document.querySelector('#auth-view').hidden, false);
  env.close();
});

test('Invitation registration submits credentials once and unlocks the workspace', async () => {
  const env = await environment();
  env.click('[data-auth=register]');
  assert.equal(env.document.querySelector('#invite-label').hidden, false);
  assert.equal(env.document.querySelector('#invite').required, true);
  env.input('#username', 'creator'); env.input('#password', 'private-password-12345'); env.input('#invite', 'TEST-INVITE');
  env.submit('#auth-form'); await tick();
  const request = env.requests.find(request => request.url.endsWith('/register'));
  assert.equal(request.parsed.invite, 'TEST-INVITE');
  assert.equal(request.credentials, 'same-origin');
  assert.equal(env.document.querySelector('#workspace').hidden, false);
  assert.equal(env.document.querySelector('#auth-view').hidden, true);
  assert.equal(env.document.querySelector('#password').value, '');
  assert.equal(env.document.querySelector('#invite').value, '');
  assert.equal(env.document.querySelector('#admin-section').hidden, false);
  env.close();
});

test('Generation submits selected parameters with csrf, then shows durable queued state', async () => {
  const env = await environment({ loggedIn: true, role: 'member' });
  env.input('#prompt', 'A quiet mountain lake'); env.click('[data-size="1536x1024"]');
  env.submit('#generation-form'); await tick();
  const request = env.requests.find(request => request.url === '/api/image/jobs' && request.method === 'POST');
  assert.equal(request.parsed.prompt, 'A quiet mountain lake');
  assert.equal(request.parsed.size, '1536x1024'); assert.equal(request.parsed.count, 1);
  assert.equal(request.headers['X-CSRF-Token'], 'csrf-test');
  assert.equal(typeof request.parsed.requestId, 'string');
  assert.ok(env.document.querySelector('#current-output').textContent.includes('等待生成'));
  assert.match(env.document.querySelector('#quota-status').textContent, /每日额度不限/);
  env.close();
});

test('Admins manage per-member image quotas while members see remaining images and cannot manage policy', async () => {
  const admin = await environment({ loggedIn: true });
  assert.equal(admin.document.querySelector('#quota-admin-section').hidden, false);
  admin.click('[data-view=settings]'); await tick();
  assert.equal(admin.document.querySelector('#quota-mode').value, 'unlimited');
  admin.input('#quota-mode', 'limited'); admin.change('#quota-mode');
  assert.equal(admin.document.querySelector('#daily-limit-label').hidden, false);
  admin.input('#daily-image-limit', '12'); admin.submit('#quota-form'); await tick();
  const policy = admin.requests.find(request => request.url === '/api/image/generation-policy' && request.method === 'PUT');
  assert.equal(policy.parsed.dailyImageLimit, 12);
  assert.match(admin.document.querySelector('#quota-message').textContent, /已保存/);
  admin.close();

  const member = await environment({ loggedIn: true, role: 'member', dailyImageLimit: 3, imagesUsed: 2 });
  assert.equal(member.document.querySelector('#quota-admin-section').hidden, true);
  assert.equal(member.document.querySelector('#library-scope').hidden, true);
  assert.equal(member.document.querySelector('#daily-image-limit').disabled, true);
  assert.match(member.document.querySelector('#quota-status').textContent, /剩余 1 张/);
  member.input('#prompt', 'one remaining image'); member.input('#count', '2'); member.change('#count');
  assert.equal(member.document.querySelector('#generate').disabled, true);
  member.input('#count', '1'); member.change('#count');
  assert.equal(member.document.querySelector('#generate').disabled, false);
  member.submit('#generation-form'); await tick();
  const generated = member.requests.find(request => request.url === '/api/image/jobs' && request.method === 'POST');
  assert.equal(generated.parsed.count, 1);
  assert.match(member.document.querySelector('#quota-status').textContent, /0 张/);
  assert.equal(member.requests.some(request => request.method === 'PUT' && request.url.endsWith('/generation-policy')), false);
  member.close();
});

test('Custom dimensions and a selected reference image are submitted with generation', async () => {
  const env = await environment({ loggedIn: true });
  env.input('#prompt', 'A ceramic bird in morning light');
  env.click('[data-size="custom"]'); env.input('#size-width', '2048'); env.input('#size-height', '768');
  const fileInput = env.document.querySelector('#reference-image');
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ type: 'image/png', size: 1024, name: 'reference.png' }] });
  env.change('#reference-image'); await tick();
  env.submit('#generation-form'); await tick();
  const request = env.requests.find(item => item.url === '/api/image/jobs' && item.method === 'POST');
  assert.equal(request.parsed.size, '2048x768');
  assert.equal(request.parsed.referenceImage.mime, 'image/webp');
  assert.equal(request.parsed.referenceImage.data, 'UE5HLXRlc3Q=');
  assert.ok(env.document.querySelector('#current-output').textContent.includes('使用了参考图'));
  env.close();
});

test('Large source files wait for local compression and send only its encoded output', async () => {
  let finish, receivedFile, receivedSignal;
  const pending = new Promise(resolve => { finish = resolve; });
  const env = await environment({ loggedIn: true, compress: (file, signal) => { receivedFile = file; receivedSignal = signal; return pending; } });
  const file = { name: 'large-source.tiff', type: 'image/tiff', size: 80_000_000 };
  Object.defineProperty(env.document.querySelector('#reference-image'), 'files', { configurable: true, value: [file] });
  assert.equal(env.document.querySelector('#reference-image').getAttribute('accept'), 'image/*');
  env.change('#reference-image'); await tick();
  assert.equal(receivedFile, file);
  assert.equal(env.document.querySelector('#generate').disabled, true);
  env.submit('#generation-form'); await tick();
  assert.equal(env.requests.some(item => item.url === '/api/image/jobs' && item.method === 'POST'), false);
  finish({ blob: { type: 'image/webp', size: 1_800_000 }, width: 4096, height: 3072 }); await tick();
  assert.equal(receivedSignal.aborted, false);
  assert.match(env.document.querySelector('#reference-status').textContent, /80.00 MB → 1.80 MB/);
  assert.match(env.document.querySelector('#reference-status').textContent, /4096 × 3072/);
  assert.equal(env.document.querySelector('#generate').disabled, false);
  env.input('#prompt', 'Use this reference'); env.submit('#generation-form'); await tick();
  const request = env.requests.find(item => item.url === '/api/image/jobs' && item.method === 'POST');
  assert.equal(request.parsed.referenceImage.mime, 'image/webp');
  assert.equal(request.parsed.referenceImage.data, 'UE5HLXRlc3Q=');
  env.close();
});

test('Replacing and removing a pending reference cannot restore an older photo', async () => {
  const tasks = [];
  const env = await environment({ loggedIn: true, compress: (file, signal) => new Promise(resolve => tasks.push({ file, signal, resolve })) });
  const input = env.document.querySelector('#reference-image');
  for (const name of ['first.png', 'second.png']) {
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name, size: 5_000_000, type: 'image/png' }] });
    env.change('#reference-image'); await tick();
  }
  assert.equal(tasks[0].signal.aborted, true);
  tasks[0].resolve({ blob: { type: 'image/webp', size: 1000 }, width: 100, height: 100 }); await tick();
  assert.equal(env.document.querySelector('#reference-name').textContent, 'second.png');
  assert.equal(env.document.querySelector('#generate').disabled, true);
  env.click('#remove-reference');
  assert.equal(tasks[1].signal.aborted, true);
  tasks[1].resolve({ blob: { type: 'image/webp', size: 1000 }, width: 100, height: 100 }); await tick();
  assert.equal(env.document.querySelector('#reference-preview').hidden, true);
  assert.equal(env.document.querySelector('#reference-thumbnail').hasAttribute('src'), false);
  assert.equal(env.document.querySelector('#generate').disabled, false);
  env.close();
});

test('Decode failure stays visible and blocks submission until the reference is removed', async () => {
  const env = await environment({ loggedIn: true, compress: async () => { throw new Error('浏览器无法解码这张参考图。'); } });
  const input = env.document.querySelector('#reference-image');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'photo.heic', size: 8_000_000, type: 'image/heic' }] });
  env.change('#reference-image'); await tick();
  assert.match(env.document.querySelector('#reference-status').textContent, /无法解码/);
  env.submit('#generation-form'); await tick();
  assert.equal(env.requests.some(item => item.url === '/api/image/jobs' && item.method === 'POST'), false);
  assert.equal(env.document.querySelector('#generate').disabled, true);
  env.click('#remove-reference');
  assert.equal(env.document.querySelector('#generate').disabled, false);
  env.close();
});

test('Prompt inspirations save to the account API and remain available in a separate view', async () => {
  const env = await environment({ loggedIn: true });
  env.input('#prompt', 'A quiet greenhouse after the rain'); env.click('[data-size="custom"]');
  env.input('#size-width', '2048'); env.input('#size-height', '768'); env.click('#save-inspiration'); await tick();
  const request = env.requests.find(item => item.url === '/api/image/inspirations' && item.method === 'POST');
  assert.equal(request.parsed.prompt, 'A quiet greenhouse after the rain');
  assert.equal(request.parsed.size, '2048x768');
  assert.equal(request.headers['X-CSRF-Token'], 'csrf-test');
  env.click('[data-view=inspirations]'); await tick();
  assert.ok(env.requests.some(item => item.url === '/api/image/inspirations?offset=0'));
  env.close();
});

test('Presets load from the server after login and can be applied or searched', async () => {
  const anonymous = await environment();
  assert.equal(anonymous.requests.some(request => request.url.endsWith('/preset-inspirations')), false);
  assert.equal(anonymous.document.querySelectorAll('.preset-card').length, 0);
  anonymous.close();
  const env = await environment({ loggedIn: true });
  const presets = env.document.querySelectorAll('.preset-card');
  assert.equal(presets.length, 2);
  assert.ok([...presets].some(item => item.textContent.includes('身形与姿态优化')));
  env.click('.preset-card');
  assert.match(env.document.querySelector('#prompt').value, /保持同一人物的身份特征/);
  assert.match(env.document.querySelector('#prompt').value, /不要过度改变五官/);
  env.click('[data-view=inspirations]'); await tick();
  env.input('#preset-search', '背景线条');
  assert.equal(env.document.querySelectorAll('.shared-preset').length, 1);
  assert.match(env.document.querySelector('.shared-preset').textContent, /身形与姿态优化/);
  env.input('#preset-search', 'no matches');
  assert.match(env.document.querySelector('#shared-preset-list').textContent, /没有匹配/);
  env.close();
});

test('Admins create and edit shared presets and immediately update the composer', async () => {
  const env = await environment({ loggedIn: true });
  env.click('[data-view=inspirations]'); await tick();
  assert.equal(env.document.querySelector('#new-preset').hidden, false);
  env.click('#new-preset');
  env.input('#preset-title', '新的预装灵感'); env.input('#preset-description', '新的简介');
  env.input('#preset-prompt', '保持原来的构图和光线。'); env.input('#preset-sort', '5');
  env.submit('#preset-editor'); await tick();
  const created = env.requests.find(request => request.url === '/api/image/preset-inspirations' && request.method === 'POST');
  assert.equal(created.headers['X-CSRF-Token'], 'csrf-test');
  assert.equal(created.parsed.sortOrder, 5);
  assert.equal(env.document.querySelector('#preset-editor').hidden, true);
  assert.equal(env.document.querySelectorAll('.preset-card').length, 3);
  assert.equal(env.document.querySelector('.preset-card strong').textContent, '新的预装灵感');
  env.click('[data-preset-id="' + 'f'.repeat(32) + '"] .edit-preset');
  assert.equal(env.document.querySelector('#preset-prompt').value, '保持原来的构图和光线。');
  env.input('#preset-title', '<img src=x onerror=alert(1)>'); env.input('#preset-prompt', '这是修改后的提示词。');
  env.submit('#preset-editor'); await tick();
  const updated = env.requests.find(request => request.method === 'PUT' && request.url.includes('/preset-inspirations/'));
  assert.equal(updated.parsed.updated, 1700000001);
  assert.equal(updated.parsed.prompt, '这是修改后的提示词。');
  assert.equal(env.document.querySelectorAll('img[onerror]').length, 0);
  assert.equal(env.document.querySelector('.preset-card strong').textContent, '<img src=x onerror=alert(1)>');
  env.click('.preset-card');
  assert.equal(env.document.querySelector('#prompt').value, '这是修改后的提示词。');
  env.close();
});

test('Admins can delete every preset without a hardcoded fallback; cancellation preserves it', async () => {
  const cancelled = await environment({ loggedIn: true, confirmResult: false });
  cancelled.click('.delete-preset'); await tick();
  assert.equal(cancelled.requests.some(request => request.method === 'DELETE'), false);
  cancelled.close();
  const env = await environment({ loggedIn: true });
  for (let index = 0; index < 2; index++) { env.click('.delete-preset'); await tick(); }
  assert.equal(env.document.querySelectorAll('.preset-card').length, 0);
  assert.match(env.document.querySelector('#preset-summary').textContent, /0 个/);
  assert.match(env.document.querySelector('#shared-preset-list').textContent, /暂无预装灵感/);
  assert.equal(env.requests.filter(request => request.method === 'DELETE').length, 2);
  assert.match(env.confirmations[0], /个人灵感不受影响/);
  env.close();
});

test('Member accounts can read presets but cannot reveal or submit admin controls', async () => {
  const env = await environment({ loggedIn: true, role: 'member' });
  assert.equal(env.document.querySelectorAll('.preset-card').length, 2);
  assert.equal(env.document.querySelector('#new-preset').hidden, true);
  assert.equal(env.document.querySelectorAll('.edit-preset,.delete-preset').length, 0);
  env.click('#new-preset'); env.submit('#preset-editor'); await tick();
  assert.equal(env.document.querySelector('#preset-editor').hidden, true);
  assert.equal(env.requests.some(request => request.method !== 'GET' && request.url.includes('/preset-inspirations')), false);
  env.close();
});

test('Preset errors keep drafts, and logout removes shared data and editor contents', async () => {
  const env = await environment({ loggedIn: true, presetWriteError: '这条灵感已被更新，请刷新后重新编辑。' });
  env.click('.edit-preset'); env.input('#preset-prompt', '尚未保存的修改');
  env.submit('#preset-editor'); await tick();
  assert.equal(env.document.querySelector('#preset-editor').hidden, false);
  assert.equal(env.document.querySelector('#preset-prompt').value, '尚未保存的修改');
  assert.match(env.document.querySelector('#preset-editor-message').textContent, /已被更新/);
  assert.equal(env.document.querySelector('#preset-save').disabled, false);
  env.click('#logout'); await tick();
  assert.equal(env.document.querySelector('#preset-prompt').value, '');
  assert.equal(env.document.querySelectorAll('.preset-card,.shared-preset').length, 0);
  env.close();
  const unavailable = await environment({ loggedIn: true, presetLoadFailure: true });
  assert.equal(unavailable.document.querySelectorAll('.preset-card').length, 0);
  assert.match(unavailable.document.querySelector('#preset-load-message').textContent, /加载失败/);
  unavailable.close();
});

test('An administrator can cancel an unsaved preset without a write', async () => {
  const env = await environment({ loggedIn: true });
  env.click('#new-preset'); env.input('#preset-title', '草稿'); env.click('#preset-cancel');
  assert.equal(env.document.querySelector('#preset-editor').hidden, true);
  assert.equal(env.document.querySelector('#preset-title').value, '');
  assert.equal(env.requests.some(request => request.method !== 'GET' && request.url.includes('/preset-inspirations')), false);
  env.close();
});

test('Saved images use authenticated paths, prompt content stays text, and library is searchable', async () => {
  const prompt = '<img src=x onerror="alert(1)">山川';
  const job = { id: 'a'.repeat(32), prompt, model: 'model', size: '1024x1024', quality: '', count: 1, created: 1700000000, status: 'complete', error: '', images: [{ id: 'b'.repeat(32), state: 'saved', favorite: false, error: '', url: '/api/image/assets/' + 'b'.repeat(32), downloadUrl: '/api/image/assets/' + 'b'.repeat(32) + '?download=1' }] };
  const env = await environment({ loggedIn: true, initialJobs: [job] });
  assert.equal(env.document.querySelectorAll('img[onerror]').length, 0);
  assert.equal(env.document.querySelector('.job-prompt').textContent, prompt);
  env.click('.image-open'); assert.equal(env.document.querySelector('#image-dialog').open, true);
  assert.equal(env.document.querySelector('#panorama-image').getAttribute('href'), panoramaPath(job.images[0].id));
  assert.equal(env.document.querySelector('#preview-prompt').textContent, prompt);
  assert.equal(env.document.querySelector('#download-image').getAttribute('href'), job.images[0].downloadUrl);
  env.click('#reuse-prompt'); assert.equal(env.document.querySelector('#prompt').value, prompt);
  env.click('[data-view=library]'); await tick();
  assert.ok(env.requests.some(request => request.url.includes('/jobs?offset=0&search=&favorite=false')));
  env.close();
});

function savedJob(imageCount = 1) {
  return { id: 'a'.repeat(32), userId: 'owner', username: 'creator', prompt: 'Saved photo', model: 'model', size: '1024x1024', quality: '', count: imageCount, created: 1700000000, status: 'complete', error: '', images: Array.from({ length: imageCount }, (_, index) => {
    const id = (index ? 'c' : 'b').repeat(32);
    return { id, state: 'saved', favorite: false, error: '', url: '/api/image/assets/' + id, downloadUrl: '/api/image/assets/' + id + '?download=1' };
  }) };
}

test('Deleting the last image confirms, sends csrf, closes its preview and clears both views', async () => {
  const env = await environment({ loggedIn: true, initialJobs: [savedJob()] });
  env.click('.image-open');
  env.click('[data-view=library]'); await tick();
  env.click('#library-list .delete-image'); await tick();
  const request = env.requests.find(request => request.method === 'DELETE');
  assert.equal(request.url, '/api/image/images/' + 'b'.repeat(32));
  assert.equal(request.headers['X-CSRF-Token'], 'csrf-test');
  assert.equal(request.credentials, 'same-origin');
  assert.match(env.confirmations[0], /无法撤销/);
  assert.equal(env.document.querySelector('#image-dialog').open, false);
  assert.equal(env.document.querySelector('#preview-image').hasAttribute('src'), false);
  assert.equal(env.document.querySelectorAll('.image-card').length, 0);
  assert.ok(env.document.querySelector('#library-list .empty-state'));
  assert.match(env.document.querySelector('#toast').textContent, /作品已删除/);
  env.close();
});

test('Deleting one image keeps the other image and the existing search', async () => {
  const env = await environment({ loggedIn: true, initialJobs: [savedJob(2)] });
  env.click('[data-view=library]'); await tick();
  env.input('#search', 'Saved');
  env.click('#library-list .delete-image'); await tick();
  assert.equal(env.document.querySelectorAll('#library-list .image-card').length, 1);
  assert.equal(env.document.querySelector('#library-list .delete-image').dataset.imageId, 'c'.repeat(32));
  assert.equal(env.document.querySelectorAll('#current-output .image-card').length, 1);
  assert.equal(env.document.querySelector('#search').value, 'Saved');
  assert.ok(env.requests.some(request => request.url.includes('search=Saved')));
  env.close();
});

test('Admins can browse and delete another member’s image, while members receive only owner controls', async () => {
  const shared = savedJob(); shared.userId = 'member-account'; shared.username = 'another_member';
  const admin = await environment({ loggedIn: true, initialJobs: [shared] });
  admin.click('[data-view=library]'); await tick();
  assert.equal(admin.document.querySelector('#library-scope').hidden, false);
  admin.input('#library-scope', 'all'); admin.change('#library-scope'); await tick();
  assert.ok(admin.requests.some(request => request.url.includes('scope=all')));
  assert.match(admin.document.querySelector('.job-owner').textContent, /another_member/);
  assert.equal(admin.document.querySelectorAll('#library-list .delete-image').length, 1);
  admin.click('#library-list .delete-image'); await tick();
  assert.equal(admin.requests.some(request => request.method === 'DELETE'), true);
  admin.close();

  const memberJob = savedJob(); memberJob.userId = 'someone-else'; memberJob.username = 'another_member';
  const member = await environment({ loggedIn: true, role: 'member', initialJobs: [memberJob] });
  assert.equal(member.document.querySelectorAll('.delete-image,.retry').length, 0);
  member.close();
});

test('Canceling deletion sends no request; API failures preserve the image and allow retry', async () => {
  const cancelled = await environment({ loggedIn: true, initialJobs: [savedJob()], confirmResult: false });
  cancelled.click('.delete-image'); await tick();
  assert.equal(cancelled.requests.filter(request => request.method === 'DELETE').length, 0);
  assert.equal(cancelled.document.querySelectorAll('.image-card').length, 1);
  cancelled.close();
  const failed = await environment({ loggedIn: true, initialJobs: [savedJob()], deleteError: '暂时无法删除，请重试。' });
  failed.click('.delete-image'); await tick();
  assert.equal(failed.document.querySelectorAll('.image-card').length, 1);
  assert.equal(failed.document.querySelector('.delete-image').disabled, false);
  assert.match(failed.document.querySelector('#toast').textContent, /暂时无法删除/);
  failed.close();
});

test('Server storage must be writable before generation can be submitted', async () => {
  const env = await environment({ loggedIn: true, storageReady: false });
  assert.equal(env.document.querySelector('#generate').disabled, true);
  assert.ok(env.document.querySelector('#generation-message').textContent.includes('服务器存储尚未就绪'));
  env.close();
});

test('Configuration keys clear after saving and logout clears invitation and image data', async () => {
  const env = await environment({ loggedIn: true });
  env.input('#api-key', 'new-private-provider-key'); env.submit('#settings-form'); await tick();
  assert.equal(env.document.querySelector('#api-key').value, '');
  env.click('#create-invite'); await tick();
  assert.equal(env.document.querySelector('#invite-code').textContent, 'TEST-ONLY-INVITE');
  env.click('#logout'); await tick();
  assert.equal(env.document.querySelector('#invite-code').textContent, '');
  assert.equal(env.document.querySelector('#current-output').children.length, 0);
  assert.equal(env.document.querySelector('#workspace').hidden, true);
  env.close();
});

test('An unavailable API produces an explicit error and keeps the private workspace locked', async () => {
  const env = await environment({ error: true });
  assert.equal(env.document.querySelector('#workspace').hidden, true);
  assert.match(env.document.querySelector('#auth-message').textContent, /无法连接服务器/);
  assert.equal(env.document.querySelector('#auth-submit').disabled, false);
  env.close();
});


test('Portal image deep links reopen the requested job and reuse parameters without generating', async () => {
  const id = 'b'.repeat(32);
  const job = { id, userId:'owner', username:'creator', prompt:'Old lake prompt', size:'1024x1536', quality:'high', count:2, model:'configured-model', status:'complete', created:1700000000, error:'', images:[], hasReference:true };
  const env = await environment({ loggedIn:true, search:'?reuse=' + id + '&panorama=1', initialJobs:[job] });
  assert.equal(env.document.querySelector('#prompt').value, job.prompt);
  assert.equal(env.document.querySelector('#count').value, '2');
  assert.equal(env.document.querySelector('#quality').value, 'high');
  assert.ok(env.requests.some(r => r.url === '/api/image/jobs/' + id && r.method === 'GET'));
  assert.equal(env.requests.filter(r => r.method === 'POST' && r.url === '/api/image/jobs').length, 0);
  env.close();
});

test('Panorama creation link prefills a 2:1 draft and waits for explicit generation', async () => {
  const env = await environment({ loggedIn:true, search:'?panorama=1' });
  assert.equal(env.document.querySelector('#size-width').value,'2048');
  assert.equal(env.document.querySelector('#size-height').value,'1024');
  assert.match(env.document.querySelector('#prompt').value,/等距柱状投影/);
  assert.equal(env.document.querySelector('#custom-size-controls').hidden,false);
  assert.equal(env.requests.some(r=>r.method==='POST' && r.url==='/api/image/jobs'),false);
  env.close();
});
