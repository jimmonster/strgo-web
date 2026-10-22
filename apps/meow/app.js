import {Store,download} from './modules/store.js';
import {Motion} from './modules/motion.js';
import {SceneHost} from './modules/scene.js';
import {findCat,findProduct} from './modules/catalog.js';
import {base,href,parsePath,escapeHTML} from './modules/routes.js';
import {header,footer,pageView} from './modules/views.js';

let storage;try{storage=localStorage;}catch{storage={getItem(){throw Error('浏览器禁用了本地存储。');},setItem(){throw Error('浏览器禁用了本地存储。');}};}
const store=new Store(storage),motion=new Motion(store),root=document.querySelector('#app');
let currentView,route,toastTimer,lastAction='wave',observing=false,staticPreview=false,navigationId=0;
const host=new SceneHost({motion,onStatus:text=>{const status=document.querySelector('[data-scene-status]');if(status)status.textContent=text;const actionStatus=document.querySelector('[data-action-status]');if(actionStatus)actionStatus.textContent=text;const mode=document.querySelector('[data-viewer-mode]');if(mode)mode.textContent=host.container?.dataset.mode==='static'?'静态角色预览':'REAL-TIME 3D';}});
const scrollMemory=new Map();try{Object.entries(JSON.parse(sessionStorage.getItem('meow.scroll')||'{}')).forEach(([k,v])=>scrollMemory.set(k,v));}catch{}
let currentURL=location.pathname+location.search;
function rememberScroll(){scrollMemory.delete(currentURL);scrollMemory.set(currentURL,scrollY);try{sessionStorage.setItem('meow.scroll',JSON.stringify(Object.fromEntries([...scrollMemory].slice(-60))));}catch{}history.replaceState({...history.state,scroll:scrollY},'');}
function render({restore=false,focus=false}={}){
  if(restore&&currentURL===location.pathname+location.search)scrollMemory.set(currentURL,scrollY);
  host.clear();route=parsePath();currentView=pageView(route,store,new URLSearchParams(location.search));document.title=`${currentView.title} · Meow`;
  root.innerHTML=`<div class="site-shell">${header(route.page,store)}<main id="main" tabindex="-1" class="${route.page?'inner-page':'home-page'}">${currentView.html}</main>${footer(store)}<div class="storage-banner" ${store.error?'':'hidden'} role="status"><span>${escapeHTML(store.error)}</span><button data-data-export type="button">下载备份</button><a href="${href('account/')}">数据设置</a></div><div class="toast" role="status" aria-live="polite"></div><dialog class="confirm-dialog" aria-labelledby="confirm-title"><h2 id="confirm-title">恢复默认数据？</h2><p>当前浏览器中的收藏、清单、档案与草稿都会移除。可以先导出一份备份。</p><div class="button-row"><button class="btn btn-soft" data-data-export type="button">先下载备份</button><button class="btn btn-primary" data-confirm-reset type="button">恢复默认</button><button class="small-button" data-cancel-reset type="button">取消</button></div></dialog></div>`;
  if(currentView.scene)host.mount(document.querySelector('[data-scene-host]'),currentView.scene);
  const dialog=document.querySelector('dialog');dialog?.addEventListener('close',()=>dialog._trigger?.focus());
  staticPreview=false;observing=innerWidth>=768;currentURL=location.pathname+location.search;
  const id=++navigationId;requestAnimationFrame(()=>{if(id!==navigationId)return;window.scrollTo(0,restore?(scrollMemory.get(currentURL)||history.state?.scroll||0):0);if(focus)document.querySelector('#main').focus({preventScroll:true});});root.dataset.ready='true';window.meow.ready=true;
}
function navigate(url,{pop=false,restore=false}={}){rememberScroll();const target=new URL(url,location.href);if(!target.pathname.startsWith(base))return;if(!pop)history.pushState({},'',target.pathname+target.search+target.hash);render({restore:pop||restore,focus:!pop});}
function toast(message){const el=document.querySelector('.toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3600);}
function report(result,form){const el=form?.querySelector('.form-feedback');const text=result.message||(result.ok?'已保存到当前浏览器。':'无法保存，请下载备份。');if(el){el.textContent=text;el.dataset.status=result.ok?'saved':'error';if(form)form.dataset.state=result.ok?'saved':'error';}else toast(text);updateSharedUI();return result.ok;}
function updateSharedUI(){document.querySelectorAll('[data-cart-count]').forEach(el=>el.textContent=store.count);document.querySelectorAll('[data-favorite]').forEach(el=>{const[type,id]=el.dataset.favorite.split(':');const active=store.has(type,id);el.setAttribute('aria-pressed',String(active));el.classList.toggle('is-favorite',active);const name=el.querySelector('.sr-only')?.textContent||id;el.setAttribute('aria-label',`${active?'取消收藏':'收藏'} ${name}`);});document.querySelectorAll('[data-motion-toggle]').forEach(el=>{el.textContent=motion.paused?'继续动效':'暂停动效';el.setAttribute('aria-pressed',String(motion.paused));});document.querySelectorAll('[data-reduce-motion]').forEach(el=>el.checked=store.data.settings.reduced);const banner=document.querySelector('.storage-banner');if(banner){banner.hidden=!store.error;banner.querySelector('span').textContent=store.error;}}
store.subscribe(updateSharedUI);window.addEventListener('storage',event=>{if(event.key==='meow.world'){store.sync();render({restore:true});}});
root.addEventListener('click',async event=>{
  const a=event.target.closest('a');if(a&&a.origin===location.origin&&a.pathname.startsWith(base)&&!a.hasAttribute('download')&&a.target!=='_blank'&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&event.button===0){if(a.hash&&a.pathname===location.pathname&&a.search===location.search)return;event.preventDefault();const back=(route.page==='cats'&&route.id&&a.pathname===href('cats/'))||(route.page==='gallery'&&route.id&&a.pathname===href('gallery/'));if(back){let target=a.href;for(const key of [...scrollMemory.keys()].reverse())if(key.split('?')[0]===a.pathname){target=key;break;}navigate(target,{restore:true});}else navigate(a.href);return;}
  const button=event.target.closest('button');if(!button)return;
  if(button.matches('[data-favorite]')){const[type,id]=button.dataset.favorite.split(':');report(store.favorite(type,id));if(route.page==='favorites'||new URLSearchParams(location.search).get('favorite')==='1')render({restore:true});}
  else if(button.matches('[data-toggle-menu]')){const menu=document.querySelector('#mobile-nav');menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));button.setAttribute('aria-label',menu.hidden?'打开菜单':'关闭菜单');}
  else if(button.matches('[data-cat-action]')){lastAction=button.dataset.catAction;host.play(lastAction);}
  else if(button.matches('[data-replay]'))host.play(lastAction);
  else if(button.matches('[data-camera]'))host.cameraControl(button.dataset.camera);
  else if(button.matches('[data-observe]')){observing=host.setObserving(!observing);button.textContent=observing?'退出观察':'开始观察';button.setAttribute('aria-pressed',String(observing));}
  else if(button.matches('[data-scene-pause]')){const paused=host.pause();button.textContent=paused?'继续场景':'暂停场景';button.setAttribute('aria-pressed',String(paused));}
  else if(button.matches('[data-model-reset]')){host.resetModel();const select=document.querySelector('[data-pose]');if(select)select.value='sit';}
  else if(button.matches('[data-scene-retry]')){if(currentView.scene)host.mount(document.querySelector('[data-scene-host]'),currentView.scene);}
  else if(button.matches('[data-snapshot]')){try{const a=document.createElement('a');a.href=host.snapshot();a.download=`meow-${route.id}.png`;a.click();toast('已导出当前渲染画面。');}catch(error){toast(error.message);}}
  else if(button.matches('[data-preview-toggle]')){staticPreview=!staticPreview;const container=document.querySelector('[data-scene-host]');container.classList.toggle('preview-only',staticPreview);const image=container.querySelector('.scene-fallback');if(image){image.hidden=false;image.src=href(`assets/previews/gallery-${route.id}.png`);}button.textContent=staticPreview?'回到实时 3D':'查看原始静态预览';document.querySelector('[data-viewer-mode]').textContent=staticPreview?'原始静态预览':host.container?.dataset.mode==='live'?'REAL-TIME 3D':'静态角色预览（3D 未加载）';}
  else if(button.matches('[data-motion-toggle]'))report(store.update(d=>{d.settings.paused=!d.settings.paused;}));
  else if(button.matches('[data-share]')){try{await navigator.clipboard.writeText(location.href);toast('稳定网址已复制。');}catch{toast(`当前网址：${location.href}`);}}
  else if(button.matches('[data-cart-remove]')){report(store.update(d=>d.cart=d.cart.filter(row=>row.sku!==button.dataset.cartRemove)));render({restore:true});}
  else if(button.matches('[data-cart-clear]'))document.querySelector('[data-cart-confirm]').hidden=false;
  else if(button.matches('[data-cart-cancel-clear]'))document.querySelector('[data-cart-confirm]').hidden=true;
  else if(button.matches('[data-cart-confirm-clear]')){report(store.update(d=>d.cart=[]));render({restore:true});}
  else if(button.matches('[data-cart-export]'))download(['MEOW · 本地购物清单','演示商品，不产生真实订单或付款','',...store.data.cart.map(row=>`${findProduct(row.productId).title} / ${row.option} × ${row.qty}`),'',`总件数：${store.count}`,`导出日期：${new Date().toISOString().slice(0,10)}`].join('\n'),'meow-shopping-list.txt','text/plain;charset=utf-8');
  else if(button.matches('[data-contact-export]')){const form=button.closest('form');download(`${form.elements.name.value.trim()}\n\n${form.elements.message.value.trim()}\n\nMeow 本地消息草稿（未发送）`,'meow-message-draft.txt','text/plain;charset=utf-8');}
  else if(button.matches('[data-contact-delete]')){store.update(d=>d.draft={name:'',message:''});render({restore:true});}
  else if(button.matches('[data-subscribe-delete]')){store.update(d=>d.subscribe=null);render({restore:true});}
  else if(button.matches('[data-data-export]'))download(store.export(),'meow-local-data.json');
  else if(button.matches('[data-data-reset]')){const dialog=document.querySelector('dialog');dialog._trigger=button;dialog.showModal();}
  else if(button.matches('[data-confirm-reset]')){report(store.restore());document.querySelector('dialog').close();render({restore:true});}
  else if(button.matches('[data-cancel-reset]'))document.querySelector('dialog').close();
  else if(button.matches('[data-companion-download]')){try{await downloadCompanion();}catch(error){toast(`无法生成图片：${error.message}`);}}
  else if(button.matches('[data-message-remove]')){store.update(d=>d.messages=d.messages.filter(m=>m.id!==button.dataset.messageRemove));render({restore:true});}
});
root.addEventListener('change',async event=>{const el=event.target;
  if(el.matches('[data-filter]'))filterSubmit(el.closest('form'));
  else if(el.matches('[data-pose]'))host.setPose(el.value);
  else if(el.matches('[data-accessory]'))host.setAccessory(el.value);
  else if(el.matches('[data-environment]'))host.addEnvironment(el.value);
  else if(el.matches('[data-product-option]'))host.setProductOption(el.value);
  else if(el.matches('[data-reduce-motion]'))report(store.update(d=>d.settings.reduced=el.checked));
  else if(el.matches('[data-avatar]')){const picture=document.querySelector('.profile-card img');picture.src=href(`assets/previews/${el.value}.png`);picture.alt=`头像 ${el.value}`;}
  else if(el.matches('[data-companion-select]')){const c=findCat(el.value);const image=document.querySelector('.companion-card img');image.src=href(`assets/previews/${c.id}.png`);image.alt=c.name;document.querySelector('.companion-card h2').textContent=`${c.name} & You`;}
  else if(el.matches('[data-cart-qty]')){const qty=Number(el.value);if(!Number.isInteger(qty)||qty<1||qty>99){el.setCustomValidity('请输入 1–99 的整数');el.reportValidity();return;}el.setCustomValidity('');report(store.update(d=>{const row=d.cart.find(x=>x.sku===el.dataset.cartQty);if(row)row.qty=qty;}));render({restore:true});}
  else if(el.matches('[data-data-import]')){const file=el.files?.[0];if(!file)return;const output=document.querySelector('.data-feedback');try{if(file.size>150000)throw Error('文件超过 150 KB。');const result=store.import(await file.text());if(result.ok){render({restore:true});toast('已导入并校验本地配置。');}else output.textContent=result.message;}catch(error){output.textContent=`导入未完成：${error.message}`;}el.value='';}
});
function filterSubmit(form){const params=new URLSearchParams();for(const[key,value]of new FormData(form))if(String(value).trim())params.set(key,String(value).trim());const page=form.dataset.form==='cat-filter'?'cats/':'gallery/';navigate(href(page)+(params.size?'?'+params.toString():''));}
root.addEventListener('submit',event=>{const form=event.target;event.preventDefault();const type=form.dataset.form;const fields=new FormData(form);form.dataset.state='saving';if(!type){const url=new URL(form.action||href('search/'),location.href);url.search=new URLSearchParams(fields).toString();navigate(url.href);return;}
  if(type==='cat-filter'||type==='gallery-filter')return filterSubmit(form);
  let result;
  if(type==='profile'){const name=String(fields.get('name')).trim();if(!name)return report({ok:false,message:'请输入昵称。'},form);result=store.update(d=>d.profile={name,avatar:fields.get('avatar'),preference:fields.get('preference')});if(result.ok)document.querySelector('.profile-card h2').textContent=name;}
  else if(type==='contact'){const message=String(fields.get('message')).trim();if(!message)return report({ok:false,message:'请先写一点消息。'},form);result=store.update(d=>d.draft={name:String(fields.get('name')).trim(),message});}
  else if(type==='subscribe'){const email=String(fields.get('email')).trim();result=store.update(d=>d.subscribe={email,date:new Date().toISOString()});if(result.ok){result.message='订阅意向已保存在当前浏览器，没有发送邮件。';navigate(href('subscribe/'));toast(result.message);return;}}
  else if(type==='message'){const message=String(fields.get('message')).trim();if(!message)return report({ok:false,message:'请先写一点留言。'},form);result=store.update(d=>d.messages.unshift({id:globalThis.crypto?.randomUUID?.()||String(Date.now()),message,date:new Date().toISOString()}));if(result.ok){render({restore:true});toast('已保存本地留言，仅当前浏览器可见。');return;}}
  else if(type==='adopt'){result=store.update(d=>d.companion={catId:fields.get('catId'),name:String(fields.get('name')).trim()||'You',date:localDate()});if(result.ok){render({restore:true});toast('本地数字纪念卡已生成。');return;}}
  else if(type==='add-product'){result=store.add(form.dataset.product,fields.get('option'),Number(fields.get('qty')));if(result.ok)result.message='已加入本地购物清单。';}
  if(result)report(result,form);
});
root.addEventListener('invalid',event=>{const form=event.target.closest('form');if(!form)return;form.dataset.state='error';const output=form.querySelector('.form-feedback');if(output)output.textContent='请检查必填内容、邮箱格式或数量范围。';},true);
function localDate(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
async function downloadCompanion(){const record=store.data.companion;if(!record)return;const c=findCat(record.catId),canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1200;const ctx=canvas.getContext('2d');ctx.fillStyle='#ffe4ef';ctx.fillRect(0,0,1000,1200);ctx.fillStyle='#fff8fb';ctx.beginPath();ctx.roundRect(45,45,910,1110,45);ctx.fill();const image=new Image();image.src=href(`assets/previews/${c.id}.png`);await image.decode();ctx.drawImage(image,170,70,660,660);ctx.textAlign='center';ctx.fillStyle='#8c2853';ctx.font='bold 26px sans-serif';ctx.fillText('MEOW · COMPANION CARD',500,780);ctx.font='bold 48px sans-serif';ctx.fillText(`${c.name} & ${record.name}`,500,875,850);ctx.font='28px sans-serif';ctx.fillText(record.date.slice(0,10),500,945);ctx.font='24px sans-serif';ctx.fillText('A softer world, together.',500,1020);ctx.font='18px sans-serif';ctx.fillText('Fictional digital companion · Saved in this browser',500,1090);const a=document.createElement('a');a.download=`meow-${c.id}-companion.png`;a.href=canvas.toDataURL();a.click();}
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=document.querySelector('#mobile-nav');if(menu&&!menu.hidden){menu.hidden=true;document.querySelector('[data-toggle-menu]').setAttribute('aria-expanded','false');document.querySelector('[data-toggle-menu]').focus();}if(observing&&innerWidth<768){observing=false;host.setObserving(false);const btn=document.querySelector('[data-observe]');if(btn)btn.textContent='开始观察';}}});
window.addEventListener('popstate',()=>{scrollMemory.set(currentURL,scrollY);render({restore:true});});
window.addEventListener('pagehide',event=>{rememberScroll();if(!event.persisted)host.destroy();});window.addEventListener('pageshow',event=>{if(event.persisted)render({restore:true});});
window.meow={ready:false,store,motion,host,navigate,diagnostics:()=>host.diagnostics()};render();
