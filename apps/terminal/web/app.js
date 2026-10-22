(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const BASE = '/terminal';
  const params = new URLSearchParams(location.search || '');
  const workspaceMode = params.get('mode') === 'workspace', embedded = params.get('embed') === '1';
  let visible = true, disposed = false, connectionTimer = null;
  const compactQuery = '(max-width:700px), (max-width:1000px) and (max-height:500px)';
  let parentViewport = null, mobileTools = false;
  function notify(type, data = {}) {
    if (embedded) window.parent.postMessage({ source: 'strgo-terminal', type, ...data, ...(type === 'output' ? { text: String(data.text || '').slice(-120) } : {}) }, location.origin);
  }
  const KEYS = { esc: '\x1b', tab: '\t', interrupt: '\x03', up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C', enter: '\r', home: '\x1b[H', end: '\x1b[F', delete: '\x1b[3~', clear: '\x0c', eof: '\x04', 'undo-line': '\x15', suspend: '\x1a' };
  let authenticated = false, socket = null, ready = false, ctrl = false;
  let generation = 0, started = 0, resizeTimer = null, terminal = null, fit = null;
  let mobileComposing = false, expanded = false, direct = false, lastInputAccepted = false;
  let reply = null, chatSequence = 0, unread = false;
  const secrets = [];
  const messages = new Map();
  const CHAT_HINT = '回车换行，点发送执行 · Ctrl+Enter 快速发送';
  const encoder = new TextEncoder();

  function status(text, state = 'idle') { $('status').textContent = text; $('status').dataset.state = state; notify('status', { text, state }); }
  function connectionMessage(text) {
    $('connect-message').textContent = text;
    $('terminal-notice').textContent = text;
    $('terminal-notice').hidden = !text;
    scheduleFit();
  }
  function updateAuthentication(value) {
    authenticated = value;
    $('access-panel').hidden = value;
    $('logout').hidden = !value;
    $('connection-fields').disabled = !value;
    if (!value) notify('auth-expired');
    if (!value) $('connection-details').open = true;
  }
  function updateControls() {
    $('connection-fields').disabled = !authenticated || socket !== null;
    $('disconnect').disabled = socket === null;
    $('mobile-input').disabled = !ready;
    $('submit-input').disabled = !ready;
    $('secret-input').disabled = !ready;
    $('command-editor').disabled = !ready;
    $('direct-mode').disabled = !terminal;
    $('expand-editor').disabled = !ready || direct || $('mobile-input').type === 'password';
    $('session-connect').disabled = socket !== null;
    for (const button of $('keys').querySelectorAll('button')) {
      if (!['font-size', 'more-keys', 'copy-selection'].includes(button.id)) button.disabled = !ready;
    }
  }
  async function api(path, body) {
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 8000);
    try {
    const response = await fetch(`${BASE}/api/${path}`, {
      signal: controller.signal,
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.message || `请求失败 (${response.status})`); error.status = response.status; throw error; }
    return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('账号验证超时，请检查网络后点连接重试。');
      throw error;
    } finally { clearTimeout(deadline); }
  }
  function initializeTerminal() {
    if (terminal) return true;
    if (typeof window.Terminal !== 'function' || !window.FitAddon?.FitAddon) {
      connectionMessage('终端资源加载失败，请刷新页面或联系管理员。'); return false;
    }
    terminal = new window.Terminal({
      cursorBlink: true, fontSize: window.matchMedia('(max-width:700px)').matches ? 12 : 14,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      scrollback: 4000, convertEol: false, allowProposedApi: false,
      theme: { background: '#080d14', foreground: '#dce6ed', cursor: '#73edb8', selectionBackground: '#2b594c', black: '#14212d', red: '#ff8c91', green: '#73edb8', yellow: '#f2d389', blue: '#83baff', magenta: '#cba6f7', cyan: '#7fdbda', white: '#dce6ed' },
    });
    fit = new window.FitAddon.FitAddon();
    terminal.loadAddon(fit); terminal.open($('terminal'));
    terminal.attachCustomKeyEventHandler?.(event => {
      if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 'c' && terminal.hasSelection?.()) {
        if (event.type === 'keydown') copyText(terminal.getSelection());
        return false;
      }
      return true;
    });
    $('terminal').addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text/plain');
      if (text === undefined) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (direct) setDirect(false);
      insertText(text);
      connectionMessage('粘贴内容已放入编辑区，请检查后点发送。');
    }, true);
    terminal.onData(data => {
      if (ctrl && data.length === 1) {
        const code = data.toUpperCase().charCodeAt(0);
        if (code >= 64 && code <= 95) data = String.fromCharCode(code & 31);
        toggleCtrl(false);
      }
      lastInputAccepted = sendInput(data);
    });
    terminal.onResize(({ cols, rows }) => {
      $('dimensions').textContent = `${cols} × ${rows}`;
      if (ready && cols >= 10 && rows >= 2 && cols <= 400 && rows <= 150) send({ type: 'resize', cols, rows });
    });
    new ResizeObserver(scheduleFit).observe($('terminal'));
    scheduleFit(); return true;
  }
  function scheduleFit() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!fit || $('terminal').clientHeight < 30 || $('terminal').clientWidth < 80) return;
      try { fit.fit(); } catch { /* Wait for layout to settle on mobile. */ }
    }, 90);
  }
  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try { socket.send(JSON.stringify(message)); return true; }
    catch { connectionMessage('连接已中断，未发送的编辑内容已保留。'); return false; }
  }
  function sendInput(data) {
    if (!ready || !data || socket?.readyState !== WebSocket.OPEN) return false;
    if (data.length > 64 * 1024) { connectionMessage('请把大段文本分为 64 KB 以下的片段。'); return false; }
    if (socket.bufferedAmount > 256 * 1024) { connectionMessage('输入发送较慢，请稍后继续，编辑内容已保留。'); return false; }
    // Split on Unicode characters, not UTF-16 offsets, and keep each packet below 8 KiB.
    let part = '', bytes = 0;
    for (const character of data) {
      const count = encoder.encode(character).length;
      if (bytes + count > 4096) { if (!send({ type: 'input', data: part })) return false; part = ''; bytes = 0; }
      part += character; bytes += count;
    }
    return !part || send({ type: 'input', data: part });
  }
  function toggleCtrl(value = !ctrl) { ctrl = value; $('ctrl-key').setAttribute('aria-pressed', String(ctrl)); }
  function inputFocus() {
    if (!visible) return;
    if (!direct) activeEditor().focus({ preventScroll: true });
    else terminal?.focus();
  }
  function activeEditor() { return $('mobile-input').type === 'password' ? $('mobile-input') : $('command-editor'); }
  function editorFocus() { if (visible) activeEditor().focus({ preventScroll: true }); }
  function setExpanded(value) {
    if (direct || mobileComposing || $('mobile-input').type === 'password') return;
    expanded = value;
    $('expand-editor').setAttribute('aria-expanded', String(expanded));
    $('expand-editor').textContent = expanded ? '收起 ↙' : '展开 ↗';
    $('mobile-input-bar').classList.toggle('expanded', expanded);
    growEditor(); editorFocus(); scheduleFit();
  }
  function setDirect(value) {
    if (mobileComposing) return;
    direct = value; toggleCtrl(false);
    $('edit-mode').setAttribute('aria-pressed', String(!direct));
    $('direct-mode').setAttribute('aria-pressed', String(direct));
    $('composer-body').hidden = direct && !document.body.classList.contains('compact-mobile');
    $('secret-input').hidden = direct;
    $('expand-editor').hidden = direct;
    document.body.classList.toggle('direct-input', direct);
    $('chat-log').hidden = direct;
    $('editor-hint').textContent = direct ? '适合 vim / top / tmux · 点「键盘」开始输入' : CHAT_HINT;
    updateControls(); inputFocus(); scheduleFit();
  }
  function insertText(text) {
    if (!ready || mobileComposing || !text) return;
    if (text.length > 64 * 1024 || activeEditor().value.length + text.length > 64 * 1024) { connectionMessage('编辑区最多容纳 64 KB 字符，请分段发送。'); return; }
    if (direct) setDirect(false);
    const editor = activeEditor(), start = editor.selectionStart ?? editor.value.length, end = editor.selectionEnd ?? start;
    editor.setRangeText(text, start, end, 'end'); growEditor(); editorFocus();
  }
  function editKey(key) {
    const editor = activeEditor();
    if (direct || !editor.value || !['left', 'right', 'home', 'end', 'delete'].includes(key)) return false;
    const start = editor.selectionStart ?? editor.value.length, end = editor.selectionEnd ?? start;
    let caret = start;
    if (key === 'left') caret = start === end ? start - (Array.from(editor.value.slice(0, start)).at(-1)?.length || 0) : start;
    if (key === 'right') caret = start === end ? end + (Array.from(editor.value.slice(end))[0]?.length || 0) : end;
    if (key === 'home') caret = start === 0 ? 0 : editor.value.lastIndexOf('\n', start - 1) + 1;
    if (key === 'end') { const next = editor.value.indexOf('\n', end); caret = next === -1 ? editor.value.length : next; }
    if (key === 'delete') editor.setRangeText('', start, start === end ? end + (Array.from(editor.value.slice(end))[0]?.length || 0) : end, 'end');
    else editor.setSelectionRange(caret, caret);
    editorFocus(); return true;
  }
  function growEditor() {
    const editor = $('command-editor');
    const compact = document.body.classList.contains('compact-mobile');
    const height = Math.max(1, window.innerHeight || window.visualViewport?.height || 1);
    const minimum = compact ? 40 : 44;
    const maximum = compact ? Math.max(minimum, Math.min(expanded ? 180 : 88, height * (expanded ? .35 : .22))) : expanded ? Math.max(80, height * .36) : 112;
    editor.style.height = 'auto';
    editor.style.height = `${Math.min(maximum, Math.max(minimum, editor.scrollHeight))}px`;
    scheduleFit();
  }
  function nearBottom() {
    const log = $('chat-log');
    return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  }
  function latest(scrollTerminal = false) {
    const log = $('chat-log'); log.scrollTop = log.scrollHeight;
    unread = false; $('scroll-bottom').textContent = '↓ 最新';
    if (direct && scrollTerminal) terminal?.scrollToBottom();
  }
  function addBubble(side, text, secret = false) {
    const stick = nearBottom(), row = document.createElement('article');
    row.className = `chat-message ${side}`;
    const avatar = document.createElement('span'); avatar.className = 'chat-avatar';
    avatar.textContent = side === 'sent' ? '我' : '>_'; avatar.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div'); content.className = 'message-content';
    const label = document.createElement('span'); label.className = 'message-label';
    label.textContent = side === 'sent' ? '我 · 已发送' : '服务器';
    const bubble = document.createElement('pre'); bubble.className = 'chat-bubble'; bubble.textContent = text;
    content.append(label, bubble);
    if (!secret) {
      const actions = document.createElement('div'); actions.className = 'message-actions';
      const id = String(++chatSequence); messages.set(id, bubble);
      const copy = document.createElement('button'); copy.type = 'button'; copy.dataset.copy = id; copy.textContent = '复制';
      actions.append(copy);
      if (side === 'sent') {
        const reuse = document.createElement('button'); reuse.type = 'button'; reuse.dataset.reuse = id; reuse.textContent = '再编辑'; actions.append(reuse);
      }
      content.append(actions); row.dataset.messageId = id;
    }
    row.append(avatar, content); $('chat-log').classList.add('has-messages'); $('chat-log').append(row);
    while ($('chat-log').children.length > 120) {
      const first = $('chat-log').firstElementChild; messages.delete(first.dataset.messageId); first.remove();
    }
    if (stick || side === 'sent') latest();
    notify('output', { text: secret ? '［隐藏输入］' : text });
    return bubble;
  }
  function startReply(echo = '', secret = false) {
    renderReply();
    reply?.marker?.dispose();
    const buffer = terminal?.buffer?.active;
    reply = {
      bubble: addBubble('received', '等待服务器输出…'), echo, secret,
      start: buffer ? buffer.baseY + buffer.cursorY : 0,
      prefix: buffer?.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) || '',
      marker: terminal?.registerMarker?.(0),
    };
  }
  function renderReply() {
    if (!reply || !terminal?.buffer?.active) return;
    const buffer = terminal.buffer.active;
    if (buffer.type === 'alternate') {
      if (!direct) { setDirect(true); connectionMessage('交互程序已打开，已切换到终端。可随时点「聊天」返回。'); }
      return;
    }
    const stick = nearBottom(), end = buffer.baseY + buffer.cursorY;
    // xterm markers track line positions through resize and scrollback eviction.
    if (reply.marker) reply.start = reply.marker.isDisposed ? 0 : reply.marker.line;
    let text = '';
    const first = Math.max(reply.start, end - 300);
    for (let i = first; i <= end; i++) {
      const line = buffer.getLine(i); if (!line) continue;
      if (i > first && !line.isWrapped) text += '\n';
      text += line.translateToString(true);
    }
    if (first === reply.start && text.startsWith(reply.prefix)) text = text.slice(reply.prefix.length);
    const echo = reply.echo.replace(/\r\n?/g, '\n');
    if (reply.secret && echo && text && !text.includes('\n') && echo.startsWith(text)) return;
    if (echo && text.startsWith(echo + '\n')) text = text.slice(echo.length + 1);
    // A password can be echoed after banners, split across frames, or arrive
    // after another command. Never publish even a trailing partial match.
    for (const secret of secrets) {
      text = text.split(secret).join('［隐藏输入］');
      for (let size = Math.min(secret.length - 1, text.length); size > 0; size--) {
        if (text.endsWith(secret.slice(0, size))) { text = text.slice(0, -size) + '［隐藏输入］'; break; }
      }
    }
    text = text.replace(/^\n+/, '');
    const clipped = first > reply.start || text.length > 48000;
    text = text.slice(-48000).replace(/^[\uDC00-\uDFFF]/, '');
    if (text) reply.bubble.textContent = (clipped ? '［较早输出已省略］\n' : '') + text;
    if (text) notify('output', { text: reply.bubble.textContent });
    if (stick) latest();
    else { unread = true; $('scroll-bottom').textContent = '↓ 新回复'; }
  }
  function writeOutput(bytes) {
    const current = generation;
    terminal.write(bytes, () => { if (current === generation) renderReply(); });
  }
  function finishConnection(text = '已断开', state = 'idle') {
    clearTimeout(connectionTimer);
    ready = false; socket = null; started = 0; toggleCtrl(false);
    $('mobile-input').value = ''; mobileComposing = false;
    document.body.classList.remove('connected', 'focused');
    $('focus-mode').setAttribute('aria-pressed', 'false');
    $('mobile-input').type = 'text'; $('mobile-input').hidden = true; $('command-editor').hidden = false;
    $('secret-input').setAttribute('aria-pressed', 'false'); $('secret-input').textContent = '密码模式';
    $('session-clock').textContent = 'SESSION —';
    direct = false; setExpanded(false); setDirect(false);
    $('connection-details').open = true; status(text, state); updateControls(); viewport();
  }
  function disconnect() {
    generation += 1;
    const old = socket;
    if (old?.readyState === WebSocket.OPEN) old.send(JSON.stringify({ type: 'disconnect' }));
    old?.close(1000, 'User disconnected'); finishConnection();
  }
  function saveTarget(target) {
    if (!workspaceMode) notify('target', { target: $('remember-target').checked ? target : null });
  }
  function restoreTarget() {
    if (params.has('host') && params.has('username') && params.has('port')) {
      $('host').value = params.get('host'); $('username').value = params.get('username'); $('port').value = params.get('port'); $('remember-target').checked = true;
    }
  }
  $('logout').addEventListener('click', async () => {
    location.href = '/terminal/';
  });
  $('connect-form').addEventListener('submit', async event => {
    event.preventDefault(); if (socket || disposed) return;
    if (!authenticated) {
      try { await api('session'); updateAuthentication(true); }
      catch (error) { connectionMessage(error.message); return; }
    }
    connectionMessage('');
    const target = { host: $('host').value.trim(), username: $('username').value.trim(), port: Number($('port').value) };
    if (!workspaceMode && (!target.host || !target.username || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535)) { connectionMessage('请填写有效的地址、用户名和端口。'); return; }
    if (!initializeTerminal()) return;
    const current = ++generation;
    $('connection-fields').disabled = true;
    try {
      const info = await api('session');
      if (info.activeConnections >= 8) { connectionMessage('此账号已连接 8 个终端，请先关闭其他页面中不再使用的连接。'); status('连接已达上限', 'error'); updateControls(); return; }
    }
    catch (error) { if (error.status === 401) updateAuthentication(false); updateControls(); connectionMessage(error.message || '账号登录已过期，请返回终端首页重新登录。'); status('连接失败', 'error'); return; }
    if (current !== generation || !authenticated) return;
    saveTarget(target); reply?.marker?.dispose(); reply = null; terminal.reset(); secrets.length = 0;
    unread = false;
    $('terminal-empty').hidden = true;
    $('target-label').textContent = workspaceMode ? '我的工作区 · 普通用户' : `${target.username}@${target.host}:${target.port}`;
    document.body.classList.add('connected');
    if (window.matchMedia('(max-width:700px)').matches) $('connection-details').open = false;
    let ws;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${BASE}/ws`); }
    catch { connectionMessage('浏览器无法建立终端连接。'); finishConnection('连接失败', 'error'); return; }
    socket = ws; status('创建沙箱…', 'connecting'); updateControls();
    connectionTimer = setTimeout(() => { if (current === generation && !ready) { connectionMessage('连接超时，请检查服务状态后重新连接。'); ws.close(); } }, 25000);
    let lastError = '';
    ws.onopen = () => {
      if (current !== generation) { ws.close(); return; }
      try { fit.fit(); } catch { /* Retain default terminal dimensions. */ }
      const cols = Math.max(10, Math.min(400, terminal.cols)), rows = Math.max(2, Math.min(150, terminal.rows));
      send(workspaceMode ? { type: 'workspace', cols, rows } : { type: 'connect', ...target, cols, rows });
    };
    ws.onmessage = event => {
      if (current !== generation) return;
      let message;
      try { message = JSON.parse(event.data); }
      catch { lastError = '服务器返回了无效的数据。'; ws.close(); return; }
      if (message.type === 'ready') {
        clearTimeout(connectionTimer);
        ready = true; started = Date.now(); status('会话已就绪', 'ready'); updateControls();
        addBubble('received', workspaceMode ? '工作区已打开，可以直接发送命令。文件按账号保存；默认离线，每次连接最长 1 小时，断开后进程结束。' : '连接已建立。请完成 SSH 登录；输入密码前点「密码模式」。');
        startReply();
        scheduleFit(); inputFocus();
      } else if (message.type === 'output') {
        try { writeOutput(Uint8Array.from(atob(message.data), c => c.charCodeAt(0))); }
        catch { lastError = '终端输出解析失败。'; ws.close(); }
      } else if (message.type === 'error') {
        lastError = String(message.message); connectionMessage(lastError);
        addBubble('received', lastError);
        terminal.writeln(`\r\n[STRGO] ${lastError.replace(/[\x00-\x1f\x7f]/g, '')}`); ws.close();
      } else if (message.type === 'exit') {
        const label = workspaceMode ? '工作区' : 'SSH';
        addBubble('received', `${label}已退出（${Number(message.code)}）。重新连接即可继续。`);
        terminal.writeln(`\r\n[STRGO] ${label}已退出 (${Number(message.code)})，沙箱正在销毁。`); ws.close();
      }
    };
    ws.onerror = () => { if (current === generation) { lastError = '连接失败，请检查网络或终端服务状态。'; connectionMessage(lastError); } };
    ws.onclose = () => {
      if (current !== generation) return;
      finishConnection(lastError ? '连接结束' : '已断开', lastError ? 'error' : 'idle');
      addBubble('received', workspaceMode ? '连接已关闭。工作区文件保留，重新连接不会自动执行之前的命令。' : '连接已关闭。聊天记录仅保留在当前页面；远端任务可使用 tmux 保留。');
      terminal.writeln('\r\n[STRGO] 连接已关闭。重新连接会创建新的沙箱。');
    };
    scheduleFit();
  });
  $('disconnect').addEventListener('click', disconnect);
  $('keys').addEventListener('pointerdown', event => {
    if (event.target.closest('button')) event.preventDefault();
  });
  $('keys').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.id === 'copy-selection') {
      const selected = terminal?.getSelection?.() || window.getSelection?.()?.toString();
      if (selected) copyText(selected);
      else connectionMessage('请先选中终端或聊天中的文字，再点复制选区。');
      return;
    }
    if (button.id === 'font-size') {
      const next = (terminal?.options.fontSize || 13) >= 18 ? 11 : (terminal?.options.fontSize || 13) + 1;
      if (terminal) terminal.options.fontSize = next;
      document.documentElement.style.setProperty('--chat-font-size', `${next}px`); scheduleFit(); return;
    }
    if (button.id === 'ctrl-key') { toggleCtrl(); inputFocus(); return; }
    if (button.id === 'more-keys') {
      const show = $('extra-keys').hidden; $('extra-keys').hidden = !show;
      document.body.classList.toggle('tools-open', show);
      button.setAttribute('aria-expanded', String(show)); scheduleFit(); return;
    }
    if (button.id === 'keyboard-toggle') {
      if (document.activeElement === activeEditor() || $('terminal').contains(document.activeElement)) document.activeElement.blur();
      else if (direct) terminal?.focus(); else editorFocus();
      return;
    }
    if (button.id === 'scroll-bottom') { latest(true); return; }
    if (button.dataset.insert !== undefined) { insertText(button.dataset.insert); return; }
    if (button.dataset.key) {
      if (mobileComposing) return;
      const key = button.dataset.key, editor = activeEditor();
      if (editKey(key)) return;
      if (key === 'enter' && !direct && editor.value) { submitMobile(); return; }
      if (key === 'tab' && !direct && editor.value) {
        if (!sendInput(editor.value)) return;
        editor.value = ''; growEditor();
        if (!direct) setDirect(true);
      }
      if (key === 'interrupt') { $('mobile-input').value = ''; $('command-editor').value = ''; growEditor(); }
      sendInput(KEYS[key]); toggleCtrl(false); inputFocus();
    }
  });
  $('paste').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('unavailable');
      insertText(await navigator.clipboard.readText());
    } catch { connectionMessage('可长按输入框，使用系统菜单粘贴。'); if (direct) setDirect(false); editorFocus(); }
  });
  const mobile = $('mobile-input'), editor = $('command-editor');
  $('secret-input').addEventListener('click', () => {
    if (mobileComposing) return;
    const masked = mobile.type !== 'password';
    mobile.value = ''; editor.value = ''; mobile.type = masked ? 'password' : 'text';
    mobile.hidden = !masked; editor.hidden = masked;
    $('secret-input').setAttribute('aria-pressed', String(masked));
    $('secret-input').textContent = masked ? '退出密码' : '密码模式';
    $('editor-hint').textContent = masked ? '密码以圆点显示，不写入聊天记录或浏览器存储' : CHAT_HINT;
    updateControls(); growEditor(); editorFocus();
  });
  for (const input of [mobile, editor]) {
    input.addEventListener('compositionstart', () => { mobileComposing = true; });
    input.addEventListener('compositionend', () => { mobileComposing = false; growEditor(); });
    input.addEventListener('input', () => {
      growEditor();
      if (ctrl && !mobileComposing && input.value.length === 1) {
        const code = input.value.toUpperCase().charCodeAt(0);
        if (code >= 64 && code <= 95 && sendInput(String.fromCharCode(code & 31))) { input.value = ''; toggleCtrl(false); }
      }
    });
    input.addEventListener('keydown', event => {
      if (event.isComposing || mobileComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' && (input === mobile || event.ctrlKey || event.metaKey)) { event.preventDefault(); submitMobile(); }
    });
  }
  editor.addEventListener('paste', event => {
    const text = event.clipboardData?.getData('text/plain');
    if (text !== undefined && !mobileComposing) { event.preventDefault(); insertText(text); }
  });
  function submitMobile() {
    if (!ready || mobileComposing || direct) return;
    const input = activeEditor(), text = input.value, secret = input === mobile && mobile.type === 'password';
    if (!text && !secret) return;
    // Use xterm's bracketed paste handling, then send Enter to execute or submit.
    lastInputAccepted = false;
    if (secret) {
      if (text) { secrets.push(text); if (secrets.length > 32) secrets.shift(); }
      lastInputAccepted = sendInput(text);
    }
    else terminal.paste(text.replace(/\r\n?/g, '\n'));
    if (text && !lastInputAccepted) return;
    if (!sendInput('\r')) return;
    addBubble('sent', secret ? '［密码已发送］' : text, secret);
    startReply(text, secret);
    input.value = ''; toggleCtrl(false); growEditor(); editorFocus(); latest();
  }
  $('submit-input').addEventListener('pointerdown', event => event.preventDefault());
  $('submit-input').addEventListener('click', submitMobile);
  $('expand-editor').addEventListener('pointerdown', event => event.preventDefault());
  $('expand-editor').addEventListener('click', () => setExpanded(!expanded));
  function setMobileTools(value) {
    mobileTools = value;
    document.body.classList.toggle('mobile-tools-open', value);
    $('mobile-tools-toggle').setAttribute('aria-expanded', String(value));
    $('mobile-tools-toggle').textContent = value ? '−' : '＋';
    if (!value && document.body.classList.contains('tools-open')) {
      document.body.classList.remove('tools-open'); $('extra-keys').hidden = true;
      $('more-keys').setAttribute('aria-expanded', 'false');
    }
    scheduleFit();
  }
  for (const id of ['session-list-toggle', 'mobile-tools-toggle', 'session-connect']) $(id).addEventListener('pointerdown', event => event.preventDefault());
  $('session-list-toggle').addEventListener('click', () => notify('sessions'));
  $('mobile-tools-toggle').addEventListener('click', () => setMobileTools(!mobileTools));
  $('session-connect').addEventListener('click', () => { if (!socket) $('connect-form').requestSubmit(); });
  $('edit-mode').addEventListener('click', () => setDirect(false));
  $('direct-mode').addEventListener('click', () => setDirect(true));
  $('focus-mode').addEventListener('click', () => {
    const focused = document.body.classList.toggle('focused');
    $('focus-mode').setAttribute('aria-pressed', String(focused));
    $('focus-mode').textContent = focused ? '返回' : '专注'; viewport();
  });
  async function copyText(text) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unavailable');
      await navigator.clipboard.writeText(text); return true;
    } catch {
      if (document.execCommand) {
        const field = document.createElement('textarea'); field.value = text;
        field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.append(field); field.select();
        try { if (document.execCommand('copy')) return true; }
        catch { /* Keep native text selection available when legacy copy fails. */ }
        finally { field.remove(); }
      }
      connectionMessage('请长按或选中消息文本，使用系统菜单复制。'); return false;
    }
  }
  $('chat-log').addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    const text = messages.get(button.dataset.copy || button.dataset.reuse)?.textContent;
    if (!text) return;
    if (button.dataset.reuse) {
      if (!ready) return;
      if (direct) setDirect(false);
      if (mobile.type === 'password') $('secret-input').click();
      insertText(text); return;
    }
    if (await copyText(text)) button.textContent = '已复制';
  });
  $('chat-log').addEventListener('scroll', () => { if (unread && nearBottom()) latest(); }, { passive: true });
  $('connection-details').addEventListener('toggle', scheduleFit);
  function viewport() {
    const visual = window.visualViewport;
    // iOS only adjusts the top-level visual viewport for the keyboard. An
    // embedded session must use its already-sized iframe, never subtract again.
    const height = Math.max(1, Math.round(embedded ? window.innerHeight : visual?.height || window.innerHeight));
    const compact = parentViewport ? parentViewport.compact : params.get('compact') === '1' || window.matchMedia(compactQuery).matches;
    const keyboard = parentViewport ? parentViewport.keyboard : (visual?.scale || 1) === 1 && Math.max(window.innerHeight, document.documentElement.clientHeight || 0) - (visual?.height || window.innerHeight) > 100;
    document.body.classList.toggle('compact-mobile', compact);
    document.body.classList.toggle('keyboard-open', keyboard);
    $('composer-body').hidden = direct && !compact;
    document.documentElement.style.setProperty('--viewport-height', `${height}px`);
    document.documentElement.style.setProperty('--viewport-top', `${embedded ? 0 : Math.max(0, Math.round(visual?.offsetTop || 0))}px`);
    if (nearBottom()) latest(); growEditor(); scheduleFit();
  }
  window.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('scroll', viewport);
  window.addEventListener('orientationchange', viewport);
  window.addEventListener('pagehide', () => { socket?.close(); });
  window.addEventListener('message', event => {
    if (!embedded || event.origin !== location.origin || event.source !== window.parent || event.data?.source !== 'strgo-workspace') return;
    const action = event.data.action;
    if (action === 'viewport') {
      const state = event.data.viewport;
      if (state && typeof state.compact === 'boolean' && typeof state.keyboard === 'boolean') {
        parentViewport = { compact: state.compact, keyboard: state.keyboard }; viewport();
      }
    } else if (action === 'dismiss-keyboard') { document.activeElement?.blur(); setMobileTools(false); }
    else if (action === 'activate') { visible = true; viewport(); }
    else if (action === 'deactivate') {
      visible = false; $('mobile-input').value = '';
      if ($('mobile-input').type === 'password') $('secret-input').click();
      document.activeElement?.blur();
    } else if (action === 'connect') {
      if (!socket) { $('connection-details').open = true; $('connect-form').requestSubmit(); }
    } else if (action === 'clear') {
      reply?.marker?.dispose(); reply = null; messages.clear();
      $('chat-log').replaceChildren(); $('chat-log').classList.remove('has-messages');
      if (ready) startReply();
    } else if (action === 'export') {
      const lines = ['STRGO 终端聊天 · ' + new Date().toISOString(), '仅导出当前页面保留的最近 120 条消息，每条约最近 300 行。不是完整会话日志。', ''];
      for (const text of messages.values()) lines.push(text.textContent, '');
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `terminal-${Date.now()}.txt`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (action === 'dispose') {
      disposed = true; disconnect(); terminal?.dispose(); secrets.length = 0; messages.clear(); $('chat-log').replaceChildren(); $('command-editor').value = '';
    }
  });
  setInterval(() => {
    if (started) { const seconds = Math.floor((Date.now() - started) / 1000); $('session-clock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} / 默认 60 分钟`; }
  }, 1000);
  if (embedded) document.body.classList.add('embedded');
  if (workspaceMode) {
    document.body.classList.add('workspace-mode');
    $('secret-input').hidden = true;
    $('host').required = $('username').required = $('port').required = false;
  }
  restoreTarget(); viewport();
  notify('viewport-ready');
  api('session').then(() => {
    if (disposed) return;
    updateAuthentication(true); updateControls();
    if (workspaceMode && params.get('auto') === '1') $('connect-form').requestSubmit();
    else if (workspaceMode) { status('待连接'); connectionMessage('点击上方「连接」打开工作区，之前的命令不会自动执行。'); }
  }).catch(error => { updateAuthentication(false); updateControls(); connectionMessage(error.message); });
})();
