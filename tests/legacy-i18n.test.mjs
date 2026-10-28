import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {legacyRows,legacyCopy} from '../src/shared/legacy-copy.js';
import {legacyTraditional} from '../src/shared/legacy-traditional.js';
import {setLocale,localizeTree,translate} from '../src/shared/i18n.js';

test('archive and portfolio fixed copy covers the five languages',()=>{
  for(const [source,en,ja,ko] of legacyRows){assert.ok(en&&ja&&ko&&legacyTraditional[source],source);for(const locale of ['en','ja','ko'])assert.ok(legacyCopy[locale][source],source);}
});

test('archive switches static copy, controls and dynamic statuses without changing identifiers',async()=>{
 const html=await readFile(new URL('../legacy/archive/index.html',import.meta.url),'utf8');const {document}=parseHTML(html);document.documentElement.setAttribute('data-strgo-ui','experience');
 const oldDocument=globalThis.document,oldLocation=globalThis.location;globalThis.document=document;globalThis.location={pathname:'/archive/'};
 try{
  const stages=[['zh-CN','银河舰队'],['zh-TW','銀河艦隊'],['en','Galactic fleet'],['ja','銀河艦隊'],['ko','은하 함대']];
  for(const [locale,label] of stages){setLocale(locale,{persist:false});localizeTree(document.body);localizeTree(document.querySelector('title'));assert.equal(document.querySelector('.navigation a').textContent,label);assert.equal(document.querySelector('.model-button').getAttribute('data-model'),'all');}
  setLocale('en',{persist:false});localizeTree(document.body);assert.match(document.querySelector('#hero-title').textContent,/The whole galaxy/);assert.match(document.querySelector('#scene-stage').getAttribute('aria-label'),/3D galactic fleet/);
  assert.equal(translate('星际巡航飞船 / 已锁定'),'Interstellar cruiser / Locked');assert.equal(translate('已锁定星际巡航飞船 UNIT-01。'),'Locked Interstellar cruiser UNIT-01.');assert.equal(translate('可以手动复制：https://example.test/?q=猫'),'Copy manually: https://example.test/?q=猫');
 }finally{setLocale('zh-CN',{persist:false});globalThis.document=oldDocument;globalThis.location=oldLocation;}
});

test('project and terminal copy translate while keeping user-authored text and form values',()=>{
 const {document}=parseHTML('<html data-strgo-ui="classic"><body><main><h1>项目类型</h1><p>从主站首屏出发，观察光与粒子的动态变化，浏览空间入口、作品与交互实验。首页可暂停动态效果，也会遵循系统的减少动态效果设置。</p><p data-strgo-user-content>项目类型</p><input value="项目类型"></main></body></html>');
 const oldDocument=globalThis.document,oldLocation=globalThis.location;globalThis.document=document;globalThis.location={pathname:'/projects/digital-universe/'};
 try{setLocale('en',{persist:false});localizeTree(document.body);assert.equal(document.querySelector('h1').textContent,'Project type');assert.match(document.querySelector('main > p').textContent,/light and particles/);assert.equal(document.querySelector('[data-strgo-user-content]').textContent,'项目类型');assert.equal(document.querySelector('input').value,'项目类型');assert.equal(translate('联系 Alice ↗'),'Contact Alice ↗');globalThis.location={pathname:'/terminal/'};assert.equal(translate('终端目标配置无效'),'Invalid terminal destination');}
 finally{setLocale('zh-CN',{persist:false});globalThis.document=oldDocument;globalThis.location=oldLocation;}
});
