import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {readFile} from 'node:fs/promises';
import {rows,tables} from '../web/i18n-copy.js';
import {traditional} from '../web/i18n-traditional.js';

test('terminal strings have all five locale variants and are packaged by the Rust server',async()=>{
 for(const [source] of rows){for(const lang of ['en','ja','ko'])assert.ok(tables[lang][source],`${lang}: ${source}`);assert.ok(traditional[source],`zh-TW: ${source}`);}
 const rust=await readFile(new URL('../src/web.rs',import.meta.url),'utf8');
 for(const name of ['i18n.js','i18n-copy.js','i18n-traditional.js'])assert.ok(rust.includes(`/terminal/${name}`));
 for(const name of ['index.html','session.html']){const page=await readFile(new URL('../web/'+name,import.meta.url),'utf8');assert.match(page,/data-terminal-locale/);assert.match(page,/type="module" src="\/terminal\/i18n.js"/);}
});

test('terminal UI switches live and keeps commands, output, names and passwords untouched',async()=>{
 const {window,document}=parseHTML(`<html lang="zh-CN"><head><title>STRGO · 我的终端</title></head><body>
 <select data-terminal-locale><option value="zh-CN">简</option><option value="zh-TW">繁</option><option value="en">EN</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
 <button id="connect">连接</button><p id="status">待连接</p><input id="password" value="连接" placeholder="输入密码"><textarea id="editor">连接</textarea>
 <div id="terminal"><span>连接</span></div><div id="chat-log"><div class="chat-welcome">服务器，也可以聊着用。</div><div class="server-message">连接</div></div><div id="conversation-list"><strong>连接</strong></div><strong id="account-label">连接</strong></body></html>`);
 const proto=Object.getPrototypeOf(document.querySelector('select'));
 Object.defineProperty(proto,'value',{configurable:true,get(){return [...this.options].find(o=>o.hasAttribute('selected'))?.value??this.options[0]?.value;},set(value){for(const option of this.options)option.toggleAttribute('selected',option.value===value);}});
 const store=new Map([['strgo:locale:v1','zh-CN']]);
 Object.assign(globalThis,{window,document,MutationObserver:window.MutationObserver,CustomEvent:window.CustomEvent,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))}});
 const module=await import('../web/i18n.js');
 const picker=document.querySelector('select');
 for(const [locale,label] of [['en','Connect'],['ja','接続'],['ko','연결'],['zh-TW','連接'],['zh-CN','连接']]){
  picker.value=locale;picker.dispatchEvent(new window.Event('change'));
  assert.equal(store.get('strgo:locale:v1'),locale);assert.equal(document.querySelector('#connect').textContent,label);
  assert.equal(document.querySelector('#password').value,'连接');assert.equal(document.querySelector('#editor').value,'连接');
  assert.equal(document.querySelector('#terminal span').textContent,'连接');assert.equal(document.querySelector('.server-message').textContent,'连接');
  assert.equal(document.querySelector('#conversation-list strong').textContent,'连接');assert.equal(document.querySelector('#account-label').textContent,'连接');
 }
 window.dispatchEvent(new window.CustomEvent('strgo:localechange',{detail:{locale:'ja'}}));
 assert.equal(document.documentElement.lang,'ja');assert.equal(document.title,'STRGO · マイターミナル');
 document.querySelector('#status').textContent='连接失败';await new Promise(resolve=>setImmediate(resolve));
 assert.equal(document.querySelector('#status').textContent,'接続に失敗');
 assert.match(module.text('3 / 8 个窗口','ko'),/3 \/ 8개 창/);
});
