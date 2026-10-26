import { escapeHTML as esc, filterEntries, requestJSON, readPreferences, writePreferences } from './catalog.js';
import { icon } from './icons.js';

const assets = new URL('./', import.meta.url);
class SiteNavigation extends HTMLElement {
  connectedCallback() {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<link rel="stylesheet" href="${new URL('site-navigation.css', assets)}"><button class="trigger" aria-label="切换 STRGO 功能" aria-haspopup="dialog" aria-expanded="false">${icon('mark')}<span class="label">全部功能</span></button>
      <dialog aria-label="STRGO 功能切换"><div class="head"><h2>下一站，去哪里？</h2><button class="close" aria-label="关闭功能切换">${icon('close')}</button></div><label class="search">${icon('search')}<input type="search" aria-label="搜索功能与空间" placeholder="搜索功能、空间或路径"></label><div class="results" role="status" aria-live="polite"></div><div class="footer"><a href="/hub/">统一主页</a><a href="/classic/">经典主页</a></div><p class="hint">Ctrl / ⌘ K 打开 · ↑ ↓ 选择 · Enter 进入 · Esc 关闭</p><p class="feedback" role="status"></p></dialog>`;
      this.dialog = root.querySelector('dialog'); this.input = root.querySelector('input'); this.results = root.querySelector('.results');
      this.trigger = root.querySelector('.trigger'); this.feedback = root.querySelector('.feedback');
      this.trigger.onclick = () => this.open();
      root.querySelector('.close').onclick = () => this.dialog.close();
      this.dialog.addEventListener('close', () => { this.controller?.abort(); this.trigger.setAttribute('aria-expanded', 'false'); this.trigger.focus(); });
      this.dialog.addEventListener('click', event => { if (event.target === this.dialog) this.dialog.close(); });
      this.input.oninput = () => this.renderResults();
      this.results.addEventListener('click', event => {
        const favorite = event.target.closest('[data-fav]'), entry = event.target.closest('[data-entry]');
        if (favorite) {
          const id = favorite.dataset.fav;
          this.preferences.favs = this.preferences.favs.includes(id) ? this.preferences.favs.filter(value => value !== id) : [...this.preferences.favs, id];
          this.save(); this.renderResults(); this.results.querySelector(`[data-fav="${id}"]`)?.focus();
        } else if (entry) {
          this.preferences.recent = [entry.dataset.entry, ...this.preferences.recent.filter(id => id !== entry.dataset.entry)].slice(0, 8); this.save();
        }
      });
      this.dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.dialog.close(); return; }
        const links = [...this.results.querySelectorAll('a')], at = links.indexOf(root.activeElement);
        if (['ArrowDown', 'ArrowUp'].includes(event.key) && links.length) {
          event.preventDefault(); const step = event.key === 'ArrowDown' ? 1 : -1;
          links[at < 0 ? (step === 1 ? 0 : links.length - 1) : (at + step + links.length) % links.length].focus();
        } else if (event.key === 'Enter' && root.activeElement === this.input && links[0]) { event.preventDefault(); links[0].click(); }
      });
      this.keyHandler = event => {
        if (this.dataset.shortcuts === 'off' || this.dialog.open || event.defaultPrevented) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) { event.preventDefault(); this.open(); }
      };
      this.hideHandler = () => { this.controller?.abort(); this.entries = []; this.role = 'guest'; this.results.replaceChildren(); this.dialog.close(); };
      this.visibilityHandler = () => { if (document.hidden && this.dialog.open) this.hideHandler(); };
    }
    document.addEventListener('keydown', this.keyHandler); window.addEventListener('pagehide', this.hideHandler); document.addEventListener('visibilitychange', this.visibilityHandler);
  }
  disconnectedCallback() { this.controller?.abort(); document.removeEventListener('keydown', this.keyHandler); window.removeEventListener('pagehide', this.hideHandler); document.removeEventListener('visibilitychange', this.visibilityHandler); }
  save() {
    try { writePreferences(localStorage, this.userId, this.preferences, this.entries); }
    catch { this.feedback.textContent = '此浏览器无法保存偏好，本次操作仍然有效。'; }
  }
  async open() {
    if (this.dialog.open) return;
    this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    this.entries = []; this.role = 'guest'; this.input.value = ''; this.feedback.textContent = '';
    this.results.textContent = '正在读取功能目录…'; this.dialog.showModal(); this.trigger.setAttribute('aria-expanded', 'true'); this.input.focus();
    try {
      const [registry, session] = await Promise.all([
        fetch(new URL('registry.json', assets), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: 'no-cache' }).then(response => { if (!response.ok) throw new Error(); return response.json(); }),
        this.dataset.session === 'none' ? { user: null } : requestJSON('/api/image/session', { signal: controller.signal }).catch(() => ({ user: null }))
      ]);
      if (controller.signal.aborted || !this.isConnected || !this.dialog.open) return;
      this.entries = registry.entries; this.role = session.user?.role || 'guest'; this.userId = session.user?.id;
      let storage; try { storage = localStorage; } catch { /* Read fallback is in the shared preference contract. */ }
      this.preferences = readPreferences(storage, this.userId, this.entries);
      const origin = registry.navigationOrigin || '';
      this.shadowRoot.querySelector('.footer a').href = origin + '/hub/';
      this.shadowRoot.querySelector('.footer a:last-child').href = origin + '/classic/';
      this.renderResults();
    } catch { if (!controller.signal.aborted) this.results.textContent = '暂时无法读取目录，请通过下方链接打开主页。'; }
  }
  renderResults() {
    if (!this.preferences) return;
    const matches = filterEntries(this.entries, { role: this.role, query: this.input.value });
    this.results.innerHTML = matches.map(entry => `<div class="result"><a href="${esc(entry.route)}" data-entry="${entry.id}" ${entry.id === 'C05' ? 'target="_blank" rel="noopener noreferrer"' : ''}>${icon(entry.type)}<span>${esc(entry.name)}<small>${esc(entry.group)}</small></span>${icon('arrow')}</a><button class="fav ${this.preferences.favs.includes(entry.id) ? 'on' : ''}" data-fav="${entry.id}" aria-pressed="${this.preferences.favs.includes(entry.id)}" aria-label="${this.preferences.favs.includes(entry.id) ? '取消收藏' : '收藏'}${esc(entry.name)}">${icon('star')}</button></div>`).join('') || '<p class="hint">没有匹配结果，试试其他关键词。</p>';
  }
}
if (!customElements.get('strgo-navigation')) customElements.define('strgo-navigation', SiteNavigation);
