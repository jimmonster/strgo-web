(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const windows = new Map();
  let user = null, csrf = '', active = '', epoch = 0, refreshing = false, dialogAction = null;
  const MAX_WINDOWS = 8;
  const compactQuery = '(max-width:700px), (max-width:1000px) and (max-height:500px)';
  let viewportState = { compact: false, keyboard: false };

  function feedback(message = '') { $('workspace-message').textContent = message; $('workspace-message').hidden = !message; }
  async function account(path, body) {
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 8000);
    try {
    const response = await fetch(`/api/image/${path}`, {
      signal: controller.signal,
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || data.message || `请求失败 (${response.status})`); error.status = response.status; throw error; }
    return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('账号服务响应超时，请检查网络后重试。');
      throw error;
    } finally { clearTimeout(deadline); }
  }
  function post(session, action) { session?.frame?.contentWindow?.postMessage({ source: 'strgo-workspace', action, ...(action === 'viewport' ? { viewport: viewportState } : {}) }, location.origin); }
  function storageKey() { return `strgo-terminal-windows:${user.id}`; }
  function save() {
    if (!user) return;
    const sessions = [...windows.values()].map(s => ({ id: s.id, name: s.name, mode: s.mode, ...(s.target ? { target: s.target } : {}) }));
    try { localStorage.setItem(storageKey(), JSON.stringify({ active, sessions })); }
    catch { feedback('浏览器未允许保存窗口配置；当前终端仍可正常使用，刷新后需重新创建窗口。'); }
  }
  function safeTarget(value) {
    if (!value || typeof value.host !== 'string' || value.host.length > 253 || typeof value.username !== 'string' || value.username.length > 64 || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return null;
    return { host: value.host, username: value.username, port: value.port };
  }
  function metadata() {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey()) || 'null');
      if (!data || !Array.isArray(data.sessions)) return null;
      return { active: data.active, sessions: data.sessions.slice(0, MAX_WINDOWS).filter(s => s && typeof s.id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(s.id) && typeof s.name === 'string' && ['workspace', 'ssh'].includes(s.mode)).map(s => ({ id: s.id, name: s.name.slice(0, 32) || '终端', mode: s.mode, target: safeTarget(s.target) })) };
    } catch { return null; }
  }
  function mobileList(show) {
    if (show) post(windows.get(active), 'dismiss-keyboard');
    document.body.classList.toggle('list-open', show);
    $('sidebar-shade').hidden = !show;
    $('show-sessions').setAttribute('aria-expanded', String(show));
  }
  function updateHeading() {
    const selected = windows.get(active);
    $('conversation-name').textContent = selected?.name || '我的终端';
    $('conversation-status').textContent = selected?.status || '创建一个终端开始工作';
    $('reconnect-session').hidden = !selected || selected.state === 'ready' || selected.state === 'connecting';
    $('reconnect-session').textContent = selected?.state === 'idle' ? '连接' : '重新连接';
    $('workspace-empty').hidden = !!selected;
    $('session-menu-toggle').disabled = !selected;
    $('workspace-boundary').textContent = selected?.mode === 'ssh' ? 'SSH 远端终端 · 登录目标服务器后执行命令' : '离线 Linux 工作区 · 文件保留，进程随连接结束';
    $('window-count').textContent = `${windows.size} / ${MAX_WINDOWS} 个窗口`;
    $('new-terminal').disabled = $('new-ssh').disabled = windows.size >= MAX_WINDOWS;
    $('mobile-connect').disabled = !selected || selected.state === 'ready' || selected.state === 'connecting';
    for (const id of ['mobile-rename', 'mobile-export', 'mobile-clear', 'mobile-close']) $(id).disabled = !selected;
  }
  function renderList() {
    const query = $('session-search').value.trim().toLowerCase();
    $('conversation-list').replaceChildren();
    let shown = 0;
    for (const s of windows.values()) {
      if (query && !`${s.name} ${s.mode === 'ssh' ? 'SSH' : '工作区'}`.toLowerCase().includes(query)) continue;
      shown++;
      const row = document.createElement('button'); row.type = 'button'; row.className = 'conversation-item'; row.dataset.id = s.id;
      row.setAttribute('aria-current', String(s.id === active)); row.setAttribute('role', 'listitem');
      const avatar = document.createElement('span'); avatar.className = `session-avatar ${s.mode}`; avatar.textContent = s.mode === 'ssh' ? '↗' : '>_'; avatar.setAttribute('aria-hidden', 'true');
      const content = document.createElement('span'); content.className = 'session-summary';
      const title = document.createElement('strong'); title.textContent = s.name;
      const preview = document.createElement('span'); preview.textContent = s.preview || (s.mode === 'ssh' ? 'SSH · ' : '工作区 · ') + s.status;
      content.append(title, preview);
      const indicator = document.createElement('span'); indicator.className = 'session-indicator'; indicator.dataset.state = s.state;
      indicator.textContent = s.unread ? '●' : ''; indicator.setAttribute('aria-label', s.unread ? '有新输出' : s.status);
      row.append(avatar, content, indicator); row.addEventListener('click', () => select(s.id));
      $('conversation-list').append(row);
    }
    $('list-empty').hidden = shown > 0;
    updateHeading();
  }
  function select(id) {
    if (!windows.has(id)) return;
    post(windows.get(active), 'deactivate');
    active = id;
    for (const s of windows.values()) s.frame.hidden = s.id !== id;
    windows.get(id).unread = false;
    post(windows.get(id), 'viewport');
    post(windows.get(id), 'activate');
    mobileList(false); $('session-menu').hidden = true; $('session-menu-toggle').setAttribute('aria-expanded', 'false');
    renderList(); save();
  }
  function create(mode = 'workspace', stored = null, autoStart = true) {
    if (!user) return;
    if (windows.size >= MAX_WINDOWS) { feedback('最多打开 8 个窗口，请先关闭不再使用的终端。'); return; }
    const id = stored?.id || crypto.randomUUID();
    if (windows.has(id)) return;
    const session = { id, mode, name: stored?.name || (mode === 'ssh' ? 'SSH 连接' : (windows.size ? `终端 ${windows.size + 1}` : '我的终端')), target: stored?.target || null, state: 'idle', status: autoStart && mode === 'workspace' ? '准备连接…' : '待连接', unread: false, preview: '' };
    const frame = document.createElement('iframe'); session.frame = frame;
    frame.title = session.name; frame.className = 'session-frame'; frame.hidden = true;
    const params = new URLSearchParams({ embed: '1', mode, auto: autoStart ? '1' : '0', compact: viewportState.compact ? '1' : '0' });
    if (session.target) for (const [key, value] of Object.entries(session.target)) params.set(key, String(value));
    frame.src = `/terminal/session?${params}`;
    frame.addEventListener('load', () => { post(session, 'viewport'); post(session, session.id === active ? 'activate' : 'deactivate'); });
    windows.set(id, session); $('session-frames').append(frame);
    select(id);
    return session;
  }
  function reset(message = '') {
    epoch++;
    for (const s of windows.values()) { post(s, 'dispose'); s.frame.remove(); }
    windows.clear(); active = ''; user = null; csrf = '';
    $('action-dialog').close(); dialogAction = null;
    $('session-menu').hidden = true; mobileList(false);
    $('app-view').hidden = true; $('auth-view').hidden = false;
    document.body.classList.remove('terminal-app');
    $('account-password').value = ''; $('auth-message').textContent = message;
    $('account-submit').disabled = false; $('account-submit').textContent = '登录并进入终端';
  }
  function enter(info) {
    if (!info.user?.id) throw new Error('账号信息异常，请重新登录。');
    user = info.user; csrf = info.csrf;
    $('auth-view').hidden = true; $('app-view').hidden = false;
    document.body.classList.add('terminal-app'); viewport();
    $('account-label').textContent = user.username;
    $('account-avatar').textContent = user.username.slice(0, 1).toUpperCase();
    const data = metadata();
    if (data?.sessions.length) {
      for (const s of data.sessions) create(s.mode, s, false);
      if (windows.has(data.active)) select(data.active);
      feedback('已恢复窗口配置。点击「连接」新建会话，文件保留，之前的命令不会自动执行。');
    } else create();
    renderList();
  }
  async function refresh() {
    if (refreshing || !user) return;
    refreshing = true; const current = epoch;
    try {
      const info = await account('terminal-session');
      if (epoch !== current || !user) return;
      if (info.user.id !== user.id) { reset(); enter(info); }
      else csrf = info.csrf;
    } catch (error) {
      if (current !== epoch) return;
      if (error.status === 401) reset('登录已过期或已在其他页面退出，请重新登录。');
      else feedback('暂时无法核实账号状态，请检查网络后重试。');
    } finally { refreshing = false; }
  }
  function ask(action) {
    const s = windows.get(active); if (!s) return;
    $('session-menu').hidden = true; $('session-menu-toggle').setAttribute('aria-expanded', 'false');
    dialogAction = { action, id: s.id };
    $('action-title').textContent = action === 'rename' ? '重命名终端' : action === 'clear' ? '清除聊天记录？' : '关闭终端窗口？';
    $('action-description').textContent = action === 'rename' ? '' : action === 'clear' ? '仅清除本窗口显示的聊天内容，不中断运行中的命令。' : '此窗口的连接和进程将结束，聊天与草稿将清除。工作区文件保留。';
    $('rename-label').hidden = $('rename-value').hidden = action !== 'rename';
    $('rename-value').value = s.name; $('action-confirm').textContent = action === 'rename' ? '保存' : action === 'clear' ? '清除' : '关闭窗口';
    $('action-dialog').showModal();
    if (action === 'rename') { $('rename-value').focus(); $('rename-value').select(); }
    else $('action-cancel').focus();
  }
  $('account-login').addEventListener('submit', async event => {
    event.preventDefault(); const current = ++epoch;
    $('account-submit').disabled = true; $('auth-message').textContent = '';
    const password = $('account-password').value; $('account-password').value = '';
    try {
      await account('login', { username: $('account-name').value.trim(), password });
      const info = await account('terminal-session');
      if (epoch === current) enter(info);
    } catch (error) { if (epoch === current) $('auth-message').textContent = error.message; }
    finally { if (epoch === current) { $('account-submit').disabled = false; $('account-submit').textContent = '登录并进入终端'; } }
  });
  $('account-logout').addEventListener('click', async () => {
    $('account-logout').disabled = true;
    try { await account('logout', {}); reset('已退出账号，AI 生图的当前登录也已退出。'); }
    catch (error) { if (error.status === 401) reset('当前账号已退出。'); else feedback(`退出失败：${error.message}。请重试。`); }
    finally { $('account-logout').disabled = false; }
  });
  $('mobile-logout').addEventListener('click', () => $('account-logout').click());
  $('new-terminal').addEventListener('click', () => create());
  $('empty-create').addEventListener('click', () => create());
  $('new-ssh').addEventListener('click', () => {
    const selected = windows.get(active);
    const previous = selected?.mode === 'ssh' && selected.target ? selected : [...windows.values()].reverse().find(s => s.mode === 'ssh' && s.target);
    create('ssh', previous ? { target: previous.target } : null);
  });
  $('session-search').addEventListener('input', renderList);
  $('show-sessions').addEventListener('click', () => mobileList(!document.body.classList.contains('list-open')));
  $('sidebar-shade').addEventListener('click', () => mobileList(false));
  $('session-menu-toggle').addEventListener('click', () => { const open = $('session-menu').hidden; $('session-menu').hidden = !open; $('session-menu-toggle').setAttribute('aria-expanded', String(open)); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { mobileList(false); $('session-menu').hidden = true; $('session-menu-toggle').setAttribute('aria-expanded', 'false'); } });
  $('rename-session').addEventListener('click', () => ask('rename'));
  $('close-session').addEventListener('click', () => ask('close'));
  $('clear-session').addEventListener('click', () => ask('clear'));
  $('reconnect-session').addEventListener('click', () => post(windows.get(active), 'connect'));
  $('export-session').addEventListener('click', () => { post(windows.get(active), 'export'); $('session-menu').hidden = true; });
  for (const [mobile, target] of [['mobile-connect', 'reconnect-session'], ['mobile-rename', 'rename-session'], ['mobile-export', 'export-session'], ['mobile-clear', 'clear-session'], ['mobile-close', 'close-session']]) {
    $(mobile).addEventListener('click', () => { mobileList(false); $(target).click(); });
  }
  $('action-cancel').addEventListener('click', () => { $('action-dialog').close(); dialogAction = null; });
  $('action-dialog').addEventListener('cancel', () => { dialogAction = null; });
  $('action-form').addEventListener('submit', event => {
    event.preventDefault(); if (!dialogAction) return;
    const { action, id } = dialogAction, s = windows.get(id);
    if (!s) { $('action-dialog').close(); return; }
    if (action === 'rename') {
      const name = $('rename-value').value.trim().slice(0, 32); if (!name) { $('rename-value').focus(); return; }
      s.name = name; s.frame.title = name;
    } else if (action === 'clear') { post(s, 'clear'); s.preview = ''; }
    else {
      post(s, 'dispose'); s.frame.remove(); windows.delete(id);
      if (active === id) { active = ''; const next = windows.keys().next().value; if (next) select(next); }
    }
    dialogAction = null; $('action-dialog').close(); renderList(); save();
  });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.source !== 'strgo-terminal') return;
    const s = [...windows.values()].find(item => item.frame.contentWindow === event.source); if (!s) return;
    const { type, state, text, target } = event.data;
    if (type === 'status' && ['idle', 'ready', 'connecting', 'error'].includes(state)) {
      s.state = state; s.status = String(text).slice(0, 80);
      if (state === 'ready' && $('workspace-message').textContent.startsWith('已恢复窗口配置')) feedback();
    }
    else if (type === 'output') { if (s.id !== active) s.unread = true; s.preview = String(text || '').replace(/\s+/g, ' ').slice(-80); }
    else if (type === 'target' && s.mode === 'ssh') { s.target = safeTarget(target); save(); }
    else if (type === 'auth-expired') { refresh(); return; }
    else if (type === 'sessions') { if (s.id === active) mobileList(true); return; }
    else if (type === 'viewport-ready') { post(s, 'viewport'); return; }
    else return;
    renderList();
  });
  function viewport() {
    const visual = window.visualViewport;
    const height = Math.max(1, Math.round(visual?.height || innerHeight));
    const layoutHeight = Math.max(innerHeight, document.documentElement.clientHeight || 0);
    viewportState = { compact: window.matchMedia(compactQuery).matches, keyboard: (visual?.scale || 1) === 1 && layoutHeight - height > 100 };
    document.documentElement.style.setProperty('--app-height', `${height}px`);
    document.documentElement.style.setProperty('--app-top', `${Math.max(0, Math.round(visual?.offsetTop || 0))}px`);
    document.body.classList.toggle('keyboard-open', viewportState.keyboard);
    for (const s of windows.values()) post(s, 'viewport');
  }
  window.visualViewport?.addEventListener('resize', viewport); window.visualViewport?.addEventListener('scroll', viewport);
  window.addEventListener('resize', viewport); window.addEventListener('orientationchange', viewport); viewport();
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('storage', event => { if (user && event.key === 'strgo-account-event') refresh(); });
  setInterval(refresh, 15000);
  account('terminal-session').then(enter).catch(error => reset(error.status === 401 ? '' : `登录检查失败：${error.message}。可重新登录重试。`));
})();
