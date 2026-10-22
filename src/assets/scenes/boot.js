// Keep the loading/error shell usable even when an ES module fails to download.
(() => {
  const loading = document.querySelector('#scene-loading'), error = document.querySelector('#scene-error');
  document.querySelector('[data-action="retry"]').addEventListener('click', () => location.reload());
  const showError = message => {
    if (document.body.dataset.state === 'ready') return;
    loading.hidden = true; error.hidden = false; document.body.dataset.state = 'error';
    document.querySelector('#scene-error-detail').textContent = message;
  };
  const timeout = setTimeout(() => showError('场景加载超时，请检查网络后重试。'), 25000);
  import('./runtime.js').then(module => module.start()).catch(() => showError('三维模块加载失败，浏览器可能不支持 WebGL 或资源暂时不可用。')).finally(() => clearTimeout(timeout));
})();
