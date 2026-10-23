import { compressReferenceImage } from './reference-image.js';

const $ = selector => document.querySelector(selector);
const base = '/api/image/local-studio';
const names = { queued: '等待本机执行', running: '本机正在生成', complete: '已完成', failed: '未完成' };
let user = null, csrf = '', workflows = [], online = false, reference = null, referenceController = null;
let processing = false, submitting = false, requestId = null, timer = null, epoch = 0, signature = '', refreshSerial = 0;
const node = (tag, className, text) => { const element = document.createElement(tag); element.className = className || ''; if (text) element.textContent = text; return element; };

async function api(path, body) {
  const version = epoch;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let result;
    try { result = await response.json(); } catch { throw new Error('创作台服务尚未部署或返回异常。'); }
    if (!response.ok) {
      if ([401, 403].includes(response.status) && path !== '/login' && version === epoch) lock();
      throw new Error(result.error || '操作未完成。');
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时；再次提交会沿用本次请求编号。');
    if (error.name === 'TypeError') throw new Error('暂时无法连接创作台，请检查网络。');
    throw error;
  } finally { clearTimeout(timeout); }
}
function clearReference() {
  referenceController?.abort(); referenceController = null; reference = null; processing = false;
  $('#reference').value = ''; $('#reference-preview').hidden = true; $('#reference-preview').removeAttribute('src');
  $('#reference-status').textContent = '图片会压缩至 2 MB 内。';
  updateButton();
}
function lock() {
  epoch++; clearTimeout(timer); user = null; csrf = ''; online = false; signature = ''; requestId = null;
  clearReference(); $('#studio').hidden = true; $('#auth').hidden = false; $('#logout').hidden = true;
  $('#account-name').textContent = 'ADMINISTRATOR'; $('#password').value = ''; $('#prompt').value = ''; $('#jobs').replaceChildren();
}
function updateButton() {
  const selected = workflows.find(item => item.id === $('#workflow').value);
  $('#generate').disabled = !user || !online || !selected || submitting || processing || (selected.reference && !reference);
}
function selectWorkflow() {
  const selected = workflows.find(item => item.id === $('#workflow').value);
  $('#workflow-description').textContent = selected?.description || '连接本机后会显示可用工作流。';
  $('#reference-section').hidden = !selected?.reference;
  clearReference(); requestId = null; updateButton();
}
function renderStatus(info) {
  online = info.online && !info.draining;
  $('#connection-dot').classList.toggle('online', online);
  $('#connection-label').textContent = info.draining ? '本机队列维护中' : online ? '本机已连接' : '本机未连接';
  $('#connection-detail').textContent = info.draining ? '暂不接收新任务，请等待管理员恢复' : online ? info.resourceHeld ? 'GPU 使用中或等待清理，新任务将排队' : 'ComfyUI 就绪，可提交任务' : info.enabled ? '请启动本机 ComfyUI 和连接程序' : '请先配置服务器连接密钥';
  if (JSON.stringify(workflows) !== JSON.stringify(info.workflows)) {
    const previous = $('#workflow').value; workflows = info.workflows;
    $('#workflow').replaceChildren(...(workflows.length ? workflows.map(item => { const option = node('option', '', item.label); option.value = item.id; return option; }) : [node('option', '', '等待本机工作流')]));
    if (workflows.some(item => item.id === previous)) $('#workflow').value = previous;
    else if (workflows.length) $('#workflow').value = workflows[0].id;
    selectWorkflow();
  }
  updateButton();
}
function renderJobs(jobs) {
  const next = JSON.stringify(jobs.map(({ updated, ...job }) => job));
  if (signature === next) return;
  signature = next; $('#job-count').textContent = String(jobs.length);
  if (!jobs.length) {
    const empty = node('div', 'empty'); empty.append(node('span', '', '✳'), node('h3', '', '第一件作品，从这里开始'), node('p', 'small muted', '图片与视频完成后将出现在这里。')); $('#jobs').replaceChildren(empty); return;
  }
  $('#jobs').replaceChildren(...jobs.map(job => {
    const card = node('article', 'job'), heading = node('div', 'job-heading'), content = node('div', 'job-body');
    heading.append(node('h3', '', job.label), node('span', 'badge', names[job.status] || job.status)); card.append(heading);
    // Asset paths are generated from validated job ids, never arbitrary API URLs.
    const asset = base + '/jobs/' + job.id + '/asset';
    if (job.status === 'complete') {
      const media = node(job.kind === 'video' ? 'video' : 'img', 'job-media'); media.src = asset;
      if (job.kind === 'video') { media.controls = true; media.preload = 'metadata'; media.setAttribute('playsinline', ''); }
      else { media.alt = '生成图片'; media.loading = 'lazy'; }
      card.append(media);
    }
    content.append(node('p', 'job-prompt', job.prompt));
    if (job.error) content.append(node('p', 'message', job.error));
    const footer = node('div', 'job-footer'); footer.append(node('span', '', new Date(job.created * 1000).toLocaleString('zh-CN')));
    if (job.status === 'complete') { const download = node('a', 'download', '下载作品 ↓'); download.href = asset + '?download=1'; download.setAttribute('download', ''); footer.append(download); }
    content.append(footer); card.append(content); return card;
  }));
}
async function refresh() {
  const version = epoch, serial = ++refreshSerial;
  try {
    const [info, result] = await Promise.all([api('/status'), api('/jobs')]);
    if (version !== epoch || serial !== refreshSerial || !user) return;
    renderStatus(info); renderJobs(result.jobs); $('#jobs-message').textContent = '';
  } catch (error) { if (version === epoch && serial === refreshSerial) { online = false; updateButton(); $('#jobs-message').textContent = error.message; } }
  finally { if (version === epoch && serial === refreshSerial && user) { clearTimeout(timer); timer = setTimeout(refresh, 5000); } }
}
async function unlock(info) {
  if (info.user?.role !== 'admin') { lock(); $('#login-message').textContent = '仅管理员可进入本地创作台。'; return; }
  epoch++; user = info.user; csrf = info.csrf; $('#password').value = ''; $('#auth').hidden = true; $('#studio').hidden = false; $('#logout').hidden = false;
  $('#account-name').textContent = user.username; $('#login-message').textContent = ''; await refresh();
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#login-form button'); button.disabled = true; $('#login-message').textContent = '正在登录…';
  try { await unlock(await api('/login', { username: $('#username').value.trim(), password: $('#password').value })); }
  catch (error) { $('#login-message').textContent = error.message; $('#password').value = ''; }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await api('/logout', {}); lock(); $('#login-message').textContent = '已退出登录。'; } catch (error) { $('#jobs-message').textContent = error.message; } });
