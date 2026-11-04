import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { randomUUID, randomFillSync } from 'node:crypto';
import { Marked } from 'marked';

const html = readFileSync(new URL('../src/forum/index.html', import.meta.url), 'utf8');
// Load the actual modules into the existing isolated DOM harness.
const source = ['markdown.js', 'editor.js', 'app.js'].map(file => readFileSync(new URL('../src/forum/' + file, import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '')).join('\n');
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const member = { id: 'member-id', username: 'member', role: 'member' };
const other = { id: 'other-id', username: 'other', role: 'member' };
const fixturePost = (overrides = {}) => ({ id: 'a'.repeat(32), title: '分享一个想法', body: '你好，社区！', category: 'general', pinned: false, author: member, canDelete: true, canEdit: true, revision: 1, commentCount: 0, created: 1792640000, ...overrides });

async function environment({ user = member, posts = [fixturePost()], failure = null, comments = [], notices = [], uuidAvailable = true } = {}) {
  const { window: dom, document } = parseHTML(html);
  const window = new dom.EventTarget();
  const requests = [], timers = new Map();
  const session = { user, csrf: 'test-csrf' };
  let fail = failure, defer = null, nextId = 0, uploadResponse = null;
  const uploads = [];
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
  const sandbox = { window, document, URL, URLSearchParams, TextDecoder, Blob, Marked, btoa: text => Buffer.from(text, 'binary').toString('base64'), Event: dom.Event, Intl, Date, console, crypto: { randomUUID: uuidAvailable ? randomUUID : undefined, getRandomValues: bytes => randomFillSync(bytes) },
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
      if (path === '/forum/attachments') {
        if (uploadResponse) { const callback = uploadResponse; uploadResponse = null; return callback(body); }
        let attachment = uploads.find(file => file.request_id === body.request_id);
        if (!attachment) {
          const id = String(++nextId).padStart(32, '0');
          attachment = { id, ...body, url: '/api/image/forum/attachments/' + id }; uploads.push(attachment);
        }
        return response(attachment, 201);
      }
      if (path.startsWith('/forum/notifications')) {
        if (path.endsWith('/read')) { notices.filter(n => body.ids.includes(n.id)).forEach(n => { n.read = true; }); return response({ ok: true }); }
        return response({ notifications: notices, total: notices.length, unreadCount: notices.filter(n => !n.read).length, hasMore: false });
      }
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
      if (path.includes('/comments')) {
        if (options.method === 'POST') {
          const existing = comments.find(c => c.request_id === body.request_id);
          if (existing) return response(existing);
          const comment = { id: String(++nextId).padStart(32, '0'), post_id: id, body: body.body, request_id: body.request_id, author: member, created: 1792640000, canDelete: true };
          comments.push(comment); post.commentCount++; return response(comment, 201);
        }
        if (options.method === 'DELETE') { comments.splice(comments.findIndex(c => c.id === path.split('/')[5]), 1); return response({ ok: true }); }
        return response({ comments: comments.filter(c => c.post_id === id), total: comments.length, hasMore: false });
      }
      if (options.method === 'PUT' && !path.endsWith('/pin')) { Object.assign(post, body, { revision: post.revision + 1, updated: 1792640100 }); return response(post); }
      if (options.method === 'DELETE') { posts.splice(posts.indexOf(post), 1); return response({ ok: true }); }
      if (path.endsWith('/pin')) { post.pinned = body.pinned; return response(post); }
      return response(post);
    },
  };
  vm.runInNewContext(source, sandbox, { timeout: 5000 }); await tick();
  const click = selector => document.querySelector(selector).dispatchEvent(new dom.Event('click', { bubbles: true }));
  const input = (selector, value) => { const field = document.querySelector(selector); field.value = value; field.dispatchEvent(new dom.Event('input', { bubbles: true })); };
  const submit = selector => document.querySelector(selector).dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }));
  return { document, window, requests, session, posts, comments, notices, click, input, submit, response,
    changeFile(selector, file) {
      const field = document.querySelector(selector);
      Object.defineProperty(field, 'files', { configurable: true, value: [file] });
      field.dispatchEvent(new dom.Event('change', { bubbles: true }));
    },
    deferUpload(callback) { uploadResponse = callback; },
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

test('Author editing loads the full post, preserves conflict input and saves a revision', async () => {
  const env = await environment();
  env.click('.edit-post'); await tick();
  assert.equal(env.document.querySelector('#edit-heading').value, '分享一个想法');
  env.input('#edit-body', '修改后的完整正文');
  env.fail({ status: 409, message: '帖子已在其他页面更新' }); env.submit('#edit-form'); await tick();
  assert.equal(env.document.querySelector('#edit-body').value, '修改后的完整正文');
  assert.equal(env.document.querySelector('#edit-dialog').open, true);
  env.fail(null); env.submit('#edit-form'); env.submit('#edit-form'); await tick();
  assert.equal(env.posts[0].revision, 2);
  assert.equal(env.document.querySelector('#edit-dialog').open, false);
  const request = env.requests.find(r => r.method === 'PUT');
  assert.equal(request.body.revision, 1);
  assert.equal(request.headers['X-CSRF-Token'], 'test-csrf');
});

test('Comment failures retain the draft and retry identity; rapid submit creates one reply', async () => {
  const env = await environment(); env.click('.post-open'); await tick();
  env.input('#comment-body', '<script>一个想法</script>');
  env.fail({ status: 503, message: '连接中断' }); env.submit('#comment-form'); await tick();
  const first = env.requests.find(r => r.path.endsWith('/comments') && r.method === 'POST');
  assert.equal(env.document.querySelector('#comment-body').value, '<script>一个想法</script>');
  env.fail(null); env.submit('#comment-form'); env.submit('#comment-form'); await tick();
  const sent = env.requests.filter(r => r.path.endsWith('/comments') && r.method === 'POST');
  assert.equal(sent.length, 2); assert.equal(sent[1].body.request_id, first.body.request_id);
  assert.equal(env.comments.length, 1);
  assert.equal(env.document.querySelector('#comments-list script'), null);
  assert.equal(env.document.querySelector('.comment-body').textContent, '<script>一个想法</script>');
  assert.equal(env.document.querySelector('#comment-body').value, '');
});

test('Comment deletion is confirmed separately and does not delete the parent post', async () => {
  const comment = { id: 'c'.repeat(32), post_id: 'a'.repeat(32), body: '评论正文', author: member, created: 1792640000, canDelete: true };
  const env = await environment({ comments: [comment] }); env.click('.post-open'); await tick();
  env.click('.delete-comment'); env.click('#delete-cancel');
  assert.equal(env.comments.length, 1);
  env.click('.delete-comment'); env.click('#delete-confirm'); await tick();
  assert.equal(env.comments.length, 0); assert.equal(env.posts.length, 1);
  assert.equal(env.document.querySelector('#detail-dialog').open, true);
});

test('Reply notifications expose unread state, escape text and open the original topic', async () => {
  const notice = { id: 'd'.repeat(32), post_id: 'a'.repeat(32), title: '<img src=x>', username: 'other', body: '新的回复', created: 1792640000, read: false };
  const env = await environment({ notices: [notice] });
  assert.equal(env.document.querySelector('[data-unread]').textContent, '1');
  env.click('[data-notifications]'); await tick();
  assert.equal(env.document.querySelector('#notifications-panel').hidden, false);
  assert.equal(env.document.querySelector('#notifications-list img'), null);
  env.click('.notification-item'); await tick();
  assert.equal(notice.read, true); assert.equal(env.document.querySelector('#detail-dialog').open, true);
  assert.equal(env.document.querySelector('[data-unread]').hidden, true);
});

test('Account changes clear reply drafts, notifications and private edit fields', async () => {
  const env = await environment({ notices: [{ id: 'd'.repeat(32), post_id: 'a'.repeat(32), title: '私有通知', username: 'other', body: '私人回复', created: 1792640000, read: false }] });
  env.click('.post-open'); await tick(); env.input('#comment-body', '不属于下个账号的回复');
  env.click('.edit-post'); await tick(); env.input('#edit-body', '私人修改');
  env.session.user = other; env.focus(); await tick();
  assert.equal(env.document.querySelector('#comment-body').value, '');
  assert.equal(env.document.querySelector('#edit-body').value, '');
  assert.equal(env.document.querySelector('#edit-dialog').open, false);
  assert.equal(env.document.querySelector('#detail-dialog').open, false);
});


test('HTTP previews use secure random bytes when randomUUID is unavailable', async () => {
  const env = await environment({ uuidAvailable: false }); env.click('.post-open'); await tick();
  env.input('#comment-body', '本地预览也可以正常评论'); env.submit('#comment-form'); await tick();
  assert.equal(env.comments.length, 1);
  assert.match(env.comments[0].request_id, /^[a-f0-9]{32}$/);
});

test('Selecting a category returns from notifications to the topic feed', async () => {
  const env = await environment(); env.click('[data-notifications]'); await tick();
  assert.equal(env.document.querySelector('#notifications-panel').hidden, false);
  env.click('[data-category="ai"]'); await tick();
  assert.equal(env.document.querySelector('#notifications-panel').hidden, true);
  assert.equal(env.document.querySelector('.feed-column').hasAttribute('data-notifications'), false);
});

const textFile = (name, text) => {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, lastModified: 123, arrayBuffer: async () => bytes.buffer };
};

