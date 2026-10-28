import { icon } from '../shared/icons.js';
import { escapeHTML as esc, readPreferences, writePreferences, filterEntries, requestJSON, allowedAction } from './core.js';
import { art, startOrbit } from './visuals.js';

const D = window.STRGO, E = D.entries;
let storage;
try { storage = window.localStorage; } catch { /* Private browsing can disable storage. */ }
const $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)];
const main = $('#main'), modal = $('#modal');
const get = id => E.find(e => e.id === id || e.type === id);
const pageDefault = location.pathname.startsWith('/ai/tasks') ? 'tasks' : location.pathname.startsWith('/ai/assets') ? 'assets' : 'hub';
const view = () => location.hash.slice(1).split('?')[0] || pageDefault;
let state = { ...readPreferences(storage, null, E), user: null, csrf: '', role: 'guest' };
let filter = '全部', query = '', checked = false, sessionError = '', sessionSerial = 0;
let stopOrbit = () => {}, collectionRequest, collection = null, listSource = 'all', listState = 'all';
const available = e => state.role === 'admin' || e.group !== '管理';
for (const [key, value] of Object.entries(D.tokens)) document.documentElement.style.setProperty('--' + key, typeof value === 'number' ? value + 'px' : value);
$('#classicLink').href = D.classicRoute;

