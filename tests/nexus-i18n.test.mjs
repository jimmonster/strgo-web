import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { nexusRows, nexusCopy } from '../src/shared/nexus-copy.js';
import { nexusTraditional } from '../src/shared/nexus-traditional.js';
import { localizeTree, setLocale, translate } from '../src/shared/i18n.js';

test('NEXUS fixed copy is supplied for every locale', () => {
  for (const [source, ...translations] of nexusRows) {
    assert.ok(translations.every(Boolean), source);
    assert.ok(Object.hasOwn(nexusTraditional, source), source);
    for (const locale of ['en', 'ja', 'ko']) assert.ok(nexusCopy[locale][source], `${locale}: ${source}`);
  }
});

test('NEXUS panel, descriptions, statuses and accessibility labels switch without touching inputs or filter IDs', () => {
  const { document } = parseHTML(`<html data-strgo-ui="experience"><head><title>NEXUS INTERSTELLAR · 星际穿越</title></head><body>
    <h1>星际穿越</h1><button data-filter="深空观测">深空观测</button><img alt="蔚蓝星球与城市灯光">
    <input value="黑洞" placeholder="输入星球、主题或关键词…"><div id="dialog-title">下一站，星辰</div><p id="toast">环境音已开启</p>
    <div data-strgo-user-content>探索</div><div>7 个本地结果 / 全部内容</div></body></html>`);
  const previousDocument=globalThis.document, previousLocation=globalThis.location;
  globalThis.document=document; globalThis.location={pathname:'/nexus/'};
  try {
    for (const [locale, title, status] of [['en','Next stop: the stars','Ambient sound on'],['ja','次の目的地は、星々','環境音をオンにしました'],['ko','다음 목적지는 별','주변 소리 켜짐'],['zh-TW','下一站，星辰','環境音已開啟'],['zh-CN','下一站，星辰','环境音已开启']]) {
      setLocale(locale,{persist:false});localizeTree(document.body);localizeTree(document.querySelector('title'));
      assert.equal(document.querySelector('#dialog-title').textContent,title);
      assert.equal(document.querySelector('#toast').textContent,status);
      assert.equal(document.querySelector('input').value,'黑洞');
      assert.equal(document.querySelector('button').dataset.filter,'深空观测');
      assert.equal(document.querySelector('[data-strgo-user-content]').textContent,'探索');
      if(locale==='ja') assert.match(translate('7 个本地结果 / 全部内容'),/7 件/);
    }
  } finally { setLocale('zh-CN',{persist:false});globalThis.document=previousDocument;globalThis.location=previousLocation; }
});