test('Markdown renders headings, formatting, tables and code while excluding active content and unsafe URLs', async () => {
  const fence = String.fromCharCode(96).repeat(3);
  const body = '# 文档标题\n\n**强调**与 _斜体_\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n' +
    fence + 'js\n<script>code()</script>\n' + fence + '\n\n<script>alert(1)</script>\n\n' +
    '[bad](javascript:alert%281%29) ![remote](https://tracking.example/a.png)\n\n' +
    '![说明](/api/image/forum/attachments/' + 'b'.repeat(32) + ')';
  const env = await environment({ posts: [fixturePost({ body })] }); env.click('.post-open'); await tick();
  const content = env.document.querySelector('.detail-body');
  assert.equal(content.querySelector('h1').textContent, '文档标题');
  assert.equal(content.querySelector('strong').textContent, '强调');
  assert.equal(content.querySelectorAll('table td').length, 2);
  assert.equal(content.querySelector('pre code').textContent, '<script>code()</script>');
  assert.equal(content.querySelector('script'), null);
  assert.equal(content.querySelector('[href^="javascript:"]'), null);
  assert.equal(content.querySelectorAll('img').length, 1);
  assert.equal(content.querySelector('img').getAttribute('alt'), '说明');
});

test('Markdown toolbar and preview update the current draft without changing its account identity', async () => {
  const env = await environment(); env.click('[data-compose]'); env.input('#post-body', '正文');
  env.click('#compose-dialog [aria-label="粗体"]');
  assert.equal(env.document.querySelector('#post-body').value, '正文**粗体文字**');
  env.click('#compose-dialog [aria-controls="post-body-preview"]');
  assert.equal(env.document.querySelector('#post-body-preview strong').textContent, '粗体文字');
  env.session.user = other; env.focus(); await tick();
  assert.equal(env.document.querySelector('#post-body-preview').textContent, '');
  assert.equal(env.document.querySelector('#post-body-preview').hidden, true);
});

