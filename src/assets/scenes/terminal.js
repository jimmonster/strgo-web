(() => {
  const config = JSON.parse(document.querySelector('#site-config').textContent);
  const status = document.querySelector('#terminal-status'), detail = document.querySelector('#terminal-detail'), link = document.querySelector('#terminal-open');
  const raw = config.TERMINAL_TARGET_URL;
  if (!raw) {
    status.textContent = '终端目标尚未配置';
    detail.textContent = '请在 site.json 中填写 TERMINAL_TARGET_URL，重新构建后即可打开已有终端。'; return;
  }
  try {
    const target = new URL(raw, location.href);
    const normalize = path => decodeURIComponent(path).replace(/\/{2,}/g, '/').replace(/\/index\.html\/?$/, '').replace(/\/+$/, '');
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('invalid');
    if (target.origin === location.origin && (normalize(target.pathname) === '/terminal' || normalize(target.pathname) === normalize(location.pathname))) {
      status.textContent = '当前站点尚未接上已有终端服务';
      detail.textContent = '目标与此入口为同一页面，已阻止循环打开。请检查现有终端的反向代理，或配置独立的真实目标地址。'; return;
    }
    status.textContent = '继续进入已有终端'; link.href = target.href; link.hidden = false;
    detail.textContent = '终端沿用原有登录与访问权限。点击后将在当前窗口打开；本页不会自动建立 SSH 连接。';
  } catch {
    status.textContent = '终端目标配置无效'; detail.textContent = '请填写有效的 HTTP(S) 地址或站内绝对路径。';
  }
})();
