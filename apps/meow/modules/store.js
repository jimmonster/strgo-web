import {cats,galleries,products,types} from './catalog.js';
const KEY='meow.world';
const allowed=new Set([...cats.map(c=>`cat:${c.id}`),...galleries.map(g=>`gallery:${g.id}`),...products.map(p=>`product:${p.id}`),...['water','play','environment','rest'].map(id=>`care:${id}`)]);
const trim=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function defaults(){return {schemaVersion:1,favorites:[],cart:[],profile:{name:'',avatar:'milk',preference:''},companion:null,settings:{paused:false,reduced:false},subscribe:null,draft:{name:'',message:''},messages:[]};}
export function validate(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.schemaVersion!==1)throw Error('不支持的数据版本，原始记录可导出备份。');
  const d=defaults();
  if(raw.favorites&&!Array.isArray(raw.favorites)||raw.cart&&!Array.isArray(raw.cart)||raw.messages&&!Array.isArray(raw.messages))throw Error('记录格式不正确。');
  if((raw.favorites?.length||0)>100||(raw.cart?.length||0)>150||(raw.messages?.length||0)>50)throw Error('导入记录超过允许数量。');
  d.favorites=[...new Set((raw.favorites||[]).filter(k=>allowed.has(k)))];
  for(const item of raw.cart||[]){const p=products.find(p=>p.id===item.productId);if(!p||!p.options.includes(item.option)||!Number.isInteger(item.qty)||item.qty<1||item.qty>99)throw Error('商品、规格或数量无效。');const sku=`${p.id}:${item.option}`;const existing=d.cart.find(x=>x.sku===sku);if(existing)existing.qty=Math.min(99,existing.qty+item.qty);else d.cart.push({sku,productId:p.id,option:item.option,qty:item.qty});}
  if(raw.profile)d.profile={name:trim(raw.profile.name,24),avatar:cats.some(c=>c.id===raw.profile.avatar)?raw.profile.avatar:'milk',preference:types.some(t=>t.id===raw.profile.preference)?raw.profile.preference:''};
  if(raw.companion&&cats.some(c=>c.id===raw.companion.catId)&&!Number.isNaN(Date.parse(raw.companion.date)))d.companion={catId:raw.companion.catId,date:trim(raw.companion.date,40),name:trim(raw.companion.name,24)};
  if(raw.settings)d.settings={paused:raw.settings.paused===true,reduced:raw.settings.reduced===true};
  if(raw.subscribe){const value=trim(raw.subscribe.email,254);if(!email.test(value))throw Error('订阅邮箱格式不正确。');d.subscribe={email:value,date:trim(raw.subscribe.date,40)};}
  d.draft={name:trim(raw.draft?.name,40),message:trim(raw.draft?.message,1000)};
  d.messages=(raw.messages||[]).map((m,i)=>({id:trim(m.id,60)||`message-${i}`,message:trim(m.message,280),date:trim(m.date,40)})).filter(m=>m.message);
  return d;
}
export class Store{
  constructor(storage){this.storage=storage;this.listeners=new Set();this.error='';this.raw=null;this.blocked=false;this.data=defaults();try{this.raw=storage.getItem(KEY);}catch{this.error='浏览器禁用了本地存储，更改只在当前页面会话中保留。';return;}try{if(this.raw)this.data=validate(JSON.parse(this.raw));else this.migrate();}catch(e){this.error=e instanceof SyntaxError?'本地记录损坏，已保留原始数据。可先导出，再恢复默认。':e.message;this.blocked=true;}}
  migrate(){const favorites=JSON.parse(this.storage.getItem('meow-favorites')||'[]');const cart=JSON.parse(this.storage.getItem('meow-cart')||'[]');if(Array.isArray(favorites)&&Array.isArray(cart)){this.data=validate({...defaults(),favorites,cart});}}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  notify(){this.listeners.forEach(fn=>fn(this.data));}
  update(change){if(this.blocked)return {ok:false,message:this.error};let next;try{next=structuredClone(this.data);change(next);next=validate(next);}catch(e){return {ok:false,message:e.message};}this.data=next;try{this.storage.setItem(KEY,JSON.stringify(next));this.error='';this.notify();return {ok:true,message:'已保存到当前浏览器。'};}catch(e){this.error='本地存储不可用或空间不足。更改仅在当前页面会话中保留，请下载备份。';this.notify();return {ok:false,message:this.error};}}
  favorite(type,id){return this.update(d=>{const key=`${type}:${id}`;if(!allowed.has(key))throw Error('无效收藏');d.favorites=d.favorites.includes(key)?d.favorites.filter(k=>k!==key):[...d.favorites,key];});}
  has(type,id){return this.data.favorites.includes(`${type}:${id}`);}
  add(productId,option,qty){if(!Number.isInteger(qty)||qty<1||qty>99)return {ok:false,message:'数量必须是 1–99 的整数。'};return this.update(d=>{const sku=`${productId}:${option}`;const row=d.cart.find(c=>c.sku===sku);if(row)row.qty=Math.min(99,row.qty+qty);else d.cart.push({sku,productId,option,qty});});}
  get count(){return this.data.cart.reduce((n,c)=>n+c.qty,0);}
  restore(){this.blocked=false;this.error='';this.data=defaults();return this.update(()=>{});}
  import(text){if(text.length>150000)throw Error('文件超过 150 KB。');const data=validate(JSON.parse(text));this.blocked=false;return this.update(d=>Object.assign(d,data));}
  export(){return this.blocked&&this.raw?this.raw:JSON.stringify(this.data,null,2);}
  sync(){try{const raw=this.storage.getItem(KEY);this.data=raw?validate(JSON.parse(raw)):defaults();this.notify();}catch(e){this.error='另一个页面写入了无法读取的记录。';this.notify();}}
}
export function download(text,name,type='application/json'){const blob=new Blob([text],{type});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
