import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {Store} from '../modules/store.js';
import {cats,galleries,products} from '../modules/catalog.js';
import {pageView} from '../modules/views.js';
const store=new Store({getItem:()=>null,setItem:()=>{}});
function doc(page='',id='',search=''){const view=pageView({page,id},store,new URLSearchParams(search));return{view,document:parseHTML(`<main>${view.html}</main>`).document};}
test('home retains four star links, five distinct gallery links and all six scene profile labels',()=>{const {document}=doc();assert.equal(document.querySelectorAll('.popular-grid .cat-card').length,4);assert.equal(document.querySelectorAll('.gallery-tile').length,5);assert.equal(document.querySelectorAll('.cat-hotspot').length,6);for(const c of cats.slice(0,4))assert.ok(document.querySelector(`a[href="/cats/${c.id}/"]`));});
test('all 26 details contain own identity and real scene config, no nested links or buttons',()=>{for(const[p,list]of [['cats',cats],['gallery',galleries],['shop',products]])for(const item of list){const{view,document}=doc(p,item.id);assert.ok(view.title.includes(item.name||item.title));assert.equal(view.scene.id,item.id);assert.equal(document.querySelectorAll('a a,a button,button a').length,0);assert.equal(document.querySelectorAll('[data-scene-host]').length,1);assert.equal(document.querySelectorAll('[data-camera]').length,7);for(const a of document.querySelectorAll('a'))assert.notEqual(a.getAttribute('href'),'#');}});
test('directory shows all roles, empty intersections are honest, and search text is escaped',()=>{assert.equal(doc('cats').document.querySelectorAll('.cat-card').length,14);assert.equal(doc('cats','','type=ragdoll&coat=short').document.querySelectorAll('.cat-card').length,0);const d=doc('search','',`q=${encodeURIComponent('<img src=x onerror=alert(1)>')}`).document;assert.equal(d.querySelectorAll('[onerror]').length,0);});
test('unknown cat, gallery, product and page share a recoverable 404',()=>{for(const p of ['cats','gallery','shop','unknown'])assert.equal(doc(p,'wrong').view.title,'Page not found');});
