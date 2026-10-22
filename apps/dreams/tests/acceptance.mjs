import assert from 'node:assert/strict';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {parseHTML} from 'linkedom';
import {createCanvas} from '@napi-rs/canvas';
import {CHAPTERS,THEMES,STRINGS} from '../src/content.js';
import {makeDreamWorld} from '../src/world.js';

const report={date:new Date().toISOString(),environment:{node:process.version,platform:process.platform,renderer:'Scene graph + native Canvas, no browser'},checks:[],scenes:[],limitations:['Layout, native focus, WebGL reflection and actual frame rate require the separate browser suite.']};
await mkdir('artifacts',{recursive:true});
const home=await readFile('index.html','utf8'),{document:homeDoc}=parseHTML(home);
assert.equal(homeDoc.querySelectorAll('.dream-card').length,8);
assert.equal(homeDoc.querySelectorAll('.theme-item').length,5);
assert.equal(homeDoc.querySelectorAll('main>section').length,3);
assert.equal(new Set([...homeDoc.querySelectorAll('.dream-card')].map(a=>a.getAttribute('href'))).size,8);
for(const id of CHAPTERS.map(c=>c.id)){
 const file=`dreams/${id}/index.html`,html=await readFile(file,'utf8'),{document}=parseHTML(html);
 assert.equal(document.body.dataset.dream,id);assert.ok(document.title.includes(id));assert.ok(document.querySelector('#dream-canvas'));assert.ok(document.querySelector('.reading-prose').textContent.length>100);
 for(const el of document.querySelectorAll('[src],link[href]')){const relative=el.getAttribute('src')||el.getAttribute('href');if(!relative||/^(https?:|#|data:)/.test(relative))continue;await stat(resolve(dirname(file),relative));}
 const prev=[...document.querySelectorAll('.dream-pagination a')].find(a=>a.textContent.includes('Previous dream')),next=[...document.querySelectorAll('.dream-pagination a')].find(a=>a.textContent.includes('Next dream'));
 assert.equal(!!prev,id!=='01');assert.equal(!!next,id!=='08');
}
for(const el of homeDoc.querySelectorAll('[src],link[href]')){const path=el.getAttribute('src')||el.getAttribute('href');if(path&&!/^(https?:|#|data:)/.test(path))await stat(resolve(path));}
assert.deepEqual(Object.keys(STRINGS.en).sort(),Object.keys(STRINGS.ja).sort());
for(const ch of CHAPTERS)for(const mode of ['design','film']){assert.ok(ch[mode+'Artwork']);for(const locale of ['en','ja']){assert.ok(ch[mode+'Title'][locale]);assert.ok(ch[mode+'Summary'][locale]);assert.equal(ch[mode+'Body'][locale].length,2);}for(const id of ch[mode+'Themes'])assert.ok(THEMES.some(th=>th.id===id));}
assert.notEqual(CHAPTERS[0].designTitle.en,CHAPTERS[0].filmTitle.en);assert.notEqual(CHAPTERS[2].designTitle.en,CHAPTERS[2].filmTitle.en);assert.notEqual(CHAPTERS[7].designTitle.en,CHAPTERS[7].filmTitle.en);
report.checks.push('Nine real HTML entries, native card links, valid relative assets, full content and two complete locale dictionaries');
function geometryStats(world){let meshes=0,triangles=0,instances=0;world.scene.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.count||1);if(o.isInstancedMesh)instances+=o.count;}});return{meshes,triangles,instances};}
for(const mode of ['design','film'])for(const ch of CHAPTERS){
 const world=makeDreamWorld({id:ch.id,film:mode==='film',canvasFactory:createCanvas});world.update(0,0);const before=geometryStats(world);
 assert.ok(before.meshes>20);assert.ok(before.triangles>10000);assert.ok(world.isWalkable(0,18));assert.equal(world.isWalkable(80,18),false);assert.equal(world.isWalkable(0,-80),false);
 const geometry=world.root.children.find(o=>o.isMesh)?.geometry;assert.ok(geometry?.attributes.position);const pos=geometry.attributes.position.array;assert.ok(pos.every(Number.isFinite));
 if(ch.id==='04'){assert.equal(world.isWalkable(4,-12),false);assert.equal(world.isWalkable(0,-12),true);}
 if(ch.id==='02'){assert.equal(world.isWalkable(10,-14),false);assert.equal(world.isWalkable(10,6),true);assert.ok(world.walkHeight(10,6)>1);}
 for(let t=1;t<=180;t++)world.update(t,1/60);
 assert.deepEqual(geometryStats(world),before,'Animation must not create additional geometry');
 assert.equal(world.windUniform.value,180);
 report.scenes.push({mode,id:ch.id,...before,simulatedSeconds:180});world.dispose();assert.equal(world.scene.children.length,0);
}
report.checks.push('All 16 mode/scene combinations have real depth, bounded movement and stable object counts over 180 simulated seconds');

// Exercise the actual app in a DOM implementation. This does not claim browser layout coverage.
const {window,document}=parseHTML(home);const callbacks=[];let active=document.body;
Object.defineProperty(document,'activeElement',{get:()=>active});Object.defineProperty(document,'hidden',{value:false,writable:true});
window.HTMLElement.prototype.focus=function(){active=this;};window.HTMLElement.prototype.getClientRects=function(){return[{x:0,y:0,width:20,height:20}];};window.HTMLElement.prototype.getBoundingClientRect=function(){return{x:0,y:0,left:0,top:0,right:1920,bottom:1080,width:1920,height:1080};};window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLElement.prototype.scrollBy=function(){};
const dialog=document.querySelector('dialog');Object.defineProperty(dialog,'open',{get:()=>dialog.hasAttribute('open')});dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');
document.querySelector('canvas').getContext=()=>null;
const storage=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
const loc=new URL('http://localhost:5173/');const motion={matches:false,addEventListener:(_,fn)=>callbacks.push(fn)};
Object.assign(globalThis,{window,document,location:loc,history:{pushState:(_,__,path)=>{loc.href=new URL(path,loc).href;},replaceState:(_,__,path)=>{loc.href=new URL(path,loc).href;}},localStorage:storage(),sessionStorage:storage(),innerWidth:1920,innerHeight:1080,devicePixelRatio:1,matchMedia:q=>q.includes('reduced')?motion:{matches:false,addEventListener(){}},IntersectionObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
const errors=[],originalError=console.error;console.error=(...args)=>{if(!String(args[0]).includes('THREE.WebGLRenderer'))errors.push(args.join(' '));};
await import('../src/app.js');console.error=originalError;
const app=window.dreams;
function click(sel){const el=document.querySelector(sel);assert.ok(el,'Missing '+sel);const event=new window.Event('click',{bubbles:true});event.button=0;el.dispatchEvent(event);}
function input(selector,value,event='input'){const el=document.querySelector(selector);if(el.tagName==='SELECT'){for(const option of el.querySelectorAll('option')){if(option.getAttribute('value')===value)option.setAttribute('selected','');else option.removeAttribute('selected');}}else el.value=value;el.dispatchEvent(new window.Event(event,{bubbles:true}));}
app.openPanel('search');assert.equal(dialog.open,true);input('#dream-search','water');assert.ok(document.querySelectorAll('.search-result').length>=3);input('#dream-search','no-such-dream-9v');assert.ok(document.querySelector('.empty-state'));click('[data-locale="ja"]');assert.equal(document.documentElement.lang,'ja');assert.equal(document.querySelector('#dream-search').value,'no-such-dream-9v');assert.match(document.querySelector('.empty-state').textContent,/見つかりません/);app.closePanel();assert.equal(dialog.open,false);
click('[data-locale="en"]');app.openPanel('gallery');assert.equal(document.querySelectorAll('.gallery-work').length,8);input('#gallery-theme','war','change');assert.ok(document.querySelectorAll('.gallery-work').length>1);input('#gallery-dream','01','change');assert.equal(document.querySelectorAll('.gallery-work').length,0);click('[data-clear-gallery]');assert.equal(document.querySelectorAll('.gallery-work').length,8);click('[data-art="02"]');assert.equal(app.state.panel.type,'art');assert.equal(app.state.artIndex,1);click('[data-art-step="1"]');assert.equal(app.state.artIndex,2);
app.openPanel('themes');assert.equal(document.querySelectorAll('.theme-overview a').length,5);click('[data-theme="nature"]');assert.equal(app.state.panel.id,'nature');assert.ok(document.querySelectorAll('.related-dreams a').length>=5);app.closePanel();
click('[data-setting="pause"]');assert.equal(app.state.paused,true);assert.equal(document.documentElement.classList.contains('motion-paused'),true);click('[data-setting="pause"]');assert.equal(app.state.paused,false);callbacks.forEach(fn=>fn({matches:true}));assert.equal(app.state.reduced,true);assert.equal(document.documentElement.classList.contains('motion-reduced'),true);callbacks.forEach(fn=>fn({matches:false}));app.openPanel('legacy');assert.equal(document.querySelectorAll('.source-link').length,2);assert.equal(dialog.querySelectorAll('a[target="_blank"][rel="noopener noreferrer"]').length,2);app.closePanel();
app.startJourney();assert.equal(app.state.journey,'entering');assert.equal(document.querySelector('#journey').hidden,false);app.finishJourney();assert.equal(loc.pathname,new URL('../dreams/01/',import.meta.url).pathname);assert.equal(app.state.journey,'navigating');assert.deepEqual(errors,[]);
report.checks.push('Actual UI code: WebGL failure, search/no results, language preservation, gallery filters, lightbox, five themes, pause, reduced motion, legacy and journey skip');
report.status='passed';await writeFile('artifacts/acceptance.json',JSON.stringify(report,null,2));console.log('Passed: HTML/content, 16 scene combinations, collision, animation allocation and DOM interactions. See artifacts/acceptance.json.');
