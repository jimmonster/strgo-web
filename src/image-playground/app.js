import { requestedJob, panoramaPath, panoramaDraft } from './hub-links.js';
import { icons } from './icons.js';
import { compressReferenceImage } from './reference-image.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const busyStates = new Set(['queued', 'generating', 'uploading']);
const stateNames = { queued: '等待生成', generating: '正在生成', uploading: '等待存储同步', complete: '已保存', partial: '部分完成', failed: '任务未完成' };
const state = { user: null, csrf: '', config: null, storageReady: false, view: 'create', auth: 'login', size: '1024x1024', sizeMode: 'preset', jobs: new Map(), current: null, offset: 0, hasMore: false, favoriteOnly: false, libraryJobs: [], inspirations: [], inspirationOffset: 0, inspirationHasMore: false, poll: null, preview: null, epoch: 0, requestId: null, reference: null, referenceProcessing: false, referenceError: false, generating: false };
let referenceController = null;
const presetState = { items: [], request: 0, editing: null, editorVersion: 0 };
let generationQuota = null, quotaTimer = null, quotaRequest = 0;

function icon(name) {
  const span = document.createElement('span');
  span.dataset.icon = name;
  // Only bundled Lucide markup is inserted as HTML; all user data uses textContent.
  span.innerHTML = icons[name] || '';
  return span;
}
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icons[node.dataset.icon] || ''; });
}
function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function uiEl(tag, className = '', text = '') { const node = el(tag, className, text); node.setAttribute('data-strgo-ui-copy', ''); return node; }
function message(id, text, kind = '') {
  const target = $(id);
  target.textContent = text;
  target.className = 'message' + (kind ? ' ' + kind : '');
}
let toastTimer;
function toast(text, fixed = false) {
  clearTimeout(toastTimer);
  const element = $('#toast'); if (fixed) element.setAttribute('data-strgo-static', ''); else element.removeAttribute('data-strgo-static');
  element.textContent = text;
  element.hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200);
}
function toastFixed(text) { toast(text, true); }
async function api(path, { method = 'GET', body, timeout = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch('/api/image' + path, {
      method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('账号服务尚未接入或返回异常，请联系管理员。'); }
    if (!response.ok) {
      if (response.status === 401 && state.user && !['/login', '/register'].includes(path)) lock();
      throw new Error(result.error || '操作失败，请稍后重试。');
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时，请刷新任务状态，避免重复提交。');
    if (error.name === 'TypeError') throw new Error('无法连接服务器，请检查网络后重试。');
    throw error;
  } finally { clearTimeout(timer); }
}
function lock() {
  state.epoch++;
  state.user = null; state.csrf = ''; state.config = null; submittedComposer = '';
  generationQuota = null; quotaRequest++; clearTimeout(quotaTimer);
  $('#quota-admin-section').hidden = true; $('#library-scope').hidden = true; $('#library-scope').value = 'mine';
  $('#favorite-filter').hidden = false; state.favoriteOnly = false; $('#favorite-filter').setAttribute('aria-pressed', 'false');
  $('#quota-mode').value = 'unlimited'; $('#daily-image-limit').value = ''; updateQuotaMode();
  message('#quota-message', ''); message('#quota-status', '');
  state.jobs.clear(); state.libraryJobs = []; state.current = null;
  state.inspirations = []; clearReference();
  presetState.items = []; presetState.request++; cancelPresetEdit();
  $('#new-preset').hidden = true; renderPresetInspirations(); renderPresetManagement();
  message('#presets-message', ''); message('#preset-load-message', ''); $('#preset-search').value = '';
  state.preview = null; state.requestId = null;
  clearTimeout(state.poll);
  $('#workspace').hidden = true; $('#auth-view').hidden = false; $('#logout').hidden = true;
  $('#account-name').textContent = ''; $('#api-key').value = ''; $('#password').value = '';
  $('#endpoint').value = ''; $('#model').value = ''; $('#invite-code').textContent = ''; $('#invite-result').hidden = true;
  $('#old-password').value = ''; $('#new-password').value = '';
  $('#image-dialog').close(); $('#preview-image').removeAttribute('src');
  $('#panorama-image').removeAttribute('href');
  $('#current-output').replaceChildren(); $('#library-list').replaceChildren();
}
function setConfig(config) {
  state.config = config;
  $('#endpoint').value = config?.endpoint || '';
  $('#model').value = config?.model || '';
  $('#api-key').value = '';
  $('#api-key').required = !config?.hasKey;
  $('#api-key').placeholder = config?.hasKey ? '已加密保存；留空保留原密钥' : '输入 API Key';
  $('#key-status').textContent = config?.hasKey ? '密钥已加密保存；更换接口地址时需重新输入密钥。' : '密钥加密存储，保存后不回显。';
  $('#model-label').toggleAttribute('data-strgo-static', !config?.model);
  $('#model-label').textContent = config?.model || '尚未配置模型';
  updateGenerateButton();
  if (!state.storageReady) message('#generation-message', '服务器存储尚未就绪，请联系管理员检查硬盘和目录权限。', 'error');
  else if (!config?.hasKey) message('#generation-message', '先在「接口设置」填写模型地址和密钥。');
  else message('#generation-message', '');
}
function updateGenerateButton() {
  const insufficient = !state.requestId && generationQuota?.remaining != null && Number($('#count').value) > generationQuota.remaining;
  $('#generate').disabled = !state.user || !state.config?.hasKey || !state.storageReady || state.referenceProcessing || state.referenceError || state.generating || insufficient;
}
function updateQuotaMode() {
  const limited = $('#quota-mode').value === 'limited';
  $('#daily-limit-label').hidden = !limited;
  const editable = state.user?.role === 'admin';
  $('#quota-mode').disabled = !editable;
  $('#daily-image-limit').disabled = !editable || !limited; $('#daily-image-limit').required = editable && limited;
}
function setQuota(quota, policy = false) {
  generationQuota = quota;
  clearTimeout(quotaTimer);
  if (!quota) { message('#quota-status', ''); updateGenerateButton(); return; }
  const insufficient = quota.remaining != null && Number($('#count').value) > quota.remaining;
  const text = quota.exempt ? '管理员账号不受每日生图额度限制。' : quota.dailyImageLimit == null
    ? `今日已提交 ${quota.used} 张 · 每日额度不限`
    : `今日已用 ${quota.used} / ${quota.dailyImageLimit} 张，剩余 ${quota.remaining} 张 · 北京时间零点重置` + (insufficient ? '；请减少图片数量或等待额度重置。' : '');
  message('#quota-status', text, insufficient ? 'error' : '');
  if (policy) {
    $('#quota-mode').value = quota.dailyImageLimit == null ? 'unlimited' : 'limited';
    $('#daily-image-limit').value = quota.dailyImageLimit ?? '';
    updateQuotaMode();
  }
  if (quota.resetsAt) quotaTimer = setTimeout(() => refreshQuota().catch(error => toast(error.message)), Math.max(1000, quota.resetsAt * 1000 - Date.now() + 500));
  updateGenerateButton();
}
async function refreshQuota(policy = false) {
  const request = ++quotaRequest, epoch = state.epoch;
  const quota = await api('/generation-quota');
  if (!state.user || epoch !== state.epoch || request !== quotaRequest) return;
  setQuota(quota, policy);
}
function clearReference({ keepSelection = false } = {}) {
  referenceController?.abort(); referenceController = null;
  state.reference = null; state.requestId = null; state.referenceProcessing = false; state.referenceError = false;
  if (!keepSelection) $('#reference-image').value = '';
  $('#reference-thumbnail').removeAttribute('src'); $('#reference-thumbnail').hidden = true;
  $('#reference-preview').hidden = true; $('#reference-name').textContent = ''; message('#reference-status', '');
  updateGenerateButton();
}
function setStorage(ready, backup, storage = {}) {
  state.storageReady = ready;
  const label = storage.label || 'ECS 硬盘';
  $('#storage-status').className = 'storage-status ' + (ready ? 'ready' : 'offline');
  $('#storage-status').replaceChildren(el('span', 'status-dot'), document.createTextNode(ready ? label + '已就绪' : '服务器存储未就绪'));
  $('#storage-description').toggleAttribute('data-strgo-static', !storage.label);
  $('#storage-description').textContent = label + ' · 私有访问';
  $('#disk-state').textContent = ready ? '已就绪，写入时校验' : '请检查存储目录';
  $('#storage-note').textContent = '生成后自动保存至' + label;
  $('#backup-state').toggleAttribute('data-strgo-user-content', !!backup?.error);
  $('#backup-state').textContent = backup?.error || (backup?.last ? '最近备份 ' + new Date(Number(backup.last) * 1000).toLocaleString('zh-CN') : '等待首次备份');
}
async function unlock() {
  const info = await api('/session');
  if (!info.user) { lock(); return; }
  state.user = info.user; state.csrf = info.csrf;
  $('#auth-view').hidden = true; $('#workspace').hidden = false; $('#logout').hidden = false;
  $('#account-name').textContent = info.user.username;
  $('#admin-section').hidden = info.user.role !== 'admin'; $('#backup').hidden = info.user.role !== 'admin';
  $('#quota-admin-section').hidden = info.user.role !== 'admin'; $('#library-scope').hidden = info.user.role !== 'admin';
  $('#new-preset').hidden = info.user.role !== 'admin';
  setQuota(info.generationQuota, true);
  setStorage(info.storageReady, info.backup, info.storage); setConfig(info.config);
  showView(['create', 'library', 'inspirations', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'create');
  await refreshCurrent();
  const draft = panoramaDraft(location.search);
  await openHubJob();
  if (draft) {
    selectSize(draft.size); $('#prompt').value = draft.prompt; $('#prompt').dispatchEvent(new Event('input'));
    showView('create');
    const params = new URLSearchParams(location.search); params.delete('panorama');
    history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
  }
}
async function openHubJob() {
  const requested = requestedJob(location.search);
  if (!requested || !state.user) return;
  const owner = state.user.id, epoch = state.epoch;
  try {
    const job = await api('/jobs/' + requested.id);
    if (state.user?.id !== owner || state.epoch !== epoch) return;
    state.jobs.set(job.id, job); state.current = job.id; showView('create'); renderCurrent();
    if (requested.reuse) {
      $('#prompt').value = job.prompt; $('#prompt').dispatchEvent(new Event('input'));
      selectSize(job.size); $('#quality').value = job.quality; $('#count').value = String(job.count);
      $('#prompt').focus();
      toastFixed(job.hasReference ? '已复用文字和参数；参考图需重新选择，确认后再生成。' : '已复用参数，请确认后再生成。');
    }
    const params = new URLSearchParams(location.search); params.delete('job'); params.delete('reuse');
    history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
  } catch (error) { if (state.user?.id === owner && state.epoch === epoch) toast(error.message); }
}
function showView(view) {
  if (!state.user) return;
  state.view = view;
  $$('.view').forEach(node => { node.hidden = node.id !== 'view-' + view; });
  $$('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  history.replaceState(null, '', '#' + view);
  if (view === 'library') refreshLibrary().catch(error => toast(error.message));
  if (view === 'inspirations') refreshInspirations().catch(error => toast(error.message));
  if (view === 'create' || view === 'inspirations') refreshPresets().catch(presetLoadError);
  if (view === 'create' || view === 'settings') refreshQuota(view === 'settings').catch(error => toast(error.message));
}
function dateText(seconds) {
  return new Date(seconds * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function openImage(image, job) {
  state.preview = { image, job };
  $('#preview-image').src = image.url; $('#preview-image').alt = job.prompt;
  $('#preview-prompt').textContent = job.prompt;
  $('#download-image').href = image.downloadUrl;
  $('#download-image').setAttribute('download', 'strgo-' + image.id);
  const panorama = panoramaPath(image.id);
  $('#panorama-image').hidden = !panorama;
  if (panorama) $('#panorama-image').href = panorama;
  $('#image-dialog').showModal();
}
function renderImage(image, job) {
  const own = job.userId === state.user?.id;
  const card = el('article', 'image-card');
  const button = el('button', 'image-open'); button.type = 'button'; button.setAttribute('aria-label', '预览作品：' + job.prompt);
  const img = el('img'); img.src = image.url; img.alt = job.prompt; img.loading = 'lazy';
  img.addEventListener('error', () => { button.setAttribute('aria-label', '图片暂时无法读取，点击重试'); });
  button.append(img); button.addEventListener('click', () => openImage(image, job)); card.append(button);
  const bar = el('div', 'image-toolbar');
  const status = el('span', 'status-label ' + (image.state === 'saved' ? 'saved' : 'failed'), image.state === 'saved' ? '已保存' : '待保存');
  status.prepend(icon(image.state === 'saved' ? 'check' : 'clock')); bar.append(status);
  const actions = el('div', 'actions');
  if (own && image.state !== 'saved') {
    const retry = el('button', 'quiet retry', '重试'); retry.type = 'button'; retry.title = image.error || '重试保存';
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      try { await api('/images/' + image.id + '/retry', { method: 'POST' }); toastFixed('已加入同步队列。'); await refreshCurrent(); }
      catch (error) { toast(error.message); } finally { retry.disabled = false; }
    }); actions.append(retry);
  }
  const star = el('button', 'icon-button'); star.type = 'button'; star.title = image.favorite ? '取消收藏' : '收藏'; star.setAttribute('aria-label', star.title); star.setAttribute('aria-pressed', String(image.favorite)); star.append(icon('star'));
  star.addEventListener('click', async () => {
    star.disabled = true;
    try {
      const result = await api('/images/' + image.id + '/favorite', { method: 'PUT', body: { favorite: !image.favorite } });
      image.favorite = result.favorite; star.setAttribute('aria-pressed', String(image.favorite));
      star.title = image.favorite ? '取消收藏' : '收藏'; star.setAttribute('aria-label', star.title);
      if (state.view === 'library' && state.favoriteOnly) await refreshLibrary();
    } catch (error) { toast(error.message); } finally { star.disabled = false; }
  }); if (own) actions.append(star);
  const download = el('a', 'icon-button'); download.href = image.downloadUrl; download.setAttribute('download', 'strgo-' + image.id); download.title = '下载原图'; download.setAttribute('aria-label', '下载原图'); download.append(icon('download')); actions.append(download);
  const remove = el('button', 'icon-button delete-image'); remove.type = 'button'; remove.title = '删除作品'; remove.setAttribute('aria-label', '删除作品'); remove.dataset.imageId = image.id; remove.append(icon('trash-2'));
  remove.addEventListener('click', async () => {
    if (remove.disabled || !window.confirm('确定删除这张作品吗？图片将从作品库和服务器硬盘移除，无法撤销。')) return;
    const owner = state.user?.id;
    remove.disabled = true;
    try {
      const result = await api('/images/' + image.id, { method: 'DELETE' });
      if (!state.user || state.user.id !== owner) return;
      // Invalidate reads started before deletion so a stale response cannot
      // put the removed image back into either view.
      state.epoch++;
      for (const [id, cached] of state.jobs) {
        cached.images = cached.images.filter(item => item.id !== image.id);
        if (!cached.images.length && id === job.id) {
          state.jobs.delete(id);
          if (state.current === id) state.current = null;
        }
      }
      if (state.preview?.image.id === image.id) {
        $('#image-dialog').close(); $('#preview-image').removeAttribute('src');
        $('#download-image').removeAttribute('href'); state.preview = null;
      }
      card.remove(); renderCurrent();
      toastFixed(result.cleanupPending ? '作品已移除，存储恢复后会自动清理文件。' : '作品已删除。');
      await refreshCurrent();
      if (state.view === 'library') await refreshLibrary();
    } catch (error) {
      if (state.user?.id === owner) toast(error.message);
    } finally { remove.disabled = false; }
  });
  if (own || state.user?.role === 'admin') actions.append(remove);
  bar.append(actions); card.append(bar);
  if (image.error) card.append(el('p', 'message error', image.error));
  return card;
}
function renderJob(job) {
  const section = el('article', 'job'); section.dataset.job = job.id;
  const heading = el('div', 'job-heading'); heading.append(el('span', '', dateText(job.created)), el('span', 'status-label ' + (job.status === 'complete' ? 'saved' : ''), stateNames[job.status] || job.status)); section.append(heading);
  if (job.status === 'failed' && !job.images.length && (job.userId === state.user?.id || state.user?.role === 'admin')) {
    const remove = el('button', 'icon-button delete-job'); remove.type = 'button'; remove.title = '删除失败记录'; remove.setAttribute('aria-label', '删除失败记录'); remove.dataset.jobId = job.id; remove.append(icon('trash-2'));
    remove.addEventListener('click', async () => {
      if (remove.disabled || !window.confirm('确定删除这条失败任务记录吗？删除后将不再显示，已占用的每日额度不返还。')) return;
      const owner = state.user?.id;
      remove.disabled = true;
      try {
        await api('/jobs/' + job.id, { method: 'DELETE' });
        if (!state.user || state.user.id !== owner) return;
        state.epoch++;
        state.jobs.delete(job.id); state.libraryJobs = state.libraryJobs.filter(item => item.id !== job.id);
        if (state.current === job.id) state.current = null;
        $$('[data-job="' + job.id + '"]').forEach(node => node.remove());
        renderCurrent(); schedulePoll(); toastFixed('失败任务记录已删除。');
        await refreshCurrent();
        if (state.view === 'library') await refreshLibrary();
      } catch (error) { if (state.user?.id === owner) toast(error.message); }
      finally { remove.disabled = false; }
    });
    heading.append(remove);
  }
  if (job.userId !== state.user?.id && job.username) section.append(el('p', 'small muted job-owner', '创建者：' + job.username));
  if (job.images.length) {
    const grid = el('div', 'images-grid'); job.images.forEach(image => grid.append(renderImage(image, job))); section.append(grid);
  } else if (busyStates.has(job.status)) {
    const pending = el('div', 'pending-box'); pending.append(el('span', 'spinner'), el('span', '', stateNames[job.status])); section.append(pending);
  }
  section.append(el('p', 'job-prompt', job.prompt));
  section.append(el('p', 'small muted', job.model + ' · ' + job.size.replace('x', ' × ') + ' · ' + job.count + ' 张' + (job.hasReference ? ' · 使用了参考图' : '')));
  if (job.error) section.append(el('p', 'message error', job.error));
  return section;
}

function renderInspiration(item) {
  const card = el('article', 'inspiration-card');
  const heading = el('div', 'inspiration-heading');
  heading.append(el('h2', '', item.title), el('span', 'small muted', dateText(item.created)));
  const prompt = el('p', 'inspiration-prompt', item.prompt);
  const details = el('p', 'small muted', item.size.replace('x', ' × ') + ' · ' + item.count + ' 张' + (item.quality ? ' · ' + item.quality : ''));
  const actions = el('div', 'inspiration-actions');
  const use = el('button', 'secondary', '用于创作'); use.type = 'button'; use.prepend(icon('wand-sparkles'));
  use.addEventListener('click', () => {
    $('#prompt').value = item.prompt; $('#prompt').dispatchEvent(new Event('input'));
    $('#quality').value = item.quality; $('#count').value = String(item.count);
    selectSize(item.size); showView('create'); $('#prompt').focus(); toastFixed('灵感已载入创作区。');
  });
  const remove = el('button', 'quiet', '删除'); remove.type = 'button';
  remove.addEventListener('click', async () => {
    remove.disabled = true;
    try { await api('/inspirations/' + item.id, { method: 'DELETE' }); await refreshInspirations(); toastFixed('灵感已删除。'); }
    catch (error) { toast(error.message); } finally { remove.disabled = false; }
  });
  actions.append(use, remove); card.append(heading, prompt, details, actions); return card;
}

function renderPresetInspirations() {
  const buttons = presetState.items.map((item, index) => {
    const button = el('button', 'preset-card'); button.type = 'button'; button.dataset.presetIndex = String(index);
    button.append(el('strong', '', item.title), el('span', '', item.description));
    button.addEventListener('click', () => usePreset(item));
    return button;
  });
  $('#preset-list').replaceChildren(...buttons);
  $('#preset-summary').textContent = `一键套用预装灵感（${presetState.items.length} 个）`;
}

function usePreset(item) {
  $('#prompt').value = item.prompt; $('#prompt').dispatchEvent(new Event('input'));
  showView('create'); $('#prompt').focus(); toast(item.title + '提示词已载入；按需选择参考图。');
}

function renderPresetManagement() {
  const search = $('#preset-search').value.trim().toLocaleLowerCase();
  const items = presetState.items.filter(item => [item.title, item.description, item.prompt].join(' ').toLocaleLowerCase().includes(search));
  const cards = items.map(item => {
    const card = el('article', 'inspiration-card shared-preset'); card.dataset.presetId = item.id;
    const heading = el('div', 'inspiration-heading'); heading.append(el('h3', '', item.title), el('span', 'small muted', '排序 ' + item.sortOrder));
    const details = el('details', 'preset-prompt-details'); details.append(el('summary', '', '查看提示词'), el('p', 'inspiration-prompt', item.prompt));
    const actions = el('div', 'inspiration-actions');
    const use = el('button', 'secondary', '用于创作'); use.type = 'button'; use.prepend(icon('wand-sparkles')); use.addEventListener('click', () => usePreset(item)); actions.append(use);
    if (state.user?.role === 'admin') {
      const tools = el('div', 'preset-card-tools');
      const edit = el('button', 'icon-button edit-preset'); edit.type = 'button'; edit.title = '编辑预装灵感'; edit.setAttribute('aria-label', '编辑预装灵感'); edit.append(icon('pencil')); edit.addEventListener('click', () => openPresetEditor(item));
      const remove = el('button', 'icon-button delete-preset'); remove.type = 'button'; remove.title = '删除预装灵感'; remove.setAttribute('aria-label', '删除预装灵感'); remove.append(icon('trash-2'));
      remove.addEventListener('click', async () => {
        if (remove.disabled || state.user?.role !== 'admin' || !window.confirm(`确定删除预装灵感“${item.title}”吗？所有账号将无法再使用该预装项，已保存的个人灵感不受影响。`)) return;
        const owner = state.user.id; remove.disabled = true;
        try {
          await api('/preset-inspirations/' + item.id, { method: 'DELETE' });
          if (state.user?.id !== owner) return;
          presetState.request++; presetState.items = presetState.items.filter(value => value.id !== item.id);
          if (presetState.editing?.id === item.id) cancelPresetEdit();
          renderPresetInspirations(); renderPresetManagement(); toastFixed('预装灵感已删除。');
        } catch (error) { if (state.user?.id === owner) message('#presets-message', error.message, 'error'); }
        finally { remove.disabled = false; }
      });
      tools.append(edit, remove); actions.append(tools);
    }
    card.append(heading, el('p', 'small muted', item.description), details, actions); return card;
  });
  $('#shared-preset-list').replaceChildren(...(cards.length ? cards : [el('p', 'muted preset-empty', search ? '没有匹配的预装灵感。' : '暂无预装灵感。')]));
}

function presetLoadError(error) {
  message('#presets-message', error.message, 'error'); message('#preset-load-message', '预装灵感加载失败，请在灵感库刷新。', 'error');
}

async function refreshPresets() {
  const epoch = state.epoch, request = ++presetState.request;
  let result;
  try { result = await api('/preset-inspirations'); }
  catch (error) {
    if (state.user && epoch === state.epoch && request === presetState.request) throw error;
    return;
  }
  if (!state.user || epoch !== state.epoch || request !== presetState.request) return;
  if (!Array.isArray(result.presets)) throw new Error('预装灵感返回格式异常，请刷新后重试。');
  presetState.items = result.presets;
  renderPresetInspirations(); renderPresetManagement();
  message('#presets-message', ''); message('#preset-load-message', '');
}

function cancelPresetEdit() {
  presetState.editing = null; presetState.editorVersion++;
  $('#preset-editor').hidden = true;
  for (const id of ['preset-title', 'preset-description', 'preset-prompt', 'preset-sort']) $('#' + id).value = '';
  message('#preset-editor-message', '');
}

function openPresetEditor(item = null) {
  if (state.user?.role !== 'admin') return;
  presetState.editing = item; presetState.editorVersion++;
  $('#preset-editor-heading').textContent = item ? '编辑预装灵感' : '新增预装灵感';
  $('#preset-title').value = item?.title || ''; $('#preset-description').value = item?.description || ''; $('#preset-prompt').value = item?.prompt || '';
  $('#preset-sort').value = String(item?.sortOrder ?? Math.min(100000, Math.max(0, ...presetState.items.map(value => value.sortOrder)) + 10));
  $('#preset-editor').hidden = false; message('#preset-editor-message', ''); $('#preset-title').focus();
}

async function refreshInspirations(append = false) {
  const epoch = state.epoch;
  const offset = append ? state.inspirationOffset : 0;
  const result = await api('/inspirations?offset=' + offset);
  if (!state.user || epoch !== state.epoch) return;
  state.inspirations = append ? [...state.inspirations, ...result.inspirations] : result.inspirations;
  state.inspirationOffset = offset + result.inspirations.length; state.inspirationHasMore = result.hasMore;
  const list = el('div', 'inspiration-list'); state.inspirations.forEach(item => list.append(renderInspiration(item)));
  if (!state.inspirations.length) {
    const empty = el('div', 'empty-state'); const symbol = icon('lightbulb'); symbol.className = 'empty-icon';
    empty.append(symbol, uiEl('h3', '', '把喜欢的画面描述留在灵感库。'), uiEl('p', '', '在创作区写下提示词，点击“保存灵感”即可随时复用。'));
    $('#inspiration-list').replaceChildren(empty);
  } else $('#inspiration-list').replaceChildren(list);
  $('#load-more-inspirations').hidden = !result.hasMore;
}
function emptyLibrary() {
  const node = el('div', 'empty-state'); const symbol = icon('images'); symbol.className = 'empty-icon';
  node.append(symbol, uiEl('h3', '', '这里会留下你的每一次创作。'), uiEl('p', '', state.favoriteOnly ? '还没有符合条件的收藏。' : '生成图片后，可在这里查找和下载。'));
  return node;
}
function renderCurrent() {
  const job = state.current && state.jobs.get(state.current);
  if (job) $('#current-output').replaceChildren(renderJob(job));
  else {
    const empty = el('div', 'empty-state'); const symbol = icon('image-plus'); symbol.className = 'empty-icon';
    empty.append(symbol, uiEl('h3', '', '下一幅画，从一句话开始。'), uiEl('p', '', '写下画面描述，开始创作。'));
    $('#current-output').replaceChildren(empty);
  }
}
function schedulePoll() {
  clearTimeout(state.poll);
  if (state.user && [...state.jobs.values()].some(job => busyStates.has(job.status))) {
    state.poll = setTimeout(async () => {
      try { await refreshCurrent(); if (state.view === 'library') await refreshLibrary(); }
      catch (error) { toast(error.message); if (state.user) state.poll = setTimeout(schedulePoll, 10000); }
    }, 3000);
  }
}
async function refreshCurrent() {
  const epoch = state.epoch;
  const activeIds = [...state.jobs.values()].filter(job => busyStates.has(job.status)).map(job => job.id);
  const latest = await api('/jobs');
  if (!state.user || epoch !== state.epoch) return;
  latest.jobs.forEach(job => state.jobs.set(job.id, job));
  for (const id of activeIds.filter(id => !latest.jobs.some(job => job.id === id))) {
    const job = await api('/jobs/' + id);
    if (!state.user || epoch !== state.epoch) return;
    state.jobs.set(id, job);
  }
  if (!state.current && latest.jobs.length) state.current = latest.jobs[0].id;
  renderCurrent(); schedulePoll();
}
let libraryRequest = 0;
async function refreshLibrary(append = false) {
  const request = ++libraryRequest;
  const epoch = state.epoch;
  const offset = append ? state.offset : 0;
  const query = new URLSearchParams({ offset: String(offset), search: $('#search').value, favorite: String(state.favoriteOnly) });
  if (state.user.role === 'admin' && $('#library-scope').value === 'all') query.set('scope', 'all');
  const result = await api('/jobs?' + query);
  if (!state.user || epoch !== state.epoch || request !== libraryRequest) return;
  state.libraryJobs = append ? [...state.libraryJobs, ...result.jobs] : result.jobs;
  state.offset = offset + result.jobs.length; state.hasMore = result.hasMore;
  const list = el('div', 'library-jobs'); state.libraryJobs.forEach(job => list.append(renderJob(job)));
  $('#library-list').replaceChildren(state.libraryJobs.length ? list : emptyLibrary());
  $('#load-more').hidden = !result.hasMore;
}

$$('[data-auth]').forEach(button => button.addEventListener('click', () => {
  state.auth = button.dataset.auth;
  $$('[data-auth]').forEach(node => node.setAttribute('aria-pressed', String(node === button)));
  $('#invite-label').hidden = state.auth !== 'register'; $('#invite').required = state.auth === 'register';
  $('#password').autocomplete = state.auth === 'register' ? 'new-password' : 'current-password';
  $('#auth-label').textContent = state.auth === 'register' ? '注册并进入工作台' : '登录工作台';
  message('#auth-message', '');
}));
$('#show-password').addEventListener('click', () => {
  const reveal = $('#password').type === 'password'; $('#password').type = reveal ? 'text' : 'password';
  $('#show-password').setAttribute('aria-pressed', String(reveal)); $('#show-password').title = reveal ? '隐藏密码' : '显示密码'; $('#show-password').setAttribute('aria-label', $('#show-password').title); $('#show-password').dataset.icon = reveal ? 'eye-off' : 'eye'; hydrateIcons($('#auth-form'));
});
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#auth-submit').disabled = true; message('#auth-message', '正在验证账号…');
  try {
    await api('/' + state.auth, { method: 'POST', body: { username: $('#username').value.trim(), password: $('#password').value, invite: $('#invite').value.trim() } });
    $('#password').value = ''; $('#invite').value = ''; await unlock(); message('#auth-message', '');
  } catch (error) { message('#auth-message', error.message, 'error'); }
  finally { $('#auth-submit').disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  try { await api('/logout', { method: 'POST' }); lock(); message('#auth-message', '已退出登录。'); }
  catch (error) { toast(error.message); }
});
$$('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
function selectSize(size) {
  const preset = $(`[data-size="${size}"]`);
  if (preset) {
    state.sizeMode = 'preset'; state.size = size; $('#custom-size-controls').hidden = true;
  } else {
    const [width, height] = String(size).split('x');
    $('#size-width').value = width; $('#size-height').value = height;
    state.sizeMode = 'custom'; $('#custom-size-controls').hidden = false;
    const button = $('[data-size="custom"]');
    if (button) state.size = `${width}x${height}`;
  }
  const selected = preset || $('[data-size="custom"]');
  $$('[data-size]').forEach(node => node.setAttribute('aria-pressed', String(node === selected)));
  state.requestId = null;
}
$$('[data-size]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.size === 'custom') {
    state.sizeMode = 'custom'; $('#custom-size-controls').hidden = false;
    updateCustomSize();
  } else selectSize(button.dataset.size);
}));
function updateCustomSize() {
  const width = Number($('#size-width').value), height = Number($('#size-height').value);
  const valid = [width, height].every(value => Number.isInteger(value) && value >= 256 && value <= 4096 && value % 64 === 0);
  $$('[data-size]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.size === 'custom')));
  if (valid) { state.size = `${width}x${height}`; state.requestId = null; message('#generation-message', ''); }
  return valid;
}
$('#size-width').addEventListener('input', updateCustomSize);
$('#size-height').addEventListener('input', updateCustomSize);
$('#prompt').addEventListener('input', () => { $('#prompt-count').textContent = $('#prompt').value.length + ' / 8000'; state.requestId = null; });
$('#count').addEventListener('change', () => { state.requestId = null; });
$('#quality').addEventListener('change', () => { state.requestId = null; });
const examples = ['雨后的小巷，一家亮着暖黄灯光的花店，路面积水倒映橱窗，电影摄影，细腻的自然光，安静的傍晚。', '清晨的山间湖泊，薄雾轻轻掠过水面，一艘小木船停在岸边，油画笔触，柔和的绿色与银灰色。', '一只透明玻璃花瓶，三枝白色野花，落在白墙上的斑驳树影，极简静物摄影，真实的材质与光线。'];
let exampleIndex = 0;
$('#example-prompt').addEventListener('click', () => { const example = examples[exampleIndex++ % examples.length]; $('#prompt').value = window.strgoI18n?.translate(example) ?? example; $('#prompt').dispatchEvent(new Event('input')); $('#prompt').focus(); });
$('#save-inspiration').addEventListener('click', async () => {
  const prompt = $('#prompt').value.trim();
  if (!prompt) { message('#generation-message', '先写下画面描述，再保存为灵感。', 'error'); $('#prompt').focus(); return; }
  if (state.sizeMode === 'custom' && !updateCustomSize()) { message('#generation-message', '自定义宽、高需为 256–4096 范围内的 64 倍数。', 'error'); return; }
  const button = $('#save-inspiration'); button.disabled = true;
  try {
    await api('/inspirations', { method: 'POST', body: { prompt, title: prompt.split('\n')[0].slice(0, 80), size: state.size, quality: $('#quality').value, count: Number($('#count').value) } });
    message('#generation-message', '已保存到灵感库。', 'success'); toastFixed('灵感已保存到你的账号。');
  } catch (error) { message('#generation-message', error.message, 'error'); }
  finally { button.disabled = false; }
});

$('#reference-image').addEventListener('change', async () => {
  const file = $('#reference-image').files?.[0];
  clearReference({ keepSelection: true });
  if (!file) return;
  const controller = new AbortController(); referenceController = controller;
  state.referenceProcessing = true; updateGenerateButton();
  $('#reference-preview').hidden = false; $('#reference-name').textContent = file.name;
  message('#reference-status', '正在本地压缩参考图…');
  try {
    const compressed = await compressReferenceImage(file, controller.signal);
    if (controller.signal.aborted) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('参考图读取失败，请重新选择。')); reader.readAsDataURL(compressed.blob);
    });
    if (controller.signal.aborted) return;
    const encoded = String(dataUrl).split(',', 2)[1];
    if (!encoded) throw new Error('参考图读取失败，请重新选择。');
    state.reference = { mime: compressed.blob.type, data: encoded };
    state.requestId = null;
    $('#reference-thumbnail').src = dataUrl; $('#reference-thumbnail').hidden = false;
    const formatBytes = bytes => bytes < 1_000_000 ? Math.ceil(bytes / 1000) + ' KB' : (bytes / 1_000_000).toFixed(2) + ' MB';
    message('#reference-status', `${formatBytes(file.size)} → ${formatBytes(compressed.blob.size)} · ${compressed.width} × ${compressed.height} 像素`, 'success');
  } catch (error) {
    if (!controller.signal.aborted) { state.referenceError = true; message('#reference-status', error.message, 'error'); }
  } finally {
    if (referenceController === controller) { state.referenceProcessing = false; updateGenerateButton(); }
  }
});
$('#remove-reference').addEventListener('click', clearReference);
let submittedComposer = '';
const composerSnapshot = () => JSON.stringify([$('#prompt').value, state.size, $('#quality').value, $('#count').value, state.reference?.data || '']);
window.addEventListener('beforeunload', event => {
  if (state.user && ($('#prompt').value.trim() || state.reference) && composerSnapshot() !== submittedComposer) { event.preventDefault(); event.returnValue = ''; }
});
$('#generation-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.referenceProcessing || state.referenceError) { message('#generation-message', state.referenceProcessing ? '请等待参考图压缩完成。' : '请重新选择或移除无法处理的参考图。', 'error'); return; }
  if (state.generating) return;
  if (state.sizeMode === 'custom' && !updateCustomSize()) { message('#generation-message', '自定义宽、高需为 256–4096 范围内的 64 倍数。', 'error'); return; }
  state.generating = true; updateGenerateButton(); message('#generation-message', '正在提交创作…');
  const retrying = Boolean(state.requestId);
  state.requestId ||= crypto.randomUUID();
  const epoch = state.epoch;
  try {
    await refreshQuota();
    if (!state.user || epoch !== state.epoch) return;
    if (!retrying && generationQuota?.remaining != null && Number($('#count').value) > generationQuota.remaining) {
      state.requestId = null;
      message('#generation-message', '今日剩余额度不足，请减少图片数量或等待北京时间零点重置。', 'error'); return;
    }
    const submitted = composerSnapshot();
    const job = await api('/jobs', { method: 'POST', body: { prompt: $('#prompt').value, size: state.size, quality: $('#quality').value, count: Number($('#count').value), requestId: state.requestId, ...(state.reference ? { referenceImage: state.reference } : {}) } });
    if (!state.user || epoch !== state.epoch) return;
    submittedComposer = submitted;
    if (job.generationQuota) { quotaRequest++; setQuota(job.generationQuota); }
    else refreshQuota().catch(error => toast(error.message));
    state.jobs.set(job.id, job); state.current = job.id; state.requestId = null;
    renderCurrent(); schedulePoll(); message('#generation-message', '任务已创建，离开页面后仍会继续处理。', 'success');
  } catch (error) { if (state.user && epoch === state.epoch) { message('#generation-message', error.message, 'error'); refreshQuota().catch(() => {}); } }
  finally { state.generating = false; updateGenerateButton(); }
});
$('#count').addEventListener('change', () => setQuota(generationQuota));
$('#quota-mode').addEventListener('change', updateQuotaMode);
$('#quota-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.user?.role !== 'admin') return;
  const input = $('#daily-image-limit').value.trim();
  const limit = $('#quota-mode').value === 'unlimited' ? null : Number(input);
  if (limit !== null && (!input || !Number.isInteger(limit) || limit < 0 || limit > 100000)) { message('#quota-message', '请输入 0–100000 的整数。', 'error'); return; }
  const button = event.submitter; button.disabled = true;
  const epoch = state.epoch;
  try {
    const quota = await api('/generation-policy', { method: 'PUT', body: { dailyImageLimit: limit } });
    if (!state.user || epoch !== state.epoch) return;
    quotaRequest++; setQuota(quota, true); message('#quota-message', '成员每日额度已保存，立即生效。', 'success');
  } catch (error) { if (state.user && epoch === state.epoch) message('#quota-message', error.message, 'error'); }
  finally { button.disabled = false; }
});
$('#library-scope').addEventListener('change', () => {
  if (state.user?.role !== 'admin') return;
  state.favoriteOnly = false; $('#favorite-filter').setAttribute('aria-pressed', 'false');
  $('#favorite-filter').hidden = $('#library-scope').value === 'all';
  refreshLibrary().catch(error => toast(error.message));
});
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const result = await api('/config', { method: 'PUT', body: { endpoint: $('#endpoint').value.trim(), model: $('#model').value.trim(), apiKey: $('#api-key').value.trim() } });
    setConfig(result); message('#settings-message', '配置已加密保存。', 'success'); state.requestId = null;
  } catch (error) { message('#settings-message', error.message, 'error'); }
  finally { button.disabled = false; }
});
$('#password-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const result = await api('/password', { method: 'PUT', body: { oldPassword: $('#old-password').value, newPassword: $('#new-password').value } });
    state.csrf = result.csrf; $('#password-form').reset(); message('#password-message', '密码已更新，其他设备已退出登录。', 'success');
  } catch (error) { message('#password-message', error.message, 'error'); }
  finally { button.disabled = false; }
});
$('#create-invite').addEventListener('click', async () => {
  $('#create-invite').disabled = true;
  try {
    const result = await api('/invites', { method: 'POST' }); $('#invite-code').textContent = result.code; $('#invite-result').hidden = false;
    message('#admin-message', '邀请码仅显示在当前页面，请妥善保管。', 'success');
  } catch (error) { message('#admin-message', error.message, 'error'); }
  finally { $('#create-invite').disabled = false; }
});
$('#copy-invite').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#invite-code').textContent); toastFixed('邀请码已复制。'); }
  catch { toastFixed('复制失败，请手动选择邀请码。'); }
});
$('#backup').addEventListener('click', async () => {
  $('#backup').disabled = true; message('#backup-message', '正在保存加密备份…');
  try {
    const result = await api('/backup', { method: 'POST', timeout: 60000 });
    $('#backup-state').textContent = '最近备份 ' + new Date(Number(result.last) * 1000).toLocaleString('zh-CN'); message('#backup-message', '加密备份成功。', 'success');
  } catch (error) { message('#backup-message', error.message, 'error'); }
  finally { $('#backup').disabled = false; }
});
$('#refresh-jobs').addEventListener('click', () => refreshCurrent().catch(error => toast(error.message)));
$('#refresh-library').addEventListener('click', () => refreshLibrary().catch(error => toast(error.message)));
$('#load-more').addEventListener('click', () => refreshLibrary(true).catch(error => toast(error.message)));
$('#refresh-inspirations').addEventListener('click', () => refreshInspirations().catch(error => toast(error.message)));
$('#refresh-presets').addEventListener('click', () => refreshPresets().catch(presetLoadError));
$('#preset-search').addEventListener('input', renderPresetManagement);
$('#new-preset').addEventListener('click', () => openPresetEditor());
$('#preset-cancel').addEventListener('click', cancelPresetEdit);
$('#preset-editor').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.user?.role !== 'admin' || $('#preset-save').disabled) return;
  const item = presetState.editing, version = presetState.editorVersion, owner = state.user.id;
  const body = { title: $('#preset-title').value.trim(), description: $('#preset-description').value.trim(), prompt: $('#preset-prompt').value.trim(), sortOrder: Number($('#preset-sort').value), ...(item ? { updated: item.updated } : {}) };
  if (!body.title || !body.prompt || !Number.isInteger(body.sortOrder) || body.sortOrder < 0 || body.sortOrder > 100000) { message('#preset-editor-message', '请填写名称、提示词和有效的排序值。', 'error'); return; }
  $('#preset-save').disabled = true;
  try {
    const saved = await api('/preset-inspirations' + (item ? '/' + item.id : ''), { method: item ? 'PUT' : 'POST', body });
    if (state.user?.id !== owner) return;
    presetState.request++;
    presetState.items = [...presetState.items.filter(value => value.id !== saved.id), saved].sort((a, b) => a.sortOrder - b.sortOrder || a.created - b.created || a.id.localeCompare(b.id));
    if (version === presetState.editorVersion) cancelPresetEdit();
    renderPresetInspirations(); renderPresetManagement(); message('#presets-message', '预装灵感已保存，所有账号下次加载时生效。', 'success');
  } catch (error) { if (state.user?.id === owner && version === presetState.editorVersion) message('#preset-editor-message', error.message, 'error'); }
  finally { $('#preset-save').disabled = false; }
});
$('#load-more-inspirations').addEventListener('click', () => refreshInspirations(true).catch(error => toast(error.message)));
let searchTimer;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshLibrary().catch(error => toast(error.message)), 300); });
$('#favorite-filter').addEventListener('click', () => { state.favoriteOnly = !state.favoriteOnly; $('#favorite-filter').setAttribute('aria-pressed', String(state.favoriteOnly)); refreshLibrary().catch(error => toast(error.message)); });
$('#close-image').addEventListener('click', () => $('#image-dialog').close());
$('#image-dialog').addEventListener('click', event => { if (event.target === $('#image-dialog')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close(); } });
$('#reuse-prompt').addEventListener('click', () => {
  if (!state.preview) return;
  $('#prompt').value = state.preview.job.prompt; $('#prompt').dispatchEvent(new Event('input'));
  selectSize(state.preview.job.size);
  $('#quality').value = state.preview.job.quality; $('#count').value = String(state.preview.job.count);
  $('#image-dialog').close(); showView('create'); $('#prompt').focus();
});
window.addEventListener('hashchange', () => { const view = location.hash.slice(1); if (['create', 'library', 'inspirations', 'settings'].includes(view)) showView(view); });
window.addEventListener('pagehide', () => { clearTimeout(state.poll); clearTimeout(searchTimer); clearTimeout(toastTimer); clearTimeout(quotaTimer); });
document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(state.poll); else if (state.user) { refreshCurrent().catch(error => toast(error.message)); refreshQuota().catch(error => toast(error.message)); } });
hydrateIcons();
renderPresetInspirations();
api('/session').then(async info => {
  $('#auth-submit').disabled = false; message('#auth-message', '');
  if (info.user) await unlock();
}).catch(error => { $('#auth-submit').disabled = false; message('#auth-message', error.message, 'error'); });
