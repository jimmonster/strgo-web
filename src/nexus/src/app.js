import {SceneManager} from './scene.js';
import {sceneConfig} from './scene-config.js';
import {destinations,technologies,archives,galaxyGroups} from './content-data.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const listeners=[];
function listen(target,type,handler,options){target.addEventListener(type,handler,options);listeners.push(()=>target.removeEventListener(type,handler,options));}
const media=matchMedia('(prefers-reduced-motion: reduce)');
function saved(){try{return JSON.parse(localStorage.getItem('nexus-settings')||'{}');}catch{return {};}}
const prefs=saved();
const state={scenePreset:0,transitionPhase:'idle',overlay:null,quality:['auto','low','medium','high'].includes(prefs.quality)?prefs.quality:'auto',motionPaused:!!prefs.motionPaused,reducedMotion:prefs.reducedMotion??media.matches,audioEnabled:false,loadingState:'ready',selectedDestination:null};
const dialog=$('#main-dialog');let trigger=null,dialogRoot=null,toastTimer,transition=null,trailer=null,focusView=false,appRAF,lastApp=0,dataAt=0;
let audioContext,audioGain;const audioNodes=[];
function persist(){try{localStorage.setItem('nexus-settings',JSON.stringify({quality:state.quality,motionPaused:state.motionPaused,reducedMotion:state.reducedMotion}));}catch{}}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3800);}
function syncMotion(){document.body.classList.toggle('paused',state.motionPaused);document.body.classList.toggle('reduced',state.reducedMotion);sceneConfig.motion.paused=state.motionPaused;syncAudio();persist();}
const scene=new SceneManager(state,(quality,mode)=>{
 document.body.classList.toggle('emergency-mode',mode!=='webgl');
 $('#quality-status').textContent=(state.quality==='auto'?'AUTO / ':'')+quality.toUpperCase();
 $('#scene-status-text').textContent=mode==='webgl'?'LIVE OBSERVATION':'CANVAS 2D / 应急模式';
});
syncMotion();
function syncAudio(){if(!audioContext)return;if(state.audioEnabled&&!state.motionPaused&&!document.hidden){audioContext.resume().catch(()=>{});audioGain.gain.setTargetAtTime(.027,audioContext.currentTime,.8);}else audioContext.suspend().catch(()=>{});}
async function toggleAudio(){
 state.audioEnabled=!state.audioEnabled;
 if(state.audioEnabled&&!audioContext){
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx){state.audioEnabled=false;toast('当前浏览器不支持环境音。');return;}
  audioContext=new AudioCtx();audioGain=audioContext.createGain();audioGain.gain.value=0;audioGain.connect(audioContext.destination);
  [55,82.41,110.1].forEach((freq,i)=>{const o=audioContext.createOscillator();o.frequency.value=freq;o.type='sine';const g=audioContext.createGain();g.gain.value=i===0?.45:.17;o.connect(g);g.connect(audioGain);o.start();audioNodes.push(o,g);});
 }syncAudio();toast(state.audioEnabled?'环境音已开启':'环境音已关闭');
}
listen(media,'change',e=>{state.reducedMotion=e.matches;syncMotion();if(transition)finishJourney(false);if(trailer)endTrailer();if(state.overlay==='menu')renderPanel('menu');});
listen(document,'visibilitychange',()=>{syncAudio();lastApp=0;});
function demoLabel(){return '<span class="demo-label">本地演示 · 无真实航班或交易</span>';}
function destinationCards(){return '<div class="content-grid">'+destinations.map(d=>`<button class="content-item" data-destination="${d.id}"><div class="planet-swatch ${d.color}"></div><small>${d.en}</small><h3>${d.name}</h3><p>${d.description}</p><span class="detail-arrow">${d.distance} &nbsp; / &nbsp; 查看目的地 ↗</span></button>`).join('')+'</div>';}
function techCards(){return '<div class="archive-list">'+technologies.map(d=>`<button class="content-item" data-tech="${d.id}"><small>${d.en}</small><h3>${d.name}</h3><p>${d.description}</p><span class="detail-arrow">了解概念与边界 ↗</span></button>`).join('')+'</div>';}
function archiveItems(items){return items.map(a=>`<button class="content-item" data-archive="${a.id}"><small>${a.category} / NEXUS ARCHIVE</small><h3>${a.title}</h3><p>${a.summary}</p></button>`).join('');}
function setDialog(title,kicker,html){$('#dialog-title').textContent=title;$('#dialog-kicker').textContent=kicker;$('#dialog-content').innerHTML=html;$('.dialog-inner').scrollTop=0;}
function openPanel(type,source=document.activeElement){
 if(transition||trailer)return;
 if(!dialog.open){trigger=source instanceof HTMLElement?source:$('#journey-btn');dialogRoot=type;}
 state.overlay=type;renderPanel(type);
 if(!dialog.open){dialog.showModal();document.body.classList.add('modal-open');document.documentElement.classList.add('modal-open');}
 requestAnimationFrame(()=>{const first=type==='search'?$('#search-input'):$('#close-dialog');first?.focus();});
}
function closePanel(restore=true){if(dialog.open)dialog.close();state.overlay=null;document.body.classList.remove('modal-open');document.documentElement.classList.remove('modal-open');if(restore&&trigger?.isConnected)trigger.focus({preventScroll:true});}
function renderPanel(type){
 switch(type){
 case 'explore':setDialog('探索，无限可能','NEXUS / GALAXY CATALOG',demoLabel()+'<p class="panel-lead">100+ 个星系，100+ 种对宇宙的想象。选择一种星系类型，开启你的探索。</p><div class="content-grid">'+galaxyGroups.map((g,i)=>`<button class="content-item" data-galaxy="${i}"><small>${g.en}</small><h3>${g.name}</h3><p>${g.description}</p><span class="detail-arrow">浏览星系 ↗</span></button>`).join('')+'</div>');break;
 case 'destinations':setDialog('下一站，星辰','NEXUS / DESTINATIONS',demoLabel()+'<p class="panel-lead">从熟悉的太阳系，到遥远的恒星邻居。这里的三处演示目的地，等待你的到来。</p>'+destinationCards());break;
 case 'routes':setDialog('选择你的星际航线','NEXUS / FLIGHT PLANNING',demoLabel()+'<p class="panel-lead">跃迁连接已建立。选择目的地，生成一份属于你的演示航行计划。</p>'+destinationCards()+'<button class="panel-button secondary" data-action="return">← 返回观景台</button>');break;
 case 'technology':setDialog('想象，先于抵达','NEXUS / STARSHIP TECHNOLOGY','<p class="panel-lead">探索航行的下一种可能。以下技术包含理论与科幻设定，尚不代表现实可用的航行能力。</p>'+techCards());break;
 case 'archives':setDialog('宇宙，仍在书写','NEXUS / COSMIC ARCHIVES','<p class="panel-lead">收藏一次观测、一项想法与一段文明记忆。以下为本地演示档案。</p><div class="filter-row" id="archive-filters">'+['全部','天体物理','深空观测','文明记录','航行科技'].map((f,i)=>`<button class="filter-btn ${i===0?'active':''}" data-filter="${f}" aria-pressed="${i===0}">${f}</button>`).join('')+'</div><div class="archive-list" id="archive-results">'+archiveItems(archives)+'</div>');break;
 case 'about':setDialog('为下一次仰望而生','NEXUS / ABOUT US','<span class="demo-label">交互概念站点 · VERSION 1.0</span><p class="panel-lead">NEXUS INTERSTELLAR 是一座关于星际探索的数字观景台。我们用实时视觉与交互叙事，邀请你重新想象人类与宇宙的关系。</p><div class="fact-grid"><div class="fact"><b>01</b><span>共同的蓝色起点</span></div><div class="fact"><b>∞</b><span>未被探索的可能</span></div><div class="fact"><b>TOGETHER</b><span>一同走向更远处</span></div></div><p class="panel-lead">这里展示的航线、基地、探索者数量与任务状态均为演示数据。黑洞为艺术化实时近似，页面未连接真实账户、支付或航行服务。</p><button class="panel-button" data-panel="homeworld">了解家园计划 ↗</button>');break;
 case 'homeworld':setDialog('人类的下一个家园','NEXUS / THE NEXT HOME',demoLabel()+'<p class="panel-lead">在更远的星辰，延续文明。家园计划从理解我们的地球开始，以谨慎的科学探索走向新的世界。</p><div class="archive-list">'+[['01 / OBSERVE','遥望与观测','分析行星光谱、大气与轨道，建立初步环境档案。'],['02 / EXPLORE','机器人先遣','让探测器先行，理解地表、辐射与资源条件。'],['03 / SUSTAIN','让生命延续','研究闭环生态、食物与能源，保存文明共同的记忆。']].map(x=>`<div class="content-item"><small>${x[0]}</small><h3>${x[1]}</h3><p>${x[2]}</p></div>`).join('')+'</div><button class="panel-button" data-panel="destinations">查看探索目标 ↗</button>');break;
 case 'blackhole':setDialog('未知的远方','NEXUS / GARGANTUA OBSERVATION','<span class="demo-label">艺术化观测场景 · 非精确物理模拟</span><p class="panel-lead">在光无法逃逸的边界，宇宙显露出另一种秩序。暗核遮挡了身后的星光；炽热物质构成倾斜的吸积盘，而引力将远处星空弯折成光弧。</p><div class="fact-grid"><div class="fact"><b>12.4 LY</b><span>场景航行距离</span></div><div class="fact"><b>ACTIVE</b><span>引力透镜状态</span></div><div class="fact"><b>4217</b><span>观测场景编号</span></div></div><p class="panel-lead">RA 18h 30m 56s · DEC −23° 02′ 14″<br>以上为场景展示坐标与演示数值。</p><button class="panel-button" data-action="focus">聚焦黑洞 <span>↗</span></button><button class="panel-button secondary" data-action="return">返回观景台</button>');break;
 case 'search':setDialog('寻找你的宇宙','NEXUS / LOCAL SEARCH','<p class="panel-lead">搜索目的地与宇宙档案。试试“比邻星”“黑洞”或“文明”。</p><label class="search-field"><svg><use href="#i-search"/></svg><input id="search-input" type="search" autocomplete="off" placeholder="输入星球、主题或关键词…" aria-label="搜索本地目的地和宇宙档案"></label><div id="search-results" aria-live="polite"></div>');renderSearch('');break;
 case 'account':setDialog('每位探索者，都有一个起点','NEXUS / EXPLORER ACCESS','<span class="demo-label">界面演示 · 未接入账户系统</span><p class="panel-lead">观景台对所有访客开放。你可以浏览全部本地演示内容，无需提交真实姓名、邮箱或密码。</p><div class="content-item"><small>GUEST EXPLORER / 0387</small><h3>以好奇心，作为通行证</h3><p>访客模式可查看星系、筛选档案、选择演示航线与调整观景设置。</p></div><button class="panel-button" data-action="guest">以访客身份继续 ↗</button>');break;
 case 'menu':setDialog('观景台控制中心','NEXUS / OBSERVATORY CONTROLS','<div class="menu-nav">'+[['home','首页'],['explore','探索'],['destinations','目的地'],['technology','星舰科技'],['archives','宇宙档案'],['about','关于我们']].map(([key,label])=>`<button ${key==='home'?'data-action="home"':`data-panel="${key}"`}>${label}</button>`).join('')+'</div>'+setting('audio','环境音','轻声聆听深空。默认关闭，仅在主动开启后播放。',state.audioEnabled)+setting('pause','暂停动效','冻结场景、卡片、扫描线与数据刷新。',state.motionPaused)+setting('reduce','减少动态效果','停止持续运动与镜头推进，保留完整静态观景。',state.reducedMotion)+'<label class="settings-row"><span>画质<small>自动模式根据持续帧时间调整；核心尺寸保持一致。</small></span><select id="quality-select" aria-label="渲染画质">'+[['auto','自动'],['high','高'],['medium','中'],['low','低']].map(([v,n])=>`<option value="${v}" ${state.quality===v?'selected':''}>${n}</option>`).join('')+'</select></label>');break;
 case 'language':setDialog('语言设置','NEXUS / LANGUAGE','<p class="panel-lead">当前版本提供简体中文界面。</p><div class="content-item"><small>CURRENT LANGUAGE</small><h3>简体中文 <span class="language-check">✓</span></h3><p>其余语言暂未提供翻译。</p></div>');break;
 }
}
function setting(id,title,description,checked){return `<div class="settings-row"><span>${title}<small>${description}</small></span><button class="switch" role="switch" aria-checked="${checked}" aria-label="${title}" data-setting="${id}"></button></div>`;}
function renderSearch(query){
 const q=query.trim().toLowerCase();const terms=q==='黑洞'?['黑洞','视界']: [q];
 const ds=destinations.filter(d=>terms.some(k=>(d.name+d.en+d.type+d.description).toLowerCase().includes(k)));
 const as=archives.filter(a=>terms.some(k=>(a.title+a.summary+a.category).toLowerCase().includes(k)));
 $('#search-results').innerHTML=`<p class="result-count">${ds.length+as.length} 个本地结果${q?'':' / 全部内容'}</p>`+(ds.length+as.length?'<div class="archive-list">'+ds.map(d=>`<button class="content-item" data-destination="${d.id}"><small>目的地 / ${d.distance}</small><h3>${d.name}</h3><p>${d.description}</p></button>`).join('')+archiveItems(as)+'</div>':'<div class="empty-state">没有找到匹配的目的地或档案。<br>换一个关键词，继续探索。</div>');
}
function showDestination(id){
 const d=destinations.find(x=>x.id===id);if(!d)return;
 state.selectedDestination=id;state.overlay='destination-detail';
 setDialog(d.name,'NEXUS / '+d.en,demoLabel()+`<div class="planet-swatch planet-detail ${d.color}"></div><p class="panel-lead">${d.description}</p><div class="fact-grid"><div class="fact"><b>${d.distance}</b><span>演示距离</span></div><div class="fact"><b>${d.time}</b><span>演示航行时间</span></div><div class="fact"><b>READY</b><span>演示任务状态</span></div></div><p class="panel-lead">${d.details}</p><div class="route-map"><span><i></i>地球 · NEXUS 港</span><span><i></i>深空跃迁点</span><span><i></i>${d.name}</span></div><button class="panel-button" data-route="${d.id}">生成演示航线 ↗</button><button class="panel-button secondary" data-panel="${dialogRoot==='routes'?'routes':'destinations'}">← 返回列表</button><div id="route-feedback" role="status"></div>`);
 $('#close-dialog').focus();
}
function home(){endTrailer();cancelJourney(false);focusView=false;scene.approach=0;scene.fade=0;state.scenePreset=0;updatePreset();$('#focus-return')?.remove();closePanel(false);$('.brand').focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
function updatePreset(){ $$('[data-preset]').forEach(b=>{const active=Number(b.dataset.preset)===state.scenePreset;b.classList.toggle('selected',active);if(active)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});}
function startJourney(){
 if(transition)return;
 closePanel(false);focusView=false;$('#focus-return')?.remove();
 if(state.reducedMotion||state.motionPaused){openPanel('routes',$('#journey-btn'));return;}
 transition={elapsed:0};state.transitionPhase='approach';$('#journey-btn').disabled=true;document.body.classList.add('transitioning');$('#skip-transition').hidden=false;$('#skip-transition').focus({preventScroll:true});
}
function restoreJourney(){transition=null;scene.approach=0;scene.fade=0;scene.flowBoost=1;state.transitionPhase='idle';$('#journey-btn').disabled=false;document.body.classList.remove('transitioning');$('#skip-transition').hidden=true;}
function finishJourney(showRoutes=true){restoreJourney();if(showRoutes)openPanel('routes',$('#journey-btn'));else $('#journey-btn').focus({preventScroll:true});}
function cancelJourney(restoreFocus=true){if(!transition)return;restoreJourney();if(restoreFocus)$('#journey-btn').focus({preventScroll:true});}
function startTrailer(){
 if(trailer||transition)return;
 if(state.reducedMotion||state.motionPaused){toast('动态效果已停止。可在菜单中开启完整动效后观看 25 秒场景演示。');return;}
 closePanel(false);trailer={elapsed:0,preset:state.scenePreset,source:document.activeElement};document.body.classList.add('trailer-playing');$('#trailer-hud').hidden=false;$('#end-trailer').focus({preventScroll:true});
}
function endTrailer(){if(!trailer)return;const saved=trailer;trailer=null;state.scenePreset=saved.preset;scene.approach=0;scene.fade=0;updatePreset();document.body.classList.remove('trailer-playing');$('#trailer-hud').hidden=true;saved.source?.focus({preventScroll:true});}
function action(name){
 switch(name){case 'home':home();break;case 'trailer':startTrailer();break;case 'return':focusView=false;$('#focus-return')?.remove();scene.approach=0;scene.fade=0;state.scenePreset=0;updatePreset();closePanel();break;case 'guest':closePanel();toast('欢迎，访客探索者。观景台已为你开放。');break;
 case 'focus':closePanel(false);focusView=true;scene.approach=.12;const b=document.createElement('button');b.className='panel-button';b.id='focus-return';b.textContent='← 返回观景台';b.dataset.action='return';document.body.append(b);b.focus();toast('已聚焦黑洞 · 按 Esc 返回观景台');break;}
}
// One delegated handler keeps every entry connected, including generated panel content.
listen(document,'click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.action){action(b.dataset.action);return;}
 if(b.dataset.panel){openPanel(b.dataset.panel,b);return;}
 if(b.dataset.preset!==undefined){state.scenePreset=Number(b.dataset.preset);updatePreset();toast(`${String(state.scenePreset+1).padStart(2,'0')} / ${sceneConfig.presets[state.scenePreset].name} — ${sceneConfig.presets[state.scenePreset].subtitle}`);return;}
 if(b.dataset.destination){showDestination(b.dataset.destination);return;}
 if(b.dataset.tech){const t=technologies.find(x=>x.id===b.dataset.tech);setDialog(t.name,'NEXUS / '+t.en,`<p class="panel-lead">${t.description}</p><div class="content-item"><h3>概念说明</h3><p>${t.details}</p></div><button class="panel-button secondary" data-panel="technology">← 返回科技面板</button>`);$('#close-dialog').focus();return;}
 if(b.dataset.archive){const a=archives.find(x=>x.id===b.dataset.archive);setDialog(a.title,'NEXUS / '+a.category,`<span class="demo-label">本地演示档案</span><p class="panel-lead">${a.summary}</p><p class="panel-lead">宇宙探索从提出问题开始。NEXUS 以这个主题作为观测与想象的起点，邀请每一位探索者继续了解真实的科学发现。此处为概念站点的展示摘要。</p><button class="panel-button secondary" data-panel="archives">← 返回宇宙档案</button>`);$('#close-dialog').focus();return;}
 if(b.dataset.galaxy!==undefined){const g=galaxyGroups[Number(b.dataset.galaxy)];setDialog(g.name,'NEXUS / '+g.en,`<p class="panel-lead">${g.description}</p><div class="content-item"><small>CATALOG / LOCAL DEMO</small><h3>${['银河系 · 仙女座星系 · 三角座星系','M87 · M49 · M60','大麦哲伦星云 · 小麦哲伦星云','银河系 · M31 · M33'][Number(b.dataset.galaxy)]}</h3><p>此目录用于展示星系分类与浏览交互。跨星系航线尚未开放。</p></div><button class="panel-button secondary" data-panel="explore">← 返回星系目录</button>`);$('#close-dialog').focus();return;}
 if(b.dataset.filter){$$('[data-filter]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});$('#archive-results').innerHTML=archiveItems(archives.filter(a=>b.dataset.filter==='全部'||a.category===b.dataset.filter));return;}
 if(b.dataset.route){const d=destinations.find(x=>x.id===b.dataset.route);$('#route-feedback').innerHTML=`<div class="route-confirm">✓ 演示航线已生成：地球 → 深空跃迁点 → ${d.name}<br>计划仅保存在当前页面，没有提交真实航行请求。</div>`;b.textContent='航线已生成 ✓';b.disabled=true;return;}
 if(b.dataset.setting){switch(b.dataset.setting){case 'audio':await toggleAudio();break;case 'pause':state.motionPaused=!state.motionPaused;syncMotion();break;case 'reduce':state.reducedMotion=!state.reducedMotion;syncMotion();break;}b.setAttribute('aria-checked',String(b.dataset.setting==='audio'?state.audioEnabled:b.dataset.setting==='pause'?state.motionPaused:state.reducedMotion));}
});
listen(document,'input',e=>{if(e.target.id==='search-input')renderSearch(e.target.value);});
listen(document,'change',e=>{if(e.target.id==='quality-select'){scene.setQuality(e.target.value);persist();toast('画质已设为：'+e.target.selectedOptions[0].textContent);}});
listen($('#close-dialog'),'click',()=>closePanel());
listen(dialog,'cancel',e=>{e.preventDefault();closePanel();});
listen(dialog,'close',()=>{document.body.classList.remove('modal-open');document.documentElement.classList.remove('modal-open');state.overlay=null;});
listen(dialog,'click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closePanel();}});
// Native modal dialogs provide inert background; explicitly wrap keyboard focus too.
listen(dialog,'keydown',e=>{if(e.key!=='Tab')return;const nodes=[...dialog.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]')].filter(x=>x.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
listen($('#journey-btn'),'click',startJourney);listen($('#skip-transition'),'click',()=>finishJourney());listen($('#end-trailer'),'click',endTrailer);
listen(window,'keydown',e=>{if(e.key==='Escape'){if(transition){e.preventDefault();cancelJourney();}else if(trailer){e.preventDefault();endTrailer();}else if(focusView){e.preventDefault();action('return');}}});
function appFrame(now){
 const dt=lastApp?Math.min((now-lastApp)/1000,.05):0;lastApp=now;
 if(!document.hidden){
  if(transition){transition.elapsed+=dt;const t=transition.elapsed;scene.flowBoost=1+Math.min(1,t/.5)*.4;scene.approach=t<.5?0:Math.min(1,((t-.5)/2.2)**1.7);scene.fade=t>2.6?Math.min(1,(t-2.6)/.5):0;if(t>3.3)finishJourney();}
  if(trailer){trailer.elapsed+=dt;const t=trailer.elapsed;$('#trailer-time').textContent='00:'+String(Math.max(0,Math.ceil(25-t))).padStart(2,'0');state.scenePreset=Math.min(3,Math.floor(t/6.25));scene.approach=Math.sin(t/25*Math.PI)*.045;const captions=['每一次仰望，都是一次出发。','穿过引力的边界，追随遥远的星光。','让想象先行，让科技抵达。','在更远的星辰，延续文明。'];$('#trailer-caption').textContent=captions[state.scenePreset];if(t>=25)endTrailer();}
  if(!state.motionPaused&&!state.reducedMotion&&scene.time-dataAt>2.8){dataAt=scene.time;$('#frequency').textContent=(1420.406+Math.sin(scene.time*.7)*.004).toFixed(3);}
  if(scene.time<1.2&&!state.reducedMotion&&!state.motionPaused){$$('[data-count]').forEach(el=>{const target=Number(el.dataset.count),ratio=Math.min(1,scene.time/1.1);el.textContent=target%1?(target*(1-(1-ratio)**3)).toFixed(1):String(Math.round(target*(1-(1-ratio)**3)));});}
 }
 appRAF=requestAnimationFrame(appFrame);
}
appRAF=requestAnimationFrame(appFrame);
// Inspectable diagnostics and disposal for automated acceptance checks.
window.nexus={state,scene,config:sceneConfig,diagnostics:()=>scene.getDiagnostics(),openPanel,closePanel,startJourney,cancelJourney,dispose(){listeners.forEach(remove=>remove());cancelAnimationFrame(appRAF);clearTimeout(toastTimer);scene.dispose();audioNodes.forEach(n=>{try{n.stop?.();n.disconnect();}catch{}});audioContext?.close();}};
listen(window,'pagehide',()=>{audioContext?.suspend().catch(()=>{});});
