import { assetPath, validateDimensions, validateFile } from './core.js';

export const DATABASE_NAME = 'strgo-panorama-items';
export const MAX_TITLE_LENGTH = 160;
export const MAX_CONTENT_LENGTH = 5000;

export function itemText(name, content = '') {
  name = String(name ?? '').trim(); content = String(content ?? '').trim();
  if (!name || name.length > MAX_TITLE_LENGTH) throw new Error('标题需为 1 至 160 个字符。');
  if (content.length > MAX_CONTENT_LENGTH) throw new Error('内容最多 5000 个字符。');
  return { name, content };
}

// Keep original local files out of list reads. AI images are never persisted.
export class PanoramaStore {
  connection;
  async database() {
    if (!this.connection) this.connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore('items', { keyPath: 'id' });
        request.result.createObjectStore('files', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.connection = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error('请关闭其他全景页面后重试保存。')); };
    }).catch(error => { this.connection = null; throw error; });
    return this.connection;
  }
  async transaction(stores, mode, action, signal) {
    const db = await this.database();
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result, failure;
      const abort = () => tx.abort();
      const cleanup = () => signal?.removeEventListener('abort', abort);
      tx.oncomplete = () => { cleanup(); resolve(result); };
      tx.onerror = event => { failure ||= event.target.error; };
      tx.onabort = () => { cleanup(); reject(failure || tx.error || new DOMException('Aborted', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      try { action(tx, value => { result = value; }, error => { failure = error; tx.abort(); }); }
      catch (error) { failure = error; tx.abort(); }
    });
  }
  list() {
    return this.transaction(['items'], 'readonly', (tx, result) => {
      tx.objectStore('items').getAll().onsuccess = event => result(event.target.result);
    });
  }
  file(id) {
    return this.transaction(['files'], 'readonly', (tx, result) => {
      tx.objectStore('files').get(id).onsuccess = event => result(event.target.result?.file);
    });
  }
  create({ kind, name, content, owner, assetId, file, thumbnail, width, height }, signal) {
    const text = itemText(name, content);
    validateDimensions(width, height);
    if (kind === 'local') validateFile(file);
    else if (kind === 'ai' && owner) assetPath(assetId);
    else throw new Error('图片无法读取，请换一张图片。');
    const item = { id: crypto.randomUUID(), kind, ...text, width, height, createdAt: Date.now(), updatedAt: Date.now(),
      ...(kind === 'ai' ? { owner, assetId } : { thumbnail }) };
    return this.transaction(['items', 'files'], 'readwrite', (tx, result) => {
      tx.objectStore('items').add(item);
      if (kind === 'local') tx.objectStore('files').add({ id: item.id, file });
      result(item);
    }, signal);
  }
  change(id, owner, text) {
    return this.transaction(['items', 'files'], 'readwrite', (tx, result, fail) => {
      const items = tx.objectStore('items');
      items.get(id).onsuccess = event => {
        const item = event.target.result;
        if (!item || (item.kind === 'ai' && item.owner !== owner)) { fail(new Error('条目不存在，请刷新列表。')); return; }
        if (text) {
          const updated = { ...item, ...text, updatedAt: Date.now() };
          items.put(updated); result(updated);
        } else { items.delete(id); tx.objectStore('files').delete(id); result(item); }
      };
    });
  }
  update(id, owner, name, content) { return this.change(id, owner, itemText(name, content)); }
  remove(id, owner) { return this.change(id, owner); }
}
