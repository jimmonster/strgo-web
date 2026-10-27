import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { workflowRows,workflowCopy } from '../src/shared/workflow-copy.js';
import { workflowTraditional } from '../src/shared/workflow-traditional.js';
import {localizeTree,setLocale} from '../src/shared/i18n.js';

test('workflow fixed copy covers all five languages',()=>{
  for(const [source,...values] of workflowRows){assert.equal(values.length,4);assert.ok(values.every(Boolean),source);assert.ok(workflowTraditional[source],source);for(const locale of ['zh-CN','en','ja','ko'])assert.ok(workflowCopy[locale][source],source);}
});

test('workflow translates fixed UI on its independent origin without rewriting machine data',async()=>{
  const html=await readFile(new URL('../src/local-studio/index.html',import.meta.url),'utf8');
  const source=(await readFile(new URL('../src/local-studio/app.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
  const {document,window}=parseHTML(html);
  const selectPrototype=Object.getPrototypeOf(document.querySelector('select'));
  Object.defineProperty(selectPrototype,'value',{configurable:true,get(){return [...this.querySelectorAll('option')].find(o=>o.hasAttribute('selected'))?.getAttribute('value')??this.querySelector('option')?.getAttribute('value')??'';},set(v){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.getAttribute('value')===v);}});
  const requests=[];const fetch=async url=>{requests.push(url);const path=url.replace('/api/image/local-studio','');let data={};
    if(path==='/session')data={user:{username:'用户名',role:'admin'},csrf:'csrf'};
    else if(path==='/status')data={online:true,enabled:true,draining:false,resourceHeld:false,workflows:[{id:'wf1',label:'工作流',description:'新的创作',reference:false}]};
    else if(path==='/jobs')data={jobs:[{id:'a'.repeat(32),label:'已完成',prompt:'提交本机生成',status:'complete',kind:'image',created:1700000000,error:'等待本机执行'},{id:'b'.repeat(32),label:'第二项',prompt:'新的创作',status:'已完成',kind:'image',created:1700000000}]};
    return {ok:true,status:200,json:async()=>data};
  };
  const previousDocument=globalThis.document,previousLocation=globalThis.location;
  globalThis.document=document;globalThis.location={pathname:'/'};
  try{
    vm.runInNewContext(source,{document,window,fetch,AbortController,setTimeout:()=>1,clearTimeout:()=>{},crypto:{randomUUID:()=> 'test'},compressReferenceImage:async()=>{},console,URL,Date});
    for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.ok(requests.some(path=>path.endsWith('/jobs')));
    document.querySelector('#prompt').value='提交本机生成';
    for(const [locale,heading] of [['zh-CN','新的创作'],['zh-TW','新的創作'],['en','New creation'],['ja','新しい作品'],['ko','새 창작']]){
      setLocale(locale,{persist:false});localizeTree(document.body);localizeTree(document.querySelector('title'));
      assert.equal(document.querySelector('.create-panel h2').textContent,heading);
      assert.equal(document.querySelector('#account-name').textContent,'用户名');
      assert.equal(document.querySelector('#prompt').value,'提交本机生成');
      assert.equal(document.querySelector('#workflow option').textContent,'工作流');
      assert.equal(document.querySelector('#workflow-description').textContent,'新的创作');
      assert.equal(document.querySelector('.job h3').textContent,'已完成');
      assert.equal(document.querySelector('.job-prompt').textContent,'提交本机生成');
      assert.equal(document.querySelector('.job .message').textContent,'等待本机执行');
      assert.equal(document.querySelectorAll('.job .badge')[1].textContent,'已完成');
      if(locale==='en'){assert.equal(document.querySelector('.job .badge').textContent,'Complete');assert.equal(document.querySelector('.download').textContent,'Download ↓');assert.equal(document.querySelector('.job img').alt,'Generated image');}
    }
  }finally{setLocale('zh-CN',{persist:false});globalThis.document=previousDocument;globalThis.location=previousLocation;}
});
