import { DEFAULT_VIEW, MIN_FOV, MAX_FOV, normalizeView, dragView, pinchView, validateFile, validateDimensions, requestedImage, assetPath, SelectionVersion } from './core.js';
import { requestJSON } from '../shared/catalog.js';
import { setupI18n, translate as t } from '../shared/i18n.js';
import { icon } from '../shared/icons.js';
import { setupItems } from './items.js';
import { setupGeneration } from './generation.js';
import { setupFixedTours } from './fixed.js';

setupI18n();
const $ = selector => document.querySelector(selector);
const viewport = $('#viewport'), viewer = $('#viewer'), dialog = $('#ai-dialog');
$('#fullscreen-icon').innerHTML = icon('fullscreen');
const campus = { url: '/assets/panoramas/campus.webp', name: '阳光下的大学校园广场', kind: 'campus' };
const version = new SelectionVersion();
let view = { ...DEFAULT_VIEW }, engine, initializing, current, loadController, ready = false, disposed = false;
let feedback = '正在载入全景…', feedbackError = false, retrySource = campus, immersive = false;
let libraryController, librarySerial = 0, libraryOwner, nextCursor = null, libraryBusy = false, privateOwner;
const pointers = new Map();
const savedItems = setupItems({
  open: source => load(source),
  updated: item => {
    if (current?.itemId === item.id) { current.name = item.name; current.content = item.content; updateLabels(); }
  },
  removed: item => { if (current?.itemId === item.id || retrySource?.itemId === item.id) load(campus); }
});
const generationViewer = {
  captureSelection: () => version.value,
  showResult: async (source, selection) => {
    if (selection !== undefined && selection !== version.value) return false;
    const shown = await load(source);
    if (shown) { viewport.scrollIntoView({ block: 'center' }); viewport.focus({ preventScroll: true }); }
    return shown;
  }
};
setupGeneration(generationViewer);
const fixedTours = setupFixedTours({ ...generationViewer, readCurrent: async () => {
  if (!current || !ready) throw new Error('请先打开一张全景。');
  const source = current, ticket = version.value;
  const verify = async () => {
    if (source.kind === 'ai' && (await requestJSON('/api/image/session')).user?.id !== privateOwner) throw new Error('账号已变化，请重新选择作品。');
    if (document.hidden || ticket !== version.value) throw new DOMException('Aborted', 'AbortError');
  };
  await verify();
  const response = source.file ? null : await fetch(source.url, { credentials: 'same-origin', cache: 'no-store' });
  if (response && !response.ok) throw new Error('作品无法读取，请确认登录状态和访问权限。');
  const blob = source.file || await response.blob();
  await verify();
  return { blob, name: source.name };
} });

