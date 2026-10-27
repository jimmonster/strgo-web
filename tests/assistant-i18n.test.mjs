import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {rows,tables} from '../src/ai-workspace/assistant-locales.js';
import {traditional} from '../src/ai-workspace/assistant-traditional.js';

test('assistant dictionaries cover every fixed UI string',()=>{
 for(const locale of ['en','ja','ko'])for(const [source] of rows)assert.ok(tables[locale][source],`${locale}: ${source}`);
 for(const [source] of rows)assert.ok(traditional[source],`zh-TW: ${source}`);
});

test('assistant switches five languages without altering drafts, replies or model identity',async()=>{
 const {window,document}=parseHTML('<html><body></body></html>');
 const store=new Map([['strgo:locale:v1','en']]);
 Object.assign(globalThis,{window,document,HTMLElement:window.HTMLElement,customElements:window.customElements,MutationObserver:window.MutationObserver,CustomEvent:window.CustomEvent,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}});
 const {StrgoAssistant}=await import('../src/ai-workspace/assistant.js');
 const assistant=document.createElement('strgo-assistant');document.body.append(assistant);
 assistant.context={scope:'music',conversationId:'c'};
 assistant.models=[{id:'model',name:'复制',available:true}];assistant.modelId='model';assistant.render();
 const input=assistant.shadowRoot.querySelector('textarea');input.value='用户输入：复制';
 assistant.messages=[{role:'user',content:'复制',state:'SUCCEEDED'}];assistant.renderMessages();
 for(const [locale,expected] of [['ja','歌詞を書く'],['ko','가사 쓰기'],['zh-TW','寫歌詞'],['en','Write lyrics'],['zh-CN','写歌词']]){
  window.dispatchEvent(new window.CustomEvent('strgo:localechange',{detail:{locale}}));
  assert.match(assistant.shadowRoot.querySelector('[data-quick="0"]').textContent,new RegExp(expected));
  assert.equal(input.value,'用户输入：复制');
  assert.equal(assistant.shadowRoot.querySelector('.message-content').textContent,'复制');
  assert.match(assistant.shadowRoot.querySelector('.model option').textContent,/复制/);
 }
 window.dispatchEvent(new window.CustomEvent('strgo:localechange',{detail:{locale:'en'}}));
 let submitted;
 assistant.client={session:{user:{id:'member'}},quote:async()=>({locality:'local'}),submit:async(_,body)=>{submitted=body;return{id:'run'};}};
 assistant.follow=async()=>{};
 assistant.shadowRoot.querySelector('[data-quick="2"]').click();
 assert.match(input.value,/Explain/);
 await assistant.send();assert.equal(submitted.mode,'chat');assert.match(submitted.content,/Explain/);
 assistant.remove();
});
