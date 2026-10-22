import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {ForegroundScene} from '../src/foreground.js';
import {seededRandom} from '../src/scene-config.js';
import * as THREE from '../assets/three.module.js';
const root=new URL('../',import.meta.url);
const {window,document}=parseHTML(await readFile(new URL('index.html',root),'utf8'));
const frames=new Map();let frameId=0,time=0,focus=null;
Object.defineProperty(document,'activeElement',{get:()=>focus});
window.HTMLElement.prototype.focus=function(){focus=this;};
const dialog=document.querySelector('dialog');dialog.showModal=function(){this.open=true;};dialog.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
const storage=new Map();
Object.assign(globalThis,{window,document,HTMLElement:window.HTMLElement,matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)});
window.scrollTo=()=>{};
class FakeScene {
 constructor(state,ready){this.state=state;this.time=2;this.approach=0;this.fade=0;ready('medium','webgl');}
 setQuality(q){this.state.quality=q;}getDiagnostics(){return {mode:'test'};}dispose(){}
}
globalThis.TestSceneManager=FakeScene;
let source=await readFile(new URL('src/app.js',root),'utf8');
source=source.replace("import {SceneManager} from './scene.js';",'const SceneManager=globalThis.TestSceneManager;');
source=source.replaceAll("'./scene-config.js'",JSON.stringify(new URL('src/scene-config.js',root).href)).replaceAll("'./content-data.js'",JSON.stringify(new URL('src/content-data.js',root).href));
await import('data:text/javascript;base64,'+Buffer.from(source+'\n//# sourceURL=nexus-app-test.mjs').toString('base64'));
const app=window.nexus;
const click=selector=>{const el=document.querySelector(selector);assert.ok(el,'Missing '+selector);el.focus();el.dispatchEvent(new window.Event('click',{bubbles:true}));return el;};
function step(ms=50){time+=ms;const entries=[...frames.entries()];frames.clear();entries.forEach(([,fn])=>fn(time));}
function close(){click('#close-dialog');assert.equal(dialog.open,false);}
const checks=[];
for(const p of ['explore','destinations','technology','archives','about','account','language','blackhole','homeworld']){
 app.openPanel(p,document.querySelector('.brand'));step();assert.equal(dialog.open,true);assert.ok(document.querySelector('#dialog-title').textContent.length>0);assert.ok(document.querySelector('#dialog-content').textContent.length>10);close();checks.push('panel:'+p);
}
app.openPanel('search');step();const input=document.querySelector('#search-input');input.value='比邻星';input.dispatchEvent(new window.Event('input',{bubbles:true}));assert.match(document.querySelector('#search-results').textContent,/比邻星 b/);input.value='不存在的星球xyz';input.dispatchEvent(new window.Event('input',{bubbles:true}));assert.match(document.querySelector('#search-results').textContent,/没有找到/);close();checks.push('search and empty state');
app.openPanel('archives');click('[data-filter="深空观测"]');assert.equal(document.querySelectorAll('#archive-results .content-item').length,2);click('#archive-results [data-archive]');assert.match(document.querySelector('#dialog-content').textContent,/本地演示档案/);close();checks.push('archive filters and detail');
app.openPanel('destinations');click('[data-destination="proxima"]');click('[data-route="proxima"]');assert.match(document.querySelector('#route-feedback').textContent,/已生成/);assert.equal(document.querySelector('[data-route]').disabled,true);close();checks.push('destination and demo route');
app.openPanel('explore');click('[data-galaxy="0"]');assert.match(document.querySelector('#dialog-content').textContent,/银河系/);close();
app.openPanel('technology');click('[data-tech="wormhole"]');assert.match(document.querySelector('#dialog-content').textContent,/尚未被观测证实/);close();checks.push('galaxy and technology detail');
app.openPanel('account');click('[data-action="guest"]');assert.equal(dialog.open,false);checks.push('guest account flow');
app.openPanel('menu');click('[data-setting="pause"]');assert.equal(app.state.motionPaused,true);assert.ok(document.body.classList.contains('paused'));click('[data-setting="pause"]');assert.equal(app.state.motionPaused,false);click('[data-setting="reduce"]');assert.equal(app.state.reducedMotion,true);close();click('#journey-btn');assert.equal(dialog.open,true);assert.match(document.querySelector('#dialog-title').textContent,/航线/);assert.equal(app.scene.approach,0);close();app.state.reducedMotion=false;checks.push('pause, reduced motion and no-camera route');
click('[data-preset="2"]');assert.equal(app.state.scenePreset,2);assert.equal(document.querySelector('[data-preset="2"]').getAttribute('aria-current'),'true');checks.push('scene presets');
click('#journey-btn');assert.equal(app.state.transitionPhase,'approach');click('#journey-btn');assert.equal(app.state.transitionPhase,'approach');click('#skip-transition');assert.equal(app.state.transitionPhase,'idle');assert.equal(dialog.open,true);assert.equal(document.querySelector('#journey-btn').disabled,false);close();checks.push('journey lock and skip');
click('#journey-btn');step();for(let i=0;i<70;i++)step();assert.equal(dialog.open,true);assert.equal(app.state.transitionPhase,'idle');assert.equal(app.scene.approach,0);close();checks.push('complete journey restoration');
click('#journey-btn');app.cancelJourney();assert.equal(app.state.transitionPhase,'idle');assert.equal(document.activeElement,document.querySelector('#journey-btn'));checks.push('cancel and focus restoration');
app.openPanel('blackhole');click('[data-action="focus"]');assert.ok(app.scene.approach>0);click('#focus-return');assert.equal(app.scene.approach,0);checks.push('black hole focus and return');
click('[data-action="trailer"]');assert.ok(document.body.classList.contains('trailer-playing'));click('#end-trailer');assert.equal(document.body.classList.contains('trailer-playing'),false);checks.push('scene demo exit');
app.openPanel('menu');click('[data-action="home"]');assert.equal(app.state.scenePreset,0);assert.equal(dialog.open,false);checks.push('home reset');
const a=seededRandom(4217),b=seededRandom(4217);assert.deepEqual(Array.from({length:8},a),Array.from({length:8},b));
const foreground=new ForegroundScene();foreground.resize(1920,1080);foreground.update(4,new THREE.Vector2(),0,'medium');foreground.scene.updateMatrixWorld(true);let meshes=0;foreground.scene.traverse(o=>{if(o.isMesh){meshes++;for(const n of o.matrixWorld.elements)assert.ok(Number.isFinite(n));}});assert.ok(meshes<90);foreground.update(4,new THREE.Vector2(),0,'medium');const m=foreground.debris.instanceMatrix.array.slice();foreground.update(4,new THREE.Vector2(),0,'medium');assert.deepEqual(foreground.debris.instanceMatrix.array,m);foreground.dispose();checks.push('seed reproducibility, batched geometry, stable time');
app.dispose();
await mkdir(new URL('artifacts/',root),{recursive:true});
await writeFile(new URL('artifacts/interaction-report.json',root),JSON.stringify({status:'passed',method:'DOM behavior harness with simulated renderer; does not validate browser layout or GPU',checks,foregroundMeshes:meshes},null,2));
console.log(`${checks.length} interaction/geometry checks passed. Browser visual acceptance remains separate.`);