function status(text, error = false) {
  feedback = text; feedbackError = error;
  $('#feedback').textContent = t(text); $('#feedback').classList.toggle('error', error);
}
function updateLabels() {
  if (current) {
    $('#source-name').textContent = current.kind === 'campus' ? t(campus.name) : current.name;
    $('#source-kind').textContent = t(current.tourId ? '固定机位全景' : { campus: '校园全景', local: '本地图片', ai: 'AI 生图作品' }[current.kind]);
    $('#source-content').textContent = current.content || '';
    $('#source-content').hidden = !current.content;
  }
  $('#feedback').textContent = t(feedback);
  $('#feedback').classList.toggle('error', feedbackError);
  $('[data-fullscreen-label]').textContent = t(document.fullscreenElement || immersive ? '退出全屏' : '全屏浏览');
}
function setReady(value) {
  ready = value;
  viewport.dataset.ready = String(value);
  document.querySelectorAll('[data-view-control]').forEach(button => { button.disabled = !value; });
  if (value) { $('#zoom-in').disabled = view.fov <= MIN_FOV; $('#zoom-out').disabled = view.fov >= MAX_FOV; }
}
function setView(next) {
  view = normalizeView(next); engine?.setView(view);
  viewport.dataset.yaw = view.yaw.toFixed(2); viewport.dataset.pitch = view.pitch.toFixed(2); viewport.dataset.fov = view.fov.toFixed(2);
  $('#view-readout').value = `${Math.round(view.fov)}°`; setReady(ready);
}
function zoom(amount) { if (ready) setView({ ...view, fov: view.fov + amount }); }
async function initialize() {
  if (engine) return engine;
  if (!initializing) initializing = import('./renderer.js').then(({ createPanoramaRenderer }) => {
    if (disposed) throw new Error();
    engine = createPanoramaRenderer(viewport, restored => {
      setReady(restored && !!current);
      status(restored ? '全景已就绪。' : '图形连接中断，正在等待恢复。', !restored);
    });
    return engine;
  }).catch(() => { throw new Error('浏览器无法启动 3D，请启用硬件加速或更换浏览器。'); }).finally(() => { initializing = null; });
  return initializing;
}
function decodeImage(blob, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image(), url = URL.createObjectURL(blob);
    const finish = error => {
      clearTimeout(timer); signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null;
      URL.revokeObjectURL(url);
      if (error) { image.src = ''; reject(error); } else resolve(image);
    };
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('图片加载超时，请重试。')), 30000);
    image.onload = () => finish(); image.onerror = () => finish(new Error('图片无法读取，请换一张图片。'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else image.src = url;
  });
}
async function load(source) {
  const ticket = version.next(); loadController?.abort();
  const controller = new AbortController(); loadController = controller;
  retrySource = source;
  $('#save-current').hidden = true;
  viewport.setAttribute('aria-busy', 'true'); $('#retry').hidden = true; status('正在载入全景…');
  try {
    const renderer = await initialize();
    let blob, owner;
    if (source.readFile) {
      const file = await source.readFile();
      if (!file) throw new Error('条目不存在，请刷新列表。');
      source.file = file;
    }
    controller.signal.throwIfAborted();
    if (source.kind === 'ai') {
      const session = await requestJSON('/api/image/session', { signal: controller.signal });
      if (!session.user) throw new Error('请先登录，再导入 AI 生图作品。');
      owner = session.user.id;
      if (source.owner && source.owner !== owner) throw new Error('账号已变化，请重新选择作品。');
      if (document.hidden) throw new DOMException('Aborted', 'AbortError');
    }
    if (source.file) { validateFile(source.file); blob = source.file; }
    else {
      const response = await fetch(source.url, { credentials: 'same-origin', cache: source.kind === 'ai' ? 'no-store' : 'default', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      if (!response.ok) throw new Error(source.kind === 'ai' ? '作品无法读取，请确认登录状态和访问权限。' : '校园全景加载失败，请重试。');
      if (Number(response.headers.get('content-length')) > 40 * 1024 * 1024) throw new Error('图片需小于 40 MB。');
      blob = await response.blob(); validateFile(blob);
    }
    const image = await decodeImage(blob, controller.signal);
    validateDimensions(image.naturalWidth, image.naturalHeight);
    if (!version.isCurrent(ticket) || disposed) return;
    if (source.kind === 'ai') {
      // A session may have changed while a large image was decoding.
      const session = await requestJSON('/api/image/session', { signal: controller.signal });
      if (session.user?.id !== owner) throw new Error('账号已变化，请重新选择作品。');
      if (!version.isCurrent(ticket) || document.hidden) return;
    }
    renderer.setImage(image); current = source; privateOwner = owner;
    $('#fallback').hidden = true;
    $('#source-info').textContent = `${image.naturalWidth} × ${image.naturalHeight} · 2:1`;
    setReady(true); setView(source.preserveView ? view : DEFAULT_VIEW); updateLabels(); status('全景已就绪。');
    fixedTours.selectionChanged(source);
    viewport.dataset.source = source.kind;
    if (source.kind !== 'campus' && !source.itemId && !source.skipSave) {
      try { await savedItems.remember(source, image, owner, controller.signal); if (version.isCurrent(ticket)) updateLabels(); }
      catch (error) {
        if (error.name === 'AbortError') throw error;
        if (version.isCurrent(ticket)) {
          status('图片已打开，但尚未保存。可重试保存。', true);
          $('#save-current').hidden = false;
        }
      }
    }
    return version.isCurrent(ticket);
  } catch (error) {
    if (!version.isCurrent(ticket) || disposed || error.name === 'AbortError') return;
    status(error.name === 'TimeoutError' ? '图片加载超时，请重试。' : error.message, true);
    $('#retry').hidden = false;
  } finally {
    if (version.isCurrent(ticket)) viewport.setAttribute('aria-busy', 'false');
  }
}

$('#panorama-file').addEventListener('change', event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  try { validateFile(file); load({ file, name: file.name, kind: 'local' }); }
  catch (error) { status(error.message, true); }
});
$('#campus').addEventListener('click', () => load(campus));
$('#retry').addEventListener('click', () => load(retrySource));
$('#save-current').addEventListener('click', () => { if (current && !current.itemId) load(current); });
$('#reset').addEventListener('click', () => setView(DEFAULT_VIEW));
$('#zoom-in').addEventListener('click', () => zoom(-5));
$('#zoom-out').addEventListener('click', () => zoom(5));

const distance = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
viewport.addEventListener('pointerdown', event => {
  if (!ready || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault(); viewport.focus({ preventScroll: true }); viewport.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove', event => {
  const previous = pointers.get(event.pointerId);
  if (!previous || !ready) return;
  const before = distance(); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) setView(dragView(view, event.clientX - previous.x, event.clientY - previous.y, viewport.clientHeight));
  else if (pointers.size === 2) setView(pinchView(view, before, distance()));
});
const release = event => { pointers.delete(event.pointerId); if (!pointers.size) viewport.classList.remove('dragging'); };
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(name, release);
viewport.addEventListener('wheel', event => {
  if (!ready) return;
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
  zoom(Math.max(-100, Math.min(100, event.deltaY * unit)) * 0.05);
}, { passive: false });
viewport.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'r', 'R', 'f', 'F'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  if (event.key.toLowerCase() === 'f') { toggleFullscreen(); return; }
  if (!ready) return;
  if (event.key.toLowerCase() === 'r') setView(DEFAULT_VIEW);
  else if (['+', '='].includes(event.key)) zoom(-5);
  else if (['-', '_'].includes(event.key)) zoom(5);
  else setView({ ...view, yaw: view.yaw + (event.key === 'ArrowLeft' ? 5 : event.key === 'ArrowRight' ? -5 : 0), pitch: view.pitch + (event.key === 'ArrowUp' ? 5 : event.key === 'ArrowDown' ? -5 : 0) });
});