$('#workflow').addEventListener('change', selectWorkflow);
$('#prompt').addEventListener('input', () => { requestId = null; });
$('#clear-reference').addEventListener('click', () => { clearReference(); requestId = null; });
$('#refresh').addEventListener('click', refresh);
$('#reference').addEventListener('change', async () => {
  const file = $('#reference').files?.[0]; clearReference(); requestId = null; if (!file) return;
  const controller = new AbortController(); referenceController = controller; processing = true; updateButton(); $('#reference-status').textContent = '正在压缩参考图…';
  try {
    const result = await compressReferenceImage(file, { signal: controller.signal });
    const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取参考图。')); reader.readAsDataURL(result.blob); });
    if (controller.signal.aborted) return;
    reference = encoded.split(',')[1]; $('#reference-preview').src = encoded; $('#reference-preview').hidden = false;
    $('#reference-status').textContent = `${file.name} · ${result.width} × ${result.height} · ${Math.ceil(result.blob.size / 1024)} KB`;
  } catch (error) { if (!controller.signal.aborted) $('#reference-status').textContent = error.message; }
  finally { if (!controller.signal.aborted) { processing = false; updateButton(); } }
});
$('#create-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('#generate').disabled) return;
  submitting = true; updateButton(); const version = epoch; requestId ||= crypto.randomUUID();
  $('#create-message').textContent = '正在提交任务…';
  try {
    await api('/jobs', { workflow: $('#workflow').value, prompt: $('#prompt').value.trim(), requestId, ...(reference ? { reference } : {}) });
    if (version !== epoch) return;
    requestId = null; $('#create-message').textContent = '任务已进入本机队列。'; await refresh();
  } catch (error) { if (version === epoch) $('#create-message').textContent = error.message; }
  finally { submitting = false; updateButton(); }
});
window.addEventListener('pagehide', () => { epoch++; clearTimeout(timer); referenceController?.abort(); });
const initialEpoch = epoch;
api('/session').then(info => { if (epoch !== initialEpoch) return; if (info.user) return unlock(info); $('#login-message').textContent = ''; }).catch(error => { if (epoch === initialEpoch) $('#login-message').textContent = error.message; });
