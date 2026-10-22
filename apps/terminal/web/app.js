(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const BASE = '/terminal';
  const KEYS = { esc: '\x1b', tab: '\t', interrupt: '\x03', up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C', enter: '\r' };
  const STORAGE_KEY = 'strgo-terminal-target';
  let authenticated = false, socket = null, ready = false, ctrl = false;
  let generation = 0, started = 0, resizeTimer = null, terminal = null, fit = null;
  let mobileComposing = false;
  const encoder = new TextEncoder();

  function status(text, state = 'idle') { $('status').textContent = text; $('status').dataset.state = state; }
  function connectionMessage(text) { $('connect-message').textContent = text; }
  function updateAuthentication(value) {
    authenticated = value;
    $('access-panel').hidden = value;
    $('logout').hidden = !value;
    $('connection-fields').disabled = !value;
    if (!value) $('connection-details').open = true;
  }
  function updateControls() {
    $('connection-fields').disabled = !authenticated || socket !== null;
    $('disconnect').disabled = socket === null;
    $('mobile-input').disabled = !ready;
    $('submit-input').disabled = !ready;
    $('secret-input').disabled = !ready;
    for (const button of $('keys').querySelectorAll('button')) {
      if (button.id !== 'font-size') button.disabled = !ready;
    }
  }
  async function api(path, body) {
    const response = await fetch(`${BASE}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `请求失败 (${response.status})`);
    return data;
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
    terminal.onData(data => {
      if (ctrl && data.length === 1) {
        const code = data.toUpperCase().charCodeAt(0);
        if (code >= 64 && code <= 95) data = String.fromCharCode(code & 31);
        toggleCtrl(false);
      }
      sendInput(data);
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
    socket.send(JSON.stringify(message)); return true;
  }
  function sendInput(data) {
    if (!ready || !data) return;
    if (data.length > 64 * 1024) { connectionMessage('请把大段文本分为 64 KB 以下的片段。'); return; }
    if (socket?.bufferedAmount > 256 * 1024) { connectionMessage('输入发送较慢，请稍后继续。'); return; }
    // Split on Unicode characters, not UTF-16 offsets, and keep each packet below 8 KiB.
    let part = '', bytes = 0;
    for (const character of data) {
      const count = encoder.encode(character).length;
      if (bytes + count > 4096) { send({ type: 'input', data: part }); part = ''; bytes = 0; }
      part += character; bytes += count;
    }
    if (part) send({ type: 'input', data: part });
  }
  function toggleCtrl(value = !ctrl) { ctrl = value; $('ctrl-key').setAttribute('aria-pressed', String(ctrl)); }
  function inputFocus() {
    if (window.matchMedia('(pointer:coarse)').matches) $('mobile-input').focus({ preventScroll: true });
    else terminal?.focus();
  }
  function finishConnection(text = '已断开', state = 'idle') {
    ready = false; socket = null; started = 0; toggleCtrl(false);
    $('mobile-input').value = ''; document.body.classList.remove('connected');
    $('mobile-input').type = 'text'; $('secret-input').setAttribute('aria-pressed', 'false');
    $('session-clock').textContent = 'SESSION —';
    $('connection-details').open = true; status(text, state); updateControls(); scheduleFit();
  }
  function disconnect() {
    generation += 1;
    const old = socket;
    if (old?.readyState === WebSocket.OPEN) old.send(JSON.stringify({ type: 'disconnect' }));
    old?.close(1000, 'User disconnected'); finishConnection();
  }
  function saveTarget(target) {
    try {
      if ($('remember-target').checked) localStorage.setItem(STORAGE_KEY, JSON.stringify({ host: target.host, port: target.port, username: target.username }));
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* Storage can be disabled in private browsing. */ }
  }
  function restoreTarget() {
    try {
      const target = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (target && typeof target.host === 'string' && typeof target.username === 'string' && Number.isInteger(target.port)) {
        $('host').value = target.host; $('username').value = target.username; $('port').value = target.port; $('remember-target').checked = true;
      }
    } catch { /* Ignore stale or unavailable storage. */ }
  }

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); $('login-message').textContent = ''; $('login-button').disabled = true;
    const token = $('access-token').value;
    $('access-token').value = '';
    try { await api('login', { token }); updateAuthentication(true); updateControls(); $('host').focus(); }
    catch (error) { $('login-message').textContent = error.message; }
    finally { $('login-button').disabled = false; }
  });
  $('logout').addEventListener('click', async () => {
    $('logout').disabled = true;
    try { await api('logout', {}); disconnect(); updateAuthentication(false); updateControls(); }
    catch (error) { connectionMessage(error.message); }
    finally { $('logout').disabled = false; }
  });
  $('connect-form').addEventListener('submit', async event => {
    event.preventDefault(); if (socket || !authenticated) return;
    connectionMessage('');
    const target = { host: $('host').value.trim(), username: $('username').value.trim(), port: Number($('port').value) };
    if (!target.host || !target.username || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) { connectionMessage('请填写有效的地址、用户名和端口。'); return; }
    if (!initializeTerminal()) return;
    const current = ++generation;
    $('connection-fields').disabled = true;
    try { await api('session'); }
    catch { updateAuthentication(false); updateControls(); connectionMessage('登录已过期，请重新输入访问口令。'); return; }
    if (current !== generation || !authenticated) return;
    saveTarget(target); terminal.reset(); $('terminal-empty').hidden = true;
    $('target-label').textContent = `${target.username}@${target.host}:${target.port}`;
    document.body.classList.add('connected');
    if (window.matchMedia('(max-width:700px)').matches) $('connection-details').open = false;
    let ws;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${BASE}/ws`); }
    catch { connectionMessage('浏览器无法建立终端连接。'); finishConnection('连接失败', 'error'); return; }
    socket = ws; status('创建沙箱…', 'connecting'); updateControls();
    let lastError = '';
    ws.onopen = () => {
      if (current !== generation) { ws.close(); return; }
      try { fit.fit(); } catch { /* Retain default terminal dimensions. */ }
      const cols = Math.max(10, Math.min(400, terminal.cols)), rows = Math.max(2, Math.min(150, terminal.rows));
      send({ type: 'connect', ...target, cols, rows });
    };
    ws.onmessage = event => {
      if (current !== generation) return;
      let message;
      try { message = JSON.parse(event.data); }
      catch { lastError = '服务器返回了无效的数据。'; ws.close(); return; }
      if (message.type === 'ready') {
        ready = true; started = Date.now(); status('会话已就绪', 'ready'); updateControls();
        terminal.write('\x1b[38;2;115;237;184m[STRGO] 独立沙箱已创建。请按 SSH 提示完成登录。\x1b[0m\r\n\r\n');
        scheduleFit(); inputFocus();
      } else if (message.type === 'output') {
        try { terminal.write(Uint8Array.from(atob(message.data), c => c.charCodeAt(0))); }
        catch { lastError = '终端输出解析失败。'; ws.close(); }
      } else if (message.type === 'error') {
        lastError = String(message.message); connectionMessage(lastError);
        terminal.writeln(`\r\n[STRGO] ${lastError.replace(/[\x00-\x1f\x7f]/g, '')}`); ws.close();
      } else if (message.type === 'exit') {
        terminal.writeln(`\r\n[STRGO] SSH 已退出 (${Number(message.code)})，沙箱正在销毁。`); ws.close();
      }
    };
    ws.onerror = () => { if (current === generation) { lastError = '连接失败，请检查网络或终端服务状态。'; connectionMessage(lastError); } };
    ws.onclose = () => {
      if (current !== generation) return;
      finishConnection(lastError ? '连接结束' : '已断开', lastError ? 'error' : 'idle');
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
    if (button.id === 'font-size') { if (terminal) { terminal.options.fontSize = terminal.options.fontSize >= 18 ? 11 : terminal.options.fontSize + 1; scheduleFit(); } return; }
    if (button.id === 'ctrl-key') { toggleCtrl(); inputFocus(); return; }
    if (button.dataset.key) {
      if (button.dataset.key === 'enter' && $('mobile-input').value) { submitMobile(); return; }
      if (button.dataset.key === 'tab' && $('mobile-input').value) { sendInput($('mobile-input').value); $('mobile-input').value = ''; }
      if (button.dataset.key === 'interrupt') $('mobile-input').value = '';
      sendInput(KEYS[button.dataset.key]); toggleCtrl(false); inputFocus();
    }
  });
  $('paste').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('unavailable');
      const text = await navigator.clipboard.readText();
      if (text.length > 64 * 1024) { connectionMessage('请把大段文本分为 64 KB 以下的片段。'); return; }
      if (ready && text) terminal.paste(text);
    } catch { connectionMessage('可长按下方输入框，使用系统菜单粘贴。'); $('mobile-input').focus(); }
  });
  const mobile = $('mobile-input');
  $('secret-input').addEventListener('click', () => {
    const masked = mobile.type !== 'password'; mobile.type = masked ? 'password' : 'text';
    $('secret-input').setAttribute('aria-pressed', String(masked)); mobile.focus({ preventScroll: true });
  });
  mobile.addEventListener('compositionstart', () => { mobileComposing = true; });
  mobile.addEventListener('compositionend', () => { mobileComposing = false; });
  mobile.addEventListener('input', () => {
    if (ctrl && !mobileComposing && mobile.value.length === 1) {
      const code = mobile.value.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) { sendInput(String.fromCharCode(code & 31)); mobile.value = ''; toggleCtrl(false); }
    }
  });
  function submitMobile() {
    if (!ready || mobileComposing) return;
    sendInput(mobile.value + '\r'); mobile.value = ''; toggleCtrl(false); mobile.focus({ preventScroll: true });
  }
  mobile.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && !mobileComposing) { event.preventDefault(); submitMobile(); }
  });
  $('submit-input').addEventListener('click', submitMobile);
  $('connection-details').addEventListener('toggle', scheduleFit);
  function viewport() {
    document.documentElement.style.setProperty('--viewport-height', `${Math.round(window.visualViewport?.height || window.innerHeight)}px`); scheduleFit();
  }
  window.addEventListener('resize', viewport); window.visualViewport?.addEventListener('resize', viewport);
  window.addEventListener('pagehide', () => { socket?.close(); });
  setInterval(() => {
    if (started) { const seconds = Math.floor((Date.now() - started) / 1000); $('session-clock').textContent = `SESSION ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
  }, 1000);
  restoreTarget(); viewport();
  api('session').then(() => { updateAuthentication(true); updateControls(); }).catch(() => { updateAuthentication(false); updateControls(); });
})();