function fallbackFullscreen(enabled) {
  immersive = enabled; viewer.classList.toggle('is-immersive', enabled); document.body.classList.toggle('immersive-open', enabled);
  syncFullscreen();
}
function syncFullscreen() { $('#fullscreen').setAttribute('aria-pressed', String(!!document.fullscreenElement || immersive)); updateLabels(); engine?.resize(); }
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (immersive) fallbackFullscreen(false);
    else if (viewer.requestFullscreen) await viewer.requestFullscreen();
    else fallbackFullscreen(true);
  } catch { fallbackFullscreen(!immersive); }
  syncFullscreen();
}
$('#fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && immersive && !event.defaultPrevented) { fallbackFullscreen(false); $('#fullscreen').focus(); } });

function clearLibrary() {
  libraryController?.abort(); librarySerial++; libraryOwner = null; nextCursor = null; libraryBusy = false;
  $('#ai-items').replaceChildren(); $('#ai-more').hidden = true; $('#ai-more').disabled = false;
}
function libraryMessage(text) { $('#ai-feedback').textContent = t(text); }
async function fetchLibrary(append = false) {
  if (libraryBusy) return;
  libraryBusy = true; $('#ai-more').disabled = true;
  libraryController?.abort(); const controller = new AbortController(); libraryController = controller;
  const serial = ++librarySerial;
  $('#ai-login').hidden = true; libraryMessage('正在读取 AI 作品…');
  try {
    const session = await requestJSON('/api/image/session', { signal: controller.signal });
    if (!session.user) { clearLibrary(); $('#ai-login').hidden = false; libraryMessage('请先登录，再导入 AI 生图作品。'); return; }
    if (append && libraryOwner !== session.user.id) { clearLibrary(); libraryMessage('账号已变化，请重新选择作品。'); return; }
    libraryOwner = session.user.id;
    const params = new URLSearchParams({ source: 'image', limit: '18' });
    if (append && nextCursor) params.set('cursor', nextCursor);
    const result = await requestJSON('/api/image/hub/assets?' + params, { signal: controller.signal });
    if (controller.signal.aborted || serial !== librarySerial || !dialog.open) return;
    if (result.user_id !== libraryOwner) { clearLibrary(); libraryMessage('账号已变化，请重新选择作品。'); return; }
    if (result.partial || result.sources?.some(source => source.status !== 'ok')) throw new Error('AI 作品暂时无法读取，请稍后重试。');
    if (!append) $('#ai-items').replaceChildren();
    for (const item of result.items) {
      if (item.source !== 'image' || !/^[a-f0-9]{32}$/.test(item.id)) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ai-item';
      const image = document.createElement('img'); image.src = assetPath(item.id); image.alt = ''; image.loading = 'lazy';
      const title = document.createElement('span'); title.textContent = item.title || t('未命名作品'); title.setAttribute('data-strgo-user-content', '');
      button.append(image, title);
      button.addEventListener('click', () => { const source = { kind: 'ai', url: assetPath(item.id), name: item.title || t('AI 生图作品'), content: '', owner: libraryOwner }; dialog.close(); load(source); });
      $('#ai-items').append(button);
    }
    nextCursor = result.next_cursor; $('#ai-more').hidden = !nextCursor;
    libraryMessage($('#ai-items').childElementCount ? '选择作品后会检查 2:1 比例。' : '还没有作品，先去 AI 生图创作一张全景。');
  } catch (error) {
    if (!controller.signal.aborted && serial === librarySerial) {
      $('#ai-items').replaceChildren(); $('#ai-more').hidden = true; nextCursor = null;
      if (error.status === 401) $('#ai-login').hidden = false;
      libraryMessage(error.status === 401 ? '请先登录，再导入 AI 生图作品。' : error.message);
    }
  } finally {
    if (serial === librarySerial) { libraryBusy = false; $('#ai-more').disabled = false; }
  }
}
$('#open-ai').addEventListener('click', () => { clearLibrary(); dialog.showModal(); fetchLibrary(); });
$('#close-ai').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { clearLibrary(); $('#open-ai').focus(); });
$('#ai-more').addEventListener('click', () => fetchLibrary(true));

