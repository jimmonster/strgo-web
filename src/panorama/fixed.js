import { requestJSON } from '../shared/catalog.js';
import { translate as t } from '../shared/i18n.js';
import { compressReferenceImage } from '../image-playground/reference-image.js';

const idValid = id => /^[a-f0-9]{32}$/.test(id || '');
const active = project => ['queued', 'submitting', 'generating'].includes(project?.status);
const label = index => `${t('机位')} ${index + 1}`;

export function setupFixedTours({ captureSelection, showResult, readCurrent }) {
  const $ = selector => document.querySelector(selector), panel = $('#fixed-generation-panel');
  let session, project, projects = [], pending, reference, referenceURL, referenceName = '', isPano = false;
  let expanded = false, enabled = false, busy = false, processing = false, rendering = false, referenceFailed = false, quota;
  let initialized = false, epoch = 0, connection = 0, inputVersion = 0, selection, timer, frame, frameCancel;
  let controller = new AbortController(), referenceController = new AbortController();
  let frames = [], displayed = -1, message = '', failed = false;
  const api = (path = '', options = {}) => requestJSON('/api/image/panorama-tours' + path, { ...options, csrf: session?.csrf, signal: controller.signal });
  function status(text, error = false) { message = text; failed = error; $('#fixed-status').textContent = t(text); $('#fixed-status').classList.toggle('error', error); }
  function error(value) { $('#fixed-error').hidden = !value; $('#fixed-error').textContent = value?.message || ''; }
  function remember(value) {
    try { const key = 'strgo.panorama.tour.' + session.user.id; if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* Reading projects also recovers accepted submissions. */ }
  }
  function update() {
    const frozen = busy || processing || rendering || active(project) || !!pending;
    $('#fixed-workspace').hidden = !session?.user;
    $('#fixed-login').hidden = !!session?.user;
    $('#generate-fixed-panorama').disabled = !session?.user || busy || rendering || processing || active(project) || (!pending && (!enabled || referenceFailed || quota?.remaining === 0));
    $('#generate-fixed-panorama').textContent = t(busy || active(project) ? '生成中…' : pending ? '重试提交' : '生成固定机位全景');
    for (const id of ['fixed-scene', 'fixed-camera-count', 'fixed-reference', 'fixed-use-current', 'fixed-remove-reference']) $('#' + id).disabled = frozen;
    $('#fixed-generation-form').setAttribute('aria-busy', String(busy || processing || rendering));
    $('#fixed-refresh-job').hidden = !project; $('#fixed-refresh-job').disabled = busy || rendering;
    $('#fixed-open-project').hidden = project?.status !== 'ready'; $('#fixed-open-project').disabled = busy || rendering;
    $('#fixed-quota').textContent = !quota ? '' : quota.remaining == null ? t('当前账号空间额度不限。') : `${t('今日剩余空间数：')}${quota.remaining}`;
    $('#fixed-reference-preview').hidden = !referenceURL;
    $('#fixed-remove-reference').hidden = !referenceURL && !referenceFailed;
    $('#fixed-reference-info').textContent = referenceName;
    status(message, failed);
  }
  function clearReference() {
    inputVersion++; referenceController.abort(); referenceController = new AbortController();
    if (referenceURL) URL.revokeObjectURL(referenceURL);
    referenceURL = reference = null; referenceName = ''; isPano = processing = referenceFailed = false;
    $('#fixed-reference-image').removeAttribute('src'); $('#fixed-reference').value = ''; update();
  }
  function clearFrames() {
    frameCancel?.(); frameCancel = null; frame?.remove(); frame = null;
    rendering = false; frames = []; displayed = -1;
    $('#fixed-camera-buttons').replaceChildren(); $('#fixed-camera-bar').hidden = true;
  }
  function clearPrivate() {
    epoch++; connection++; clearTimeout(timer); controller.abort(); controller = new AbortController();
    clearFrames(); clearReference(); pending = project = session = null; projects = []; busy = false;
    $('#fixed-scene').value = ''; $('#fixed-projects').replaceChildren(); error(); update();
  }
  async function verify() {
    const ticket = epoch, owner = session?.user?.id;
    const info = await requestJSON('/api/image/session', { signal: controller.signal });
    if (ticket !== epoch || document.hidden) throw new DOMException('Aborted', 'AbortError');
    if (!owner || info.user?.id !== owner) { clearPrivate(); throw new Error('账号已变化，请重新选择作品。'); }
    session = info;
  }
  function renderProjects() {
    $('#fixed-projects').replaceChildren();
    for (const value of projects) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.tourId = value.id;
      button.textContent = `${value.scene || t('图片创建的空间')} · ${value.cameraCount} ${t('固定机位')}`;
      button.setAttribute('data-strgo-user-content', '');
      button.addEventListener('click', () => { if (!busy && !rendering && !pending && !active(project)) { project = value; selection = captureSelection(); refresh(); } });
      $('#fixed-projects').append(button);
    }
  }
  async function connect() {
    initialized = true; const serial = ++connection, ticket = epoch;
    try {
      const info = await requestJSON('/api/image/session', { signal: controller.signal });
      if (serial !== connection || ticket !== epoch || document.hidden) return;
      if (session?.user?.id && session.user.id !== info.user?.id) clearPrivate();
      session = info;
      if (!info.user) { status('请先登录后使用文生图。'); update(); return; }
      const connectedEpoch = epoch, data = await api();
      if (connectedEpoch !== epoch || document.hidden) return;
      enabled = data.enabled === true; quota = data.quota; projects = Array.isArray(data.projects) ? data.projects.filter(value => idValid(value.id) && value.userId === info.user.id) : [];
      let remembered; try { remembered = sessionStorage.getItem('strgo.panorama.tour.' + info.user.id); } catch { /* Optional recovery hint. */ }
      if (!project) project = projects.find(value => value.id === remembered || value.requestId === remembered) || projects.find(active);
      if (project && !pending) remember(project.id);
      renderProjects(); error();
      status(!enabled ? '管理员尚未配置空间模型，暂不能生成固定机位全景。' : '输入文字或选择示例图，即可生成固定机位全景。'); update();
      if (active(project)) refresh();
    } catch (value) { if (value.name !== 'AbortError' && ticket === epoch) { status('无法连接空间服务，请刷新连接。', true); error(value); update(); } }
  }
  async function chooseReference(blob, name, pano = false) {
    clearReference(); processing = true; update(); const serial = inputVersion, ticket = epoch;
    try {
      const compressed = await compressReferenceImage(blob, referenceController.signal);
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('示例图读取失败。')); reader.readAsDataURL(compressed.blob); });
      if (serial !== inputVersion || ticket !== epoch || document.hidden) return;
      reference = { mime: compressed.blob.type, data }; referenceName = name; isPano = pano;
      referenceURL = URL.createObjectURL(compressed.blob); $('#fixed-reference-image').src = referenceURL; error();
    } catch (value) { if (value.name !== 'AbortError' && ticket === epoch && serial === inputVersion) { referenceFailed = true; error(value); } }
    finally { if (serial === inputVersion && ticket === epoch) { processing = false; update(); } }
  }
  async function display(index, auto = false) {
    if (!frames[index] || !project) return false;
    const ticket = epoch, value = project;
    try {
      await verify();
      const shown = await showResult({ kind: 'ai', owner: session.user.id, file: frames[index], skipSave: true, tourId: value.id, cameraIndex: index,
        name: (value.scene || t('图片创建的空间')).split('\n')[0].slice(0, 100) + ' · ' + label(index), content: value.scene,
        preserveView: displayed >= 0 }, auto ? selection : undefined);
      if (ticket !== epoch) return false;
      if (shown) { displayed = index; selectionChanged({ tourId: value.id, cameraIndex: index }); }
      return shown;
    } catch (value) { if (ticket === epoch && value.name !== 'AbortError') error(value); return false; }
  }
  function selectionChanged(source) {
    const visible = project && source.tourId === project.id && frames.length === project.cameraCount;
    $('#fixed-camera-bar').hidden = !visible;
    if (visible) {
      displayed = source.cameraIndex;
      $('#fixed-camera-buttons').querySelectorAll('button').forEach((button, index) => button.setAttribute('aria-pressed', String(index === displayed)));
    }
  }
  async function renderProject() {
    if (rendering || project?.status !== 'ready') return;
    if (frames.length === project.cameraCount) { await display(0); return; }
    clearFrames(); rendering = true; update(); const ticket = epoch, value = project;
    try {
      await verify(); status('正在输出固定机位全景…');
      await new Promise((resolve, reject) => {
        let timeout;
        const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', receive); frame?.remove(); frame = null; frameCancel = null; };
        const finish = failure => { cleanup(); failure ? reject(failure) : resolve(); };
        frameCancel = () => finish(new DOMException('Aborted', 'AbortError'));
        const receive = event => {
          if (event.origin !== location.origin || event.source !== frame?.contentWindow || ticket !== epoch) return;
          if (event.data?.type === 'strgo:fixed-render-ready') frame.contentWindow.postMessage({ type: 'strgo:render-fixed', project: value }, location.origin);
          else if (event.data?.type === 'strgo:fixed-panorama') {
            const { index, bytes, mime } = event.data;
            if (!Number.isInteger(index) || index < 0 || index >= value.cameraCount || !(bytes instanceof ArrayBuffer) || bytes.byteLength > 40 * 1024 * 1024 || !['image/png', 'image/webp'].includes(mime)) { finish(new Error('固定机位图片返回格式异常。')); return; }
            frames[index] = new Blob([bytes], { type: mime });
          } else if (event.data?.type === 'strgo:fixed-complete') {
            if (Array.from({ length: value.cameraCount }, (_, index) => frames[index]).some(blob => !blob?.size)) finish(new Error('固定机位图片未完整生成，请重新打开项目。'));
            else finish();
          } else if (event.data?.type === 'strgo:fixed-error') finish(new Error('固定机位渲染失败，请重新打开项目；不会重新调用生成模型。'));
        };
        window.addEventListener('message', receive);
        frame = document.createElement('iframe'); frame.src = '/360/fixed-render.html'; frame.title = 'Panorama renderer'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
        frame.className = 'fixed-render-frame'; document.body.append(frame);
        timeout = setTimeout(() => finish(new Error('固定机位渲染超时，请重新打开项目；不会重新生成空间。')), 240000);
      });
      if (ticket !== epoch) return;
      await verify();
      $('#fixed-camera-buttons').replaceChildren();
      frames.forEach((_, index) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label(index); button.dataset.fixedCamera = String(index); button.setAttribute('aria-pressed', 'false'); button.addEventListener('click', () => display(index)); $('#fixed-camera-buttons').append(button); });
      const shown = await display(0, true); status(shown ? '固定机位全景已就绪，点击机位即可切换。' : '固定机位全景已就绪，点击打开固定机位。');
    } catch (value) { if (ticket === epoch && value.name !== 'AbortError') { clearFrames(); status('固定机位渲染失败，可重新打开项目。', true); error(value); } }
    finally { if (ticket === epoch) { rendering = false; update(); } }
  }
  async function refresh() {
    if (!project || busy || rendering || document.hidden) return;
    busy = true; update(); clearTimeout(timer); const ticket = epoch, identifier = project.id;
    try {
      await verify(); const value = await api('/' + identifier);
      if (ticket !== epoch || document.hidden || value.userId !== session.user.id || value.id !== identifier) return;
      project = value; error();
      if (active(value)) { status('正在生成共同空间，请稍候…'); timer = setTimeout(refresh, 5000); }
      else if (value.status === 'ready') { busy = false; await renderProject(); }
      else { status('空间生成未完成，请查看错误信息。', true); error(new Error(value.error || '空间生成失败。')); }
    } catch (value) { if (ticket === epoch && value.name !== 'AbortError') { status('状态读取失败，点击刷新继续。', true); error(value); } }
    finally { if (ticket === epoch) { busy = false; update(); } }
  }
  $('#fixed-generation-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || rendering || processing || referenceFailed || active(project) || !session?.user) return;
    const ticket = epoch; busy = true; error(); update();
    try {
      await verify();
      if (!pending) {
        const scene = $('#fixed-scene').value.trim(); if (!scene && !reference) throw new Error('请输入场景文字或选择一张示例图。');
        pending = { scene, cameraCount: Number($('#fixed-camera-count').value), requestId: crypto.randomUUID(), isPano, ...(reference ? { referenceImage: reference } : {}) };
        selection = captureSelection(); remember(pending.requestId); clearFrames();
      }
      const value = await api('', { method: 'POST', body: pending });
      if (ticket !== epoch || document.hidden) return;
      if (!idValid(value.id) || value.userId !== session.user.id) throw new Error('任务账号不匹配，请刷新连接。');
      project = value; quota = value.quota || quota; pending = null; remember(value.id); clearReference();
      projects = [value, ...projects.filter(item => item.id !== value.id)]; renderProjects(); status('正在生成共同空间，请稍候…');
    } catch (value) {
      if (ticket === epoch && value.name !== 'AbortError') { if (value.status >= 400 && value.status < 500) pending = null; error(value); status(pending ? '提交结果尚未确认，请重试同一次提交。' : '暂时无法生成全景，请检查后重试。', true); }
    } finally { if (ticket === epoch) { busy = false; update(); if (project && active(project)) refresh(); else if (project?.status === 'ready') renderProject(); } }
  });
  $('#fixed-reference').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) chooseReference(file, file.name); });
  $('#fixed-remove-reference').addEventListener('click', clearReference);
  $('#fixed-use-current').addEventListener('click', async () => { const ticket = epoch; try { const value = await readCurrent(); if (ticket === epoch) await chooseReference(value.blob, value.name, true); } catch (value) { if (ticket === epoch && value.name !== 'AbortError') error(value); } });
  $('#fixed-refresh-job').addEventListener('click', refresh);
  $('#fixed-open-project').addEventListener('click', renderProject);
  $('#fixed-connect').addEventListener('click', connect);
  $('#open-fixed-generation').addEventListener('click', () => { expanded = true; panel.hidden = false; $('#open-fixed-generation').setAttribute('aria-expanded', 'true'); panel.scrollIntoView({ block: 'start' }); connect(); });
  $('#close-fixed-generation').addEventListener('click', () => { expanded = false; panel.hidden = true; $('#open-fixed-generation').setAttribute('aria-expanded', 'false'); $('#open-fixed-generation').focus(); });
  $('#download-fixed-panorama').addEventListener('click', async () => {
    const ticket = epoch, index = displayed;
    try { await verify(); if (ticket !== epoch || !frames[index]) return; const link = document.createElement('a'), url = URL.createObjectURL(frames[index]); link.href = url; link.download = 'strgo-' + project.id + '-camera-' + (index + 1) + (frames[index].type === 'image/png' ? '.png' : '.webp'); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (value) { if (ticket === epoch && value.name !== 'AbortError') error(value); }
  });
  window.addEventListener('strgo:localechange', () => { renderProjects(); $('#fixed-camera-buttons').querySelectorAll('button').forEach((button, index) => { button.textContent = label(index); }); update(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearPrivate(); panel.hidden = true; } else if (initialized) { panel.hidden = !expanded; connect(); } });
  window.addEventListener('focus', () => { if (initialized && !document.hidden) connect(); });
  window.addEventListener('pagehide', clearPrivate);
  window.addEventListener('pageshow', event => { if (event.persisted && initialized) { panel.hidden = !expanded; connect(); } });
  return { selectionChanged };
}
