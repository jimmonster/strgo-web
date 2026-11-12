const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const date = value => value ? new Date(Number(value) * 1000).toLocaleString('zh-CN', { hour12: false }) : '暂无记录';
const bytes = value => value == null ? '未提供' : value >= 1073741824 ? (value / 1073741824).toFixed(2) + ' GiB' : (value / 1048576).toFixed(1) + ' MiB';
const tabs = { overview: '运行概览', users: '账号管理', invites: '邀请码', forum: '社区管理', policy: '生图额度', tasks: '任务状态', audit: '操作审计' };
const states = { queued: '排队中', generating: '生成中', uploading: '保存中', running: '执行中', complete: '已完成', failed: '失败', partial: '部分完成', QUEUED: '排队中', DISPATCHING: '正在派发', RUNNING: '执行中', SAVING: '保存中', SUCCEEDED: '已完成', FAILED: '失败', CANCELLED: '已取消', RECONCILING: '待核对', CANCEL_REQUESTED: '正在停止', INTERRUPTED: '已中断' };

export function createAdmin({ document, fetch, confirm, location }) {
  const $ = selector => document.querySelector(selector);
  let csrf = '', user = null, view = 'overview', offset = 0, search = '', module = 'image', category = '', epoch = 0;
  const tr = text => document.defaultView?.strgoI18n?.translate(text) ?? text;
  function feedback(text = '', error = false, fixed = false) { const el = $('#feedback'); el.toggleAttribute('data-strgo-static', fixed); el.textContent = text; el.dataset.error = String(error); }
  const feedbackFixed = text => feedback(text, false, true);
  async function request(path, method = 'GET', body, admin = true) {
    const response = await fetch('/api/image' + (admin ? '/admin' : '') + path, {
      method, credentials: 'same-origin', headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) })
    });
    let data; try { data = await response.json(); } catch { throw new Error('服务响应无效，请稍后重试。'); }
    if (!response.ok) { const error = new Error(data?.error?.message || data?.error || '操作失败，请稍后重试。'); error.status = response.status; throw error; }
    return data;
  }
  function showError(error) {
    if (error.status === 401) { ++epoch; user = null; csrf = ''; $('#account').textContent = ''; $('#logout').hidden = true; login(); }
    feedback(error.message, true);
  }
  function bind(selector, handler) {
    const element = $(selector); if (!element) return;
    element.onclick = async event => { const button = event.currentTarget; button.disabled = true; try { await handler(event); } catch (error) { showError(error); } finally { if (button.isConnected) button.disabled = false; } };
  }
  function title(name, text) { return `<div class="page-title"><h1>${escape(name)}</h1><p class="muted">${escape(text)}</p></div>`; }
  function table(headers, rows) { return rows.length ? `<div class="table-wrap" tabindex="0" aria-label="可横向滚动的数据表"><table><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<div class="panel empty">暂无符合条件的记录。</div>'; }
  function pager(total, hasMore, size = 20) {
    return `<div class="pagination"><span>共 ${total} 条${total ? ` · ${offset + 1}–${Math.min(offset + size, total)}` : ''}</span><button id="previous" ${offset ? '' : 'disabled'}>上一页</button><button id="next" ${hasMore ? '' : 'disabled'}>下一页</button></div>`;
  }
  function wirePager() {
    if ($('#previous') && offset) bind('#previous', () => { offset = Math.max(0, offset - 20); return render(); });
    if ($('#next') && !$('#next').disabled) bind('#next', () => { offset += 20; return render(); });
  }
  function toolbar(extra = '') { return `<form id="search" class="toolbar"><input name="q" aria-label="搜索" maxlength="80" placeholder="${view === 'forum' ? '搜索帖子标题或内容' : '按用户名搜索'}" value="${escape(search)}">${extra}<button type="submit">搜索</button><button type="button" id="refresh">刷新</button></form>`; }
  function wireSearch() {
    if ($('#search')) $('#search').onsubmit = event => { event.preventDefault(); search = $('#search input').value.trim(); offset = 0; if ($('#module')) module = $('#module').value; if ($('#category')) category = $('#category').value; render().catch(showError); };
    bind('#refresh', () => render());
  }
  function login() {
    $('#main').innerHTML = `<section class="panel login"><p class="hint">STRGO ADMIN</p><h1>登录全站后台</h1><p class="muted">使用已有管理员账号继续。</p><form id="login"><label>用户名<input name="username" autocomplete="username" required pattern="[A-Za-z0-9_-]{3,32}"></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">登录管理后台</button></form></section>`;
    $('#login').onsubmit = async event => { event.preventDefault(); const form = event.target, button = form.querySelector('button'); button.disabled = true; try {
      await request('/login', 'POST', { username: form.querySelector('[name=username]').value, password: form.querySelector('[name=password]').value }, false);
      form.querySelector('[name=password]').value = ''; await start();
    } catch (error) { feedback(error.message, true); } finally { if (button.isConnected) button.disabled = false; } };
  }
  async function start() {
    feedback();
    try {
      const session = await request('/session'); user = session.user; csrf = session.csrf;
      $('#account').innerHTML = `<span data-strgo-user-content>${escape(user.username)}</span> · <span>管理员</span>`; $('#logout').hidden = false;
      bind('#logout', async () => { await request('/logout', 'POST', {}, false); user = null; csrf = ''; ++epoch; $('#account').textContent = ''; $('#logout').hidden = true; login(); });
      view = Object.hasOwn(tabs, location.hash?.slice(1)) ? location.hash.slice(1) : 'overview'; await render();
    } catch (error) {
      if (error.status === 403) { $('#logout').hidden = false; bind('#logout', async () => { const session = await request('/terminal-session', 'GET', undefined, false); csrf = session.csrf; await request('/logout', 'POST', {}, false); location.reload(); }); $('#main').innerHTML = `<section class="panel error-panel"><h1>需要管理员权限</h1><p>当前账号无法访问全站后台。请使用管理员账号登录。</p><a href="/">返回主站</a></section>`; }
      else if (error.status === 401) login();
      else { feedback(error.message, true); $('#main').innerHTML = '<section class="panel error-panel"><h1>暂时无法连接后台</h1><p>请检查账号服务，或稍后重试。</p><button id="retry">重新连接</button></section>'; bind('#retry', start); }
    }
  }
  async function render() {
    if (!user) return;
    const generation = ++epoch, currentView = view;
    $('#nav').innerHTML = Object.entries(tabs).map(([id, label]) => `<a href="#${id}" data-view="${id}" ${view === id ? 'aria-current="page"' : ''}>${label}</a>`).join('');
    $('#nav').querySelectorAll('a').forEach(link => { link.onclick = event => { event.preventDefault(); view = link.dataset.view; location.hash = view; offset = 0; search = ''; feedback(); render().catch(showError); }; });
    $('#main').innerHTML = title(tabs[view], '正在读取管理数据…');
    const paths = { overview: '/summary', users: '/users', invites: '/invites', forum: '/forum/posts', policy: '/policy', tasks: '/tasks', audit: '/audit' };
    const query = new URLSearchParams({ offset: String(offset), limit: '20', q: search, module, ...(category ? { category } : {}) });
    let data; try { data = await request(paths[currentView] + '?' + query); } catch (error) { if (generation === epoch) { $('#main').innerHTML = title(tabs[currentView], '数据加载失败。') + '<button id="retry">重试</button>'; bind('#retry', render); } throw error; }
    if (generation !== epoch) return;
    if (view === 'overview') overview(data);
    if (view === 'users') users(data);
    if (view === 'invites') invites(data);
    if (view === 'forum') forum(data);
    if (view === 'policy') policy(data);
    if (view === 'tasks') tasks(data);
    if (view === 'audit') audits(data);
    wirePager(); wireSearch();
  }
  function overview(data) {
    const c = data.counts;
    $('#main').innerHTML = title('全站运行概览', '统一查看账号、内容和任务状态。') + `<div class="cards">${[['注册账号', c.users], ['有效会话', c.sessions], ['社区帖子', c.posts], ['私有作品', c.images + c.audio]].map(([name, count]) => `<div class="card"><small>${name}</small><strong>${count}</strong></div>`).join('')}</div><div class="two-cols"><section class="panel"><h2>存储与备份</h2>${[['存储', data.storage.label], ['可用状态', data.storage.ready ? '可用' : '暂不可用'], ['磁盘剩余', bytes(data.storage.freeBytes)], ['图片 / 音频', `${c.images} 张 / ${c.audio} 首`], ['作品总大小', bytes(c.imageBytes + c.audioBytes)], ['最近备份', date(data.backup.last)], ['备份状态', data.backup.hasError ? '失败，请检查运维日志' : data.backup.last ? '已记录备份' : '暂无备份记录']].map(([k, v]) => `<div class="status-line"><span class="muted">${escape(k)}</span><span${k === '存储' ? ' data-strgo-user-content' : ''}>${escape(v)}</span></div>`).join('')}</section><section class="panel"><h2>任务与本机连接</h2>${Object.entries(data.tasks).map(([key, rows]) => `<h3>${{ image: 'AI 生图', ai: 'AI 对话 / 音乐', workflow: 'ComfyUI 工作流' }[key]}</h3><p>${rows.map(row => `<span class="badge"${states[row.state] ? '' : ' data-strgo-user-content'}>${escape(states[row.state] || row.state)} ${row.count}</span>`).join(' ') || '<span class="muted">暂无任务</span>'}</p>`).join('')}<div class="status-line"><span>Workflow</span><span>${data.workflow.online ? '在线' : '离线或未连接'}</span></div></section></div><div class="section-links"><a href="/admin/ai/">管理 AI 模型、节点、预算与授权 →</a><a href="/image-playground/">管理全部图片与预装灵感 →</a></div>`;
  }
  function users(data) {
    $('#main').innerHTML = title('账号管理', '停用、角色变更会撤销该账号所有登录。恢复全站账号后，AI 模块仍按独立授权生效。') + toolbar() + table(['账号', '角色 / 状态', '创建时间', '会话', '操作'], data.items.map(row => `<tr><td><strong data-strgo-user-content>${escape(row.username)}</strong><div class="hint" data-strgo-user-content>${escape(row.id.slice(0, 8))}</div></td><td>${row.role === 'admin' ? '管理员' : '普通成员'} <span class="badge ${row.status === 'disabled' ? 'off' : ''}">${row.status === 'disabled' ? '已停用' : '已启用'}</span>${row.aiStatus === 'disabled' ? '<p class="hint">AI 管理中另有停用</p>' : ''}</td><td>${date(row.created)}</td><td>${row.sessions}</td><td><div class="actions"><button data-user="${row.id}" data-action="status" ${row.id === user.id ? 'disabled' : ''}>${row.status === 'disabled' ? '恢复账号' : '停用账号'}</button><button data-user="${row.id}" data-action="role" ${row.id === user.id ? 'disabled' : ''}>${row.role === 'admin' ? '降为成员' : '设为管理员'}</button><button data-user="${row.id}" data-action="revoke" ${row.id === user.id ? 'disabled' : ''}>撤销会话</button></div></td></tr>`)) + pager(data.total, data.hasMore);
    document.querySelectorAll('[data-user]').forEach(button => bind(`[data-user="${button.dataset.user}"][data-action="${button.dataset.action}"]`, async () => {
      const row = data.items.find(row => row.id === button.dataset.user), action = button.dataset.action;
      if (!confirm(`${button.textContent}「${row.username}」？${tr('该账号需要重新登录。')}`)) return;
      if (action === 'revoke') await request('/users/' + row.id + '/sessions', 'DELETE');
      else await request('/users/' + row.id, 'PUT', { revision: row.updated, ...(action === 'role' ? { role: row.role === 'admin' ? 'member' : 'admin' } : { status: row.status === 'active' ? 'disabled' : 'active' }) });
      feedbackFixed('账号管理操作已完成。'); await render();
    }));
  }
  function invites(data) {
    $('#main').innerHTML = title('邀请码管理', '新邀请码用于普通成员注册，7 天有效且只能使用一次。原文仅在创建时展示。') + '<button id="create-invite" class="primary">创建成员邀请码</button><div id="invite-result"></div>' + table(['编号', '类型', '状态', '使用者', '到期时间', '操作'], data.items.map(row => `<tr><td class="id">${row.id.slice(0, 12)}</td><td>${row.role === 'admin' ? '管理员引导' : '普通成员'}</td><td>${{ active: '可使用', used: '已使用', revoked: '已撤销', expired: '已过期' }[row.status]}</td><td data-strgo-user-content>${escape(row.usedBy || '—')}</td><td>${date(row.expires)}</td><td>${row.status === 'active' ? `<button class="danger" data-invite="${row.id}">撤销</button>` : '—'}</td></tr>`)) + pager(data.total, data.hasMore);
    bind('#create-invite', async () => { const result = await request('/invites', 'POST', {}); await render(); $('#invite-result').innerHTML = `<section class="panel"><label>请复制并妥善发送，此处原文不会再次显示<input class="invite-code" readonly value="${escape(result.code)}" aria-label="新邀请码"></label><p class="hint">有效期至 ${date(result.expires)}</p></section>`; });
    document.querySelectorAll('[data-invite]').forEach(button => bind(`[data-invite="${button.dataset.invite}"]`, async () => { if (!confirm(tr('撤销这个未使用的邀请码？'))) return; await request('/invites/' + button.dataset.invite, 'DELETE'); feedbackFixed('邀请码已撤销。'); await render(); }));
  }
  function forum(data) {
    const categories = { general: '综合交流', ai: 'AI 创作', terminal: '终端', help: '求助' };
    $('#main').innerHTML = title('社区内容管理', '搜索社区帖子，管理置顶与删除。') + toolbar(`<select id="category" aria-label="帖子分类"><option value="">全部分类</option>${Object.entries(categories).map(([id, label]) => `<option value="${id}" ${category === id ? 'selected' : ''}>${label}</option>`).join('')}</select>`) + table(['帖子', '作者', '分类', '时间', '操作'], data.posts.map(row => `<tr><td class="post-title"><strong data-strgo-user-content>${escape(row.title)}</strong>${row.pinned ? ' <span class="badge">置顶</span>' : ''}<div class="post-preview">${escape(row.body)}</div></td><td data-strgo-user-content>${escape(row.author.username)}</td><td>${categories[row.category]}</td><td>${date(row.created)}</td><td><div class="actions"><button data-post="${row.id}" data-op="pin">${row.pinned ? '取消置顶' : '置顶'}</button><button class="danger" data-post="${row.id}" data-op="delete">删除</button></div></td></tr>`)) + pager(data.total, data.hasMore);
    document.querySelectorAll('[data-post]').forEach(button => bind(`[data-post="${button.dataset.post}"][data-op="${button.dataset.op}"]`, async () => { const row = data.posts.find(row => row.id === button.dataset.post), remove = button.dataset.op === 'delete'; if (remove && !confirm(`${tr('删除帖子')}「${row.title}」？`)) return; await request('/forum/posts/' + row.id + (remove ? '' : '/pin'), remove ? 'DELETE' : 'PUT', remove ? undefined : { pinned: !row.pinned }); feedbackFixed(remove ? '帖子已删除。' : '置顶状态已更新。'); await render(); }));
  }
  function policy(data) {
    $('#main').innerHTML = title('生图额度与内容', '每个普通成员的每日张数额度按北京时间零点重置；管理员免于此项额度。') + `<section class="panel"><h2>成员每日生图额度</h2><form id="policy" class="inline"><label>每日张数（留空表示不限）<input id="daily-limit" type="number" min="0" max="100000" step="1" value="${data.dailyImageLimit ?? ''}"></label><button class="primary" type="submit">保存额度</button></form><p class="hint">0 表示暂停普通成员生成；已提交的任务和作品不返还当日消耗。</p></section><div class="two-cols"><section class="panel"><h2>全员图片与预装灵感</h2><p class="muted">在生图工作台中使用「全部成员作品」和管理员灵感设置管理现有内容。</p><a href="/image-playground/">打开生图管理 →</a></section><section class="panel"><h2>AI 模型与使用权</h2><p class="muted">对话、音乐、模型、节点与预算使用现有二次验证和细分授权。</p><a href="/admin/ai/">打开 AI 管理 →</a></section></div>`;
    $('#policy').onsubmit = async event => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; try { const raw = $('#daily-limit').value; await request('/policy', 'PUT', { dailyImageLimit: raw === '' ? null : Number(raw) }); feedbackFixed('每日额度已更新。'); } catch (error) { showError(error); } finally { if (button.isConnected) button.disabled = false; } };
  }
  function tasks(data) {
    $('#main').innerHTML = title('任务状态', '查看各模块任务的运行元数据。未知结果请核对执行记录，避免重复生成。') + toolbar(`<select id="module" aria-label="任务模块">${Object.entries({ image: 'AI 生图', ai: 'AI 对话 / 音乐', workflow: 'ComfyUI' }).map(([id, label]) => `<option value="${id}" ${module === id ? 'selected' : ''}>${label}</option>`).join('')}</select>`) + table(['编号', '账号', '类型 / 模型', '状态', '创建时间'], data.items.map(row => `<tr><td class="id">${row.id}</td><td data-strgo-user-content>${escape(row.username)}</td><td data-strgo-user-content>${escape(row.kind)}</td><td><span class="badge"${states[row.state] ? '' : ' data-strgo-user-content'}>${escape(states[row.state] || row.state)}</span></td><td>${date(row.created)}</td></tr>`)) + pager(data.total, data.hasMore);
  }
  function audits(data) {
    const labels = { 'user.update': '修改账号', 'user.sessions.revoke': '撤销账号会话', 'invite.create': '创建邀请码', 'invite.revoke': '撤销邀请码', 'image.policy.update': '调整生图额度', 'forum.pin': '调整帖子置顶', 'forum.delete': '删除帖子' };
    $('#main').innerHTML = title('后台操作审计', '记录管理操作的时间、操作者和目标；审计记录只读。') + table(['操作', '操作者', '目标', '变更', '时间'], data.items.map(row => `<tr><td${labels[row.action] ? '' : ' data-strgo-user-content'}>${escape(labels[row.action] || row.action)}</td><td data-strgo-user-content>${escape(row.actor)}</td><td class="id" data-strgo-user-content>${escape(row.target || '—')}</td><td class="id" data-strgo-user-content>${escape(row.detail)}</td><td>${date(row.created)}</td></tr>`)) + pager(data.total, data.hasMore);
  }
  return { start, render };
}
