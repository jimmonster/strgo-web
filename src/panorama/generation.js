import { requestJSON } from '../shared/catalog.js';
import { translate as t } from '../shared/i18n.js';
import { assetPath } from './core.js';

export function panoramaPrompt(scene, template) {
  scene = String(scene || '').trim(); template = String(template || '').trim();
  if (!scene || scene.length > 4000) throw new Error('场景描述需为 1 至 4000 个字符。');
  if (!template) throw new Error('请先选择全景提示词模板。');
  const prompt = scene + '\n\n' + template;
  if (prompt.length > 8000) throw new Error('场景与模板合计最多 8000 个字符。');
  return prompt;
}

const running = job => ['queued', 'generating', 'uploading'].includes(job?.status);
const validId = id => /^[a-f0-9]{32}$/.test(id || '');
const jobKey = owner => 'strgo.panorama.job.' + owner;

export function setupGeneration({ captureSelection, showResult }) {
  const $ = selector => document.querySelector(selector), panel = $('#generation-panel');
  let session, verified = false, expanded = false, initialized = false, disposed = false;
  let epoch = 0, connectionSerial = 0, presetSerial = 0, controller = new AbortController(), timer;
  let presets = [], selected, templatesReady = false, editing, saving = false;
  let pending, job, result, submittedScene = '', selection, posting = false, polling = false, applied = false;
  let feedback = '', failed = false, presetFeedback = '';
  const api = (path, options = {}) => requestJSON('/api/image' + path, { ...options, csrf: session?.csrf, signal: controller.signal });
  function status(text, error = false) { feedback = text; failed = error; $('#generation-status').textContent = t(text); $('#generation-status').classList.toggle('error', error); }
  function serverError(error) { $('#panorama-job-error').textContent = error.message; $('#panorama-job-error').hidden = false; }
  function clearError() { $('#panorama-job-error').textContent = ''; $('#panorama-job-error').hidden = true; }
  function rememberJob(id) {
    try { if (id) sessionStorage.setItem(jobKey(session.user.id), id); else sessionStorage.removeItem(jobKey(session.user.id)); } catch { /* In-memory polling still works. */ }
  }
  function update() {
    const user = verified && session?.user, active = posting || polling || running(job), frozen = active || !!pending;
    $('#generation-workspace').hidden = !user;
    $('#generation-login').hidden = !!user;
    $('#generation-settings').hidden = !user || !!session.config?.hasKey;
    $('#generation-connect').hidden = !!user && !!session.config?.hasKey && !!session.storageReady;
    $('#new-panorama-preset').hidden = !user || user.role !== 'admin';
    $('#generate-panorama').disabled = !user || active || (!pending && (!templatesReady || !selected || !session.config?.hasKey || !session.storageReady || session.generationQuota?.remaining === 0));
    $('#generate-panorama').textContent = t(posting || running(job) ? '生成中…' : pending ? '重试提交' : '生成并展示');
    $('#panorama-scene').disabled = frozen;
    $('#panorama-scene').placeholder = t('例如：阳光下的校园广场，四周是教学楼、树木和喷泉。');
    $('#save-panorama-preset').disabled = saving;
    panel.setAttribute('aria-busy', String(posting || polling));
    $('#refresh-panorama-job').hidden = !job;
    $('#refresh-panorama-job').disabled = posting || polling;
    $('#show-generated-panorama').hidden = !result;
    $('#show-generated-panorama').disabled = posting || polling;
    $('#panorama-preset-status').textContent = t(presetFeedback);
    const quota = session?.generationQuota;
    $('#panorama-quota').textContent = !user || !quota ? '' : quota.remaining == null ? t('当前账号生图额度不限。') : `${t('今日剩余张数：')}${quota.remaining}`;
    status(feedback, failed);
    document.querySelectorAll('[data-select-panorama-preset]').forEach(button => { button.disabled = frozen; });
  }
  function closeEditor() {
    editing = undefined; $('#panorama-preset-form').hidden = true;
    $('#panorama-preset-form').reset(); $('#panorama-preset-error').textContent = '';
  }
  function reset() {
    epoch++; connectionSerial++; presetSerial++; clearTimeout(timer); controller.abort(); controller = new AbortController();
    session = null; verified = false; pending = job = result = selected = null;
    presets = []; templatesReady = posting = polling = saving = applied = false; submittedScene = '';
    $('#panorama-scene').value = ''; $('#panorama-presets').replaceChildren(); closeEditor(); clearError();
    presetFeedback = ''; update();
  }
  async function checkSession() {
    const owner = session?.user?.id, ticket = epoch;
    const info = await api('/session');
    if (ticket !== epoch || document.hidden || disposed) throw new DOMException('Aborted', 'AbortError');
    if (!owner || info.user?.id !== owner) {
      reset(); status('账号已变化，请重新选择作品。', true); update();
      throw new DOMException('Aborted', 'AbortError');
    }
    session = info; verified = true;
    if (info.user.role !== 'admin') closeEditor();
    return info;
  }
  function failure(error, text) {
    if (error.status === 401) { reset(); status('请先登录后使用文生图。', true); }
    else if (error.name !== 'AbortError') { status(text, true); serverError(error); }
    update();
  }
  function renderPresets() {
    const list = $('#panorama-presets'); list.replaceChildren();
    for (const item of presets) {
      const card = document.createElement('article'); card.className = 'panorama-preset'; card.dataset.panoramaPreset = item.id;
      card.classList.toggle('is-selected', selected?.id === item.id);
      const title = document.createElement('h4'); title.textContent = item.title; title.setAttribute('data-strgo-user-content', '');
      const description = document.createElement('p'); description.className = 'fine'; description.textContent = item.description; description.setAttribute('data-strgo-user-content', '');
      const details = document.createElement('details'), summary = document.createElement('summary'), prompt = document.createElement('p');
      summary.textContent = t('查看全景提示词'); prompt.textContent = item.prompt; prompt.setAttribute('data-strgo-user-content', ''); details.append(summary, prompt);
      const actions = document.createElement('div'); actions.className = 'item-actions';
      const choose = document.createElement('button'); choose.type = 'button'; choose.dataset.selectPanoramaPreset = item.id;
      choose.textContent = t(selected?.id === item.id ? '已选用' : '选用模板'); choose.setAttribute('aria-pressed', String(selected?.id === item.id));
      choose.addEventListener('click', () => { selected = item; renderPresets(); }); actions.append(choose);
      if (session?.user?.role === 'admin') {
        const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.editPanoramaPreset = item.id; edit.textContent = t('编辑全景模板');
        edit.addEventListener('click', () => openEditor(item)); actions.append(edit);
      }
      card.append(title, description, actions, details); list.append(card);
    }
    update();
  }
  async function refreshPresets() {
    const ticket = epoch, serial = ++presetSerial;
    templatesReady = false; presetFeedback = '正在读取全景模板…'; update();
    try {
      const data = await api('/panorama-presets');
      if (ticket !== epoch || serial !== presetSerial || document.hidden) return;
      if (!Array.isArray(data.presets)) throw new Error('全景模板返回格式异常。');
      presets = data.presets;
      selected = presets.find(item => item.id === selected?.id) || presets[0]; templatesReady = true;
      presetFeedback = presets.length ? '' : '暂时没有全景模板，请联系管理员。'; renderPresets();
    } catch (error) {
      if (ticket !== epoch || serial !== presetSerial) return;
      presetFeedback = '模板加载失败，请刷新后重试。'; failure(error, presetFeedback);
    }
  }
  async function connect() {
    initialized = true; const ticket = epoch, serial = ++connectionSerial;
    verified = false; status('正在连接生图服务…'); update();
    try {
      const info = await api('/session');
      if (ticket !== epoch || serial !== connectionSerial || document.hidden || disposed) return;
      if (session?.user?.id && session.user.id !== info.user?.id) reset();
      session = info; verified = true; clearError();
      const connectedEpoch = epoch;
      panel.hidden = !expanded;
      if (!info.user) { status('请先登录后使用文生图。'); update(); return; }
      if (info.user.role !== 'admin') closeEditor();
      status(!info.config?.hasKey ? '先配置生图接口，再生成全景。' : !info.storageReady ? '服务器存储尚未就绪，暂不能生成图片。' : pending ? '提交结果尚未确认，请重试同一次提交。' : '请输入场景描述，生成后将在此页展示。');
      await refreshPresets();
      if (connectedEpoch !== epoch || session?.user?.id !== info.user.id || document.hidden) return;
      if (!job) {
        let id; try { id = sessionStorage.getItem(jobKey(info.user.id)); } catch { /* Storage may be disabled. */ }
        if (validId(id)) { job = { id, status: 'queued' }; selection = captureSelection(); }
      }
      update(); if (running(job)) poll();
    } catch (error) { if (ticket === epoch && serial === connectionSerial) failure(error, '无法连接生图服务，请刷新连接。'); }
  }
  async function display(force = false) {
    if (!result) return;
    const ticket = epoch;
    try {
      await checkSession();
      const shown = await showResult(result, force ? undefined : selection);
      if (ticket !== epoch || document.hidden) return;
      status(shown ? '全景已在上方展示。' : '图片已生成，可点击在 360° 中打开。', !shown);
    } catch (error) { if (ticket === epoch) failure(error, '图片已生成，可点击在 360° 中打开。'); }
  }
  async function poll() {
    if (!job || polling || posting || document.hidden || disposed) return;
    clearTimeout(timer); polling = true; const ticket = epoch, id = job.id; let successful = false; update();
    try {
      await checkSession();
      const value = await api('/jobs/' + id);
      if (ticket !== epoch || document.hidden || job?.id !== id) return;
      if (value.userId !== session.user.id || !validId(value.id)) throw new Error('任务账号不匹配，请刷新连接。');
      job = value; clearError();
      successful = true;
      status(({ queued: '等待生成全景…', generating: '正在生成全景…', uploading: '正在保存全景…', failed: '生成失败，请查看错误信息。' })[job.status] || '生成已完成，正在打开全景…', job.status === 'failed');
      if (job.error) serverError(new Error(job.error));
      const image = job.images?.find(item => item.state === 'saved' && validId(item.id));
      if (image && !applied) {
        applied = true;
        const scene = submittedScene || job.prompt;
        result = { kind: 'ai', url: assetPath(image.id), owner: session.user.id, name: scene.split('\n')[0].slice(0, 80), content: scene.slice(0, 5000) };
        await display();
      }
      if (!running(job)) {
        rememberJob(null);
        if (!image && job.status !== 'failed') status('图片尚未保存，请刷新状态或到作品库检查。', true);
      }
    } catch (error) {
      if (ticket === epoch) {
        if (error.status === 404 || error.status === 410) { rememberJob(null); job = result = null; }
        failure(error, '状态读取失败，点击刷新继续。');
      }
    }
    finally {
      if (ticket === epoch) { polling = false; update(); if (successful && running(job)) timer = setTimeout(poll, 2500); }
    }
  }
  $('#panorama-generation-form').addEventListener('submit', async event => {
    event.preventDefault(); if (posting || polling || running(job) || !verified || !session?.user) return;
    const ticket = epoch; posting = true; clearError(); update();
    try {
      await checkSession();
      if (!pending) {
        if (!session.config?.hasKey || !session.storageReady || session.generationQuota?.remaining === 0 || !templatesReady || !selected) throw new Error('请检查接口、模板、存储状态及剩余额度。');
        const scene = $('#panorama-scene').value.trim();
        // Read the selected server revision at submission time, so an already
        // open page also uses an administrator's latest template changes.
        const latest = await api('/panorama-presets/' + selected.id);
        if (ticket !== epoch || document.hidden) return;
        selected = latest; presets = presets.map(item => item.id === latest.id ? latest : item); renderPresets();
        pending = { prompt: panoramaPrompt(scene, latest.prompt), size: '2048x1024', quality: '', count: 1, requestId: crypto.randomUUID() };
        submittedScene = scene; selection = captureSelection();
        job = result = null; applied = false;
      }
      status('正在提交全景任务…'); update();
      const value = await api('/jobs', { method: 'POST', body: pending });
      if (ticket !== epoch || document.hidden) return;
      if (!validId(value.id) || value.userId !== session.user.id) throw new Error('任务账号不匹配，请刷新连接。');
      job = value; pending = null; result = null; applied = false;
      if (job.generationQuota) session.generationQuota = job.generationQuota;
      rememberJob(job.id); status('等待生成全景…');
    } catch (error) {
      if (error.status >= 400 && error.status < 500) pending = null;
      if (ticket === epoch) failure(error, pending ? '提交结果尚未确认，请重试同一次提交。' : '暂时无法生成全景，请检查后重试。');
    } finally {
      if (ticket === epoch) { posting = false; update(); if (job) poll(); }
    }
  });
  function openEditor(item) {
    if (session?.user?.role !== 'admin' || saving) return;
    editing = item || null; $('#panorama-preset-form').hidden = false;
    $('#panorama-preset-editor-heading').textContent = t(item ? '编辑全景模板' : '新增模板');
    $('#panorama-preset-title').value = item?.title || ''; $('#panorama-preset-description').value = item?.description || ''; $('#panorama-preset-prompt').value = item?.prompt || '';
    $('#panorama-preset-error').textContent = ''; $('#panorama-preset-title').focus();
  }
  $('#panorama-preset-form').addEventListener('submit', async event => {
    event.preventDefault(); if (saving || session?.user?.role !== 'admin') return;
    const ticket = epoch, item = editing;
    const body = { title: $('#panorama-preset-title').value, description: $('#panorama-preset-description').value, prompt: $('#panorama-preset-prompt').value,
      sortOrder: item?.sortOrder || 0, ...(item ? { updated: item.updated } : {}) };
    saving = true; $('#save-panorama-preset').disabled = true;
    try {
      await checkSession();
      if (session.user.role !== 'admin') throw new Error('仅管理员可管理预装灵感。');
      const saved = await api('/panorama-presets' + (item ? '/' + item.id : ''), { method: item ? 'PUT' : 'POST', body });
      if (ticket !== epoch || document.hidden) return;
      selected = saved; closeEditor(); await refreshPresets(); presetFeedback = '全景模板已保存。'; update();
    } catch (error) { if (ticket === epoch) { if (error.status === 401) failure(error, '请先登录后使用文生图。'); else $('#panorama-preset-error').textContent = error.message; } }
    finally { if (ticket === epoch) { saving = false; $('#save-panorama-preset').disabled = false; } }
  });
  $('#open-generation').addEventListener('click', async () => {
    expanded = true; panel.hidden = false; $('#open-generation').setAttribute('aria-expanded', 'true');
    panel.scrollIntoView({ block: 'start' }); await connect();
    if (verified && session?.user && !pending && !running(job)) $('#panorama-scene').focus({ preventScroll: true });
  });
  $('#close-generation').addEventListener('click', () => { expanded = false; panel.hidden = true; $('#open-generation').setAttribute('aria-expanded', 'false'); $('#open-generation').focus(); });
  $('#ai-generate-inline').addEventListener('click', () => { $('#ai-dialog').close(); $('#open-generation').click(); });
  $('#generation-connect').addEventListener('click', connect);
  $('#refresh-panorama-presets').addEventListener('click', refreshPresets);
  $('#new-panorama-preset').addEventListener('click', () => openEditor());
  $('#cancel-panorama-preset').addEventListener('click', closeEditor);
  $('#refresh-panorama-job').addEventListener('click', poll);
  $('#show-generated-panorama').addEventListener('click', () => display(true));
  window.addEventListener('strgo:localechange', () => { renderPresets(); update(); });
  document.addEventListener('visibilitychange', () => {
    if (!initialized) return;
    if (document.hidden) {
      epoch++; connectionSerial++; presetSerial++; controller.abort(); controller = new AbortController(); clearTimeout(timer);
      posting = polling = saving = verified = false; panel.hidden = true;
    } else connect();
  });
  window.addEventListener('focus', () => { if (initialized && !document.hidden) connect(); });
  window.addEventListener('pagehide', event => {
    epoch++; connectionSerial++; presetSerial++; controller.abort(); clearTimeout(timer);
    if (!event.persisted) disposed = true;
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { controller = new AbortController(); posting = polling = false; if (initialized) connect(); } });
}