function persist() {
  try { writePreferences(storage, state.user?.id, state, E); }
  catch { toast('此浏览器无法保存偏好，本次操作仍可继续。'); }
}
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 4000); }
function dialog(html) { $('#modalBody').innerHTML = html; if (!modal.open) modal.showModal(); $('#modalBody').querySelector('input,button,a')?.focus(); }
function go(name) { if (view() === name) render(); else location.hash = name; }
function remember(e) { state.recent = [e.id, ...state.recent.filter(id => id !== e.id)].slice(0, 8); persist(); }
function heading(id, title, subtitle) { return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div></div>`; }
function ext(e, label = '进入功能 ↗') { return `<a class="primary entry-link" data-entry="${e.id}" href="${esc(e.route)}" ${e.route.startsWith('https:') ? 'target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`; }
function loginLink() { return '/ai/login/?next=' + encodeURIComponent(location.pathname + location.hash); }
function openEntry(id) {
  const e = get(id);
  if (!e || !available(e)) return;
  remember(e);
  if (e.group === '沉浸空间') return go('space-' + e.type);
  if (e.id === 'C05') window.open(e.route, '_blank', 'noopener,noreferrer');
  else location.assign(e.route);
}
function restartOrbit() { stopOrbit(); stopOrbit = view() === 'hub' && !document.hidden ? startOrbit($('#orbital'), state.motion) : () => {}; }

function toolCard(e){return `<button class="tool-card" data-open="${e.id}"><span class="symbol">${icon(e.type)}</span><span class="arrow">↗</span><h3>${e.name}</h3><small>${e.access}</small><span class="en">${e.en}</span></button>`}
function spaceCard(e){return `<button class="space-card" data-open="${e.id}"><div class="space-art">${art(e.type)}<span class="space-index">${e.id}</span><span class="space-arrow">↗</span></div><div class="space-title"><small>${e.en}</small><h3>${e.name}</h3><p>${e.description}</p></div></button>`}
function recentHtml(){const arr=state.recent.map(get).filter(Boolean).filter(available).slice(0,3);return arr.length?arr.map(e=>`<div class="recent-item"><div class="mini-icon">${icon(e.type)}</div><div><strong>${e.name}</strong><small>本机访问记录 · ${e.group}</small></div><button data-open="${e.id}">继续 ↗</button></div>`).join(''):'<div class="empty"><h3>从一个小小的灵感开始。</h3><small>打开任意功能后，这里会记住你的最近访问。</small></div>'}
function hub(){main.innerHTML=`<section class="hero"><div class="orbit" aria-hidden="true"><canvas id="orbital"></canvas><span class="orbit-label top">IDEAS IN MOTION</span></div><div class="hero-copy"><h1>把灵感，<br>送入<span class="accent">下一条轨道。</span></h1><p>创作、探索、连接。<br>你的工具与小宇宙，现在从这里出发。</p><div class="hero-actions"><button class="primary" data-go="studio">开始创作 <span class="action-arrow">↗</span></button><button class="ghost" data-go="catalog">浏览全部功能</button></div><div class="hero-meta">${E.filter(available).length} 个主入口 / ${E.filter(e=>e.group==='沉浸空间').length} 个沉浸空间 / 一个起点</div></div><div class="hero-mode"><button data-mode="console" class="${state.mode==='console'?'active':''}">控制台</button><button data-mode="immersive" class="${state.mode==='immersive'?'active':''}">沉浸模式</button><button id="motionQuick">${state.motion==='off'?'动效已关闭':'暂停动效'}</button></div></section><section class="section"><div class="section-head"><h2>让想法，即刻开始</h2><a href="#catalog">全部工具 ↗</a></div><div class="tool-grid">${E.slice(0,4).map(toolCard).join('')}</div></section><section class="section two-col"><div class="panel"><div class="section-head"><h3>继续上次的轨道</h3><span class="mini-label">RECENT</span></div>${recentHtml()}</div><div class="panel"><div class="section-head"><h3>我的快捷入口</h3><button class="link-button" data-go="catalog">管理收藏 ↗</button></div>${state.favs.length?'<div class="route-strip">'+state.favs.map(get).filter(Boolean).filter(available).map(e=>`<button data-open="${e.id}">${icon(e.type)} ${e.name}</button>`).join('')+'</div>':'<div class="empty"><h3>把常用的，放在手边。</h3><small>在全部功能中点击星标，即可添加快捷入口。</small></div>'}<div class="route-strip"><button data-go="tasks">${icon('tasks')} 任务中心</button><button data-go="assets">${icon('assets')} 我的作品</button></div></div></section><section class="section"><div class="section-head"><h2>换一个世界，继续好奇</h2><a href="#spaces">进入空间导航 ↗</a></div><div class="space-grid">${E.filter(e=>e.group==='沉浸空间').map(spaceCard).join('')}</div></section><section class="section"><div class="section-head"><h2>想法之外，也有连接</h2><a href="#catalog">查看所有入口 ↗</a></div><div class="content-links">${E.filter(e=>['N01','N02','N03','N04','N05','N06'].includes(e.id)).map(e=>`<button data-open="${e.id}"><span>${icon(e.type)}</span><div><h3>${e.name}</h3><small>${e.en}</small></div></button>`).join('')}</div></section><section class="section"><div class="section-head"><h2>管理你的工作区</h2></div><div class="route-strip">${E.filter(e=>e.group==='我的工作区'||e.group==='管理'&&available(e)||e.id==='C06'||e.id==='N07').map(e=>`<button data-open="${e.id}">${icon(e.type)} ${e.name}</button>`).join('')}</div></section>`;document.body.classList.toggle('immersive',state.mode==='immersive');restartOrbit()}
function catalog(){main.innerHTML=heading('P02','所有功能，一个入口。','搜索名称、用途或路径。收藏常用功能，保留原有直接访问地址。')+`<input id="catalogSearch" class="wide-search" placeholder="搜索：生图、SSH、梦境、/home…" value="${esc(query)}" aria-label="搜索全部功能"><div class="chips">${D.groups.filter(g=>g!=='管理'||state.role==='admin').concat(['我的收藏']).map(g=>`<button data-filter="${g}" class="${filter===g?'active':''}">${g}</button>`).join('')}</div><p id="resultCount" class="fine"></p><div class="catalog-list" id="catalogResults"></div>`;catalogResults()}
function catalogResults(){const arr=filterEntries(E,{role:state.role,query,group:filter,favorites:state.favs});$('#resultCount').textContent=`${arr.length} 个匹配入口`;$('#catalogResults').innerHTML=arr.map(e=>`<article class="catalog-card"><button class="fav ${state.favs.includes(e.id)?'on':''}" aria-label="${state.favs.includes(e.id)?'取消收藏':'收藏'}${e.name}" data-fav="${e.id}">${icon('star')}</button><span class="symbol">${icon(e.type)}</span><h3>${e.name}</h3><p>${e.description}</p><div class="catalog-bottom"><span class="badge">${e.access}</span><button data-open="${e.id}">打开 ↗</button></div><p class="mono fine">${esc(e.route)}</p></article>`).join('')||'<div class="empty"><h3>没有找到匹配功能</h3><p>试试“生图”“音乐”或清除筛选。</p><button data-reset-search>清除筛选</button></div>'}
function spaces(){main.innerHTML=heading('P08','让好奇心，带路。','独立世界，随心探索。保持各自风格，统一返回与切换。')+`<div class="space-grid">${E.filter(e=>e.group==='沉浸空间').map(spaceCard).join('')}</div><section class="section panel"><h3>推荐漫游</h3><div class="route-strip"><button data-open="S01">阳光卧室</button><span>→</span><button data-open="S06">猫咪天堂</button><span>→</span><button data-open="S04">梦境花园</button></div><p class="fine">打开空间卡片，选择独立入口，继续探索。</p></section>`}
function space(t){const e=get(t);if(!e){go('spaces');return}main.innerHTML=heading('P08',e.name,e.description)+`<div class="space-card large-space"><div class="space-art">${art(t)}</div></div><div class="section two-col"><div class="panel"><h2>把这扇门，留在手边。</h2><p class="prompt-note">这张封面是视觉示意。打开现有页面后体验真实三维场景。</p><div class="row-actions">${ext(e,'进入现有空间 ↗')}<button data-fav="${e.id}">${state.favs.includes(e.id)?'已收藏':'收藏空间'}</button><button data-go="spaces">切换空间</button></div></div><div class="panel"><h3>继续探索</h3><p class="prompt-note">从此处切换世界。各场景保留原有视角、动效与性能控制。</p>${t==='dreams'?'<div class="subroutes">'+Array.from({length:8},(_,i)=>`<a href="/dreams/0${i+1}/" >梦境 0${i+1} ↗</a>`).join('')+'</div>':''}<p class="fine">${['meow','swarmera'].includes(t)?'商品、购物清单、社区草稿与意向预约为本地体验，不代表真实交易或在线社区。':'支持原有独立路由；新导航不覆盖当前空间页面。'}</p></div></div>`}
function search(){dialog('<h2>下一站，去哪里？</h2><input id="globalSearch" class="wide-search" placeholder="搜索功能、空间或路径" aria-label="快捷搜索"><div id="searchResults" class="modal-results"></div><p class="fine">↑ ↓ 选择 · Enter 打开 · Esc 关闭</p>');searchResults('')}
function searchResults(q){$('#searchResults').innerHTML=filterEntries(E,{role:state.role,query:q}).slice(0,12).map(e=>`<button data-open="${e.id}" data-search-result><span class="accent">${icon(e.type)}</span>${e.name}<small>${e.group}</small></button>`).join('')||'<p class="empty">没有结果，试试其他关键词。</p>'}


function settings() {
  main.innerHTML = heading('P06', '自己的节奏，自己的空间。', '管理主页偏好、共享账号与创作权限。') + `<div class="two-col">
    <section class="panel"><h2 ${state.user ? 'data-strgo-user-content' : ''}>${esc(state.user?.username || (sessionError ? '账号状态暂不可用' : '欢迎来到 STRGO'))}</h2>
    <p class="prompt-note">${state.user ? (state.role === 'admin' ? '管理员' : '创作成员') + ' · 与生图、AI、终端和社区共用账号' : sessionError ? esc(sessionError) : '登录后查看属于自己的任务、作品和权限。'}</p>
    <div class="row-actions"><a class="primary" href="${state.user ? '/ai/settings/' : loginLink()}">${state.user ? '账号、权限与额度 ↗' : '登录 / 邀请注册 ↗'}</a>${state.user ? '<button id="logout">退出账号</button>' : ''}<button data-refresh-session>重新检查</button></div>
    <p class="fine">Workflow 使用独立登录。管理员身份不自动取得 AI 模型使用权限。</p></section>
    <section class="panel"><h2>主页，按你的习惯打开。</h2>
    <label class="field">主页模式<select id="modePreference"><option value="console" ${state.mode === 'console' ? 'selected' : ''}>控制台</option><option value="immersive" ${state.mode === 'immersive' ? 'selected' : ''}>沉浸模式</option></select></label>
    <label class="field">动态效果<select id="motionPreference"><option value="auto" ${state.motion === 'auto' ? 'selected' : ''}>跟随系统偏好</option><option value="off" ${state.motion === 'off' ? 'selected' : ''}>关闭动态效果</option></select></label>
    <p class="fine">偏好保存在此浏览器，并按账号隔离。主页切换不会更改网站默认根地址。</p>
    <div class="row-actions"><a href="${esc(D.classicRoute)}">打开经典主页 ↗</a><button id="clearRecent">清空最近访问</button></div></section></div>`;
}

function privateGate() {
  if (!checked) return '<section class="panel empty" role="status">正在确认登录状态…</section>';
  if (sessionError) return `<section class="panel empty"><h2>暂时无法确认账号</h2><p>${esc(sessionError)}</p><button data-refresh-session>重试</button></section>`;
  return `<section class="panel empty"><h2>登录后，继续你的创作。</h2><p>任务与作品仅对当前账号可见。</p><a class="primary" href="${loginLink()}">登录 STRGO</a></section>`;
}
const sourceNames = { image: '生图', music: '音乐', chat: '对话', ai: 'AI 创作' };
const statusOptions = [['all', '全部状态'], ['queued', '排队中'], ['running', '执行中'], ['saving', '保存中'], ['save_failed', '保存失败'], ['unknown', '待核实'], ['complete', '已完成'], ['partial', '部分完成'], ['failed', '生成失败'], ['cancelled', '已取消'], ['cancelling', '取消中'], ['interrupted', '已中断']];
const date = seconds => seconds ? new Date(seconds * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';
function collectionPage(kind) {
  collectionRequest?.abort(); collection = null;
  main.innerHTML = heading(kind === 'tasks' ? 'P04' : 'P05', kind === 'tasks' ? '每一次创作，都有回音。' : '让作品，留在自己的轨道。', kind === 'tasks' ? '图像、音乐与对话任务。保留原模块的状态和处理方式。' : '只展示当前账号的图像与音乐作品，私有访问和保留规则继续生效。');
  if (!state.user || sessionError || !checked) { main.insertAdjacentHTML('beforeend', privateGate()); return; }
  main.insertAdjacentHTML('beforeend', `<div class="collection-controls"><label>来源<select id="listSource">${[['all', '全部来源'], ['image', '生图'], ['music', '音乐'], ...(kind === 'tasks' ? [['chat', '对话']] : [])].map(([id, name]) => `<option value="${id}" ${id === listSource ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>状态<select id="listState">${statusOptions.map(([id, name]) => `<option value="${id}" ${id === listState ? 'selected' : ''}>${name}</option>`).join('')}</select></label><button id="refreshList">刷新</button></div>
    <div id="sourceNotice"></div><div id="collectionResults" aria-live="polite"></div><div id="pagination"></div>
    <p class="fine">按创建时间排序 · 时间为北京时间。${kind === 'assets' ? '音乐保存 90 天，请及时下载。' : '结果待核实时，先查看原任务；不会自动重新生成。'} ${state.role === 'admin' ? `<a href="${esc(D.workflowOrigin)}" target="_blank" rel="noopener noreferrer">Workflow 独立工作台 ↗</a>` : ''}</p>`);
  loadCollection(kind);
}

async function loadCollection(kind, cursor = '') {
  collectionRequest?.abort(); const controller = new AbortController(); collectionRequest = controller;
  const owner = state.user?.id; if (!owner) return;
  const container = $('#collectionResults'); if (!container) return;
  container.innerHTML = '<div class="panel empty" role="status">正在读取你的记录…</div>'; $('#pagination').innerHTML = '';
  const params = new URLSearchParams({ source: listSource, status: listState, limit: '24' }); if (cursor) params.set('cursor', cursor);
  try {
    const data = await requestJSON('/api/image/hub/' + kind + '?' + params, { signal: controller.signal });
    if (controller.signal.aborted || view() !== kind || state.user?.id !== owner) return;
    if (data.user_id !== owner) { await refreshSession(); return; }
    collection = data;
    $('#sourceNotice').innerHTML = data.sources.filter(s => s.status !== 'ok').map(s => `<div class="notice">${sourceNames[s.id]}：${s.status === 'permission_required' ? '尚未授权或授权已到期。<a href="/ai/settings/">查看权限 ↗</a>' : '暂时读取失败，其他来源仍可查看。请稍后刷新。'}</div>`).join('');
    if (!data.items.length) container.innerHTML = `<section class="panel empty"><h2>${data.partial ? '部分来源暂时不可用' : listSource !== 'all' || listState !== 'all' ? '没有符合筛选的记录' : '从一次创作开始。'}</h2><p>${data.partial ? '当前结果不代表完整作品或任务列表。' : '新建创作或切换筛选后再来查看。'}</p><a class="primary" href="/ai/">进入创作空间 ↗</a></section>`;
    else if (kind === 'tasks') container.innerHTML = `<div class="task-summary"><div class="panel"><small>本页进行中</small><h2>${data.items.filter(i => ['queued','running','saving','cancelling'].includes(i.status)).length}</h2></div><div class="panel"><small>本页需要处理</small><h2>${data.items.filter(i => ['save_failed','unknown','failed','partial','interrupted'].includes(i.status)).length}</h2></div><div class="panel"><small>当前页记录</small><h2>${data.items.length}</h2></div></div><section class="panel table-panel"><div class="table-scroll"><table><thead><tr><th>创作任务</th><th>来源</th><th>状态</th><th>创建时间</th><th>处理</th></tr></thead><tbody>${data.items.map(item => `<tr><td><strong data-strgo-user-content>${esc(item.title || '未命名创作')}</strong><small>${esc(item.id)}</small></td><td>${sourceNames[item.source]}</td><td><span class="badge">${esc(item.status_label)}</span>${item.error ? `<p class="fine" data-strgo-user-content>${esc(item.error)}</p>` : ''}</td><td>${date(item.created)}</td><td><a href="${esc(item.href)}">查看原任务 ↗</a>${item.actions.filter(a => allowedAction(a, item)).map(a => `<button data-action-key="${item.key}" data-action-type="${a.type}">${a.label}</button>`).join('')}</td></tr>`).join('')}</tbody></table></div></section>`;
    else container.innerHTML = `<div class="asset-grid">${data.items.map(item => `<article class="space-card asset-item">${item.source === 'image' ? `<a href="${esc(item.preview_url)}" target="_blank" rel="noopener"><img class="asset-cover" src="${esc(item.preview_url)}" loading="lazy" alt="${esc(item.title || '我的图像')}"></a>` : `<div class="music-art">≋<span>PRIVATE AUDIO</span></div>`}<div class="asset-body"><span class="badge">${sourceNames[item.source]} · ${esc(item.status_label)}</span><h3 data-strgo-user-content>${esc(item.title || '未命名作品')}</h3><p class="fine">${date(item.created)} · 仅自己可见${item.expires_at ? '<br>保留至 ' + date(item.expires_at) : ''}</p>${item.source === 'music' ? `<audio controls preload="none" src="${esc(item.preview_url)}" aria-label="播放 ${esc(item.title)}"></audio>` : ''}<div class="asset-actions"><a href="${esc(item.download_url)}" download>下载</a><a href="${esc(item.reuse_href)}">${item.source === 'image' ? '复用参数' : '打开音乐草稿'} ↗</a>${item.actions.filter(a => allowedAction(a, item)).map(a => `<button data-action-key="${item.key}" data-action-type="${a.type}">${a.label}</button>`).join('')}</div></div></article>`).join('')}</div>`;
    $('#pagination').innerHTML = `<div class="row-actions">${cursor ? '<button id="firstPage">返回最新</button>' : ''}${data.next_cursor ? '<button id="nextPage">下一页 →</button>' : ''}</div>`;
  } catch (error) {
    if (controller.signal.aborted || view() !== kind || state.user?.id !== owner) return;
    if (error.status === 401) { await refreshSession(); return; }
    container.innerHTML = `<div class="panel empty" role="alert"><h2>暂时无法读取记录</h2><p>${esc(error.message)}</p><button id="refreshList">重试</button></div>`;
  }
}

async function confirmAction(key, type) {
  const item = collection?.items.find(i => i.key === key), action = item?.actions.find(a => a.type === type);
  if (!item || !allowedAction(action, item)) return;
  const owner = state.user.id, kind = view();
  const copy = {
    retry_save: ['重试保存现有结果', '只同步已生成的图片，不会再次调用模型。'],
    cancel: ['取消这个任务', '取消结果以原模块返回的最终状态为准，已执行的请求可能已产生消耗。'],
    delete_asset: ['删除这件作品？', '将删除私有作品文件。此操作不能撤销，已消耗的生成额度不会返还。'],
    reuse_music: ['使用原始参数创建音乐草稿', '将复制这次任务的原始参数；编辑并确认生成后才会调用模型。']
  }[type];
  dialog(`<h2>${copy[0]}</h2><p>${copy[1]}</p><button id="confirmAction" class="primary">确认${action.label}</button>`);
  $('#confirmAction').onclick = async event => {
    event.target.disabled = true;
    try {
      // Revalidate identity immediately before the original module mutation.
      const session = await requestJSON('/api/image/session');
      if (session.user?.id !== owner) { modal.close(); await refreshSession(); toast('账号已变化，请重新选择任务。'); return; }
      if (type === 'reuse_music') {
        const task = await requestJSON(action.endpoint);
        if (!task.parameters) throw new Error('原始参数已超过保留期限，无法复用。');
        const draft = await requestJSON('/api/ai/v1/forms', { method: 'POST', body: { kind: 'music', fields: task.parameters }, csrf: session.csrf });
        modal.close(); location.assign('/ai/music/?form=' + encodeURIComponent(draft.id)); return;
      }
      await requestJSON(action.endpoint, { method: type === 'delete_asset' ? 'DELETE' : 'POST', body: {}, csrf: session.csrf });
      modal.close(); toast('请求已提交，正在读取最终状态。'); await loadCollection(kind);
    } catch (error) { event.target.disabled = false; toast(error.message); }
  };
}

function render() {
  stopOrbit(); collectionRequest?.abort(); document.body.classList.remove('immersive'); document.body.classList.toggle('reduced', state.motion === 'off');
  const v = view();
  $('#railNav').innerHTML = [['hub','⌂','主页'],['catalog','⊞','功能'],['studio','✳','创作'],['spaces','◉','空间'],['tasks','◷','任务'],['assets','▧','作品'],['settings','⚙','我的'],...(state.role === 'admin' ? [['admin','⊡','管理']] : [])].map(([r,i,n]) => `<a href="${r === 'studio' ? '/ai/' : r === 'admin' ? '/admin/' : '#' + r}" class="${v === r ? 'active' : ''}" ${v === r ? 'aria-current="page"' : ''} aria-label="${n}">${icon(r)}<span>${n}</span></a>`).join('');
  $$('.mobile-nav a').forEach(a => { a.classList.toggle('active', a.hash === '#' + v); if (a.hash === '#' + v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('#accountStatus').innerHTML = !checked ? '正在确认账号…' : sessionError ? '账号连接暂不可用' : state.user ? `<span data-strgo-user-content>${esc(state.user.username)}</span> · <span>${state.role === 'admin' ? '管理员' : '创作成员'}</span>` : '访客 · 登录后继续创作';
  $('#profile').textContent = state.user?.username?.[0]?.toUpperCase() || 'S';
  if (v.startsWith('space-') && get(v.slice(6))?.group === '沉浸空间') space(v.slice(6));
  else if (v === 'tasks' || v === 'assets') collectionPage(v);
  else if (v === 'studio' || v === 'admin') location.assign(v === 'studio' ? '/ai/' : '/admin/');
  else ({hub, catalog, spaces, settings}[v] || hub)();
  document.title = `STRGO · ${D.screens.find(s => s[2] === v)?.[1] || '探索空间'}`;
}

async function refreshSession() {
  const serial = ++sessionSerial;
  if (['tasks', 'assets'].includes(view())) {
    collectionRequest?.abort(); collection = null; checked = false;
    main.innerHTML = privateGate();
  }
  try {
    const session = await requestJSON('/api/image/session');
    if (serial !== sessionSerial) return;
    const previous = state.user?.id, next = session.user?.id;
    sessionError = ''; checked = true;
    if (previous !== next) { collectionRequest?.abort(); collection = null; filter = '全部'; listSource = listState = 'all'; if (modal.open) modal.close(); }
    state = { ...readPreferences(storage, next, E), user: session.user, csrf: session.csrf || '', role: session.user?.role || 'guest' };
    render();
  } catch (error) {
    if (serial !== sessionSerial) return;
    sessionError = error.name === 'TimeoutError' ? '账号服务连接超时。' : error.message; checked = true;
    collectionRequest?.abort(); collection = null; state = { ...readPreferences(storage, null, E), user: null, csrf: '', role: 'guest' };
    if (modal.open) modal.close(); render();
  }
}

document.addEventListener('click', event => {
  const b = event.target.closest('button,[data-entry]'); if (!b) return;
  if (b.dataset.entry) { const e = get(b.dataset.entry); if (e) remember(e); }
  if (b.dataset.go) go(b.dataset.go);
  if (b.dataset.open) { modal.close(); openEntry(b.dataset.open); }
  if (b.dataset.fav) { const e = get(b.dataset.fav); if (!e || !available(e)) return; state.favs = state.favs.includes(e.id) ? state.favs.filter(id => id !== e.id) : [...state.favs,e.id]; persist(); toast(state.favs.includes(e.id) ? '已收藏到主页快捷入口' : '已取消收藏'); view() === 'catalog' ? catalogResults() : render(); }
  if (b.dataset.filter) { filter = b.dataset.filter; catalog(); }
  if (b.hasAttribute('data-reset-search')) { filter = '全部'; query = ''; catalog(); }
  if (b.dataset.mode) { state.mode = b.dataset.mode; persist(); render(); }
  if (b.id === 'motionQuick') { state.motion = state.motion === 'off' ? 'auto' : 'off'; persist(); render(); }
  if (b.id === 'searchOpen') search();
  if (b.id === 'profile') go('settings');
  if (b.id === 'clearRecent') { state.recent = []; persist(); toast('已清空当前账号的本机访问记录'); }
  if (b.classList.contains('close')) modal.close();
  if (b.hasAttribute('data-refresh-session')) refreshSession();
  if (b.id === 'refreshList' || b.id === 'firstPage') loadCollection(view());
  if (b.id === 'nextPage' && collection?.next_cursor) loadCollection(view(), collection.next_cursor);
  if (b.dataset.actionKey) confirmAction(b.dataset.actionKey, b.dataset.actionType);
  if (b.id === 'logout') { b.disabled = true; requestJSON('/api/image/logout', {method:'POST',body:{},csrf:state.csrf}).then(refreshSession).catch(error => { b.disabled = false; toast(error.message); }); }
});
document.addEventListener('input', event => { if (event.target.id === 'catalogSearch') { query = event.target.value; catalogResults(); } if (event.target.id === 'globalSearch') searchResults(event.target.value); });
document.addEventListener('change', event => {
  const {id,value} = event.target;
  if (id === 'modePreference' || id === 'motionPreference') { state[id === 'modePreference' ? 'mode' : 'motion'] = value; persist(); document.body.classList.toggle('reduced',state.motion === 'off'); toast('偏好已保存到此浏览器'); }
  if (id === 'listSource' || id === 'listState') { if (id === 'listSource') listSource = value; else listState = value; loadCollection(view()); }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); modal.open ? modal.close() : search(); }
  if (!modal.open || !$('#globalSearch')) return;
  const results = $$('[data-search-result]'), current = results.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const index = current < 0 ? (event.key === 'ArrowDown' ? 0 : results.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length; results[index]?.focus(); }
  if (event.key === 'Enter' && document.activeElement.id === 'globalSearch') { event.preventDefault(); results[0]?.click(); }
});
$('.skip').addEventListener('click', event => { event.preventDefault(); main.focus(); });
modal.addEventListener('click', event => { if (event.target === modal) modal.close(); });
window.addEventListener('hashchange', () => { listSource = listState = 'all'; render(); window.scrollTo(0,0); main.focus({preventScroll:true}); });
window.addEventListener('resize', restartOrbit);
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', restartOrbit);
document.addEventListener('visibilitychange', () => {
  stopOrbit();
  if (document.hidden && ['tasks', 'assets'].includes(view())) { collectionRequest?.abort(); collection = null; main.replaceChildren(); }
  if (!document.hidden) refreshSession();
});
window.addEventListener('focus', () => { if (!document.hidden && ['tasks', 'assets'].includes(view())) refreshSession(); });
window.addEventListener('pagehide', () => { stopOrbit(); collectionRequest?.abort(); collection = null; if (['tasks','assets'].includes(view())) main.replaceChildren(); });
window.addEventListener('pageshow', event => { if (event.persisted) refreshSession(); });
window.addEventListener('storage', event => { if (event.key === 'strgo:hub:v1:' + (state.user?.id || 'guest')) { Object.assign(state, readPreferences(storage,state.user?.id,E)); render(); } });
// Legacy root hash links must be handled client-side: fragments never reach Nginx.
if (location.pathname === '/' && D.homeVariant === 'hub' && ['projects','stack','lab','contact'].includes(location.hash.slice(1))) location.replace(D.classicRoute + location.hash);
else { render(); refreshSession(); }
