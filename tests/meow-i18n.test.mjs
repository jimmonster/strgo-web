import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { meowRows, meowCopy } from '../src/shared/meow-copy.js';
import { meowTraditional } from '../src/shared/meow-traditional.js';
import { localizeTree, setLocale, translate } from '../src/shared/i18n.js';
import { filterCats, search } from '../apps/meow/modules/catalog.js';

test('MEOW registered phrases have a translation for all five languages', () => {
  for (const [source, ...translations] of meowRows) {
    assert.equal(translations.length,4,source); assert.ok(translations.every(Boolean),source);
    for(const locale of ['zh-CN','en','ja','ko'])assert.ok(Object.hasOwn(meowCopy[locale],source),locale+source);
    assert.ok(Object.hasOwn(meowTraditional,source),source);
  }
});
test('MEOW live UI switching preserves local names, notes, inputs, options and filters', () => {
  const { document } = parseHTML(`<html data-strgo-ui="experience"><body>
    <a>Home</a><button data-filter="短毛">短毛</button><p>一只会用慢眨眼回应你的奶油色长毛家猫。Milk 喜欢柔软毛毯、粉色蝴蝶结和安静的陪伴。</p>
    <select><option value="短毛">短毛</option></select><input value="猫咪" placeholder="搜索名字或品类"><textarea>保存本地草稿</textarea>
    <div class="profile-card"><h2 data-strgo-user-content>短毛</h2></div><div class="local-message"><p>短毛</p></div><div id="companion-card"><h2><span data-strgo-user-content>短毛</span></h2></div><p id="sample-default-name">You</p>
  </body></html>`);
  const previousDocument=globalThis.document,previousLocation=globalThis.location;
  globalThis.document=document;globalThis.location={pathname:'/meow/cats/'};
  try {
    for(const [locale,home,coat] of [['zh-CN','首页','短毛'],['zh-TW','首頁','短毛'],['en','Home','Short hair'],['ja','ホーム','短毛'],['ko','홈','단모']]){
      setLocale(locale,{persist:false});localizeTree(document.body);
      assert.equal(document.querySelector('a').textContent,home);
      assert.equal(document.querySelector('button').textContent,coat);
      assert.equal(document.querySelector('button').dataset.filter,'短毛');
      assert.equal(document.querySelector('option').value,'短毛');
      assert.equal(document.querySelector('input').value,'猫咪');
      assert.equal(document.querySelector('textarea').value,'保存本地草稿');
      for(const selector of ['.profile-card h2','.local-message p','#companion-card h2'])assert.equal(document.querySelector(selector).textContent,'短毛');
      if(locale==='zh-CN'){assert.equal(document.querySelector('#sample-default-name').textContent,'你');assert.equal(translate('Bubble Wave ←'),'泡泡挥爪 ←');assert.equal(translate('收藏 Bubble Wave'),'收藏 泡泡挥爪');assert.equal(translate('idle · 轻轻呼吸中'),'待机 · 轻轻呼吸中');}
      if(locale==='en'){assert.equal(translate('摸摸头 · 播放中（单次预览）'),'Pet · Playing (single preview)');assert.equal(translate('当前网址：https://example.test/?q=猫咪'),'Current URL: https://example.test/?q=猫咪');}
    }
  } finally {setLocale('zh-CN',{persist:false});globalThis.document=previousDocument;globalThis.location=previousLocation;}
});
test('MEOW search can find translated cat breeds and product names', () => {
  const previousWindow=globalThis.window,previousLocation=globalThis.location;
  globalThis.window={strgoI18n:{translate}};globalThis.location={pathname:'/meow/search/'};
  try {
    for(const term of ['布偶猫','布偶貓','Ragdoll','ラグドール','랙돌']) assert.ok(filterCats(new URLSearchParams({q:term})).some(c=>c.id==='luna'),term);
    for(const term of ['云朵猫窝','雲朵貓窩','Cloud cat bed','雲の猫ベッド','구름 고양이 침대'])assert.ok(search(term).some(p=>p.id==='cloud-bed'),term);
  } finally {globalThis.window=previousWindow;globalThis.location=previousLocation;}
});

test('profile and companion views mark saved names while localizing default labels',async()=>{
 const {accountView,adoptView}=await import('../apps/meow/modules/views.js');
 const profile={name:'短毛',avatar:'milk',preference:''};
 const store={data:{profile,companion:{catId:'milk',name:'短毛',date:'2026-01-01'}}};
 const {document}=parseHTML(`<html data-strgo-ui="experience"><body>${accountView(store).html}${adoptView(store).html}</body></html>`);
 const oldDocument=globalThis.document,oldLocation=globalThis.location;globalThis.document=document;globalThis.location={pathname:'/meow/account/'};
 try{setLocale('en',{persist:false});localizeTree(document.body);assert.equal(document.querySelector('.profile-card h2').textContent,'短毛');assert.match(document.querySelector('#companion-card h2').textContent,/短毛/);assert.ok(document.querySelector('#companion-card [data-strgo-user-content]'));}
 finally{setLocale('zh-CN',{persist:false});globalThis.document=oldDocument;globalThis.location=oldLocation;}
});