test('Markdown import rejects invalid files without erasing a draft, then imports UTF-8 title and body', async () => {
  const env = await environment(); env.click('[data-compose]'); env.input('#post-body', '保留草稿');
  env.changeFile('#compose-dialog [data-md-import]', textFile('bad.pdf', 'not Markdown')); await tick();
  assert.equal(env.document.querySelector('#post-body').value, '保留草稿');
  env.changeFile('#compose-dialog [data-md-import]', textFile('example.md', '# 导入标题\n\n**你好**')); await tick();
  assert.equal(env.document.querySelector('#post-title').value, '导入标题');
  assert.equal(env.document.querySelector('#post-body').value, '# 导入标题\n\n**你好**');
});

test('Failed uploads retain the draft and reuse the upload identity on retry', async () => {
  const env = await environment(); env.click('[data-compose]'); env.input('#post-body', '保留文字');
  const file = textFile('photo.png', 'fixture');
  env.fail({ status: 503, message: '上传中断' }); env.changeFile('#compose-dialog [data-attachment-input]', file); await tick();
  assert.equal(env.document.querySelector('#post-body').value, '保留文字');
  const first = env.requests.find(request => request.path === '/forum/attachments');
  assert.match(first.body.request_id, /^[a-f0-9]{32}$/);
  env.fail(null); env.changeFile('#compose-dialog [data-attachment-input]', file); await tick();
  const sent = env.requests.filter(request => request.path === '/forum/attachments');
  assert.equal(sent[1].body.request_id, first.body.request_id);
  assert.match(env.document.querySelector('#post-body').value, /保留文字[\s\S]*!\[photo.png\]\(\/api\/image\/forum\/attachments\//);
  assert.equal(env.document.querySelector('#post-body').disabled, false);
});

test('A pending upload blocks publication and cannot repopulate a draft after an account switch', async () => {
  const env = await environment(); env.click('[data-compose]'); env.input('#post-title', '标题'); env.input('#post-body', '草稿');
  let resolveUpload;
  env.deferUpload(() => new Promise(resolve => { resolveUpload = resolve; }));
  env.changeFile('#compose-dialog [data-attachment-input]', textFile('report.pdf', 'fixture')); await tick();
  env.submit('#post-form'); await tick();
  assert.equal(env.requests.some(request => request.path === '/forum/posts' && request.method === 'POST'), false);
  assert.match(env.document.querySelector('#post-message').textContent, /文件处理/);
  env.session.user = other; env.focus(); await tick();
  resolveUpload(env.response({ name: 'report.pdf', url: '/api/image/forum/attachments/' + 'f'.repeat(32) }));
  await tick();
  assert.equal(env.document.querySelector('#post-body').value, '');
  assert.equal(env.document.querySelector('#post-body-preview').textContent, '');
});
