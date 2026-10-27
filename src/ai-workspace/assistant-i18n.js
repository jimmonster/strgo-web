import {tables} from './assistant-locales.js';
import {traditional} from './assistant-traditional.js';
const supported=['zh-CN','zh-TW','en','ja','ko'];
const dictionaries={...tables,'zh-TW':traditional};
export function initialAssistantLocale() {
  try { const value=localStorage.getItem('strgo:locale:v1'); if(supported.includes(value)) return value; } catch {}
  const language=globalThis.navigator?.language || 'zh-CN';
  if(/^zh-(?:Hant|TW|HK|MO)(?:-|$)/i.test(language)) return 'zh-TW';
  if(/^zh(?:-|$)/i.test(language)) return 'zh-CN';
  if(/^ja(?:-|$)/i.test(language)) return 'ja';
  if(/^ko(?:-|$)/i.test(language)) return 'ko';
  return 'en';
}
export function assistantText(source,locale) {
  if(locale==='zh-CN' || typeof source!=='string') return source;
  const match=source.match(/^(\s*)([\s\S]*?)(\s*)$/),key=match[2];
  let value=(dictionaries[locale]||tables.en)[key];
  if(value===undefined){const m=key.match(/^今日剩余 (\d+) 次$/);if(m)value={en:`${m[1]} chats left today`,'zh-TW':`今日剩餘 ${m[1]} 次`,ja:`本日の残り ${m[1]} 回`,ko:`오늘 남은 횟수 ${m[1]}회`}[locale];}
  return value===undefined ? source : match[1]+value+match[3];
}

// Localize only fixed UI text. Model names, drafts, messages and input values are protected.
const excluded='script,style,pre,.message-content,.notice,option:not([value=""]),[data-user-content],[contenteditable]:not([contenteditable="false"])';
export function localizeAssistant(root,locale,records) {
  function update(node,attribute){
    const element=attribute?node:node.parentElement;
    if(!element || element.closest(excluded))return;
    const value=attribute?node.getAttribute(attribute):node.nodeValue;if(value==null)return;
    let all=records.get(node);if(!all){all={};records.set(node,all);}
    const key=attribute||'#text';let entry=all[key];
    if(!entry||(value!==entry.source&&value!==entry.rendered))entry={source:value,rendered:value};
    const next=assistantText(entry.source,locale);entry.rendered=next;all[key]=entry;
    if(next!==value){if(attribute)node.setAttribute(attribute,next);else node.nodeValue=next;}
  }
  function walk(node){
    if(node.nodeType===3){update(node);return;}
    if(![1,9,11].includes(node.nodeType))return;
    if(node.nodeType===1){if(node.matches(excluded))return;for(const name of ['aria-label','title','placeholder'])if(node.hasAttribute(name))update(node,name);if(node.matches('input,textarea'))return;}
    for(const child of node.childNodes)walk(child);
  }
  walk(root);
}
