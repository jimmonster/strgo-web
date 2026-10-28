import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createAdmin } from '../src/admin/app.js';
import { adminRows, adminCopy } from '../src/shared/admin-copy.js';
import { adminTraditional } from '../src/shared/admin-traditional.js';
import { localizeTree, setLocale, translate } from '../src/shared/i18n.js';

test('site administration copy is registered in all five languages', () => {
  for (const [source, en, ja, ko] of adminRows) {
    assert.ok(en && ja && ko && adminTraditional[source], source);
    for (const locale of ['en','ja','ko']) assert.ok(adminCopy[locale][source], source);
  }
});

test('site administration translates controls without changing account names, content, drafts or unknown errors', async () => {
  const {document,window}=parseHTML(await readFile(new URL('../src/admin/index.html',import.meta.url),'utf8'));
  const oldDocument=globalThis.document,oldLocation=globalThis.location;
  const location={pathname:'/admin/',hash:'',reload(){}};
  const owner={id:'a'.repeat(32),username:'管理员',role:'admin'};
  const member={id:'b'.repeat(32),username:'账号管理',role:'member',status:'active',sessions:2,created:1700000000,updated:1};
  let confirmation='';
  const fetch=async path=>{
    const route=new URL(path,'https://strgo.com').pathname.replace('/api/image/admin','');
    let data={};
    if(route==='/session')data={user:owner,csrf:'csrf'};
    else if(route==='/summary')data={counts:{users:2,sessions:1,posts:1,images:0,audio:0,imageBytes:0,audioBytes:0},tasks:{image:[],ai:[],workflow:[]},storage:{ready:true,label:'可用',freeBytes:1},backup:{},workflow:{}};
    else if(route==='/users')data={items:[member],total:1,hasMore:false};
    else if(route==='/forum/posts')data={posts:[{id:'d'.repeat(32),title:'置顶',body:'删除',author:{username:'账号管理'},category:'general',created:1700000000,pinned:true}],total:1,hasMore:false};
    return {ok:true,status:200,json:async()=>structuredClone(data)};
  };
  window.strgoI18n={translate};globalThis.document=document;globalThis.location=location;
  try {
    const app=createAdmin({document,fetch,location,confirm:text=>(confirmation=text,false)});await app.start();
    for(const [locale,heading,role] of [['zh-CN','全站运行概览','管理员'],['zh-TW','全站運行概覽','管理員'],['en','Site overview','Administrator'],['ja','サイトの稼働概要','管理者'],['ko','사이트 운영 개요','관리자']]) {
      setLocale(locale,{persist:false});localizeTree(document.body);
      assert.equal(document.querySelector('#main h1').textContent,heading);
      assert.equal(document.querySelector('#account').textContent,`管理员 · ${role}`);
      assert.equal(document.querySelector('.status-line span[data-strgo-user-content]').textContent,'可用');
    }
    const go=async view=>{const link=document.querySelector(`[data-view="${view}"]`);await link.onclick({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));localizeTree(document.body);};
    setLocale('en',{persist:false});await go('users');
    assert.equal(document.querySelector('#main h1').textContent,'Accounts');
    assert.equal(document.querySelector('tbody strong').textContent,'账号管理');
    const input=document.querySelector('#search input');input.value='账号管理';localizeTree(document.body);assert.equal(input.value,'账号管理');
    const button=document.querySelector('[data-action="status"]');await button.onclick({currentTarget:button});
    assert.match(confirmation,/Disable account/);assert.match(confirmation,/账号管理/);assert.match(confirmation,/sign in again/);
    await go('forum');assert.equal(document.querySelector('.post-title strong').textContent,'置顶');assert.equal(document.querySelector('.post-title .badge').textContent,'Pinned');assert.equal(document.querySelector('.post-preview').textContent,'删除');
    const feedback=document.querySelector('#feedback');feedback.textContent='账号管理操作已完成。';localizeTree(feedback);assert.equal(feedback.textContent,'账号管理操作已完成。');
    feedback.setAttribute('data-strgo-static','');localizeTree(feedback);assert.equal(feedback.textContent,'Account operation completed.');
  } finally {setLocale('zh-CN',{persist:false});globalThis.document=oldDocument;globalThis.location=oldLocation;}
});

test('AI administration translates forms while keeping names, values and errors intact', () => {
  const {document}=parseHTML(`<html data-strgo-ui="tool"><head><title>AI 创作空间 — STRGO</title></head><body><div id="app"><div class="initial-loading">正在打开创作空间…</div></div>
    <main id="main"><div class="page-heading"><h1>管理控制台</h1></div><div class="admin-tabs"><button>成员与权限</button></div>
      <div id="admin-content"><div class="panel-title"><h2>模型连接</h2><span>3 个连接</span></div>
        <table><tbody><tr><td class="model-name">配置模型连接</td><td data-strgo-ui-copy>对话 / 音乐</td><td data-strgo-ui-copy>2 次 / 60 秒</td></tr></tbody></table>
        <section id="model-editor"><h2>配置模型连接</h2><label>连接名称<input value="配置模型连接"></label><select><option value="node" data-strgo-user-content>配置模型连接</option></select><p class="error">配置模型连接</p></section>
        <form id="member-form"><h3>可使用模型</h3><label><span data-strgo-user-content>可使用模型</span></label></form>
      </div></main><dialog><div id="dialog-content"><h2><span>授权给</span> <span data-strgo-user-content>授权给</span></h2><p class="error">授权给</p></div></dialog></body></html>`);
  const oldDocument=globalThis.document,oldLocation=globalThis.location;globalThis.document=document;globalThis.location={pathname:'/admin/ai/'};
  try {
    setLocale('en',{persist:false});localizeTree(document.body);localizeTree(document.querySelector('title'));
    assert.equal(document.querySelector('title').textContent,'AI Workspace — STRGO');
    assert.equal(document.querySelector('.initial-loading').textContent,'Opening the creative workspace…');
    assert.equal(document.querySelector('.page-heading h1').textContent,'Administration console');
    assert.equal(document.querySelector('.admin-tabs button').textContent,'Members and access');
    assert.equal(document.querySelector('.panel-title span').textContent,'3 connections');
    assert.equal(document.querySelector('.model-name').textContent,'配置模型连接');
    assert.equal(document.querySelector('td[data-strgo-ui-copy]').textContent,'Chat / Music');
    assert.equal(document.querySelectorAll('td[data-strgo-ui-copy]')[1].textContent,'2 chats / 60 seconds');
    assert.equal(document.querySelector('#model-editor h2').textContent,'Configure model connection');
    assert.equal(document.querySelector('#model-editor input').value,'配置模型连接');
    assert.equal(document.querySelector('#model-editor option').textContent,'配置模型连接');
    assert.equal(document.querySelector('#model-editor .error').textContent,'配置模型连接');
    assert.equal(document.querySelector('#member-form h3').textContent,'Available models');
    assert.equal(document.querySelector('#member-form [data-strgo-user-content]').textContent,'可使用模型');
    assert.equal(document.querySelector('#dialog-content h2').textContent,'Grant access to 授权给');
    assert.equal(document.querySelector('#dialog-content .error').textContent,'授权给');
  } finally {setLocale('zh-CN',{persist:false});globalThis.document=oldDocument;globalThis.location=oldLocation;}
});
