import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { readFile } from 'node:fs/promises';
import { resolveLocale, setLocale, getLocale, translate, localizeTree, SUPPORTED_LOCALES } from '../src/shared/i18n.js';
import { filterEntries } from '../src/shared/catalog.js';
import { english } from '../src/shared/translations.js';
import { traditional } from '../src/shared/traditional.js';
import { japanese, korean } from '../src/shared/east-asian.js';

const registry = JSON.parse(await readFile(new URL('../content/app-registry.json', import.meta.url)));
test('language detection respects an explicit preference and common region codes', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['zh-CN', 'zh-TW', 'en', 'ja', 'ko']);
  assert.equal(resolveLocale('ko', ['zh-CN']), 'ko');
  assert.equal(resolveLocale(null, ['zh-Hant-HK']), 'zh-TW');
  assert.equal(resolveLocale(null, ['zh-CN']), 'zh-CN');
  assert.equal(resolveLocale(null, ['ja-JP']), 'ja');
  assert.equal(resolveLocale(null, ['ko-KR']), 'ko');
  assert.equal(resolveLocale('invalid', ['en-US']), 'en');
});

test('every maintained source phrase has entries for all five languages', () => {
  for (const [locale, dictionary] of [['zh-TW', traditional], ['ja', japanese], ['ko', korean]]) {
    assert.deepEqual(Object.keys(english).filter(key => !Object.hasOwn(dictionary, key)), [], locale);
  }
});

test('catalog names are translated and searchable in every supported language', () => {
  for (const [locale, term] of [['zh-CN','阳光卧室'],['zh-TW','陽光臥室'],['en','sunlit room'],['ja','日差しの寝室'],['ko','햇살 가득한 침실']]) {
    assert.equal(translate('阳光卧室',locale), locale === 'en' ? 'Sunlit room' : term);
    assert.equal(filterEntries(registry.entries,{query:term})[0].id,'S01');
  }
});

test('locale changes translate UI while preserving user text, input values and filter keys', () => {
  const { document } = parseHTML(`<!doctype html><html data-strgo-ui="hub" lang="zh-CN"><body>
    <h1>全部功能</h1><button data-filter="全部">全部</button>
    <input value="主页" placeholder="搜索功能、空间或路径"><textarea placeholder="输入账号密码">主页</textarea>
    <select><option>主页</option><option value="catalog">全部功能</option></select>
    <div data-strgo-user-content>主页</div><div id="collectionResults"><strong data-strgo-user-content>全部功能</strong><button>下载</button></div>
    <div id="accountStatus"><span data-strgo-user-content>主页</span></div></body></html>`);
  const previousDocument = globalThis.document, previousLocation = globalThis.location;
  globalThis.document = document; globalThis.location = { pathname:'/hub/' };
  try {
    const input = document.querySelector('input'), textarea = document.querySelector('textarea');
    for (const [locale, expected] of [['en','All features'],['zh-TW','全部功能'],['ja','すべての機能'],['ko','모든 기능'],['zh-CN','全部功能']]) {
      assert.equal(setLocale(locale, { persist:false }), true);
      localizeTree(document.body);
      assert.equal(document.querySelector('h1').textContent, expected);
      assert.equal(document.querySelector('button').dataset.filter, '全部');
      assert.equal(input.value, '主页');
      assert.equal(textarea.value, '主页');
      assert.equal(document.querySelector('option').textContent, '主页');
      assert.equal(document.querySelector('[data-strgo-user-content]').textContent, '主页');
      assert.equal(document.querySelector('#collectionResults strong').textContent, '全部功能');
      assert.equal(document.querySelector('#accountStatus').textContent, '主页');
    }
    assert.equal(setLocale('fr', { persist:false }), false);
    assert.equal(getLocale(), 'zh-CN');
  } finally { globalThis.document = previousDocument; globalThis.location = previousLocation; }
});


test('tasks and assets routes retain the hub translation behavior', () => {
  const { document } = parseHTML('<html data-strgo-ui="tool"><body><nav id="railNav"></nav><h1>全部功能</h1></body></html>');
  const previousDocument = globalThis.document, previousLocation = globalThis.location;
  globalThis.document=document; globalThis.location={pathname:'/ai/tasks/'};
  try { setLocale('ja', {persist:false}); localizeTree(document.body); assert.equal(document.querySelector('h1').textContent,'すべての機能'); }
  finally { setLocale('zh-CN',{persist:false}); globalThis.document=previousDocument; globalThis.location=previousLocation; }
});

test('community posts and image-workspace prompts remain unchanged in translated interfaces', () => {
  const previousDocument = globalThis.document, previousLocation = globalThis.location;
  try {
    for (const [path, html, rootSelector, userSelector, expected] of [
      ['/forum/', '<section id="workspace"><button>发布帖子</button><div id="posts"><p>全部功能</p></div></section>', '#workspace button', '#posts p', 'Publish post'],
      ['/image-playground/', '<section id="workspace"><button>生成图片</button><div id="shared-preset-list"><p>全部功能</p></div><textarea id="prompt">主页</textarea></section>', '#workspace button', '#shared-preset-list p', 'Generate images'],
    ]) {
      const { document } = parseHTML(`<html data-strgo-ui="tool"><body>${html}</body></html>`);
      globalThis.document=document; globalThis.location={pathname:path}; setLocale('en',{persist:false}); localizeTree(document.body);
      assert.equal(document.querySelector(rootSelector).textContent,expected);
      assert.equal(document.querySelector(userSelector).textContent,'全部功能');
      if (path.includes('image')) assert.equal(document.querySelector('#prompt').value,'主页');
    }
  } finally { setLocale('zh-CN',{persist:false}); globalThis.document=previousDocument; globalThis.location=previousLocation; }
});

test('scene document titles and screen-reader descriptions follow the chosen locale', () => {
  const { document } = parseHTML('<html data-strgo-ui="experience"><head><title>日光卧室 · STRGO</title></head><body><canvas aria-label="卧室视角"></canvas></body></html>');
  const previousDocument=globalThis.document, previousLocation=globalThis.location;
  globalThis.document=document; globalThis.location={pathname:'/home/'};
  try {
    setLocale('ja',{persist:false}); localizeTree(document.querySelector('title')); localizeTree(document.body);
    assert.equal(document.title,'日差しの寝室 · STRGO');
    assert.equal(document.querySelector('canvas').getAttribute('aria-label'),'寝室の視点');
    setLocale('zh-CN',{persist:false}); localizeTree(document.querySelector('title')); localizeTree(document.body);
    assert.equal(document.title,'日光卧室 · STRGO');
  } finally { globalThis.document=previousDocument; globalThis.location=previousLocation; }
});
