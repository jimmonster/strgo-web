import { escapeHTML, filterEntries, requestJSON } from '/hub/core.js';

// Explicit inline slots keep the switcher out of terminal input and scene controls.
class SiteNavigation extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<link rel="stylesheet" href="/shared/site-navigation.css"><button class="trigger" aria-label="切换 STRGO 功能" aria-haspopup="dialog">⊞ <span class="label">全部功能</span></button>
    <dialog aria-label="STRGO 功能切换"><div class="head"><h2>下一站，去哪里？</h2><button class="close" aria-label="关闭功能切换">×</button></div><input type="search" aria-label="搜索功能与空间" placeholder="搜索功能、空间或路径"><div class="results" role="status"></div><div class="footer"><a href="/hub/">统一主页 ↗</a><a href="/classic/">经典主页 ↗</a></div><p class="hint">Ctrl / ⌘ K 打开 · ↑ ↓ 选择 · Enter 进入 · Esc 关闭</p></dialog>`;
    this.dialog = root.querySelector('dialog');
    this.input = root.querySelector('input');
    this.results = root.querySelector('.results');
    this.role = 'guest'; this.entries = [];
    root.querySelector('.trigger').onclick = () => this.open();
    root.querySelector('.close').onclick = () => this.dialog.close();
    this.dialog.addEventListener('click', event => { if (event.target === this.dialog) this.dialog.close(); });
    this.input.oninput = () => this.renderResults();
    this.dialog.addEventListener('keydown', event => {
      const links = [...this.results.querySelectorAll('a')], at = links.indexOf(root.activeElement);
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && links.length) {
        event.preventDefault();
        const next = at < 0 ? (event.key === 'ArrowDown' ? 0 : links.length - 1) : (at + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links[next].focus();
      } else if (event.key === 'Enter' && root.activeElement === this.input && links[0]) { event.preventDefault(); links[0].click(); }
    });
    this.keyHandler = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) {
        event.preventDefault(); if (!this.dialog.open) this.open();
      }
    };
    document.addEventListener('keydown', this.keyHandler);
    this.hideHandler = () => { this.entries = []; this.role = 'guest'; this.results.replaceChildren(); this.dialog.close(); };
    window.addEventListener('pagehide', this.hideHandler);
  }
  disconnectedCallback() {
    this.controller?.abort();
    document.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('pagehide', this.hideHandler);
  }
  async open() {
    this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    this.entries = []; this.role = 'guest'; this.input.value = '';
    this.results.textContent = '正在读取功能目录…'; this.dialog.showModal(); this.input.focus();
    try {
      const [registry, session] = await Promise.all([
        fetch('/hub/registry.json', { signal: controller.signal, cache: 'no-cache' }).then(response => { if (!response.ok) throw new Error(); return response.json(); }),
        requestJSON('/api/image/session', { signal: controller.signal }).catch(() => ({ user: null }))
      ]);
      if (controller.signal.aborted || !this.isConnected) return;
      this.entries = registry.entries; this.role = session.user?.role || 'guest'; this.renderResults();
    } catch (error) { if (!controller.signal.aborted) this.results.textContent = '暂时无法读取目录，请通过下方链接打开主页。'; }
  }
  renderResults() {
    const matches = filterEntries(this.entries, { role: this.role, query: this.input.value });
    this.results.innerHTML = matches.map(entry => `<a href="${escapeHTML(entry.route)}" ${entry.id === 'C05' ? 'target="_blank" rel="noopener noreferrer"' : ''}><span>${escapeHTML(entry.symbol)}</span>${escapeHTML(entry.name)}<small>${escapeHTML(entry.group)}</small></a>`).join('') || '<p class="hint">没有匹配结果，试试其他关键词。</p>';
  }
}
if (!customElements.get('strgo-navigation')) customElements.define('strgo-navigation', SiteNavigation);
