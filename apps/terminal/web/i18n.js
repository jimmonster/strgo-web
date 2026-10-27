import {tables} from './i18n-copy.js';
import {traditional} from './i18n-traditional.js';
const key='strgo:locale:v1', supported=['zh-CN','zh-TW','en','ja','ko'];
const dictionaries={...tables,'zh-TW':traditional};
const records=new WeakMap();
let locale;
function detect(value) {
  if(supported.includes(value))return value;
  const language=navigator.language||'zh-CN';
  if(/^zh-(?:Hant|TW|HK|MO)(?:-|$)/i.test(language))return 'zh-TW';
  if(/^zh(?:-|$)/i.test(language))return 'zh-CN';
  if(/^ja(?:-|$)/i.test(language))return 'ja';
  if(/^ko(?:-|$)/i.test(language))return 'ko';
  return 'en';
}
function read(){try{return detect(localStorage.getItem(key));}catch{return detect();}}
export function text(source,language=locale) {
  if(language==='zh-CN'||typeof source!=='string')return source;
  const parts=source.match(/^(\s*)([\s\S]*?)(\s*)$/),raw=parts[2];
  let value=(dictionaries[language]||tables.en)[raw];
  if(value===undefined){const match=raw.match(/^(\d+) \/ (\d+) 个窗口$/);if(match)value={en:`${match[1]} / ${match[2]} windows`,'zh-TW':`${match[1]} / ${match[2]} 個視窗`,ja:`${match[1]} / ${match[2]} ウィンドウ`,ko:`${match[1]} / ${match[2]}개 창`}[language];}
  return value===undefined?source:parts[1]+value+parts[3];
}
// Protect the terminal emulator, server replies, account names and user-created session names.
const excluded='script,style,pre,code,#terminal,.xterm,#conversation-list,#account-label,#account-avatar,#conversation-name,#target-label,#session-frames,[data-user-content],[contenteditable]:not([contenteditable="false"]),option:not([value])';
function safe(element){return element&&!element.closest(excluded)&&(!element.closest('#chat-log')||!!element.closest('.chat-welcome,.chat-avatar,.message-label,.message-actions'));}
function update(node,attribute){
  const element=attribute?node:node.parentElement;if(!safe(element))return;
  const value=attribute?node.getAttribute(attribute):node.nodeValue;if(value==null)return;
  let all=records.get(node);if(!all){all={};records.set(node,all);}const name=attribute||'#text';let entry=all[name];
  if(!entry||(value!==entry.source&&value!==entry.rendered))entry={source:value,rendered:value};
  const translated=text(entry.source);entry.rendered=translated;all[name]=entry;
  if(value!==translated){if(attribute)node.setAttribute(attribute,translated);else node.nodeValue=translated;}
}
export function localizeTree(node){
  if(!node)return;if(node.nodeType===3){update(node);return;}if(![1,9,11].includes(node.nodeType))return;
  if(node.nodeType===1){if(node.matches(excluded))return;for(const attribute of ['aria-label','placeholder','title'])if(node.hasAttribute(attribute))update(node,attribute);if(node.matches('input,textarea,select'))return;}
  for(const child of node.childNodes)localizeTree(child);
}
function render(){
  document.documentElement.lang=locale;
  document.querySelectorAll('[data-terminal-locale]').forEach(select=>{select.value=locale;});
  localizeTree(document.body);localizeTree(document.querySelector('title'));
}
export function setLocale(value,{persist=true,notify=true}={}){
  if(!supported.includes(value))return false;locale=value;
  if(persist){try{localStorage.setItem(key,value);}catch{}}
  render();if(notify)window.dispatchEvent(new CustomEvent('strgo:localechange',{detail:{locale:value}}));return true;
}
locale=read();
function start(){
  document.querySelectorAll('[data-terminal-locale]').forEach(select=>select.addEventListener('change',()=>setLocale(select.value)));
  render();
  const observer=new MutationObserver(mutations=>{for(const m of mutations){if(m.type==='characterData')localizeTree(m.target);else if(m.type==='attributes')update(m.target,m.attributeName);else for(const n of m.addedNodes)localizeTree(n);}});
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','title','placeholder']});
  const title=document.querySelector('title');if(title)observer.observe(title,{subtree:true,childList:true,characterData:true});
  window.addEventListener('storage',event=>{if(event.key===key)setLocale(detect(event.newValue),{persist:false,notify:false});});
  window.addEventListener('strgo:localechange',event=>{if(supported.includes(event.detail?.locale)&&event.detail.locale!==locale)setLocale(event.detail.locale,{persist:false,notify:false});});
}
window.terminalI18n={text,getLocale:()=>locale,setLocale};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
