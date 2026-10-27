import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {polyverseRows,polyverseCopy} from '../src/shared/polyverse-copy.js';
import {polyverseTraditional} from '../src/shared/polyverse-traditional.js';
import {localizeTree,setLocale,translate} from '../src/shared/i18n.js';

test('POLYVERSE registered UI phrases cover all five languages',()=>{
 for(const [source,cn,ja,ko] of polyverseRows){assert.ok(cn&&ja&&ko,source);assert.ok(Object.hasOwn(polyverseTraditional,source),source);for(const locale of ['zh-CN','ja','ko'])assert.ok(Object.hasOwn(polyverseCopy[locale],source));}
});
test('POLYVERSE UI switches while preserving user work names, inputs and parameters',()=>{
 const {document}=parseHTML(`<html data-strgo-ui="experience"><head><title>Dimension Laboratory — POLYVERSE</title></head><body>
  <h1>DIMENSION</h1><label>Projection<select data-param="projection"><option value="perspective">Perspective</option></select></label>
  <input value="DIMENSION" placeholder="Search the library…"><div data-strgo-user-content>DIMENSION</div><div id="selection-info">DIMENSION</div>
  <div id="dialog-title">SAVE A LOCAL STUDY</div><p>2 RESULTS FOR “DIMENSION”</p></body></html>`);
 const previousDocument=globalThis.document,previousLocation=globalThis.location;globalThis.document=document;globalThis.location={pathname:'/polyverse/dimensions/'};
 try{
  for(const [locale,heading] of [['zh-CN','维度'],['zh-TW','維度'],['en','DIMENSION'],['ja','次元'],['ko','차원']]){
   setLocale(locale,{persist:false});localizeTree(document.body);localizeTree(document.querySelector('title'));
   assert.equal(document.querySelector('h1').textContent,heading);assert.equal(document.querySelector('input').value,'DIMENSION');
   assert.equal(document.querySelector('select').dataset.param,'projection');assert.equal(document.querySelector('option').value,'perspective');
   assert.equal(document.querySelector('[data-strgo-user-content]').textContent,'DIMENSION');assert.equal(document.querySelector('#selection-info').textContent,'DIMENSION');
   assert.match(document.querySelector('p').textContent,/DIMENSION/);
  }
  assert.equal(translate('Dimension Laboratory','ko'),'차원 실험실');
 }finally{setLocale('zh-CN',{persist:false});globalThis.document=previousDocument;globalThis.location=previousLocation;}
});
