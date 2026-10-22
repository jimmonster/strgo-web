import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {cats} from '../modules/catalog.js';
const base=new URL('../',import.meta.url).pathname;
test('real app survives WebGL failure, navigates 14 roles, keeps favorites, and labels static actions honestly',async()=>{
  const {document,window:dom}=parseHTML('<!doctype html><html><body><div id="app"></div></body></html>');
  const storage=new Map(),frames=new Map();let frame=0;
  const win=new dom.EventTarget();win.document=document;win.scrollTo=(_x,y)=>globalThis.scrollY=y||0;
  Object.assign(globalThis,{window:win,document,innerWidth:1440,innerHeight:941,devicePixelRatio:1,scrollY:0,location:new URL(`http://meow.test${base}`),requestAnimationFrame:fn=>(frames.set(++frame,fn),frame),cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:false,addEventListener(){}}),localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:()=>null,setItem(){}}});
  globalThis.history={state:{},pushState(state,_title,url){this.state=state;globalThis.location=new URL(url,location.href);},replaceState(state){this.state=state;}};
  dom.HTMLCanvasElement.prototype.getContext=()=>null;
  const originalError=console.error;console.error=(...args)=>{if(!String(args[0]).includes('THREE.WebGLRenderer'))originalError(...args);};
  try{
    await import('../app.js');assert.equal(window.meow.ready,true);assert.equal(window.meow.diagnostics().mode,'static');assert.ok(document.querySelector('.scene-fallback'));assert.match(document.querySelector('[data-scene-status]').textContent,/静态预览/);
    const favorite=document.querySelector('[data-favorite="cat:milk"]');favorite.dispatchEvent(new dom.Event('click',{bubbles:true}));assert.equal(favorite.getAttribute('aria-pressed'),'true');assert.equal(location.pathname,base);
    for(const cat of cats){window.meow.navigate(base+cat.route);assert.match(document.title,new RegExp(cat.name));assert.equal(document.querySelectorAll('canvas').length,0);assert.equal(window.meow.diagnostics().loops,0);assert.equal(window.meow.diagnostics().mode,'static');}
    window.meow.navigate(base+'cats/milk/');assert.equal(document.querySelector('[data-favorite="cat:milk"]').getAttribute('aria-pressed'),'true');document.querySelector('[data-cat-action=paw]').dispatchEvent(new dom.Event('click',{bubbles:true}));assert.match(document.querySelector('[data-action-status]').textContent,/静态预览模式无法播放/);
    window.meow.navigate(base+'cats/?type=domestic&coat=long');assert.equal(document.querySelectorAll('.cat-card').length,1);
    window.meow.navigate(base+'gallery/cloud-nap/');assert.match(document.querySelector('.scene-fallback').src,/gallery-cloud-nap/);
    window.meow.navigate(base+'cats/unknown/');assert.match(document.querySelector('h1').textContent,/wandered off/);assert.ok(document.querySelector(`a[href="${base}"]`));
  }finally{clearTimeout(0);console.error=originalError;}
});
