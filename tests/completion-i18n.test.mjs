import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { completionRows } from '../src/shared/completion-copy.js';
import { localizeTree, setLocale, translate } from '../src/shared/i18n.js';
import { cartView } from '../apps/meow/modules/views.js';
import { products } from '../apps/meow/modules/catalog.js';
import { searchEntries } from '../apps/polyverse/src/manifest.js';

function environment(html, path, callback) {
  const previous = { document: globalThis.document, location: globalThis.location };
  const { document } = parseHTML(`<html data-strgo-ui="experience"><body>${html}</body></html>`);
  globalThis.document = document; globalThis.location = { pathname: path };
  try { callback(document); } finally { setLocale('zh-CN', { persist: false }); Object.assign(globalThis, previous); }
}

test('completion copy has unique keys and a nonempty value in every supported language', () => {
  const keys = new Set();
  for (const [source, ...values] of completionRows) { assert.equal(keys.has(source), false, source); keys.add(source); assert.equal(values.length, 5); assert.ok(values.every(value => typeof value === 'string' && value.trim()), source); }
});

test('the shipped slicing and energy documentation paragraphs translate in all five languages', () => {
  const source = readFileSync(new URL('../apps/polyverse/src/app.js', import.meta.url), 'utf8');
  const paragraphs = ['Restore the standard pose', 'Trails sample actual positions'].map(start => source.match(new RegExp(start + '[\\s\\S]*?</p>'))?.[0]);
  assert.ok(paragraphs.every(Boolean));
  environment(paragraphs.map(text => '<p>' + text).join('') + '<code>U = −Σᵢ&lt;ⱼ Gmᵢmⱼ/√(r²+ε²)</code>', '/polyverse/docs/', document => {
    const originals = [...document.querySelectorAll('p')].map(p => p.textContent);
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko']) {
      setLocale(locale, { persist: false }); localizeTree(document.body);
      for (const [index, paragraph] of [...document.querySelectorAll('p')].entries()) {
        if (locale === 'en') assert.equal(paragraph.textContent, originals[index]); else assert.notEqual(paragraph.textContent, originals[index], locale);
        assert.match(paragraph.textContent, index ? /1024/ : /1\.8/);
      }
      assert.equal(document.querySelector('code').textContent, 'U = −Σᵢ<ⱼ Gmᵢmⱼ/√(r²+ε²)');
    }
  });
});

test('the real shopping list switches all labels and preserves quantities, options and stored data', () => {
  const product = products[0], cart = [{ productId: product.id, option: product.options[0], qty: 2, sku: 'stable-sku' }];
  const store = { data: { cart }, count: 2 };
  environment(cartView(store).html, '/meow/cart/', document => {
    for (const [locale, label] of [['zh-CN','你的购物清单'],['zh-TW','你的購物清單'],['en','YOUR SHOPPING LIST'],['ja','買い物リスト'],['ko','내 쇼핑 목록']]) {
      setLocale(locale, { persist: false }); localizeTree(document.body);
      assert.equal(document.querySelector('.list-summary .eyebrow').textContent, label);
      assert.equal(document.querySelector('input').value, '2'); assert.equal(document.querySelector('input').dataset.cartQty, 'stable-sku');
      assert.equal(store.data.cart[0].option, product.options[0]);
      if (locale === 'en') assert.equal(document.querySelector('[data-cart-confirm] p').textContent, 'Remove all 2 items from this list?');
    }
  });
});

test('documentation search includes save/configuration and can match each translated chapter', () => {
  const chapters = searchEntries.filter(entry => entry.type === 'docs');
  assert.equal(chapters.length, 8); assert.ok(chapters.some(entry => entry.path === 'docs/#configuration'));
  environment('', '/polyverse/search/', () => { for (const entry of chapters) for (const locale of ['zh-CN', 'zh-TW', 'ja', 'ko']) assert.notEqual(translate(entry.title, locale), entry.title); });
});

test('new scene controls translate without changing route or volume input values', () => {
  environment('<a href="/terminal/">电脑终端 ↗</a><button data-action="sound">♫ 开启声音</button><label>音量<input type="range" value="0.3" aria-label="舞台音量"></label>', '/dance/', document => {
    for (const [locale, sound] of [['zh-CN','♫ 开启声音'],['zh-TW','♫ 開啟聲音'],['en','♫ Enable sound'],['ja','♫ 音をオン'],['ko','♫ 소리 켜기']]) {
      setLocale(locale, { persist: false }); localizeTree(document.body);
      assert.equal(document.querySelector('button').textContent, sound); assert.equal(document.querySelector('input').value, '0.3'); assert.equal(document.querySelector('a').getAttribute('href'), '/terminal/');
    }
  });
});

test('real search result categories and descriptions localize independently of their compound row', () => {
  const source = readFileSync(new URL('../apps/polyverse/src/app.js', import.meta.url), 'utf8');
  const functionSource = source.split('\n').find(line => line.startsWith('function resultsMarkup('));
  const render = new Function('searchEntries', 'searchText', 'url', 'esc', functionSource + ';return resultsMarkup;')(searchEntries, (...parts) => parts.join(' ').toLowerCase(), value => '/polyverse/' + value, value => String(value));
  environment(render(''), '/polyverse/search/', document => {
    for (const locale of ['zh-CN', 'zh-TW', 'ja', 'ko']) {
      setLocale(locale, { persist: false }); localizeTree(document.body);
      assert.ok(!document.body.textContent.includes('Model definitions, controls and limitations'), locale);
      assert.ok(!document.body.textContent.includes('Explore higher dimensions and parallel geometric spaces.'), locale);
      assert.equal(document.querySelectorAll('.search-result small span').length, searchEntries.length * 2);
    }
  });
});
