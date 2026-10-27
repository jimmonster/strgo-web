import { translate, SUPPORTED_LOCALES } from './i18n.js';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function sanitizePreferences(value, entries) {
  const known = new Set(entries.map(entry => entry.id));
  const ids = list => Array.isArray(list) ? [...new Set(list.filter(id => typeof id === 'string' && known.has(id)))] : [];
  return { favs: ids(value?.favs).slice(0, 50), recent: ids(value?.recent).slice(0, 8),
    mode: value?.mode === 'immersive' ? 'immersive' : 'console', motion: value?.motion === 'off' ? 'off' : 'auto' };
}

export function readPreferences(storage, userId, entries) {
  try { return sanitizePreferences(JSON.parse(storage.getItem('strgo:hub:v1:' + (userId || 'guest')) || '{}'), entries); }
  catch { return sanitizePreferences({}, entries); }
}

export function writePreferences(storage, userId, value, entries) {
  storage.setItem('strgo:hub:v1:' + (userId || 'guest'), JSON.stringify(sanitizePreferences(value, entries)));
}

export function filterEntries(entries, { role, query = '', group = '全部', favorites = [] } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter(e => (role === 'admin' || e.group !== '管理')
    && (group === '全部' || (group === '我的收藏' ? favorites.includes(e.id) : e.group === group))
    && [e.name, e.en, e.description, e.route, ...SUPPORTED_LOCALES.flatMap(locale => [translate(e.name, locale), translate(e.description, locale)])].join(' ').toLocaleLowerCase().includes(needle));
}

export function safeReturnPath(value, fallback = '/hub/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\s\x00-\x1f]/.test(value)) return fallback;
  try { const url = new URL(value, 'https://strgo.invalid'); return url.origin === 'https://strgo.invalid' ? url.pathname + url.search + url.hash : fallback; }
  catch { return fallback; }
}

export async function requestJSON(path, { signal, method = 'GET', body, csrf, fetcher = fetch } = {}) {
  if (!/^\/api\/(?:image|ai\/v1)\//.test(path)) throw new Error('不支持的服务路径。');
  const timeout = AbortSignal.timeout(15000);
  const response = await fetcher(path, { method, credentials: 'same-origin', cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('账号服务暂时不可用，请稍后重试。');
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(typeof value.error === 'string' ? value.error : value.error?.message || '服务暂时不可用。');
    error.status = response.status;
    throw error;
  }
  return path.startsWith('/api/ai/v1/') ? value.data : value;
}

export function allowedAction(action, item) {
  const id = item?.id;
  if (!/^[a-f0-9]{32}$/.test(id || '')) return false;
  return (action?.type === 'retry_save' && item.source === 'image' && item.status === 'save_failed'
      && action.endpoint === `/api/image/images/${id}/retry`)
    || (action?.type === 'delete_asset' && item.preview_url &&
      ((item.source === 'image' && action.endpoint === `/api/image/images/${id}`)
      || (item.source === 'music' && action.endpoint === `/api/ai/v1/assets/${id}`)))
    || (action?.type === 'reuse_music' && item.source === 'music' && /^[a-f0-9]{32}$/.test(item.task_id || '')
      && action.endpoint === `/api/ai/v1/tasks/${item.task_id}`)
    || (action?.type === 'cancel' && ['music', 'chat'].includes(item.source)
      && ['queued', 'running', 'saving'].includes(item.status)
      && action.endpoint === `/api/ai/v1/tasks/${id}/cancel`);
}
