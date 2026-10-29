import { PanoramaStore, MAX_TITLE_LENGTH } from './store.js';
import { assetPath } from './core.js';
import { requestJSON } from '../shared/catalog.js';
import { translate as t } from '../shared/i18n.js';

export function setupItems({ open, updated, removed }) {
  const $ = selector => document.querySelector(selector);
  const store = new PanoramaStore(), grid = $('#saved-items'), editor = $('#item-dialog'), deletion = $('#delete-dialog');
  let items = [], owner = null, serial = 0, editing, deleting, busy = false, message = '', error = false;
  const urls = new Set();
  const visible = item => item.kind === 'local' || (!!owner && item.owner === owner);
  function status(text, failed = false) {
    message = text; error = failed;
    $('#items-feedback').textContent = t(text); $('#items-feedback').classList.toggle('error', failed);
  }
  function render() {
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear(); grid.replaceChildren();
    const shown = items.filter(visible).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    $('#items-empty').hidden = shown.length > 0;
    for (const item of shown) {
      const card = document.createElement('article'); card.className = 'saved-item'; card.dataset.itemId = item.id;
      const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'item-preview';
      preview.setAttribute('aria-label', `${t('打开全景')} · ${item.name}`);
      if (item.kind === 'local' && item.thumbnail) {
        const image = document.createElement('img'); image.alt = ''; image.loading = 'lazy';
        image.src = URL.createObjectURL(item.thumbnail); urls.add(image.src); preview.append(image);
      } else { const label = document.createElement('span'); label.textContent = '360°'; preview.append(label); }
      preview.addEventListener('click', () => openItem(item));
      const body = document.createElement('div'); body.className = 'item-body';
      const title = document.createElement('h3'); title.textContent = item.name; title.setAttribute('data-strgo-user-content', '');
      const content = document.createElement('p'); content.className = 'item-content'; content.textContent = item.content; content.setAttribute('data-strgo-user-content', ''); content.hidden = !item.content;
      const meta = document.createElement('p'); meta.className = 'fine'; meta.textContent = `${item.width} × ${item.height} · ${t(item.kind === 'local' ? '本地图片' : 'AI 生图作品')}`;
      const actions = document.createElement('div'); actions.className = 'item-actions';
      for (const [action, label, handler] of [
        ['open', '打开全景', () => openItem(item)],
        ['edit', '编辑条目', () => { editing = item; $('#item-title').value = item.name; $('#item-content').value = item.content; $('#item-error').textContent = ''; editor.showModal(); }],
        ['delete', '删除条目', () => { deleting = item; $('#delete-name').textContent = item.name; $('#delete-error').textContent = ''; deletion.showModal(); }]
      ]) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.itemAction = action; button.textContent = t(label); button.addEventListener('click', handler); actions.append(button);
      }
      body.append(title, content, meta, actions); card.append(preview, body); grid.append(card);
    }
    status(message, error);
  }
  async function refresh() { items = await store.list(); render(); }
  async function refreshAccount() {
    const ticket = ++serial;
    clearPrivate(false);
    try {
      const session = await requestJSON('/api/image/session');
      if (ticket !== serial || document.hidden) return;
      owner = session.user?.id || null; render();
    } catch { /* Local items remain available without an account service. */ }
  }
  function clearPrivate(invalidate = true) {
    if (invalidate) serial++;
    owner = null;
    if (editing?.kind === 'ai') editor.close();
    if (deleting?.kind === 'ai') deletion.close();
    render();
  }
  async function verify(item) {
    if (item.kind === 'local') return;
    const session = await requestJSON('/api/image/session');
    if (session.user?.id !== item.owner || document.hidden) { clearPrivate(); throw new Error('账号已变化，请重新选择作品。'); }
  }
  function openItem(item) {
    // Let the viewer reserve the selection before any asynchronous file read.
    // It also checks AI ownership before requesting the protected asset.
    open({ kind: item.kind, name: item.name, content: item.content, itemId: item.id,
      ...(item.kind === 'ai' ? { url: assetPath(item.assetId), owner: item.owner } : { readFile: () => store.file(item.id) }) });
  }
  function storageError(e) {
    return e.name === 'QuotaExceededError' ? '浏览器空间不足，请删除部分条目后重试保存。' : '保存失败，请允许浏览器存储后重试。';
  }
  async function remember(source, image, account, signal) {
    let thumbnail;
    if (source.kind === 'local') {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 160;
      canvas.getContext('2d')?.drawImage(image, 0, 0, 320, 160);
      thumbnail = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.75));
    }
    try {
      const item = await store.create({ kind: source.kind, name: source.name.slice(0, MAX_TITLE_LENGTH), content: source.content || '',
        owner: account, assetId: source.kind === 'ai' ? source.url.split('/').at(-1) : undefined,
        file: source.file, thumbnail, width: image.naturalWidth, height: image.naturalHeight }, signal);
      // Mutate the source immediately after commit so retry cannot duplicate it.
      source.itemId = item.id; source.name = item.name; source.content = item.content;
      if (source.kind === 'ai' && !document.hidden) { serial++; owner = account; }
      status('已保存新条目。');
      items = [item, ...items.filter(existing => existing.id !== item.id)]; render();
      return item;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      status(storageError(e), true); throw e;
    }
  }
  $('#item-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !editing) return;
    busy = true; $('#save-item').disabled = true; const item = editing;
    try {
      await verify(item);
      const saved = await store.update(item.id, item.owner, $('#item-title').value, $('#item-content').value);
      updated(saved); editor.close(); status('条目已更新。'); await refresh();
    } catch (e) { $('#item-error').textContent = t(e.name === 'QuotaExceededError' ? storageError(e) : e.message); }
    finally { busy = false; $('#save-item').disabled = false; }
  });
  $('#confirm-delete').addEventListener('click', async () => {
    if (busy || !deleting) return;
    busy = true; $('#confirm-delete').disabled = true; const item = deleting;
    try { await verify(item); await store.remove(item.id, item.owner); removed(item); deletion.close(); status('条目已删除。'); await refresh(); }
    catch (e) { $('#delete-error').textContent = t(e.message); }
    finally { busy = false; $('#confirm-delete').disabled = false; }
  });
  for (const [button, modal] of [['#cancel-item', editor], ['#cancel-delete', deletion]]) $(button).addEventListener('click', () => modal.close());
  editor.addEventListener('close', () => { const id = editing?.id; editing = null; $('#item-form').reset(); $('#item-error').textContent = ''; grid.querySelector(`[data-item-id="${id}"] [data-item-action="edit"]`)?.focus(); });
  deletion.addEventListener('close', () => { const id = deleting?.id; deleting = null; $('#delete-name').textContent = ''; $('#delete-error').textContent = ''; (grid.querySelector(`[data-item-id="${id}"] [data-item-action="delete"]`) || $('#items-heading')).focus(); });
  $('#refresh-items').addEventListener('click', () => { refresh().catch(() => status('无法读取已保存条目，请允许浏览器存储后刷新。', true)); refreshAccount(); });
  window.addEventListener('strgo:localechange', render);
  refresh().catch(() => status('无法读取已保存条目，请允许浏览器存储后刷新。', true));
  refreshAccount();
  return { remember, refreshAccount, clearPrivate,
    dispose() { serial++; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
  };
}
