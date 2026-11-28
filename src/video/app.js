import { requestJSON } from '/shared/catalog.js';

const $ = id => document.getElementById(id);
const api = '/api/image/video', adminApi = '/api/image/admin/video';
const labels = {
  duration: '生成时长（秒）', audio_duration: '生成时长（秒）', video_duration: '生成时长（秒）',
  resolution: '分辨率 / 画幅', seed: '随机种子', random_seed: '随机种子', noise_seed: '随机种子', mode: '生成模式',
};
const durationNames = ['duration', 'video_duration', 'audio_duration'];
const pendingGrants = new Map();
const statuses = { queued: '排队中', submitting: '提交中', running: '生成中', saving: '正在保存', complete: '已保存', failed: '失败', unknown: '结果待核实，请检查 AutoDL 任务' };
const references = { image: Array(9).fill(null), audio: Array(3).fill(null) };
let session, workflows = [], allowed = false, ready = false, pending, sending = false;
let offset = 0, latest = '', serial = 0, timer, keyRevision = 0;
let memberSearchRevision = 0;

function node(tag, text, attributes = {}) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
function userText(tag, text, attributes = {}) { return node(tag, text, { ...attributes, 'data-strgo-user-content': '' }); }
function option(value, text) { return userText('option', text, { value }); }
function request(path, method = 'GET', body) { return requestJSON(path, { method, body, csrf: session?.csrf }); }
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function activeWorkflow() { return workflows.find(workflow => workflow.id === $('workflow').value); }
function mediaField(kind, slot) { return activeWorkflow()?.fields.find(field => field.kind === kind && field.slot === slot); }
function preferenceKey() { return 'strgo:video:settings:' + session.user.id; }
function preferences() {
  try { return JSON.parse(localStorage.getItem(preferenceKey()) || '{}'); } catch { return {}; }
}
function integerChoices(field) {
  if (field.kind !== 'integer') return null;
  const min = Math.ceil(field.min), max = Math.floor(field.max);
  const count = max - min + 1;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || count < 1 || count > 100) return null;
  return Array.from({ length: count }, (_, index) => min + index);
}
function control(field, title = labels[field.name] || field.name, range = null) {
  const label = node('label', title);
  let input;
  const choices = field.options || (field.kind === 'boolean' ? [true, false] : range);
  if (choices) {
    input = node('select');
    input.append(option('', field.required ? '请选择' : '使用默认值'));
    choices.forEach((value, index) => {
      const text = typeof value === 'number' && durationNames.includes(field.name) ? value + ' 秒' : String(value);
      input.append(option(range ? value : index, text));
    });
    if (choices.includes(field.default)) input.value = String(range ? field.default : choices.indexOf(field.default));
  } else if (field.kind === 'integer' || field.kind === 'number') {
    input = node('input', null, { type: 'number', step: field.kind === 'integer' ? '1' : 'any' });
    for (const name of ['min', 'max']) if (field[name] != null) input[name] = field[name];
    if (Number.isFinite(field.default)) input.value = field.default;
  } else {
    input = node('input', null, { type: 'text' });
    input.maxLength = Math.min(12000, field.max_length || 12000);
    if (typeof field.default === 'string') input.value = field.default;
  }
  input.required = field.required; input.name = field.name; input.setAttribute('form', 'generate');
  label.append(input); return label;
}
function scalarFields() { return activeWorkflow()?.fields.filter(field => !['image', 'audio'].includes(field.kind) && field.name !== 'prompt') || []; }
function parameterInputs() { return $('fields').querySelectorAll('input[name],select[name]'); }
function renderFields() {
  const workflow = activeWorkflow(), saved = preferences();
  const extra = scalarFields();
  const duration = durationNames.map(name => extra.find(field => field.name === name)).find(Boolean);
  const resolution = extra.find(field => field.name === 'resolution');
  for (const [id, title, field] of [['duration-choice', '生成时长', duration], ['resolution-choice', '视频分辨率', resolution]]) {
    const range = field && !field.options ? integerChoices(field) : null;
    if (field && (field.options || range || field.kind === 'boolean')) {
      $(id).replaceChildren(control(field, title, range));
      extra.splice(extra.indexOf(field), 1);
    } else {
      const label = node('label', title);
      const select = node('select', null, { disabled: '' });
      select.append(option('', field ? '见下方参数' : '不适用'));
      label.append(select);
      $(id).replaceChildren(label);
    }
  }
  $('extra-fields').replaceChildren(...extra.map(field => control(field)));
  $('extra-fields').hidden = !extra.length;
  if (saved.workflowId === workflow?.id && saved.values && typeof saved.values === 'object') {
    for (const input of parameterInputs()) {
      const value = saved.values[input.name];
      if (typeof value === 'string' && (!input.options || [...input.options].some(option => option.value === value))) input.value = value;
    }
  }
  $('prompt').maxLength = Math.min(12000, workflow?.fields.find(field => field.name === 'prompt')?.max_length || 12000);
  renderSlots();
}
function saveParameterPreferences() {
  try {
    const values = Object.fromEntries([...parameterInputs()].map(input => [input.name, input.value]));
    localStorage.setItem(preferenceKey(), JSON.stringify({ workflowId: activeWorkflow()?.id, values }));
  } catch { /* Parameter settings remain active for this page. */ }
}
async function loadWorkflows() {
  const data = await request(api + '/workflows'), previous = activeWorkflow();
  workflows = data.workflows; allowed = data.allowed; ready = data.ready;
  $('create').hidden = !allowed;
  notice(!allowed ? '此账号尚未获得生成权限。已保存的视频仍可播放。' : !workflows.length ? '暂无可用视频工作流。' : !ready ? '请在设置中配置接口密钥。' : '');
  $('workflow').disabled = !workflows.length;
  $('workflow').replaceChildren(...(workflows.length ? workflows.map(entry => option(entry.id, entry.title)) : [option('', '暂无可用工作流')]));
  const selected = previous?.id || preferences().workflowId;
  if (workflows.some(entry => entry.id === selected)) $('workflow').value = selected;
  if (JSON.stringify(previous) !== JSON.stringify(activeWorkflow()) || !$('image-slots').children.length) renderFields();
}
function clearReference(kind, slot) {
  if (sending) return;
  const record = references[kind][slot];
  if (record?.uploading) { notice('素材仍在缓存，请稍候再删除。'); return; }
  references[kind][slot] = null;
  if (record) {
    URL.revokeObjectURL(record.url);
    if (record.asset) request(api + '/inputs/' + record.asset.id, 'DELETE', {}).catch(() => {});
  }
  pending = null; renderSlots();
}
async function selectReference(kind, slot, file) {
  if (!file || sending) return;
  if (!file.size || file.size > 4 * 1024 * 1024 || file.name.length > 160) { notice('每份参考素材最多 4 MiB，文件名最多 160 字符。'); return; }
  const supported = kind === 'image' ? /\.(png|jpe?g|webp)$/i : /\.(mp3|wav|flac|m4a|mp4)$/i;
  if (!supported.test(file.name)) { notice(kind === 'image' ? '请选择 JPG、PNG 或 WebP 图片。' : '请选择 MP3、WAV、FLAC 或 M4A 音频。'); return; }
  const record = { file, name: file.name, url: URL.createObjectURL(file), requestId: crypto.randomUUID() };
  const old = references[kind][slot];
  if (old?.uploading) { URL.revokeObjectURL(record.url); notice('该素材位仍在缓存，请稍候再替换。'); return; }
  references[kind][slot] = record;
  pending = null; notice('');
  record.uploading = uploadReference({ kind, slot, record });
  renderSlots();
  try {
    await record.uploading;
    record.uploading = null;
    if (old) {
      URL.revokeObjectURL(old.url);
      if (old.asset) request(api + '/inputs/' + old.asset.id, 'DELETE', {}).catch(() => {});
    }
    if (references[kind][slot] === record) { notice('素材已加密缓存到服务器，下次进入会自动恢复。'); renderSlots(); }
  } catch (error) {
    URL.revokeObjectURL(record.url);
    if (references[kind][slot] === record) references[kind][slot] = old;
    notice(error.message); renderSlots();
  }
}
function renderSlots() {
  for (const [kind, records] of Object.entries(references)) {
    const slots = records.map((record, slot) => {
      const label = (kind === 'image' ? '参考图 ' : '音频 ') + (slot + 1);
      const container = node('div', null, { class: 'media-slot' + (record?.uploading ? ' uploading' : ''), 'data-kind': kind, 'data-slot': slot });
      const supported = !activeWorkflow() || !!mediaField(kind, slot);
      const button = node('button', null, { type: 'button', class: 'slot-button' + (record ? ' has-file' : '') + (supported ? '' : ' unsupported'), 'aria-label': (record ? '预览' : '导入') + label });
      const input = node('input', null, { type: 'file', hidden: '', accept: kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'audio/mpeg,audio/wav,audio/flac,audio/mp4,.mp3,.wav,.flac,.m4a,.mp4' });
      input.onchange = () => { selectReference(kind, slot, input.files[0]); input.value = ''; };
      if (record && kind === 'image') button.append(node('img', null, { src: record.url, alt: record.name }));
      else button.append(node('span', record ? '♫' : '+', { class: 'slot-symbol', 'aria-hidden': 'true' }));
      button.append(userText('span', kind === 'audio' && record ? record.name : label, { class: 'slot-label' }));
      button.onclick = () => {
        if (record) previewReference(kind, slot, input);
        else if (supported) input.click();
        else notice('当前接口不支持该素材位置，请在设置中更换工作流。');
      };
      container.append(button, input);
      if (record) {
        const remove = node('button', '×', { type: 'button', class: 'slot-remove', 'aria-label': '删除' + label });
        remove.onclick = () => clearReference(kind, slot); container.append(remove);
      }
      return container;
    });
    $(kind + '-slots').replaceChildren(...slots);
  }
}
function closePreview() {
  for (const media of $('preview-content').querySelectorAll('video,audio')) { media.pause(); media.removeAttribute('src'); media.load(); }
  $('preview-content').replaceChildren(); $('preview-actions').replaceChildren();
}
function showPreview(title, content, actions) {
  if ($('preview').open) $('preview').close();
  closePreview();
  $('preview-title').textContent = title;
  $('preview-content').append(content); $('preview-actions').append(...actions);
  $('preview').showModal();
  if (content.play) content.play().catch(() => {});
}
function previewReference(kind, slot, input) {
  const record = references[kind][slot]; if (!record) return;
  const content = node(kind === 'image' ? 'img' : 'audio', null, { src: record.url, ...(kind === 'image' ? { alt: record.name } : { controls: '' }) });
  const replace = node('button', '替换素材', { type: 'button' });
  replace.onclick = () => { $('preview').close(); input.click(); };
  const remove = node('button', '删除素材', { type: 'button' });
  remove.onclick = () => { $('preview').close(); clearReference(kind, slot); };
  showPreview(record.name, content, [replace, remove]);
}
function previewVideo(job, path) {
  const video = node('video', null, { src: path, controls: '', playsinline: '', preload: 'metadata' });
  showPreview(job.title, video, [node('a', '下载视频', { href: path + '?download=1', download: '' })]);
}
function jobCard(job, path) {
  const article = node('article', null, { class: 'job-card', 'data-job': job.id });
  if (path) {
    const open = node('button', null, { type: 'button', class: 'video-open', 'aria-label': '播放 ' + job.title });
    open.append(node('video', null, { src: path, muted: '', playsinline: '', preload: 'metadata', tabindex: '-1', 'aria-hidden': 'true' }), node('span', '▶', { class: 'play-mark', 'aria-hidden': 'true' }));
    open.onclick = () => previewVideo(job, path); article.append(open);
  } else article.append(node('div', statuses[job.status] || job.status, { class: 'job-status' }));
  const body = node('div', null, { class: 'job-body' });
  body.append(userText('h3', job.title), userText('p', job.prompt), node('small', (statuses[job.status] || job.status) + ' · ' + new Date(job.created * 1000).toLocaleString()));
  if (job.error) body.append(node('p', job.error));
  article.append(body); return article;
}
async function loadJobs(append = false) {
  const ticket = ++serial;
  try {
    const data = await request(api + '/jobs?offset=' + (append ? offset + 20 : 0));
    if (ticket !== serial) return;
    const signature = JSON.stringify(data);
    if (!append && !offset && signature === latest) return;
    const cards = data.jobs.flatMap(job => job.videos.length ? job.videos.map(path => jobCard(job, path)) : [jobCard(job)]);
    if (append) { offset += 20; $('jobs').append(...cards); }
    else { offset = 0; latest = signature; $('jobs').replaceChildren(...cards); }
    $('more').hidden = !data.hasMore;
    $('archive-status').textContent = $('jobs').children.length ? '' : '生成的视频会保存在这里，点击即可播放。';
  } catch (error) {
    if (ticket !== serial) return;
    if (error.status === 401) { clearInterval(timer); clearPrivate(); signIn(); }
    else $('archive-status').textContent = error.message;
  }
}
function scalarValues() {
  const result = { prompt: $('prompt').value.trim() };
  for (const field of scalarFields()) {
    const value = $('fields').querySelector('[name="' + field.name + '"]').value;
    if (value === '') continue;
    if (field.options) result[field.name] = field.options[Number(value)];
    else if (field.kind === 'boolean') result[field.name] = value === '0';
    else if (['integer', 'number'].includes(field.kind)) result[field.name] = Number(value);
    else result[field.name] = value;
  }
  return result;
}
function prepareJob() {
  const workflow = activeWorkflow();
  if (!allowed) return;
  if (!workflow) { notice('暂无可用视频工作流。'); return; }
  if (!ready) {
    notice('请在设置中配置接口密钥。');
    if (session.user.role === 'admin') openSettings();
    return;
  }
  if (!$('prompt').reportValidity()) return;
  for (const input of parameterInputs()) {
    if (!input.checkValidity()) { input.reportValidity(); return; }
  }
  const picks = [];
  for (const [kind, records] of Object.entries(references)) {
    for (let slot = 0; slot < records.length; slot++) {
      const field = mediaField(kind, slot), record = records[slot];
      if (record?.uploading) { notice('请等参考素材完成服务器缓存后再生成。'); return; }
      if (record && !field) { notice('当前接口不支持' + (kind === 'image' ? '参考图 ' : '音频 ') + (slot + 1) + '，请删除该素材或更换接口。'); return; }
      if (!record && field?.required) { notice('请导入必填素材' + (kind === 'image' ? '参考图 ' : '音频 ') + (slot + 1) + '。'); return; }
      if (record) picks.push({ name: field.name, kind, record });
    }
  }
  const fields = scalarValues();
  const same = pending && pending.workflowId === workflow.id
    && JSON.stringify(pending.fields) === JSON.stringify(fields)
    && pending.picks.length === picks.length
    && picks.every((pick, index) => pick.record === pending.picks[index].record && pick.name === pending.picks[index].name);
  if (!same) pending = { workflowId: workflow.id, fields, picks };
  const duration = fields.duration ?? fields.video_duration ?? fields.audio_duration;
  $('confirm-workflow').textContent = [workflow.title, duration ? duration + ' 秒' : '', picks.length + ' 份参考素材'].filter(Boolean).join(' · ');
  $('confirm').returnValue = ''; $('confirm').showModal();
}
async function uploadReference(pick) {
  const record = pick.record;
  if (record.asset) return record.asset.id;
  const buffer = await record.file.arrayBuffer();
  record.fingerprint ||= [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const encoded = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(record.file);
  });
  const response = await fetch(api + '/inputs', {
    method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(90000),
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    body: JSON.stringify({ kind: pick.kind, slot: pick.slot, name: record.name, requestId: record.requestId, data: encoded }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error || '参考素材上传失败。');
  record.asset = data; record.fingerprint = data.sha256; return data.id;
}
async function loadReferences() {
  const data = await request(api + '/inputs');
  await Promise.all(data.inputs.map(async asset => {
    const response = await fetch(api + '/inputs/' + asset.id, { credentials: 'same-origin', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('已缓存素材暂时无法读取，请重新登录后刷新。');
    const blob = await response.blob(), url = URL.createObjectURL(blob);
    references[asset.kind][asset.slot] = {
      name: asset.name, mime: asset.mime, url, asset, fingerprint: asset.sha256, requestId: null,
    };
  }));
  renderSlots();
}
async function sendJob() {
  if (sending || !pending) return;
  sending = true; $('composer').disabled = true; $('open-settings').disabled = true;
  const body = pending, owner = session.user.id, key = 'strgo:video:submit:' + owner;
  try {
    const fields = { ...body.fields };
    for (const [index, pick] of body.picks.entries()) {
      notice('正在上传参考素材 ' + (index + 1) + ' / ' + body.picks.length + '…');
      fields[pick.name] = await uploadReference(pick);
    }
    const identity = JSON.stringify({ workflowId: body.workflowId, fields: body.fields, media: body.picks.map(pick => [pick.name, pick.record.fingerprint]) });
    if (!body.requestId) {
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)))).join(',');
      body.requestId = crypto.randomUUID();
      try {
        const old = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (old?.fingerprint === fingerprint) body.requestId = old.requestId;
        sessionStorage.setItem(key, JSON.stringify({ fingerprint, requestId: body.requestId }));
      } catch { /* Retained in this page when storage is unavailable. */ }
    }
    const fresh = await request('/api/image/session');
    if (fresh.user?.id !== owner) throw new Error('账号已变化，请重新登录后再提交。');
    session = fresh;
    await request(api + '/jobs', 'POST', { workflowId: body.workflowId, fields, requestId: body.requestId, acknowledged: true });
    try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ }
    pending = null; notice('任务已提交，完成后自动保存到下方列表。'); await loadJobs();
  } catch (error) { notice(error.message); }
  finally { sending = false; $('composer').disabled = false; $('open-settings').disabled = false; }
}
async function adminAction(button, callback) {
  button.disabled = true; $('admin-status').textContent = '处理中…';
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
  const [current, config] = await Promise.all([request(adminApi + '/workflows'), request(adminApi + '/config')]);
  keyRevision = config.revision; $('api-key').value = ''; $('key-status').textContent = config.configured ? '已配置密钥，留空保留现有密钥。' : '尚未配置密钥。';
  const active = current.workflows.filter(item => item.enabled);
  $('enabled').replaceChildren(...active.map(item => {
    const article = node('article');
    article.append(
      userText('strong', item.title), node('p', item.id),
      node('a', '官方工作流 ↗', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }),
      node('p', item.submitUrl), action('停用', async () => {
        if (!confirm('停用这个工作流？')) return;
        await request(adminApi + '/workflows/' + item.id, 'DELETE', {});
        await Promise.all([loadAdmin(), loadWorkflows()]);
      }),
    );
    return article;
  }));
}
function updateGrantSelection() {
  $('member-selection').textContent = pendingGrants.size ? '待授权 ' + pendingGrants.size + ' 位成员' : '';
}
function clearMemberResults() {
  memberSearchRevision++;
  $('members').hidden = true;
  $('members').replaceChildren();
  $('member-status').textContent = '';
}
async function loadMembers() {
  clearMemberResults();
  const query = $('member-query').value.trim();
  if (!query) return;
  const revision = memberSearchRevision;
  $('member-status').textContent = '正在搜索…';
  const users = [];
  const getPage = offset => request('/api/image/admin/users?' + new URLSearchParams({ q: query, offset, limit: 100 }));
  let grants;
  try {
    let page;
    [page, grants] = await Promise.all([getPage(0), request(adminApi + '/grants')]);
    for (let offset = 100; revision === memberSearchRevision; offset += 100) {
      users.push(...page.items.filter(user => user.role !== 'admin' && user.status === 'active'));
      if (!page.hasMore) break;
      page = await getPage(offset);
    }
  } catch (error) {
    if (revision === memberSearchRevision) $('member-status').textContent = error.message;
    return;
  }
  if (revision !== memberSearchRevision) return;
  const granted = new Map(grants.members.map(member => [member.id, member]));
  $('members').replaceChildren(...users.map(member => {
    const currentGrant = granted.get(member.id);
    const row = node('div', null, { class: 'grant-member' });
    const label = node('label');
    const checkbox = node('input', null, { type: 'checkbox', value: member.username, 'data-user-id': member.id });
    if (currentGrant) pendingGrants.delete(member.id);
    checkbox.checked = !!currentGrant || pendingGrants.has(member.id);
    checkbox.disabled = !!currentGrant;
    checkbox.onchange = () => {
      if (checkbox.checked) pendingGrants.set(member.id, member.username);
      else pendingGrants.delete(member.id);
      updateGrantSelection();
    };
    label.append(checkbox, userText('span', member.username));
    row.append(label, node('small', currentGrant ? '已授权' : '未授权'));
    if (currentGrant) row.append(action('撤销', async () => {
      if (!confirm('撤销该成员的生成权限？')) return;
      await request(adminApi + '/grants/' + currentGrant.id, 'DELETE', {});
      if ($('members').contains(row)) await loadMembers();
    }));
    return row;
  }));
  $('members').hidden = !users.length;
  $('member-status').textContent = users.length ? '' : '找不到匹配的成员。';
  updateGrantSelection();
}
async function openSettings() {
  $('settings').showModal();
  if (session?.user?.role === 'admin') loadAdmin().catch(error => { $('admin-status').textContent = error.message; });
}
function clearPrivate() {
  ++serial; $('jobs').replaceChildren(); latest = ''; pending = null;
  if ($('preview').open) $('preview').close(); closePreview();
  if ($('settings').open) $('settings').close();
  $('api-key').value = ''; $('prompt').value = '';
  for (const records of Object.values(references)) {
    for (let index = 0; index < records.length; index++) {
      if (records[index]) URL.revokeObjectURL(records[index].url);
      records[index] = null;
    }
  }
  $('create').hidden = $('archive').hidden = true;
}
function signIn() { notice(''); $('notice').replaceChildren(node('a', '登录 STRGO', { href: '/ai/login/?next=%2Fvideo%2F' })); $('notice').hidden = false; }
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(button.dataset.close).close();
$('preview').addEventListener('close', () => {
  if (!$('preview').open) closePreview();
});
$('settings').addEventListener('close', () => {
  if ($('settings').open) return;
  $('member-search').reset();
  clearMemberResults();
  pendingGrants.clear();
  updateGrantSelection();
});
$('open-settings').onclick = openSettings;
$('workflow').onchange = () => { pending = null; renderFields(); saveParameterPreferences(); };
$('fields').oninput = event => { if (event.target.name) saveParameterPreferences(); };
$('member-query').oninput = clearMemberResults;
$('member-search').onsubmit = event => { event.preventDefault(); loadMembers(); };
$('generate').onsubmit = event => { event.preventDefault(); if (!sending) prepareJob(); };
$('confirm').addEventListener('close', () => { if ($('confirm').returnValue === 'submit') sendJob(); });
$('refresh').onclick = () => loadJobs(); $('more').onclick = () => loadJobs(true);
$('save-settings').onclick = () => {
  const button = $('save-settings'); button.disabled = true;
  (async () => {
    try {
      if (session.user.role === 'admin') {
        const newGrants = [...pendingGrants];
        if (newGrants.length && !confirm('为选中的 ' + newGrants.length + ' 位用户开通付费视频生成权限？')) return;
        const apiKey = $('api-key').value;
        if (apiKey.trim()) {
          const result = await request(adminApi + '/config', 'PUT', { apiKey, revision: keyRevision });
          keyRevision = result.revision; $('api-key').value = '';
        }
        for (const [id, username] of newGrants) {
          await request(adminApi + '/grants', 'POST', { username });
          pendingGrants.delete(id);
          updateGrantSelection();
        }
        await loadWorkflows();
      }
      $('settings-status').textContent = '设置已保存。';
      $('settings').close();
    } catch (error) {
      $('settings-status').textContent = error.message;
      if (session.user.role === 'admin') $('admin-status').textContent = error.message;
    } finally { button.disabled = false; }
  })();
};
async function start() {
  try {
    session = await request('/api/image/session'); if (!session.user) { signIn(); return; }
    $('archive').hidden = false; $('admin').hidden = session.user.role !== 'admin';
    await Promise.all([loadWorkflows(), loadJobs(), loadReferences()]);
    if (location.hash === '#admin' && session.user.role === 'admin') openSettings();
    timer = setInterval(() => { if (!document.hidden && !offset) loadJobs(); }, 7000);
  } catch (error) { notice(error.message); }
}
start();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ++serial; $('jobs').replaceChildren(); latest = ''; if ($('preview').open) $('preview').close(); return; }
  request('/api/image/session').then(fresh => {
    if (fresh.user?.id !== session?.user?.id || fresh.user?.role !== session?.user?.role) { clearPrivate(); location.reload(); return; }
    session = fresh; loadJobs(); loadWorkflows().catch(error => notice(error.message));
  }).catch(() => { clearPrivate(); signIn(); });
});
