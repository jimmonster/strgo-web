import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {dynamicRows,dynamicCopy} from '../src/shared/dynamic-copy.js';
import {dynamicTraditional} from '../src/shared/dynamic-traditional.js';
import {setLocale,localizeTree} from '../src/shared/i18n.js';

test('fixed dynamic messages have translations in all five languages',()=>{
 for(const [source,en,ja,ko] of dynamicRows){assert.ok(en&&ja&&ko,source);assert.ok(dynamicTraditional[source],source);for(const locale of ['en','ja','ko'])assert.ok(dynamicCopy[locale][source]);}
});
test('AI account settings translate labels without changing account or model names',()=>{
 const {document}=parseHTML('<html data-strgo-ui="tool"><body><main id="main"><div class="settings-grid"><h2 data-strgo-user-content>已授权</h2><div class="permission-row"><span data-strgo-user-content>本地</span><span class="status">已授权</span></div><p>已使用 7 · 任务预占 2</p></div></main></body></html>');
 const oldDocument=globalThis.document,oldLocation=globalThis.location;globalThis.document=document;globalThis.location={pathname:'/ai/settings/'};
 try{setLocale('en',{persist:false});localizeTree(document.body);assert.equal(document.querySelector('h2').textContent,'已授权');assert.equal(document.querySelector('.permission-row span').textContent,'本地');assert.equal(document.querySelector('.status').textContent,'Authorized');assert.equal(document.querySelector('p').textContent,'Used 7 · Reserved 2');}
 finally{setLocale('zh-CN',{persist:false});globalThis.document=oldDocument;globalThis.location=oldLocation;}
});

test('dynamic statuses translate in forum, image and music UI while user content stays intact',()=>{
 const oldDocument=globalThis.document,oldLocation=globalThis.location;
 try{
  for(const [path,markup,selector,expected] of [
   ['/forum/','<section id="workspace"><p id="feed-message">正在读取最新帖子…</p><div id="posts"><p>正在读取最新帖子…</p><span data-strgo-ui-copy>置顶</span><p data-strgo-user-content><span data-strgo-ui-copy>置顶</span></p><button data-strgo-ui-copy>3 条评论 · 阅读话题</button></div></section><dialog><p id="delete-description" data-strgo-static>评论将从话题和回复通知中移除。</p></dialog><div id="toast" data-strgo-static>评论已发布</div>','#feed-message','Loading recent posts…'],
   ['/image-playground/','<section id="workspace"><p id="backup-message">加密备份成功。</p><textarea id="prompt">加密备份成功。</textarea></section>','#backup-message','Encrypted backup completed.'],
   ['/ai/music/','<main id="main"><section class="music-composer"><div class="panel-title"><span id="save-state">正在保存…</span></div><form id="music-form"><input value="正在保存…" placeholder="中文流行, 温暖, 钢琴（用逗号分隔）"></form></section></main>','#save-state','Saving…'],
  ]){
   const {document}=parseHTML(`<html data-strgo-ui="tool"><body>${markup}</body></html>`);globalThis.document=document;globalThis.location={pathname:path};setLocale('en',{persist:false});localizeTree(document.body);
   assert.equal(document.querySelector(selector).textContent,expected);
   if(path==='/forum/'){assert.equal(document.querySelector('#posts p').textContent,'正在读取最新帖子…');assert.equal(document.querySelector('#posts > span').textContent,'Pinned');assert.equal(document.querySelector('#posts [data-strgo-user-content]').textContent,'置顶');assert.equal(document.querySelector('#posts button').textContent,'3 comments · Read topic');assert.match(document.querySelector('#delete-description').textContent,/removed/);assert.equal(document.querySelector('#toast').textContent,'Comment posted');document.querySelector('#toast').removeAttribute('data-strgo-static');document.querySelector('#toast').textContent='评论已发布';document.querySelector('#delete-description').removeAttribute('data-strgo-static');document.querySelector('#delete-description').textContent='正在读取最新帖子…';localizeTree(document.body);assert.equal(document.querySelector('#delete-description').textContent,'正在读取最新帖子…');assert.equal(document.querySelector('#toast').textContent,'评论已发布');}
   if(path==='/image-playground/')assert.equal(document.querySelector('textarea').value,'加密备份成功。');
   if(path==='/ai/music/')assert.equal(document.querySelector('input').value,'正在保存…');
  }
 }finally{setLocale('zh-CN',{persist:false});globalThis.document=oldDocument;globalThis.location=oldLocation;}
});
