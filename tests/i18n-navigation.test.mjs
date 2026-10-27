import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

const registry = JSON.parse(await readFile(new URL('../content/app-registry.json', import.meta.url)));
test('shared language picker updates live navigation and persists the selected locale', async () => {
  const { window, document } = parseHTML('<html data-strgo-ui="hub" lang="zh-CN"><body><h1>全部功能</h1></body></html>');
  const values = new Map([['strgo:locale:v1', 'zh-CN']]);
  const storage = { getItem:k=>values.get(k) ?? null, setItem:(k,v)=>values.set(k,String(v)) };
  const selectProto = Object.getPrototypeOf(document.createElement('select'));
  Object.defineProperty(selectProto,'value',{configurable:true,get(){return [...this.options].find(o=>o.hasAttribute('selected'))?.value ?? this.options[0]?.value;},set(value){for(const option of this.options) option.toggleAttribute('selected',option.value === value);}});
  Object.assign(globalThis, { window, document, location:{pathname:'/hub/'}, localStorage:storage,
    HTMLElement:window.HTMLElement, customElements:window.customElements, CustomEvent:window.CustomEvent, MutationObserver:window.MutationObserver });
  window.STRGO = registry;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => String(input).includes('registry.json') ? new Response(JSON.stringify(registry),{headers:{'Content-Type':'application/json'}}) : new Response(JSON.stringify({user:null}),{headers:{'Content-Type':'application/json'}});
  try {
    await import('../src/shared/site-navigation.js');
    const navigation = document.createElement('strgo-navigation');
    document.body.append(navigation);
    const root = navigation.shadowRoot, picker = root.querySelector('select'), dialog = root.querySelector('dialog');
    dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
    assert.deepEqual([...picker.options].map(option=>option.value), ['zh-CN','zh-TW','en','ja','ko']);
    picker.value='ja'; picker.dispatchEvent(new window.Event('change'));
    assert.equal(values.get('strgo:locale:v1'),'ja');
    assert.equal(root.querySelector('.label').textContent,'すべての機能');
    assert.equal(document.querySelector('h1').textContent,'すべての機能');
    assert.equal(document.documentElement.lang,'ja');
    await navigation.open();
    assert.match(root.querySelector('.results').textContent, /日差しの寝室/);
    picker.value='ko'; picker.dispatchEvent(new window.Event('change'));
    assert.equal(root.querySelector('.label').textContent,'모든 기능');
    assert.match(root.querySelector('.results').textContent, /햇살 가득한 침실/);
    assert.equal(document.querySelector('h1').textContent,'모든 기능');
    window.dispatchEvent(new window.CustomEvent('strgo:localerequest',{detail:{locale:'ja'}}));
    assert.equal(values.get('strgo:locale:v1'),'ja');
    assert.equal(root.querySelector('.label').textContent,'すべての機能');
    navigation.remove();
    await import('../src/shared/experience-navigation.js');
    assert.ok(document.querySelector('strgo-navigation'));
    document.body.innerHTML = '<main>Scene re-render</main>';
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(document.querySelector('strgo-navigation'), 'shared navigation returns after a world re-renders');
    assert.equal(document.querySelectorAll('strgo-navigation').length, 1);
  } finally { globalThis.fetch=originalFetch; }
});
