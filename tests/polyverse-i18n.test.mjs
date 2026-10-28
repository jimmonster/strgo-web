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

test('all experiment-specific controls have five-language labels',async()=>{
 const {descriptors}=await import('../apps/polyverse/src/panels.js');
 const {defaultConfig}=await import('../apps/polyverse/src/state.js');
 const oldWidth=globalThis.innerWidth,oldLocation=globalThis.location;globalThis.innerWidth=1440;globalThis.location={pathname:'/polyverse/laws/'};
 try{
  const cases=[];for(const id of ['dimensions','higher','geometry','motion','orbital','laws','cubic','fractal']){
   const params=defaultConfig(id).params;cases.push([id,params]);
   if(id==='dimensions')cases.push([id,{...params,dimension:4,viewMode:'slice'}]);
   if(id==='laws')for(const experiment of ['distance','gravity','harmonic','wave'])cases.push([id,{...params,experiment}]);
   if(id==='motion')cases.push([id,{...params,preset:'analytic'}]);
  }
  for(const [id,params] of cases)for(const descriptor of descriptors(id,params)){
   for(const source of [descriptor.label,...(descriptor.options||[]).map(option=>String(option[1]))])if(/[A-Za-z]{3}/.test(source)){
    for(const locale of ['zh-CN','zh-TW','ja','ko'])assert.notEqual(translate(source,locale),source,`${locale}: ${source}`);
   }
  }
 }finally{globalThis.innerWidth=oldWidth;globalThis.location=oldLocation;}
});

test('scene tour and local-work confirmation switch languages without changing the saved name',()=>{
 const {document}=parseHTML(`<html data-strgo-ui="experience"><body><dialog><h2>A SCENE TOUR · 24 SECONDS</h2><h3>PURE GEOMETRY</h3><p>A universe built from nested cubes, light and mathematical form.</p><p class="dialog-copy"><span>Type the exact name to delete this work:</span> “<span data-strgo-user-content>PURE GEOMETRY</span>”. <span>This removes only this local record.</span></p><input value="PURE GEOMETRY"></dialog></body></html>`);
 const oldDocument=globalThis.document,oldLocation=globalThis.location;globalThis.document=document;globalThis.location={pathname:'/polyverse/library/'};
 try{
  for(const [locale,stage] of [['zh-CN','纯粹几何'],['zh-TW','純粹幾何'],['en','PURE GEOMETRY'],['ja','純粋な幾何学'],['ko','순수 기하학']]){
   setLocale(locale,{persist:false});localizeTree(document.body);assert.equal(document.querySelector('h3').textContent,stage);assert.equal(document.querySelector('[data-strgo-user-content]').textContent,'PURE GEOMETRY');assert.equal(document.querySelector('input').value,'PURE GEOMETRY');
  }
  setLocale('zh-CN',{persist:false});localizeTree(document.body);assert.match(document.querySelector('.dialog-copy').textContent,/输入作品完整名称以删除/);assert.match(document.querySelector('.dialog-copy').textContent,/只会删除此本地记录/);
 }finally{setLocale('zh-CN',{persist:false});globalThis.document=oldDocument;globalThis.location=oldLocation;}
});