function clearPrivate() {
  if (privateOwner || retrySource?.kind === 'ai') {
    version.next(); loadController?.abort(); privateOwner = null; current = null;
    engine?.clear(); setReady(false); $('#fallback').hidden = false; viewport.dataset.source = 'campus';
    $('#source-name').textContent = t(campus.name); $('#source-kind').textContent = t('校园全景'); $('#source-info').textContent = '1774 × 887 · 2:1';
    $('#source-content').textContent = ''; $('#source-content').hidden = true; $('#save-current').hidden = true;
    retrySource = campus; status('正在载入全景…'); return true;
  }
  return false;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (dialog.open) dialog.close(); clearPrivate(); savedItems.clearPrivate(); pointers.clear(); viewport.classList.remove('dragging'); }
  else { if (!current) load(campus); engine?.resize(); savedItems.refreshAccount(); }
});
window.addEventListener('focus', async () => {
  savedItems.refreshAccount();
  if (!privateOwner && !dialog.open) return;
  const owner = privateOwner || libraryOwner;
  try {
    const session = await requestJSON('/api/image/session');
    if (session.user?.id !== owner) { if (dialog.open) dialog.close(); if (clearPrivate()) load(campus); }
  } catch { if (dialog.open) dialog.close(); if (clearPrivate()) load(campus); }
});
window.addEventListener('pagehide', event => {
  if (dialog.open) dialog.close(); clearPrivate(); savedItems.clearPrivate();
  if (!event.persisted) { disposed = true; version.next(); loadController?.abort(); engine?.dispose(); savedItems.dispose(); }
});
window.addEventListener('pageshow', event => { if (event.persisted) { if (!current) load(campus); savedItems.refreshAccount(); } });
window.addEventListener('strgo:localechange', updateLabels);
setView(DEFAULT_VIEW);
const imageId = requestedImage(location.search);
if (imageId) {
  // URLs carry an opaque ID only. No arbitrary remote URLs or signed assets.
  load({ kind: 'ai', url: assetPath(imageId), name: t('AI 生图作品') });
} else load(campus);
