const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const API = '/api/image';
const POSTS = '/forum/posts';
const categories = { general: '日常闲聊', ai: 'AI 创作', terminal: '终端交流', help: '问题反馈' };
const state = { user: null, csrf: '', auth: 'login', scope: 'all', category: '', search: '', posts: [], total: 0, hasMore: false, epoch: 0, load: 0, detail: 0, current: null, deleting: null, publishing: false, checking: false, ready: false };
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  message: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M7 10h9M7 14h5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7-2v4m-2-2h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  logout: '<path d="M9 4H4v16h5m5-12 4 4-4 4m-5-4h12"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  pin: '<path d="m9 3 9 3-3 5 2 5-6-2-4 2 1-6-2-3 3-4Zm2 11-6 7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'icon');
  svg.innerHTML = paths[name] || paths.message;
  return svg;
}
$$('[data-icon]').forEach(element => {
  const svg = icon(element.dataset.icon);
  if (element.className) element.replaceChildren(svg);
  else element.replaceWith(svg);
});

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function message(selector, text = '', error = false) {
  const element = $(selector); element.textContent = text; element.classList.toggle('error', error);
}
let toastTimer;
function toast(text) {
  clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(API + path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf } : {}) },
    ...(method !== 'GET' ? { body: JSON.stringify(body || {}) } : {}),
  });
  const data = await response.json().catch(() => ({ error: '服务响应异常，请稍后重试。' }));
  if (!response.ok) {
    if (response.status === 401 && state.user && !['/login', '/register'].includes(path)) {
      lock('登录已过期，请重新登录。');
    }
    throw new Error(data.error || '操作失败，请稍后重试。');
  }
  return data;
}
function closeDialogs() { $$('dialog[open]').forEach(dialog => dialog.close()); }
function clearAccount() {
  state.epoch++; state.load++; state.detail++;
  state.user = null; state.csrf = ''; state.posts = []; state.current = null; state.deleting = null;
  state.scope = 'all'; state.category = ''; state.search = ''; state.hasMore = false; state.total = 0;
  closeDialogs(); $('#post-form').reset(); updateCounters(); $('#detail-content').replaceChildren(); $('#posts').replaceChildren();
  $('#header-name').textContent = ''; $('#side-name').textContent = ''; $('#search').value = '';
  $('#auth-form').reset(); $('#toast').hidden = true;
  message('#post-message'); message('#feed-message'); message('#detail-message');
}
function lock(reason = '') {
  clearAccount();
  $('#workspace').hidden = true; $('#mobile-bottom').hidden = true; $('#account-button').hidden = true;
  $('#auth-view').hidden = false; $('#auth-submit').disabled = false;
  message('#auth-message', reason, Boolean(reason));
}
function syncFilters() {
  $$('[data-scope]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scope === state.scope)));
  $$('[data-category]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === state.category)));
  $('#feed-heading').textContent = state.scope === 'mine' ? '我的帖子' : categories[state.category] || '社区广场';
}
async function unlock(info) {
  if (state.user?.id !== info.user.id) clearAccount();
  state.user = info.user; state.csrf = info.csrf;
  $('#auth-view').hidden = true; $('#workspace').hidden = false; $('#mobile-bottom').hidden = false; $('#account-button').hidden = false;
  $('#header-name').textContent = info.user.username; $('#side-name').textContent = info.user.username;
  $('#side-role').textContent = info.user.role === 'admin' ? '社区管理员' : '社区会员';
  $('#admin-note').hidden = info.user.role !== 'admin';
  for (const selector of ['#header-avatar', '#side-avatar', '#compose-avatar']) $(selector).textContent = info.user.username.slice(0, 1).toUpperCase();
  syncFilters(); await loadPosts();
}
async function checkSession() {
  if (state.checking || state.publishing) return;
  state.checking = true;
  try {
    const epoch = state.epoch;
    const info = await api('/session');
    if (epoch !== state.epoch) return;
    if (info.user) {
      if (!state.user || state.user.id !== info.user.id || state.user.role !== info.user.role) await unlock(info);
      else state.csrf = info.csrf;
    } else if (state.user || !state.ready) lock(state.user ? '账号已退出，请重新登录。' : '');
    state.ready = true;
  } catch (error) { message(state.user ? '#feed-message' : '#auth-message', error.message, true); }
  finally { state.checking = false; $('#auth-submit').disabled = false; }
}

function formatTime(timestamp) {
  const elapsed = Math.max(0, Date.now() / 1000 - timestamp);
  if (elapsed < 60) return '刚刚';
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)} 分钟前`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)} 小时前`;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', ...(elapsed > 31536000 ? { year: 'numeric' } : {}) }).format(timestamp * 1000);
}
function postMeta(post) {
  const meta = node('div', 'post-meta');
  const avatar = node('span', 'avatar', post.author.username.slice(0, 1).toUpperCase());
  const info = node('div'); const author = node('div', 'post-author');
  author.append(node('span', 'author-name', post.author.username));
  if (post.author.role === 'admin') author.append(node('span', 'role-badge', '管理员'));
  if (post.author.id === state.user.id) author.append(node('span', 'role-badge', '我'));
  const time = node('time', 'post-time', formatTime(post.created));
  time.dateTime = new Date(post.created * 1000).toISOString();
  time.title = new Date(post.created * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  info.append(author, time); meta.append(avatar, info, node('span', 'post-category category-' + post.category, categories[post.category] || '日常闲聊'));
  return meta;
}
function pinBadge() { const badge = node('span', 'pin-badge'); badge.append(icon('pin'), document.createTextNode('置顶')); return badge; }
function action(label, symbol, className, handler) {
  const button = node('button', className); button.type = 'button'; button.append(icon(symbol), document.createTextNode(label)); button.addEventListener('click', handler); return button;
}
function postActions(post, detail = false) {
  const actions = node('div', 'post-actions');
  if (state.user.role === 'admin') {
    const pin = action(post.pinned ? '取消置顶' : '置顶', 'pin', 'pin-post', async () => {
      pin.disabled = true; const epoch = state.epoch;
      try {
        const updated = await api(`${POSTS}/${post.id}/pin`, { method: 'PUT', body: { pinned: !post.pinned } });
        if (epoch !== state.epoch) return;
        if (state.current?.id === post.id) renderDetail(updated);
        await loadPosts(); toast(updated.pinned ? '帖子已置顶' : '已取消置顶');
      } catch (error) { if (epoch === state.epoch) message(detail ? '#detail-message' : '#feed-message', error.message, true); }
      finally { pin.disabled = false; }
    });
    actions.append(pin);
  }
  if (post.canDelete) actions.append(action('删除', 'trash', 'delete-post', () => {
    state.deleting = post; message('#delete-message');
    $('#delete-description').textContent = `“${post.title}”将从社区移除，无法在页面恢复。`;
    $('#delete-dialog').showModal(); $('#delete-cancel').focus();
  }));
  return actions;
}
function renderPost(post) {
  const card = node('article', 'post-card'); card.dataset.postId = post.id;
  const open = node('button', 'post-open'); open.type = 'button';
  const title = node('h3'); if (post.pinned) title.append(pinBadge()); title.append(document.createTextNode(post.title));
  open.append(title, node('p', 'post-preview', post.body)); open.addEventListener('click', () => openPost(post.id));
  const bottom = node('div', 'post-bottom');
  bottom.append(action('阅读话题', 'message', 'post-read', () => openPost(post.id)), postActions(post));
  card.append(postMeta(post), open, bottom); return card;
}
async function loadPosts(append = false) {
  if (!state.user) return;
  const load = ++state.load, epoch = state.epoch;
  const query = new URLSearchParams({ scope: state.scope, offset: String(append ? state.posts.length : 0) });
  if (state.category) query.set('category', state.category);
  if (state.search) query.set('q', state.search);
  if (!append) { state.posts = []; $('#posts').replaceChildren(); $('#empty-state').hidden = true; $('#feed-end').hidden = true; }
  $('#posts').setAttribute('aria-busy', 'true'); $('#load-more').disabled = true; $('#load-more').hidden = true;
  $('#result-count').textContent = '正在加载…'; message('#feed-message');
  try {
    const data = await api(`${POSTS}?${query}`);
    if (load !== state.load || epoch !== state.epoch) return;
    state.posts = append ? [...state.posts, ...data.posts.filter(post => !state.posts.some(existing => existing.id === post.id))] : data.posts;
    state.total = data.total; state.hasMore = data.hasMore;
    $('#posts').replaceChildren(...state.posts.map(renderPost));
    $('#result-count').textContent = `${state.total} 篇话题`;
    $('#stat-posts').textContent = data.stats.posts; $('#stat-members').textContent = data.stats.contributors; $('#mine-count').textContent = data.stats.mine;
    const filtered = Boolean(state.search || state.category || state.scope === 'mine');
    $('#empty-title').textContent = filtered ? '这里暂时没有帖子。' : '对话，从你开始。';
    $('#empty-description').textContent = state.search ? '换个关键词试试，或浏览其他话题分类。' : state.scope === 'mine' ? '你还没有发布帖子，来分享一个想法吧。' : '分享一个想法，让这里多一点新鲜事。';
    $('#empty-state button').textContent = filtered ? '发布一个新话题 ↗' : '发布第一篇帖子 ↗';
    $('#empty-state').hidden = state.posts.length > 0; $('#load-more').hidden = !data.hasMore; $('#feed-end').hidden = !state.posts.length || data.hasMore;
  } catch (error) {
    if (load === state.load && epoch === state.epoch) { message('#feed-message', `${error.message} 可点击刷新重试。`, true); $('#result-count').textContent = '加载失败'; $('#load-more').hidden = !append; }
  } finally {
    if (load === state.load) { $('#posts').setAttribute('aria-busy', 'false'); $('#load-more').disabled = false; }
  }
}
function renderDetail(post) {
  state.current = post; message('#detail-message');
  const title = node('h2'); title.id = 'detail-title'; if (post.pinned) title.append(pinBadge()); title.append(document.createTextNode(post.title));
  const body = node('div', 'detail-body', post.body);
  const bottom = node('div', 'post-bottom'); bottom.append(node('span', 'muted', '谢谢你，让想法在这里发生。'), postActions(post, true));
  $('#detail-content').replaceChildren(postMeta(post), title, body, bottom);
}
async function openPost(id) {
  const epoch = state.epoch, request = ++state.detail;
  $('#detail-content').replaceChildren(node('h2', '', '正在打开话题…')); message('#detail-message');
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  try {
    const post = await api(`${POSTS}/${id}`);
    if (epoch !== state.epoch || request !== state.detail || !$('#detail-dialog').open) return;
    renderDetail(post);
  } catch (error) { if (epoch === state.epoch && request === state.detail) message('#detail-message', error.message, true); }
}

$$('[data-auth]').forEach(button => button.addEventListener('click', () => {
  state.auth = button.dataset.auth;
  $$('[data-auth]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  $('#invite-field').hidden = state.auth !== 'register'; $('#invite').required = state.auth === 'register';
  $('#password').autocomplete = state.auth === 'register' ? 'new-password' : 'current-password';
  $('#auth-label').textContent = state.auth === 'register' ? '注册并加入社区' : '登录社区';
  message('#auth-message');
}));
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('#auth-submit').disabled) return;
  $('#auth-submit').disabled = true; message('#auth-message', '正在验证账号…');
  try {
    const info = await api('/' + state.auth, { method: 'POST', body: { username: $('#username').value.trim(), password: $('#password').value, invite: $('#invite').value.trim() } });
    $('#password').value = ''; $('#invite').value = ''; state.ready = true;
    await unlock(info); message('#auth-message');
  } catch (error) { message('#auth-message', error.message, true); }
  finally { $('#auth-submit').disabled = false; }
});
async function logout() {
  $('#logout').disabled = true; $('#mobile-logout').disabled = true;
  try { await api('/logout', { method: 'POST' }); lock(); message('#auth-message', '已退出社区、AI 生图和终端的当前登录。'); }
  catch (error) { if (state.user) toast(error.message); }
  finally { $('#logout').disabled = false; $('#mobile-logout').disabled = false; }
}
$('#logout').addEventListener('click', logout); $('#mobile-logout').addEventListener('click', logout);
function changeScope(scope) { state.scope = scope; state.category = ''; state.search = ''; $('#search').value = ''; syncFilters(); loadPosts(); }
$$('[data-scope]').forEach(button => button.addEventListener('click', () => changeScope(button.dataset.scope)));
$('#account-button').addEventListener('click', () => changeScope('mine'));
$$('[data-category]').forEach(button => button.addEventListener('click', () => { state.category = button.dataset.category; syncFilters(); loadPosts(); }));
$('#search-form').addEventListener('submit', event => { event.preventDefault(); state.search = $('#search').value.trim(); loadPosts(); });
$('#search').addEventListener('search', () => { if (!$('#search').value && state.search) { state.search = ''; loadPosts(); } });
$('#refresh').addEventListener('click', () => loadPosts());
$('#load-more').addEventListener('click', () => loadPosts(true));
function updateCounters() { $('#title-count').textContent = `${$('#post-title').value.length} / 80`; $('#body-count').textContent = `${$('#post-body').value.length} / 10000`; }
$('#post-title').addEventListener('input', updateCounters); $('#post-body').addEventListener('input', updateCounters);
$$('[data-compose]').forEach(button => button.addEventListener('click', () => {
  if (!state.user) return;
  if (!$('#post-title').value && !$('#post-body').value) $('#post-category').value = state.category || 'general';
  message('#post-message'); $('#compose-dialog').showModal(); $('#post-title').focus();
}));
$('#compose-close').addEventListener('click', () => $('#compose-dialog').close());
$('#compose-dialog').addEventListener('cancel', event => { if (state.publishing) event.preventDefault(); });
$('#post-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.publishing) return;
  const title = $('#post-title').value.trim(), body = $('#post-body').value.trim();
  if (!title || !body) { message('#post-message', '请填写标题和正文。', true); return; }
  state.publishing = true; $('#publish').disabled = true; $('#compose-close').disabled = true;
  const epoch = state.epoch;
  try {
    await api(POSTS, { method: 'POST', body: { title, body, category: $('#post-category').value } });
    if (epoch !== state.epoch) return;
    $('#compose-dialog').close(); $('#post-form').reset(); updateCounters();
    state.category = ''; state.search = ''; $('#search').value = ''; syncFilters();
    await loadPosts(); toast('发布成功，想法已经被看见。');
  } catch (error) { if (epoch === state.epoch) message('#post-message', error.message, true); }
  finally { state.publishing = false; $('#publish').disabled = false; $('#compose-close').disabled = false; }
});
$('#detail-close').addEventListener('click', () => $('#detail-dialog').close());
$('#detail-dialog').addEventListener('close', () => { state.detail++; state.current = null; });
$('#delete-cancel').addEventListener('click', () => $('#delete-dialog').close());
$('#delete-dialog').addEventListener('close', () => { state.deleting = null; });
$('#delete-dialog').addEventListener('cancel', event => { if ($('#delete-confirm').disabled) event.preventDefault(); });
$('#delete-confirm').addEventListener('click', async () => {
  if (!state.deleting || $('#delete-confirm').disabled) return;
  const post = state.deleting, epoch = state.epoch;
  $('#delete-confirm').disabled = true; $('#delete-cancel').disabled = true; message('#delete-message');
  try {
    await api(`${POSTS}/${post.id}`, { method: 'DELETE' });
    if (epoch !== state.epoch) return;
    $('#delete-dialog').close(); if (state.current?.id === post.id) $('#detail-dialog').close();
    await loadPosts(); toast('帖子已删除');
  } catch (error) { if (epoch === state.epoch) message('#delete-message', error.message, true); }
  finally { $('#delete-confirm').disabled = false; $('#delete-cancel').disabled = false; }
});
window.addEventListener('focus', checkSession);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSession(); });
checkSession();
