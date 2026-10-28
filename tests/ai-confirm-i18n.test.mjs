import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {escapeHTML as esc,costLabel} from '../src/ai-workspace/client.js';
import {localizeTree,setLocale} from '../src/shared/i18n.js';

test('real music confirmation preserves the work title and quoted price in five languages',async()=>{
 const source=await readFile(new URL('../src/ai-workspace/app.js',import.meta.url),'utf8');
 const start=source.indexOf('async function generateMusic() {'),end=source.indexOf('\nasync function submitMusic()',start);assert.ok(start>=0&&end>start);
 const {document}=parseHTML('<html data-strgo-ui="tool"><body><main id="main"><form id="music-form"><button id="generate-music"></button><p id="music-error"></p></form></main><dialog id="dialog"><div id="dialog-content"></div></dialog></body></html>');
 const musicForm=document.querySelector('#music-form');Object.defineProperty(musicForm,'elements',{value:{model_id:{value:'model-1'},local_only:{checked:false}}});
 const saved={id:'form-1',revision:3,fields:{title:'生成时长'}},state={session:{user:{id:'user'}},pendingMusic:null};
 const quote={id:'quote-1',units:60,locality:'cloud',currency:'CNY',max_cost_micro:1234560};
 const context={document,window:{},state,esc,costLabel,$:selector=>document.querySelector(selector),saveMusicForm:async()=>saved,client:{quote:async()=>quote},modal:html=>{const area=document.querySelector('#dialog-content');area.innerHTML=html;return area;},authDialog(){},submitMusic(){},uuid7(){return 'request';},toast(){}};
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.run=generateMusic;',context);await context.run();
 const oldDocument=globalThis.document,oldLocation=globalThis.location;globalThis.document=document;globalThis.location={pathname:'/ai/music/'};
 try{
  for(const locale of ['zh-CN','zh-TW','en','ja','ko']){setLocale(locale,{persist:false});localizeTree(document.body);assert.equal(document.querySelector('[data-strgo-user-content]').textContent,'生成时长');assert.match(document.querySelector('.quote-summary').textContent,/CNY 1\.2346/);assert.equal(typeof document.querySelector('#confirm-music').onclick,'function');}
  setLocale('en',{persist:false});localizeTree(document.body);assert.match(document.querySelector('#dialog-content').textContent,/Cost cap CNY 1\.2346/);assert.match(document.querySelector('#dialog-content').textContent,/After confirmation/);
 }finally{setLocale('zh-CN',{persist:false});globalThis.document=oldDocument;globalThis.location=oldLocation;}
});
