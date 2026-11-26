import { requestJSON } from '/shared/catalog.js';

const $ = id => document.getElementById(id);
const api = '/api/image/video';
const adminApi = '/api/image/admin/video';
const statuses = { queued: '排队中', submitting: '提交中', running: '生成中', saving: '正在保存',
  complete: '已保存', failed: '失败', unknown: '待核实，请检查 AutoDL 任务' };
let session, workflows = [], pending, sending = false, offset = 0, latest = '', serial = 0, timer;

function node(tag, text, attributes = {}) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
function userText(tag, text) {
  return node(tag, text, { 'data-strgo-user-content': '' });
}
function request(path, method = 'GET', body) {
  return requestJSON(path, { method, body, csrf: session?.csrf });
}
function option(value, text) {
  return node('option', text, { value, 'data-strgo-user-content': '' });
}
function activeWorkflow() {
  return workflows.find(workflow => workflow.id === $('workflow').value);
}
function control(field) {
  const label = node('label', field.name === 'prompt' ? '视频提示词' : field.name);
  let input;
  if (field.options || field.kind === 'boolean') {
    input = node('select');
    input.append(option('', '使用默认值'));
    const values = field.options || [true, false];
    values.forEach((value, index) => input.append(option(index, String(value))));
    if (values.includes(field.default)) input.value = String(values.indexOf(field.default));
  } else if (field.kind === 'integer' || field.kind === 'number') {
    input = node('input', null, { type: 'number', step: field.kind === 'integer' ? '1' : 'any' });
    for (const name of ['min', 'max']) if (field[name] != null) input[name] = field[name];
    if (Number.isFinite(field.default)) input.value = field.default;
  } else {
    input = field.name === 'prompt' ? node('textarea', null, { rows: '5' }) : node('input', null, { type: 'text' });
    input.maxLength = Math.min(12000, field.max_length || 12000);
    if (typeof field.default === 'string' && field.name !== 'prompt') input.value = field.default;
  }
  input.required = field.required;
  input.name = field.name;
  label.append(input);
  return label;
}
function renderFields() {
  const workflow = activeWorkflow();
  $('fields').replaceChildren(...(workflow?.fields.map(control) || []));
  $('source').href = workflow?.url || 'https://www.autodl.art/large-model/comfyui';
}
async function loadWorkflows() {
  const data = await request(api + '/workflows');
  const previous = activeWorkflow();
  workflows = data.workflows;
  $('create').hidden = !(data.allowed && data.ready && workflows.length);
  $('notice').textContent = !data.allowed ? '此账号尚未获得生成权限。已保存的视频仍可播放。'
    : !data.ready ? '服务器尚未配置 AutoDL 令牌。'
    : !workflows.length ? '管理员尚未启用文生视频工作流。' : '';
  $('notice').hidden = !$('notice').textContent;
  $('workflow').replaceChildren(...workflows.map(entry => option(entry.id, entry.title)));
  if (workflows.some(entry => entry.id === previous?.id)) $('workflow').value = previous.id;
  if (JSON.stringify(previous) !== JSON.stringify(activeWorkflow())) renderFields();
}
function signIn() {
  $('notice').replaceChildren(node('a', '登录 STRGO', { href: '/ai/login/?next=%2Fvideo%2F' }));
  $('notice').hidden = false;
}
async function loadJobs(append = false) {
  const generation = ++serial;
  try {
    const data = await request(api + '/jobs?offset=' + (append ? offset + 20 : 0));
    if (generation !== serial) return;
    const next = JSON.stringify(data);
    if (!append && !offset && next === latest) return;
    const records = data.jobs.map(job => {
      const article = node('article');
      article.append(userText('h3', job.title), userText('p', job.prompt),
        node('small', (statuses[job.status] || job.status) + ' · ' + new Date(job.created * 1000).toLocaleString()));
      if (job.error) article.append(node('p', job.error));
      for (const path of job.videos) article.append(
        node('video', null, { src: path, controls: '', playsinline: '', preload: 'none' }),
        node('a', '下载视频', { href: path + '?download=1', download: '' }));
      return article;
    });
    if (append) { offset += 20; $('jobs').append(...records); }
    else { offset = 0; latest = next; $('jobs').replaceChildren(...records); }
    $('more').hidden = !data.hasMore;
    $('archive-status').textContent = $('jobs').children.length ? '' : '还没有视频。';
  } catch (error) {
    if (generation !== serial) return;
    if (error.status === 401) {
      clearInterval(timer);
      $('create').hidden = $('admin').hidden = $('archive').hidden = true;
      $('jobs').replaceChildren();
      signIn();
    } else $('archive-status').textContent = error.message;
  }
}
function fieldsFor(workflow) {
  const result = {};
  for (const field of workflow.fields) {
    const value = $('generate').elements.namedItem(field.name).value;
    if (value === '') continue;
    if (field.options) result[field.name] = field.options[Number(value)];
    else if (field.kind === 'boolean') result[field.name] = value === '0';
    else if (field.kind === 'integer' || field.kind === 'number') result[field.name] = Number(value);
    else result[field.name] = value;
  }
  return result;
}
async function sendJob() {
  if (sending || !pending) return;
  sending = true;
  const button = $('generate').querySelector('button');
  button.disabled = true;
  const key = 'strgo:video:submit:' + session.user.id;
  try {
    const identity = JSON.stringify({ workflowId: pending.workflowId, fields: pending.fields });
    if (!pending.requestId) {
      pending.requestId = crypto.randomUUID();
      const bytes = new TextEncoder().encode(identity);
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).join(',');
      try {
        const previous = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (previous?.fingerprint === fingerprint) pending.requestId = previous.requestId;
        sessionStorage.setItem(key, JSON.stringify({ fingerprint, requestId: pending.requestId }));
      } catch { /* The current page keeps the attempt in memory. */ }
    }
    await request(api + '/jobs', 'POST', { ...pending, acknowledged: true });
    try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ }
    pending = null;
    $('notice').textContent = '任务已提交，可以关闭页面，稍后回来查看。';
    await loadJobs();
  } catch (error) {
    $('notice').textContent = error.message + ' 可用相同参数重试查询提交结果。';
  } finally {
    $('notice').hidden = false;
    button.disabled = false;
    sending = false;
  }
}
async function adminAction(button, callback) {
  button.disabled = true;
  $('admin-status').textContent = '处理中…';
  try { await callback(); $('admin-status').textContent = '已更新。'; }
  catch (error) { $('admin-status').textContent = error.message; }
  finally { button.disabled = false; }
}
function action(label, callback) {
  const button = node('button', label, { type: 'button' });
  button.onclick = () => adminAction(button, callback);
  return button;
}
async function loadAdmin() {
  const [current, grants] = await Promise.all([request(adminApi + '/workflows'), request(adminApi + '/grants')]);
  const active = current.workflows.filter(item => item.enabled);
  $('replace').replaceChildren(option('', '添加到现有列表'), ...active.map(item => option(item.id, item.title)));
  $('enabled').replaceChildren(...active.map(item => {
    const article = node('article');
    article.append(userText('strong', item.title), node('p', item.id),
      node('a', '官方工作流 ↗', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }),
      node('p', item.submitUrl),
      action('停用', async () => {
        if (!confirm('停用这个工作流？')) return;
        await request(adminApi + '/workflows/' + item.id, 'DELETE', {});
        await Promise.all([loadAdmin(), loadWorkflows()]);
      }));
    return article;
  }));
  $('members').replaceChildren(...grants.members.map(member => {
    const row = node('div', null, { class: 'row' });
    row.append(userText('span', member.username), action('撤销授权', async () => {
      if (!confirm('撤销该成员的文生视频权限？')) return;
      await request(adminApi + '/grants/' + member.id, 'DELETE', {});
      await loadAdmin();
    }));
    return row;
  }));
}
$('workflow').addEventListener('change', renderFields);
$('generate').onsubmit = event => {
  event.preventDefault();
  const workflow = activeWorkflow();
  if (!workflow || sending) return;
  const body = { workflowId: workflow.id, fields: fieldsFor(workflow) };
  if (!pending || JSON.stringify(pending.fields) !== JSON.stringify(body.fields) || pending.workflowId !== body.workflowId) pending = body;
  $('confirm-workflow').textContent = [workflow.title, body.fields.duration ? body.fields.duration + ' 秒' : '', body.fields.resolution || ''].filter(Boolean).join(' · ');
  $('confirm').returnValue = '';
  $('confirm').showModal();
};
$('confirm').addEventListener('close', () => { if ($('confirm').returnValue === 'submit') sendJob(); });
$('refresh').onclick = () => loadJobs();
$('more').onclick = () => loadJobs(true);
$('sync').onclick = () => adminAction($('sync'), async () => {
  const data = await request(adminApi + '/catalog');
  $('catalog').replaceChildren(...data.workflows.map(entry => option(entry.url, entry.title)));
  $('enable').elements.workflow.focus();
});
$('enable').onsubmit = event => {
  event.preventDefault();
  const form = event.target;
  adminAction(form.querySelector('button'), async () => {
    await request(adminApi + '/workflows', 'POST', {
      workflow: form.elements.workflow.value.trim(), replace: form.elements.replace.value,
    });
    form.reset();
    await Promise.all([loadAdmin(), loadWorkflows()]);
  });
};
$('grant').onsubmit = event => {
  event.preventDefault();
  const form = event.target;
  adminAction(form.querySelector('button'), async () => {
    const username = form.elements.username.value.trim();
    if (!confirm('允许 ' + username + ' 提交付费视频生成任务？')) return;
    await request(adminApi + '/grants', 'POST', { username });
    form.reset();
    await loadAdmin();
  });
};
async function start() {
  try {
    session = await request('/api/image/session');
    if (!session.user) { signIn(); return; }
    $('archive').hidden = false;
    $('admin').hidden = session.user.role !== 'admin';
    if (!$('admin').hidden) {
      $('admin').addEventListener('toggle', () => {
        if ($('admin').open) loadAdmin().catch(error => { $('admin-status').textContent = error.message; });
      });
      $('admin').open = location.hash === '#admin';
    }
    await Promise.all([loadWorkflows(), loadJobs()]);
    timer = setInterval(() => { if (!document.hidden && !offset) loadJobs(); }, 7000);
  } catch (error) { $('notice').textContent = error.message; $('notice').hidden = false; }
}
start();
